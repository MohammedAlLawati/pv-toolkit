// Standalone NAMA forms: which inputs each form asks for, and how they become a document.
//
// A saved form is { id, type, values, created_at, updated_at }. `values` holds the inputs
// below by key; toProject() turns them into the project shape docgen/context.js reads, so
// the forms are filled by exactly the same code as the project documents.
import { CONNECTION_TYPES, MOUNTING_TYPES, PREMISES_TYPES } from "../lists.js";
import { above11kw } from "../docgen/context.js";

export const FORM_TYPES = {
  initial: { title: "NAMA – Solar PV Initial Form", short: "Initial Form" },
  agency: { title: "NAMA – Solar PV Agency Contract", short: "Agency Contract" },
  design: { title: "NAMA – Solar PV New Connection", short: "New Connection",
            note: "The above or below 11 kW form is picked from the AC capacity." },
  execution: { title: "Execution Agreement (residential)", short: "Execution Agreement" },
};

export const formTitle = (type, values = {}) => {
  if (type !== "design") return FORM_TYPES[type]?.title || type;
  const ac = acOf(values);
  return FORM_TYPES.design.title + (ac === null ? "" : ac > 11 ? " (above 11 kW)" : " (11 kW and below)");
};

const opts = (entries) => entries.map(([v, label]) => ({ v, label }));
const PREMISES = opts(PREMISES_TYPES.map((p) => [p, p[0].toUpperCase() + p.slice(1)]));

// Every input a form can ask for. `feeds` lists the {{Placeholders}}, `if:` flags and `img:`
// slots it fills; a form shows the inputs that feed something in its template.
// kind: text (default) | number | select | date | party | image | check
export const FIELDS = [
  // owner
  { key: "client_name", label: "Owner / client name", group: "Owner", wide: true, feeds: ["Name", "FirstName"] },
  { key: "id_no", label: "ID / C.R. number", group: "Owner", feeds: ["IDNo"] },
  { key: "mobile", label: "Mobile", group: "Owner", feeds: ["Contact"] },
  { key: "tel", label: "Telephone", group: "Owner", feeds: ["Tel"] },
  { key: "email", label: "Email", group: "Owner", feeds: ["Email"] },
  { key: "governorate", label: "Governorate", group: "Owner", feeds: ["Governorate"] },
  { key: "wilaya", label: "Wilayat", group: "Owner", feeds: ["Wilaya", "Wilayat"] },
  { key: "village", label: "Village", group: "Owner", feeds: ["Village"] },
  { key: "reference_code", label: "Reference code", group: "Owner", feeds: ["Abbreviation"],
    hint: "Printed in the footer. Blank = the client's initials" },
  // site
  { key: "account_no", label: "Electricity account number", group: "Site", feeds: ["AccountNo", "MeterNo"] },
  { key: "premises_type", label: "Premises type", group: "Site", kind: "select", options: PREMISES,
    feeds: PREMISES_TYPES.map((p) => `if:prem_${p}`) },
  { key: "connection_type", label: "Connection type", group: "Site", kind: "select",
    options: opts(Object.entries(CONNECTION_TYPES)), feeds: Object.keys(CONNECTION_TYPES).map((c) => `if:conn_${c}`) },
  { key: "mounting", label: "Mounting system", group: "Site", kind: "select",
    options: opts(Object.entries(MOUNTING_TYPES)), feeds: Object.keys(MOUNTING_TYPES).map((m) => `if:mount_${m}`) },
  { key: "project_area_m2", label: "Proposed area (m²)", group: "Site", kind: "number", feeds: ["ProjectArea"] },
  { key: "installation_type", label: "Installation type", group: "Site", feeds: ["InstallationType"],
    hint: "e.g. Elevated Flat Roof" },
  { key: "elevation_m", label: "Elevation (m)", group: "Site", kind: "number", feeds: ["InstallationType", "Elevation"] },
  { key: "agency_date", label: "Contract date", group: "Site", kind: "date", feeds: ["ENdate"], hint: "Blank = today" },
  // modules
  { key: "module_make", label: "Module manufacturer", group: "PV modules", feeds: ["ModuleMake", "ModuleDescription"] },
  { key: "module_model", label: "Module model", group: "PV modules", feeds: ["ModuleModel"] },
  { key: "module_technology", label: "Module type", group: "PV modules", feeds: ["PanelType", "ModuleDescription"],
    hint: "e.g. N-type TOPCon bifacial" },
  { key: "module_wp", label: "Module power (Wp)", group: "PV modules", kind: "number", feeds: ["PanelCap", "Capacity", "DCCapacity"] },
  { key: "module_dims", label: "Module size (L × W × T mm)", group: "PV modules", feeds: ["ModuleDims"], hint: "e.g. 2384 × 1303 × 33" },
  { key: "module_count", label: "Number of modules", group: "PV modules", kind: "number", feeds: ["PanelNo", "NoofPVModules", "Capacity", "DCCapacity", "DCACRatio"] },
  { key: "strings", label: "Number of strings", group: "PV modules", kind: "number", feeds: ["Strings"] },
  { key: "tilt_deg", label: "Tilt (°)", group: "PV modules", kind: "number", feeds: ["Tilt"] },
  { key: "azimuth_deg", label: "Azimuth (°)", group: "PV modules", kind: "number", feeds: ["Azimuth"] },
  // inverters
  { key: "inverter_make", label: "Inverter manufacturer", group: "Inverters", feeds: ["InverterMake", "InverterDescription"] },
  { key: "inverter_model", label: "Inverter model", group: "Inverters", feeds: ["InverterModel", "InverterDescription"] },
  { key: "inverter_kw", label: "Inverter power (kW AC each)", group: "Inverters", kind: "number", feeds: ["InverterUnitKW", "InverterCap", "ACCapacity"] },
  { key: "inverter_qty", label: "Number of inverters", group: "Inverters", kind: "number", feeds: ["InverterQty", "InverterCap", "ACCapacity", "DCACRatio"] },
  { key: "phases", label: "Phases", group: "Inverters", kind: "select", options: opts([["3", "3-phase"], ["1", "Single phase"]]),
    feeds: ["if:phase1", "if:phase3"] },
  { key: "internal_transformer", label: "Internal transformer", group: "Inverters", kind: "check", feeds: ["if:trafo_yes", "if:trafo_no"] },
  // energy and price
  { key: "annual_gen_kwh", label: "Annual generation (kWh)", group: "Energy & price", kind: "number", feeds: ["AnnualGen", "YearlyGen", "AnnualGenKWh"] },
  { key: "degradation_pct", label: "Yearly degradation (%)", group: "Energy & price", kind: "number", feeds: ["Degradation"], hint: "Blank = 0.65" },
  { key: "subtotal_omr", label: "Price before VAT (OMR)", group: "Energy & price", kind: "number", feeds: ["Subtotal", "VAT", "FinalPrice", "PaybackPeriod"] },
  { key: "tariff_bz", label: "Tariff (bz/kWh)", group: "Energy & price", kind: "number", feeds: ["TariffBz", "CleanEnergyProduction"], hint: "Blank = 32" },
  { key: "tariff_note", label: "Tariff note", group: "Energy & price", wide: true, feeds: ["TariffNote"] },
  // parties and pictures
  { key: "consultant_id", label: "Consultant", group: "Consultant & contractor", kind: "party", party: "consultant",
    feeds: ["ConsultantName", "ConsultantTel", "ConsultantEngineer", "img:consultant_stamp"] },
  { key: "contractor_id", label: "Contractor", group: "Consultant & contractor", kind: "party", party: "contractor",
    feeds: ["ContractorName", "ContractorTel", "ContractorEngineer", "ContractorEmail", "ContractorAddress", "img:contractor_stamp"] },
  { key: "layout_file_id", label: "Layout image", group: "Consultant & contractor", kind: "image", feeds: ["img:layout"],
    hint: "Goes in the Design Summary box" },
];

export const DEFAULTS = { premises_type: "residential", connection_type: "self", mounting: "rooftop", phases: "3" };

/** Every {{Placeholder}}, if:flag and img:slot used by a .docx template. */
export async function templateKeys(bytes) {
  const zip = await globalThis.JSZip.loadAsync(bytes);
  const keys = new Set();
  for (const name of Object.keys(zip.files)) {
    if (!/^word\/(document|header\d*|footer\d*)\.xml$/.test(name)) continue;
    const xml = await zip.file(name).async("string");
    for (const m of xml.matchAll(/descr="((?:if|img):[A-Za-z0-9_]+)"/g)) keys.add(m[1]);
    // Paragraph by paragraph, tags stripped, so placeholders Word split across runs are found.
    for (const p of xml.split("</w:p>")) {
      for (const m of p.replace(/<[^>]+>/g, "").matchAll(/\{\{\s*([A-Za-z0-9_]+)\s*\}\}/g)) keys.add(m[1]);
    }
  }
  return keys;
}

/** The inputs a template needs, in catalogue order. */
export const fieldsFor = (keys) => FIELDS.filter((f) => f.feeds.some((k) => keys.has(k)));

const numOrNull = (v) => (v === "" || v === null || v === undefined || Number.isNaN(Number(v)) ? null : Number(v));

function acOf(v) {
  const kw = numOrNull(v.inverter_kw), qty = numOrNull(v.inverter_qty);
  return kw !== null && qty !== null ? kw * qty : null;
}

/** "2384 × 1303 × 33" -> { length_mm, width_mm, thickness_mm }. */
function parseDims(s) {
  const n = String(s || "").match(/[\d.]+/g) || [];
  return { length_mm: numOrNull(n[0]), width_mm: numOrNull(n[1]), thickness_mm: numOrNull(n[2]) };
}

/** A form's inputs -> the "full project" shape that docgen/context.js and generate.js read. */
export function toProject(values, parties = []) {
  const v = values || {};
  const party = (id) => parties.find((x) => x.id === Number(id)) || null;
  const hasModule = v.module_make || v.module_model || v.module_technology || v.module_wp || v.module_dims;
  const hasInverter = v.inverter_make || v.inverter_model || v.inverter_kw;
  return {
    id: 0,
    client: { name: v.client_name, id_no: v.id_no, mobile: v.mobile, tel: v.tel, email: v.email,
              governorate: v.governorate, wilaya: v.wilaya, village: v.village },
    reference_code: v.reference_code || null,
    account_no: v.account_no, premises_type: v.premises_type || DEFAULTS.premises_type,
    connection_type: v.connection_type || DEFAULTS.connection_type, mounting: v.mounting || DEFAULTS.mounting,
    project_area_m2: numOrNull(v.project_area_m2), installation_type: v.installation_type || "",
    elevation_m: numOrNull(v.elevation_m), agency_date: v.agency_date || null,
    module: hasModule ? { make: v.module_make || "", model: v.module_model || "", technology: v.module_technology || "",
                          wp: numOrNull(v.module_wp) || 0, ...parseDims(v.module_dims) } : null,
    module_count: numOrNull(v.module_count), strings: numOrNull(v.strings),
    tilt_deg: numOrNull(v.tilt_deg), azimuth_deg: numOrNull(v.azimuth_deg),
    inverter: hasInverter ? { make: v.inverter_make || "", model: v.inverter_model || "", ac_kw: numOrNull(v.inverter_kw) || 0 } : null,
    inverter_qty: numOrNull(v.inverter_qty),
    phases: Number(v.phases || DEFAULTS.phases), internal_transformer: !!v.internal_transformer,
    annual_gen_kwh: numOrNull(v.annual_gen_kwh), degradation_pct: numOrNull(v.degradation_pct),
    subtotal_omr: numOrNull(v.subtotal_omr), tariff_bz: numOrNull(v.tariff_bz),
    tariff_note: v.tariff_note || undefined,
    consultant: party(v.consultant_id), contractor: party(v.contractor_id),
    layout_file_id: v.layout_file_id || null,
  };
}

/** Which New Connection template this form uses. */
export const designAbove = (values) => above11kw(toProject(values));

// ---- prefill ------------------------------------------------------------------------------

/** Inputs taken from a client record. */
export const fromClient = (c) => (c ? Object.fromEntries(Object.entries({
  client_name: c.name, id_no: c.id_no, mobile: c.mobile, tel: c.tel, email: c.email,
  governorate: c.governorate, wilaya: c.wilaya, village: c.village,
  account_no: Array.isArray(c.meter_numbers) ? c.meter_numbers[0] : undefined,
  premises_type: c.client_type === "residential" || c.client_type === "commercial" ? c.client_type : undefined,
}).filter(([, x]) => x !== undefined && x !== null && x !== "")) : {});

/** Inputs taken from library equipment. */
export const fromModule = (m) => (m ? {
  module_make: m.make, module_model: m.model, module_technology: m.technology, module_wp: m.wp,
  module_dims: [m.length_mm, m.width_mm, m.thickness_mm].filter((x) => x).join(" × "),
} : {});
export const fromInverter = (i) => (i ? {
  inverter_make: i.make, inverter_model: i.model, inverter_kw: i.ac_kw,
  phases: i.phases ? String(i.phases) : undefined, internal_transformer: !!i.internal_transformer,
} : {});

/** Inputs taken from a project (with its client and equipment). */
export function fromProject(p, all) {
  if (!p) return {};
  const out = {
    ...fromClient(all.client.get(p.client_id)),
    ...fromModule(all.modules.find((m) => m.id === p.module_id)),
    ...fromInverter(all.inverters.find((i) => i.id === p.inverter_id)),
  };
  for (const k of ["account_no", "premises_type", "connection_type", "mounting", "project_area_m2", "installation_type",
    "elevation_m", "agency_date", "module_count", "strings", "tilt_deg", "azimuth_deg", "inverter_qty",
    "annual_gen_kwh", "degradation_pct", "subtotal_omr", "tariff_bz", "tariff_note", "reference_code",
    "consultant_id", "contractor_id"]) {
    if (p[k] !== null && p[k] !== undefined && p[k] !== "") out[k] = p[k];
  }
  // the client's type decides the premises (the design record no longer asks for it)
  const premises = fromClient(all.client.get(p.client_id)).premises_type;
  if (premises) out.premises_type = premises;
  if (p.phases) out.phases = String(p.phases);
  if (p.internal_transformer !== undefined) out.internal_transformer = !!p.internal_transformer;
  return Object.fromEntries(Object.entries(out).filter(([, x]) => x !== undefined && x !== null));
}
