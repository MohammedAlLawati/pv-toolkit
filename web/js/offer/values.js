// The numbers and words an offer deck needs, worked out from a full project
// (see data.full). Extends the document values in docgen/context.js.
import { acKw, buildValues, dcAcRatio, dcKwp, fmtNum, fmtOmr } from "../docgen/context.js";
import { fmtG, moduleDims } from "../equipment_fields.js";

export const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

// Monthly shares of a typical year in Oman, from the PVsyst figures in the EPC template
// (482.8 ... 448.3 MWh of 7,145.7 MWh). Used when a project has only an annual figure.
const PROFILE = [482.8, 500.1, 604.7, 662.3, 714.4, 687.8, 684.1, 661.3, 624.3, 587.7, 487.9, 448.3];
const PROFILE_SUM = PROFILE.reduce((a, b) => a + b, 0);

// Greenhouse-gas equivalents per kWh, from HTC's "EPA Calc" spreadsheet (factors taken from
// the US EPA greenhouse gas equivalencies calculator; homes are divided by 3 for Omani houses).
// The spreadsheet estimates energy as kWp × 1,650; here they apply to the project's own
// annual generation.
const PER_KWH = { co2_t: 0.0006989231479, homes: 0.00009111855886 / 3, gallons: 0.0786072582,
                  cars: 0.0001662887377, seedlings: 0.01155186461 };

const isNum = (v) => typeof v === "number" && Number.isFinite(v);

/** "12, 13.5\n14" -> [12, 13.5, 14]; anything that isn't 12 numbers -> null. */
export function parseMonthly(text) {
  const vals = String(text ?? "").split(/[\s;|\t]+|,(?=\s|$)/).map((s) => s.replace(/,/g, "")).filter(Boolean).map(Number);
  return vals.length === 12 && vals.every((v) => Number.isFinite(v) && v >= 0) ? vals : null;
}

/** 12 monthly kWh figures: the project's own, else the annual figure spread by PROFILE. */
export function monthlyKwh(p) {
  if (Array.isArray(p.monthly_kwh) && p.monthly_kwh.length === 12) return { values: p.monthly_kwh, estimated: false };
  if (isNum(p.annual_gen_kwh) && p.annual_gen_kwh > 0) {
    return { values: PROFILE.map((m) => (p.annual_gen_kwh * m) / PROFILE_SUM), estimated: true };
  }
  return { values: null, estimated: false };
}

export function compass(az) {
  if (!isNum(az)) return "";
  const names = ["North", "North-east", "East", "South-east", "South", "South-west", "West", "North-west"];
  return names[Math.round((((az % 360) + 360) % 360) / 45) % 8];
}

/**
 * Year-by-year energy (kWh), savings and cumulative cash flow (OMR) over 25 years.
 * ROI = average yearly savings ÷ price (simple return, no discounting). Provisional:
 * agreed to keep for now and check against HTC's own offers at QC.
 */
export function cashFlow(p, annualKwh) {
  const d = (isNum(p.degradation_pct) ? p.degradation_pct : 0.65) / 100;
  const tariff = (isNum(p.tariff_bz) ? p.tariff_bz : 32) / 1000; // OMR per kWh
  const cost = isNum(p.subtotal_omr) ? p.subtotal_omr : null;
  const years = [];
  let cum = cost !== null ? -cost : 0;
  for (let n = 1; n <= 25; n++) {
    const kwh = annualKwh * (1 - d) ** (n - 1);
    const savings = kwh * tariff;
    cum += savings;
    years.push({ n, kwh, loss: 1 - (1 - d) ** (n - 1), savings, cumulative: cum });
  }
  let payback = null;
  if (cost) {
    let acc = 0;
    for (const y of years) {
      if (acc + y.savings >= cost) { payback = y.n - 1 + (cost - acc) / y.savings; break; }
      acc += y.savings;
    }
  }
  const avg = years.reduce((t, y) => t + y.savings, 0) / 25;
  return { years, payback, roi: cost ? (avg / cost) * 100 : null };
}

function paybackText(years) {
  if (years === null) return "more than 25 years";
  let y = Math.floor(years), m = Math.round((years - y) * 12);
  if (m === 12) { y += 1; m = 0; }
  const ys = `${y} year${y === 1 ? "" : "s"}`;
  return m ? `${ys} and ${m} month${m === 1 ? "" : "s"}` : ys;
}

const n0 = (v) => fmtNum(v, 0, true);
/** 7145.7 -> "7,145.70" */
const fixed2 = (v) => v.toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ",");
const s = (v) => (v === null || v === undefined || v === "" ? "—" : String(v));

export function buildOfferValues(p, today = new Date()) {
  const v = buildValues(p, today);
  const m = p.module || {}, inv = p.inverter || {};
  const { values: months, estimated } = monthlyKwh(p);
  const annual = months ? months.reduce((a, b) => a + b, 0) : null;
  const dc = dcKwp(p), ac = acKw(p), ratio = dcAcRatio(p);

  Object.assign(v, {
    DCACRatioPct: ratio ? fmtNum(ratio * 100, 0) : "",
    Orientation: isNum(p.azimuth_deg) ? `${fmtG(p.azimuth_deg)}° (${compass(p.azimuth_deg)})` : "",
    Tilt: isNum(p.tilt_deg) ? fmtG(p.tilt_deg) : "",
    OmrPerKwp: isNum(p.subtotal_omr) && dc ? fmtOmr(p.subtotal_omr / dc) : "",
    Degradation: fmtNum(isNum(p.degradation_pct) ? p.degradation_pct : 0.65, 2),
    TariffBz: fmtNum(isNum(p.tariff_bz) ? p.tariff_bz : 32, 1),
  });
  if (annual) v.AnnualGenKWh = n0(annual);
  months?.forEach((k, i) => { v[`M${i + 1}`] = n0(k); });
  v.MTotal = annual ? n0(annual) : "";

  const flow = annual ? cashFlow(p, annual) : null;
  for (let n = 1; n <= 25; n++) {
    const y = flow?.years[n - 1];
    v[`Y${n}E`] = y ? fixed2(y.kwh / 1000) : "";
    v[`Y${n}L`] = y ? `${(y.loss * 100).toFixed(1)}%` : "";
  }
  v.AnnualSavings = flow ? fmtOmr(flow.years[0].savings) : "";
  v.PaybackText = flow && isNum(p.subtotal_omr) ? paybackText(flow.payback) : "";
  v.ROI = flow?.roi ? flow.roi.toFixed(1) : "";

  const eq = (k, dp = 0) => (annual ? fmtNum(annual * PER_KWH[k], dp, true) : "");
  Object.assign(v, { CO2Tonnes: eq("co2_t"), Homes: eq("homes"), GasGallons: eq("gallons"),
                     Cars: eq("cars"), Seedlings: eq("seedlings") });

  // spec slides
  const range = (a, b) => (isNum(a) && isNum(b) ? `${fmtG(a)}–${fmtG(b)}` : "");
  Object.assign(v, {
    ModuleDims: moduleDims(m) || "—",
    S_cells: s(m.cells), S_eff: s(fmtG(m.efficiency_pct)), S_voc: s(fmtG(m.voc)), S_isc: s(fmtG(m.isc)),
    S_vmp: s(fmtG(m.vmp)), S_imp: s(fmtG(m.imp)), S_tcp: s(fmtG(m.tc_pmax_pct)), S_tcv: s(fmtG(m.tc_voc_pct)),
    S_bif: isNum(m.bifaciality) ? `${fmtG(m.bifaciality * 100)} %` : "—", S_msv: s(fmtG(m.max_system_v)),
    S_wt: s(fmtG(m.weight_kg)),
    S_kva: s(fmtG(inv.max_ac_kva)), S_grid: s(inv.ac_voltage || (inv.phases ? `${inv.phases}-phase` : "")),
    S_maxv: s(fmtG(inv.max_dc_v)), S_mppt: s(range(inv.mppt_min_v, inv.mppt_max_v)), S_nmppt: s(inv.num_mppt),
    S_spm: s(inv.mppt_strings || inv.strings_per_mppt), S_ipm: s(inv.mppt_currents || fmtG(inv.max_current_per_mppt)),
    S_iscpm: s(inv.mppt_iscs || fmtG(inv.max_isc_per_mppt)), S_effi: s(fmtG(inv.max_eff_pct)),
    S_topo: s(inv.topology), S_ip: s(inv.ip_rating), S_dims: s(inv.dimensions), S_wti: s(fmtG(inv.weight_kg)),
  });
  return { values: v, months, estimated, flow, annual, dc, ac };
}

/** Labels of the fields an offer deck still needs; [] when it can be made in full. */
export function offerMissing(p) {
  return [[p.client, "Client"], [p.module, "PV module"], [p.module_count, "Number of modules"],
    [p.inverter, "Inverter"], [p.annual_gen_kwh || p.monthly_kwh, "Annual generation"], [p.subtotal_omr, "Price (subtotal)"]]
    .filter(([v]) => v === null || v === undefined || v === "" || v === 0).map(([, label]) => label);
}
