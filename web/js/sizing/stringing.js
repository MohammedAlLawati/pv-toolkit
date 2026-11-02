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

// ---- the "fill all usable inputs evenly" method -------------------------------------------
// (Mohammed's "PV String Layout Method", 2 Nov 2026.) Steps:
// 1 temperature-corrected module values; 2 string window L_min..L_max from the voltage limits,
// using the MPPT maximum, not the absolute max. DC voltage; 3 strings per MPPT S from the input
// connectors and both current limits; 4 usable inputs U = Σ S; 5 n = min(U, ⌊N / L_min⌋) strings;
// 6 L = ⌊N / n⌋, r = N − n·L → r strings of L + 1 and n − r of L; 7 strings shared between
// inverters, long and short evenly; 8 strings sharing an MPPT have the same length; 9 checks.

/** Step 2: the string window for one inverter model. */
export function methodWindow(m, inv, lim, d) {
  const mv = lim.mv;
  const maxes = [["MPPT maximum", inv.mppt_max_v], ["inverter max. DC voltage", inv.max_dc_v], ["module max. system voltage", m.max_system_v]];
  if (inv.connector_limit_v && !d.hv_connectors) maxes.push(["standard DC connector limit", inv.connector_limit_v]);
  const vmax = maxes.filter(([, v]) => v).reduce((a, b) => (b[1] < a[1] ? b : a));
  const mins = [["MPPT minimum", inv.mppt_min_v], ["start-up voltage", inv.start_v]].filter(([, v]) => v);
  const vmin = mins.length ? mins.reduce((a, b) => (b[1] > a[1] ? b : a)) : ["MPPT minimum", 0];
  const Lmax = Math.floor(vmax[1] / mv.voc_cold + EPS);
  const Lmin = Math.max(1, Math.ceil(vmin[1] / mv.vmp_hot - EPS));
  return { Lmin, Lmax, vmax, vmin, ok: Lmin <= Lmax };
}

/** Step 3: strings allowed on each MPPT of one inverter. */
export function methodStrings(inv, lim, { seriesOnly = false } = {}) {
  const mv = lim.mv;
  return mpptLimits(inv).map((x, i) => {
    const byIsc = x.isc ? Math.floor(x.isc / mv.isc_design + EPS) : null;
    const byImp = x.imp ? Math.floor(x.imp / mv.imp_design + EPS) : null;
    const cands = [x.connectors || null, byIsc, byImp].filter((v) => v !== null);
    let S = cands.length ? Math.min(...cands) : 1;
    if (seriesOnly) S = Math.min(S, 1);
    return { index: i + 1, connectors: x.connectors, isc_limit: x.isc, imp_limit: x.imp, by_isc: byIsc, by_imp: byImp, S: Math.max(S, 0) };
  });
}

/** Which subsets of MPPT counts can hold `l` long strings exactly (each MPPT one length). */
function longSplit(counts, l) {
  const reach = new Map([[0, []]]);
  counts.forEach((c, i) => {
    if (!c) return;
    for (const [sum, idx] of [...reach]) if (!reach.has(sum + c)) reach.set(sum + c, [...idx, i]);
  });
  return reach.has(l) ? reach.get(l) : null;
}

/**
 * Steps 4–8 for one inverter model and quantity: returns
 * { ok, issues, U, nmin, nmax, n, L, r, Lmin, Lmax, inverters: [{ rows, modules, strings, longs }] }.
 */
export function methodLayout(m, inv, qty, N, lim, d, { seriesOnly = false } = {}) {
  const win = methodWindow(m, inv, lim, d);
  const mppt = methodStrings(inv, lim, { seriesOnly });
  const S = mppt.map((x) => x.S);
  const perInv = S.reduce((a, b) => a + b, 0);
  const U = qty * perInv;
  const out = { ...win, mppt, U, perInv, qty, N, issues: [], ok: false, inverters: [] };
  if (!win.ok) { out.issues.push(`No string length fits: L min ${win.Lmin} > L max ${win.Lmax}.`); return out; }
  if (!U) { out.issues.push("No MPPT can take a string: the string current is above every MPPT's limit."); return out; }
  out.nmin = Math.ceil(N / win.Lmax - EPS);
  out.nmax = Math.min(U, Math.floor(N / win.Lmin + EPS));
  if (out.nmin > U) {
    out.issues.push(`${N} modules need at least ⌈${N} ÷ ${win.Lmax}⌉ = ${out.nmin} strings, but only ${U} inputs are usable: add inverter capacity.`);
    return out;
  }
  if (out.nmax < 1) { out.issues.push(`Too few modules for one string of ${win.Lmin}.`); return out; }
  // Step 6 with step 7/8 feasibility: start at n_max and step down if needed
  for (let n = out.nmax; n >= Math.max(out.nmin, 1); n--) {
    const L = Math.floor(N / n), r = N - n * L;
    if (L < win.Lmin) continue;
    if (L + (r ? 1 : 0) > win.Lmax) break;
    const invs = shareStrings(n, r, qty, S);
    if (!invs) continue;
    Object.assign(out, { n, L, r, ok: true, reduced: out.nmax - n });
    out.inverters = invs.map((x) => {
      const rows = x.counts.map((c, j) => ({ strings: c, length: c ? (x.longIdx.includes(j) ? L + 1 : L) : null }));
      const modules = rows.reduce((t, rw) => t + rw.strings * (rw.length || 0), 0);
      return { rows, modules, strings: x.c, longs: x.l };
    });
    return out;
  }
  out.issues.push(`No even split of ${N} modules fits the ${win.Lmin}–${win.Lmax} window on ${U} inputs.`);
  return out;
}

/**
 * Step 7–8: n strings (r of them long) over qty identical inverters with S strings per MPPT.
 * String counts per inverter differ by at most one; long strings are spread as evenly as the
 * same-length-per-MPPT rule allows. Returns [{ c, l, counts, longIdx }] or null.
 */
function shareStrings(n, r, qty, S) {
  const base = Math.floor(n / qty), extra = n % qty;
  const cs = Array.from({ length: qty }, (_, i) => base + (i < extra ? 1 : 0));
  const per = S.reduce((a, b) => a + b, 0);
  if (cs.some((c) => c > per)) return null;
  const counts = cs.map((c) => allocate(c, S)[0]);
  // feasible long-string counts for each inverter
  const feas = counts.map((cnt) => {
    const sums = new Set([0]);
    for (const c of cnt) if (c) for (const v of [...sums]) sums.add(v + c);
    return [...sums].sort((a, b) => a - b);
  });
  // DP over inverters: total longs = r, as even as possible (target r × c_i / n)
  let best = new Map([[0, { cost: 0, pick: [] }]]);
  feas.forEach((opts, i) => {
    const target = (r * cs[i]) / n;
    const next = new Map();
    for (const [sum, st] of best) for (const l of opts) {
      if (l > cs[i] || sum + l > r) continue;
      const cost = st.cost + Math.abs(l - target);
      const prev = next.get(sum + l);
      if (!prev || cost < prev.cost - EPS) next.set(sum + l, { cost, pick: [...st.pick, l] });
    }
    best = next;
  });
  const fin = best.get(r);
  if (!fin) return null;
  return cs.map((c, i) => ({ c, l: fin.pick[i], counts: counts[i], longIdx: longSplit(counts[i], fin.pick[i]) || [] }));
}

/**
 * String one inverter configuration for a module count with the method above.
 * parts = [{ inverter, qty }]. With several models the modules are shared in proportion to AC
 * rating (step 7) and the method runs per model.
 * Returns { label, parts, target_modules, modules, dc_kwp, ac_kw, ratio, fits, ok, parallel, warnings, issues }.
 */
export function designFor(m, parts, d, s, { modules: N, ratioMin = 0.8, ratioMax = 1.25, seriesOnly = false } = {}) {
  parts = parts.filter((p) => p.inverter && p.qty > 0).map((p) => ({ inverter: p.inverter, qty: p.qty }));
  const issues = [];
  const acTotal = parts.reduce((t, p) => t + (p.inverter.ac_kw || 0) * p.qty, 0);
  let left = N, modules = 0, ok = parts.length > 0, parallel = 0, warnings = 0;
  parts.forEach((p, i) => {
    const share = i === parts.length - 1 ? left : Math.round((N * (p.inverter.ac_kw || 0) * p.qty) / (acTotal || 1));
    left -= share;
    p.share = share;
    p.lim = stringLimits(m, p.inverter, d, s);
    p.caps = mpptCapacity(p.inverter, p.lim, s);
    p.method = methodLayout(m, p.inverter, p.qty, share, p.lim, d, { seriesOnly });
    for (const x of p.method.issues) issues.push(`${p.inverter.model}: ${x}`);
    if (!p.method.ok) { ok = false; p.groups = []; return; }
    // identical inverters share one group (and one diagram)
    const groups = new Map();
    for (const inv of p.method.inverters) {
      const key = JSON.stringify(inv.rows);
      if (!groups.has(key)) groups.set(key, { count: 0, modules: inv.modules, fill: { rows: inv.rows, modules: inv.modules, strings: inv.strings } });
      groups.get(key).count++;
    }
    p.groups = [...groups.values()].map((gr) => {
      const check = checkLayout(m, p.inverter, p.lim, p.caps, gr.fill.rows, s);
      // step 9 warning: Voc cold within 5 % of the MPPT maximum
      const longest = Math.max(...gr.fill.rows.filter((rw) => rw.strings).map((rw) => rw.length));
      const vocMax = longest * p.lim.mv.voc_cold;
      if (p.inverter.mppt_max_v && vocMax > 0.95 * p.inverter.mppt_max_v + EPS && vocMax <= p.inverter.mppt_max_v + EPS) {
        check.headroom = `Longest string's Voc cold ${vocMax.toFixed(0)} V is within 5 % of the ${p.inverter.mppt_max_v} V MPPT maximum.`;
      }
      if (check.mppts.some((rw) => rw.status === "fail")) {
        ok = false;
        issues.push(`${p.inverter.model}: ${check.mppts.flatMap((rw) => rw.problems.filter((x) => x.hard).map((x) => `MPPT ${rw.index} ${x.text}`)).join("; ")}`);
      }
      modules += gr.count * gr.fill.modules;
      parallel += gr.count * gr.fill.rows.filter((rw) => rw.strings > 1).length;
      warnings += gr.count * (check.mppts.reduce((w, rw) => w + rw.problems.length, 0) + (check.headroom ? 1 : 0));
      return { ...gr, check };
    });
  });
  const dcKwp = (modules * m.wp) / 1000;
  const ratio = acTotal ? dcKwp / acTotal : null;
  const fits = modules === N;
  if (!parts.length) issues.push("Add at least one inverter.");
  else if (ratio !== null && modules && (ratio < ratioMin - EPS || ratio > ratioMax + EPS)) issues.push(`DC/AC ${ratio.toFixed(2)} is outside ${ratioMin}–${ratioMax}.`);
  const label = parts.map((p) => `${p.qty} × ${p.inverter.model}`).join(" + ");
  return { label, parts, target_modules: N, modules, dc_kwp: dcKwp, ac_kw: acTotal, ratio, fits,
           ok: ok && fits && ratio !== null && ratio >= ratioMin - EPS && ratio <= ratioMax + EPS,
           parallel, warnings, issues, inverters: parts.reduce((t, p) => t + p.qty, 0) };
}

/**
 * Inverter configurations for a module count. Inverter choice follows the offer deck
 * (suggestInverters: fewest inverters, ratio within ratioMin..ratioMax, closest to 1.0); each is
 * strung with designFor (the fill-all-inputs method). Only configurations that take every module
 * and pass the hard rules are returned, in the offer deck's order.
 */
export function proposeDesigns(m, inverters, d, s, { modules: N, ratioMin = 0.8, ratioMax = 1.25, seriesOnly = false, limit = 8 } = {}) {
  if (!m || !m.wp || !N || N <= 0) return [];
  const ready = inverters.filter((v) => inverterReady(v) && v.ac_kw);
  const byId = new Map(ready.map((v) => [v.id, v]));
  const combos = suggestInverters((N * m.wp) / 1000, ready, { limit: 80, min: ratioMin, max: ratioMax });
  const out = [];
  combos.forEach((c, order) => {
    const parts = c.inverters.map(({ inverter_id, qty }) => ({ inverter: byId.get(inverter_id), qty }));
    const des = designFor(m, parts, d, s, { modules: N, ratioMin, ratioMax, seriesOnly });
    if (des.ok) out.push({ ...des, order });
  });
  out.sort((a, b) => a.order - b.order);
  return out.slice(0, limit);
}
