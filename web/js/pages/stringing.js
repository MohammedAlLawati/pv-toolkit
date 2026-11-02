// Stringing calculator. Start by linking the calculation to a client or working standalone; then
// a DC capacity and a module give inverter configurations (the offer deck's DC/AC logic), each
// strung from the library's limits, with a diagram and every calculation step on the page.
// The maths is in sizing/stringing.js.
import { chk, g, go, html, num, raw, sel, toast } from "../ui.js";
import * as db from "../store.js";
import { byName, loadAll, settingsFor } from "../data.js";
import { CATEGORIES, moduleLabel, moduleReady } from "../equipment_fields.js";
import { moduleOptions } from "../options.js";
import { tcVmpPct } from "../sizing/engine.js";
import { checkLayout, lengthTable, mpptCapacity, proposeDesigns } from "../sizing/stringing.js";
import { setTitle } from "../app.js";

const KEY = "pv-toolkit-stringing";
const MARK = { pass: "✓", warn: "!", fail: "✕" };
const DEFAULTS = { t_min_c: 0, t_max_c: 60, ratio_min: 0.8, ratio_ok: 1.2, ratio_max: 1.25, series_only: true, scope: "any", hv_connectors: false };
const TYPES = { residential: "Residential", commercial: "Commercial", other: "Other" };
const r2 = (x) => (x === null || x === undefined ? "—" : Number(x).toFixed(2));
const plural = (n, word) => `${n} ${word}${n === 1 ? "" : "s"}`;
const has = (v) => v !== null && v !== undefined && v !== "";

function remembered() {
  try { return JSON.parse(localStorage.getItem(KEY) || "{}") || {}; } catch { return {}; }
}
function remember(st) {
  const { rows, ...keep } = st;
  try { localStorage.setItem(KEY, JSON.stringify(keep)); } catch { /* not remembered */ }
}
const numOrNull = (v) => {
  const s = String(v ?? "").replace(/,/g, "").trim();
  return s === "" || !Number.isFinite(Number(s)) ? null : Number(s);
};

/** The DC capacity a client asked for (AC is taken at DC/AC 1.0), else its design record's. */
function clientDc(c, all) {
  if (!c) return { dc: null, note: "" };
  if (has(c.required_capacity_kw)) {
    return c.required_capacity_unit === "ac"
      ? { dc: Number(c.required_capacity_kw), note: `The client asked for ${g(c.required_capacity_kw)} kWac; taken as ${g(c.required_capacity_kw)} kWp (DC/AC 1.0). Change it if you want to overload.` }
      : { dc: Number(c.required_capacity_kw), note: `The client asked for ${g(c.required_capacity_kw)} kWp.` };
  }
  const p = all.projects.find((x) => x.client_id === c.id && x.module_id && x.module_count);
  const m = p && all.module.get(p.module_id);
  if (m) return { dc: (p.module_count * m.wp) / 1000, note: `From the client's design record: ${p.module_count} × ${m.wp} Wp.`, module_id: m.id };
  return { dc: null, note: "No required capacity on the client yet." };
}

// ---- entry: link to a client, or standalone --------------------------------------------

export async function stringing(main, { query }) {
  setTitle("Stringing calculator");
  const all = await loadAll();
  if (query.project) {
    const p = all.projects.find((x) => x.id === Number(query.project));
    go(p?.client_id ? `#/stringing?client=${p.client_id}` : "#/stringing?standalone=1");
    return;
  }
  const client = query.client ? all.client.get(Number(query.client)) : null;
  if (!client && !query.standalone) { chooser(main, all); return; }
  calculator(main, all, client);
}

function chooser(main, all) {
  const clients = byName(all.clients);
  main.innerHTML = html`
<div class="head"><div><h1>Stringing calculator</h1><div class="muted">Inverter configuration and stringing from a DC capacity and a module.</div></div></div>
<div class="link-choice">
  <form class="panel" id="link-client">
    <h2>Link it to a client</h2>
    <p class="muted small">The client's required capacity fills in, and you can save the result to the client.</p>
    ${clients.length ? html`<label>Client <select name="client" required><option value="">Choose…</option>
      ${clients.map((c) => html`<option value="${c.id}">${c.name}${c.client_type ? ` (${TYPES[c.client_type] || c.client_type})` : ""}</option>`)}</select></label>
      <div class="bar"><button class="btn primary">Continue with this client</button></div>`
      : html`<div class="empty">No clients yet. <a href="#/clients/new">Add one</a>.</div>`}
  </form>
  <div class="panel">
    <h2>Standalone calculation</h2>
    <p class="muted small">Not linked to anyone. Good for a quick check or an early enquiry; nothing is saved except your inputs in this browser.</p>
    <div class="bar"><a class="btn" href="#/stringing?standalone=1">Calculate without a client</a></div>
  </div>
</div>`;
  main.querySelector("#link-client")?.addEventListener("submit", (e) => {
    e.preventDefault();
    const id = new FormData(e.target).get("client");
    if (id) go(`#/stringing?client=${id}`);
  });
}

// ---- the calculator --------------------------------------------------------------------

function calculator(main, all, client) {
  setTitle(client ? `Stringing · ${client.name}` : "Stringing calculator");
  const last = remembered();
  const fromClient = clientDc(client, all);
  const saved = client?.stringing || null;
  const st = { ...DEFAULTS, module_id: null, dc_kwp: null, rule_profile_id: null, ...last, choice: 0, rows: [] };
  if (client) {
    st.dc_kwp = fromClient.dc ?? null;
    if (fromClient.module_id) st.module_id = fromClient.module_id;
    if (saved) Object.assign(st, { module_id: saved.module_id ?? st.module_id, dc_kwp: saved.dc_target_kwp ?? st.dc_kwp,
      t_min_c: saved.t_min_c ?? st.t_min_c, t_max_c: saved.t_max_c ?? st.t_max_c, series_only: saved.series_only ?? st.series_only,
      ratio_min: saved.ratio_min ?? st.ratio_min, ratio_ok: saved.ratio_ok ?? st.ratio_ok, ratio_max: saved.ratio_max ?? st.ratio_max });
  }
  if (!all.module.get(st.module_id)) st.module_id = all.modules.find(moduleReady)?.id ?? null;

  const ready = all.modules.length && all.inverters.length;
  main.innerHTML = html`
<div class="head">
  <div><h1>Stringing calculator</h1>
    <div class="muted">${client ? html`Linked to <a href="#/clients/${client.id}">${client.name}</a>${client.client_type ? ` · ${TYPES[client.client_type] || client.client_type}` : ""}` : "Standalone calculation"} · <a href="#/stringing">${client ? "change" : "link to a client"}</a></div></div>
  <div class="actions"><a class="btn" href="#/library">Equipment library</a><a class="btn" href="#/rules">Design rules</a></div>
</div>
${ready ? "" : html`<div class="flash warn">The equipment library needs at least one module and one inverter. <a href="#/library">Open the library</a> to load the built-in Jinko and Sungrow ranges.</div>`}
<div class="grid-sizing">
  <form id="str-form" class="panel" autocomplete="off">
    <h2>Inputs</h2>
    <div class="fields one">
      <label>DC capacity (kWp) <input name="dc_kwp" value="${g(st.dc_kwp)}" inputmode="decimal" placeholder="e.g. 100">
        ${client ? html`<span class="hint">${fromClient.note}</span>` : ""}</label>
      <label>PV module <select name="module_id">${moduleOptions(all.modules, st.module_id, { readiness: true })}</select></label>
      <label>Inverters to consider <select name="scope"><option value="any">Any in the library</option>
        ${Object.entries(CATEGORIES).map(([k, lab]) => html`<option value="${k}" ${sel(st.scope === k)}>${lab} only</option>`)}</select></label>
    </div>
    <h3 class="spaced">Operating temperature range</h3>
    <div class="pair">
      <label>Lowest (°C) <input name="t_min_c" value="${g(st.t_min_c)}" inputmode="decimal"></label>
      <label>Highest ambient (°C) <input name="t_max_c" value="${g(st.t_max_c)}" inputmode="decimal"></label>
    </div>
    <p class="small muted">Defaults 0–60 °C. The lowest is used for the cold voltages; the cell then heats above the highest ambient by (NOCT − 20) / 800 × irradiance.</p>
    <h3 class="spaced">DC/AC ratio</h3>
    <div class="trio">
      <label>Lowest <input name="ratio_min" value="${g(st.ratio_min)}" inputmode="decimal"></label>
      <label>Normal max. <input name="ratio_ok" value="${g(st.ratio_ok)}" inputmode="decimal"></label>
      <label>Overload max. <input name="ratio_max" value="${g(st.ratio_max)}" inputmode="decimal"></label>
    </div>
    <p class="small muted">Same rule as the offer deck: designs from the lowest to the overload max. are proposed, and anything above the normal max. is marked as overloaded.</p>
    <div class="fields one">
      <label class="check"><input type="checkbox" name="series_only" value="yes" ${chk(st.series_only)}> Series strings only (one string per MPPT, no parallel strings)</label>
      <label class="check"><input type="checkbox" name="hv_connectors" value="yes" ${chk(st.hv_connectors)}> High-voltage DC connectors fitted (e.g. MC4 Evo2)</label>
      <label>Rule profile
        <select name="rule_profile_id"><option value="">Default</option>
          ${byName(all.profiles).map((x) => html`<option value="${x.id}" ${sel(x.id === st.rule_profile_id)}>${x.name}${x.is_default ? " (default)" : ""}</option>`)}
        </select><span class="hint">Safety factor, hot-cell irradiance and which checks are hard rules.</span></label>
    </div>
  </form>
  <div class="panel" id="str-options"></div>
</div>
<div class="panel" id="str-design"></div>
<div class="panel" id="str-calc"></div>
<div class="panel" id="str-more"></div>`;

  const form = main.querySelector("#str-form");
  const boxOptions = main.querySelector("#str-options"), boxDesign = main.querySelector("#str-design");
  const boxCalc = main.querySelector("#str-calc"), boxMore = main.querySelector("#str-more");
  let ctx = null;

  function readForm() {
    const fd = new FormData(form);
    st.dc_kwp = numOrNull(fd.get("dc_kwp"));
    st.module_id = numOrNull(fd.get("module_id"));
    st.scope = String(fd.get("scope") || "any");
    for (const k of ["t_min_c", "t_max_c", "ratio_min", "ratio_ok", "ratio_max"]) st[k] = numOrNull(fd.get(k)) ?? DEFAULTS[k];
    st.series_only = fd.get("series_only") === "yes";
    st.hv_connectors = fd.get("hv_connectors") === "yes";
    st.rule_profile_id = numOrNull(fd.get("rule_profile_id"));
  }

  function compute() {
    const m = all.module.get(st.module_id);
    const base = settingsFor({ rule_profile_id: st.rule_profile_id }, all);
    const s = { ...base, values: { ...base.values, dcac_min: st.ratio_min, dcac_max: st.ratio_max } };
    const d = { t_min_c: st.t_min_c, t_max_c: st.t_max_c, hv_connectors: st.hv_connectors };
    if (!m) return { s, d, msg: "Choose a module." };
    if (!moduleReady(m)) return { s, d, m, msg: html`${moduleLabel(m)} has no electrical values yet. <a href="#/library/module/${m.id}">Add them in the library</a>.` };
    if (!st.dc_kwp) return { s, d, m, msg: "Enter the DC capacity." };
    const invs = all.inverters.filter((v) => st.scope === "any" || v.category === st.scope);
    const options = proposeDesigns(m, invs, d, s, { dc: st.dc_kwp, ratioMin: st.ratio_min, ratioMax: st.ratio_max, seriesOnly: st.series_only, limit: 8 });
    return { s, d, m, invs, options };
  }

  const band = (r) => (r > st.ratio_max + 1e-9 || r < st.ratio_min - 1e-9 ? "err" : r > st.ratio_ok + 1e-9 ? "warn" : "ok");
  const bandText = (r) => ({ ok: "within range", warn: "overloaded", err: "out of range" })[band(r)];

  function renderOptions() {
    if (ctx.msg) { boxOptions.innerHTML = html`<h2>Proposed configurations</h2><div class="empty">${ctx.msg}</div>`; return; }
    const { m, options } = ctx;
    const n = Math.max(1, Math.round((st.dc_kwp * 1000) / m.wp));
    boxOptions.innerHTML = html`
<div class="panel-head"><h2>Proposed configurations</h2><span class="small muted">${n} × ${g(m.wp)} Wp = ${num((n * m.wp) / 1000)} kWp</span></div>
${options.length ? html`<div class="table-scroll"><table class="options">
  <thead><tr><th></th><th>Inverters</th><th class="r">AC kW</th><th class="r">DC/AC</th><th class="r">Modules</th><th class="r">MPPTs used</th><th>Checks</th></tr></thead>
  <tbody>${options.map((o, i) => {
    const used = o.parts.reduce((t, p) => t + p.groups.reduce((u, gr) => u + gr.count * gr.fill.rows.filter((r) => r.strings).length, 0), 0);
    const total = o.parts.reduce((t, p) => t + p.qty * p.caps.length, 0);
    return html`<tr class="${i === st.choice ? "on" : ""}" data-pick="${i}">
      <td><input type="radio" name="pick" ${chk(i === st.choice)} aria-label="Choose"></td>
      <td>${o.label}</td><td class="r num">${num(o.ac_kw)}</td>
      <td class="r num"><span class="pill ${band(o.ratio)}">${r2(o.ratio)}</span></td>
      <td class="r num">${o.modules}${o.fits ? "" : html`<div class="small err-text">of ${o.target_modules}</div>`}</td>
      <td class="r num">${used} / ${total}</td>
      <td>${o.warnings ? html`<span class="pill warn" title="Passes the hard rules, with warnings">${plural(o.warnings, "warning")}</span>` : html`<span class="pill ok">passes</span>`}</td></tr>`;
  })}</tbody>
</table></div>
<p class="small muted">Fewest inverters first, then the DC/AC ratio closest to 1.0 (the offer deck's order). Ratios above ${g(st.ratio_ok)} are overloaded (allowed up to ${g(st.ratio_max)}, noted on the design).</p>`
  : html`<div class="flash warn">No inverter configuration in the library fits ${num(st.dc_kwp)} kWp with DC/AC ${g(st.ratio_min)}–${g(st.ratio_max)}${st.series_only ? " using series strings only. Try unticking 'Series strings only': larger systems usually need two strings in parallel on some MPPTs" : ""}.</div>`}`;
    boxOptions.querySelectorAll("[data-pick]").forEach((tr) => tr.addEventListener("click", () => {
      st.choice = Number(tr.dataset.pick);
      renderOptions(); renderDesign(); renderCalc(); renderMore();
    }));
  }

  const chosen = () => (ctx.options && ctx.options[st.choice]) || null;

  // ---- the diagram -----------------------------------------------------------------------

  function diagram(inv, rows, count) {
    const W = 760, MOD = 22, GAP = 3, PORT_X = 540, BOX_W = 210, SLOTS = 9;
    const lines = [];
    let y = 16;
    const ports = [];
    rows.forEach((r, i) => {
      const nStr = Math.max(r.strings || 0, 1);
      const top = y;
      const ys = [];
      for (let k = 0; k < nStr; k++) {
        const cy = top + k * 30 + 14;
        ys.push(cy);
        if (!r.strings) continue;
        // modules in series: all of them if few, else the first few, a gap, the last two
        const L = r.length;
        const shown = L <= SLOTS ? [...Array(L).keys()] : [0, 1, 2, 3, 4, -1, L - 2, L - 1];
        let x = 12;
        shown.forEach((idx, j) => {
          if (idx === -1) { lines.push(`<text x="${x + 10}" y="${cy + 4}" class="dg-dots">…</text>`); x += 24; return; }
          lines.push(`<rect x="${x}" y="${cy - 8}" width="${MOD}" height="16" rx="2" class="dg-mod"/>`);
          if (j < shown.length - 1 && shown[j + 1] !== -1) lines.push(`<line x1="${x + MOD}" y1="${cy}" x2="${x + MOD + GAP}" y2="${cy}" class="dg-wire"/>`);
          x += MOD + GAP;
        });
        lines.push(`<text x="${x + 6}" y="${cy + 4}" class="dg-txt">${L} in series</text>`);
        lines.push(`<path d="M${x + 96} ${cy} H${PORT_X - 70} L${PORT_X - 20} ${top + nStr * 15} H${PORT_X}" class="dg-wire"/>`);
      }
      const py = top + nStr * 15;
      ports.push({ i, py, used: !!r.strings, text: r.strings ? `${r.strings} × ${r.length}` : "not used" });
      if (!r.strings) lines.push(`<text x="12" y="${top + 18}" class="dg-off">MPPT ${i + 1}: no string</text>`);
      y = top + nStr * 30 + 10;
    });
    const H = Math.max(y + 6, 80);
    lines.push(`<rect x="${PORT_X}" y="6" width="${BOX_W}" height="${H - 12}" rx="6" class="dg-inv"/>`);
    lines.push(`<text x="${PORT_X + 140}" y="${H / 2 - 4}" class="dg-invtxt">${inv.model}</text>`);
    lines.push(`<text x="${PORT_X + 140}" y="${H / 2 + 12}" class="dg-invsub">${g(inv.ac_kw)} kW${count > 1 ? ` · × ${count}` : ""}</text>`);
    for (const p of ports) {
      lines.push(`<circle cx="${PORT_X}" cy="${p.py}" r="4" class="${p.used ? "dg-port" : "dg-port off"}"/>`);
      lines.push(`<text x="${PORT_X + 8}" y="${p.py + 4}" class="dg-ptxt${p.used ? "" : " off"}">MPPT ${p.i + 1}</text>`);
    }
    return raw(`<svg viewBox="0 0 ${W} ${H}" class="dg" role="img" aria-label="Stringing of ${inv.model}">${lines.join("")}</svg>`);
  }

  function groupText(rows) {
    return rows.map((r, i) => (r.strings ? `MPPT ${i + 1}: ${plural(r.strings, "string")} × ${r.length} modules` : null)).filter(Boolean);
  }

  function renderDesign() {
    const o = ctx.msg ? null : chosen();
    if (!o) { boxDesign.innerHTML = html`<h2>Stringing</h2><div class="empty">${ctx.msg || "Choose a configuration above."}</div>`; return; }
    const { m } = ctx;
    const allGroups = o.parts.flatMap((p) => p.groups.map((gr) => ({ p, gr })));
    const usedMppt = allGroups.reduce((t, { gr }) => t + gr.count * gr.fill.rows.filter((r) => r.strings).length, 0);
    const totalMppt = o.parts.reduce((t, p) => t + p.qty * p.caps.length, 0);
    const strings = allGroups.reduce((t, { gr }) => t + gr.count * gr.fill.strings, 0);
    const lengths = [...new Set(allGroups.flatMap(({ gr }) => gr.fill.rows.filter((r) => r.strings).map((r) => r.length)))].sort((a, b) => b - a);
    const perMppt = [...new Set(allGroups.flatMap(({ gr }) => gr.fill.rows.filter((r) => r.strings).map((r) => r.strings)))].sort();
    const warns = allGroups.flatMap(({ p, gr }) => gr.check.mppts.flatMap((r) => r.problems.map((x) => `${p.inverter.model} MPPT ${r.index}: ${x.text}`)));
    boxDesign.innerHTML = html`
<div class="panel-head"><h2>Stringing: ${o.label}</h2><span class="small muted">${moduleLabel(m)}</span></div>
<div class="summary six">
  <div><span>Inverters</span><b>${o.inverters}</b></div>
  <div><span>MPPTs used</span><b>${usedMppt} <small class="muted">of ${totalMppt}</small></b></div>
  <div><span>Strings per MPPT</span><b>${perMppt.join(" or ")}</b><small class="muted">${perMppt.length === 1 && perMppt[0] === 1 ? "series only" : "parallel on some"}</small></div>
  <div><span>Panels per string</span><b>${lengths.join(" / ")}</b></div>
  <div><span>Strings / panels</span><b>${strings} / ${o.modules}</b></div>
  <div><span>DC / AC</span><b>${num(o.dc_kwp)} / ${num(o.ac_kw)}</b><small><span class="pill ${band(o.ratio)}">${r2(o.ratio)} ${bandText(o.ratio)}</span></small></div>
</div>
${o.fits ? "" : html`<div class="flash warn">Only ${o.modules} of the ${o.target_modules} modules fit this configuration's inputs.</div>`}
${band(o.ratio) === "warn" ? html`<div class="note small">Overloaded: DC/AC ${r2(o.ratio)} is above ${g(st.ratio_ok)} (allowed up to ${g(st.ratio_max)}). The inverter will clip at its AC rating around midday on the best days; note it on the offer.</div>` : ""}
${allGroups.map(({ p, gr }) => html`
<div class="dg-group">
  <div class="dg-head"><b>${gr.count} × ${p.inverter.make} ${p.inverter.model}</b> <span class="muted small">${gr.fill.modules} modules each · ${num((gr.fill.modules * m.wp) / 1000)} kWp · DC/AC ${r2((gr.fill.modules * m.wp) / 1000 / p.inverter.ac_kw)}</span></div>
  ${diagram(p.inverter, gr.fill.rows, gr.count)}
  <div class="small">${groupText(gr.fill.rows).join(" · ")}</div>
</div>`)}
${warns.length ? html`<div class="small" style="margin-top:8px">${warns.map((w) => html`<div class="ck-line ck-warn">${w}</div>`)}</div>` : ""}
<div class="bar">
  <button type="button" class="btn" id="copy">Copy as text</button>
  ${client ? html`<button type="button" class="btn sun" id="save">Save to ${client.name}</button>` : ""}
</div>
${client && saved ? html`<p class="small muted">${client.name} has a saved stringing from ${new Date(saved.saved_at).toLocaleString("en-GB")}: ${saved.label}, ${saved.modules} modules, DC/AC ${r2(saved.ratio)}.</p>` : ""}`;
    boxDesign.querySelector("#copy").addEventListener("click", copyText);
    boxDesign.querySelector("#save")?.addEventListener("click", save);
  }

  function summaryText(o) {
    const { m } = ctx;
    const lines = [`${o.label}: ${o.modules} × ${moduleLabel(m)} = ${num(o.dc_kwp)} kWp on ${num(o.ac_kw)} kW, DC/AC ${r2(o.ratio)} (${bandText(o.ratio)})`,
      `Temperatures ${g(st.t_min_c)}–${g(st.t_max_c)} °C${st.series_only ? ", series strings only" : ""}`];
    for (const p of o.parts) for (const gr of p.groups) {
      lines.push(`${gr.count} × ${p.inverter.model} (${gr.fill.modules} modules each): ` + groupText(gr.fill.rows).join("; "));
    }
    return lines.join("\n");
  }

  async function copyText() {
    try { await navigator.clipboard.writeText(summaryText(chosen())); toast("Copied the stringing.", "ok"); }
    catch { toast("The browser didn't allow copying.", "error"); }
  }

  async function save() {
    const o = chosen();
    const rec = all.client.get(client.id);
    const stringing = {
      label: o.label, module_id: ctx.m.id, dc_target_kwp: st.dc_kwp, modules: o.modules, dc_kwp: o.dc_kwp, ac_kw: o.ac_kw, ratio: o.ratio,
      t_min_c: st.t_min_c, t_max_c: st.t_max_c, series_only: st.series_only, ratio_min: st.ratio_min, ratio_ok: st.ratio_ok, ratio_max: st.ratio_max,
      inverters: o.parts.map((p) => ({ inverter_id: p.inverter.id, qty: p.qty,
        groups: p.groups.map((gr) => ({ count: gr.count, modules: gr.fill.modules, mppts: gr.fill.rows.map((r) => ({ strings: r.strings, length: r.length })) })) })),
      text: summaryText(o), saved_at: new Date().toISOString(),
    };
    await db.put("clients", { ...rec, stringing });
    toast(`Saved to ${client.name}.`, "ok");
  }

  // ---- calculations ----------------------------------------------------------------------

  function renderCalc() {
    const o = ctx.msg ? null : chosen();
    if (!o) { boxCalc.innerHTML = ""; boxCalc.hidden = true; return; }
    boxCalc.hidden = false;
    const { m, s } = ctx;
    const v = s.values;
    const n = o.target_modules;
    const first = o.parts[0].lim;
    const t = first.t, mv = first.mv;
    const tv = m.tc_voc_pct, tm = tcVmpPct(m) || m.tc_voc_pct;
    const gain = 1 + ((m.bifaciality || 0) * v.rear_irradiance) / 1000;
    const f2 = (x) => num(x, 2), f1 = (x) => num(x, 1);
    boxCalc.innerHTML = html`
<h2>Calculations</h2>
<ol class="calc">
  <li><b>Modules for the DC capacity.</b> N = DC ÷ module power = ${num(st.dc_kwp * 1000, 0)} W ÷ ${g(m.wp)} W = ${num((st.dc_kwp * 1000) / m.wp, 2)} → <b>${n} modules</b> (${num((n * m.wp) / 1000)} kWp).</li>
  <li><b>Inverters.</b> AC needed for DC/AC ${g(st.ratio_min)}–${g(st.ratio_max)}: ${num((n * m.wp) / 1000 / st.ratio_max)}–${num((n * m.wp) / 1000 / st.ratio_min)} kW. Chosen: ${o.label} = <b>${num(o.ac_kw)} kW</b>.</li>
  <li><b>Cold cell</b> = lowest temperature = ${f1(t.cell_cold)} °C. <b>Hot cell</b> = T<sub>amb,max</sub> + (NOCT − 20) ÷ 800 × G = ${f1(t.t_max)} + (${f1(t.noct)} − 20) ÷ 800 × ${g(v.hot_irradiance)} = <b>${f1(t.cell_hot)} °C</b>.</li>
  <li><b>Voc cold</b> = Voc × [1 + β<sub>Voc</sub> × (T<sub>cold</sub> − 25)] = ${f2(m.voc)} × [1 + (${g(tv)} %) × (${f1(t.cell_cold)} − 25)] = <b>${f2(mv.voc_cold)} V</b> per module.</li>
  <li><b>Vmp coefficient</b> = ${has(m.tc_pmax_pct) && has(m.tc_isc_pct) ? `Pmax coefficient − Isc coefficient = ${g(m.tc_pmax_pct)} − (${g(m.tc_isc_pct)}) = ${g(tm)} %/°C` : `Voc coefficient = ${g(tm)} %/°C (no Pmax coefficient on the datasheet)`}.
    <b>Vmp cold</b> = ${f2(m.vmp)} × [1 + (${g(tm)} %) × (${f1(t.cell_cold)} − 25)] = <b>${f2(mv.vmp_cold)} V</b>; <b>Vmp hot</b> = ${f2(m.vmp)} × [1 + (${g(tm)} %) × (${f1(t.cell_hot)} − 25)] = <b>${f2(mv.vmp_hot)} V</b>.</li>
  <li><b>Design currents.</b> Isc = Isc<sub>STC</sub> × K<sub>I</sub>${m.bifaciality ? " × bifacial gain" : ""} = ${f2(m.isc)} × ${g(v.isc_factor)}${m.bifaciality ? ` × ${num(gain, 3)} (${g(m.bifaciality)} × ${g(v.rear_irradiance)} W/m² ÷ 1000)` : ""} = <b>${f2(mv.isc_design)} A</b> per string; operating Imp = ${f2(m.imp)}${m.bifaciality ? ` × ${num(gain, 3)}` : ""} = <b>${f2(mv.imp_design)} A</b>.</li>
  ${o.parts.map((p) => calcInverter(p, m, mv))}
  <li><b>Result.</b> ${o.modules} modules × ${g(m.wp)} W = <b>${num(o.dc_kwp)} kWp</b> on ${num(o.ac_kw)} kW → DC/AC = ${num(o.dc_kwp)} ÷ ${num(o.ac_kw)} = <b>${r2(o.ratio)}</b> (${bandText(o.ratio)}; normal up to ${g(st.ratio_ok)}, overload up to ${g(st.ratio_max)}).</li>
</ol>`;
  }

  function calcInverter(p, m, mv) {
    const inv = p.inverter, lim = p.lim;
    const lens = [...new Set(p.groups.flatMap((gr) => gr.fill.rows.filter((r) => r.strings).map((r) => r.length)))].sort((a, b) => b - a);
    const longest = lens[0], shortest = lens[lens.length - 1];
    const hardMax = lim.max.filter((x) => x.hard), hardMin = lim.min.filter((x) => x.hard);
    const capRow = p.caps[0];
    return html`<li><b>${inv.model}: string length.</b>
      ${hardMax.map((x) => html`<div>max. = ⌊${g(x.volts)} V (${x.label.split(" (")[0]}) ÷ ${num(x.per, 2)} V⌋ = ${x.n}</div>`)}
      ${hardMin.map((x) => html`<div>min. = ⌈${g(x.volts)} V (${x.label.split(" (")[0]}) ÷ ${num(x.per, 2)} V⌉ = ${x.n}</div>`)}
      <div>Allowed <b>${lim.range ? `${lim.range[0]}–${lim.range[1]} modules` : "none"}</b>${lim.preferred && lim.range && lim.preferred[1] < lim.range[1] ? ` (up to ${lim.preferred[1]} keeps Voc cold under the MPPT max. ${g(inv.mppt_max_v)} V, so no cold-morning standby)` : ""}.
        Used: ${lens.join(" and ")}. Check: ${longest} × ${num(mv.voc_cold, 2)} = ${num(longest * mv.voc_cold, 0)} V ≤ ${g(inv.max_dc_v)} V; ${shortest} × ${num(mv.vmp_hot, 2)} = ${num(shortest * mv.vmp_hot, 0)} V ≥ ${g(inv.mppt_min_v)} V.</div></li>
    <li><b>${inv.model}: strings per MPPT.</b> ${capRow.isc_limit ? html`⌊${g(capRow.isc_limit)} A ÷ ${num(mv.isc_design, 2)} A⌋ = ${capRow.by_isc} by short-circuit current; ` : ""}${capRow.connectors ? `${capRow.connectors} inputs; ` : ""}${st.series_only ? html`<b>series only → 1 string per MPPT</b>` : html`max. <b>${capRow.cap}</b>`}.
      ${p.caps.length} MPPTs × ${p.qty} inverter${p.qty > 1 ? "s" : ""}. Modules shared out: ${p.groups.map((gr) => `${gr.count} × ${gr.modules}`).join(" + ")}.</li>`;
  }

  // ---- details for the chosen inverter, and hand edits -----------------------------------

  let edit = null; // { p, rows }

  function renderMore() {
    const o = ctx.msg ? null : chosen();
    if (!o) { boxMore.innerHTML = ""; boxMore.hidden = true; return; }
    boxMore.hidden = false;
    const { m, s } = ctx;
    edit = { p: o.parts[0], rows: o.parts[0].groups[0].fill.rows.map((r) => ({ ...r })) };
    const p = edit.p, lim = p.lim;
    const rows = lengthTable(lim, s);
    boxMore.innerHTML = html`
<details>
  <summary>Voltage by string length and MPPT limits${o.parts.length > 1 ? ` (${p.inverter.model})` : ""}</summary>
  <div class="table-scroll"><table class="mppt str-table">
    <thead><tr><th></th><th class="r">Modules</th><th class="r">kWp</th><th class="r">Voc cold</th><th class="r">Vmp cold</th><th class="r">Vmp STC</th><th class="r">Vmp hot</th><th>Notes</th></tr></thead>
    <tbody>${rows.map((r) => html`<tr class="ck-${r.status}${lim.range && r.L >= lim.range[0] && r.L <= lim.range[1] ? "" : " out"}">
      <td><span class="ck">${MARK[r.status]}</span></td><td class="r num"><b>${r.L}</b></td><td class="r num">${num((r.L * m.wp) / 1000)}</td>
      <td class="r num">${num(r.voc_cold, 0)}</td><td class="r num">${num(r.vmp_cold, 0)}</td><td class="r num">${num(r.vmp, 0)}</td><td class="r num">${num(r.vmp_hot, 0)}</td>
      <td class="small">${r.issues.map((x) => `${x.over ? "above" : "below"} ${x.label.split(" (")[0]} (${g(x.volts)} V)`).join("; ")}</td></tr>`)}</tbody>
  </table></div>
  <table class="mppt">
    <thead><tr><th>MPPT</th><th class="r">Inputs</th><th class="r">Isc limit</th><th class="r">By Isc</th><th class="r">Current limit</th><th class="r">By current</th></tr></thead>
    <tbody>${mpptCapacity(p.inverter, lim, s).map((c) => html`<tr><td>${c.index}</td><td class="r num">${c.connectors ?? "—"}</td>
      <td class="r num">${c.isc_limit ? `${g(c.isc_limit)} A` : "—"}</td><td class="r num">${c.by_isc ?? "—"}</td>
      <td class="r num">${c.imp_limit ? `${g(c.imp_limit)} A` : "—"}</td><td class="r num">${c.by_imp ?? "—"}</td></tr>`)}</tbody>
  </table>
  ${p.inverter.notes ? html`<div class="note small">${p.inverter.make} ${p.inverter.model}: ${p.inverter.notes}</div>` : ""}
</details>
<details>
  <summary>Adjust one ${p.inverter.model} by hand</summary>
  <p class="small muted">Change the strings and modules per string on each MPPT; every MPPT is re-checked. This doesn't change the proposal above.</p>
  <div class="table-scroll"><table class="mppt str-layout">
    <thead><tr><th>MPPT</th><th>Strings</th><th>Modules per string</th><th class="r">Modules</th><th class="r">Voc cold</th><th class="r">Vmp hot</th><th class="r">Isc / limit</th><th>Check</th></tr></thead>
    <tbody>${p.caps.map((c, i) => html`<tr data-row="${i}">
      <td>${i + 1}</td>
      <td><input name="strings" value="${g(edit.rows[i]?.strings || "")}" inputmode="numeric"></td>
      <td><input name="length" value="${g(edit.rows[i]?.strings ? edit.rows[i].length : "")}" inputmode="numeric"></td>
      <td class="r num" data-c="modules"></td><td class="r num" data-c="voc"></td><td class="r num" data-c="vmp"></td><td class="r num" data-c="isc"></td><td class="small" data-c="check"></td></tr>`)}</tbody>
  </table></div>
  <div id="edit-total"></div>
</details>`;
    boxMore.querySelector(".str-layout tbody").addEventListener("input", () => { readEdit(); updateEdit(); });
    updateEdit();
  }

  function readEdit() {
    edit.rows = [...boxMore.querySelectorAll("tr[data-row]")].map((tr) => ({
      strings: numOrNull(tr.querySelector("[name=strings]").value), length: numOrNull(tr.querySelector("[name=length]").value) }));
  }

  function updateEdit() {
    const { m, s } = ctx, p = edit.p;
    const caps = mpptCapacity(p.inverter, p.lim, s);
    const res = checkLayout(m, p.inverter, p.lim, caps, edit.rows, s, { seriesOnly: st.series_only });
    boxMore.querySelectorAll("tr[data-row]").forEach((tr, i) => {
      const r = res.mppts[i];
      const set = (c, v) => { tr.querySelector(`[data-c=${c}]`).innerHTML = v; };
      tr.className = r.status === "empty" ? "" : `ck-${r.status}`;
      const on = r.strings && r.length;
      set("modules", on ? String(r.modules) : "");
      set("voc", on ? `${num(r.len.voc_cold, 0)} V` : "");
      set("vmp", on ? `${num(r.len.vmp_hot, 0)} V` : "");
      set("isc", r.strings ? `${num(r.isc, 1)} / ${r.isc_limit ? g(r.isc_limit) : "—"} A` : "");
      set("check", r.status === "empty" ? "" : String(html`<span class="ck">${MARK[r.status]}</span> ${r.problems.map((x) => x.text).join("; ") || "OK"}`));
    });
    const word = { pass: "Every check passes", warn: "Passes, with warnings", fail: "A hard rule fails" }[res.status];
    boxMore.querySelector("#edit-total").innerHTML = res.strings ? html`
<div class="verdict ${res.status}"><b>${word}</b><span>${plural(res.strings, "string")} · ${res.modules} modules · ${num(res.kwp)} kWp · DC/AC ${r2(res.ratio)}</span></div>
${res.issues.map((x) => html`<div class="ck-line ck-${x.hard ? "fail" : "warn"} small">${x.text}</div>`)}` : "";
  }

  // ---- wiring ----------------------------------------------------------------------------

  let timer = null;
  function refresh() {
    readForm();
    ctx = compute();
    if (!ctx.options || st.choice >= ctx.options.length) st.choice = 0;
    renderOptions(); renderDesign(); renderCalc(); renderMore();
    remember(st);
  }
  const later = () => { clearTimeout(timer); timer = setTimeout(() => { st.choice = 0; refresh(); }, 250); };
  form.addEventListener("input", later);
  form.addEventListener("change", later);
  form.addEventListener("submit", (e) => e.preventDefault());
  refresh();
}
