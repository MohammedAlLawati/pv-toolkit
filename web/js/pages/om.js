// O&M reports: a monthly report per client plant, cumulative for the calendar year, on the HTC
// letterhead. Inputs per month: the iSolarCloud Excel export, the maintenance visits, cleaning
// photos and the Not OK items from the site checklist. The plant (DC kWp, inverters…) is kept on
// the client, so it's entered once. Every generated report is kept as a version, and every
// month's inputs stay with the report, so a full package can be downloaded at any time. With the
// cloud account connected, all of it (reports, Excel files, photos) is saved to the cloud.
import { download, fileUrl, g, go, html, num, readImage, sel, shortDate, toast } from "../ui.js";
import * as db from "../store.js";
import { byName, byUpdated, loadAll } from "../data.js";
import { setTitle } from "../app.js";
import { inverterOptions } from "../options.js";
import { CLIENT_TYPES, NEW_CLIENT } from "../clients/model.js";
import { ACTIVITIES, CHECKLIST, NEW_REPORT, NEW_SITE, SEVERITIES, compute, earlierInYear, fileBase, fmt, fmtDate,
         inverterText, isCleaning, monthName, reportNo, siteOf, totalAcKw } from "../om/model.js";

const STORE = "om_reports";
const today = () => new Date().toISOString().slice(0, 10);
const lastMonth = () => { const d = new Date(); d.setDate(1); d.setMonth(d.getMonth() - 1); return d.toISOString().slice(0, 7); };
const safe = (s) => String(s || "").replace(/[\\/:*?"<>|]+/g, "-").trim();

async function busy(btn, fn) {
  const label = btn.textContent;
  btn.disabled = true; btn.textContent = "Working…";
  try { await fn(); } catch (err) { console.error(err); toast(err.message || String(err), "error"); }
  finally { btn.disabled = false; btn.textContent = label; }
}

// ---- documents ---------------------------------------------------------------------------

/** The letterhead as PNGs: the one uploaded in Settings, else the built-in HTC letterhead. */
async function letterhead() {
  const { prepareImage, toBytes } = await import("../letters/builder.js");
  const one = async (id) => {
    let bytes = await toBytes(await db.getFile(id));
    if (!bytes) {
      const res = await fetch(`data/htc_${id}.png`);
      if (!res.ok) return null;
      bytes = new Uint8Array(await res.arrayBuffer());
    }
    return prepareImage(bytes);
  };
  const [top, bottom] = await Promise.all([one("letterhead_top"), one("letterhead_bottom")]);
  return { top, bottom };
}

async function picture(id) {
  const f = await db.getFile(id);
  if (!f?.blob) return null;
  const data = new Uint8Array(await f.blob.arrayBuffer());
  let { width, height } = f;
  if (!width || !height) { const b = await createImageBitmap(f.blob); width = b.width; height = b.height; b.close?.(); }
  return { data, width, height, type: /png/.test(f.mime) ? "png" : "jpg" };
}

async function makeReport(r, client, reports) {
  const site = siteOf(client);
  const calc = compute(r, site, reports);
  if (!calc.current) throw new Error(calc.problems[0] || "No generation for the report month.");
  const { reportCharts, toPng } = await import("../om/charts.js");
  const svgs = reportCharts(calc);
  const charts = {};
  for (const [k, svg] of Object.entries(svgs)) charts[k] = await toPng(svg);
  const photos = [];
  for (const p of (r.cleaning_photos || []).filter((x) => !x.date || x.date.slice(0, 7) === r.report_month)) {
    photos.push({ label: p.date ? `Cleaning of ${fmtDate(p.date)}` : "", before: await picture(p.before_id), after: await picture(p.after_id) });
  }
  const { buildReport } = await import("../om/report.js");
  const blob = await buildReport({ report: r, site, calc, charts, photos, letterhead: await letterhead() });
  return { blob, filename: `${safe(fileBase(r, site))}.docx`, calc, site };
}

async function makeChecklist(client) {
  const site = siteOf(client);
  const { buildChecklist } = await import("../om/report.js");
  const blob = await buildChecklist({ site, letterhead: await letterhead() });
  return { blob, filename: `${safe(site.plant_name)} - O&M Site Checklist.docx` };
}

/** Add one month's package to a zip folder: latest report version, checklist, Excel export, photos, inputs. */
async function addPackage(folder, r, client) {
  const site = siteOf(client);
  const latest = (r.versions || [])[r.versions.length - 1];
  const rep = latest ? await db.getFile(latest.report_file_id) : null;
  if (rep?.blob) folder.file(latest.report_name || `${safe(fileBase(r, site))}.docx`, rep.blob);
  const ex = await db.getFile(r.export_file_id);
  if (ex?.blob) folder.file(`inputs/${safe(r.export_name || ex.name || "iSolarCloud export.xlsx")}`, ex.blob);
  for (const [i, p] of (r.cleaning_photos || []).entries()) {
    for (const k of ["before", "after"]) {
      const f = await db.getFile(p[`${k}_id`]);
      if (f?.blob) folder.file(`inputs/photos/${p.date || `cleaning-${i + 1}`} ${k}.${/png/.test(f.mime) ? "png" : "jpg"}`, f.blob);
    }
  }
  const { versions, ...inputs } = r;
  folder.file("inputs/report inputs.json", JSON.stringify({ ...inputs, site: client.om || {}, client: client.name,
    versions: (versions || []).map(({ n, created_at, report_name, summary }) => ({ n, created_at, report_name, summary })) }, null, 2));
  return !!rep?.blob;
}

// ---- list --------------------------------------------------------------------------------

export async function list(main, { query }) {
  setTitle("O&M reports");
  const all = await loadAll();
  const reports = await db.list(STORE);
  const clientId = query.client_id ? Number(query.client_id) : null;
  const shown = byUpdated(reports.filter((r) => !clientId || r.client_id === clientId))
    .sort((a, b) => (all.client.get(a.client_id)?.name || "").localeCompare(all.client.get(b.client_id)?.name || "") || b.report_month.localeCompare(a.report_month));
  const withReports = byName(all.clients.filter((c) => reports.some((r) => r.client_id === c.id)));
  const years = [...new Set(shown.map((r) => `${r.client_id}|${r.report_month.slice(0, 4)}`))];
  main.innerHTML = html`
<div class="head">
  <div><h1>O&amp;M reports</h1><div class="muted">Monthly operation &amp; maintenance reports on the HTC letterhead, cumulative for the calendar year, from the iSolarCloud Excel export.</div></div>
  <div class="actions"><a class="btn primary" href="#/om/new${clientId ? `?client_id=${clientId}` : ""}">New O&amp;M report</a></div>
</div>
<div class="panel">
  <div class="panel-head"><h2>Reports</h2>
    ${withReports.length > 1 ? html`<label class="small">Client <select id="filter"><option value="">All clients</option>${withReports.map((c) => html`<option value="${c.id}" ${sel(c.id === clientId)}>${c.name}</option>`)}</select></label>` : ""}
  </div>
  ${shown.length ? html`<div class="table-scroll"><table>
    <thead><tr><th>Client</th><th>Month</th><th>Report no.</th><th class="r">Month (kWh)</th><th class="r">Year to date (kWh)</th><th class="r">Versions</th><th>Updated</th><th></th></tr></thead>
    <tbody>${shown.map((r) => {
      const c = all.client.get(r.client_id), site = siteOf(c), v = (r.versions || [])[r.versions.length - 1];
      return html`<tr>
        <td>${c ? c.name : "(client deleted)"}</td>
        <td><a href="#/om/${r.id}">${monthName(r.report_month)}</a></td>
        <td class="small">${reportNo(r, site)}</td>
        <td class="r num">${v?.summary ? num(v.summary.month_kwh, 1) : "—"}</td>
        <td class="r num">${v?.summary ? num(v.summary.ytd_kwh, 1) : "—"}</td>
        <td class="r num">${(r.versions || []).length}</td>
        <td class="muted small">${shortDate(r.updated_at)}</td>
        <td class="r">${v ? html`<button class="btn small" data-latest="${r.id}">Word</button>` : ""}</td></tr>`;
    })}</tbody>
  </table></div>
  <h3 class="spaced">Full packages</h3>
  <p class="small muted">Every month's report (latest version), Excel export, photos and inputs for a client's year, in one zip.</p>
  <div class="btns">${years.map((k) => { const [cid, y] = k.split("|"); return html`<button class="btn small" data-year="${k}">${all.client.get(Number(cid))?.name || "Client"} ${y}</button>`; })}</div>`
  : html`<div class="empty">No O&amp;M reports yet. <a href="#/om/new">Make the first one</a>: pick the client, the month, and upload the iSolarCloud monthly report.</div>`}
</div>`;
  main.querySelector("#filter")?.addEventListener("change", (e) => go(`#/om${e.target.value ? `?client_id=${e.target.value}` : ""}`));
  const byId = new Map(reports.map((r) => [r.id, r]));
  for (const b of main.querySelectorAll("[data-latest]")) {
    b.addEventListener("click", () => busy(b, async () => {
      const r = byId.get(Number(b.dataset.latest)), v = r.versions[r.versions.length - 1], f = await db.getFile(v.report_file_id);
      if (!f) throw new Error("The report file isn't in this browser yet. Sync, or open the report and generate it again.");
      download(f.blob, v.report_name || f.name);
    }));
  }
  for (const b of main.querySelectorAll("[data-year]")) {
    b.addEventListener("click", () => busy(b, async () => {
      const [cid, y] = b.dataset.year.split("|");
      const c = all.client.get(Number(cid));
      const zip = new globalThis.JSZip();
      const rs = reports.filter((r) => r.client_id === Number(cid) && r.report_month.startsWith(y)).sort((a, b2) => a.report_month.localeCompare(b2.report_month));
      for (const r of rs) await addPackage(zip.folder(`${r.report_month} ${monthName(r.report_month)}`), r, c);
      const cl = await makeChecklist(c);
      zip.file(cl.filename, cl.blob);
      download(await zip.generateAsync({ type: "blob" }), `${safe(siteOf(c).plant_name)} O&M ${y} - full package.zip`);
    }));
  }
}

// ---- one report --------------------------------------------------------------------------

const rowLog = (e = {}) => html`<tr class="log-row">
  <td><input type="date" name="log_date" value="${e.date || ""}"></td>
  <td><select name="log_activity">${[...new Set([...ACTIVITIES, e.activity].filter(Boolean))].map((a) => html`<option ${sel(a === e.activity)}>${a}</option>`)}</select></td>
  <td><input name="log_scope" value="${e.scope || ""}" placeholder="e.g. All module rows"></td>
  <td><input name="log_by" value="${e.by || ""}" placeholder="O&amp;M team"></td>
  <td><input name="log_ref" value="${e.ref || ""}" placeholder="Auto for inspections"></td>
  <td><button type="button" class="btn small" data-remove title="Remove">✕</button></td></tr>`;

const rowFinding = (f = {}) => html`<tr class="finding-row">
  <td><select name="f_item"><option value="">—</option>${CHECKLIST.flatMap((s) => s.items).map(([n, t]) => html`<option value="${n}" title="${t}" ${sel(String(n) === String(f.item_no))}>${n}. ${t.length > 40 ? t.slice(0, 40) + "…" : t}</option>`)}</select></td>
  <td><input name="f_finding" value="${f.finding || ""}" placeholder="What was found"></td>
  <td><select name="f_severity">${SEVERITIES.map((s) => html`<option ${sel(s === (f.severity || "Medium"))}>${s}</option>`)}</select></td>
  <td><input name="f_action" value="${f.action || ""}" placeholder="Action taken / planned"></td>
  <td><select name="f_status">${["Open", "Closed"].map((s) => html`<option ${sel(s === (f.status || "Open"))}>${s}</option>`)}</select></td>
  <td><button type="button" class="btn small" data-remove title="Remove">✕</button></td></tr>`;

const rowInverter = (i = {}, inverters = []) => html`<tr class="inv-row">
  <td><select name="inv_id">${inverterOptions(inverters, i.inverter_id ?? null, { blank: "From the library…" })}</select></td>
  <td><input name="inv_model" value="${i.model || ""}" placeholder="e.g. Sungrow SG110CX"></td>
  <td><input name="inv_qty" value="${g(i.qty ?? 1)}" inputmode="numeric" class="short"></td>
  <td><input name="inv_kw" value="${g(i.ac_kw)}" inputmode="decimal" class="short"></td>
  <td><button type="button" class="btn small" data-remove title="Remove">✕</button></td></tr>`;

export async function form(main, { params, query }) {
  const all = await loadAll();
  const reports = await db.list(STORE);
  let r;
  if (params.id) {
    r = reports.find((x) => x.id === params.id);
    if (!r) { main.innerHTML = html`<div class="panel empty">Report not found. <a href="#/om">Back to O&amp;M reports</a>.</div>`; return; }
    r = { ...NEW_REPORT, ...r };
  } else {
    r = { ...NEW_REPORT, report_month: lastMonth(), report_date: today(), versions: [] };
    if (query.client_id) r.client_id = Number(query.client_id);
    // carry on from the client's latest report: next month, same preparer
    const prev = byUpdated(reports.filter((x) => x.client_id === r.client_id))[0];
    if (prev) r.prepared_by = prev.prepared_by || "";
  }
  const clients = byName(all.clients);
  const clientOf = (id) => all.client.get(id) || null;
  setTitle(params.id ? `O&M report · ${monthName(r.report_month)}` : "New O&M report");

  main.innerHTML = html`
<div class="head">
  <div><h1 id="title">${params.id ? `${clientOf(r.client_id)?.name || "O&M report"} · ${monthName(r.report_month)}` : "New O&M report"}</h1>
    <div class="muted"><a href="#/om">O&amp;M reports</a> · monthly report, cumulative for the calendar year, on the HTC letterhead.</div></div>
  <div class="actions">${params.id ? html`<button class="btn danger small" id="delete" data-confirm="Delete this month's report, its versions and its inputs?">Delete</button>` : ""}
    <button class="btn" id="save" type="button">Save</button>
    <button class="btn primary" id="generate" type="button">Save and generate report</button></div>
</div>
<form id="om" autocomplete="off">
  <div class="panel">
    <h2>Client and month</h2>
    <div class="fields">
      <label>Client <select name="client_id"><option value="">Choose…</option>${clients.map((c) => html`<option value="${c.id}" ${sel(c.id === r.client_id)}>${c.name}</option>`)}<option value="new">+ New client…</option></select></label>
      <label>Report month <input type="month" name="report_month" value="${r.report_month}" required><span class="hint">Figures run from January (or commissioning) to this month</span></label>
      <label>Report date <input type="date" name="report_date" value="${r.report_date}"><span class="hint">A date inside the month marks it month-to-date</span></label>
      <label>Prepared by <input name="prepared_by" value="${r.prepared_by}"></label>
      <label>Report no. <input name="report_no" value="${r.report_no}" placeholder="Automatic"><span class="hint" id="no-hint"></span></label>
    </div>
    <div class="fields spaced-top" id="new-client" hidden>
      <label class="wide">New client's name <input name="new_client_name" dir="auto"></label>
      <label>Client type <select name="new_client_type">${Object.entries(CLIENT_TYPES).map(([k, v]) => html`<option value="${k}" ${sel(k === "commercial")}>${v}</option>`)}</select></label>
      <div class="small muted wide">The client is added to Clients when you save; fill in the rest of their details there later.</div>
    </div>
  </div>

  <div class="panel" id="site-panel">
    <h2>Plant details <span class="small muted">(saved on the client, used by every report)</span></h2>
    <div class="fields">
      <label>Plant name <input name="plant_name"><span class="hint">As on the report, e.g. MoHUP</span></label>
      <label>DC capacity (kWp) <input name="capacity_kwp" inputmode="decimal" required></label>
      <label>Commissioned (month) <input type="month" name="commissioning_month"><span class="hint">Its month is a part-month, left out of the PR average</span></label>
      <label class="wide">Installation type <input name="installation" placeholder="e.g. Rooftop PV on existing carpark metal-sheet roof"></label>
      <label class="wide">Location <input name="location" placeholder="e.g. Muscat, Sultanate of Oman"></label>
    </div>
    <h3 class="spaced-top">Inverters (AC side)</h3>
    <table class="om-rows"><thead><tr><th>From the library</th><th>Model as printed</th><th>Qty</th><th>kW AC each</th><th></th></tr></thead>
      <tbody id="inv-rows"></tbody></table>
    <p class="btns"><button type="button" class="btn small" id="add-inv">Add an inverter model</button><span class="small muted" id="ac-total"></span></p>
  </div>

  <div class="panel">
    <h2>iSolarCloud export</h2>
    <p class="small muted">Download the plant's <b>Monthly report</b> (Annual report) from iSolarCloud as Excel and upload it here. Generation, PR and irradiation are used as iSolarCloud reports them. A newer export replaces the old one; months missing from it come from the client's earlier reports this year.</p>
    <div class="fields">
      <label>Excel file (.xlsx) <input type="file" name="export" accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"><span class="hint" id="export-status"></span></label>
    </div>
  </div>

  <div class="panel">
    <h2>Maintenance this month</h2>
    <p class="small muted">Cleanings and inspections in the report month. Earlier visits this year come from the earlier months' reports.</p>
    <div class="table-scroll"><table class="om-rows"><thead><tr><th>Date</th><th>Activity</th><th>Scope</th><th>Done by</th><th>Checklist ref.</th><th></th></tr></thead>
      <tbody id="log-rows"></tbody></table></div>
    <p class="btns"><button type="button" class="btn small" id="add-log">Add a visit</button></p>
    <div id="earlier-log" class="small muted"></div>
  </div>

  <div class="panel">
    <h2>Cleaning photos</h2>
    <p class="small muted">One before / after pair per cleaning this month.</p>
    <div id="photo-rows"></div>
    <p class="btns"><button type="button" class="btn small" id="add-photo">Add a cleaning</button></p>
  </div>

  <div class="panel">
    <div class="panel-head"><h2>Checklist findings</h2><button type="button" class="btn small" id="checklist">Download the blank site checklist</button></div>
    <p class="small muted">The checklist is printed and filled in on site. Enter only the items marked <b>Not OK</b> here; they go into section 5.3 of the report.</p>
    <div class="table-scroll"><table class="om-rows"><thead><tr><th>Checklist item</th><th>Finding</th><th>Severity</th><th>Action</th><th>Status</th><th></th></tr></thead>
      <tbody id="finding-rows"></tbody></table></div>
    <p class="btns"><button type="button" class="btn small" id="add-finding">Add a Not OK item</button></p>
  </div>
</form>
<div class="panel">
  <h2>Figures <span class="small muted">(recalculated from the inputs)</span></h2>
  <div id="figures"></div>
</div>
<div class="panel">
  <div class="panel-head"><h2>Versions</h2><button type="button" class="btn small" id="package">Download full package (zip)</button></div>
  <p class="small muted">Every generated report is kept here (and in the cloud when you're signed in). The package holds the latest version, the checklist, the Excel export, the photos and the inputs.</p>
  <div id="versions"></div>
</div>`;

  const f = main.querySelector("#om");
  const E = f.elements;
  let exportMonths = r.export_months || {}, exportFileId = r.export_file_id, exportName = r.export_name;
  let pendingExport = null;  // { blob, name } until saved
  const photos = (r.cleaning_photos || []).map((p) => ({ ...p }));

  // --- site fields follow the chosen client
  const fillSite = () => {
    const c = clientOf(Number(E.client_id.value));
    const om = { ...NEW_SITE, ...(c?.om || {}) };
    E.plant_name.value = om.plant_name || ""; E.plant_name.placeholder = c?.name || "";
    E.capacity_kwp.value = g(om.capacity_kwp ?? (c?.required_capacity_unit === "dc" ? c.required_capacity_kw : ""));
    E.commissioning_month.value = om.commissioning_month || "";
    E.installation.value = om.installation || (c?.installation_types || []).join(" / ");
    E.location.value = om.location || "";
    main.querySelector("#inv-rows").innerHTML = (om.inverters?.length ? om.inverters : [{}]).map((i) => String(rowInverter(i, all.inverters))).join("");
  };
  const showNewClient = () => { main.querySelector("#new-client").hidden = E.client_id.value !== "new"; };
  E.client_id.addEventListener("change", () => { showNewClient(); fillSite(); refresh(); });
  showNewClient(); fillSite();

  // --- rows
  const addRows = (sel2, rows) => { main.querySelector(sel2).insertAdjacentHTML("beforeend", rows); };
  addRows("#log-rows", (r.maintenance_log.length ? r.maintenance_log : []).map((e) => String(rowLog(e))).join(""));
  addRows("#finding-rows", r.findings.map((x) => String(rowFinding(x))).join(""));
  main.querySelector("#add-log").addEventListener("click", () => { addRows("#log-rows", String(rowLog({ date: "", activity: "Module cleaning" }))); refresh(); });
  main.querySelector("#add-finding").addEventListener("click", () => addRows("#finding-rows", String(rowFinding())));
  main.querySelector("#add-inv").addEventListener("click", () => addRows("#inv-rows", String(rowInverter({}, all.inverters))));
  main.addEventListener("click", (e) => {
    const b = e.target.closest("[data-remove]");
    if (b) { b.closest("tr").remove(); refresh(); }
  });
  main.querySelector("#inv-rows").addEventListener("change", (e) => {
    if (e.target.name !== "inv_id") return;
    const v = all.inverter.get(Number(e.target.value)), tr = e.target.closest("tr");
    if (v) { tr.querySelector('[name="inv_model"]').value = `${v.make} ${v.model}`; tr.querySelector('[name="inv_kw"]').value = g(v.ac_kw); }
    refresh();
  });

  // --- photos
  const drawPhotos = () => {
    main.querySelector("#photo-rows").innerHTML = photos.map((p, i) => String(html`<div class="fields om-photo" data-i="${i}">
      <label>Cleaning date <input type="date" data-pdate value="${p.date || ""}"></label>
      ${["before", "after"].map((k) => html`<label>${k === "before" ? "Before" : "After"} cleaning <input type="file" accept="image/*" data-pfile="${k}">
        <span class="hint" data-pthumb="${k}"></span></label>`)}
      <div><button type="button" class="btn small" data-premove>Remove</button></div></div>`)).join("")
      || String(html`<div class="small muted">No cleaning photos this month.</div>`);
    main.querySelectorAll(".om-photo").forEach(async (row) => {
      const p = photos[Number(row.dataset.i)];
      for (const k of ["before", "after"]) {
        const rec = await db.getFile(p[`${k}_id`]);
        row.querySelector(`[data-pthumb="${k}"]`).innerHTML = rec ? String(html`<img class="stamp-preview" src="${fileUrl(rec)}" alt="">`) : "No photo yet";
      }
    });
  };
  drawPhotos();
  main.querySelector("#add-photo").addEventListener("click", () => {
    const visit = collectLog().find(isCleaning);
    photos.push({ date: visit?.date || "", before_id: null, after_id: null });
    drawPhotos();
  });
  main.querySelector("#photo-rows").addEventListener("change", async (e) => {
    const row = e.target.closest(".om-photo"); if (!row) return;
    const p = photos[Number(row.dataset.i)];
    if (e.target.matches("[data-pdate]")) { p.date = e.target.value; return; }
    const k = e.target.dataset.pfile, file = e.target.files?.[0];
    if (!k || !file) return;
    const img = await readImage(file, 1800);
    p[`${k}_id`] = await db.putFile(img.blob, file.name, { width: img.width, height: img.height, kind: "om_photo" });
    drawPhotos();
  });
  main.querySelector("#photo-rows").addEventListener("click", (e) => {
    const row = e.target.closest(".om-photo");
    if (row && e.target.matches("[data-premove]")) { photos.splice(Number(row.dataset.i), 1); drawPhotos(); }
  });

  // --- export upload
  const exportStatus = main.querySelector("#export-status");
  const showExport = (extra = "") => {
    const ks = Object.keys(exportMonths).sort();
    exportStatus.innerHTML = ks.length ? String(html`<span class="ok-text">${exportName || "Export"}</span>: ${ks.length} month(s), ${monthName(ks[0])} – ${monthName(ks[ks.length - 1])}`) + extra
      : "No export uploaded yet";
  };
  showExport();
  E.export.addEventListener("change", async () => {
    const file = E.export.files[0];
    if (!file) return;
    exportStatus.textContent = "Reading…";
    try {
      const { readExport } = await import("../om/xlsx.js");
      const exp = await readExport(await file.arrayBuffer());
      exportMonths = exp.months; exportName = file.name;
      pendingExport = { blob: file, name: file.name };
      const plant = (E.plant_name.value || E.plant_name.placeholder || "").trim();
      const warn = exp.plant && plant && exp.plant.toLowerCase() !== plant.toLowerCase()
        ? String(html` <span class="missing-text">The file is for plant "${exp.plant}", not "${plant}".</span>`) : "";
      if (!E.plant_name.value && exp.plant) E.plant_name.value = exp.plant;
      const ks = Object.keys(exp.months).sort();
      if (!params.id && ks.length && !reports.some((x) => x.client_id === Number(E.client_id.value) && x.report_month === ks[ks.length - 1])) E.report_month.value = ks[ks.length - 1];
      showExport(warn);
      refresh();
    } catch (err) {
      console.error(err);
      exportStatus.innerHTML = String(html`<span class="missing-text">${err.message}</span>`);
    }
  });

  // --- collecting the form
  function collectLog() {
    return [...main.querySelectorAll(".log-row")].map((tr) => ({
      date: tr.querySelector('[name="log_date"]').value, activity: tr.querySelector('[name="log_activity"]').value,
      scope: tr.querySelector('[name="log_scope"]').value.trim(), by: tr.querySelector('[name="log_by"]').value.trim(),
      ref: tr.querySelector('[name="log_ref"]').value.trim(),
    })).filter((e) => e.date);
  }
  function collectSite() {
    return {
      plant_name: E.plant_name.value.trim(), capacity_kwp: Number(String(E.capacity_kwp.value).replace(/,/g, "")) || null,
      commissioning_month: E.commissioning_month.value, installation: E.installation.value.trim(), location: E.location.value.trim(),
      inverters: [...main.querySelectorAll(".inv-row")].map((tr) => ({
        inverter_id: Number(tr.querySelector('[name="inv_id"]').value) || null,
        model: tr.querySelector('[name="inv_model"]').value.trim(),
        qty: Number(tr.querySelector('[name="inv_qty"]').value) || 1,
        ac_kw: Number(tr.querySelector('[name="inv_kw"]').value) || null,
      })).filter((i) => i.model || i.inverter_id),
    };
  }
  function collect() {
    return {
      ...r,
      client_id: Number(E.client_id.value) || null,
      report_month: E.report_month.value, report_date: E.report_date.value, prepared_by: E.prepared_by.value.trim(),
      report_no: E.report_no.value.trim(),
      export_months: exportMonths, export_file_id: exportFileId, export_name: exportName,
      maintenance_log: collectLog(),
      cleaning_photos: photos.filter((p) => p.before_id || p.after_id || p.date),
      findings: [...main.querySelectorAll(".finding-row")].map((tr) => ({
        item_no: tr.querySelector('[name="f_item"]').value, finding: tr.querySelector('[name="f_finding"]').value.trim(),
        severity: tr.querySelector('[name="f_severity"]').value, action: tr.querySelector('[name="f_action"]').value.trim(),
        status: tr.querySelector('[name="f_status"]').value,
      })).filter((x) => x.finding),
    };
  }
  const draftClient = () => {
    const id = Number(E.client_id.value);
    const base = id ? clientOf(id) : { ...NEW_CLIENT, name: E.new_client_name.value.trim() || "New client" };
    return { ...base, om: { ...(base?.om || {}), ...collectSite() } };
  };

  // --- live figures
  function refresh() {
    const cur = collect(), client = draftClient(), site = siteOf(client);
    main.querySelector("#no-hint").textContent = cur.report_no ? "" : `Will be ${reportNo(cur, site)}`;
    const ac = totalAcKw(site);
    main.querySelector("#ac-total").textContent = ac ? `Total ${fmt(ac, 1)} kW AC${site.capacity_kwp ? `, DC/AC ${fmt(site.capacity_kwp / ac, 2)}` : ""}` : "";
    const earlier = earlierInYear(cur, reports).flatMap((x) => x.maintenance_log || []);
    main.querySelector("#earlier-log").textContent = earlier.length ? `Earlier this year: ${earlier.map((e) => `${fmtDate(e.date)} ${e.activity.toLowerCase()}`).join("; ")}.` : "";
    const calc = compute(cur, site, reports);
    const box = main.querySelector("#figures");
    if (!calc.months.length) { box.innerHTML = String(html`<div class="small muted">${calc.problems[0] || "Upload the iSolarCloud export to see the figures."}</div>`); return; }
    const t = calc.totals;
    box.innerHTML = String(html`
      ${calc.problems.map((p) => html`<div class="flash warn">${p}</div>`)}
      <div class="table-scroll"><table>
      <thead><tr><th>Month</th><th class="r">Generation (kWh)</th><th class="r">Irradiation (kWh/m²)</th><th class="r">PR (%)</th><th class="r">kWh/kWp</th><th class="r">Cumulative (kWh)</th><th class="r">CO₂ (t)</th><th class="r">Trees</th></tr></thead>
      <tbody>${calc.months.map((d) => html`<tr class="${d.key === cur.report_month ? "om-current" : ""}"><td>${d.label} ${d.y}${d.partial ? " *" : d.mtd ? " †" : ""}</td>
        <td class="r num">${fmt(d.energy)}</td><td class="r num">${d.irr !== null ? fmt(d.irr) : "n/a"}</td><td class="r num">${d.pr !== null ? fmt(d.pr) : "n/a"}</td>
        <td class="r num">${d.sy !== null ? fmt(d.sy) : "—"}</td><td class="r num">${fmt(d.cum)}</td><td class="r num">${fmt(d.co2 / 1000, 2)}</td><td class="r num">${fmt(d.trees, 0)}</td></tr>`)}
      <tr class="om-total"><td>Year to date</td><td class="r num">${fmt(t.energy)}</td><td class="r num">${fmt(t.irr)}</td><td class="r num">${t.pr !== null ? fmt(t.pr) : "n/a"}</td>
        <td class="r num">${t.sy !== null ? fmt(t.sy) : "—"}</td><td class="r num">${fmt(t.energy)}</td><td class="r num">${fmt(t.co2 / 1000, 2)}</td><td class="r num">${fmt(t.trees, 0)}</td></tr></tbody>
      </table></div>
      <p class="small muted">YTD PR is the energy-weighted average of the monthly PRs${calc.months[0].partial ? ", leaving out the commissioning month (*)" : ""}. CO₂ at 0.49 kg/kWh; trees at 21.77 kg CO₂ per tree per year.</p>`);
  }
  f.addEventListener("input", refresh);
  f.addEventListener("change", refresh);
  refresh();

  // --- versions
  const drawVersions = () => {
    const vs = [...(r.versions || [])].reverse();
    main.querySelector("#versions").innerHTML = vs.length ? String(html`<table><thead><tr><th>Version</th><th>Generated</th><th class="r">Month (kWh)</th><th class="r">YTD (kWh)</th><th class="r">YTD PR (%)</th><th></th></tr></thead>
      <tbody>${vs.map((v) => html`<tr><td>v${v.n}</td><td class="small">${new Date(v.created_at).toLocaleString("en-GB", { dateStyle: "medium", timeStyle: "short" })}</td>
        <td class="r num">${v.summary ? fmt(v.summary.month_kwh) : "—"}</td><td class="r num">${v.summary ? fmt(v.summary.ytd_kwh) : "—"}</td>
        <td class="r num">${v.summary?.ytd_pr != null ? fmt(v.summary.ytd_pr) : "—"}</td>
        <td class="r"><button class="btn small" data-version="${v.n}">Word</button></td></tr>`)}</tbody></table>`)
      : String(html`<div class="small muted">No report generated yet.</div>`);
  };
  drawVersions();
  main.querySelector("#versions").addEventListener("click", (e) => {
    const b = e.target.closest("[data-version]"); if (!b) return;
    busy(b, async () => {
      const v = r.versions.find((x) => x.n === Number(b.dataset.version)), file = await db.getFile(v.report_file_id);
      if (!file) throw new Error("That version's file isn't in this browser yet. Sync with the cloud and try again.");
      download(file.blob, v.report_name || file.name);
    });
  });

  // --- saving
  async function save() {
    if (!f.reportValidity()) throw new Error("Fill in the highlighted fields first.");
    const rec = collect();
    let client;
    if (E.client_id.value === "new") {
      const name = E.new_client_name.value.trim();
      if (!name) throw new Error("Type the new client's name.");
      const id = await db.put("clients", { ...NEW_CLIENT, client_type: E.new_client_type.value, name, om: collectSite() });
      client = await db.get("clients", id);
      all.client.set(id, client);
      E.client_id.insertAdjacentHTML("afterbegin", String(html`<option value="${id}">${name}</option>`));
      E.client_id.value = String(id); showNewClient();
      rec.client_id = id;
    } else {
      if (!rec.client_id) throw new Error("Choose the client.");
      client = { ...clientOf(rec.client_id), om: collectSite() };
      await db.put("clients", client);
      client = await db.get("clients", rec.client_id);
      all.client.set(client.id, client);
    }
    const twin = reports.find((x) => x.id !== r.id && x.client_id === rec.client_id && x.report_month === rec.report_month);
    if (twin) throw new Error(`There is already a ${monthName(rec.report_month)} report for this client. Open it from the list instead.`);
    if (pendingExport) {
      if (exportFileId) await db.delFile(exportFileId);
      exportFileId = await db.putFile(pendingExport.blob, pendingExport.name, { kind: "om_export" });
      rec.export_file_id = exportFileId; rec.export_name = pendingExport.name;
      pendingExport = null;
    }
    const id = await db.put(STORE, rec);
    r = { ...rec, id, versions: rec.versions || [] };
    const idx = reports.findIndex((x) => x.id === id);
    if (idx >= 0) reports[idx] = r; else reports.push(r);
    return client;
  }

  main.querySelector("#save").addEventListener("click", (e) => busy(e.target, async () => {
    await save();
    toast("Saved.");
    if (!params.id) go(`#/om/${r.id}`);
  }));

  main.querySelector("#generate").addEventListener("click", (e) => busy(e.target, async () => {
    const client = await save();
    const out = await makeReport(r, client, reports);
    const n = (r.versions?.length ? Math.max(...r.versions.map((v) => v.n)) : 0) + 1;
    const name = out.filename.replace(/\.docx$/, ` v${n}.docx`);
    const fileId = await db.putFile(new Blob([out.blob], { type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document" }), name, { kind: "om_report" });
    r.versions = [...(r.versions || []), { n, created_at: new Date().toISOString(), report_file_id: fileId, report_name: name,
      summary: { month_kwh: out.calc.current.energy, ytd_kwh: out.calc.totals.energy, ytd_pr: out.calc.totals.pr } }];
    await db.put(STORE, r);
    download(out.blob, name);
    toast(`Version ${n} saved.`);
    if (!params.id) go(`#/om/${r.id}`); else drawVersions();
  }));

  main.querySelector("#checklist").addEventListener("click", (e) => busy(e.target, async () => {
    const out = await makeChecklist(draftClient());
    download(out.blob, out.filename);
  }));

  main.querySelector("#package").addEventListener("click", (e) => busy(e.target, async () => {
    const client = await save();
    const zip = new globalThis.JSZip();
    const had = await addPackage(zip, r, client);
    if (!had) {
      const out = await makeReport(r, client, reports);
      zip.file(out.filename, out.blob);
    }
    const cl = await makeChecklist(client);
    zip.file(cl.filename, cl.blob);
    download(await zip.generateAsync({ type: "blob" }), `${safe(reportNo(r, siteOf(client)))} - full package.zip`);
  }));

  main.querySelector("#delete")?.addEventListener("click", async () => {
    for (const v of r.versions || []) await db.delFile(v.report_file_id);
    for (const p of r.cleaning_photos || []) { await db.delFile(p.before_id); await db.delFile(p.after_id); }
    await db.delFile(r.export_file_id);
    await db.del(STORE, r.id);
    toast("Report deleted.");
    go("#/om");
  });
}

