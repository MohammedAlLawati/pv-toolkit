// Quick offers: a deck from a handful of inputs (client, equipment and counts, price per kWp,
// pictures and figures from the Helioscope reports) without a full project. A saved quick
// offer lives in the "offers" store; toProject() turns it into the project shape that
// buildOfferValues / generateOffer expect.

import { JINKO_MODULES } from "../seed_data.js";

// kWh per kWp per year when no generation figure is given (HTC's EPA Calc sheet uses 1,650).
export const SPECIFIC_YIELD = 1650;

// [field, label, which slide, hint]
export const IMAGE_KEYS = [
  ["offer_site_file_id", "Proposed location", "slide 14", "Helioscope detailed layout"],
  ["offer_shadow_file_id", "Shadow analysis", "slide 16", "Shading heatmap. Blank drops that slide"],
  ["offer_structure_file_id", "3D view, left", "slide 17", "From the shading report, page 2"],
  ["offer_structure2_file_id", "3D view, right", "slide 17", "From the shading report, page 2"],
];
// the deck's name for each picture (see generate.js offerImages)
export const SLOT_OF = { offer_site_file_id: "site", offer_shadow_file_id: "shadow",
  offer_structure_file_id: "structure", offer_structure2_file_id: "structure2" };

export const DESIGN_TYPES = ["Carpark", "Elevated Flat Roof", "Ballasted", "Ground Mounted"];

// The template's schedule (weeks 1 to 40, two weeks' contingency included).
export const DEFAULT_SCHEDULE = [
  { n: 1, name: "Award & Orientation", start: 1, weeks: 1 },
  { n: 2, name: "Design Concept Submission and Documentation Approval", start: 1, weeks: 1 },
  { n: 3, name: "Statutory & Regulatory Approvals", start: 2, weeks: 8 },
  { n: 4, name: "Procurement, Clearances & Delivery to site", start: 2, weeks: 11 },
  { n: 5, name: "Mobilization to Site/Site Preparation", start: 10, weeks: 6 },
  { n: 6, name: "All Installation (Mechanical and Electrical)", start: 13, weeks: 24 },
  { n: 7, name: "Testing, Inspections and Commissioning", start: 35, weeks: 4 },
  { n: 8, name: "Hand Over", start: 39, weeks: 1 },
];
export const MAX_WEEKS = 40;

export const QUICK_DEFAULTS = {
  client_name: "", reference_code: "", price_per_kwp: null,
  // the system: one or more sub-systems, each with its own modules and inverter combination
  // [{ name, desc, module_id, modules, dc_kwp, inverters: [{ inverter_id, qty }], ac_kw }]
  // (dc_kwp / ac_kw are typed only when the module / inverters aren't in the library)
  subsystems: [],
  annual_gen_kwh: null, specific_yield: SPECIFIC_YIELD, monthly_kwh: null, shading_loss_pct: null, pr_pct: null,
  installation_type: "Elevated Flat Roof", elevation_m: null, tilt_deg: null, azimuth_deg: null,
  tariff_bz: 32, degradation_pct: 0.65, vat_pct: 5,
  schedule: null, logo_corners: {},
  offer_site_file_id: null, offer_shadow_file_id: null, offer_structure_file_id: null, offer_structure2_file_id: null,
};

// DC/AC ratio limits, for each sub-system and the whole system.
export const DCAC_MIN = 0.8, DCAC_MAX = 1.2;
// Suggested combinations are ranked by how close their ratio comes to this.
export const DCAC_TARGET = 1.0;

const num2 = (v) => String(Math.round(v * 100) / 100);
const isNum = (v) => typeof v === "number" && Number.isFinite(v) && v > 0;

// Words left out of a reference code: "Petroleum Development Oman" -> PDO.
const SKIP = new Set(["of", "the", "and", "for", "&", "llc", "l.l.c", "l.l.c.", "saog", "saoc", "spc", "co", "co.", "company", "est", "est."]);
/** Suggested reference code: the first letters of the client's name. */
export function suggestCode(name) {
  return String(name || "").split(/[\s\-–]+/).filter((w) => /^\p{L}/u.test(w) && !SKIP.has(w.toLowerCase()))
    .map((w) => w[0]).join("").toUpperCase().slice(0, 6);
}

/**
 * The offer's sub-systems in the current shape. Offers saved before sub-systems carried their
 * own equipment had one module and one inverter (module_id × module_count, inverter_id ×
 * inverter_qty) and, when split, counts of those per sub-system.
 */
export function systemsOf(o) {
  const rows = Array.isArray(o.subsystems) ? o.subsystems : [];
  if (rows.length && rows.every((r) => Array.isArray(r.inverters))) return rows;
  const inv = (qty) => (o.inverter_id && isNum(qty) ? [{ inverter_id: o.inverter_id, qty }] : []);
  if (o.split_system && rows.length) {
    return rows.map((r) => ({ name: r.name || "", desc: r.desc || "", module_id: o.module_id || null, modules: r.modules ?? null,
                              dc_kwp: null, inverters: inv(r.inverters), ac_kw: null }));
  }
  return [{ name: "", desc: "", module_id: o.module_id || null, modules: o.module_count ?? null, dc_kwp: o.dc_kwp ?? null,
            inverters: inv(o.inverter_qty), ac_kw: o.inverter_id ? null : o.ac_kw ?? null }];
}

/** DC/AC ratio, or null. */
export const ratioOf = (dc, ac) => (isNum(dc) && isNum(ac) ? dc / ac : null);
export const ratioOk = (r) => r !== null && r >= DCAC_MIN - 1e-9 && r <= DCAC_MAX + 1e-9;

/**
 * Each sub-system with its equipment looked up and its capacities worked out, plus the totals:
 * { rows: [{ ...sub, module, dc, invs: [{ inverter, qty }], ac, ratio, count }], dc, ac, ratio, modules, inverterQty,
 *   module (the one most panels use), inverter (the one giving the most AC) }.
 */
export function systemTotals(o, lookup = {}) {
  const rows = systemsOf(o).map((r) => {
    const module = withDegradation((r.module_id && lookup.module?.get(r.module_id)) || null);
    const dc = module && isNum(r.modules) ? (module.wp * r.modules) / 1000 : isNum(r.dc_kwp) ? r.dc_kwp : null;
    const invs = (r.inverters || []).map((x) => ({ inverter: lookup.inverter?.get(x.inverter_id) || null, qty: x.qty }))
      .filter((x) => x.inverter && isNum(x.qty));
    const ac = invs.length ? invs.reduce((t, x) => t + x.inverter.ac_kw * x.qty, 0) : isNum(r.ac_kw) ? r.ac_kw : null;
    return { ...r, module, dc, invs, ac, ratio: ratioOf(dc, ac), count: invs.reduce((t, x) => t + x.qty, 0) };
  });
  const sum = (k) => (rows.some((r) => isNum(r[k])) ? rows.reduce((t, r) => t + (r[k] || 0), 0) : null);
  const dc = sum("dc"), ac = sum("ac");
  // the main module / inverter: the one most panels / most AC use (keyed by model: entries are copies)
  const byModule = new Map(), byInverter = new Map();
  const tally = (m, item, n) => { const e = m.get(item.model) || { item, n: 0 }; e.n += n; m.set(item.model, e); };
  for (const r of rows) {
    if (r.module && isNum(r.modules)) tally(byModule, r.module, r.modules);
    for (const x of r.invs) tally(byInverter, x.inverter, x.inverter.ac_kw * x.qty);
  }
  const most = (m) => [...m.values()].sort((a, b) => b.n - a.n)[0]?.item || null;
  // equipment counts only when every sub-system's capacity comes from the library
  const allModules = rows.every((r) => r.module && isNum(r.modules)), allInverters = rows.every((r) => r.invs.length);
  return {
    rows, dc, ac, ratio: ratioOf(dc, ac),
    modules: allModules ? rows.reduce((t, r) => t + r.modules, 0) : null,
    inverterQty: allInverters ? rows.reduce((t, r) => t + r.count, 0) : null,
    module: most(byModule), inverter: most(byInverter),
    moduleModels: [...byModule.keys()], inverterModels: [...byInverter.keys()],
  };
}

/** DC kWp / AC kW of the whole system, with the main module and inverter. */
export function capacities(o, lookup = {}) {
  const t = systemTotals(o, lookup);
  return { module: t.module, inverter: t.inverter, dc: t.dc, ac: t.ac };
}

/**
 * Inverter combinations for a DC capacity whose DC/AC ratio is within DCAC_MIN..DCAC_MAX.
 * Uses at most two different models (fewer spares to stock), and no inverter that could be left out
 * while staying within the limits. Ranked by number of inverters,
 * then by how close the ratio is to DCAC_TARGET, then one model before two.
 * Returns [{ inverters: [{ inverter_id, qty }], ac, ratio, count, label }], best first.
 */
export function suggestInverters(dc, inverters, { limit = 6, maxCount = 60 } = {}) {
  if (!isNum(dc)) return [];
  const lo = dc / DCAC_MAX, hi = dc / DCAC_MIN;
  const sizes = [...new Map(inverters.filter((i) => isNum(i.ac_kw)).map((i) => [i.id, i])).values()];
  const out = [];
  const add = (parts) => {
    parts.sort((x, y) => y[1] - x[1] || y[0].ac_kw - x[0].ac_kw);
    const ac = parts.reduce((t, [inv, n]) => t + inv.ac_kw * n, 0);
    if (ac < lo - 1e-9 || ac > hi + 1e-9) return;
    // every inverter must be needed: without the smallest one the ratio would go over the limit
    if (ac - Math.min(...parts.map(([inv]) => inv.ac_kw)) >= lo - 1e-9) return;
    out.push({ inverters: parts.map(([inv, qty]) => ({ inverter_id: inv.id, qty })), ac, ratio: dc / ac,
               count: parts.reduce((t, [, n]) => t + n, 0), models: parts.length,
               label: parts.map(([inv, n]) => `${n} × ${inv.model}`).join(" + ") });
  };
  // fewest inverters first: stop one size after the smallest count that works
  let found = null;
  for (let k = 1; k <= maxCount && (found === null || k <= found + 1); k++) {
    const before = out.length;
    for (const a of sizes) add([[a, k]]);
    for (let i = 0; i < sizes.length; i++) {
      for (let j = i + 1; j < sizes.length; j++) {
        for (let n = 1; n < k; n++) add([[sizes[i], n], [sizes[j], k - n]]);
      }
    }
    if (found === null && out.length > before) found = k;
  }
  out.sort((x, y) => x.count - y.count || Math.abs(x.ratio - DCAC_TARGET) - Math.abs(y.ratio - DCAC_TARGET) || x.models - y.models);
  return out.slice(0, limit);
}

/** Annual kWh: the annual figure, else the 12 monthly figures, else DC kWp × specific yield. */
export function annualKwh(o, dc = o.dc_kwp) {
  if (isNum(o.annual_gen_kwh)) return { kwh: o.annual_gen_kwh, source: "annual" };
  if (Array.isArray(o.monthly_kwh) && o.monthly_kwh.length === 12) return { kwh: o.monthly_kwh.reduce((a, b) => a + b, 0), source: "monthly" };
  if (isNum(dc)) return { kwh: dc * (isNum(o.specific_yield) ? o.specific_yield : SPECIFIC_YIELD), source: "yield" };
  return { kwh: null, source: null };
}

/** The 12 monthly figures in the shape read off the report, scaled to the annual figure. */
function monthlyScaled(o, kwh) {
  if (!Array.isArray(o.monthly_kwh) || o.monthly_kwh.length !== 12 || !kwh) return null;
  const sum = o.monthly_kwh.reduce((a, b) => a + b, 0);
  return sum > 0 ? o.monthly_kwh.map((m) => (m * kwh) / sum) : null;
}

/** A library module, with the datasheet's degradation filled in for entries loaded before it was recorded. */
function withDegradation(module) {
  if (!module || isNum(module.degradation_first_pct)) return module;
  const seed = JINKO_MODULES.find((m) => m.model === module.model && m.make === module.make);
  return seed ? { ...module, degradation_first_pct: seed.degradation_first_pct, degradation_annual_pct: seed.degradation_annual_pct } : module;
}

/** What's wrong with the system's sizing (empty when nothing is): ratios outside the limits, empty sub-systems. */
export function systemIssues(o, lookup = {}) {
  const t = systemTotals(o, lookup), out = [];
  const many = t.rows.length > 1;
  const range = `${DCAC_MIN}–${DCAC_MAX}`;
  t.rows.forEach((r, i) => {
    const name = many ? `Sub-system ${i + 1}${r.name ? ` (${r.name})` : ""}` : "The system";
    if (!isNum(r.dc)) out.push(`${name} has no PV modules yet.`);
    else if (!isNum(r.ac)) out.push(`${name} has no inverters yet.`);
    else if (!ratioOk(r.ratio)) out.push(`${name}: DC/AC ratio ${num2(r.ratio)} is outside ${range} (${num2(r.dc)} kWp on ${num2(r.ac)} kW).`);
  });
  if (many && t.ratio !== null && !ratioOk(t.ratio)) out.push(`Whole system: DC/AC ratio ${num2(t.ratio)} is outside ${range}.`);
  return out;
}

/** Price before VAT: OMR per kWp × DC kWp (older offers stored the total). */
export function subtotal(o, dc) {
  if (isNum(o.price_per_kwp) && isNum(dc)) return Math.round(o.price_per_kwp * dc * 1000) / 1000;
  return isNum(o.subtotal_omr) ? o.subtotal_omr : null;
}

/** "1 × 150kW (SG150CX) and 1 × 125kW (SG125CX-P2)": the whole system's inverters. */
export function inverterMix(t) {
  const total = new Map();
  for (const r of t.rows) for (const x of r.invs) {
    const e = total.get(x.inverter.model) || { inv: x.inverter, n: 0 };
    e.n += x.qty; total.set(x.inverter.model, e);
  }
  const parts = [...total.values()].sort((a, b) => b.inv.ac_kw - a.inv.ac_kw)
    .map(({ inv, n }) => `${n} × ${num2(inv.ac_kw)}kW (${inv.model})`);
  return parts.length > 1 ? `${parts.slice(0, -1).join(", ")} and ${parts.at(-1)}` : parts[0] || "";
}

/** The project-shaped record a quick offer stands for. `lookup` = { module, inverter, client } maps from data.loadAll(). */
export function toProject(o, lookup = {}) {
  const t = systemTotals(o, lookup);
  const { module, inverter, dc, ac } = t;
  const client = [...(lookup.client?.values() || [])].find((c) => c.name === o.client_name) || { name: o.client_name };
  const { kwh } = annualKwh(o, dc);
  const makes = [...new Set(t.rows.flatMap((r) => r.invs.map((x) => x.inverter.make)))];
  return {
    ...o,
    name: o.client_name,
    reference_code: o.reference_code || suggestCode(o.client_name),
    client, module, inverter,
    dc_kwp: dc, ac_kw: ac,
    module_count: t.modules, inverter_qty: t.inverterQty,
    inverter_mix: inverterMix(t), inverter_makes: makes.join(" / "),
    module_models: t.moduleModels, inverter_models: t.inverterModels,
    subtotal_omr: subtotal(o, dc),
    annual_gen_kwh: kwh ? Math.round(kwh) : null,
    monthly_kwh: monthlyScaled(o, kwh),
    schedule: o.schedule || DEFAULT_SCHEDULE,
    // the breakdown slide: when there's more than one sub-system or inverter model
    subsystems: t.rows.length > 1 || t.inverterModels.length > 1 ? t.rows : [],
  };
}

/** Labels of what a quick offer still needs. */
export function quickMissing(o, lookup = {}) {
  const { dc, ac } = capacities(o, lookup);
  return [[o.client_name, "Client name"], [dc, "DC capacity (PV module and number of panels)"],
    [ac, "AC capacity (inverters)"], [o.price_per_kwp || o.subtotal_omr, "Price per kWp"]]
    .filter(([v]) => v === null || v === undefined || v === "" || v === 0).map(([, label]) => label);
}
