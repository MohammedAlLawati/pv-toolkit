// Stringing calculator: string length limits, a per-length voltage table, how many strings each
// MPPT takes, and checks for a hand-made MPPT layout (each MPPT has its own string length).
//
// Uses the same temperature model, rule profile and per-MPPT limits as the sizing engine
// (engine.js), so its answers agree with the project rules check.

import { allocate, moduleValues, mpptCaps, mpptLimits, temperatures } from "./engine.js";
import { inverterReady } from "../equipment_fields.js";
import { suggestInverters } from "../offer/quick.js";

const EPS = 1e-9;
const sev = (s, key) => s.severity[key] || "off";
const on = (s, key) => sev(s, key) !== "off";

/**
 * Per-module values at the design temperatures, and every voltage limit that bounds the
 * string length. d = { t_min_c, t_max_c, hv_connectors }.
 */
export function stringLimits(m, inv, d, s) {
  const t = temperatures(d, s, m);
  const mv = moduleValues(m, t, s);
  const max = [], min = [];
  const cap = (key, label, volts, per) => {
    if (!volts || !on(s, key)) return;
    max.push({ key, label, volts, per, n: Math.floor(volts / per + EPS), hard: sev(s, key) === "hard" });
  };
  cap("voc_max", "Inverter max. DC voltage (Voc at record low)", inv.max_dc_v, mv.voc_cold);
  cap("voc_module", "Module max. system voltage (Voc at record low)", m.max_system_v, mv.voc_cold);
  if (!d.hv_connectors) cap("voc_connector", "Standard DC connector limit (Voc at record low)", inv.connector_limit_v, mv.voc_cold);
  cap("vmp_max", "MPPT maximum (Vmp at record low)", inv.mppt_max_v, mv.vmp_cold);
  cap("voc_standby", "MPPT maximum (Voc at record low: cold-morning standby)", inv.mppt_max_v, mv.voc_cold);
  if (inv.mppt_min_v && on(s, "vmp_min")) {
    min.push({ key: "vmp_min", label: "MPPT minimum (Vmp at hot cell)", volts: inv.mppt_min_v, per: mv.vmp_hot,
               n: Math.ceil(inv.mppt_min_v / mv.vmp_hot - EPS), hard: sev(s, "vmp_min") === "hard" });
  }
  if (inv.start_v && on(s, "start_v")) {
    min.push({ key: "start_v", label: "Start-up voltage (Vmp at hot cell)", volts: inv.start_v, per: mv.vmp_hot,
               n: Math.ceil(inv.start_v / mv.vmp_hot - EPS), hard: sev(s, "start_v") === "hard" });
  }
  const hardMax = max.filter((x) => x.hard), hardMin = min.filter((x) => x.hard);
  const hi = hardMax.length ? Math.min(...hardMax.map((x) => x.n)) : null;
  const lo = Math.max(1, ...hardMin.map((x) => x.n));
  // the "comfortable" range also respects the warnings (standby, start-up voltage)
  const softHi = max.length ? Math.min(...max.map((x) => x.n)) : null;
  const softLo = Math.max(1, ...min.map((x) => x.n));
  return {
    t, mv, max, min,
    range: hi !== null && lo <= hi ? [lo, hi] : null,
    preferred: softHi !== null && softLo <= softHi ? [softLo, softHi] : null,
  };
}

/** Status of one string length against every voltage limit. */
export function lengthCheck(L, lim, s) {
  const { mv } = lim;
  const v = { voc_cold: mv.voc_cold * L, vmp_cold: mv.vmp_cold * L, vmp: mv.vmp * L, vmp_hot: mv.vmp_hot * L };
  const issues = [];
  for (const x of lim.max) if (x.per * L > x.volts + EPS) issues.push({ ...x, value: x.per * L, over: true });
  for (const x of lim.min) if (x.per * L < x.volts - EPS) issues.push({ ...x, value: x.per * L, over: false });
  const st = issues.some((x) => x.hard) ? "fail" : issues.length ? "warn" : "pass";
  return { L, ...v, status: st, issues };
}

/** The voltage table: every length in the allowed range plus a couple either side. */
export function lengthTable(lim, s, pad = 2) {
  const lo = lim.range ? lim.range[0] : Math.max(1, ...lim.min.map((x) => x.n));
  const hi = lim.range ? lim.range[1] : Math.max(lo, ...lim.max.map((x) => x.n));
  const rows = [];
  for (let L = Math.max(1, lo - pad); L <= Math.min(hi + pad, lo + 80); L++) rows.push(lengthCheck(L, lim, s));
  return rows;
}

/** What each MPPT can take: strings by inputs, by Isc and by current, and the binding one. */
export function mpptCapacity(inv, lim, s) {
  const lims = mpptLimits(inv);
  const capsHard = mpptCaps(lims, lim.mv, s, true);
  return lims.map((x, i) => {
    const byIsc = x.isc ? Math.floor(x.isc / lim.mv.isc_design + EPS) : null;
    const byImp = x.imp ? Math.floor(x.imp / lim.mv.imp_design + EPS) : null;
    const cands = [["inputs", x.connectors],
                   ["short-circuit current", sev(s, "isc_mppt") === "hard" ? byIsc : null],
                   ["operating current", sev(s, "imp_mppt") === "hard" ? byImp : null]]
      .filter(([, n]) => n !== null && n !== undefined);
    const cap = capsHard[i] === 99 ? null : capsHard[i];
    const binding = cands.filter(([, n]) => n === cap).map(([k]) => k);
    return { index: i + 1, connectors: x.connectors, isc_limit: x.isc, imp_limit: x.imp, by_isc: byIsc, by_imp: byImp, cap, binding };
  });
}

/** Most modules one inverter can take (longest allowed string on every usable input). */
export function inverterMax(m, inv, lim, caps) {
  if (!lim.range) return null;
  const strings = caps.reduce((a, c) => a + (c.cap || 0), 0);
  const modules = strings * lim.range[1];
  const kwp = (modules * m.wp) / 1000;
  return { strings, modules, kwp, ratio: inv.ac_kw ? kwp / inv.ac_kw : null };
}

// ---- checking a hand-made layout ---------------------------------------------------------

/**
 * Check one inverter's layout: rows = [{ strings, length }] in MPPT order. Every string on one
 * MPPT has the same length (strings of different lengths in parallel pull the MPPT off both
 * strings' best point).
 */
export function checkLayout(m, inv, lim, caps, rows, s, { seriesOnly = false } = {}) {
  const v = s.values, mv = lim.mv;
  const out = { mppts: [], modules: 0, strings: 0, kwp: 0, ratio: null, issues: [], status: "pass" };
  const flag = (hard, text) => out.issues.push({ hard, text });
  caps.forEach((c, i) => {
    const r = rows[i] || {};
    const n = Number(r.strings) || 0, L = Number(r.length) || 0;
    const row = { index: c.index, strings: n, length: L, modules: n * L, isc: n * mv.isc_design, imp: n * mv.imp_design,
                  connectors: c.connectors, isc_limit: c.isc_limit, imp_limit: c.imp_limit, len: null, problems: [] };
    if (n && !L) row.problems.push({ hard: true, text: "string length missing" });
    if (n && L) {
      row.len = lengthCheck(L, lim, s);
      for (const x of row.len.issues) {
        row.problems.push({ hard: x.hard, text: `${x.value.toFixed(0)} V ${x.over ? ">" : "<"} ${x.volts} V (${x.label})` });
      }
      if (seriesOnly && n > 1) row.problems.push({ hard: false, text: `${n} strings in parallel (series-only is ticked)` });
      if (c.connectors && n > c.connectors) row.problems.push({ hard: sev(s, "strings_mppt") === "hard", text: `${n} strings on ${c.connectors} inputs` });
      if (c.isc_limit && row.isc > c.isc_limit + EPS && on(s, "isc_mppt")) {
        row.problems.push({ hard: sev(s, "isc_mppt") === "hard", text: `Isc ${row.isc.toFixed(1)} A > ${c.isc_limit} A (incl. ×${v.isc_factor})` });
      }
      if (c.imp_limit && row.imp > c.imp_limit + EPS && on(s, "imp_mppt")) {
        row.problems.push({ hard: sev(s, "imp_mppt") === "hard", text: `current ${row.imp.toFixed(1)} A > ${c.imp_limit} A (the inverter clips)` });
      }
      if (inv.max_connector_current_a && mv.isc_design > inv.max_connector_current_a + EPS && on(s, "connector_current")) {
        row.problems.push({ hard: sev(s, "connector_current") === "hard", text: `string Isc ${mv.isc_design.toFixed(1)} A > connector ${inv.max_connector_current_a} A` });
      }
      if (m.max_fuse_a && n >= 3 && (n - 1) * m.isc * v.isc_factor > m.max_fuse_a && on(s, "fuses")) {
        row.problems.push({ hard: sev(s, "fuses") === "hard", text: `string fuses needed (reverse current ${((n - 1) * m.isc * v.isc_factor).toFixed(1)} A > ${m.max_fuse_a} A)` });
      }
    }
    row.status = row.problems.some((p) => p.hard) ? "fail" : row.problems.length ? "warn" : n ? "pass" : "empty";
    out.mppts.push(row);
    out.modules += row.modules;
    out.strings += n;
  });
  for (let i = caps.length; i < rows.length; i++) if (Number(rows[i]?.strings)) flag(true, `The ${inv.model} has only ${caps.length} MPPTs.`);
  out.kwp = (out.modules * m.wp) / 1000;
  out.ratio = inv.ac_kw && out.kwp ? out.kwp / inv.ac_kw : null;
  if (!out.strings) flag(true, "No strings entered.");
  if (inv.max_dc_kw && out.kwp > inv.max_dc_kw + EPS && on(s, "dc_power")) {
    flag(sev(s, "dc_power") === "hard", `${out.kwp.toFixed(2)} kWp is above the inverter's max. PV power of ${inv.max_dc_kw} kWp.`);
  }
  if (out.ratio && on(s, "dcac_band") && (out.ratio < v.dcac_min - EPS || out.ratio > v.dcac_max + EPS)) {
    flag(sev(s, "dcac_band") === "hard", `DC/AC ${out.ratio.toFixed(2)} is outside ${v.dcac_min}–${v.dcac_max}.`);
  }
  const lens = new Set(out.mppts.filter((r) => r.strings && r.length).map((r) => r.length));
  if (lens.size > 1) out.notes = [`Mixed string lengths (${[...lens].sort((a, b) => b - a).join(" and ")}) on separate MPPTs: fine, each MPPT tracks its own voltage.`];
  const all = [...out.issues, ...out.mppts.flatMap((r) => r.problems)];
  out.status = all.some((p) => p.hard) ? "fail" : all.length ? "warn" : "pass";
  return out;
}

// ---- filling a layout for a module count -------------------------------------------------

/** Reachable sums of a subset of caps, with one subset (as a bit mask over caps) for each. */
function subsetSums(capsList) {
  const reach = new Map([[0, 0n]]);
  capsList.forEach((c, i) => {
    for (const [sum, mask] of [...reach]) if (!reach.has(sum + c)) reach.set(sum + c, mask | (1n << BigInt(i)));
  });
  return reach;
}

/**
 * The best layout for `target` modules on one inverter: as many modules as possible without
 * going over, one string length if that gets there, else two lengths on separate MPPTs.
 * Within the hard rules only. Returns { rows, modules, lengths } or null.
 */
export function fillLayout(lim, caps, target, { maxLengths = 2 } = {}) {
  if (!lim.range || !target) return null;
  const cs = caps.map((c) => c.cap || 0);
  const total = cs.reduce((a, b) => a + b, 0);
  if (!total) return null;
  const [lo, hi] = lim.range;
  const pref = lim.preferred || lim.range;
  let best = null;
  const consider = (cand) => {
    const key = (c) => [
      -c.modules,                                    // closest to the target from below
      c.lengths.length,                              // one length if possible
      c.inPreferred ? 0 : 1,                          // avoid lengths that only pass with warnings
      c.strings,                                     // fewer, longer strings
      c.lengths.length > 1 ? c.lengths[0] - c.lengths[1] : 0, // lengths close together
      c.spread,                                      // even use of the MPPTs
    ];
    if (!best) { best = cand; return; }
    const a = key(cand), b = key(best);
    for (let i = 0; i < a.length; i++) { if (a[i] !== b[i]) { if (a[i] < b[i]) best = cand; return; } }
  };
  const inPref = (L) => L >= pref[0] && L <= pref[1];
  const spreadOf = (alloc) => {
    const used = alloc.map((a, i) => (cs[i] ? a / cs[i] : 0));
    return Math.max(...used) - Math.min(...used);
  };

  // one length
  for (let L = lo; L <= hi; L++) {
    const n = Math.min(total, Math.floor(target / L));
    if (!n) continue;
    const [alloc] = allocate(n, cs);
    consider({ rows: alloc.map((a) => ({ strings: a, length: a ? L : null })), modules: n * L, strings: n,
               lengths: [L], inPreferred: inPref(L), spread: spreadOf(alloc) });
  }
  // two lengths, each on its own set of MPPTs
  if (maxLengths >= 2 && cs.length > 1 && (!best || best.modules < target)) {
    const reach = subsetSums(cs);
    for (let La = hi; La >= lo; La--) {
      for (let Lb = La - 1; Lb >= lo; Lb--) {
        for (let a = 1; a <= total; a++) {
          if (a * La >= target) break;
          const b = Math.min(Math.floor((target - a * La) / Lb), total - a);
          if (b < 1) continue;
          // MPPTs for the La strings must hold a, the rest must hold b
          let mask = null;
          for (const [sum, m] of reach) if (sum >= a && total - sum >= b) { mask = m; break; }
          if (mask === null) continue;
          const inA = cs.map((_, i) => ((mask >> BigInt(i)) & 1n) === 1n);
          const [allocA] = allocate(a, cs.map((c, i) => (inA[i] ? c : 0)));
          const [allocB] = allocate(b, cs.map((c, i) => (inA[i] ? 0 : c)));
          const rows = cs.map((_, i) => (inA[i] ? { strings: allocA[i], length: allocA[i] ? La : null } : { strings: allocB[i], length: allocB[i] ? Lb : null }));
          consider({ rows, modules: a * La + b * Lb, strings: a + b, lengths: [La, Lb],
                     inPreferred: inPref(La) && inPref(Lb), spread: spreadOf(rows.map((r) => r.strings)) });
        }
      }
    }
  }
  return best;
}

/** Split a module count over inverters: [{ count, modules }] (some get one more module). */
export function splitModules(total, qty) {
  if (!total || !qty) return [];
  const base = Math.floor(total / qty), extra = total % qty;
  return [[qty - extra, base], [extra, base + 1]].filter(([c, n]) => c && n).map(([count, modules]) => ({ count, modules }));
}

/** The MPPT capacities with series-only stringing: at most one string on each MPPT. */
export const seriesCaps = (caps) => caps.map((c) => ({ ...c, cap: c.cap === null ? 1 : Math.min(c.cap, 1) }));

/**
 * Inverter configurations for a DC capacity, each with its stringing.
 * Inverter choice follows the offer deck (suggestInverters: fewest inverters, ratio within
 * ratioMin..ratioMax, closest to 1.0); each inverter is then filled with fillLayout.
 * opts = { dc (kWp), ratioMin, ratioMax, seriesOnly, limit }; d = { t_min_c, t_max_c, hv_connectors }.
 * Returns [{ label, parts: [{ inverter, qty, lim, caps, groups: [{ count, modules, fill, check }] }],
 *            target_modules, modules, dc_kwp, ac_kw, ratio, fits, ok }].
 */
export function proposeDesigns(m, inverters, d, s, { dc, ratioMin = 0.8, ratioMax = 1.25, seriesOnly = true, limit = 6 } = {}) {
  if (!m || !m.wp || !dc || dc <= 0) return [];
  const N = Math.max(1, Math.round((dc * 1000) / m.wp));
  const ready = inverters.filter((v) => inverterReady(v) && v.ac_kw);
  const byId = new Map(ready.map((v) => [v.id, v]));
  const combos = suggestInverters((N * m.wp) / 1000, ready, { limit: 40, min: ratioMin, max: ratioMax });
  const out = [];
  for (const c of combos) {
    const parts = c.inverters.map(({ inverter_id, qty }) => ({ inverter: byId.get(inverter_id), qty }));
    const acTotal = parts.reduce((t, p) => t + p.inverter.ac_kw * p.qty, 0);
    let left = N, ok = true, modules = 0;
    parts.forEach((p, i) => {
      const share = i === parts.length - 1 ? left : Math.round((N * p.inverter.ac_kw * p.qty) / acTotal);
      left -= share;
      p.lim = stringLimits(m, p.inverter, d, s);
      const caps = mpptCapacity(p.inverter, p.lim, s);
      p.caps = seriesOnly ? seriesCaps(caps) : caps;
      p.groups = splitModules(share, p.qty).map((gr) => {
        const fill = fillLayout(p.lim, p.caps, gr.modules);
        const check = fill ? checkLayout(m, p.inverter, p.lim, p.caps, fill.rows, s, { seriesOnly }) : null;
        if (!fill || check.mppts.some((r) => r.status === "fail")) ok = false;
        if (fill) modules += gr.count * fill.modules;
        return { ...gr, fill, check };
      });
    });
    if (!ok || !modules) continue;
    const dcKwp = (modules * m.wp) / 1000;
    if (dcKwp / acTotal < ratioMin - EPS) continue; // too few modules fit for the ratio
    const warnings = parts.reduce((t, p) => t + p.groups.reduce((u, gr) => u + gr.check.mppts.reduce((w, r) => w + r.problems.length, 0), 0), 0);
    out.push({ label: c.label, parts, target_modules: N, modules, dc_kwp: dcKwp, ac_kw: acTotal, ratio: dcKwp / acTotal,
               fits: modules === N, inverters: c.count, warnings });
  }
  // every module placed first, then the offer deck's order (fewest inverters, ratio near 1.0)
  out.sort((a, b) => (b.fits - a.fits) || (a.fits ? 0 : b.modules - a.modules));
  return out.slice(0, limit);
}
