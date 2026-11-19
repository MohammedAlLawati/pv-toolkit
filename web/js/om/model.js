// O&M reports: the numbers. A monthly report for one client's plant, cumulative for the
// calendar year (January, or the commissioning month, up to the report month).
//
// Everything is recalculated from the inputs each time: generation, PR, irradiation and
// specific yield per month, the year-to-date totals, CO2 avoided and the tree equivalent.
// PR and irradiation are used as iSolarCloud reports them (no PR target).
//
// om_reports store record:
//   client_id, report_month "YYYY-MM", report_date "YYYY-MM-DD", prepared_by, report_no
//   export_file_id, export_name     the uploaded iSolarCloud .xlsx (kept as a file)
//   export_months                   { "YYYY-MM": { energy, pr, irr } } read from it
//   maintenance_log                 [{ date, activity, scope, by, ref }] this month's visits
//   cleaning_photos                 [{ date, before_id, after_id }] this month's cleanings
//   findings                        [{ item_no, finding, severity, action, status }] Not OK checklist items
//   versions                        [{ n, created_at, report_file_id, report_name, summary }]
//
// The plant itself lives on the client record, as client.om (entered once per client):
//   plant_name, capacity_kwp, installation, location, commissioning_month "YYYY-MM",
//   inverters [{ inverter_id, model, qty, ac_kw }]

export const EMISSION_FACTOR = 0.49;   // kg CO2 per kWh, Oman grid
export const TREE_KG = 21.77;          // kg CO2 absorbed per tree per year
export const TREES_PER_ICON = 100;

export const ACTIVITIES = ["Module cleaning", "Monthly inspection (checklist)", "Quarterly inspection (checklist)",
  "Annual inspection (checklist)", "Corrective maintenance", "Inverter service", "Other"];
export const SEVERITIES = ["Low", "Medium", "High"];

export const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
export const MON = MONTHS.map((m) => m.slice(0, 3));

export const NEW_REPORT = { client_id: null, report_month: "", report_date: "", prepared_by: "", report_no: "",
  export_file_id: null, export_name: "", export_months: {}, maintenance_log: [], cleaning_photos: [], findings: [], versions: [] };

export const NEW_SITE = { plant_name: "", capacity_kwp: null, installation: "", location: "", commissioning_month: "", inverters: [] };

/** The preventive-maintenance checklist (issued separately and filled in on site). */
export const CHECKLIST = [
  { section: "A. PV Modules and Cleaning", items: [
    [1, "Visual check of all modules for cracks, broken glass, discolouration, hot-spots, delamination, snail trails", "Monthly"],
    [2, "Check soiling level (dust, bird droppings); clean modules when soiled; record before/after photos", "Monthly / as needed"],
    [3, "Check for shading from nearby objects, vegetation, signs or new structures", "Monthly"],
    [4, "Check module frames and labels for corrosion, damage or missing data plates", "Quarterly"],
  ] },
  { section: "B. Mounting Structure and Carpark Metal-Sheet Roof", items: [
    [5, "Check mounting clamps, rails and brackets for tightness, loose or missing fasteners", "Quarterly"],
    [6, "Check roof-sheet fixings (clips / screws / seam clamps) where the structure is attached: no movement or lifting", "Quarterly"],
    [7, "Check for roof leaks, water stains or sealing failure around roof penetrations and fixings (inspect from below the carpark)", "Quarterly / after rain"],
    [8, "Check for rust or corrosion on metal sheets, rails, bolts and galvanised parts; treat and touch-up paint", "Quarterly"],
    [9, "Check roof gutters, downpipes and drainage are clear of dust, leaves and debris", "Quarterly"],
    [10, "Check for roof-sheet deformation, sagging or expansion-joint problems under the module load", "Annual"],
    [11, "Check after strong wind or storm: displaced modules, bent rails, damaged edges", "After event"],
  ] },
  { section: "C. DC Cables, Connectors and Combiner", items: [
    [12, "Check DC cables are tied and supported, no sagging or contact with sharp metal sheet edges; UV-resistant ties intact", "Quarterly"],
    [13, "Check MC4 connectors: fully locked, no heat marks, burning or water ingress", "Quarterly"],
    [14, "Check string combiner / junction boxes: sealed, clean, no moisture, loose terminals or insects", "Quarterly"],
    [15, "Check DC isolators, fuses and surge protection devices (SPD) status", "Quarterly"],
    [16, "Measure string voltage / current and compare strings; investigate deviations", "Annual"],
  ] },
  { section: "D. Inverters and AC Side", items: [
    [17, "Check inverter display / status: no active alarms or faults; record error log", "Daily (remote)"],
    [18, "Check inverter ventilation, fans and heat sinks; clean filters and dust", "Quarterly"],
    [19, "Check inverter enclosure, cable glands and terminations for tightness and heat discolouration", "Annual"],
    [20, "Check AC breakers, isolators, meters and distribution board: operation, labels, no overheating", "Quarterly"],
    [21, "Thermographic scan of connections, breakers and inverter terminals under load", "Annual"],
  ] },
  { section: "E. Earthing, Lightning and Electrical Safety", items: [
    [22, "Check earthing and bonding of modules, rails and metal roof; continuity and corrosion at joints", "Annual"],
    [23, "Measure earth resistance and insulation resistance of DC strings", "Annual"],
    [24, "Check lightning / surge protection and earth connections are intact", "Annual"],
    [25, "Check warning signs, labels, single-line diagram and emergency shutdown instructions are in place and legible", "Annual"],
  ] },
  { section: "F. Monitoring and Measurement", items: [
    [26, "Check data logger and communication: all inverters reporting, no data gaps", "Daily (remote)"],
    [27, "Check irradiation sensor (pyranometer / reference cell): clean, correct tilt, calibration valid", "Monthly"],
    [28, "Verify monthly generation against meter reading; record PR and compare with previous months", "Monthly"],
    [29, "Review energy-yield trend and alarms; log corrective actions", "Monthly"],
  ] },
  { section: "G. Carpark Site Safety and General", items: [
    [30, "Check columns, beams and supports under the roof for vehicle impact damage, corrosion or cracks", "Quarterly"],
    [31, "Check safe access to the roof: ladders, anchor points, walkways; use fall protection when working at height", "Each visit"],
    [32, "Check for bird nests, pests and debris under or between modules", "Quarterly"],
    [33, "Check carpark lighting, fire extinguishers and fire exits are not affected by the PV system", "Annual"],
    [34, "Keep the maintenance logbook up to date (date, work done, findings, photos, name)", "Each visit"],
  ] },
];

// ---- helpers -----------------------------------------------------------------------------

const pad = (n) => String(n).padStart(2, "0");
export const ym = (key) => { const [y, m] = String(key).split("-").map(Number); return { y, m }; };
export const keyOf = (y, m) => `${y}-${pad(m)}`;
export const daysIn = (y, m) => new Date(Date.UTC(y, m, 0)).getUTCDate();
export const monthName = (key) => { const { y, m } = ym(key); return `${MONTHS[m - 1]} ${y}`; };
const has = (v) => v !== null && v !== undefined && v !== "";
const isKey = (k) => /^\d{4}-\d{2}$/.test(String(k || ""));

/** "2026-11-10" -> "10 Nov 2026". */
export function fmtDate(iso) {
  const m = String(iso || "").match(/^(\d{4})-(\d{2})-(\d{2})/);
  return m ? `${Number(m[3])} ${MON[Number(m[2]) - 1]} ${m[1]}` : String(iso || "");
}

/** The plant as the template needs it, from the client record. */
export function siteOf(client) {
  const om = { ...NEW_SITE, ...(client?.om || {}) };
  return {
    ...om,
    client_name: client?.name || "",
    plant_name: om.plant_name || client?.name || "",
    capacity_kwp: Number(om.capacity_kwp) || null,
    installation: om.installation || (client?.installation_types || []).join(" / "),
    inverters: (om.inverters || []).filter((i) => i && (i.model || i.inverter_id)),
  };
}

/** "3 × Sungrow SG110CX (110 kW AC each, 330 kW AC)" per line, joined with ", ". */
export function inverterText(site) {
  return site.inverters.map((i) => {
    const qty = Number(i.qty) || 1, kw = Number(i.ac_kw);
    return `${qty} × ${i.model || "inverter"}` + (kw ? ` (${fmt(kw, 0)} kW AC${qty > 1 ? ` each, ${fmt(kw * qty, 0)} kW AC` : ""})` : "");
  }).join(", ");
}

export const totalAcKw = (site) => site.inverters.reduce((a, i) => a + (Number(i.qty) || 1) * (Number(i.ac_kw) || 0), 0);

/** 1234.5 -> "1,234.5" with dp decimals. */
export function fmt(v, dp = 1) {
  if (!Number.isFinite(Number(v))) return "n/a";
  const [i, f] = Number(v).toFixed(dp).split(".");
  return i.replace(/\B(?=(\d{3})+(?!\d))/g, ",") + (f ? "." + f : "");
}

export function reportNo(r, site) {
  if (r.report_no) return r.report_no;
  const code = String(site.plant_name || "PLANT").replace(/[^A-Za-z0-9]+/g, "").slice(0, 16) || "PLANT";
  return `${code}-OM-${r.report_month || "YYYY-MM"}`;
}

/** Reports of the same client and calendar year before this one (oldest first). */
export function earlierInYear(r, reports) {
  if (!isKey(r.report_month)) return [];
  const y = r.report_month.slice(0, 4);
  return reports.filter((x) => x.id !== r.id && x.client_id === r.client_id && isKey(x.report_month)
    && x.report_month.slice(0, 4) === y && x.report_month < r.report_month)
    .sort((a, b) => a.report_month.localeCompare(b.report_month));
}

/** First month of the report: January of the report year, or the commissioning month if later. */
export function periodStart(r, site) {
  const { y } = ym(r.report_month);
  const jan = keyOf(y, 1);
  return isKey(site.commissioning_month) && site.commissioning_month > jan ? site.commissioning_month : jan;
}

// ---- the calculation ---------------------------------------------------------------------

/**
 * Work out the report. `reports` is every saved O&M report (for the earlier months' figures
 * and maintenance). Returns { months, totals, current, log, period, problems }.
 */
export function compute(r, site, reports = [], { emission = EMISSION_FACTOR, treeKg = TREE_KG } = {}) {
  const problems = [];
  if (!isKey(r.report_month)) return { months: [], totals: null, current: null, log: [], problems: ["Pick the report month."] };
  const P = Number(site.capacity_kwp);
  if (!(P > 0)) problems.push("Enter the plant's DC capacity (kWp) in the site details.");
  const earlier = earlierInYear(r, reports);
  // this report's export wins; earlier months missing from it come from earlier reports
  const data = {};
  for (const x of earlier) Object.assign(data, x.export_months || {});
  Object.assign(data, r.export_months || {});

  const start = periodStart(r, site), end = r.report_month;
  const rd = /^\d{4}-\d{2}-\d{2}/.test(r.report_date || "") ? r.report_date : null;
  const months = [];
  for (let { y, m } = ym(start); keyOf(y, m) <= end; m === 12 ? (y++, m = 1) : m++) {
    const key = keyOf(y, m), d = data[key];
    if (!d || !Number.isFinite(Number(d.energy))) {
      if (key === end) problems.push(`The Excel sheet has no generation for ${monthName(key)}.`);
      else problems.push(`No generation for ${monthName(key)}: upload an export that includes it.`);
      continue;
    }
    const energy = Number(d.energy);
    const partial = key === site.commissioning_month;
    const mtd = key === end && !!rd && rd.slice(0, 7) === key && Number(rd.slice(8, 10)) < daysIn(y, m);
    const pr = has(d.pr) && Number.isFinite(Number(d.pr)) ? Number(d.pr) : null;
    const irr = has(d.irr) && Number.isFinite(Number(d.irr)) ? Number(d.irr) : null;
    const co2 = energy * emission;
    months.push({ key, y, m, label: MON[m - 1], energy, pr, irr, partial, mtd,
      in_avg: pr !== null && !partial, sy: P > 0 ? energy / P : null, co2, trees: co2 / treeKg });
  }
  let cum = 0;
  for (const d of months) { cum += d.energy; d.cum = cum; }
  const inc = months.filter((d) => d.in_avg);
  const energy = months.reduce((a, d) => a + d.energy, 0);
  const co2 = energy * emission;
  const totals = months.length ? {
    energy, co2, trees: co2 / treeKg,
    sy: P > 0 ? energy / P : null,
    irr: months.reduce((a, d) => a + (d.irr || 0), 0),
    pr: inc.length ? inc.reduce((a, d) => a + d.pr * d.energy, 0) / inc.reduce((a, d) => a + d.energy, 0) : null,
    pr_range: inc.length ? (inc.length > 1 ? `${inc[0].label}–${inc[inc.length - 1].label}` : inc[0].label) : "",
    pr_low: inc.length ? inc.reduce((a, d) => (d.pr < a.pr ? d : a)) : null,
    pr_high: inc.length ? inc.reduce((a, d) => (d.pr > a.pr ? d : a)) : null,
    top: months.reduce((a, d) => (d.energy > a.energy ? d : a)),
  } : null;
  const current = months.find((d) => d.key === end) || null;

  // maintenance: this year's earlier visits, then this month's
  const inPeriod = (e) => /^\d{4}-\d{2}-\d{2}/.test(e?.date || "") && e.date.slice(0, 7) >= start && e.date.slice(0, 7) <= end;
  const log = [...earlier.flatMap((x) => x.maintenance_log || []), ...(r.maintenance_log || [])]
    .filter(inPeriod).sort((a, b) => a.date.localeCompare(b.date));
  for (const e of r.maintenance_log || []) {
    if (e.date && !inPeriod(e)) problems.push(`The visit on ${fmtDate(e.date)} is outside the report period.`);
  }
  return { months, totals, current, log, period: { start, end }, problems };
}

export const isCleaning = (e) => /clean/i.test(e?.activity || "");
export const isInspection = (e) => /inspect/i.test(e?.activity || "");

/** File name for a generated document. */
export function fileBase(r, site) {
  return `${reportNo(r, site)} - O&M Report`;
}
