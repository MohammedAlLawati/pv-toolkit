import { esc, fileUrl, g, go, html, num, raw, sel, toast } from "../ui.js";
import * as db from "../store.js";
import { importJinko, importSungrow, loadAll, sortInverters, sortModules } from "../data.js";
import { CATEGORIES, FIELDS, groups, inverterReady, moduleDims, moduleReady, parseValue, splitList, syncMpptSummary } from "../equipment_fields.js";
import { setTitle } from "../app.js";

const STORE = { module: "modules", inverter: "inverters" };

export async function library(main, { query }) {
  setTitle("Equipment library");
  const all = await loadAll();
  const cat = query.cat in CATEGORIES ? query.cat : "";
  const files = new Map();
  for (const x of [...all.modules, ...all.inverters]) if (x.datasheet_id) files.set(x.datasheet_id, await db.getFile(x.datasheet_id));
  const sheet = (x) => (files.get(x.datasheet_id) ? html`<a class="small" href="${fileUrl(files.get(x.datasheet_id))}" target="_blank" rel="noopener">PDF</a>` : html`<span class="muted small">—</span>`);
  const inverters = sortInverters(all.inverters).filter((v) => !cat || v.category === cat);
  const modules = sortModules(all.modules);
  const hasSungrow = all.inverters.some((v) => v.make === "Sungrow" && v.model === "SG150CX");
  const hasJinko = all.modules.some((m) => m.model === "JKM720N-66HL5-BDV");
  const ready = (ok) => (ok ? html`<span class="pill ok">sizing-ready</span>` : html`<span class="pill warn">incomplete</span>`);

  main.innerHTML = html`
<div class="head">
  <div><h1>Equipment library</h1><div class="muted">Modules and inverters available to projects. Enter values from the manufacturer's datasheet (STC).</div></div>
  <div class="actions"><a class="btn primary" href="#/library/module/new">Add module</a><a class="btn primary" href="#/library/inverter/new">Add inverter</a></div>
</div>
${hasSungrow ? "" : html`<div class="panel callout">
  <div><b>Sungrow MENA range</b><div class="muted small">18 inverters from your datasheets: SG5.0–SG20RT-P2 (residential), SG25–SG150CX (C&amp;I), SG320HX-20 (utility). Values checked by hand; datasheets attached.</div></div>
  <button class="btn sun" id="load-sungrow">Load into library</button></div>`}
${hasJinko ? "" : html`<div class="panel callout">
  <div><b>Jinko Tiger Neo modules</b><div class="muted small">66HL5-BDV 710–735 Wp (6 models, from your datasheet, attached) and 78HL4-BDV 620 Wp (from Jinko's published datasheet, not yet from your copy).</div></div>
  <button class="btn sun" id="load-jinko">Load into library</button></div>`}

<div class="panel">
  <div class="panel-head"><h2>Inverters</h2>
    <div class="tabs"><a href="#/library" class="${cat ? "" : "on"}">All</a>
      ${Object.entries(CATEGORIES).map(([k, lab]) => html`<a href="#/library?cat=${k}" class="${cat === k ? "on" : ""}">${lab}</a>`)}
      <a class="btn small" href="#/library/inverter/new">Add manually</a></div>
  </div>
  ${inverters.length ? html`<table>
    <thead><tr><th>Model</th><th>Category</th><th class="r">AC kW</th><th class="r">Ph.</th><th class="r">MPPTs</th><th>MPPT window</th><th class="r">Max V</th><th>A / MPPT</th><th>Datasheet</th><th></th></tr></thead>
    <tbody>${inverters.map((v) => html`<tr>
      <td><a href="#/library/inverter/${v.id}">${v.make} ${v.model}</a></td>
      <td><span class="pill">${CATEGORIES[v.category] || v.category}</span></td>
      <td class="r num">${num(v.ac_kw)}</td><td class="r">${v.phases}</td><td class="r">${v.num_mppt || "—"}</td>
      <td class="small num">${v.mppt_min_v ? `${num(v.mppt_min_v, 0)}–${num(v.mppt_max_v, 0)} V` : "—"}</td>
      <td class="r num">${num(v.max_dc_v, 0)}</td>
      <td class="small num">${v.mppt_currents && v.mppt_currents.length < 14 ? v.mppt_currents : num(v.max_current_per_mppt)}</td>
      <td>${sheet(v)}</td><td>${ready(inverterReady(v))}</td></tr>`)}</tbody>
  </table>` : html`<div class="empty">No inverters${cat ? " in this category" : ""} yet.</div>`}
</div>

<div class="panel">
  <div class="panel-head"><h2>PV modules</h2><a class="btn small" href="#/library/module/new">Add manually</a></div>
  ${modules.length ? html`<table>
    <thead><tr><th>Model</th><th class="r">Wp</th><th>Technology</th><th class="r">Voc</th><th class="r">Isc</th><th class="r">Tc Voc</th><th>Dimensions</th><th>Datasheet</th><th></th></tr></thead>
    <tbody>${modules.map((m) => html`<tr>
      <td><a href="#/library/module/${m.id}">${m.make} ${m.model}</a></td>
      <td class="r num">${num(m.wp, 1)}</td><td class="small">${m.technology}</td>
      <td class="r num">${num(m.voc)}</td><td class="r num">${num(m.isc)}</td><td class="r num">${num(m.tc_voc_pct, 3)}</td>
      <td class="small">${moduleDims(m)}</td><td>${sheet(m)}</td><td>${ready(moduleReady(m))}</td></tr>`)}</tbody>
  </table>` : html`<div class="empty">No modules yet.</div>`}
</div>`;

  const loader = (id, fn, what) => main.querySelector(id)?.addEventListener("click", async (e) => {
    e.target.disabled = true; e.target.textContent = "Loading…";
    const [added, updated] = await fn();
    toast(`${what} loaded: ${added} added, ${updated} refreshed.`);
    go("#/library");
  });
  loader("#load-sungrow", importSungrow, "Sungrow MENA range");
  loader("#load-jinko", importJinko, "Jinko Tiger Neo modules");
}

/** Plausibility checks on datasheet values (ported from app/datasheets.py). */
export function equipmentChecks(kind, row) {
  const w = [], gv = (k) => row[k];
  const isNum = (k) => gv(k) !== null && gv(k) !== undefined;
  if (kind === "module") {
    if (gv("voc") && gv("vmp") && gv("voc") <= gv("vmp")) w.push("Voc should be higher than Vmp.");
    if (gv("isc") && gv("imp") && gv("isc") <= gv("imp")) w.push("Isc should be higher than Imp.");
    if (gv("vmp") && gv("imp") && gv("wp")) {
      const p = gv("vmp") * gv("imp");
      if (Math.abs(p - gv("wp")) / gv("wp") > 0.03) w.push(`Vmp × Imp = ${p.toFixed(0)} W, which doesn't match ${g(gv("wp"))} Wp.`);
    }
    if (isNum("tc_voc_pct") && !(gv("tc_voc_pct") > -0.6 && gv("tc_voc_pct") < 0)) w.push("Voc temperature coefficient should be negative, around -0.2 to -0.35 %/°C.");
    if (isNum("tc_pmax_pct") && !(gv("tc_pmax_pct") > -0.6 && gv("tc_pmax_pct") < 0)) w.push("Pmax temperature coefficient should be negative, around -0.25 to -0.40 %/°C.");
    if (isNum("tc_isc_pct") && !(gv("tc_isc_pct") > 0 && gv("tc_isc_pct") < 0.2)) w.push("Isc temperature coefficient should be small and positive (about 0.04-0.06 %/°C).");
    if (isNum("bifaciality") && !(gv("bifaciality") > 0 && gv("bifaciality") <= 1)) w.push("Bifaciality should be a fraction between 0 and 1.");
    const miss = ["voc", "isc", "vmp", "imp", "tc_voc_pct"].find((k) => !isNum(k));
    if (miss) w.push(`Missing ${miss}: needed for string sizing.`);
  } else {
    if (gv("mppt_min_v") && gv("mppt_max_v") && gv("mppt_min_v") >= gv("mppt_max_v")) w.push("MPPT minimum must be below the maximum.");
    if (gv("mppt_max_v") && gv("max_dc_v") && gv("mppt_max_v") > gv("max_dc_v")) w.push("MPPT maximum is above the max. input voltage.");
    if (gv("ac_kw") && gv("max_ac_kva") && gv("max_ac_kva") < gv("ac_kw") * 0.99) w.push("Max. apparent power is below the rated power.");
    const nm = gv("num_mppt");
    for (const k of ["mppt_strings", "mppt_currents", "mppt_iscs"]) {
      const vals = splitList(gv(k));
      if (nm && vals.length > 1 && vals.length !== nm) w.push(`${k.replace(/_/g, " ")} lists ${vals.length} values but there are ${nm} MPPTs.`);
    }
    const cur = splitList(gv("mppt_currents")), isc = splitList(gv("mppt_iscs"));
    if (cur.length && isc.length && cur.length === isc.length && cur.some((c, i) => isc[i] < c)) w.push("Short-circuit current per MPPT should be at least the operating current.");
    if (gv("ac_kw") && gv("max_dc_kw") && gv("max_dc_kw") / gv("ac_kw") > 2) w.push("Recommended max. PV power is more than twice the AC rating; please check.");
    const miss = ["max_dc_v", "mppt_min_v", "mppt_max_v", "num_mppt", "mppt_currents"].find((k) => !gv(k));
    if (miss) w.push(`Missing ${miss.replace(/_/g, " ")}: needed for string sizing.`);
  }
  return w;
}

function fieldInput(f, value) {
  const v = value === null || value === undefined ? "" : value;
  if (f.key === "category") return html`<select name="${f.key}">${Object.entries(CATEGORIES).map(([k, lab]) => html`<option value="${k}" ${sel(v === k)}>${lab}</option>`)}</select>`;
  if (f.type === "bool") return html`<select name="${f.key}"><option value="false" ${sel(!v)}>No</option><option value="true" ${sel(!!v)}>Yes</option></select>`;
  if (f.type === "text") return html`<textarea name="${f.key}" rows="3">${v}</textarea>`;
  const shown = typeof v === "number" ? g(v) : v;
  return raw(`<input name="${f.key}" value="${esc(shown)}"${f.type === "float" || f.type === "int" ? ' inputmode="decimal"' : ""}${f.required ? " required" : ""}>`);
}

export async function form(main, { params }) {
  const kind = params.kind;
  if (!(kind in STORE)) { main.innerHTML = `<div class="panel empty">Unknown equipment type.</div>`; return; }
  const item = params.id ? await db.get(STORE[kind], params.id) : null;
  if (params.id && !item) { main.innerHTML = `<div class="panel empty">Not found. <a href="#/library">Equipment library</a></div>`; return; }
  const sheet = item ? await db.getFile(item.datasheet_id) : null;
  const projects = item ? (await db.list("projects")).filter((p) => p[kind + "_id"] === item.id) : [];
  const title = item ? `${item.make} ${item.model}` : `New ${kind}`;
  setTitle(title);
  const checks = item ? equipmentChecks(kind, item) : [];

  main.innerHTML = html`
<div class="head"><div><h1>${title}</h1>
<div class="muted">${sheet ? html`Datasheet: <a href="${fileUrl(sheet)}" target="_blank" rel="noopener">${sheet.name}</a>` : "Values from the manufacturer's datasheet (STC)."}</div></div></div>
${checks.map((c) => html`<div class="flash warn">${c}</div>`)}
<form id="eq-form">
  ${groups(kind).map(([gname, fields]) => html`
  <div class="panel"><h2>${gname}</h2><div class="fields">
    ${fields.map((f) => html`<label class="${f.type === "text" ? "wide" : ""}">${f.label}${f.unit ? ` (${f.unit})` : ""}
      ${fieldInput(f, item ? item[f.key] : f.key === "phases" ? 3 : null)}${f.hint ? html`<span class="hint">${f.hint}</span>` : ""}</label>`)}
  </div></div>`)}
  <div class="panel"><div class="fields">
    <label class="wide">${sheet ? "Replace" : "Attach"} datasheet <span class="hint">Stored with this ${kind} in your browser; the values above are not changed.</span>
      <input type="file" name="datasheet" accept="application/pdf,image/png,image/jpeg"></label>
  </div></div>
  <div class="bar"><a class="btn" href="#/library">Cancel</a><button class="btn primary">Save</button></div>
</form>
${item ? html`<button class="btn danger small" id="delete" data-confirm="Delete this ${kind}?${projects.length ? " Projects using it will lose the link." : ""}">Delete ${kind}</button>` : ""}`;

  main.querySelector("#eq-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    const fd = new FormData(e.target);
    const rec = { ...(item || {}) };
    const problems = [];
    for (const f of FIELDS[kind]) {
      let v = parseValue(f, fd.get(f.key));
      if (f.key === "category" && !(v in CATEGORIES)) v = "residential";
      rec[f.key] = v;
      if (f.required && (v === null || v === "")) problems.push(`${f.label} is required.`);
    }
    if (problems.length) { toast(problems.join(" "), "error"); return; }
    if (kind === "inverter") { rec.phases = rec.phases || 3; syncMpptSummary(rec); }
    const upload = fd.get("datasheet");
    if (upload && upload.size) {
      const fid = await db.putFile(upload, upload.name, { kind: "datasheet" });
      if (rec.datasheet_id) await db.delFile(rec.datasheet_id);
      rec.datasheet_id = fid;
    }
    const id = await db.put(STORE[kind], rec);
    const w = equipmentChecks(kind, rec);
    toast(`Saved.${w.length ? " Please check: " + w.join(" ") : ""}`, w.length ? "warn" : "ok", w.length ? 9000 : 4000);
    go(`#/library/${kind}/${id}`);
  });
  main.querySelector("#delete")?.addEventListener("click", async () => {
    for (const p of projects) await db.put("projects", { ...p, [kind + "_id"]: null });
    await db.delFile(item.datasheet_id);
    await db.del(STORE[kind], item.id);
    toast(`${kind[0].toUpperCase() + kind.slice(1)} deleted.`);
    go("#/library");
  });
}
