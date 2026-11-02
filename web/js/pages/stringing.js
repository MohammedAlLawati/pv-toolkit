// Stringing calculator: modules per string, strings per MPPT and the voltage / current checks for
// one module and one inverter, with or without a project. The maths is in sizing/stringing.js.
import { chk, g, go, html, num, sel, toast } from "../ui.js";
import * as db from "../store.js";
import { byName, byUpdated, loadAll, settingsFor } from "../data.js";
import { inverterReady, moduleLabel, moduleReady, inverterLabel } from "../equipment_fields.js";
import { inverterOptions, moduleOptions } from "../options.js";
import { checkLayout, fillLayout, inverterMax, lengthTable, mpptCapacity, splitModules, stringLimits } from "../sizing/stringing.js";
import { setTitle } from "../app.js";

const KEY = "pv-toolkit-stringing";
const MARK = { pass: "✓", warn: "!", fail: "✕" };
const plural = (n, word) => `${n} ${word}${n === 1 ? "" : "s"}`;

function remembered() {
  try { return JSON.parse(localStorage.getItem(KEY) || "{}") || {}; } catch { return {}; }
}
function remember(st) {
  try { localStorage.setItem(KEY, JSON.stringify(st)); } catch { /* not remembered */ }
}
const numOrNull = (v) => {
  const s = String(v ?? "").replace(/,/g, "").trim();
  return s === "" || !Number.isFinite(Number(s)) ? null : Number(s);
};

export async function stringing(main, { query }) {
  setTitle("Stringing calculator");
  const all = await loadAll();
  const project = query.project ? all.projects.find((x) => x.id === Number(query.project)) : null;

  // starting inputs: the project's, else what was used last time in this browser
  const last = remembered();
  const st = project
    ? { module_id: project.module_id, inverter_id: project.inverter_id, t_min_c: project.t_min_c ?? null, t_max_c: project.t_max_c ?? null,
        hv_connectors: !!project.hv_connectors, rule_profile_id: project.rule_profile_id || null,
        total_modules: project.module_count || null, inverter_qty: project.inverter_qty || null, rows: [] }
    : { module_id: null, inverter_id: null, t_min_c: null, t_max_c: null, hv_connectors: false, rule_profile_id: null,
        total_modules: null, inverter_qty: null, rows: [], ...last };
  if (!all.module.get(st.module_id)) st.module_id = null;
  if (!all.inverter.get(st.inverter_id)) st.inverter_id = null;

  const settings = () => settingsFor({ rule_profile_id: st.rule_profile_id }, all);
  const ready = all.modules.length && all.inverters.length;

  main.innerHTML = html`
<div class="head">
  <div><h1>Stringing calculator</h1><div class="muted">Modules per string, strings per MPPT and the voltage and current checks for one module and inverter${project ? html` · <a href="#/projects/${project.id}">${project.name}</a>` : ""}.</div></div>
  <div class="actions">${project ? html`<a class="btn" href="#/projects/${project.id}/sizing">Project sizing</a>` : ""}<a class="btn" href="#/rules">Design rules</a></div>
</div>
${ready ? "" : html`<div class="flash warn">The equipment library needs at least one module and one inverter. <a href="#/library">Open the library</a> to load the built-in Jinko and Sungrow ranges.</div>`}
<div class="grid-sizing">
  <form id="str-form" class="panel" autocomplete="off">
    <h2>Equipment and site</h2>
    <div class="fields one">
      <label>PV module <select name="module_id">${moduleOptions(all.modules, st.module_id, { readiness: true })}</select></label>
      <label>Inverter <select name="inverter_id">${inverterOptions(all.inverters, st.inverter_id)}</select></label>
      <div class="pair">
        <label>Record low (°C) <input name="t_min_c" value="${g(st.t_min_c)}" placeholder="${g(settings().values.t_min_c)}" inputmode="decimal"></label>
        <label>Max. ambient (°C) <input name="t_max_c" value="${g(st.t_max_c)}" placeholder="${g(settings().values.t_max_c)}" inputmode="decimal"></label>
      </div>
      <label class="check"><input type="checkbox" name="hv_connectors" value="yes" ${chk(st.hv_connectors)}> High-voltage DC connectors fitted (e.g. MC4 Evo2)</label>
      <label>Rule profile
        <select name="rule_profile_id"><option value="">Default</option>
          ${byName(all.profiles).map((x) => html`<option value="${x.id}" ${sel(x.id === st.rule_profile_id)}>${x.name}${x.is_default ? " (default)" : ""}</option>`)}
        </select><span class="hint">Sets the safety factor, hot-cell irradiance, DC/AC band and which checks are hard rules.</span></label>
      ${all.projects.length ? html`<label>Start from a project
        <select name="from_project"><option value="">—</option>
          ${byUpdated(all.projects).map((x) => html`<option value="${x.id}" ${sel(project && x.id === project.id)}>${x.name}</option>`)}
        </select><span class="hint">Copies its module, inverter, temperatures and module count.</span></label>` : ""}
    </div>
    <p class="small muted">Blank temperatures use the rule profile's values (greyed). Cells are taken at the record low for the cold checks, and at max. ambient + (NOCT − 20) / 800 × irradiance for the hot ones.</p>
  </form>
  <div class="panel"><div id="str-results"></div></div>
</div>
<div class="panel" id="str-layout"></div>`;

  const form = main.querySelector("#str-form");
  const resultsBox = main.querySelector("#str-results");
  const layoutBox = main.querySelector("#str-layout");

  let ctx = null; // { m, inv, s, lim, caps } for the current equipment

  function readForm() {
    const fd = new FormData(form);
    st.module_id = numOrNull(fd.get("module_id"));
    st.inverter_id = numOrNull(fd.get("inverter_id"));
    st.t_min_c = numOrNull(fd.get("t_min_c"));
    st.t_max_c = numOrNull(fd.get("t_max_c"));
    st.hv_connectors = fd.get("hv_connectors") === "yes";
    st.rule_profile_id = numOrNull(fd.get("rule_profile_id"));
  }

  function compute() {
    const m = all.module.get(st.module_id), inv = all.inverter.get(st.inverter_id), s = settings();
    if (!m || !inv) return { m, inv, s, msg: "Choose a module and an inverter." };
    if (!moduleReady(m)) return { m, inv, s, msg: html`${moduleLabel(m)} has no electrical values yet. <a href="#/library/module/${m.id}">Add them in the library</a>.` };
    if (!inverterReady(inv)) return { m, inv, s, msg: html`${inverterLabel(inv)} is missing its MPPT values. <a href="#/library/inverter/${inv.id}">Add them in the library</a>.` };
    const lim = stringLimits(m, inv, st, s);
    return { m, inv, s, lim, caps: mpptCapacity(inv, lim, s) };
  }

  function renderResults() {
    if (!ctx.lim) { resultsBox.innerHTML = html`<div class="empty">${ctx.msg}</div>`; return; }
    const { m, inv, s, lim, caps } = ctx;
    const mx = inverterMax(m, inv, lim, caps);
    const t = lim.t, mv = lim.mv;
    const rows = lengthTable(lim, s);
    const stdCap = caps.reduce((a, c) => a + (c.connectors || 0), 0);
    resultsBox.innerHTML = html`
<div class="panel-head"><h2>Results</h2><span class="small muted">${moduleLabel(m)} on ${inverterLabel(inv)}</span></div>
${lim.range ? "" : html`<div class="flash error">No string length passes every hard rule with this module and inverter.</div>`}
<div class="summary">
  <div><span>Modules per string</span><b>${lim.range ? `${lim.range[0]}–${lim.range[1]}` : "none"}</b>${lim.preferred && lim.range && (lim.preferred[0] !== lim.range[0] || lim.preferred[1] !== lim.range[1]) ? html`<small class="muted">${lim.preferred[0]}–${lim.preferred[1]} with no warnings</small>` : ""}</div>
  <div><span>Strings per inverter (max.)</span><b>${mx ? mx.strings : "—"}</b>${mx && mx.strings < stdCap ? html`<small class="muted">of ${stdCap} inputs</small>` : ""}</div>
  <div><span>Modules per inverter (max.)</span><b>${mx ? mx.modules : "—"}</b>${mx ? html`<small class="muted">${num(mx.kwp)} kWp</small>` : ""}</div>
  <div><span>DC/AC at the max.</span><b>${mx ? num(mx.ratio) : "—"}</b>${inv.max_dc_kw ? html`<small class="muted">inverter max. ${g(inv.max_dc_kw)} kWp</small>` : ""}</div>
</div>

<h3>One module at the design temperatures</h3>
<dl class="kv">
  <dt>Temperatures</dt><dd>cold cell ${num(t.cell_cold, 1)} °C · hot cell ${num(t.cell_hot, 1)} °C (max. ambient ${num(t.t_max, 1)} °C, NOCT ${num(t.noct, 0)} °C)</dd>
  <dt>Voc</dt><dd>${num(m.voc, 2)} V at STC → ${num(mv.voc_cold, 2)} V cold</dd>
  <dt>Vmp</dt><dd>${num(mv.vmp_cold, 2)} V cold · ${num(m.vmp, 2)} V STC · ${num(mv.vmp_hot, 2)} V hot</dd>
  <dt>Current for the checks</dt><dd>Isc ${num(mv.isc_design, 2)} A (${num(m.isc, 2)} A × ${g(s.values.isc_factor)}${m.bifaciality ? ` × bifacial gain ${num(1 + (m.bifaciality * s.values.rear_irradiance) / 1000, 3)}` : ""}) · operating ${num(mv.imp_design, 2)} A</dd>
</dl>

<h3 class="spaced">What limits the string length</h3>
<table class="checks">
  <thead><tr><th>Limit</th><th class="r">Volts</th><th class="r">Per module</th><th class="r">Modules</th></tr></thead>
  <tbody>
    ${lim.max.map((x) => html`<tr><td>${x.label}${x.hard ? "" : html` <span class="pill warn">warning</span>`}${x.hard && lim.range && x.n === lim.range[1] ? html` <span class="pill">sets the max.</span>` : ""}</td><td class="r num">≤ ${g(x.volts)} V</td><td class="r num">${num(x.per, 2)} V</td><td class="r num"><b>max. ${x.n}</b></td></tr>`)}
    ${lim.min.map((x) => html`<tr><td>${x.label}${x.hard ? "" : html` <span class="pill warn">warning</span>`}${x.hard && lim.range && x.n === lim.range[0] ? html` <span class="pill">sets the min.</span>` : ""}</td><td class="r num">≥ ${g(x.volts)} V</td><td class="r num">${num(x.per, 2)} V</td><td class="r num"><b>min. ${x.n}</b></td></tr>`)}
  </tbody>
</table>

<h3 class="spaced">String voltage by length</h3>
<div class="table-scroll"><table class="mppt str-table">
  <thead><tr><th></th><th class="r">Modules</th><th class="r">kWp</th><th class="r">Voc cold</th><th class="r">Vmp cold</th><th class="r">Vmp STC</th><th class="r">Vmp hot</th><th>Notes</th></tr></thead>
  <tbody>${rows.map((r) => html`<tr class="ck-${r.status}${lim.range && r.L >= lim.range[0] && r.L <= lim.range[1] ? "" : " out"}">
    <td><span class="ck">${MARK[r.status]}</span></td><td class="r num"><b>${r.L}</b></td><td class="r num">${num((r.L * m.wp) / 1000)}</td>
    <td class="r num">${num(r.voc_cold, 0)}</td><td class="r num">${num(r.vmp_cold, 0)}</td><td class="r num">${num(r.vmp, 0)}</td><td class="r num">${num(r.vmp_hot, 0)}</td>
    <td class="small">${r.issues.map((x) => `${x.over ? "above" : "below"} ${x.label.split(" (")[0]} (${g(x.volts)} V)`).join("; ")}</td></tr>`)}</tbody>
</table></div>

<h3 class="spaced">Strings each MPPT takes</h3>
<table class="mppt">
  <thead><tr><th>MPPT</th><th class="r">Inputs</th><th class="r">By Isc</th><th class="r">By current</th><th class="r">Max. strings</th><th>Set by</th></tr></thead>
  <tbody>${caps.map((c) => html`<tr><td>${c.index}</td><td class="r num">${c.connectors ?? "—"}</td>
    <td class="r num">${c.by_isc ?? "—"}${c.isc_limit ? html` <small class="muted">(${g(c.isc_limit)} A)</small>` : ""}</td>
    <td class="r num">${c.by_imp ?? "—"}${c.imp_limit ? html` <small class="muted">(${g(c.imp_limit)} A)</small>` : ""}</td>
    <td class="r num"><b class="${c.cap === 0 ? "err-text" : ""}">${c.cap ?? "—"}</b></td><td class="small">${c.binding.join(", ")}</td></tr>`)}</tbody>
</table>
${caps.some((c) => c.by_imp !== null && c.cap !== null && c.by_imp < c.cap) ? html`<p class="small muted">Where "by current" is lower than the max., the strings fit but the MPPT will clip at its current limit on bright days (a warning in the default profile).</p>` : ""}
${caps.some((c) => c.cap === 0) ? html`<div class="note small">An MPPT that can't take one string: the string's short-circuit current (${num(mv.isc_design, 1)} A with the safety factor) is above that MPPT's limit.</div>` : ""}
${inv.notes ? html`<div class="note small">${inv.make} ${inv.model}: ${inv.notes}</div>` : ""}`;
  }

  // ---- layout panel ---------------------------------------------------------------------

  let fills = []; // whole-system suggestions: [{ count, modules, fill }]

  function renderLayout() {
    if (!ctx.lim) { layoutBox.innerHTML = html`<h2>MPPT layout</h2><div class="empty">${ctx.msg}</div>`; return; }
    const { caps, inv, m } = ctx;
    const rows = caps.map((_, i) => st.rows[i] || { strings: null, length: null });
    layoutBox.innerHTML = html`
<div class="panel-head"><h2>MPPT layout</h2><span class="small muted">One inverter. Each MPPT can have its own string length.</span></div>
<form id="sys-form" class="fields">
  <label>Modules in the system <input name="total_modules" value="${g(st.total_modules)}" inputmode="numeric" placeholder="e.g. 120"></label>
  <label>Inverters <input name="inverter_qty" value="${g(st.inverter_qty)}" inputmode="numeric" placeholder="1"></label>
  <div><label>&nbsp;</label><button class="btn primary">Suggest stringing</button></div>
</form>
<div id="sys-out">${fillsHtml()}</div>
<h3 class="spaced">Edit the layout</h3>
<div class="table-scroll"><table class="mppt str-layout">
  <thead><tr><th>MPPT</th><th>Strings</th><th>Modules per string</th><th class="r">Modules</th><th class="r">Voc cold</th><th class="r">Vmp hot</th><th class="r">Isc / limit</th><th class="r">Current / limit</th><th>Check</th></tr></thead>
  <tbody>${rows.map((r, i) => html`<tr data-row="${i}">
    <td>${i + 1}<div class="small muted">max. ${caps[i].cap ?? "—"}</div></td>
    <td><input name="strings" value="${g(r.strings)}" inputmode="numeric" size="3"></td>
    <td><input name="length" value="${g(r.length)}" inputmode="numeric" size="3"></td>
    <td class="r num" data-c="modules"></td><td class="r num" data-c="voc"></td><td class="r num" data-c="vmp"></td>
    <td class="r num" data-c="isc"></td><td class="r num" data-c="imp"></td><td class="small" data-c="check"></td></tr>`)}</tbody>
</table></div>
<div id="layout-total"></div>
<div class="bar">
  <button type="button" class="btn" id="lay-clear">Clear</button>
  <button type="button" class="btn" id="lay-copy">Copy as text</button>
  ${project ? html`<button type="button" class="btn sun" id="lay-apply">Apply to ${project.name}</button>` : ""}
</div>
<p class="small muted">${inv.model}: ${plural(caps.length, "MPPT")}. Strings in parallel on one MPPT must be the same length; use separate MPPTs for different lengths or roof faces.</p>`;
    wireLayout();
    updateLayout();
  }

  function fillsHtml() {
    if (!fills.length) return "";
    const { m } = ctx;
    return html`<table class="mppt">
  <thead><tr><th>Inverters</th><th class="r">Modules each</th><th>Stringing (per MPPT)</th><th class="r">kWp each</th><th class="r">DC/AC</th><th></th></tr></thead>
  <tbody>${fills.map((f, i) => html`<tr>
    <td>${f.count} ×</td><td class="r num">${f.modules}</td>
    <td>${f.fill ? f.fill.rows.map((r) => (r.strings ? `${r.strings}×${r.length}` : "–")).join(" / ") : html`<span class="err-text">no layout fits</span>`}
      ${f.fill && f.fill.modules < f.modules ? html`<div class="small err-text">${f.modules - f.fill.modules} module(s) left over: at most ${f.fill.modules} fit one inverter</div>` : ""}</td>
    <td class="r num">${f.fill ? num((f.fill.modules * m.wp) / 1000) : "—"}</td>
    <td class="r num">${f.fill && ctx.inv.ac_kw ? num((f.fill.modules * m.wp) / 1000 / ctx.inv.ac_kw) : "—"}</td>
    <td>${f.fill ? html`<button type="button" class="btn small" data-edit="${i}">Edit</button>` : ""}</td></tr>`)}</tbody>
</table>
<p class="small muted">Written as strings × modules per string for each MPPT. Fewest strings first, one string length where the count allows, otherwise two lengths on separate MPPTs.</p>`;
  }

  function wireLayout() {
    const sys = layoutBox.querySelector("#sys-form");
    sys.addEventListener("submit", (e) => {
      e.preventDefault();
      const fd = new FormData(sys);
      st.total_modules = numOrNull(fd.get("total_modules"));
      st.inverter_qty = numOrNull(fd.get("inverter_qty")) || 1;
      sys.inverter_qty.value = st.inverter_qty;
      suggest();
      layoutBox.querySelector("#sys-out").innerHTML = fillsHtml();
      if (fills.length && fills[0].fill) loadRows(fills[fills.length - 1].fill.rows);
      remember(st);
    });
    layoutBox.querySelector("#sys-out").addEventListener("click", (e) => {
      const b = e.target.closest("[data-edit]");
      if (b) loadRows(fills[Number(b.dataset.edit)].fill.rows);
    });
    layoutBox.querySelector("tbody").addEventListener("input", () => { readRows(); updateLayout(); remember(st); });
    layoutBox.querySelector("#lay-clear").addEventListener("click", () => loadRows([]));
    layoutBox.querySelector("#lay-copy").addEventListener("click", copyText);
    layoutBox.querySelector("#lay-apply")?.addEventListener("click", applyToProject);
  }

  function suggest() {
    const groups = splitModules(st.total_modules, st.inverter_qty || 1);
    fills = groups.map((gr) => ({ ...gr, fill: fillLayout(ctx.lim, ctx.caps, gr.modules) }));
  }

  function loadRows(rows) {
    st.rows = ctx.caps.map((_, i) => ({ strings: rows[i]?.strings || null, length: rows[i]?.strings ? rows[i].length : null }));
    layoutBox.querySelectorAll("tr[data-row]").forEach((tr, i) => {
      tr.querySelector("[name=strings]").value = g(st.rows[i].strings);
      tr.querySelector("[name=length]").value = g(st.rows[i].length);
    });
    updateLayout();
    remember(st);
  }

  function readRows() {
    st.rows = [...layoutBox.querySelectorAll("tr[data-row]")].map((tr) => ({
      strings: numOrNull(tr.querySelector("[name=strings]").value),
      length: numOrNull(tr.querySelector("[name=length]").value),
    }));
  }

  function updateLayout() {
    const { m, inv, s, lim, caps } = ctx;
    const res = checkLayout(m, inv, lim, caps, st.rows, s);
    layoutBox.querySelectorAll("tr[data-row]").forEach((tr, i) => {
      const r = res.mppts[i];
      const set = (c, v) => { tr.querySelector(`[data-c=${c}]`).innerHTML = v; };
      tr.className = r.status === "empty" ? "" : `ck-${r.status}`;
      const on = r.strings && r.length;
      set("modules", on ? String(r.modules) : "");
      set("voc", on ? `${num(r.len.voc_cold, 0)} V` : "");
      set("vmp", on ? `${num(r.len.vmp_hot, 0)} V` : "");
      set("isc", r.strings ? `${num(r.isc, 1)} / ${r.isc_limit ? g(r.isc_limit) : "—"} A` : "");
      set("imp", r.strings ? `${num(r.imp, 1)} / ${r.imp_limit ? g(r.imp_limit) : "—"} A` : "");
      set("check", r.status === "empty" ? "" : String(html`<span class="ck">${MARK[r.status]}</span> ${r.problems.map((p) => p.text).join("; ") || "OK"}`));
    });
    const word = { pass: "Every check passes", warn: "Passes, with warnings", fail: "A hard rule fails" }[res.status];
    layoutBox.querySelector("#layout-total").innerHTML = res.strings ? html`
<div class="verdict ${res.status}"><b>${word}</b><span>${plural(res.strings, "string")} · ${res.modules} modules · ${num(res.kwp)} kWp · DC/AC ${num(res.ratio)}</span></div>
${res.issues.map((x) => html`<div class="ck-line ck-${x.hard ? "fail" : "warn"} small">${x.text}</div>`)}
${(res.notes || []).map((n) => html`<div class="note small">${n}</div>`)}` : "";
  }

  function layoutText() {
    const { m, inv } = ctx;
    const res = checkLayout(m, inv, ctx.lim, ctx.caps, st.rows, ctx.s);
    const lines = [`${moduleLabel(m)} on ${inverterLabel(inv)}`,
      `Record low ${num(ctx.lim.t.t_min, 1)} °C, hot cell ${num(ctx.lim.t.cell_hot, 1)} °C. Allowed string length ${ctx.lim.range ? ctx.lim.range.join("–") : "none"} modules.`];
    res.mppts.forEach((r) => {
      if (!r.strings) return;
      lines.push(`MPPT ${r.index}: ${r.strings} × ${r.length} modules · Voc cold ${num(r.len?.voc_cold, 0)} V · Vmp hot ${num(r.len?.vmp_hot, 0)} V · Isc ${num(r.isc, 1)} A`);
    });
    lines.push(`Total: ${plural(res.strings, "string")}, ${res.modules} modules, ${num(res.kwp)} kWp, DC/AC ${num(res.ratio)}`);
    if (fills.length > 1 || (fills[0] && fills[0].count > 1)) {
      lines.push("", "Whole system:");
      for (const f of fills) lines.push(`${f.count} × inverter with ${f.fill ? f.fill.rows.map((r) => (r.strings ? `${r.strings}×${r.length}` : "–")).join(" / ") : "no layout"}`);
    }
    return lines.join("\n");
  }

  async function copyText() {
    try { await navigator.clipboard.writeText(layoutText()); toast("Copied the stringing schedule.", "ok"); }
    catch { toast("The browser didn't allow copying.", "error"); }
  }

  async function applyToProject() {
    const { m, inv } = ctx;
    const res = checkLayout(m, inv, ctx.lim, ctx.caps, st.rows, ctx.s);
    const lens = [...new Set(res.mppts.filter((r) => r.strings).map((r) => r.length))];
    if (!res.strings || lens.length !== 1) {
      toast("The project's design holds one string length for every inverter. Use a single length here to apply it, or note the mixed layout on the project.", "warn", 8000);
      return;
    }
    const qty = st.inverter_qty || project.inverter_qty || 1;
    const raw = all.projects.find((x) => x.id === project.id);
    await db.put("projects", { ...raw, module_id: m.id, inverter_id: inv.id, inverter_qty: qty,
      module_count: res.modules * qty, strings: res.strings * qty,
      mppt_layout: res.mppts.map((r) => r.strings || 0).join("/"),
      t_min_c: st.t_min_c, t_max_c: st.t_max_c, hv_connectors: st.hv_connectors,
      internal_transformer: !!inv.internal_transformer });
    toast(`Applied to ${project.name}: ${qty} × ${inv.model}, ${res.strings * qty} strings of ${lens[0]}.`
      + (fills.length > 1 ? " Every inverter gets this layout; the project can't hold a different one per inverter." : ""), "ok", 8000);
    go(`#/projects/${project.id}/sizing`);
  }

  // ---- wiring ----------------------------------------------------------------------------

  function refresh(equipmentChanged) {
    readForm();
    const prevInv = ctx?.inv?.id, prevMod = ctx?.m?.id;
    ctx = compute();
    renderResults();
    if (equipmentChanged || !ctx.lim || prevInv !== ctx.inv?.id || prevMod !== ctx.m?.id) {
      if (ctx.lim && st.total_modules) suggest(); else fills = [];
      renderLayout();
    } else if (ctx.lim) {
      if (st.total_modules) { suggest(); layoutBox.querySelector("#sys-out").innerHTML = fillsHtml(); }
      updateLayout();
    }
    remember(st);
  }

  form.addEventListener("input", () => refresh(false));
  form.addEventListener("change", (e) => {
    if (e.target.name === "from_project") {
      const id = e.target.value;
      go(id ? `#/stringing?project=${id}` : "#/stringing");
      return;
    }
    refresh(false);
  });
  form.addEventListener("submit", (e) => e.preventDefault());

  readForm();
  ctx = compute();
  if (ctx.lim && st.total_modules) {
    suggest();
    if (project && !st.rows.length && fills[0]?.fill) st.rows = fills[fills.length - 1].fill.rows;
  }
  renderResults();
  renderLayout();
}
