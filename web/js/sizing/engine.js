// String and inverter sizing: the rules check and the design recommender
// (ported from app/sizing/engine.py, same results).
//
// Temperature model
// - Cold: the cell is at the design minimum ambient (dawn, little irradiance).
// - Hot: cell = max. ambient + (NOCT − 20) / 800 × irradiance.
// - Vmp coefficient: Pmax coefficient − Isc coefficient (Pmp = Vmp × Imp, and Imp moves roughly
//   like Isc), or the Voc coefficient when Pmax is missing. It is more negative than the Voc
//   coefficient, so it errs on the safe side for both MPPT checks.

import { inverterReady, moduleReady, splitList, fmtG } from "../equipment_fields.js";
import { RULE_BY_KEY } from "./rules.js";

const COPPER_RHO = 0.0217; // Ω·mm²/m, copper at about 70 °C
const DC_SIZES = [4, 6, 10, 16];
const AC_SIZES = [4, 6, 10, 16, 25, 35, 50, 70, 95, 120, 150, 185, 240, 300];
const EPS = 1e-9;

const has = (v) => v !== null && v !== undefined && v !== "";
// Rounds like Python's format() (on the exact binary value), with thousands separators.
function n1(v, dp = 1) {
  if (v === null || v === undefined) return "—";
  const [i, f] = Math.abs(v).toFixed(dp).split(".");
  return (v < 0 && Number(v.toFixed(dp)) !== 0 ? "-" : "") + i.replace(/\B(?=(\d{3})+(?!\d))/g, ",") + (f ? "." + f : "");
}
const fx = (v, dp) => v.toFixed(dp);

/** The design inputs, taken from a project and its chosen module / inverter. */
export function designFrom(p, module, inverter) {
  return {
    module, inverter,
    inverter_qty: p.inverter_qty || null, module_count: p.module_count || null, strings: p.strings || null,
    phases: Number(p.phases) === 1 ? 1 : 3, mppt_layout: p.mppt_layout || "",
    t_min_c: has(p.t_min_c) ? p.t_min_c : null, t_max_c: has(p.t_max_c) ? p.t_max_c : null,
    hv_connectors: !!p.hv_connectors, connection_limit_kw: p.connection_limit_kw || null,
    dc_cable_m: p.dc_cable_m || null, dc_cable_mm2: p.dc_cable_mm2 || null,
    ac_cable_m: p.ac_cable_m || null, ac_cable_mm2: p.ac_cable_mm2 || null,
  };
}

/** Summary of a check result. */
export function status(r) {
  if (r.checks.some((c) => c.status === "fail")) return "fail";
  if (r.checks.some((c) => c.status === "unknown")) return "incomplete";
  return r.checks.some((c) => c.status === "warn") ? "warn" : "pass";
}
export const fails = (r) => r.checks.filter((c) => c.status === "fail");
export const warnings = (r) => r.checks.filter((c) => c.status === "warn");
export const unknown = (r) => r.checks.filter((c) => c.status === "unknown");
/** Reports must not be printed while a hard rule fails or can't be checked. */
export const blocked = (r) => fails(r).length > 0 || unknown(r).length > 0;

export function tcVmpPct(m) {
  if (has(m.tc_pmax_pct) && has(m.tc_isc_pct)) return m.tc_pmax_pct - m.tc_isc_pct;
  return m.tc_voc_pct;
}

export function temperatures(d, s, m = null) {
  const v = s.values;
  const tMin = has(d.t_min_c) ? d.t_min_c : v.t_min_c;
  const tMax = has(d.t_max_c) ? d.t_max_c : v.t_max_c;
  const noct = (m && m.noct_c) || v.default_noct;
  return { t_min: tMin, t_max: tMax, noct, cell_cold: tMin, cell_hot: tMax + ((noct - 20) / 800) * v.hot_irradiance };
}

export function moduleValues(m, t, s) {
  const tv = m.tc_voc_pct / 100;
  const tm = (tcVmpPct(m) || m.tc_voc_pct) / 100;
  const gain = 1 + ((m.bifaciality || 0) * s.values.rear_irradiance) / 1000;
  return {
    voc_cold: m.voc * (1 + tv * (t.cell_cold - 25)),
    vmp_cold: m.vmp * (1 + tm * (t.cell_cold - 25)),
    vmp_hot: m.vmp * (1 + tm * (t.cell_hot - 25)),
    isc_design: m.isc * gain * s.values.isc_factor,
    imp_design: m.imp * gain,
    vmp: m.vmp, imp: m.imp,
  };
}

export function mpptLimits(inv) {
  const n = inv.num_mppt || 0;
  const per = (lst, single) => {
    let vals = splitList(lst);
    if (!vals.length && has(single)) vals = [single];
    if (vals.length === 1 && n > 1) vals = Array(n).fill(vals[0]);
    return [...vals, ...Array(n).fill(null)].slice(0, n);
  };
  const conns = per(inv.mppt_strings, inv.strings_per_mppt);
  const imps = per(inv.mppt_currents, inv.max_current_per_mppt);
  const iscs = per(inv.mppt_iscs, inv.max_isc_per_mppt);
  return conns.map((c, i) => ({ connectors: c ? Math.trunc(c) : null, imp: imps[i], isc: iscs[i] }));
}

const enabled = (s, key) => (s.severity[key] || "off") !== "off";
const hard = (s, key) => s.severity[key] === "hard";

/** How many strings each MPPT can take under the hard rules. */
export function mpptCaps(lims, mv, s, electrical = true) {
  return lims.map((lim) => {
    let cap = lim.connectors || 99;
    if (electrical && hard(s, "isc_mppt") && lim.isc) cap = Math.min(cap, Math.floor(lim.isc / mv.isc_design + EPS));
    if (electrical && hard(s, "imp_mppt") && lim.imp) cap = Math.min(cap, Math.floor(lim.imp / mv.imp_design + EPS));
    return Math.max(cap, 0);
  });
}

/** Spread n strings over the MPPTs, keeping them as evenly filled as possible. */
export function allocate(n, caps) {
  const alloc = caps.map(() => 0);
  for (let k = 0; k < n; k++) {
    let best = -1;
    for (let j = 0; j < caps.length; j++) {
      if (alloc[j] >= caps[j]) continue;
      if (best < 0 || alloc[j] / caps[j] < alloc[best] / caps[best]) best = j;
    }
    if (best < 0) break;
    alloc[best] += 1;
  }
  return [alloc, n - alloc.reduce((a, b) => a + b, 0)];
}

/** Allowed modules per string under the enabled voltage rules, or null if no length fits. */
export function stringRange(m, inv, mv, s, hvConnectors) {
  let hi = 10000, lo = 1;
  if (enabled(s, "voc_max") && inv.max_dc_v) hi = Math.min(hi, Math.floor(inv.max_dc_v / mv.voc_cold));
  if (enabled(s, "voc_module") && m.max_system_v) hi = Math.min(hi, Math.floor(m.max_system_v / mv.voc_cold));
  if (enabled(s, "voc_connector") && inv.connector_limit_v && !hvConnectors) hi = Math.min(hi, Math.floor(inv.connector_limit_v / mv.voc_cold));
  if (enabled(s, "vmp_max") && inv.mppt_max_v) hi = Math.min(hi, Math.floor(inv.mppt_max_v / mv.vmp_cold));
  if (enabled(s, "vmp_min") && inv.mppt_min_v) lo = Math.max(lo, Math.ceil(inv.mppt_min_v / mv.vmp_hot));
  return lo <= hi && hi < 10000 ? [lo, hi] : null;
}

const vdropDc = (len, mm2, i, v) => ((2 * len * i * COPPER_RHO) / mm2 / v) * 100;
function vdropAc(len, mm2, kw, phases) {
  if (phases === 1) {
    const i = (kw * 1000) / 230;
    return [((2 * len * i * COPPER_RHO) / mm2 / 230) * 100, i];
  }
  const i = (kw * 1000) / (Math.sqrt(3) * 400);
  return [((Math.sqrt(3) * len * i * COPPER_RHO) / mm2 / 400) * 100, i];
}

// ---- the rules check ---------------------------------------------------------------------

export function check(d, s) {
  const r = { checks: [], groups: [], temps: {}, string: {}, string_range: null, modules_per_string: null,
              dc_kwp: null, ac_kw: null, ratio: null, cables: {}, notes: [] };
  const m = d.module, inv = d.inverter, v = s.values;

  const add = (key, ok, detail, value = "", limit = "") => {
    const sev = s.severity[key] || RULE_BY_KEY[key].default;
    if (sev === "off") return;
    let st;
    if (ok === null) st = sev === "hard" ? "unknown" : "warn";
    else if (ok) st = "pass";
    else st = sev === "hard" ? "fail" : "warn";
    r.checks.push({ key, label: RULE_BY_KEY[key].label, status: st, detail, value, limit });
  };

  if (m && d.module_count) r.dc_kwp = (m.wp * d.module_count) / 1000;
  if (inv && d.inverter_qty) r.ac_kw = inv.ac_kw * d.inverter_qty;
  if (r.dc_kwp && r.ac_kw) r.ratio = r.dc_kwp / r.ac_kw;
  if (inv && inv.notes) r.notes.push(`${inv.make} ${inv.model}: ${inv.notes}`);

  const missing = [];
  if (!m) missing.push("module");
  else if (!moduleReady(m)) {
    missing.push(`module ${m.model}: ` + [["Voc", m.voc], ["Isc", m.isc], ["Vmp", m.vmp], ["Imp", m.imp],
      ["Voc temp. coefficient", m.tc_voc_pct]].filter(([, x]) => !has(x)).map(([k]) => k).join(", "));
  }
  if (!inv) missing.push("inverter");
  else if (!inverterReady(inv)) {
    missing.push(`inverter ${inv.model}: ` + [["max. DC voltage", inv.max_dc_v], ["MPPT min.", inv.mppt_min_v],
      ["MPPT max.", inv.mppt_max_v], ["number of MPPTs", inv.num_mppt],
      ["current per MPPT", inv.mppt_currents || inv.max_current_per_mppt]].filter(([, x]) => !has(x)).map(([k]) => k).join(", "));
  }
  for (const [k, lab] of [["module_count", "number of modules"], ["strings", "number of strings"], ["inverter_qty", "inverter quantity"]]) {
    if (!d[k]) missing.push(lab);
  }
  add("data", missing.length ? null : true, missing.length ? "Missing: " + missing.join("; ") : "All values present.");
  acChecks(d, s, r, add);
  if (missing.length) return r;

  // string length and layout
  const lims = mpptLimits(inv);
  const layout = String(d.mppt_layout || "").trim() ? splitList(d.mppt_layout).map((x) => Math.trunc(x)) : null;
  const layoutSum = layout ? layout.reduce((a, b) => a + b, 0) : 0;
  const splitOk = d.module_count % d.strings === 0;
  const L = splitOk ? d.module_count / d.strings : null;
  r.modules_per_string = L;
  let problem = "";
  if (!splitOk) problem = `${d.module_count} modules don't divide evenly into ${d.strings} strings.`;
  else if (d.strings < d.inverter_qty) problem = `${d.inverter_qty} inverters need at least one string each.`;
  else if (layout && layout.length > lims.length) problem = `The MPPT layout lists ${layout.length} MPPTs; the ${inv.model} has ${lims.length}.`;
  else if (layout && layoutSum * d.inverter_qty !== d.strings) {
    problem = `The layout ${d.mppt_layout} puts ${layoutSum} strings on each of ${d.inverter_qty} inverter(s) = ${layoutSum * d.inverter_qty}, but the project has ${d.strings}.`;
  }
  add("string_split", !problem, problem || `${d.strings} strings of ${L} modules.`);
  if (problem) return r;

  const t = temperatures(d, s, m);
  const mv = moduleValues(m, t, s);
  r.temps = t;
  const sv = { voc_cold: mv.voc_cold * L, vmp_cold: mv.vmp_cold * L, vmp_hot: mv.vmp_hot * L,
               isc_design: mv.isc_design, imp_design: mv.imp_design, vmp: mv.vmp * L };
  r.string = sv;
  r.string_range = stringRange(m, inv, mv, s, d.hv_connectors);
  const tmin = `${fmtG(t.t_min)} °C`;

  // voltages
  add("voc_max", sv.voc_cold <= inv.max_dc_v, `Voc at ${tmin}: ${n1(sv.voc_cold)} V.`, `${n1(sv.voc_cold)} V`, `${fmtG(inv.max_dc_v)} V`);
  if (m.max_system_v) add("voc_module", sv.voc_cold <= m.max_system_v, `Module rated ${fmtG(m.max_system_v)} V.`, `${n1(sv.voc_cold)} V`, `${fmtG(m.max_system_v)} V`);
  if (inv.connector_limit_v) {
    const over = sv.voc_cold > inv.connector_limit_v;
    add("voc_connector", !over || d.hv_connectors,
      over && !d.hv_connectors ? `Above ${fmtG(inv.connector_limit_v)} V: fit connectors rated for it (e.g. MC4 Evo2) and tick 'High-voltage connectors' on the project.`
        : over ? "High-voltage connectors fitted." : "Within the standard connector limit.",
      `${n1(sv.voc_cold)} V`, `${fmtG(inv.connector_limit_v)} V`);
  }
  add("vmp_min", sv.vmp_hot >= inv.mppt_min_v, `Vmp at ${fx(t.cell_hot, 0)} °C cell temperature: ${n1(sv.vmp_hot)} V.`, `${n1(sv.vmp_hot)} V`, `${fmtG(inv.mppt_min_v)} V`);
  add("vmp_max", sv.vmp_cold <= inv.mppt_max_v, `Vmp at ${tmin}: ${n1(sv.vmp_cold)} V.`, `${n1(sv.vmp_cold)} V`, `${fmtG(inv.mppt_max_v)} V`);
  add("voc_standby", sv.voc_cold <= inv.mppt_max_v,
    sv.voc_cold <= inv.mppt_max_v ? "Fine." : "The inverter may wait in standby on cold mornings until the voltage falls.",
    `${n1(sv.voc_cold)} V`, `${fmtG(inv.mppt_max_v)} V`);
  if (inv.start_v) add("start_v", sv.vmp_hot >= inv.start_v, `Start-up voltage ${fmtG(inv.start_v)} V.`, `${n1(sv.vmp_hot)} V`, `${fmtG(inv.start_v)} V`);

  // strings over inverters and MPPTs
  let groupsSpec;
  if (layout) groupsSpec = [[d.inverter_qty, layoutSum]];
  else {
    const base = Math.floor(d.strings / d.inverter_qty), extra = d.strings % d.inverter_qty;
    groupsSpec = [[d.inverter_qty - extra, base], [extra, base + 1]].filter(([c]) => c);
  }
  const capsE = mpptCaps(lims, mv, s, true);
  const capsC = mpptCaps(lims, mv, s, false);
  for (const [count, n] of groupsSpec) {
    let alloc, overflow;
    if (layout) { alloc = [...layout, ...Array(lims.length).fill(0)].slice(0, lims.length); overflow = 0; }
    else {
      [alloc, overflow] = allocate(n, capsE);
      if (overflow) [alloc, overflow] = allocate(n, capsC); // can't meet every limit: fill the inputs, the checks say why
    }
    const mppts = alloc.map((a, i) => ({ index: i + 1, strings: a, connectors: lims[i].connectors,
      isc: a ? a * mv.isc_design : 0, isc_limit: lims[i].isc, imp: a ? a * mv.imp_design : 0, imp_limit: lims[i].imp }));
    r.groups.push({ count, strings: n, mppts, overflow, dc_kwp: (n * L * m.wp) / 1000 });
  }

  const rows = r.groups.flatMap((g) => g.mppts);
  const worst = (attr, limAttr) => rows.filter((row) => row[limAttr] && row[attr] > row[limAttr] + EPS);
  const overConn = rows.filter((row) => row.connectors && row.strings > row.connectors);
  const overflowSum = r.groups.reduce((a, g) => a + g.overflow, 0);
  add("strings_mppt", !overConn.length && !overflowSum,
    overflowSum ? `${overflowSum} string(s) per inverter have no free input.`
      : overConn.length ? overConn.map((row) => `MPPT ${row.index}: ${row.strings} strings on ${row.connectors} inputs`).join("; ")
        : "Every string has an input.");
  if (rows.some((row) => row.isc_limit)) {
    const bad = worst("isc", "isc_limit");
    add("isc_mppt", !bad.length,
      bad.map((row) => `MPPT ${row.index}: ${row.strings} × ${fx(mv.isc_design, 1)} A = ${fx(row.isc, 1)} A > ${fmtG(row.isc_limit)} A`).join("; ")
        || `${fx(mv.isc_design, 2)} A per string incl. factor ${fmtG(v.isc_factor)}.`);
  }
  if (rows.some((row) => row.imp_limit)) {
    const bad = worst("imp", "imp_limit");
    add("imp_mppt", !bad.length,
      bad.map((row) => `MPPT ${row.index}: ${fx(row.imp, 1)} A > ${fmtG(row.imp_limit)} A`).join("; ") || `${fx(mv.imp_design, 2)} A per string.`);
  }
  if (inv.max_connector_current_a) {
    add("connector_current", mv.isc_design <= inv.max_connector_current_a, "Per string.", `${fx(mv.isc_design, 1)} A`, `${fmtG(inv.max_connector_current_a)} A`);
  }
  if (m.max_fuse_a) {
    const par = Math.max(0, ...rows.map((row) => row.strings));
    const reverse = (par - 1) * m.isc * v.isc_factor;
    const need = par >= 3 && reverse > m.max_fuse_a;
    add("fuses", par < 3 || reverse <= m.max_fuse_a, `Up to ${par} strings in parallel on one MPPT.`
      + (need ? ` Reverse current ${fx(reverse, 1)} A exceeds the module's ${fmtG(m.max_fuse_a)} A fuse rating: string fuses are needed unless the inverter has them.` : ""));
  }
  if (inv.max_dc_kw) {
    const worstDc = Math.max(...r.groups.map((g) => g.dc_kwp));
    add("dc_power", worstDc <= inv.max_dc_kw + EPS, "Per inverter.", `${n1(worstDc, 2)} kWp`, `${fmtG(inv.max_dc_kw)} kWp`);
  }
  if (r.ratio) add("dcac_band", v.dcac_min <= r.ratio && r.ratio <= v.dcac_max, "Whole system.", fx(r.ratio, 2), `${fmtG(v.dcac_min)}–${fmtG(v.dcac_max)}`);

  cableChecks(d, s, r, add, sv, mv);
  return r;
}

function acChecks(d, s, r, add) {
  const inv = d.inverter, v = s.values;
  if (inv) add("phase_match", Number(inv.phases) === d.phases, `Inverter ${inv.phases}-phase, connection ${d.phases}-phase.`);
  if (r.ac_kw === null) return;
  if (d.connection_limit_kw) add("ac_connection", r.ac_kw <= d.connection_limit_kw + EPS, "Limit entered on the project.", `${n1(r.ac_kw, 2)} kW`, `${fmtG(d.connection_limit_kw)} kW`);
  if (v.max_ac_kw) add("ac_profile", r.ac_kw <= v.max_ac_kw + EPS, "Rule profile limit.", `${n1(r.ac_kw, 2)} kW`, `${fmtG(v.max_ac_kw)} kW`);
  if (d.phases === 1 && v.single_phase_max_a) {
    const amps = (inv.max_ac_current_a || (inv.ac_kw * 1000) / 230) * d.inverter_qty;
    add("single_phase", amps <= v.single_phase_max_a + EPS, "Max. AC output current of the inverters on the phase.", `${n1(amps, 1)} A`, `${fmtG(v.single_phase_max_a)} A`);
  }
  if (v.lvrt_kw && r.ac_kw >= v.lvrt_kw) {
    r.notes.push(`${n1(r.ac_kw, 2)} kW AC: APSR asks for low-voltage ride-through (LVRT) from ${fmtG(v.lvrt_kw)} kW. Check the inverter's grid-code certificate.`);
  }
  if (v.remote_control_kw && r.ac_kw >= v.remote_control_kw) r.notes.push(`APSR asks for remote control on LV systems from ${fmtG(v.remote_control_kw)} kW.`);
}

function cableChecks(d, s, r, add, sv, mv) {
  const v = s.values;
  if (d.dc_cable_m) {
    const i = mv.imp_design, volts = sv.vmp;
    const rec = DC_SIZES.find((a) => vdropDc(d.dc_cable_m, a, i, volts) <= v.dc_vdrop_max_pct) ?? null;
    r.cables.dc_recommended = rec;
    if (d.dc_cable_mm2) {
      const drop = vdropDc(d.dc_cable_m, d.dc_cable_mm2, i, volts);
      r.cables.dc_drop = drop;
      add("vdrop_dc", drop <= v.dc_vdrop_max_pct, `${fmtG(d.dc_cable_m)} m of ${fmtG(d.dc_cable_mm2)} mm² per string.`
        + (rec && drop > v.dc_vdrop_max_pct ? ` ${rec} mm² would meet the limit.` : ""), `${fx(drop, 2)} %`, `${fmtG(v.dc_vdrop_max_pct)} %`);
    }
  }
  if (d.ac_cable_m && r.ac_kw) {
    const rec = AC_SIZES.find((a) => vdropAc(d.ac_cable_m, a, r.ac_kw, d.phases)[0] <= v.ac_vdrop_max_pct) ?? null;
    r.cables.ac_recommended = rec;
    r.cables.ac_current = vdropAc(d.ac_cable_m, 1, r.ac_kw, d.phases)[1];
    if (d.ac_cable_mm2) {
      const [drop] = vdropAc(d.ac_cable_m, d.ac_cable_mm2, r.ac_kw, d.phases);
      r.cables.ac_drop = drop;
      add("vdrop_ac", drop <= v.ac_vdrop_max_pct, `${fmtG(d.ac_cable_m)} m of ${fmtG(d.ac_cable_mm2)} mm² at full AC output.`
        + (rec && drop > v.ac_vdrop_max_pct ? ` ${rec} mm² would meet the limit.` : ""), `${fx(drop, 2)} %`, `${fmtG(v.ac_vdrop_max_pct)} %`);
    }
  }
}

// ---- recommendations -----------------------------------------------------------------------

/**
 * Best designs for a target, one per inverter model and quantity. Only designs that pass
 * every hard rule are returned.
 * targetKind: "dc" (kWp), "ac" (kW) or "modules" (most modules that fit, e.g. a roof count).
 */
export function recommend(base, inverters, s, targetKind, target, limit = 6) {
  const m = base.module, v = s.values;
  if (!m || !moduleReady(m) || !target || target <= 0) return [];
  const dcTarget = targetKind === "ac" ? target * v.dcac_target : targetKind === "modules" ? (target * m.wp) / 1000 : target;
  const nTarget = (dcTarget * 1000) / m.wp;
  const best = new Map();
  const t = temperatures(base, s, m);
  const mv = moduleValues(m, t, s);

  for (const inv of inverters) {
    if (!inverterReady(inv) || Number(inv.phases) !== base.phases) continue;
    const rng = stringRange(m, inv, mv, s, base.hv_connectors);
    if (!rng) continue;
    const perInvMax = mpptCaps(mpptLimits(inv), mv, s).reduce((a, b) => a + b, 0);
    if (perInvMax <= 0) continue;
    let qs;
    if (targetKind === "ac") qs = new Set([Math.max(1, Math.floor(target / inv.ac_kw)), Math.max(1, Math.ceil(target / inv.ac_kw - EPS))]);
    else {
      const qLo = Math.max(1, Math.ceil(dcTarget / (inv.ac_kw * v.dcac_max) - EPS));
      const qHi = Math.max(qLo, Math.floor(dcTarget / (inv.ac_kw * v.dcac_min) + EPS));
      qs = new Set();
      for (let q = qLo; q <= Math.min(qHi, qLo + 40); q++) qs.add(q);
    }
    for (const q of [...qs].sort((a, b) => a - b)) {
      for (let L = rng[0]; L <= rng[1]; L++) {
        const s0 = nTarget / L;
        for (const S of new Set([Math.floor(s0), Math.ceil(s0)])) {
          if (S < q || S > q * perInvMax) continue;
          if (targetKind === "modules" && S * L > target) continue;
          const res = check({ ...base, inverter: inv, inverter_qty: q, module_count: S * L, strings: S, mppt_layout: "" }, s);
          if (blocked(res)) continue;
          let score = (3 * Math.abs(res.dc_kwp - dcTarget)) / dcTarget + Math.abs(res.ratio - v.dcac_target) / v.dcac_target
            + 0.05 * warnings(res).length + 0.1 * Math.log(q) + 0.002 * (rng[1] - L);
          if (!(v.dcac_min <= res.ratio && res.ratio <= v.dcac_max)) score += 0.5;
          if (targetKind === "ac") score += (3 * Math.abs(res.ac_kw - target)) / target;
          const key = `${inv.id ?? inv.model}|${q}`;
          if (!best.has(key) || score < best.get(key).score) {
            best.set(key, { inverter: inv, inverter_qty: q, modules_per_string: L, strings: S, module_count: S * L, result: res, score });
          }
        }
      }
    }
  }
  return [...best.values()].sort((a, b) => a.score - b.score).slice(0, limit);
}
