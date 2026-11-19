// O&M report checks:  node --test web/tests/
import { test } from "node:test";
import assert from "node:assert/strict";
import JSZip from "jszip";

globalThis.JSZip = JSZip;
const { readExport, monthKey } = await import("../js/om/xlsx.js");
const { compute, siteOf, reportNo, CHECKLIST, parseDate, dateFromFileName, matchClient } = await import("../js/om/model.js");
const { readChecklist, fromChecklist } = await import("../js/om/checklist.js");
const { buildReport, buildChecklist } = await import("../js/om/report.js");
const { reportCharts, niceScale } = await import("../js/om/charts.js");

// A workbook laid out like the iSolarCloud "Monthly report" export (shared strings, Wh/m²).
async function exportXlsx(rows) {
  const strings = [];
  const si = (s) => { let i = strings.indexOf(s); if (i < 0) { strings.push(s); i = strings.length - 1; } return i; };
  const cell = (ref, v) => (typeof v === "number" ? `<c r="${ref}"><v>${v}</v></c>` : v === "" ? `<c r="${ref}"/>` : `<c r="${ref}" t="s"><v>${si(v)}</v></c>`);
  const all = [["Monthly report_Year_2026"], ["Plant name", "Time", "Monthly yield(kWh)", "PR(%)", "Plant monthly irradiation(Wh/㎡)"], ...rows];
  const sheet = all.map((r, i) => `<row r="${i + 1}">${r.map((v, j) => cell(`${"ABCDE"[j]}${i + 1}`, v)).join("")}</row>`).join("");
  const zip = new JSZip();
  zip.file("xl/workbook.xml", '<workbook xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="Report" sheetId="1" r:id="rId1"/></sheets></workbook>');
  zip.file("xl/_rels/workbook.xml.rels", '<Relationships><Relationship Id="rId1" Type="worksheet" Target="worksheets/sheet1.xml"/></Relationships>');
  zip.file("xl/worksheets/sheet1.xml", `<worksheet><sheetData>${sheet}</sheetData></worksheet>`);
  zip.file("xl/sharedStrings.xml", `<sst>${strings.map((s) => `<si><t>${s}</t></si>`).join("")}</sst>`);
  return zip.generateAsync({ type: "uint8array" });
}

const ROWS = [
  ["Plant", "2026-01", "", "", ""], ["Plant", "2026-02", "", "", ""], ["Plant", "2026-03", "", "", ""],
  ["Plant", "2026-04", 8299.4, 28.45, 76059.91],
  ["Plant", "2026-05", 70190.3, 90, 237476.73],
  ["Plant", "2026-06", 69934.7, 85.83, 247316.79],
  ["Plant", "2026-07", 65452, 79.09, 215747.02],
  ["Plant", "2026-12", "", "", ""],
];

const client = { id: 1, name: "Test Ministry", om: { plant_name: "Plant", capacity_kwp: 383, commissioning_month: "2026-04",
  installation: "Carpark roof", inverters: [{ model: "Sungrow SG125CX-P2", qty: 3, ac_kw: 125 }] } };

test("the iSolarCloud export is read month by month, irradiation in kWh/m²", async () => {
  const exp = await readExport(await exportXlsx(ROWS));
  assert.equal(exp.plant, "Plant");
  assert.equal(exp.year, 2026);
  assert.deepEqual(Object.keys(exp.months), ["2026-04", "2026-05", "2026-06", "2026-07"]);
  assert.equal(exp.months["2026-05"].energy, 70190.3);
  assert.ok(Math.abs(exp.months["2026-05"].irr - 237.47673) < 1e-9);
  assert.equal(monthKey(46143), "2026-05");
});

test("the report is cumulative for the calendar year, from commissioning", async () => {
  const exp = await readExport(await exportXlsx(ROWS));
  const site = siteOf(client);
  const r = { id: 9, client_id: 1, report_month: "2026-07", report_date: "2026-07-31", export_months: exp.months };
  const calc = compute(r, site, []);
  assert.deepEqual(calc.months.map((d) => d.key), ["2026-04", "2026-05", "2026-06", "2026-07"]);
  assert.equal(calc.problems.length, 0);
  assert.ok(calc.months[0].partial && !calc.months[0].in_avg);
  assert.ok(!calc.current.mtd, "31 July is the end of the month");
  const e = 70190.3 + 69934.7 + 65452;
  assert.ok(Math.abs(calc.totals.energy - (e + 8299.4)) < 1e-6);
  // energy-weighted PR, commissioning month left out
  const pr = (90 * 70190.3 + 85.83 * 69934.7 + 79.09 * 65452) / e;
  assert.ok(Math.abs(calc.totals.pr - pr) < 1e-9);
  assert.ok(Math.abs(calc.totals.co2 - (e + 8299.4) * 0.49) < 1e-6);
  assert.ok(Math.abs(calc.months[3].cum - calc.totals.energy) < 1e-6);
  // a May report only runs to May; a date inside the month makes it month-to-date
  const may = compute({ ...r, report_month: "2026-05", report_date: "2026-05-20" }, site, []);
  assert.deepEqual(may.months.map((d) => d.key), ["2026-04", "2026-05"]);
  assert.ok(may.current.mtd);
});

test("a new year starts again in January; earlier months come from earlier reports", () => {
  const site = siteOf(client);
  const jan = { id: 1, client_id: 1, report_month: "2027-01", export_months: { "2027-01": { energy: 40000, pr: 80, irr: 130 } },
    maintenance_log: [{ date: "2027-01-15", activity: "Module cleaning" }] };
  const feb = { id: 2, client_id: 1, report_month: "2027-02", export_months: { "2027-02": { energy: 45000, pr: 82, irr: 145 } },
    maintenance_log: [{ date: "2027-02-10", activity: "Module cleaning" }, { date: "2026-12-01", activity: "Module cleaning" }] };
  const other = { id: 3, client_id: 2, report_month: "2027-01", export_months: { "2027-01": { energy: 1, pr: 1, irr: 1 } } };
  const calc = compute(feb, site, [jan, feb, other]);
  assert.deepEqual(calc.months.map((d) => d.key), ["2027-01", "2027-02"]);
  assert.equal(calc.totals.energy, 85000);
  assert.deepEqual(calc.log.map((e) => e.date), ["2027-01-15", "2027-02-10"]);
  assert.ok(calc.problems.some((p) => /outside the report period/.test(p)));
  assert.equal(reportNo(feb, site), "Plant-OM-2027-02");
});

test("missing months are reported, not guessed", () => {
  const calc = compute({ client_id: 1, report_month: "2026-08", export_months: { "2026-08": { energy: 10, pr: 80, irr: 1 } } }, siteOf(client), []);
  assert.ok(calc.problems.some((p) => /April 2026/.test(p)));
  assert.deepEqual(calc.months.map((d) => d.key), ["2026-08"]);
});

test("the report and the checklist build, with the figures in them", async () => {
  const exp = await readExport(await exportXlsx(ROWS));
  const site = siteOf(client);
  const r = { client_id: 1, report_month: "2026-07", report_date: "2026-07-20", export_months: exp.months, export_name: "export.xlsx",
    maintenance_log: [{ date: "2026-07-05", activity: "Module cleaning", scope: "All rows", by: "O&M team" }],
    findings: [{ item_no: "13", finding: "Heat marks on a connector", severity: "High", action: "Replaced", status: "Closed" }] };
  const calc = compute(r, site, []);
  const charts = reportCharts(calc);
  for (const svg of Object.values(charts)) assert.ok(svg.startsWith("<svg") && !svg.includes("NaN"));
  const buf = await buildReport({ report: r, site, calc, photos: [{ label: "Cleaning", before: null, after: null }] }, { output: "buffer" });
  const xml = await (await JSZip.loadAsync(buf)).file("word/document.xml").async("string");
  for (const s of ["Plant Solar PV Plant", "Test Ministry", "Plant-OM-2026-07", "3 × Sungrow SG125CX-P2", "213,876.4", "Heat marks on a connector",
    "5 Jul 2026", "month-to-date", "exactly 90.0 %"]) assert.ok(xml.includes(s), s);
  assert.ok(!/Faults, Alarms|Observations and Recommendations/.test(xml), "sections 6 and 7 are left out");
  const cl = await buildChecklist({ site }, { output: "buffer" });
  const cxml = await (await JSZip.loadAsync(cl)).file("word/document.xml").async("string");
  assert.equal(CHECKLIST.flatMap((s) => s.items).length, 34);
  for (const s of ["Preventive Maintenance Checklist", "Module Cleaning Record", "Defects Found", "Check MC4 connectors"]) assert.ok(cxml.includes(s), s);
});

test("chart axes round up", () => {
  assert.deepEqual(niceScale(76), { top: 80, step: 20 });
  assert.equal(niceScale(0).top, 1);
});

test("figures typed over the export win, and are marked", async () => {
  const exp = await readExport(await exportXlsx(ROWS));
  const r = { client_id: 1, report_month: "2026-07", report_date: "2026-07-31", export_months: exp.months, figures: { "2026-06": { energy: 70000 }, "2026-08": { energy: 5 } } };
  const calc = compute(r, siteOf(client), []);
  const jun = calc.months.find((d) => d.key === "2026-06");
  assert.equal(jun.energy, 70000);
  assert.deepEqual(jun.edited, ["energy"]);
  assert.equal(jun.pr, 85.83);
  assert.ok(!calc.months.some((d) => d.key === "2026-08"));
  // an earlier report's correction carries into later months' reports
  const aug = compute({ id: 2, client_id: 1, report_month: "2026-08", export_months: { ...exp.months, "2026-08": { energy: 1, pr: 80, irr: 1 } } }, siteOf(client), [{ ...r, id: 1 }]);
  assert.equal(aug.months.find((d) => d.key === "2026-06").energy, 70000);
});

test("dates, file names and plant names are read from what the user has", () => {
  assert.equal(parseDate("10/11/2026"), "2026-11-10");
  assert.equal(parseDate("10 Nov 2026"), "2026-11-10");
  assert.equal(parseDate("3", "2026-11"), "2026-11-03");
  assert.equal(parseDate("31/02/2026"), "");
  assert.equal(dateFromFileName("Monthly report_Year_2026_20261119090441.xlsx"), "2026-11-19");
  const cs = [{ id: 1, name: "Someone else" }, { id: 2, name: "Ministry of Housing and Urban Planning (MoHUP)" }];
  assert.equal(matchClient("MoHUP", cs)?.id, 2);
  assert.equal(matchClient("Other plant", cs), null);
});

test("the filled checklist is read back: ticks, remarks, cleaning and defects", async () => {
  const site = siteOf(client);
  const buf = await buildChecklist({ site, ref: "Plant-CL-2026-11", month: "2026-11" }, { output: "buffer" });
  const zip = await JSZip.loadAsync(buf);
  let xml = await zip.file("word/document.xml").async("string");
  // tick boxes in order: 4 visit types, then 3 per item (OK, Not OK, N/A), then cleaning and defect rows
  let n = 0;
  const tick = new Set([1, 5, 9, 13]);   // Monthly; item 1 OK; item 2 Not OK; item 3 N/A
  xml = xml.replace(/<w14:checked w14:val="0"\/>/g, (m) => (tick.has(++n) ? '<w14:checked w14:val="1"/>' : m));
  // type into empty cells: fill the n-th empty paragraph of a cell
  const fill = (after, text) => {
    const i = xml.indexOf(after);
    const j = xml.indexOf("</w:tc>", xml.indexOf("</w:tc>", i) + 1);   // the cell after the label cell
    const k = xml.lastIndexOf("</w:p>", j);
    xml = xml.slice(0, k) + `<w:r><w:t xml:space="preserve">${text}</w:t></w:r>` + xml.slice(k);
  };
  fill(">Visit date<", "10/11/2026");
  fill(">Inspected by<", "O&amp;M team");
  zip.file("word/document.xml", xml);
  const cl = await readChecklist(await zip.generateAsync({ type: "uint8array" }), "2026-11");
  assert.equal(cl.ref, "Plant-CL-2026-11");
  assert.equal(cl.visit_date, "2026-11-10");
  assert.equal(cl.visit_type, "Monthly");
  assert.equal(cl.inspected_by, "O&M team");
  assert.equal(cl.items.length, 34);
  assert.deepEqual(cl.items.slice(0, 4).map((x) => x.status), ["OK", "Not OK", "N/A", ""]);

  // what the report takes from it
  cl.items[1].remarks = "Heavy dust on rows 3-5";
  cl.items[0].remarks = "Slight discolouration on row 2, to watch";
  cl.cleaning = [{ date: "2026-11-10", area: "All rows", method: "Wet", soiling: "High", water: "400", by: "O&M team" }];
  cl.defects = [{ no: "1", item_no: "2", description: "Bird droppings on row 4", severity: "Med", action: "Cleaned", target: "", status: "Closed" },
    { no: "2", item_no: "", description: "Loose cable tie at DB-2", severity: "Low", action: "", target: "", status: "Open" }];
  const got = fromChecklist(cl, "2026-11");
  assert.deepEqual(got.visits.map((v) => [v.date, v.activity]), [["2026-11-10", "Cleaning and general inspection"]]);
  assert.deepEqual(got.findings.map((f) => [f.item_no, f.finding, f.severity, f.status]),
    [["2", "Bird droppings on row 4", "Medium", "Closed"], ["", "Loose cable tie at DB-2", "Low", "Open"]]);
  assert.deepEqual(got.counts, { OK: 1, "Not OK": 1, "N/A": 1, blank: 31 });

  // and the report shows it in section 5
  const exp = await readExport(await exportXlsx(ROWS));
  const r = { client_id: 1, report_month: "2026-07", report_date: "2026-07-31", export_months: exp.months, figures: { "2026-07": { pr: 80 } },
    checklist: { ...cl, visit_date: "2026-07-10", cleaning: [{ ...cl.cleaning[0], date: "2026-07-10" }] }, findings: got.findings,
    maintenance_log: [{ date: "2026-07-10", activity: "Cleaning and general inspection", ref: cl.ref }] };
  const calc = compute(r, site, []);
  const rx = await (await JSZip.loadAsync(await buildReport({ report: r, site, calc, photos: [] }, { output: "buffer" }))).file("word/document.xml").async("string");
  for (const s of ["Plant-CL-2026-11", "1 OK, 1 Not OK, 1 not applicable, 31 not checked", "Bird droppings on row 4", "All rows", "Wet",
    "Other remarks from the checklist", "Slight discolouration on row 2", "Corrected by hand", "Cleaning and general inspection"]) assert.ok(rx.includes(s), s);
});
