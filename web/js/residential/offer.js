// Residential offers: the simpler offer for homeowners, a Word document (the Execution
// Agreement template) in place of the PowerPoint deck. The inputs follow the Offer decks
// page (client, PV module and panels, inverter, price per kWp, generation, tariff) but there
// is one system with one inverter model, no sub-systems, pictures or schedule.
//
// "residential" store record:
//   client_id, client_name, wilaya, account_no, mobile
//   installation_type, elevation_m
//   module_id, modules            library module and number of panels
//   inverter_id, inverter_qty     library inverter and how many
//   price_per_kwp                 OMR per kWp, before VAT
//   annual_gen_kwh                year-1 generation; blank = DC kWp × specific_yield
//   specific_yield, degradation_pct, tariff_bz, tariff_note
//   contractor_id
//   layout_file_id                picture for the Design Summary box (files store)
//
// toProject() turns a record into the project shape docgen/context.js reads, so the document
// is filled by the same code as the Execution Agreement on the Documents page.
import { DCAC_MAX, DCAC_MIN, DEFAULT_INSTALLATION, SPECIFIC_YIELD, ratioBand, ratioOf, suggestInverters } from "../offer/quick.js";

export const TEMPLATE = "execution_agreement.docx";
export const DOC_KEY = "execution";

export const RESIDENTIAL_DEFAULTS = {
  client_id: null, client_name: "", wilaya: "", account_no: "", mobile: "",
  installation_type: DEFAULT_INSTALLATION, elevation_m: null,
  module_id: null, modules: null, inverter_id: null, inverter_qty: 1,
  price_per_kwp: null, annual_gen_kwh: null, specific_yield: SPECIFIC_YIELD,
  degradation_pct: null, tariff_bz: 32, tariff_note: "", contractor_id: null, layout_file_id: null,
};

// The template's wording when the tariff note is left blank (see docgen/context.js).
export const DEFAULT_TARIFF_NOTE = "targeting the consumption rate of the third slab";
export const DEFAULT_DEGRADATION = 0.65;
export const VAT_PCT = 5;

const isNum = (v) => typeof v === "number" && Number.isFinite(v) && v > 0;
const round3 = (v) => Math.round(v * 1000) / 1000;

/** Yearly degradation: the one typed, else the module datasheet's, else 0.65 %. */
export function degradationOf(o, module) {
  if (typeof o.degradation_pct === "number" && Number.isFinite(o.degradation_pct)) return { pct: o.degradation_pct, source: "typed" };
  if (module && Number.isFinite(module.degradation_annual_pct)) return { pct: module.degradation_annual_pct, source: "module" };
  return { pct: DEFAULT_DEGRADATION, source: "default" };
}

/**
 * Everything worked out from a record: { module, inverter, dc, ac, ratio, band, subtotal, vat, total,
 * kwh, kwhSource ("annual" | "yield" | null), degradation, cleanValue (OMR a year), payback (years) }.
 * `lookup` = { module, inverter } maps from data.loadAll().
 */
export function totals(o, lookup = {}) {
  const module = (o.module_id && lookup.module?.get(o.module_id)) || null;
  const inverter = (o.inverter_id && lookup.inverter?.get(o.inverter_id)) || null;
  const dc = module && isNum(o.modules) ? (module.wp * o.modules) / 1000 : null;
  const ac = inverter && isNum(o.inverter_qty) ? inverter.ac_kw * o.inverter_qty : null;
  const ratio = ratioOf(dc, ac);
  const subtotal = isNum(o.price_per_kwp) && isNum(dc) ? round3(o.price_per_kwp * dc) : null;
  const vat = subtotal !== null ? round3((subtotal * VAT_PCT) / 100) : null;
  const total = subtotal !== null ? round3(subtotal + vat) : null;
  let kwh = null, kwhSource = null;
  if (isNum(o.annual_gen_kwh)) { kwh = o.annual_gen_kwh; kwhSource = "annual"; }
  else if (isNum(dc)) { kwh = Math.round(dc * (isNum(o.specific_yield) ? o.specific_yield : SPECIFIC_YIELD)); kwhSource = "yield"; }
  const tariff = isNum(o.tariff_bz) ? o.tariff_bz : 32;
  const cleanValue = kwh ? (kwh * tariff) / 1000 : null;
  const payback = total && cleanValue ? total / cleanValue : null;
  return { module, inverter, dc, ac, ratio, band: ratioBand(ratio), subtotal, vat, total, kwh, kwhSource,
           degradation: degradationOf(o, module), tariff, cleanValue, payback };
}

/** Single-model inverter options for a DC capacity, DC/AC ratio within the limits; residential models first. */
export function suggestions(dc, inverters, limit = 4) {
  const residential = inverters.filter((i) => i.category === "residential");
  const pool = residential.length ? residential : inverters;
  return suggestInverters(dc, pool, { limit: 50 }).filter((s) => s.models === 1).slice(0, limit)
    .map((s) => ({ inverter_id: s.inverters[0].inverter_id, qty: s.inverters[0].qty, ac: s.ac, ratio: s.ratio, label: s.label }));
}

/** Panels needed for a DC capacity with a module of `wp` watts (rounded up). */
export const panelsFor = (kwp, wp) => (isNum(kwp) && isNum(wp) ? Math.ceil((kwp * 1000) / wp - 1e-9) : null);

/** The project-shaped record the Execution Agreement is filled from. `parties` = all.parties. */
export function toProject(o, lookup = {}, parties = []) {
  const t = totals(o, lookup);
  const contractor = parties.find((x) => x.id === Number(o.contractor_id)) || null;
  return {
    id: o.id || 0,
    name: o.client_name,
    client: { name: o.client_name, wilaya: o.wilaya, mobile: o.mobile },
    account_no: o.account_no,
    premises_type: "residential",
    installation_type: o.installation_type || "", elevation_m: isNum(o.elevation_m) ? o.elevation_m : null,
    module: t.module, module_count: isNum(o.modules) ? o.modules : null,
    inverter: t.inverter, inverter_qty: isNum(o.inverter_qty) ? o.inverter_qty : null,
    annual_gen_kwh: t.kwh,
    degradation_pct: t.degradation.pct,
    subtotal_omr: t.subtotal, vat_pct: VAT_PCT,
    tariff_bz: t.tariff, tariff_note: o.tariff_note ? o.tariff_note : undefined,
    contractor, consultant: null, layout_file_id: o.layout_file_id || null,
  };
}

/** Labels of what the offer still needs before the document is complete. */
export function missing(o, lookup = {}) {
  const t = totals(o, lookup);
  const out = [];
  if (!o.client_name) out.push("Client name");
  if (!o.account_no) out.push("Meter account number");
  if (!o.wilaya) out.push("Wilayat");
  if (!o.mobile) out.push("Contact number");
  if (!t.module) out.push("PV module");
  if (!isNum(o.modules)) out.push("Number of panels");
  if (!t.inverter) out.push("Inverter");
  if (!isNum(o.price_per_kwp)) out.push("Price per kWp");
  if (!o.contractor_id) out.push("Contractor");
  return out;
}

/** A sizing problem with the record, or null: the DC/AC ratio outside the limits. */
export function ratioIssue(o, lookup = {}) {
  const t = totals(o, lookup);
  return t.band === "bad" ? `DC/AC ratio ${t.ratio.toFixed(2)} is outside ${DCAC_MIN}–${DCAC_MAX}.` : null;
}

/** "Residential_Offer_Ahmed_Al_Balushi.docx" */
export function filename(o) {
  const safe = [...(o.client_name || "")].filter((ch) => /[\p{L}\p{N} _-]/u.test(ch)).join("").trim()
    .split(/\s+/).filter(Boolean).join("_").slice(0, 40) || "residential";
  return `Residential_Offer_${safe}.docx`;
}
