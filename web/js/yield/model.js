// Yield simulation: hour by hour through a typical year, from weather to energy at the grid.
//
// The chain (each step shows up as a line in the loss diagram):
//  1. Irradiance on the plane: beam + Perez sky diffuse + ground reflection (albedo).
//  2. Near shading (a % from Helioscope or a site survey), incidence angle (ASHRAE b0, beam and
//     circumsolar per hour, sky and ground by an integrated factor) and soiling.
//  3. Bifacial rear side (optional): ground-reflected and sky light on the back, times the
//     module's bifaciality and a rear factor for row shading and the structure.
//  4. PV array: STC power × effective irradiance, a low-light efficiency curve (relative
//     efficiency at 200 W/m²), and the module's Pmax temperature coefficient at the cell
//     temperature from PVsyst's thermal model, Tc = Ta + α·G·(1 − η) / (Uc + Uv·wind).
//  5. Module quality, LID and mismatch (fixed %), DC wiring (% at STC, scaling with current²).
//  6. Inverter: PVWatts efficiency curve from the datasheet's European efficiency, clipped at
//     the rated AC power.
//  7. AC wiring (% at rated AC power, scaling with current²), transformer and availability (fixed %).
//
// Expect results within a few percent of PVsyst for simple systems; keep PVsyst for anything
// a bank or utility will scrutinise.

import { airMass, cosIncidence, dayOfYear, diffuseIam, extraRadiation, iamAshrae, perezDiffuse, sunPosition } from "./solar.js";

const RAD = Math.PI / 180;
export const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** Heat-loss factor Uc (W/m²K) by how the modules are mounted, from PVsyst's guidance. */
export const MOUNT_U = {
  free: { label: "Free-standing / open rack (ground, car park, elevated roof)", uc: 29 },
  semi: { label: "Close to the roof (flush mount, metal sheet roof)", uc: 20 },
  integrated: { label: "Integrated / insulated back", uc: 15 },
};

/** Loss settings and their defaults. Shown and edited on the yield page. */
export const SETTINGS = [
  { key: "albedo", label: "Ground albedo", unit: "", def: 0.2, group: "Irradiance", hint: "0.2 grass or concrete; desert sand 0.25–0.35; white roof up to 0.6" },
  { key: "shading_pct", label: "Near shading loss", unit: "%", def: 0, group: "Irradiance", hint: "From Helioscope or a shading study" },
  { key: "iam_b0", label: "Incidence angle b0 (ASHRAE)", unit: "", def: 0.05, group: "Irradiance", hint: "PVsyst default 0.05" },
  { key: "soiling_pct", label: "Soiling", unit: "%", def: 2, group: "Irradiance", hint: "Depends on dust and cleaning; 2–5 % is common in the Gulf" },
  { key: "mount", label: "Mounting (thermal)", unit: "", def: "free", group: "Array", type: "choice", choices: MOUNT_U },
  { key: "uc", label: "Uc, constant heat loss", unit: "W/m²K", def: null, group: "Array", hint: "Blank uses the mounting's value" },
  { key: "uv", label: "Uv, wind heat loss", unit: "W/m²K per m/s", def: 0, group: "Array", hint: "PVsyst default 0" },
  { key: "low_light_pct", label: "Efficiency loss at 200 W/m²", unit: "%", def: 2.5, group: "Array", hint: "Relative to STC; from the datasheet's low-irradiance figure" },
  { key: "quality_pct", label: "Module quality", unit: "%", def: 0, group: "Array", hint: "Negative for a gain, e.g. −0.4 with a 0/+5 W tolerance" },
  { key: "lid_pct", label: "Light-induced degradation (LID)", unit: "%", def: 1, group: "Array", hint: "" },
  { key: "mismatch_pct", label: "Mismatch", unit: "%", def: 1, group: "Array", hint: "" },
  { key: "dc_ohmic_pct", label: "DC wiring loss at STC", unit: "%", def: 1.5, group: "Array", hint: "Blank uses the DC cable drop from the sizing page, if entered" },
  { key: "bifacial", label: "Count the bifacial rear side", unit: "", def: false, group: "Array", type: "bool", hint: "Only if the module has a bifaciality factor" },
  { key: "rear_factor", label: "Rear irradiance factor", unit: "", def: 0.6, group: "Array", hint: "Share of the rear light that reaches the cells (row shading, structure, mismatch)" },
  { key: "inv_eff_pct", label: "Inverter efficiency (European)", unit: "%", def: null, group: "System", hint: "Blank uses the datasheet" },
  { key: "ac_ohmic_pct", label: "AC wiring loss at rated power", unit: "%", def: 0.5, group: "System", hint: "Blank uses the AC cable drop from the sizing page, if entered" },
  { key: "transformer_pct", label: "Transformer loss", unit: "%", def: 0, group: "System", hint: "MV step-up only" },
  { key: "availability_pct", label: "Unavailability", unit: "%", def: 0, group: "System", hint: "Downtime and grid outages" },
];
const BY_KEY = Object.fromEntries(SETTINGS.map((s) => [s.key, s]));

/** Settings with every blank filled from the defaults (null stays null where "blank" has a meaning). */
export function settingsWithDefaults(saved = {}) {
  const out = {};
  for (const s of SETTINGS) {
    const v = saved[s.key];
    out[s.key] = v === undefined || v === "" ? s.def : v;
  }
  if (!(out.mount in MOUNT_U)) out.mount = "free";
  return out;
}

/** A sensible mounting for a project, from its mounting and installation type. */
export function mountFor(p) {
  const t = `${p.installation_type || ""}`.toLowerCase();
  if (/flush|metal|sheet|tile|pitched/.test(t)) return "semi";
  return "free";
}

/**
 * What the simulation needs from a project, its module and inverter. Returns
 * { system, missing: [labels] }.
 */
export function systemFrom(p, sizingResult = null) {
  const m = p.module, inv = p.inverter;
  const missing = [];
  if (!Number.isFinite(p.latitude) || !Number.isFinite(p.longitude)) missing.push("site latitude and longitude");
  if (!Number.isFinite(p.tilt_deg)) missing.push("tilt");
  if (!Number.isFinite(p.azimuth_deg)) missing.push("azimuth");
  if (!m || !(m.wp > 0)) missing.push("PV module (with its Wp)");
  if (!(p.module_count > 0)) missing.push("module count");
  if (!inv || !(inv.ac_kw > 0)) missing.push("inverter (with its AC power)");
  if (!(p.inverter_qty > 0)) missing.push("inverter quantity");
  if (missing.length) return { system: null, missing };
  const cables = sizingResult?.cables || {};
  return {
    missing,
    system: {
      lat: p.latitude, lon: p.longitude, tilt: p.tilt_deg, azimuth: p.azimuth_deg,
      modules: p.module_count, module_wp: m.wp, dc_wp: m.wp * p.module_count,
      gamma: Number.isFinite(m.tc_pmax_pct) ? m.tc_pmax_pct / 100 : -0.0035,
      module_eff: m.efficiency_pct > 0 ? m.efficiency_pct / 100 : 0.2,
      bifaciality: m.bifaciality > 0 ? m.bifaciality : 0,
      inverters: p.inverter_qty, inverter_kw: inv.ac_kw, ac_w: inv.ac_kw * p.inverter_qty * 1000,
      inv_eff: inv.euro_eff_pct > 0 ? inv.euro_eff_pct / 100 : inv.max_eff_pct > 0 ? (inv.max_eff_pct - 1) / 100 : 0.97,
      dc_drop_pct: Number.isFinite(cables.dc_drop) ? cables.dc_drop : null,
      ac_drop_pct: Number.isFinite(cables.ac_drop) ? cables.ac_drop : null,
    },
  };
}

/** PVWatts inverter model: AC power (W) from DC power for the inverter fleet, before clipping. */
export function inverterAc(pdc, pac0, etaNom) {
  if (pdc <= 0) return 0;
  const pdc0 = pac0 / etaNom;
  const z = pdc / pdc0;
  const eta = (etaNom / 0.9637) * (-0.0162 * z - 0.0059 / z + 0.9858);
  return Math.max(0, eta * pdc);
}

/** PVsyst cell temperature model (°C). */
export function cellTemp(g, tamb, wind, uc, uv, eff, alpha = 0.9) {
  return tamb + (alpha * g * (1 - eff)) / (uc + uv * wind);
}

/**
 * Run the year. `w` is from weather.js, `sys` from systemFrom(), `cfg` from settingsWithDefaults().
 * Returns { monthly: [12 rows], year, losses: [steps], notes, hottest_cell }.
 */
export function simulate(w, sys, cfg) {
  const pct = (v) => (Number(v) || 0) / 100;
  const uc = Number.isFinite(cfg.uc) && cfg.uc > 0 ? cfg.uc : MOUNT_U[cfg.mount].uc;
  const uv = Number(cfg.uv) || 0;
  const b0 = Number(cfg.iam_b0) || 0;
  const albedo = Number(cfg.albedo) || 0;
  const dif = diffuseIam(sys.tilt, b0);
  const llA = pct(cfg.low_light_pct) / Math.log(5); // η_rel = 1 + a·ln(G/1000): 1 − loss at 200 W/m²
  const dcOhm = cfg.dc_ohmic_pct === null || cfg.dc_ohmic_pct === undefined
    ? (sys.dc_drop_pct ?? BY_KEY.dc_ohmic_pct.def) : cfg.dc_ohmic_pct;
  const acOhm = cfg.ac_ohmic_pct === null || cfg.ac_ohmic_pct === undefined
    ? (sys.ac_drop_pct ?? BY_KEY.ac_ohmic_pct.def) : cfg.ac_ohmic_pct;
  const etaInv = Number.isFinite(cfg.inv_eff_pct) && cfg.inv_eff_pct > 0 ? cfg.inv_eff_pct / 100 : sys.inv_eff;
  const bif = cfg.bifacial && sys.bifaciality > 0 ? sys.bifaciality * (Number(cfg.rear_factor) || 0) : 0;
  const cosT = Math.cos(sys.tilt * RAD);
  const fixed = (1 - pct(cfg.quality_pct)) * (1 - pct(cfg.lid_pct)) * (1 - pct(cfg.mismatch_pct));
  const after = (1 - pct(cfg.transformer_pct)) * (1 - pct(cfg.availability_pct));
  const P = sys.dc_wp, PAC = sys.ac_w;

  // running totals, Wh (or Wh/m² for irradiance), per month
  const KEYS = ["ghi", "dhi", "poa", "beam", "shaded", "iam", "eff", "rear", "nom", "lowlight", "temp", "fixed", "array",
                "inv", "clip", "acohm", "grid", "hours", "tsum", "tcell_sum", "sun_hours"];
  const mon = Array.from({ length: 12 }, () => Object.fromEntries(KEYS.map((k) => [k, 0])));
  let hottest = -Infinity;

  for (let i = 0; i < w.time.length; i++) {
    const ms = w.time[i];
    const M = mon[w.month[i]];
    const ghi = w.ghi[i], dni = w.dni[i], dhi = w.dhi[i], ta = w.tamb[i];
    M.ghi += ghi; M.dhi += dhi; M.hours++; M.tsum += ta;
    if (ghi <= 0 && dhi <= 0) continue;

    const sun = sunPosition(ms, sys.lat, sys.lon);
    const cosA = cosIncidence(sys.tilt, sys.azimuth, sun.zenith, sun.azimuth);
    const up = sun.zenith < 90;
    const beam = up ? dni * Math.max(cosA, 0) : 0;
    const sky = perezDiffuse(sys.tilt, cosA, dhi, up ? dni : 0, extraRadiation(dayOfYear(ms)), sun.zenith);
    const gnd = ghi * albedo * (1 - cosT) / 2;
    const poa = beam + sky.total + gnd;
    M.poa += poa; M.beam += beam;

    const sh = 1 - pct(cfg.shading_pct);
    const iamB = iamAshrae(cosA, b0);
    const front = sh * ((beam + sky.circumsolar) * iamB + (sky.total - sky.circumsolar) * dif.sky + gnd * dif.ground);
    M.shaded += poa * sh;
    M.iam += front;
    const eff = front * (1 - pct(cfg.soiling_pct));
    M.eff += eff;
    const rear = bif ? (ghi * albedo * (1 + cosT) / 2 + dhi * (1 - cosT) / 2) * bif : 0;
    M.rear += rear;
    const g = eff + rear;
    if (g <= 0) continue;
    M.sun_hours++;

    const nom = (P * g) / 1000;
    const ll = Math.max(0, 1 + llA * Math.log(g / 1000));
    const tc = cellTemp(g, ta, w.wind[i], uc, uv, sys.module_eff);
    hottest = Math.max(hottest, tc);
    M.tcell_sum += tc;
    const pLL = nom * ll;
    const pT = pLL * (1 + sys.gamma * (tc - 25));
    const pF = Math.max(0, pT * fixed);
    const pDC = Math.max(0, pF * (1 - pct(dcOhm) * (pF / P)));
    const acRaw = inverterAc(pDC, PAC, etaInv);
    const ac = Math.min(acRaw, PAC);
    const acOut = Math.max(0, ac * (1 - pct(acOhm) * (ac / PAC)));
    M.nom += nom; M.lowlight += pLL; M.temp += pT; M.fixed += pF; M.array += pDC;
    M.inv += acRaw; M.clip += ac; M.acohm += acOut; M.grid += acOut * after;
  }

  const kwp = P / 1000;
  const monthly = mon.map((M, i) => ({
    month: MONTHS[i],
    ghi: M.ghi / 1000, dhi: M.dhi / 1000, tamb: M.hours ? M.tsum / M.hours : null,
    poa: M.poa / 1000, eff: (M.eff + M.rear) / 1000,
    e_array: M.array / 1000, e_grid: M.grid / 1000,
    pr: M.poa > 0 ? M.grid / 1000 / ((M.poa / 1000) * kwp) : null,
  }));
  const S = Object.fromEntries(KEYS.map((k) => [k, mon.reduce((a, M) => a + M[k], 0)]));
  const year = {
    ghi: S.ghi / 1000, dhi: S.dhi / 1000, poa: S.poa / 1000, eff: (S.eff + S.rear) / 1000,
    tamb: S.hours ? S.tsum / S.hours : null,
    e_array: S.array / 1000, e_grid: S.grid / 1000,
    specific: S.grid / 1000 / kwp, pr: S.poa > 0 ? S.grid / 1000 / ((S.poa / 1000) * kwp) : null,
    dc_kwp: kwp, ac_kw: PAC / 1000, ratio: P / PAC,
  };

  // loss diagram: each step relative to the one before
  const step = (label, from, to, kind) => ({ label, kind, pct: from > 0 ? ((to - from) / from) * 100 : 0, value: to / 1000 });
  const losses = [
    { label: "Global horizontal irradiance", kind: "start-irr", value: S.ghi / 1000 },
    step("Global incident on the plane (transposition)", S.ghi, S.poa, "irr"),
    step("Near shading", S.poa, S.shaded, "irr"),
    step("Incidence angle (IAM)", S.shaded, S.iam, "irr"),
    step("Soiling", S.iam, S.eff, "irr"),
    ...(bif ? [step("Bifacial rear side", S.eff, S.eff + S.rear, "irr")] : []),
    { label: "Effective irradiance on the collectors", kind: "mid-irr", value: (S.eff + S.rear) / 1000 },
    { label: `Array nominal energy at STC efficiency (${num(kwp)} kWp)`, kind: "start-e", value: S.nom / 1000 },
    step("Low irradiance", S.nom, S.lowlight, "e"),
    step("Module temperature", S.lowlight, S.temp, "e"),
    step("Module quality, LID and mismatch", S.temp, S.fixed, "e"),
    step("DC wiring", S.fixed, S.array, "e"),
    { label: "Array virtual energy at MPP (DC)", kind: "mid-e", value: S.array / 1000 },
    step("Inverter efficiency", S.array, S.inv, "e"),
    step("Inverter clipping (over nominal power)", S.inv, S.clip, "e"),
    step("AC wiring", S.clip, S.acohm, "e"),
    step("Transformer and unavailability", S.acohm, S.grid, "e"),
    { label: "Energy injected into the grid", kind: "end-e", value: S.grid / 1000 },
  ];

  const notes = [];
  if (cfg.bifacial && !(sys.bifaciality > 0)) notes.push("Bifacial gain is on, but the module has no bifaciality factor in the library, so none was counted.");
  if (year.ratio > 1.5) notes.push(`DC/AC ratio ${num(year.ratio)}: expect noticeable clipping.`);

  return {
    monthly, year, losses, notes,
    hottest_cell: Number.isFinite(hottest) ? hottest : null,
    used: { uc, uv, dc_ohmic_pct: dcOhm, ac_ohmic_pct: acOhm, inv_eff_pct: etaInv * 100, iam_sky: dif.sky, iam_ground: dif.ground, bifacial_factor: bif },
  };
}

function num(v) { return Number(v.toFixed(2)).toString(); }
