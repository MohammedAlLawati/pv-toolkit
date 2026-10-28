// Turn a project into the values, tick marks and images each document needs
// (ported from app/docgen/context.py).
//
// Functions take a "full" project: the project record plus its related records,
// as returned by loadFull() in projects.js:
//   { ...project, client, module, inverter, consultant, contractor }
import { moduleDims } from "../equipment_fields.js";

const isNum = (v) => typeof v === "number" && Number.isFinite(v);

function withThousands(s) {
  const [i, f] = s.split(".");
  const neg = i.startsWith("-");
  const body = (neg ? i.slice(1) : i).replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  return (neg ? "-" : "") + body + (f !== undefined ? "." + f : "");
}

export function fmtNum(v, dp = 2, thousands = false) {
  if (!isNum(v)) return "";
  let s = v.toFixed(dp);
  if (thousands) s = withThousands(s);
  if (dp && s.includes(".")) s = s.replace(/0+$/, "").replace(/\.$/, "");
  return s;
}

export const fmtOmr = (v) => (isNum(v) ? withThousands(v.toFixed(3)) : "");

const MONTHS = ["January", "February", "March", "April", "May", "June", "July",
                "August", "September", "October", "November", "December"];

/** "2026-03-05" or a Date -> "5 March 2026". */
export function fmtDate(d) {
  if (!d) return "";
  const dt = typeof d === "string" ? new Date(d + (d.length === 10 ? "T00:00:00" : "")) : d;
  if (Number.isNaN(dt.getTime())) return "";
  return `${dt.getDate()} ${MONTHS[dt.getMonth()]} ${dt.getFullYear()}`;
}

export function initials(name) {
  return (name || "").split(/\s+/).filter((w) => /^\p{L}/u.test(w)).map((w) => w[0]).join("").toUpperCase().slice(0, 5);
}

// ---- derived values --------------------------------------------------------------------

// A quick offer (no module count / inverter quantity) states its capacities as dc_kwp / ac_kw.
export const dcKwp = (p) => (isNum(p.dc_kwp) ? p.dc_kwp : p.module && p.module_count ? (p.module.wp * p.module_count) / 1000 : null);
export const acKw = (p) => (isNum(p.ac_kw) ? p.ac_kw : p.inverter && p.inverter_qty ? p.inverter.ac_kw * p.inverter_qty : null);
export function dcAcRatio(p) {
  const dc = dcKwp(p), ac = acKw(p);
  return dc && ac ? dc / ac : null;
}
/** NAMA uses the AC capacity for the 11 kW threshold. */
export const above11kw = (p) => (acKw(p) || 0) > 11;

const s = (v) => (v === null || v === undefined ? "" : String(v));

export function buildValues(p, today = new Date()) {
  const c = p.client || {}, m = p.module, inv = p.inverter;
  const cons = p.consultant, ctr = p.contractor;
  const gen = isNum(p.annual_gen_kwh) ? p.annual_gen_kwh : null;
  const subtotal = isNum(p.subtotal_omr) ? p.subtotal_omr : null;
  const vatPct = isNum(p.vat_pct) ? p.vat_pct : 5;
  const tariff = isNum(p.tariff_bz) ? p.tariff_bz : 32;
  const vat = subtotal !== null ? (subtotal * vatPct) / 100 : null;
  const final = subtotal !== null ? subtotal + vat : null;
  const cleanValue = gen ? (gen * tariff) / 1000 : null; // OMR per year
  const payback = final && cleanValue ? final / cleanValue : null;
  let install = p.installation_type || "";
  if (p.elevation_m) install = `${install} (${fmtNum(p.elevation_m, 1)}m high)`.trim();
  const dc = dcKwp(p), ac = acKw(p);

  const v = {
    // client
    Name: c.name, FirstName: c.name, IDNo: c.id_no, Contact: c.mobile,
    Tel: c.tel, Email: c.email, Governorate: c.governorate,
    Wilaya: c.wilaya, Wilayat: c.wilaya, Village: c.village,
    Abbreviation: p.reference_code || initials(c.name),
    // site / account
    AccountNo: p.account_no, MeterNo: p.account_no,
    ProjectArea: fmtNum(p.project_area_m2, 1, true),
    InstallationType: install, Elevation: fmtNum(p.elevation_m, 1),
    // modules
    ModuleMake: m ? m.make : "", ModuleModel: m ? m.model : "",
    PanelType: m ? m.technology : "", PanelCap: m ? fmtNum(m.wp, 1) : "",
    ModuleDims: m ? moduleDims(m) : "",
    ModuleDescription: m ? `${m.make} ${m.technology || ""}`.trim() : "",
    PanelNo: s(p.module_count || ""), NoofPVModules: s(p.module_count || ""),
    Strings: s(p.strings || ""),
    Tilt: fmtNum(p.tilt_deg, 1), Azimuth: fmtNum(p.azimuth_deg, 1),
    // inverters
    InverterMake: inv ? inv.make : "", InverterModel: inv ? inv.model : "",
    InverterDescription: inv ? `${inv.make} ${inv.model}` : "",
    InverterQty: s(p.inverter_qty || ""),
    InverterUnitKW: inv ? fmtNum(inv.ac_kw, 2) : "",
    // capacities
    Capacity: fmtNum(dc, 2), DCCapacity: fmtNum(dc, 2),
    InverterCap: fmtNum(ac, 2), ACCapacity: fmtNum(ac, 2),
    DCACRatio: fmtNum(dcAcRatio(p), 2),
    // energy
    AnnualGen: gen ? fmtNum(gen / 1000, 2) : "",      // MWh
    YearlyGen: gen ? fmtNum(gen / 1000, 2) : "",      // MWh
    AnnualGenKWh: gen ? fmtNum(gen, 0, true) : "",    // kWh
    Degradation: fmtNum(isNum(p.degradation_pct) ? p.degradation_pct : 0.65, 2),
    // commercial
    Subtotal: fmtOmr(subtotal), VAT: fmtOmr(vat), FinalPrice: fmtOmr(final),
    TariffBz: fmtNum(tariff, 1),
    TariffNote: p.tariff_note ?? "targeting the consumption rate of the third slab",
    CleanEnergyProduction: fmtOmr(cleanValue),
    PaybackPeriod: payback ? fmtNum(payback, 1) : "",
    // dates
    ENdate: fmtDate(p.agency_date || today), Today: fmtDate(today),
    // parties
    ConsultantName: cons ? cons.name : "", ConsultantTel: cons ? cons.phone : "",
    ConsultantEngineer: cons ? cons.engineer : "",
    ContractorName: ctr ? ctr.name : "", ContractorTel: ctr ? ctr.phone : "",
    ContractorEngineer: ctr ? ctr.engineer : "",
    ContractorEmail: ctr ? ctr.email : "", ContractorAddress: ctr ? ctr.address : "",
  };
  return Object.fromEntries(Object.entries(v).map(([k, val]) => [k, s(val)]));
}

export function buildFlags(p) {
  const phases = Number(p.phases || 3);
  return {
    [`prem_${p.premises_type || "residential"}`]: true,
    [`conn_${p.connection_type || "self"}`]: true,
    [`mount_${p.mounting || "rooftop"}`]: true,
    phase3: phases === 3, phase1: phases === 1,
    trafo_yes: !!p.internal_transformer, trafo_no: !p.internal_transformer,
  };
}

// ---- which documents exist and what they need -------------------------------------------

const CLIENT = [["client_name", "Client name"], ["account_no", "Account number"]];
const SYSTEM = [["module", "PV module"], ["module_count", "Number of modules"],
                ["inverter", "Inverter"], ["inverter_qty", "Inverter quantity"],
                ["annual_gen_kwh", "Annual generation"]];

export const DOCS = {
  initial: { key: "initial", title: "NAMA – Initial Service Application", template: "nama_initial_form.docx",
             required: [...CLIENT, ["id_no", "Client ID / C.R."], ["mobile", "Client mobile"],
                        ["wilaya", "Wilayat"], ["project_area_m2", "Project area"],
                        ["consultant", "Consultant"], ["contractor", "Contractor"], ...SYSTEM] },
  agency: { key: "agency", title: "NAMA – Agency Contract", template: "nama_agency_contract.docx",
            required: [...CLIENT, ["id_no", "Client ID / C.R."], ["wilaya", "Wilayat"],
                       ["module", "PV module"], ["module_count", "Number of modules"]] },
  design: { key: "design", title: "NAMA – Design Approval Application", template: "",
            required: [...CLIENT, ...SYSTEM, ["strings", "Number of strings"],
                       ["tilt_deg", "Tilt"], ["azimuth_deg", "Azimuth"]] },
  execution: { key: "execution", title: "Execution Agreement (residential)", template: "execution_agreement.docx",
               required: [...CLIENT, ...SYSTEM, ["mobile", "Client mobile"], ["wilaya", "Wilayat"],
                          ["subtotal_omr", "Price (subtotal)"], ["contractor", "Contractor"]] },
};

export function templateFor(docKey, p) {
  if (docKey === "design") return above11kw(p) ? "nama_design_above_11kw.docx" : "nama_design_below_11kw.docx";
  return DOCS[docKey].template;
}

export function missingFields(docKey, p) {
  const c = p.client || {};
  const lookup = { client_name: c.name, id_no: c.id_no, mobile: c.mobile, wilaya: c.wilaya };
  const out = [];
  for (const [attr, label] of DOCS[docKey].required) {
    const val = attr in lookup ? lookup[attr] : p[attr];
    if (val === null || val === undefined || val === "" || val === 0) out.push(label);
  }
  return out;
}

export function docFilename(docKey, p, ext = "docx") {
  let safe = [...((p.client && p.client.name) || "")].filter((ch) => /[\p{L}\p{N} _-]/u.test(ch)).join("").trim();
  safe = safe.split(/\s+/).filter(Boolean).join("_").slice(0, 40) || `project${p.id}`;
  const names = { initial: "NAMA_Initial_Form", agency: "NAMA_Agency_Contract",
                  design: "NAMA_Design_Approval_" + (above11kw(p) ? "Above" : "Below") + "_11kW",
                  execution: "Execution_Agreement" };
  return `${names[docKey]}_${safe}.${ext}`;
}
