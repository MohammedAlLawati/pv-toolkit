import { chk, fkey, float, g, go, html, int, num, sel, str, toast } from "../ui.js";
import * as db from "../store.js";
import { acKw, byName, byUpdated, dcKwp, full, loadAll, projectCheck, settingsFor, sortInverters } from "../data.js";
import { CATEGORIES, moduleLabel, moduleReady } from "../equipment_fields.js";
import { check, designFrom, fails, recommend, status, unknown, warnings } from "../sizing/engine.js";
import { inverterOptions, moduleOptions } from "../options.js";
import { setTitle } from "../app.js";

const TARGETS = { dc: "DC capacity (kWp)", ac: "AC capacity (kW)", modules: "Modules that fit (max.)" };
const DESIGN_FLOATS = ["t_min_c", "t_max_c", "connection_limit_kw", "dc_cable_m", "dc_cable_mm2", "ac_cable_m", "ac_cable_mm2"];
const LABELS = { pass: "Every rule passes", warn: "Passes, with warnings", fail: "Hard rule fails: reports blocked", incomplete: "Can't check yet: reports blocked" };
const MARK = { fail: "✕", unknown: "?", warn: "!", pass: "✓" };
const plural = (n, word) => `${n} ${word}${n === 1 ? "" : "s"}`;
const has = (o) => o && Object.keys(o).length > 0;

/** The small status pill used on lists and the project page. */
export function pill(r) {
  const st = status(r);
  if (st === "pass") return html`<span class="pill ok">Passes</span>`;
  if (st === "warn") return html`<span class="pill warn">${plural(warnings(r).length, "warning")}</span>`;
  if (st === "fail") return html`<span class="pill err">${plural(fails(r).length, "fail")}</span>`;
  return html`<span class="pill">Incomplete</span>`;
}

/** Full rules-check results for one design. */
export function results(r) {
  const st = status(r);
  const nw = warnings(r).length;
  return html`
<div class="verdict ${st}"><b>${LABELS[st]}</b><span>${fails(r).length} fail · ${unknown(r).length} missing · ${nw} warning${nw === 1 ? "" : "s"}</span></div>
<div class="summary">
  <div><span>DC capacity</span><b>${num(r.dc_kwp)} kWp</b></div>
  <div><span>AC capacity</span><b>${num(r.ac_kw)} kW</b></div>
  <div><span>DC/AC ratio</span><b>${num(r.ratio)}</b></div>
  <div><span>Modules per string</span><b>${r.modules_per_string || "—"}${r.string_range ? html` <small class="muted">(allowed ${r.string_range[0]}–${r.string_range[1]})</small>` : ""}</b></div>
</div>
<table class="checks">
  <thead><tr><th></th><th>Rule</th><th class="r">Design</th><th class="r">Limit</th></tr></thead>
  <tbody>${["fail", "unknown", "warn", "pass"].flatMap((s) => r.checks.filter((c) => c.status === s)).map((c) => html`
    <tr class="ck-${c.status}"><td><span class="ck">${MARK[c.status]}</span></td>
      <td><b>${c.label}</b><div class="small muted">${c.detail}</div></td>
      <td class="r num">${c.value}</td><td class="r num">${c.limit}</td></tr>`)}</tbody>
</table>
${has(r.string) ? html`
<h3 class="spaced">String values (${r.modules_per_string} modules)</h3>
<dl class="kv">
  <dt>Temperatures</dt><dd>record low ${num(r.temps.t_min, 1)} °C · max. ambient ${num(r.temps.t_max, 1)} °C · hot cell ${num(r.temps.cell_hot, 1)} °C (NOCT ${num(r.temps.noct, 0)} °C)</dd>
  <dt>Voc at record low</dt><dd>${num(r.string.voc_cold, 1)} V</dd>
  <dt>Vmp at record low / STC / hot</dt><dd>${num(r.string.vmp_cold, 1)} / ${num(r.string.vmp, 1)} / ${num(r.string.vmp_hot, 1)} V</dd>
  <dt>Current per string</dt><dd>Isc design ${num(r.string.isc_design, 2)} A · operating ${num(r.string.imp_design, 2)} A</dd>
</dl>` : ""}
${r.groups.length ? html`<h3 class="spaced">Strings on each inverter</h3>${r.groups.map((gr) => html`
<div class="small muted">${gr.count} inverter${gr.count > 1 ? "s" : ""} with ${gr.strings} string${gr.strings > 1 ? "s" : ""} each (${num(gr.dc_kwp)} kWp per inverter)${gr.overflow ? html` · <b class="err-text">${gr.overflow} string(s) don't fit</b>` : ""}</div>
<table class="mppt">
  <thead><tr><th>MPPT</th><th class="r">Strings / inputs</th><th class="r">Isc design / limit</th><th class="r">Current / limit</th></tr></thead>
  <tbody>${gr.mppts.map((row) => html`<tr><td>${row.index}</td>
    <td class="r num ${row.connectors && row.strings > row.connectors ? "err-text" : ""}">${row.strings} / ${row.connectors || "—"}</td>
    <td class="r num ${row.isc_limit && row.isc > row.isc_limit + 1e-9 ? "err-text" : ""}">${num(row.isc, 1)} / ${num(row.isc_limit, 0)} A</td>
    <td class="r num ${row.imp_limit && row.imp > row.imp_limit + 1e-9 ? "err-text" : ""}">${num(row.imp, 1)} / ${num(row.imp_limit, 0)} A</td></tr>`)}</tbody>
</table>`)}` : ""}
${has(r.cables) ? html`<h3 class="spaced">Cables</h3><dl class="kv">
  ${"dc_recommended" in r.cables ? html`<dt>DC string cable</dt><dd>${"dc_drop" in r.cables ? `${num(r.cables.dc_drop, 2)} % drop · ` : ""}smallest size for the limit: ${r.cables.dc_recommended ? r.cables.dc_recommended + " mm²" : "over 16 mm², shorten the run"}</dd>` : ""}
  ${"ac_recommended" in r.cables ? html`<dt>AC cable</dt><dd>${num(r.cables.ac_current, 1)} A · ${"ac_drop" in r.cables ? `${num(r.cables.ac_drop, 2)} % drop · ` : ""}smallest size for the drop limit: ${r.cables.ac_recommended ? r.cables.ac_recommended + " mm²" : "over 300 mm², split the run"}. Check current rating and derating separately.</dd>` : ""}
</dl>` : ""}
${r.notes.map((n) => html`<div class="note small">${n}</div>`)}`;
}

// ---- overview --------------------------------------------------------------------------

export async function index(main) {
  setTitle("String & inverter sizing");
  const all = await loadAll();
  const rows = byUpdated(all.projects).map(all.full).map((p) => [p, projectCheck(p, all)]);
  main.innerHTML = html`
<div class="head">
  <div><h1>String &amp; inverter sizing</h1><div class="muted">The rules check for every project. Open one to get a recommended design or change it.</div></div>
  <div class="actions"><a class="btn" href="#/rules">Design rules</a></div>
</div>
<div class="panel">
  ${rows.length ? html`<table>
    <thead><tr><th>Project</th><th>System</th><th class="r">DC kWp</th><th class="r">AC kW</th><th class="r">DC/AC</th><th>Check</th></tr></thead>
    <tbody>${rows.map(([p, r]) => html`<tr>
      <td><a href="#/projects/${p.id}/sizing">${p.name}</a><div class="small muted">${p.client?.name}</div></td>
      <td class="small">${p.module ? `${p.module_count || "—"} × ${p.module.model}` : "—"}<br>${p.inverter ? `${p.inverter_qty || "—"} × ${p.inverter.model}` : ""}</td>
      <td class="r num">${num(r.dc_kwp)}</td><td class="r num">${num(r.ac_kw)}</td><td class="r num">${num(r.ratio)}</td><td>${pill(r)}</td></tr>`)}</tbody>
  </table>` : html`<div class="empty">No projects yet. <a href="#/projects/new">Create one</a>.</div>`}
</div>`;
}

// ---- one project -----------------------------------------------------------------------

/** Copy the sizing form's inputs onto a copy of the project record. */
function applyForm(p, fd) {
  const out = { ...p };
  out.module_id = fkey(fd, "module_id");
  out.inverter_id = fkey(fd, "inverter_id");
  for (const k of ["module_count", "strings", "inverter_qty"]) out[k] = int(fd, k);
  for (const k of DESIGN_FLOATS) out[k] = float(fd, k);
  out.phases = str(fd, "phases") === "1" ? 1 : 3;
  out.mppt_layout = str(fd, "mppt_layout").replace(/\s/g, "");
  out.hv_connectors = str(fd, "hv_connectors") === "yes";
  out.rule_profile_id = fkey(fd, "rule_profile_id");
  return out;
}

export async function sizing(main, { params, query }) {
  const all = await loadAll();
  const raw = all.projects.find((x) => x.id === params.id);
  if (!raw) { main.innerHTML = `<div class="panel empty">Project not found.</div>`; return; }
  const p = all.full(raw);
  setTitle("Sizing · " + p.name);
  const settings = settingsFor(p, all);
  const r = projectCheck(p, all);
  const inverters = sortInverters(all.inverters);

  // recommendations (from the query string, so the browser's back button keeps them)
  let options = null, rec = null;
  if (query.target_kind in TARGETS) {
    const tval = Number(String(query.target || "").replace(/,/g, "")) || 0;
    const mod = all.module.get(Number(query.module_id)) || p.module;
    let invs = inverters;
    if (query.scope in CATEGORIES) invs = invs.filter((v) => v.category === query.scope);
    else if (/^\d+$/.test(query.scope || "")) invs = invs.filter((v) => v.id === Number(query.scope));
    const base = { ...designFrom(p, mod, p.inverter) };
    options = mod ? recommend(base, invs, settings, query.target_kind, tval) : [];
    rec = { target_kind: query.target_kind, target: query.target, scope: query.scope || "any", module: mod };
  }
  const recModule = rec ? rec.module?.id : p.module_id;

  main.innerHTML = html`
<div class="head">
  <div><h1>String &amp; inverter sizing</h1><div class="muted"><a href="#/projects/${p.id}">${p.name}</a> · ${p.client?.name}</div></div>
  <div class="actions"><a class="btn" href="#/projects/${p.id}/yield">Yield simulation</a><a class="btn" href="#/projects/${p.id}">Back to project</a></div>
</div>

<div class="panel">
  <h2>Recommend a design</h2>
  <form id="rec-form" class="fields">
    <label class="wide">PV module <select name="module_id">${moduleOptions(all.modules, recModule, { blank: null, readiness: true })}</select></label>
    <label>Design for <select name="target_kind">${Object.entries(TARGETS).map(([k, lab]) => html`<option value="${k}" ${sel(rec && rec.target_kind === k)}>${lab}</option>`)}</select></label>
    <label>Target <input name="target" value="${rec ? rec.target : g(dcKwp(p))}" inputmode="decimal" required></label>
    <label>Inverters to consider
      <select name="scope"><option value="any">Any in the library</option>
        ${Object.entries(CATEGORIES).map(([k, lab]) => html`<option value="${k}" ${sel(rec && rec.scope === k)}>${lab} only</option>`)}
        ${inverters.map((v) => html`<option value="${v.id}" ${sel(rec && rec.scope === String(v.id))}>${v.make} ${v.model} only</option>`)}
      </select></label>
    <div><label>&nbsp;</label><button class="btn primary">Recommend</button></div>
  </form>
  <p class="small muted">Uses this project's phases (${p.phases}-phase), temperatures, connector choice and connection limit. Only designs that pass every hard rule are shown.</p>
  ${options === null ? "" : options.length ? html`
  <table>
    <thead><tr><th>Inverter</th><th class="r">Qty</th><th class="r">Modules</th><th>Strings</th><th class="r">DC kWp</th><th class="r">AC kW</th><th class="r">DC/AC</th><th>Check</th><th></th></tr></thead>
    <tbody>${options.map((o, i) => {
      const w = warnings(o.result);
      return html`<tr>
        <td>${o.inverter.make} ${o.inverter.model}</td><td class="r num">${o.inverter_qty}</td><td class="r num">${o.module_count}</td>
        <td class="num">${o.strings} × ${o.modules_per_string}</td><td class="r num">${num(o.result.dc_kwp)}</td><td class="r num">${num(o.result.ac_kw)}</td><td class="r num">${num(o.result.ratio)}</td>
        <td>${w.length ? html`<span class="pill warn" title="${w.map((c) => c.label).join("; ")}">${plural(w.length, "warning")}</span>` : html`<span class="pill ok">passes</span>`}</td>
        <td><button class="btn small" data-use="${i}">Use this</button></td></tr>
        ${w.length ? html`<tr class="sub"><td colspan="9" class="small muted">${w.map((c) => c.label).join(" · ")}</td></tr>` : ""}`;
    })}</tbody>
  </table>` : rec.module && !moduleReady(rec.module) ? html`<div class="flash warn">${moduleLabel(rec.module)} has no electrical values yet. Add them in the <a href="#/library/module/${rec.module.id}">equipment library</a>.</div>`
    : html`<div class="flash warn">No design passes every hard rule for that target. Try another inverter range or target, or check the temperatures and connection limit below.</div>`}
</div>

<div class="grid-sizing">
  <form id="sizing-form" class="panel">
    <h2>Design</h2>
    <div class="fields one">
      <label>PV module <select name="module_id">${moduleOptions(all.modules, p.module_id)}</select></label>
      <div class="pair">
        <label>Modules <input name="module_count" value="${p.module_count || ""}" inputmode="numeric"></label>
        <label>Strings <input name="strings" value="${p.strings || ""}" inputmode="numeric"></label>
      </div>
      <label>Inverter <select name="inverter_id">${inverterOptions(all.inverters, p.inverter_id)}</select></label>
      <div class="pair">
        <label>Inverter quantity <input name="inverter_qty" value="${p.inverter_qty || ""}" inputmode="numeric"></label>
        <label>Strings per MPPT <input name="mppt_layout" value="${p.mppt_layout || ""}" placeholder="automatic"><span class="hint">Per inverter, e.g. 2/1</span></label>
      </div>
      <div><label>Connection</label><div class="radios">
        <label><input type="radio" name="phases" value="1" ${chk(Number(p.phases) === 1)}> 1 phase</label>
        <label><input type="radio" name="phases" value="3" ${chk(Number(p.phases) !== 1)}> 3 phases</label></div></div>
      <label>Connection limit (kW AC) <input name="connection_limit_kw" value="${g(p.connection_limit_kw)}" inputmode="decimal"><span class="hint">Approved load, spare transformer capacity or POC limit. Blank = none</span></label>
      <label class="check"><input type="checkbox" name="hv_connectors" value="yes" ${chk(p.hv_connectors)}> High-voltage DC connectors fitted (e.g. MC4 Evo2)</label>
    </div>
    <h3 class="spaced">Site temperatures</h3>
    <div class="pair">
      <label>Record low (°C) <input name="t_min_c" value="${g(p.t_min_c)}" placeholder="${g(settings.values.t_min_c)}" inputmode="decimal"></label>
      <label>Max. ambient (°C) <input name="t_max_c" value="${g(p.t_max_c)}" placeholder="${g(settings.values.t_max_c)}" inputmode="decimal"></label>
    </div>
    <p class="small muted">Blank uses the rule profile's value (shown greyed). The typical-year weather on the yield page doesn't give the record low, so enter it from local records.</p>
    <h3 class="spaced">Cables <span class="muted">(optional)</span></h3>
    <div class="pair">
      <label>DC string run, one way (m) <input name="dc_cable_m" value="${g(p.dc_cable_m)}" inputmode="decimal"></label>
      <label>DC size (mm²) <input name="dc_cable_mm2" value="${g(p.dc_cable_mm2)}" inputmode="decimal"></label>
      <label>AC run to POC (m) <input name="ac_cable_m" value="${g(p.ac_cable_m)}" inputmode="decimal"></label>
      <label>AC size (mm²) <input name="ac_cable_mm2" value="${g(p.ac_cable_mm2)}" inputmode="decimal"></label>
    </div>
    <h3 class="spaced">Rules</h3>
    <label>Rule profile
      <select name="rule_profile_id"><option value="">Default</option>
        ${byName(all.profiles).map((x) => html`<option value="${x.id}" ${sel(x.id === p.rule_profile_id)}>${x.name}${x.is_default ? " (default)" : ""}</option>`)}
      </select><span class="hint"><a href="#/rules">Edit rule profiles</a></span></label>
    <div class="bar"><button class="btn primary">Save design</button></div>
  </form>
  <div class="panel">
    <div class="panel-head"><h2>Rules check</h2><span class="small muted" id="preview-state">Checks as you type</span></div>
    <div id="sizing-results">${results(r)}</div>
  </div>
</div>`;

  main.querySelector("#rec-form").addEventListener("submit", (e) => {
    e.preventDefault();
    go(`#/projects/${p.id}/sizing?` + new URLSearchParams(new FormData(e.target)).toString());
  });

  main.querySelectorAll("[data-use]").forEach((btn) => btn.addEventListener("click", async () => {
    const o = options[Number(btn.dataset.use)];
    await db.put("projects", { ...raw, module_id: rec.module.id, inverter_id: o.inverter.id, inverter_qty: o.inverter_qty,
                               module_count: o.module_count, strings: o.strings, mppt_layout: "",
                               internal_transformer: !!o.inverter.internal_transformer });
    toast(`Applied: ${o.module_count} modules in ${o.strings} strings on ${o.inverter_qty} × ${o.inverter.model}. Change anything below; every change is re-checked.`, "ok", 7000);
    go(`#/projects/${p.id}/sizing`);
  }));

  const f = main.querySelector("#sizing-form");
  const box = main.querySelector("#sizing-results"), state = main.querySelector("#preview-state");
  const draft = () => full(applyForm(raw, new FormData(f)), all);
  let timer = null;
  const live = () => {
    clearTimeout(timer);
    timer = setTimeout(() => {
      const d = draft();
      box.innerHTML = results(check(designFrom(d, d.module, d.inverter), settingsFor(d, all)));
      state.textContent = "Not saved yet";
    }, 150);
  };
  f.addEventListener("input", live);
  f.addEventListener("change", live);
  f.addEventListener("submit", async (e) => {
    e.preventDefault();
    const rec2 = applyForm(raw, new FormData(f));
    await db.put("projects", rec2);
    const d = full(rec2, all);
    const res = check(designFrom(d, d.module, d.inverter), settingsFor(d, all));
    if (fails(res).length) toast(`Design saved. ${fails(res).length} hard rule(s) fail, so reports are blocked.`, "error");
    else if (unknown(res).length) toast("Design saved. Some rules can't be checked yet: see 'Missing'.", "warn");
    else toast("Design saved." + (warnings(res).length ? ` ${warnings(res).length} warning(s).` : " Every rule passes."), warnings(res).length ? "warn" : "ok");
    go(`#/projects/${p.id}/sizing`);
  });
}
