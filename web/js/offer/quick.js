// Quick offers: a deck from a handful of inputs (client, DC / AC capacity, price, pictures)
// without a full project. A saved quick offer lives in the "offers" store; toProject() turns
// it into the project shape that buildOfferValues / generateOffer expect.

// kWh per kWp per year when no generation figure is given (HTC's EPA Calc sheet uses 1,650).
export const SPECIFIC_YIELD = 1650;

export const IMAGE_KEYS = [
  ["offer_site_file_id", "Proposed location", "Satellite / site picture"],
  ["offer_shadow_file_id", "Shadow analysis", "e.g. Helioscope shading. Blank drops that slide"],
  ["offer_structure_file_id", "Mounting structure", "3D view or photo of the structure"],
];

export const QUICK_DEFAULTS = {
  client_name: "", reference_code: "", dc_kwp: null, ac_kw: null, subtotal_omr: null,
  annual_gen_kwh: null, specific_yield: SPECIFIC_YIELD, monthly_kwh: null,
  module_id: null, inverter_id: null, installation_type: "Elevated Flat Roof", elevation_m: null,
  tilt_deg: null, azimuth_deg: null, tariff_bz: 32, degradation_pct: 0.65, vat_pct: 5,
  offer_site_file_id: null, offer_shadow_file_id: null, offer_structure_file_id: null,
};

const isNum = (v) => typeof v === "number" && Number.isFinite(v) && v > 0;

/** Annual kWh: the 12 monthly figures, else the annual figure, else DC kWp × specific yield. */
export function annualKwh(o) {
  if (Array.isArray(o.monthly_kwh) && o.monthly_kwh.length === 12) return { kwh: o.monthly_kwh.reduce((a, b) => a + b, 0), source: "monthly" };
  if (isNum(o.annual_gen_kwh)) return { kwh: o.annual_gen_kwh, source: "annual" };
  if (isNum(o.dc_kwp)) return { kwh: o.dc_kwp * (isNum(o.specific_yield) ? o.specific_yield : SPECIFIC_YIELD), source: "yield" };
  return { kwh: null, source: null };
}

/**
 * The project-shaped record a quick offer stands for. `lookup` = { module, inverter, client }
 * maps from data.loadAll(). Module count and inverter quantity are worked out from the
 * capacities when a module / inverter is picked.
 */
export function toProject(o, lookup = {}) {
  const module = (o.module_id && lookup.module?.get(o.module_id)) || null;
  const inverter = (o.inverter_id && lookup.inverter?.get(o.inverter_id)) || null;
  const client = [...(lookup.client?.values() || [])].find((c) => c.name === o.client_name) || { name: o.client_name };
  const { kwh } = annualKwh(o);
  return {
    ...o,
    name: o.client_name,
    client, module, inverter,
    module_count: module && isNum(o.dc_kwp) ? Math.round((o.dc_kwp * 1000) / module.wp) : null,
    inverter_qty: inverter && isNum(o.ac_kw) ? Math.max(1, Math.round(o.ac_kw / inverter.ac_kw)) : null,
    annual_gen_kwh: kwh ? Math.round(kwh) : null,
  };
}

/** Labels of what a quick offer still needs. */
export function quickMissing(o) {
  return [[o.client_name, "Client name"], [o.dc_kwp, "DC capacity"], [o.ac_kw, "AC capacity"], [o.subtotal_omr, "Price"]]
    .filter(([v]) => v === null || v === undefined || v === "" || v === 0).map(([, label]) => label);
}
