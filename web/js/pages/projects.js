import { capitalize, chk, download, fileUrl, fkey, float, g, go, html, int, num, readImage, sel, str, toast } from "../ui.js";
import * as db from "../store.js";
import { above11kw, acKw, byName, byUpdated, dcAcRatio, dcKwp, full, loadAll, projectCheck, settingsFor } from "../data.js";
import { CONNECTION_TYPES, MOUNTING_TYPES, PREMISES_TYPES, PROJECT_STATUSES } from "../lists.js";
import { inverterLabel, moduleLabel } from "../equipment_fields.js";
import { DOCS, missingFields } from "../docgen/context.js";
import { generate, generateOffer, generatePack } from "../docgen/generate.js";
import { offerMissing, parseMonthly } from "../offer/values.js";
import { blocked, fails, unknown, warnings } from "../sizing/engine.js";
import { inverterOptions, moduleOptions, partyOptions } from "../options.js";
import { pill } from "./sizing.js";
import { setTitle } from "../app.js";

const notFound = (main) => { main.innerHTML = `<div class="panel empty">Project not found. <a href="#/projects">All projects</a></div>`; };

// ---- list ------------------------------------------------------------------------------

export async function list(main, { query }) {
  setTitle("Projects");
  const all = await loadAll();
  const q = (query.q || "").toLowerCase(), status = query.status || "";
  const rows = byUpdated(all.projects).map(all.full).filter((p) =>
    (!q || [p.name, p.client?.name, p.account_no].some((v) => (v || "").toLowerCase().includes(q))) &&
    (!status || p.status === status));
  main.innerHTML = html`
<div class="head">
  <div><h1>Projects</h1><div class="muted">One project per system / account. Documents are generated from here.</div></div>
  <div class="actions"><a class="btn primary" href="#/projects/new">New project</a></div>
</div>
<form class="search" id="search">
  <input name="q" value="${query.q || ""}" placeholder="Search project, client, account no.">
  <select name="status"><option value="">All statuses</option>${PROJECT_STATUSES.map((st) => html`<option ${sel(st === status)}>${st}</option>`)}</select>
  <button class="btn">Filter</button>
</form>
<div class="panel">
  ${rows.length ? html`<table>
    <thead><tr><th>Project</th><th>Client</th><th>Account</th><th class="r">DC kWp</th><th class="r">AC kW</th><th>Status</th></tr></thead>
    <tbody>${rows.map((p) => html`<tr><td><a href="#/projects/${p.id}">${p.name}</a></td><td>${p.client?.name}</td><td class="num">${p.account_no}</td>
      <td class="r num">${num(dcKwp(p))}</td><td class="r num">${num(acKw(p))}</td><td><span class="pill">${p.status}</span></td></tr>`)}</tbody>
  </table>` : html`<div class="empty">No projects found.</div>`}
</div>`;
  main.querySelector("#search").addEventListener("submit", (e) => {
    e.preventDefault();
    go("#/projects?" + new URLSearchParams(new FormData(e.target)).toString());
  });
}

// ---- form ------------------------------------------------------------------------------

export const NEW_PROJECT = {
  inverter_qty: 1, phases: 3, vat_pct: 5.0, tariff_bz: 32.0, degradation_pct: 0.65,
  premises_type: "residential", connection_type: "self", mounting: "rooftop", status: "draft",
  installation_type: "Elevated Flat Roof", tariff_note: "targeting the consumption rate of the third slab",
  internal_transformer: false, mppt_layout: "", hv_connectors: false,
};

const OFFER_IMAGES = [
  ["offer_site_file_id", "Proposed location", "Satellite / site picture. Blank = the layout image"],
  ["offer_shadow_file_id", "Shadow analysis", "e.g. the Helioscope shading report. Blank drops that slide"],
  ["offer_structure_file_id", "Mounting structure", "3D view or photo of the structure"],
];

const FLOATS = ["elevation_m", "project_area_m2", "latitude", "longitude", "tilt_deg", "azimuth_deg",
                "annual_gen_kwh", "subtotal_omr"];
const INTS = ["module_count", "strings", "inverter_qty"];

export async function form(main, { params, query }) {
  const all = await loadAll();
  let p;
  if (params.id) {
    p = all.projects.find((x) => x.id === params.id);
    if (!p) return notFound(main);
  } else {
    const cid = Number(query.client_id) || null;
    const def = (kind) => all.parties.find((x) => x.kind === kind && x.is_default)?.id || null;
    p = { ...NEW_PROJECT, client_id: cid, contractor_id: def("contractor"), consultant_id: def("consultant") };
    const c = cid && all.client.get(cid);
    if (c) p.name = `${c.name} – Solar PV`;
  }
  const isNew = !p.id;
  const layout = await db.getFile(p.layout_file_id);
  const offerFiles = Object.fromEntries(await Promise.all(OFFER_IMAGES.map(async ([key]) => [key, await db.getFile(p[key])])));
  const parties = byName(all.parties);
  const v = (k) => (p[k] === null || p[k] === undefined ? "" : p[k]);
  setTitle(isNew ? "New project" : p.name);

  main.innerHTML = html`
<div class="head">
  <div><h1>${isNew ? "New project" : "Edit project"}</h1>
  <div class="muted">Fill in what you have. Each document lists anything it still needs.</div></div>
</div>
<form id="project-form">
  <div class="panel">
    <h2>Project</h2>
    <div class="fields">
      <label>Client
        <select name="client_id" required><option value="">Choose…</option>
          ${byName(all.clients).map((c) => html`<option value="${c.id}" ${sel(c.id === p.client_id)}>${c.name}</option>`)}
        </select>
        <span class="hint">Not listed? <a href="#/clients/new">Add a client</a> first.</span>
      </label>
      <label>Project name <input name="name" value="${v("name")}"></label>
      <label>Status <select name="status">${PROJECT_STATUSES.map((st) => html`<option ${sel(st === p.status)}>${st}</option>`)}</select></label>
      <label>Reference code <input name="reference_code" value="${v("reference_code")}" placeholder="Client initials"><span class="hint">Used in "HTC/&lt;code&gt;/EA/01". Blank = client's initials</span></label>
      <label>Electricity account number <input name="account_no" value="${v("account_no")}" inputmode="numeric"><span class="hint">Keep leading zeros, e.g. 08023459</span></label>
    </div>
  </div>

  <div class="panel">
    <h2>Site</h2>
    <div class="fields">
      <label>Premises type <select name="premises_type">${PREMISES_TYPES.map((t) => html`<option value="${t}" ${sel(t === p.premises_type)}>${capitalize(t)}</option>`)}</select></label>
      <label>Connection type <select name="connection_type">${Object.entries(CONNECTION_TYPES).map(([k, lab]) => html`<option value="${k}" ${sel(k === p.connection_type)}>${lab}</option>`)}</select></label>
      <label>PV mounting <select name="mounting">${Object.entries(MOUNTING_TYPES).map(([k, lab]) => html`<option value="${k}" ${sel(k === p.mounting)}>${lab}</option>`)}</select></label>
      <label>Installation type <input name="installation_type" value="${v("installation_type")}" list="install-types"></label>
      <label>Structure height (m) <input name="elevation_m" value="${g(p.elevation_m)}" inputmode="decimal"></label>
      <label>Project area (m²) <input name="project_area_m2" value="${g(p.project_area_m2)}" inputmode="decimal"></label>
      <label>Latitude <input name="latitude" value="${g(p.latitude)}" inputmode="decimal" placeholder="23.5880"></label>
      <label>Longitude <input name="longitude" value="${g(p.longitude)}" inputmode="decimal" placeholder="58.3829"></label>
    </div>
    <div class="fields" id="layout-field">
      <label class="wide">Layout image <span class="hint">Roof / site layout shown in the execution agreement's Design Summary box (PNG or JPG)</span>
        <input type="file" name="layout_image" accept="image/png,image/jpeg"></label>
      ${layout ? html`<div class="wide"><img class="stamp-preview" src="${fileUrl(layout)}" alt="Current layout">
        <label class="check"><input type="checkbox" name="remove_layout"> Remove layout image</label></div>` : ""}
    </div>
    <datalist id="install-types"><option value="Elevated Flat Roof"><option value="Flush-mount Flat Roof"><option value="Metal Sheet Roof"><option value="Car Park Structure"><option value="Ground Mount"></datalist>
  </div>

  <div class="panel">
    <h2>System</h2>
    <div class="fields">
      <label class="wide">PV module <select name="module_id">${moduleOptions(all.modules, p.module_id)}</select>
        <span class="hint">Missing a model? Add it in the <a href="#/library">equipment library</a>.</span></label>
      <label>Number of modules <input name="module_count" value="${v("module_count")}" inputmode="numeric"></label>
      <label>Number of strings <input name="strings" value="${v("strings")}" inputmode="numeric"><span class="hint" id="live-per-string"></span></label>
      <label>Tilt (°) <input name="tilt_deg" value="${g(p.tilt_deg)}" inputmode="decimal"></label>
      <label>Azimuth (°) <input name="azimuth_deg" value="${g(p.azimuth_deg)}" inputmode="decimal"><span class="hint">180 = facing south</span></label>
      <label class="wide">Inverter <select name="inverter_id">${inverterOptions(all.inverters, p.inverter_id)}</select></label>
      <label>Inverter quantity <input name="inverter_qty" value="${v("inverter_qty")}" inputmode="numeric"></label>
      <div><label>Phases</label><div class="radios">
        <label><input type="radio" name="phases" value="1" ${chk(Number(p.phases) === 1)}> 1 phase</label>
        <label><input type="radio" name="phases" value="3" ${chk(Number(p.phases) !== 1)}> 3 phases</label></div></div>
      <div><label>Internal transformer</label><div class="radios">
        <label><input type="radio" name="internal_transformer" value="yes" ${chk(p.internal_transformer)}> Yes</label>
        <label><input type="radio" name="internal_transformer" value="no" ${chk(!p.internal_transformer)}> No</label></div></div>
      <label>Annual generation (kWh) <input name="annual_gen_kwh" value="${g(p.annual_gen_kwh)}" inputmode="decimal"><span class="hint">From PVsyst / Helioscope, or run the yield simulation on the project page</span></label>
      <label class="wide">Monthly generation, Jan to Dec (kWh) <textarea name="monthly_kwh" rows="2" placeholder="Paste the 12 monthly E_Grid values from PVsyst">${Array.isArray(p.monthly_kwh) ? p.monthly_kwh.map((x) => g(x)).join(" ") : ""}</textarea>
        <span class="hint">Used for the offer deck's energy table and chart. Blank = the annual figure spread over a typical Oman year. When filled, the annual figure becomes their total</span></label>
    </div>
    <div class="live">
      <div><span>DC capacity</span><b id="live-dc">—</b></div>
      <div><span>AC capacity</span><b id="live-ac">—</b></div>
      <div><span>DC/AC ratio</span><b id="live-ratio">—</b></div>
      <div><span>NAMA design form</span><b id="live-form" class="formpick">—</b></div>
    </div>
  </div>

  <div class="panel">
    <h2>Commercial <span class="muted small">(execution agreement)</span></h2>
    <div class="fields">
      <label>Price before VAT (OMR) <input name="subtotal_omr" value="${g(p.subtotal_omr)}" inputmode="decimal"></label>
      <label>VAT (%) <input name="vat_pct" value="${g(p.vat_pct)}" inputmode="decimal"></label>
      <label>Tariff for savings (bz/kWh) <input name="tariff_bz" value="${g(p.tariff_bz)}" inputmode="decimal"></label>
      <label>Yearly degradation (%) <input name="degradation_pct" value="${g(p.degradation_pct)}" inputmode="decimal"></label>
      <label class="wide">Tariff footnote <input name="tariff_note" value="${v("tariff_note")}"></label>
    </div>
  </div>

  <div class="panel">
    <h2>Authority paperwork</h2>
    <div class="fields">
      <div class="wide grid2">
        ${["consultant", "contractor"].map((kind) => html`
        <label>${capitalize(kind)}
          <span class="with-add">
            <select name="${kind}_id">${partyOptions(parties.filter((x) => x.kind === kind), p[kind + "_id"])}</select>
            <button type="button" class="btn small" data-quickadd="${kind}">+ Add</button>
          </span>
          <span class="quickadd" id="qa-${kind}">
            <input data-f="name" placeholder="${capitalize(kind)} name"><input data-f="phone" placeholder="Phone"><input data-f="engineer" placeholder="Project engineer">
            <button type="button" class="btn small primary" data-save>Add to list</button>
          </span>
        </label>`)}
      </div>
      <label>Agency contract date <input type="date" name="agency_date" value="${v("agency_date")}"><span class="hint">Blank = date of generation</span></label>
    </div>
    <p class="small muted spaced-top">The design form's "Documents Required" Yes / No / NA marks are kept exactly as in your template.</p>
  </div>

  <div class="panel">
    <h2>Offer deck pictures <span class="muted small">(optional)</span></h2>
    <div class="fields">
      ${OFFER_IMAGES.map(([key, label, hint]) => html`<label>${label} <span class="hint">${hint}</span><input type="file" name="${key}" accept="image/png,image/jpeg">
        ${offerFiles[key] ? html`<img class="stamp-preview" src="${fileUrl(offerFiles[key])}" alt=""><span class="check"><input type="checkbox" name="remove_${key}"> Remove</span>` : ""}</label>`)}
    </div>
  </div>

  <div class="panel"><label>Notes <textarea name="notes">${v("notes")}</textarea></label></div>

  <div class="bar">
    <a class="btn" href="${isNew ? "#/projects" : `#/projects/${p.id}`}">Cancel</a>
    <button class="btn primary">Save project</button>
  </div>
</form>`;

  const f = main.querySelector("#project-form");
  const $ = (n) => f.querySelector(`[name="${n}"]`);
  const out = (id, t) => { main.querySelector("#" + id).textContent = t; };
  function update() {
    const mod = $("module_id").selectedOptions[0], inv = $("inverter_id").selectedOptions[0];
    const wp = parseFloat(mod?.dataset.wp || ""), kw = parseFloat(inv?.dataset.kw || "");
    const n = parseInt($("module_count").value || "", 10), q = parseInt($("inverter_qty").value || "", 10);
    const dc = wp && n ? (wp * n) / 1000 : null, ac = kw && q ? kw * q : null;
    out("live-dc", dc === null ? "—" : num(dc) + " kWp");
    out("live-ac", ac === null ? "—" : num(ac) + " kW");
    out("live-ratio", dc && ac ? num(dc / ac) : "—");
    out("live-form", ac === null ? "—" : ac > 11 ? "Above 11 kW form" : "11 kW and below form");
    const strings = parseInt($("strings").value || "", 10);
    out("live-per-string", n && strings ? (n % strings ? `${n} modules don't split evenly into ${strings} strings` : `${n / strings} modules per string`) : "");
  }
  f.addEventListener("input", update);
  f.addEventListener("change", (e) => {
    // keep the phase / transformer answers in step with the chosen inverter
    if (e.target.name === "inverter_id") {
      const inv = e.target.selectedOptions[0];
      if (inv?.dataset.phases) {
        const ph = f.querySelector(`[name="phases"][value="${inv.dataset.phases}"]`);
        if (ph) ph.checked = true;
        f.querySelector(`[name="internal_transformer"][value="${inv.dataset.trafo === "1" ? "yes" : "no"}"]`).checked = true;
      }
    }
    update();
  });
  update();

  f.querySelectorAll("[data-quickadd]").forEach((btn) => {
    const kind = btn.dataset.quickadd;
    const box = f.querySelector("#qa-" + kind);
    btn.addEventListener("click", () => box.classList.toggle("open"));
    box.querySelector("[data-save]").addEventListener("click", async () => {
      const rec = { kind, email: "", address: "", is_default: false };
      for (const k of ["name", "phone", "engineer"]) rec[k] = box.querySelector(`[data-f="${k}"]`).value.trim();
      if (!rec.name) { toast("Enter a name first.", "error"); return; }
      const id = await db.put("parties", rec);
      $(kind + "_id").add(new Option(rec.name, id, true, true));
      box.classList.remove("open");
      box.querySelectorAll("input").forEach((i) => (i.value = ""));
    });
  });

  f.addEventListener("submit", async (e) => {
    e.preventDefault();
    const fd = new FormData(f);
    const rec = { ...p };
    rec.client_id = fkey(fd, "client_id");
    if (!rec.client_id || !all.client.get(rec.client_id)) { toast("Choose a client for this project.", "error"); return; }
    rec.name = str(fd, "name") || "Solar PV project";
    rec.status = PROJECT_STATUSES.includes(str(fd, "status")) ? str(fd, "status") : "draft";
    rec.account_no = str(fd, "account_no");
    rec.premises_type = PREMISES_TYPES.includes(str(fd, "premises_type")) ? str(fd, "premises_type") : "residential";
    rec.connection_type = str(fd, "connection_type") in CONNECTION_TYPES ? str(fd, "connection_type") : "self";
    rec.mounting = str(fd, "mounting") in MOUNTING_TYPES ? str(fd, "mounting") : "rooftop";
    rec.installation_type = str(fd, "installation_type");
    for (const k of FLOATS) rec[k] = float(fd, k);
    for (const k of INTS) rec[k] = int(fd, k);
    rec.module_id = fkey(fd, "module_id");
    rec.inverter_id = fkey(fd, "inverter_id");
    rec.consultant_id = fkey(fd, "consultant_id");
    rec.contractor_id = fkey(fd, "contractor_id");
    rec.phases = str(fd, "phases") === "1" ? 1 : 3;
    rec.internal_transformer = str(fd, "internal_transformer") === "yes";
    rec.vat_pct = float(fd, "vat_pct") ?? 5.0;
    rec.tariff_bz = float(fd, "tariff_bz") ?? 32.0;
    rec.tariff_note = str(fd, "tariff_note");
    rec.degradation_pct = float(fd, "degradation_pct") ?? 0.65;
    rec.agency_date = /^\d{4}-\d{2}-\d{2}$/.test(str(fd, "agency_date")) ? str(fd, "agency_date") : null;
    rec.notes = str(fd, "notes");
    rec.reference_code = str(fd, "reference_code").toUpperCase();
    const monthlyRaw = str(fd, "monthly_kwh");
    rec.monthly_kwh = monthlyRaw ? parseMonthly(monthlyRaw) : null;
    if (monthlyRaw && !rec.monthly_kwh) { toast("Monthly generation needs exactly 12 numbers (Jan to Dec). Nothing was saved.", "error"); return; }
    if (rec.monthly_kwh) rec.annual_gen_kwh = Math.round(rec.monthly_kwh.reduce((a, b) => a + b, 0));
    for (const [key] of OFFER_IMAGES) {
      const up = fd.get(key);
      if (fd.get("remove_" + key) === "on" && rec[key]) { await db.delFile(rec[key]); rec[key] = null; }
      if (up && up.size) {
        try {
          const img = await readImage(up);
          const fid = await db.putFile(img.blob, up.name, { width: img.width, height: img.height, kind: "offer" });
          if (rec[key]) await db.delFile(rec[key]);
          rec[key] = fid;
        } catch { toast(`${up.name} couldn't be read (PNG or JPG only); it wasn't saved.`, "error"); }
      }
    }

    const upload = fd.get("layout_image");
    if (fd.get("remove_layout") === "on" && rec.layout_file_id) {
      await db.delFile(rec.layout_file_id);
      rec.layout_file_id = null;
    }
    if (upload && upload.size) {
      try {
        const img = await readImage(upload);
        const fid = await db.putFile(img.blob, upload.name, { width: img.width, height: img.height, kind: "layout" });
        if (rec.layout_file_id) await db.delFile(rec.layout_file_id);
        rec.layout_file_id = fid;
      } catch {
        toast("The layout image couldn't be read (PNG or JPG only); it wasn't saved.", "error");
      }
    }
    const id = await db.put("projects", rec);
    const saved = full({ ...rec, id }, await loadAll());
    const warn = designWarnings(saved);
    const r = projectCheck(saved, all);
    if (fails(r).length) warn.push(`Design check: ${fails(r).length} hard rule(s) fail. See String & inverter sizing.`);
    toast("Project saved." + (warn.length ? " " + warn.join(" ") : ""), warn.length ? "warn" : "ok", warn.length ? 9000 : 4000);
    go(`#/projects/${id}`);
  });
}

function designWarnings(p) {
  const out = [];
  if (p.inverter && Number(p.inverter.phases) !== p.phases) out.push(`The inverter is ${p.inverter.phases}-phase but the project says ${p.phases}-phase.`);
  if (p.inverter && !!p.internal_transformer !== !!p.inverter.internal_transformer) out.push("The internal-transformer answer differs from the inverter's datasheet setting.");
  if (p.module_count && p.strings && p.module_count % p.strings) out.push(`${p.module_count} modules don't divide evenly into ${p.strings} strings.`);
  const ac = acKw(p);
  if (ac && Math.abs(ac - 11) < 1e-9) out.push("AC capacity is exactly 11 kW, so the 'below 11 kW' design form will be used.");
  return out;
}

// ---- view ------------------------------------------------------------------------------

export async function view(main, { params }) {
  const all = await loadAll();
  const raw = all.projects.find((x) => x.id === params.id);
  if (!raw) return notFound(main);
  const p = all.full(raw);
  setTitle(p.name);
  const r = projectCheck(p, all);
  const blockDesign = blocked(r) && settingsFor(p, all).values.block_design_form;
  const docs = Object.values(DOCS).map((d) => ({
    key: d.key, missing: missingFields(d.key, p),
    title: d.key === "design" ? d.title + (above11kw(p) ? " (above 11 kW AC)" : " (11 kW AC and below)") : d.title,
  }));
  const issues = [...fails(r), ...unknown(r), ...warnings(r)].slice(0, 6);
  const packKeys = ["initial", "agency", ...(blockDesign ? [] : ["design"])];
  const offerMiss = offerMissing(p);

  main.innerHTML = html`
<div class="head">
  <div>
    <h1>${p.name}</h1>
    <div class="muted">${p.client ? html`<a href="#/clients/${p.client.id}">${p.client.name}</a>` : "No client"} · Account ${p.account_no || "—"} · <span class="pill">${p.status}</span></div>
  </div>
  <div class="actions"><button class="btn" id="duplicate">Duplicate</button><a class="btn primary" href="#/projects/${p.id}/edit">Edit project</a></div>
</div>

<div class="summary">
  <div><span>DC capacity</span><b>${num(dcKwp(p))} kWp</b></div>
  <div><span>AC capacity</span><b>${num(acKw(p))} kW</b></div>
  <div><span>DC/AC ratio</span><b>${num(dcAcRatio(p))}</b></div>
  <div><span>Annual generation</span><b>${num(p.annual_gen_kwh, 0)} kWh</b></div>
</div>

<div class="panel design-check">
  <div class="panel-head"><h2>Design check ${pill(r)}</h2><span class="actions"><a class="btn small" href="#/projects/${p.id}/yield">Yield simulation</a> <a class="btn small primary" href="#/projects/${p.id}/sizing">Open sizing</a></span></div>
  ${issues.length ? issues.map((c) => html`<div class="small ck-line ck-${c.status}"><b>${c.label}</b>${c.value ? html`: ${c.value}${c.limit ? html` (limit ${c.limit})` : ""}` : ""}. ${c.detail}</div>`)
    : html`<div class="small ok-text">Every rule passes${r.modules_per_string ? html`: ${p.strings} strings of ${r.modules_per_string} modules` : ""}.</div>`}
  ${blocked(r) ? html`<div class="small muted spaced-top">Yield reports stay blocked until every hard rule passes.</div>` : ""}
</div>

<div class="grid2">
  <div class="panel">
    <h2>Documents</h2>
    ${docs.map((d) => html`
    <div class="doc">
      <div><b>${d.title}</b>
        ${d.missing.length ? html`<div class="missing">Still needs: ${d.missing.join(", ")}</div>` : html`<div class="ready">All fields filled</div>`}</div>
      <div class="btns">${d.key === "design" && blockDesign ? html`<span class="pill err">Blocked by design check</span>`
        : html`<button class="btn small" data-doc="${d.key}">Word</button>`}</div>
    </div>`)}
    <p class="small muted">Missing fields are left blank in the document so you can still print and fill by hand. Open the Word file and use File › Save as PDF if you need a PDF.</p>
    <div class="doc">
      <div><b>Techno-commercial offer (PowerPoint)</b>
        ${offerMiss.length ? html`<div class="missing">Still needs: ${offerMiss.join(", ")}</div>` : html`<div class="ready">All fields filled${p.monthly_kwh ? "" : " (monthly energy estimated from the annual figure)"}</div>`}</div>
      <div class="btns"><a class="btn small" href="#/offers/${p.id}">Preview</a><button class="btn small" id="offer">PowerPoint</button></div>
    </div>
    <p><a class="btn" href="#/letters/new?project_id=${p.id}">Write a letter (e.g. to NEDC)</a></p>
    <p><button class="btn sun" id="pack">Download NAMA submission pack (.zip)</button></p>
  </div>
  <div>
    <div class="panel">
      <h2>System</h2>
      <dl class="kv">
        <dt>Modules</dt><dd>${p.module_count || "—"} × ${p.module ? moduleLabel(p.module) : "—"}</dd>
        <dt>Strings</dt><dd>${p.strings || "—"}</dd>
        <dt>Inverters</dt><dd>${p.inverter_qty || "—"} × ${p.inverter ? inverterLabel(p.inverter) : "—"}</dd>
        <dt>Phases</dt><dd>${p.phases}-phase · internal transformer: ${p.internal_transformer ? "yes" : "no"}</dd>
        <dt>Tilt / azimuth</dt><dd>${num(p.tilt_deg, 1)}° / ${num(p.azimuth_deg, 1)}°</dd>
        <dt>Mounting</dt><dd>${MOUNTING_TYPES[p.mounting] || p.mounting} · ${p.installation_type}${p.elevation_m ? ` (${num(p.elevation_m, 1)} m)` : ""}</dd>
        <dt>Area</dt><dd>${num(p.project_area_m2, 1)} m²</dd>
        <dt>NAMA design form</dt><dd>${above11kw(p) ? "Above 11 kW" : "11 kW and below"} (by AC capacity)</dd>
      </dl>
    </div>
    <div class="panel">
      <h2>Paperwork</h2>
      <dl class="kv">
        <dt>Premises</dt><dd>${capitalize(p.premises_type)}</dd>
        <dt>Connection</dt><dd>${CONNECTION_TYPES[p.connection_type] || p.connection_type}</dd>
        <dt>Consultant</dt><dd>${p.consultant?.name || "—"}</dd>
        <dt>Contractor</dt><dd>${p.contractor?.name || "—"}</dd>
        <dt>Price</dt><dd>${p.subtotal_omr !== null && p.subtotal_omr !== undefined ? `OMR ${Number(p.subtotal_omr).toLocaleString("en-US", { minimumFractionDigits: 3, maximumFractionDigits: 3 })} + VAT` : "—"}</dd>
      </dl>
    </div>
  </div>
</div>
${p.notes ? html`<div class="panel"><h2>Notes</h2><div>${p.notes}</div></div>` : ""}
<button class="btn danger small" id="delete" data-confirm="Delete this project? This cannot be undone.">Delete project</button>`;

  const busy = async (btn, fn) => {
    const label = btn.textContent;
    btn.disabled = true; btn.textContent = "Working…";
    try { await fn(); } catch (err) { console.error(err); toast("Couldn't make the document: " + err.message, "error"); }
    finally { btn.disabled = false; btn.textContent = label; }
  };
  main.querySelectorAll("[data-doc]").forEach((btn) => btn.addEventListener("click", () => busy(btn, async () => {
    const { blob, filename } = await generate(btn.dataset.doc, p);
    download(blob, filename);
  })));
  main.querySelector("#offer").addEventListener("click", (e) => busy(e.target, async () => {
    const { blob, filename } = await generateOffer(p);
    download(blob, filename);
  }));
  main.querySelector("#pack").addEventListener("click", (e) => busy(e.target, async () => {
    const { blob, filename } = await generatePack(packKeys, p);
    download(blob, filename);
  }));
  main.querySelector("#duplicate").addEventListener("click", async () => {
    const { id, created_at, updated_at, layout_file_id, ...rest } = raw;
    let copyLayout = null;
    const lf = await db.getFile(layout_file_id);
    if (lf) copyLayout = await db.putFile(lf.blob, lf.name, { width: lf.width, height: lf.height, kind: "layout" });
    const copies = {};
    for (const [key] of OFFER_IMAGES) {
      const f = await db.getFile(raw[key]);
      copies[key] = f ? await db.putFile(f.blob, f.name, { width: f.width, height: f.height, kind: "offer" }) : null;
    }
    const nid = await db.put("projects", { ...rest, ...copies, name: `${raw.name} (copy)`, status: "draft", layout_file_id: copyLayout });
    toast("Project duplicated. Change the client or details as needed.");
    go(`#/projects/${nid}/edit`);
  });
  main.querySelector("#delete").addEventListener("click", async () => {
    for (const key of ["layout_file_id", ...OFFER_IMAGES.map(([k]) => k)]) await db.delFile(raw[key]);
    await db.delFile(`weather_${raw.id}`);
    await db.del("projects", raw.id);
    toast("Project deleted.");
    go("#/projects");
  });
}
