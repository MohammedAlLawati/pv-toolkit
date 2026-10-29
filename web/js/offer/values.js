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

/** Shading losses above this (in %) are flagged on the page and on the shadow slide. */
export const SHADING_LIMIT_PCT = 3;

const SHADE_OK = [
  "As demonstrated in the simulation results, all solar panels experience minimal to no shading losses during peak sun hours, ensuring optimal energy generation.",
  "This is visually confirmed in the bottom-left section of the report, where all panels are highlighted in green, indicating unobstructed sunlight exposure.",
  "The uniform shading analysis further validates the effectiveness of the design in maximizing solar potential while mitigating performance losses.",
];

/** The shadow slide's three paragraphs, for a shading loss in % (null when unknown). */
export function shadingText(lossPct) {
  if (!isNum(lossPct) || lossPct <= SHADING_LIMIT_PCT) return SHADE_OK;
  const pct = fmtNum(lossPct, 1);
  return [
    `The simulation results show shading losses of ${pct}%, which is higher than the ${SHADING_LIMIT_PCT}% design limit.`,
    "The heatmap shows where the affected panels are: colours away from green indicate reduced solar access.",
    "The energy figures in this offer already include these shading losses.",
  ];
}

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
 * Yearly degradation: the module datasheet's linear power warranty (first year, then each year
 * after) when the library has it, else one yearly figure (the project's, or 0.65%).
 */
export function degradation(p) {
  const m = p.module || {};
  if (isNum(m.degradation_first_pct) && isNum(m.degradation_annual_pct)) {
    return { first: m.degradation_first_pct, annual: m.degradation_annual_pct, source: "datasheet" };
  }
  const d = isNum(p.degradation_pct) ? p.degradation_pct : 0.65;
  return { first: d, annual: d, source: "default" };
}

/** Energy lost by year n (1 = the simulated year, no loss), as a fraction. */
function lossIn(n, deg) {
  if (n <= 1) return 0;
  if (deg.source === "datasheet") return (deg.first + (n - 2) * deg.annual) / 100;
  return 1 - (1 - deg.annual / 100) ** (n - 1);
}

/**
 * Year-by-year energy (kWh), savings and cumulative cash flow (OMR) over 25 years.
 * ROI = average yearly savings ÷ price (simple return, no discounting). Provisional:
 * agreed to keep for now and check against HTC's own offers at QC.
 */
export function cashFlow(p, annualKwh) {
  const deg = degradation(p);
  const tariff = (isNum(p.tariff_bz) ? p.tariff_bz : 32) / 1000; // OMR per kWh
  const cost = isNum(p.subtotal_omr) ? p.subtotal_omr : null;
  const years = [];
  let cum = cost !== null ? -cost : 0;
  for (let n = 1; n <= 25; n++) {
    const loss = lossIn(n, deg);
    const kwh = annualKwh * (1 - loss);
    const savings = kwh * tariff;
    cum += savings;
    years.push({ n, kwh, loss, savings, cumulative: cum });
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
  return { years, payback, roi: cost ? (avg / cost) * 100 : null, degradation: deg };
}

/** "1% in the first year and 0.40" (the slide adds "% yearly ..."), or "0.65". */
export function degradationText(deg) {
  return deg.source === "datasheet" && deg.first !== deg.annual
    ? `${fmtG(deg.first)}% in the first year and ${fmtNum(deg.annual, 2)}`
    : fmtNum(deg.annual, 2);
}

/** "Carpark, 3 m high, 5° tilt, 109° (East)": a sub-system's mounting. */
export function mountingText(r) {
  return [r.installation_type, isNum(r.elevation_m) && r.elevation_m > 0 ? `${fmtG(r.elevation_m)} m high` : "",
    isNum(r.tilt_deg) ? `${fmtG(r.tilt_deg)}° tilt` : "", isNum(r.azimuth_deg) ? `${fmtG(r.azimuth_deg)}° (${compass(r.azimuth_deg)})` : ""]
    .filter(Boolean).join(", ");
}

/**
 * Sub-systems (POCs, roofs, orientations) as table rows, with their totals. p.subsystems holds the
 * rows of quick.systemTotals: [{ name, desc, module, modules, dc, invs: [{ inverter, qty }], ac }].
 */
export function subsystemTable(p) {
  const list = Array.isArray(p.subsystems) ? p.subsystems : [];
  const rows = list.map((r) => ({
    name: r.name || "", desc: r.desc || "", module: r.module?.model || "", mounting: mountingText(r),
    modules: isNum(r.modules) && r.module ? r.modules : null, dc: isNum(r.dc) ? r.dc : null, ac: isNum(r.ac) ? r.ac : null,
    inverters: (r.invs || []).map((x) => `${x.qty} × ${x.inverter.model}`).join(" + "),
    count: (r.invs || []).reduce((t, x) => t + x.qty, 0),
  })).map((r) => ({ ...r, ratio: r.dc && r.ac ? r.dc / r.ac : null }));
  const sum = (k) => rows.reduce((t, r) => t + (r[k] || 0), 0);
  const dc = sum("dc"), ac = sum("ac");
  const totals = { modules: sum("modules"), inverters: sum("count"), dc, ac, ratio: dc && ac ? dc / ac : null };
  return { rows, totals };
}

/** Most component pictures the deck has room for (the components slide's columns). */
export const MAX_COMPONENTS = 4;

/**
 * The module and inverter models in the design, modules first, each with how many are used:
 * [{ kind: "module" | "inverter", item, count }]. Quick offers list them (p.components); a
 * project has one of each.
 */
export function componentsOf(p) {
  const list = Array.isArray(p.components) ? p.components
    : [p.module && { kind: "module", item: p.module, count: p.module_count }, p.inverter && { kind: "inverter", item: p.inverter, count: p.inverter_qty }];
  return list.filter((c) => c && c.item).slice(0, MAX_COMPONENTS);
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

  shadingText(p.shading_loss_pct).forEach((t, i) => { v[`ShadeP${i + 1}`] = t; });
  Object.assign(v, {
    DCACRatioPct: ratio ? fmtNum(ratio * 100, 0) : "",
    Orientation: isNum(p.azimuth_deg) ? `${fmtG(p.azimuth_deg)}° (${compass(p.azimuth_deg)})` : "",
    Tilt: isNum(p.tilt_deg) ? fmtG(p.tilt_deg) : "",
    OmrPerKwp: isNum(p.subtotal_omr) && dc ? fmtOmr(p.subtotal_omr / dc) : "",
    Degradation: degradationText(degradation(p)),
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

  const ss = subsystemTable(p);
  Object.assign(v, { SS_TotModules: n0(ss.totals.modules), SS_TotInverters: `${n0(ss.totals.inverters)} inverters`,
                     SS_TotDC: fmtNum(ss.totals.dc, 2), SS_TotAC: fmtNum(ss.totals.ac, 1), SS_TotRatio: fmtNum(ss.totals.ratio, 2) });
  // a system with several inverter models names them all
  if (p.inverter_mix) v.InverterMix = p.inverter_mix;
  else v.InverterMix = inv.model ? `${s(p.inverter_qty || "")} × ${fmtG(inv.ac_kw)}kW (${inv.model})` : "";
  if (p.inverter_makes) v.InverterMake = p.inverter_makes;
  if (p.installation_mix) v.InstallationType = p.installation_mix;

  componentsOf(p).forEach((c, i) => {
    v[`Comp${i + 1}Name`] = [c.item.make, c.item.model].filter(Boolean).join(" ");
    const what = c.kind === "module" ? "PV module" : "Inverter";
    v[`Comp${i + 1}Role`] = isNum(c.count) ? `${what} · ${n0(c.count)} ${c.count === 1 ? "unit" : "units"}` : what;
  });

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
  const subsystems = ss.rows.map((r, i) => ({ name: [r.name || `Sub-system ${i + 1}`, r.desc].filter(Boolean).join(": "),
    mounting: r.mounting, module: r.module, modules: n0(r.modules), dc: fmtNum(r.dc, 2), inverters: r.inverters, ac: fmtNum(r.ac, 1), ratio: fmtNum(r.ratio, 2) }));
  return { values: v, months, estimated, flow, annual, dc, ac, subsystems };
}

/** Labels of the fields an offer deck still needs; [] when it can be made in full. */
export function offerMissing(p) {
  return [[p.client, "Client"], [p.module, "PV module"], [p.module_count, "Number of modules"],
    [p.inverter, "Inverter"], [p.annual_gen_kwh || p.monthly_kwh, "Annual generation"], [p.subtotal_omr, "Price (subtotal)"]]
    .filter(([v]) => v === null || v === undefined || v === "" || v === 0).map(([, label]) => label);
}
