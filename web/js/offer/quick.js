// Quick offers: a deck from a handful of inputs (client, equipment and counts, price per kWp,
// pictures and figures from the Helioscope reports) without a full project. A saved quick
// offer lives in the "offers" store; toProject() turns it into the project shape that
// buildOfferValues / generateOffer expect.

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
  module_id: null, module_count: null, inverter_id: null, inverter_qty: null,
  dc_kwp: null, ac_kw: null,           // used only when no module / inverter is chosen
  annual_gen_kwh: null, specific_yield: SPECIFIC_YIELD, monthly_kwh: null, shading_loss_pct: null,
  installation_type: "Elevated Flat Roof", elevation_m: null, tilt_deg: null, azimuth_deg: null,
  tariff_bz: 32, degradation_pct: 0.65, vat_pct: 5,
  schedule: null, logo_corners: {},
  offer_site_file_id: null, offer_shadow_file_id: null, offer_structure_file_id: null, offer_structure2_file_id: null,
};

const isNum = (v) => typeof v === "number" && Number.isFinite(v) && v > 0;

// Words left out of a reference code: "Petroleum Development Oman" -> PDO.
const SKIP = new Set(["of", "the", "and", "for", "&", "llc", "l.l.c", "l.l.c.", "saog", "saoc", "spc", "co", "co.", "company", "est", "est."]);
/** Suggested reference code: the first letters of the client's name. */
export function suggestCode(name) {
  return String(name || "").split(/[\s\-–]+/).filter((w) => /^\p{L}/u.test(w) && !SKIP.has(w.toLowerCase()))
    .map((w) => w[0]).join("").toUpperCase().slice(0, 6);
}

/** DC kWp / AC kW: library item × count when chosen, else the figure typed in. */
export function capacities(o, lookup = {}) {
  const module = (o.module_id && lookup.module?.get(o.module_id)) || null;
  const inverter = (o.inverter_id && lookup.inverter?.get(o.inverter_id)) || null;
  const dc = module && isNum(o.module_count) ? (module.wp * o.module_count) / 1000 : isNum(o.dc_kwp) ? o.dc_kwp : null;
  const ac = inverter && isNum(o.inverter_qty) ? inverter.ac_kw * o.inverter_qty : isNum(o.ac_kw) ? o.ac_kw : null;
  return { module, inverter, dc, ac };
}

/** Annual kWh: the 12 monthly figures, else the annual figure, else DC kWp × specific yield. */
export function annualKwh(o, dc = o.dc_kwp) {
  if (Array.isArray(o.monthly_kwh) && o.monthly_kwh.length === 12) return { kwh: o.monthly_kwh.reduce((a, b) => a + b, 0), source: "monthly" };
  if (isNum(o.annual_gen_kwh)) return { kwh: o.annual_gen_kwh, source: "annual" };
  if (isNum(dc)) return { kwh: dc * (isNum(o.specific_yield) ? o.specific_yield : SPECIFIC_YIELD), source: "yield" };
  return { kwh: null, source: null };
}

/** Price before VAT: OMR per kWp × DC kWp (older offers stored the total). */
export function subtotal(o, dc) {
  if (isNum(o.price_per_kwp) && isNum(dc)) return Math.round(o.price_per_kwp * dc * 1000) / 1000;
  return isNum(o.subtotal_omr) ? o.subtotal_omr : null;
}

/** The project-shaped record a quick offer stands for. `lookup` = { module, inverter, client } maps from data.loadAll(). */
export function toProject(o, lookup = {}) {
  const { module, inverter, dc, ac } = capacities(o, lookup);
  const client = [...(lookup.client?.values() || [])].find((c) => c.name === o.client_name) || { name: o.client_name };
  const { kwh } = annualKwh(o, dc);
  return {
    ...o,
    name: o.client_name,
    reference_code: o.reference_code || suggestCode(o.client_name),
    client, module, inverter,
    dc_kwp: dc, ac_kw: ac,
    module_count: module ? (isNum(o.module_count) ? o.module_count : dc ? Math.round((dc * 1000) / module.wp) : null) : null,
    inverter_qty: inverter ? (isNum(o.inverter_qty) ? o.inverter_qty : ac ? Math.max(1, Math.round(ac / inverter.ac_kw)) : null) : null,
    subtotal_omr: subtotal(o, dc),
    annual_gen_kwh: kwh ? Math.round(kwh) : null,
    schedule: o.schedule || DEFAULT_SCHEDULE,
  };
}

/** Labels of what a quick offer still needs. */
export function quickMissing(o, lookup = {}) {
  const { dc, ac } = capacities(o, lookup);
  return [[o.client_name, "Client name"], [dc, "DC capacity (module and number of panels)"],
    [ac, "AC capacity (inverter and quantity)"], [o.price_per_kwp || o.subtotal_omr, "Price per kWp"]]
    .filter(([v]) => v === null || v === undefined || v === "" || v === 0).map(([, label]) => label);
}
