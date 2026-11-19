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
import { ACTIVITIES, CHECKLIST, NEW_REPORT, NEW_SITE, SEVERITIES, compute, dateFromFileName, earlierInYear, fileBase, fmt, fmtDate,
         isCleaning, keyOf, matchClient, monthName, reportNo, siteOf, totalAcKw, ym } from "../om/model.js";

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

/** The checklist reference for a month, e.g. MoHUP-CL-2026-11. */
const checklistRef = (r, site) => (r.report_month ? reportNo(r, site).replace("-OM-", "-CL-") : "");

/** The blank site checklist, with the month's reference filled in when there is one. */
async function makeChecklist(client, r = {}) {
  const site = siteOf(client);
  const { buildChecklist } = await import("../om/report.js");
  const ref = checklistRef(r, site);
  const blob = await buildChecklist({ site, letterhead: await letterhead(), ref, month: r.report_month || "" });
  return { blob, filename: `${safe(ref || site.plant_name)} - O&M Site Checklist.docx` };
}

/** Add one month's package to a zip folder: latest report version, checklist, Excel export, photos, inputs. */
async function addPackage(folder, r, client) {
  const site = siteOf(client);
  const latest = (r.versions || [])[r.versions.length - 1];
  const rep = latest ? await db.getFile(latest.report_file_id) : null;
  if (rep?.blob) folder.file(latest.report_name || `${safe(fileBase(r, site))}.docx`, rep.blob);
  const filled = await db.getFile(r.checklist_file_id);
  if (filled?.blob) folder.file(`inputs/${safe(r.checklist?.file_name || filled.name || "site checklist.docx")}`, filled.blob);
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
  const withReports = byName(all.clients.filter((c) => reports.some((r) => r.client_id === c.id)));
  const orphans = reports.filter((r) => !all.client.get(r.client_id));
  const groups = [...withReports.filter((c) => !clientId || c.id === clientId).map((c) => ({ c, rs: reports.filter((r) => r.client_id === c.id) })),
    ...(!clientId && orphans.length ? [{ c: null, rs: orphans }] : [])];
  const rowsOf = (c, rs) => {
    const years = [...new Set(rs.map((r) => r.report_month.slice(0, 4)))].sort().reverse();
    return years.map((y) => html`
      <div class="om-year"><h3>${c ? c.name : "(client deleted)"} · ${y}</h3>
        ${c ? html`<button class="btn small" data-year="${c.id}|${y}">Full package ${y} (zip)</button>` : ""}</div>
      <div class="table-scroll"><table>
      <thead><tr><th>Month</th><th>Report no.</th><th class="r">Month (kWh)</th><th class="r">Year to date (kWh)</th><th class="r">YTD PR (%)</th><th>Checklist</th><th class="r">Versions</th><th>Last generated</th><th></th></tr></thead>
      <tbody>${rs.filter((r) => r.report_month.startsWith(y)).sort((a, b) => b.report_month.localeCompare(a.report_month)).map((r) => {
        const site = siteOf(c), v = (r.versions || [])[r.versions.length - 1];
        return html`<tr>
          <td><a href="#/om/${r.id}"><b>${monthName(r.report_month)}</b></a></td>
          <td class="small">${r.report_no || reportNo(r, site)}</td>
          <td class="r num">${v?.summary ? num(v.summary.month_kwh, 1) : "—"}</td>
          <td class="r num">${v?.summary ? num(v.summary.ytd_kwh, 1) : "—"}</td>
          <td class="r num">${v?.summary?.ytd_pr != null ? num(v.summary.ytd_pr, 1) : "—"}</td>
          <td class="small">${r.checklist ? html`<span class="ok-text">✓ ${r.checklist.ref || "uploaded"}</span>` : html`<span class="muted">—</span>`}</td>
          <td class="r num">${(r.versions || []).length}</td>
          <td class="muted small">${v ? shortDate(v.created_at) : "not generated yet"}</td>
          <td class="r nowrap"><a class="btn small" href="#/om/${r.id}">Open</a> ${v ? html`<button class="btn small" data-latest="${r.id}" title="${v.report_name}">Word v${v.n}</button>` : ""}</td></tr>`;
      })}</tbody>
      </table></div>`);
  };
  main.innerHTML = html`
<div class="head">
  <div><h1>O&amp;M reports</h1><div class="muted">Monthly operation &amp; maintenance reports on the HTC letterhead, cumulative for the calendar year, from the iSolarCloud Excel export. Every month's report is saved here with all its versions.</div></div>
  <div class="actions"><a class="btn primary" href="#/om/new${clientId ? `?client_id=${clientId}` : ""}">New O&amp;M report</a></div>
</div>
<div class="panel">
  <div class="panel-head"><h2>Saved reports by client and month</h2>
    ${withReports.length > 1 ? html`<label class="small">Client <select id="filter"><option value="">All clients</option>${withReports.map((c) => html`<option value="${c.id}" ${sel(c.id === clientId)}>${c.name}</option>`)}</select></label>` : ""}
  </div>
  ${groups.length ? html`${groups.flatMap((x) => rowsOf(x.c, x.rs))}
  <p class="small muted spaced-top">Open a month to see or download any earlier version, change its inputs or generate it again. A full package holds every month's latest report, Excel export, filled checklist, photos and inputs for the year.</p>`
  : html`<div class="empty">No O&amp;M reports yet. <a href="#/om/new">Make the first one</a>: start by uploading the iSolarCloud monthly report.</div>`}
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

const DEFAULT_ACTIVITY = ACTIVITIES[0];   // "Cleaning and general inspection", the usual visit

const rowLog = (e = {}) => html`<tr class="log-row">
  <td><input type="date" name="log_date" value="${e.date || ""}"></td>
  <td><select name="log_activity">${[...new Set([...ACTIVITIES, e.activity].filter(Boolean))].map((a) => html`<option ${sel(a === (e.activity || DEFAULT_ACTIVITY))}>${a}</option>`)}</select></td>
  <td><input name="log_scope" value="${e.scope || ""}" placeholder="e.g. All module rows"></td>
  <td><input name="log_by" value="${e.by || ""}" placeholder="O&amp;M team"></td>
  <td><input name="log_ref" value="${e.ref || ""}" placeholder="Checklist ref."></td>
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

/** Months from `start` to `end` ("YYYY-MM"), inclusive. */
function monthsBetween(start, end) {
  const out = [];
  for (let { y, m } = ym(start); keyOf(y, m) <= end && out.length < 24; m === 12 ? (y++, m = 1) : m++) out.push(keyOf(y, m));
  return out;
}

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
    const prev = byUpdated(reports.filter((x) => x.client_id === r.client_id))[0];
    if (prev) r.prepared_by = prev.prepared_by || "";
  }
  const isNew = !params.id;
  const clients = byName(all.clients);
  const clientOf = (id) => all.client.get(id) || null;
  setTitle(isNew ? "New O&M report" : `O&M report · ${monthName(r.report_month)}`);

  main.innerHTML = html`
<div class="head">
  <div><h1 id="title">${isNew ? "New O&M report" : `${clientOf(r.client_id)?.name || "O&M report"} · ${monthName(r.report_month)}`}</h1>
    <div class="muted"><a href="#/om">O&amp;M reports</a> · monthly report, cumulative for the calendar year, on the HTC letterhead.</div></div>
  <div class="actions">${isNew ? "" : html`<button class="btn danger small" id="delete" data-confirm="Delete this month's report, its versions and its inputs?">Delete</button>`}
    <button class="btn" id="save" type="button">Save</button>
    <button class="btn primary" id="generate" type="button">Save and generate report</button></div>
</div>
<form id="om" autocomplete="off">
  <div class="panel om-start">
    <h2>1. iSolarCloud export${isNew ? " (start here)" : ""}</h2>
    <p class="small muted">Download the plant's <b>Monthly report</b> from iSolarCloud as Excel and upload it here. The client, report month, report date and file name are taken from it; check them below. Generation, PR and irradiation are used as iSolarCloud reports them, and can be corrected in the figures table at the bottom.</p>
    <div class="fields">
      <label class="wide">Excel file (.xlsx) <input type="file" name="export" accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"><span class="hint" id="export-status"></span></label>
    </div>
    <div id="pulled"></div>
  </div>

  <div class="panel">
    <h2>2. Client and month</h2>
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
    <div class="small spaced-top" id="client-reports"></div>
  </div>

  <div class="panel" id="site-panel">
    <h2>3. Plant details <span class="small muted">(saved on the client, used by every report)</span></h2>
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
    <h2>4. Site checklist</h2>
    <p class="small muted">Download the checklist, fill it in on site or on the computer (click the boxes to tick them, type remarks, cleaning record and defects), then upload the filled file here. Its visit, cleaning record, Not OK items, defects and remarks go into section 5 of the report.</p>
    <div class="fields">
      <div><button type="button" class="btn" id="checklist">Download the checklist (Word)</button><div class="hint" id="cl-ref"></div></div>
      <label>Upload the filled checklist (.docx) <input type="file" name="checklist_file" accept=".docx,application/vnd.openxmlformats-officedocument.wordprocessingml.document"></label>
    </div>
    <div id="checklist-status" class="spaced-top"></div>
  </div>

  <div class="panel">
    <h2>5. Maintenance this month</h2>
    <p class="small muted">Visits in the report month (filled in from the checklist when you upload it). Earlier visits this year come from the earlier months' reports.</p>
    <div class="table-scroll"><table class="om-rows"><thead><tr><th>Date</th><th>Activity</th><th>Scope</th><th>Done by</th><th>Checklist ref.</th><th></th></tr></thead>
      <tbody id="log-rows"></tbody></table></div>
    <p class="btns"><button type="button" class="btn small" id="add-log">Add a visit</button></p>
    <div id="earlier-log" class="small muted"></div>
  </div>

  <div class="panel">
    <h2>6. Cleaning photos</h2>
    <p class="small muted">One before / after pair per cleaning this month.</p>
    <div id="photo-rows"></div>
    <p class="btns"><button type="button" class="btn small" id="add-photo">Add a cleaning</button></p>
  </div>

  <div class="panel">
    <h2>7. Findings (Not OK items and defects)</h2>
    <p class="small muted">Filled in from the checklist's Not OK items and Defects table; add or change any here. They go into section 5.3 of the report.</p>
    <div class="table-scroll"><table class="om-rows"><thead><tr><th>Checklist item</th><th>Finding</th><th>Severity</th><th>Action</th><th>Status</th><th></th></tr></thead>
      <tbody id="finding-rows"></tbody></table></div>
    <p class="btns"><button type="button" class="btn small" id="add-finding">Add a finding</button></p>
  </div>
</form>
<div class="panel">
  <h2>Figures <span class="small muted">(from the Excel sheet; type over a value to correct it)</span></h2>
  <div id="figures"></div>
</div>
<div class="panel">
  <div class="panel-head"><h2>Saved versions of this month's report</h2><button type="button" class="btn small" id="package">Download full package (zip)</button></div>
  <p class="small muted">Every generated report is kept here (and in the cloud when you're signed in), so this month's report can be downloaded again later. The package holds the latest version, the filled checklist, the Excel export, the photos and the inputs.</p>
  <div id="versions"></div>
</div>`;

  const f = main.querySelector("#om");
  const E = f.elements;
  let exportMonths = r.export_months || {}, exportFileId = r.export_file_id, exportName = r.export_name;
  let pendingExport = null;      // { blob, name } until saved
  let checklist = r.checklist || null, checklistFileId = r.checklist_file_id || null;
  let pendingChecklist = null;   // { blob, name } until saved
  let removedChecklist = null;   // file id to delete on save
  const figures = JSON.parse(JSON.stringify(r.figures || {}));
  const photos = (r.cleaning_photos || []).map((p) => ({ ...p }));

  // --- site fields follow the chosen client
  const fillSite = () => {
    const c = clientOf(Number(E.client_id.value));
    const om = { ...NEW_SITE, ...(c?.om || {}) };
    const typed = E.client_id.value === "new" ? E.plant_name.value : "";
    E.plant_name.value = om.plant_name || typed || ""; E.plant_name.placeholder = c?.name || "";
    E.capacity_kwp.value = g(om.capacity_kwp ?? (c?.required_capacity_unit === "dc" ? c.required_capacity_kw : ""));
    E.commissioning_month.value = om.commissioning_month || "";
    E.installation.value = om.installation || (c?.installation_types || []).join(" / ");
    E.location.value = om.location || "";
    main.querySelector("#inv-rows").innerHTML = (om.inverters?.length ? om.inverters : [{}]).map((i) => String(rowInverter(i, all.inverters))).join("");
  };
  const showNewClient = () => { main.querySelector("#new-client").hidden = E.client_id.value !== "new"; };
  const pickClient = (id) => {
    E.client_id.value = String(id); showNewClient(); fillSite();
    const prev = byUpdated(reports.filter((x) => x.client_id === Number(id)))[0];
    if (prev && !E.prepared_by.value) E.prepared_by.value = prev.prepared_by || "";
  };
  E.client_id.addEventListener("change", () => { showNewClient(); fillSite(); refresh(); });
  showNewClient(); fillSite();

  // --- rows
  const addRows = (sel2, rows) => { main.querySelector(sel2).insertAdjacentHTML("beforeend", rows); };
  addRows("#log-rows", r.maintenance_log.map((e) => String(rowLog(e))).join(""));
  addRows("#finding-rows", r.findings.map((x) => String(rowFinding(x))).join(""));
  main.querySelector("#add-log").addEventListener("click", () => {
    addRows("#log-rows", String(rowLog({ date: "", activity: DEFAULT_ACTIVITY, ref: checklist?.ref || "" }))); refresh();
  });
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

  // --- export upload: the first input; everything it can tell us is filled in from it
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
      const pulled = [];
      const ks = Object.keys(exp.months).sort();
      // client: from the plant name in the sheet
      if (exp.plant) {
        const chosen = clientOf(Number(E.client_id.value));
        const match = matchClient(exp.plant, clients);
        if (isNew && match && (!chosen || chosen.id !== match.id)) { pickClient(match.id); pulled.push(["Client", `${match.name} (plant "${exp.plant}" in the sheet)`]); }
        else if (isNew && !match && !chosen) {
          E.client_id.value = "new"; showNewClient();
          if (!E.new_client_name.value) E.new_client_name.value = exp.plant;
          pulled.push(["Client", `new client "${exp.plant}" (no saved client has this plant; change the name or pick one from the list)`]);
        } else if (chosen) pulled.push(["Client", chosen.name]);
        if (!E.plant_name.value) E.plant_name.value = exp.plant;
        pulled.push(["Plant name", E.plant_name.value]);
        const plant = E.plant_name.value.trim();
        if (plant && exp.plant.toLowerCase() !== plant.toLowerCase() && chosen) {
          pulled.push(["Check", `the sheet is for plant "${exp.plant}", but this client's plant is "${plant}"`]);
        }
      }
      // month: the latest month with generation; date: from the file name (iSolarCloud stamps it)
      if (ks.length) {
        if (isNew) E.report_month.value = ks[ks.length - 1];
        else if (!exp.months[E.report_month.value]) pulled.push(["Check", `the sheet has no ${monthName(E.report_month.value)} figures`]);
        pulled.push(["Report month", monthName(E.report_month.value)]);
      }
      const d = dateFromFileName(file.name);
      if (d && d.slice(0, 7) >= E.report_month.value) { E.report_date.value = d; pulled.push(["Report date", `${fmtDate(d)} (the export date in the file name)`]); }
      if (exp.year) pulled.push(["Year in the sheet", String(exp.year)]);
      lastPulled = pulled;
      showExport();
      refresh();
    } catch (err) {
      console.error(err);
      exportStatus.innerHTML = String(html`<span class="missing-text">${err.message}</span>`);
    }
  });
  let lastPulled = [];
  const drawPulled = (site, cur) => {
    const box = main.querySelector("#pulled");
    if (!lastPulled.length) { box.innerHTML = ""; return; }
    const name = `${safe(fileBase(cur, site))} v${(cur.versions?.length ? Math.max(...cur.versions.map((v) => v.n)) : 0) + 1}.docx`;
    const twin = reports.find((x) => x.id !== r.id && x.client_id === cur.client_id && x.report_month === cur.report_month);
    box.innerHTML = String(html`<div class="flash ok spaced-top"><b>Taken from the Excel sheet</b>
      <ul class="tight">${lastPulled.map(([k, v]) => html`<li>${k}: ${v}</li>`)}
        <li>Report no.: ${cur.report_no || reportNo(cur, site)}</li><li>File name: ${name}</li></ul></div>
      ${twin ? html`<div class="flash warn">There is already a ${monthName(cur.report_month)} report for this client. <a href="#/om/${twin.id}">Open it</a> to add a new version instead.</div>` : ""}`);
  };

  // --- checklist upload
  const drawChecklist = () => {
    const box = main.querySelector("#checklist-status");
    if (!checklist) { box.innerHTML = String(html`<div class="small muted">No filled checklist uploaded for this month.</div>`); return; }
    const n = { OK: 0, "Not OK": 0, "N/A": 0 };
    for (const it of checklist.items || []) if (it.status in n) n[it.status]++;
    const blank = (checklist.items || []).length - n.OK - n["Not OK"] - n["N/A"];
    const remarks = (checklist.items || []).filter((it) => it.remarks).length;
    box.innerHTML = String(html`<div class="flash ok"><b>Filled checklist: ${checklist.file_name || "uploaded"}</b>
      <ul class="tight">
        <li>Ref. ${checklist.ref || "—"} · visit ${checklist.visit_date ? fmtDate(checklist.visit_date) : "date not filled in"}${checklist.visit_type ? ` (${checklist.visit_type.toLowerCase()})` : ""} · inspected by ${checklist.inspected_by || "—"}</li>
        <li>${n.OK} OK, ${n["Not OK"]} Not OK, ${n["N/A"]} N/A${blank ? html`, <span class="missing-text">${blank} not ticked</span>` : ""}; ${remarks} item(s) with remarks</li>
        <li>${(checklist.cleaning || []).length} cleaning record(s), ${(checklist.defects || []).length} defect(s)</li></ul>
      <button type="button" class="btn small" id="cl-download">Download the uploaded file</button> <button type="button" class="btn small" id="cl-remove">Remove</button></div>`);
  };
  drawChecklist();
  E.checklist_file.addEventListener("change", async () => {
    const file = E.checklist_file.files[0];
    if (!file) return;
    const box = main.querySelector("#checklist-status");
    box.innerHTML = String(html`<div class="small muted">Reading…</div>`);
    try {
      const { readChecklist, fromChecklist } = await import("../om/checklist.js");
      const month = E.report_month.value;
      const cl = await readChecklist(await file.arrayBuffer(), month);
      checklist = { ...cl, file_name: file.name };
      pendingChecklist = { blob: file, name: file.name };
      const got = fromChecklist(checklist, month);
      // visits into the maintenance rows (a date already there is left as it is)
      const have = new Set(collectLog().map((e) => e.date));
      for (const v of got.visits) if (!have.has(v.date)) addRows("#log-rows", String(rowLog(v)));
      // findings: Not OK items and defects, without repeating rows already there
      const rows = [...main.querySelectorAll(".finding-row")].map((tr) => `${tr.querySelector('[name="f_item"]').value}|${tr.querySelector('[name="f_finding"]').value.trim().toLowerCase()}`);
      for (const x of got.findings) {
        if (rows.includes(`${x.item_no}|${x.finding.toLowerCase()}`)) continue;
        addRows("#finding-rows", String(rowFinding(x)));
      }
      drawChecklist();
      const msg = [`${got.visits.length} visit(s)`, `${got.findings.length} finding(s)`].join(", ");
      toast(`Checklist read: ${msg} added.${got.outside.length ? ` ${got.outside.length} date(s) outside ${monthName(month)} left out.` : ""}`);
      refresh();
    } catch (err) {
      console.error(err);
      box.innerHTML = String(html`<div class="flash warn">${err.message}</div>`);
    } finally { E.checklist_file.value = ""; }
  });
  main.querySelector("#checklist-status").addEventListener("click", async (e) => {
    if (e.target.id === "cl-remove") {
      if (checklistFileId) removedChecklist = checklistFileId;
      checklist = null; checklistFileId = null; pendingChecklist = null;
      drawChecklist(); refresh();
    } else if (e.target.id === "cl-download") {
      const fl = pendingChecklist?.blob || (await db.getFile(checklistFileId))?.blob;
      if (fl) download(fl, checklist.file_name || "site checklist.docx"); else toast("The file isn't in this browser yet. Sync and try again.", "error");
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
      figures: JSON.parse(JSON.stringify(figures)),
      checklist, checklist_file_id: checklistFileId,
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

  // --- live figures, editable
  const FIELDS = [["energy", "Generation (kWh)", 1], ["irr", "Irradiation (kWh/m²)", 2], ["pr", "PR (%)", 2]];
  function refresh() {
    const cur = collect(), client = draftClient(), site = siteOf(client);
    main.querySelector("#no-hint").textContent = cur.report_no ? "" : `Will be ${reportNo(cur, site)}`;
    main.querySelector("#cl-ref").textContent = cur.report_month ? `Reference ${checklistRef(cur, site)}, for ${monthName(cur.report_month)}` : "";
    const ac = totalAcKw(site);
    main.querySelector("#ac-total").textContent = ac ? `Total ${fmt(ac, 1)} kW AC${site.capacity_kwp ? `, DC/AC ${fmt(site.capacity_kwp / ac, 2)}` : ""}` : "";
    const earlierReports = earlierInYear(cur, reports);
    const earlier = earlierReports.flatMap((x) => x.maintenance_log || []);
    main.querySelector("#earlier-log").textContent = earlier.length ? `Earlier this year: ${earlier.map((e) => `${fmtDate(e.date)} ${e.activity.toLowerCase()}`).join("; ")}.` : "";
    const mine = reports.filter((x) => x.client_id === cur.client_id && x.id !== r.id).sort((a, b) => a.report_month.localeCompare(b.report_month));
    main.querySelector("#client-reports").innerHTML = mine.length ? String(html`<span class="muted">Saved reports for this client:</span> ${mine.map((x, i) => html`${i ? " · " : ""}<a href="#/om/${x.id}">${monthName(x.report_month)}</a>`)}`) : "";
    drawPulled(site, cur);

    const calc = compute(cur, site, reports);
    const base = compute({ ...cur, figures: {} }, site, reports.map((x) => (x.id === r.id ? { ...x, figures: {} } : x)));
    const box = main.querySelector("#figures");
    if (!calc.period) { box.innerHTML = String(html`<div class="small muted">${calc.problems[0] || "Upload the iSolarCloud export to see the figures."}</div>`); return; }
    const byKey = new Map(calc.months.map((d) => [d.key, d])), baseKey = new Map(base.months.map((d) => [d.key, d]));
    const keys = monthsBetween(calc.period.start, calc.period.end);
    const t = calc.totals;
    const input = (key, k, dp) => {
      const d = byKey.get(key), set = figures[key]?.[k] !== undefined && figures[key]?.[k] !== "";
      const v = set ? figures[key][k] : d?.[k] ?? baseKey.get(key)?.[k];
      const was = baseKey.get(key)?.[k];
      return html`<input class="fig ${set ? "om-edited" : ""}" data-key="${key}" data-k="${k}" inputmode="decimal" value="${v === null || v === undefined ? "" : Number(Number(v).toFixed(dp))}"
        title="${set ? `Corrected by hand; the Excel sheet says ${was === null || was === undefined ? "nothing" : fmt(was, dp)}` : "From the Excel sheet; type to correct"}">`;
    };
    box.innerHTML = String(html`
      ${calc.problems.map((p) => html`<div class="flash warn">${p}</div>`)}
      <div class="table-scroll"><table class="om-figures">
      <thead><tr><th>Month</th>${FIELDS.map(([, l]) => html`<th class="r">${l}</th>`)}<th class="r">kWh/kWp</th><th class="r">Cumulative (kWh)</th><th class="r">CO₂ (t)</th><th class="r">Trees</th><th></th></tr></thead>
      <tbody>${keys.map((key) => {
        const d = byKey.get(key), { y } = ym(key);
        return html`<tr class="${key === cur.report_month ? "om-current" : ""}"><td>${d ? d.label : monthName(key).slice(0, 3)} ${y}${d?.partial ? " *" : d?.mtd ? " †" : ""}${d ? "" : html` <span class="missing-text small">missing</span>`}</td>
          ${FIELDS.map(([k, , dp]) => html`<td class="r">${input(key, k, dp)}</td>`)}
          <td class="r num">${d?.sy != null ? fmt(d.sy) : "—"}</td><td class="r num">${d ? fmt(d.cum) : "—"}</td><td class="r num">${d ? fmt(d.co2 / 1000, 2) : "—"}</td><td class="r num">${d ? fmt(d.trees, 0) : "—"}</td>
          <td>${figures[key] && Object.keys(figures[key]).length ? html`<button type="button" class="btn small" data-reset="${key}" title="Back to the Excel sheet's values">Reset</button>` : ""}</td></tr>`;
      })}
      ${t ? html`<tr class="om-total"><td>Year to date</td><td class="r num">${fmt(t.energy)}</td><td class="r num">${fmt(t.irr)}</td><td class="r num">${t.pr !== null ? fmt(t.pr) : "n/a"}</td>
        <td class="r num">${t.sy !== null ? fmt(t.sy) : "—"}</td><td class="r num">${fmt(t.energy)}</td><td class="r num">${fmt(t.co2 / 1000, 2)}</td><td class="r num">${fmt(t.trees, 0)}</td><td></td></tr>` : ""}</tbody>
      </table></div>
      <p class="small muted">Values in yellow were typed over the Excel sheet and are noted in the report. YTD PR is the energy-weighted average of the monthly PRs${calc.months[0]?.partial ? ", leaving out the commissioning month (*)" : ""}. CO₂ at 0.49 kg/kWh; trees at 21.77 kg CO₂ per tree per year.</p>`);
  }
  const figBox = main.querySelector("#figures");
  figBox.addEventListener("change", (e) => {
    const inp = e.target.closest("input.fig"); if (!inp) return;
    const { key, k } = inp.dataset;
    const raw = inp.value.replace(/,/g, "").trim();
    const calcBase = compute({ ...collect(), figures: {} }, siteOf(draftClient()), reports.map((x) => (x.id === r.id ? { ...x, figures: {} } : x)));
    const was = calcBase.months.find((d) => d.key === key)?.[k];
    const v = raw === "" ? null : Number(raw);
    if (raw !== "" && !Number.isFinite(v)) { toast("Type a number.", "error"); return; }
    figures[key] = { ...(figures[key] || {}) };
    const same = v === null ? true : (was !== null && was !== undefined && Math.abs(v - was) < 0.005);
    if (same) delete figures[key][k]; else figures[key][k] = v;
    if (!Object.keys(figures[key]).length) delete figures[key];
    // keep the cursor where it went (Tab / click) after the table is redrawn
    requestAnimationFrame(() => {
      const a = document.activeElement, at = a?.matches?.("input.fig") ? [a.dataset.key, a.dataset.k] : null;
      refresh();
      if (at) figBox.querySelector(`input.fig[data-key="${at[0]}"][data-k="${at[1]}"]`)?.focus();
    });
  });
  figBox.addEventListener("keydown", (e) => { if (e.key === "Enter" && e.target.matches("input.fig")) { e.preventDefault(); e.target.blur(); } });
  figBox.addEventListener("click", (e) => {
    const b = e.target.closest("[data-reset]"); if (!b) return;
    delete figures[b.dataset.reset]; refresh();
  });
  f.addEventListener("input", refresh);
  f.addEventListener("change", refresh);
  refresh();

  // --- versions
  const drawVersions = () => {
    const vs = [...(r.versions || [])].reverse();
    main.querySelector("#versions").innerHTML = vs.length ? String(html`<table><thead><tr><th>Version</th><th>Generated</th><th>File</th><th class="r">Month (kWh)</th><th class="r">YTD (kWh)</th><th class="r">YTD PR (%)</th><th></th></tr></thead>
      <tbody>${vs.map((v) => html`<tr><td>v${v.n}</td><td class="small">${new Date(v.created_at).toLocaleString("en-GB", { dateStyle: "medium", timeStyle: "short" })}</td>
        <td class="small">${v.report_name || ""}</td>
        <td class="r num">${v.summary ? fmt(v.summary.month_kwh) : "—"}</td><td class="r num">${v.summary ? fmt(v.summary.ytd_kwh) : "—"}</td>
        <td class="r num">${v.summary?.ytd_pr != null ? fmt(v.summary.ytd_pr) : "—"}</td>
        <td class="r"><button class="btn small" data-version="${v.n}">Word</button></td></tr>`)}</tbody></table>`)
      : String(html`<div class="small muted">No report generated yet. "Save and generate report" makes version 1 and keeps it here.</div>`);
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
      all.client.set(id, client); clients.push(client);
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
    if (removedChecklist) { await db.delFile(removedChecklist); removedChecklist = null; }
    if (pendingChecklist) {
      if (checklistFileId) await db.delFile(checklistFileId);
      checklistFileId = await db.putFile(pendingChecklist.blob, pendingChecklist.name, { kind: "om_checklist" });
      pendingChecklist = null;
    }
    rec.checklist_file_id = checklistFileId;
    const id = await db.put(STORE, rec);
    r = { ...rec, id, versions: rec.versions || [] };
    const idx = reports.findIndex((x) => x.id === id);
    if (idx >= 0) reports[idx] = r; else reports.push(r);
    return client;
  }

  main.querySelector("#save").addEventListener("click", (e) => busy(e.target, async () => {
    await save();
    toast("Saved.");
    if (isNew) go(`#/om/${r.id}`);
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
    if (isNew) go(`#/om/${r.id}`); else drawVersions();
  }));

  main.querySelector("#checklist").addEventListener("click", (e) => busy(e.target, async () => {
    const out = await makeChecklist(draftClient(), collect());
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
    const cl = await makeChecklist(client, r);
    zip.file(cl.filename, cl.blob);
    download(await zip.generateAsync({ type: "blob" }), `${safe(reportNo(r, siteOf(client)))} - full package.zip`);
  }));

  main.querySelector("#delete")?.addEventListener("click", async () => {
    for (const v of r.versions || []) await db.delFile(v.report_file_id);
    for (const p of r.cleaning_photos || []) { await db.delFile(p.before_id); await db.delFile(p.after_id); }
    await db.delFile(r.export_file_id);
    await db.delFile(r.checklist_file_id);
    await db.del(STORE, r.id);
    toast("Report deleted.");
    go("#/om");
  });
}
