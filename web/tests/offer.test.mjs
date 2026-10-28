// Offer deck: every placeholder filled, the right datasheet slides kept, charts updated.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import JSZip from "jszip";
import { DOMParser, XMLSerializer } from "@xmldom/xmldom";

globalThis.JSZip = JSZip;
globalThis.DOMParser = DOMParser;
globalThis.XMLSerializer = XMLSerializer;

const { renderPptx } = await import("../js/offer/pptx.js");
const { buildOfferValues, cashFlow, parseMonthly } = await import("../js/offer/values.js");

const template = readFileSync(new URL("../templates/offer_deck.pptx", import.meta.url));
const base = JSON.parse(readFileSync(new URL("./fixtures/docgen_cases.json", import.meta.url)))[0].project;

async function deck(p, images = {}) {
  const { values, months, flow } = buildOfferValues(p, new Date("2026-03-05T00:00:00"));
  const out = await renderPptx(template, { values, months, flow, images,
    moduleModel: p.module?.model || "", inverterModel: p.inverter?.model || "" });
  const zip = await JSZip.loadAsync(out.bytes);
  const pres = await zip.file("ppt/presentation.xml").async("string");
  const slideFiles = Object.keys(zip.files).filter((n) => /^ppt\/slides\/slide\d+\.xml$/.test(n));
  let text = "";
  for (const f of slideFiles) text += await zip.file(f).async("string");
  return { out, zip, pres, slideFiles, text, values };
}

test("degradation and payback", () => {
  const f = cashFlow({ degradation_pct: 0.65, tariff_bz: 33, subtotal_omr: 741600 }, 7145700);
  assert.equal(f.years[1].kwh.toFixed(2), (7145700 * 0.9935).toFixed(2));   // template: 7,099.25 MWh
  assert.equal((f.years[24].loss * 100).toFixed(1), "14.5");                   // template: 14.5 %
  assert.ok(f.payback > 3.1 && f.payback < 3.25, String(f.payback));          // template: about 3 y 2 m
});

test("monthly figures pasted from PVsyst", () => {
  assert.deepEqual(parseMonthly("1,200 1,300\n1400 1500 1600 1700 1800 1900 2000 2100 2200 2300"),
                   [1200, 1300, 1400, 1500, 1600, 1700, 1800, 1900, 2000, 2100, 2200, 2300]);
  assert.equal(parseMonthly("1 2 3"), null);
});

test("generic spec slides for equipment without datasheet slides", async () => {
  const d = await deck(base);
  assert.deepEqual(d.out.missing, []);
  assert.ok(!d.text.includes("{{"), "a placeholder was left");
  assert.ok(!/Jazeera|AstroEnergy|Chiller/i.test(d.text));
  // 46 template slides + 2 spec slides - 7 datasheet slides - shadow slide (no image)
  assert.equal(d.slideFiles.length, 40);
  assert.ok(d.text.includes("Ahmed Salim Al Harthy"));
  assert.ok(d.text.includes("JKM620N-66HL4M-BDV PV Module Specification"));
  const c1 = await d.zip.file("ppt/charts/chart1.xml").async("string");
  const may = buildOfferValues(base).months[4] / 1000;
  assert.ok(c1.includes(`<c:v>${+may.toFixed(1)}</c:v>`));
  const c3 = await d.zip.file("ppt/charts/chart3.xml").async("string");
  assert.equal((c3.match(/<c:pt /g) || []).length, 50); // 25 categories + 25 values
});

test("template datasheet slides for the SG125CX-P2 and the Jinko 620", async () => {
  const p = { ...base, module: { ...base.module, model: "JKM620N-78HL4-BDV" },
              inverter: { ...base.inverter, model: "SG125CX-P2", ac_kw: 125 } };
  const png = Uint8Array.from(atob("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg=="), (c) => c.charCodeAt(0));
  const img = { bytes: png, ext: "png", width: 1600, height: 900 };
  const d = await deck(p, { site: img, shadow: img, structure: img });
  assert.ok(!d.text.includes("{{"));
  // 46 - SG150CX slides (2); module and inverter datasheets kept, spec slides dropped
  assert.equal(d.slideFiles.length, 44);
  assert.ok(d.text.includes("SG125CX") && !d.text.includes("SG150CX"));
  assert.ok(!d.text.includes("img:"));
  assert.ok(d.zip.file("ppt/media/offer1.png"));
});

test("no relationship points at a removed part", async () => {
  const d = await deck(base);
  const names = new Set(Object.keys(d.zip.files));
  const broken = [];
  for (const relName of [...names].filter((n) => n.endsWith(".rels"))) {
    const xml = await d.zip.file(relName).async("string");
    const dir = relName.replace(/_rels\/[^/]*\.rels$/, "");
    for (const m of xml.matchAll(/<Relationship [^>]*>/g)) {
      if (/TargetMode="External"/.test(m[0])) continue;
      const target = m[0].match(/Target="([^"]+)"/)[1];
      const parts = (target.startsWith("/") ? target.slice(1) : dir + target).split("/");
      const out = [];
      for (const s of parts) { if (s === "..") out.pop(); else if (s && s !== ".") out.push(s); }
      if (!names.has(out.join("/"))) broken.push(`${relName} -> ${target}`);
    }
  }
  const ct = await d.zip.file("[Content_Types].xml").async("string");
  for (const m of ct.matchAll(/PartName="\/([^"]+)"/g)) if (!names.has(m[1])) broken.push("content type for " + m[1]);
  assert.deepEqual(broken, []);
});

test("offerMissing lists what the deck still needs", async () => {
  const { offerMissing } = await import("../js/offer/values.js");
  assert.deepEqual(offerMissing(base), []);
  assert.deepEqual(offerMissing({ ...base, subtotal_omr: null, annual_gen_kwh: 0, monthly_kwh: null }),
                   ["Annual generation", "Price (subtotal)"]);
});

test("environmental equivalents use the EPA Calc spreadsheet factors", () => {
  // EPA Calc sheet 2: 5,920 × 625 W = 3,700 kWp × 1,650 = 6,105,000 kWh
  const { values } = buildOfferValues({ ...base, annual_gen_kwh: 6105000, monthly_kwh: null });
  assert.equal(values.CO2Tonnes, "4,267");
  assert.equal(values.Homes, "185");
  assert.equal(values.GasGallons, "479,897");
  assert.equal(values.Cars, "1,015");
  assert.equal(values.Seedlings, "70,524");
});

test("quick offer: module × count, price per kWp and a client name make a whole deck", async () => {
  const { toProject, annualKwh, quickMissing, suggestCode, DEFAULT_SCHEDULE } = await import("../js/offer/quick.js");
  const module = { ...base.module, id: 7 }, inverter = { ...base.inverter, id: 9 };
  const lookup = { module: new Map([[7, module]]), inverter: new Map([[9, inverter]]), client: new Map() };
  const o = { client_name: "Al Noor Trading", price_per_kwp: 350, module_id: 7, module_count: 240, inverter_id: 9, inverter_qty: 1,
              tariff_bz: 32, degradation_pct: 0.65, specific_yield: 1650 };
  const dc = (module.wp * 240) / 1000, ac = inverter.ac_kw;
  assert.deepEqual(quickMissing(o, lookup), []);
  assert.deepEqual(quickMissing({ ...o, price_per_kwp: null, client_name: "" }, lookup), ["Client name", "Price per kWp"]);
  assert.deepEqual(quickMissing({ ...o, module_count: null }, lookup), ["DC capacity (module and number of panels)"]);
  assert.equal(annualKwh(o, dc).kwh, dc * 1650);
  assert.equal(annualKwh({ ...o, annual_gen_kwh: 250000 }, dc).source, "annual");

  const p = toProject(o, lookup);
  assert.equal(p.dc_kwp, dc);
  assert.equal(p.ac_kw, ac);
  assert.equal(p.subtotal_omr, Math.round(350 * dc * 1000) / 1000);
  assert.equal(p.reference_code, "ANT");
  assert.deepEqual(p.schedule, DEFAULT_SCHEDULE);
  // a typed capacity stands when no module is chosen
  assert.equal(toProject({ ...o, module_id: null, dc_kwp: 148.8 }, lookup).dc_kwp, 148.8);

  const { text, values } = await deck(p);
  assert.equal(values.Name, "Al Noor Trading");
  assert.ok(values.PaybackText && values.ROI && values.CO2Tonnes);
  assert.ok(!/\{\{\w+\}\}/.test(text), "no placeholder left unfilled");
  assert.ok(text.includes("Al Noor Trading"));

  assert.equal(suggestCode("Petroleum Development Oman"), "PDO");
  assert.equal(suggestCode("Autism Disorder Center"), "ADC");
  assert.equal(suggestCode("Bank of the Muscat SAOG"), "BM");
});

test("shading above 3% is called out on slide 16", async () => {
  const { shadingText } = await import("../js/offer/values.js");
  assert.ok(!/higher than/.test(shadingText(0.2).join(" ")));
  assert.match(shadingText(4.5)[0], /4\.5%.*higher than the 3% design limit/);
  const img = { bytes: readFileSync(new URL("../data/htc_logo.jpg", import.meta.url)), ext: "jpeg", width: 400, height: 300 };
  const { text } = await deck({ ...base, shading_loss_pct: 4.5 }, { shadow: img });
  assert.ok(text.includes("higher than the 3% design limit"));
});

test("the HTC logo sits inside the chosen corner of each 3D view", async () => {
  const img = { bytes: readFileSync(new URL("../data/htc_logo.jpg", import.meta.url)), ext: "jpeg", width: 1000, height: 700 };
  const { zip } = await deck(base, { structure: { ...img, logoCorner: "br" }, structure2: { ...img, logoCorner: "tl" } });
  const files = Object.keys(zip.files).filter((n) => /^ppt\/slides\/slide\d+\.xml$/.test(n));
  let xml = "";
  for (const f of files) { const x = await zip.file(f).async("string"); if (x.includes('name="Image structure2"')) xml = x; }
  const box = (name) => {
    const pic = xml.split("<p:pic>").find((p) => p.includes(`name="${name}"`));
    const [, x, y] = pic.match(/<a:off x="(\d+)" y="(\d+)"/), [, w, h] = pic.match(/<a:xfrm>.*?<a:ext cx="(\d+)" cy="(\d+)"/);
    return { x: +x, y: +y, w: +w, h: +h };
  };
  const pairs = [["Image structure", "Picture 10", "br"], ["Image structure2", "Picture 1", "tl"]];
  for (const [image, logo, corner] of pairs) {
    const a = box(image), b = box(logo);
    assert.ok(b.x >= a.x && b.y >= a.y && b.x + b.w <= a.x + a.w && b.y + b.h <= a.y + a.h, `${logo} inside ${image}`);
    assert.ok(b.w <= a.w * 0.3 + 1);
    if (corner === "br") assert.ok(b.x > a.x + a.w / 2 && b.y > a.y + a.h / 2);
    else assert.ok(b.x < a.x + a.w / 2 && b.y < a.y + a.h / 2);
  }
});

test("schedule from the Gantt chart reaches the deck", async () => {
  const { DEFAULT_SCHEDULE } = await import("../js/offer/quick.js");
  const short = DEFAULT_SCHEDULE.map((a) => ({ ...a, start: 1, weeks: 3 }));
  short[5] = { ...short[5], name: "Install everything", start: 3, weeks: 5 };
  const { values, months, flow } = buildOfferValues(base, new Date("2026-03-05T00:00:00"));
  const out = await renderPptx(template, { values, months, flow, images: {}, schedule: short,
    moduleModel: base.module.model, inverterModel: base.inverter.model });
  const zip = await JSZip.loadAsync(out.bytes);
  let text = "";
  for (const f of Object.keys(zip.files).filter((n) => /^ppt\/slides\/slide\d+\.xml$/.test(n))) text += await zip.file(f).async("string");
  assert.ok(text.includes("Install everything"));
  assert.ok(!text.includes("All Installation (Mechanical"));
  assert.ok(text.includes(">W20<") && !text.includes(">W21<"), "slides for weeks past the schedule are dropped");
});

test("Helioscope report figures", async () => {
  const { parseReport } = await import("../js/offer/helioscope.js");
  // text as pdf.js reads it from a Helioscope (Aurora) annual production report
  const sim = `Design Design 1, 5L, Jinko 720Wp Module DC Nameplate 579.60 kW Inverter AC Nameplate 600.00 kW Load Ratio: 0.97
    Annual Production 986.8 MWh Performance Ratio 77.3% kWh/kWp 1,702.6 Sources of System Loss Shading Shading: 0.2%
    Component Name Count Inverters SG150CX (Sungrow) 4 (600.00 kW) Strings 10 AWG (Copper) 43 (3,436.1 m)
    Module Jinko Solar, JKM720N-66HL5- BDV-Z6-EN (720W) 805 (579.60 kW) Components
    Description Racking Orientation Tilt Azimuth Intrarow Spacing Frame Size Frames Modules Power
    FS-1 Flush Mount Landscape (Horizontal) 5° 289.1991° 0.0 m 1x1 60 60 43.20 kW
    FS-3 Flush Mount Landscape (Horizontal) 5° 109.049515° 0.0 m 1x1 435 435 313.20 kW Field Segments`;
  const lib = { modules: [{ id: 1, model: "JKM720N-66HL5-BDV", wp: 720 }], inverters: [{ id: 2, model: "SG150CX", ac_kw: 150 }] };
  const r = parseReport(sim, lib);
  assert.deepEqual([r.dc_kwp, r.ac_kw, r.annual_gen_kwh, r.specific_yield, r.shading_loss_pct], [579.6, 600, 986800, 1702.6, 0.2]);
  assert.deepEqual([r.module_count, r.module_wp, r.inverter_qty, r.module_id, r.inverter_id], [805, 720, 4, 1, 2]);
  assert.deepEqual([r.tilt_deg, r.azimuth_deg, r.racking], [5, 109, "Flush Mount"]);
  assert.equal(r.pr_pct, 77.3);
  // the components table read out of order: the count lands inside the wrapped model name
  const shuffled = sim.replace("Module Jinko Solar, JKM720N-66HL5- BDV-Z6-EN (720W) 805 (579.60 kW)", "Module Jinko Solar, JKM720N-66HL5- 805 (579.60 BDV-Z6-EN (720W) kW)");
  const r2 = parseReport(shuffled, lib);
  assert.deepEqual([r2.module_count, r2.module_wp, r2.module_id], [805, 720, 1]);
  // no components table: the field segments' modules are added up
  assert.equal(parseReport(sim.replace(/Component Name[\s\S]*?Components/, "")).module_count, 60 + 435);
  const shade = "Totals, weighted by kWp 805 579.6 kWp 2,199.5kWh/m 986.8 MWh 91.4% 96.5% 91.2%";
  assert.equal(parseReport(shade).shading_loss_pct, 3.5);
});

test("Helioscope pictures: which slot they suit", async () => {
  const { suggestSlot } = await import("../js/offer/helioscope.js");
  const shading = "Shading Report produced by Aurora Solar Design 1 Shading Heatmap", sim = "Annual Production Report produced by Aurora";
  assert.equal(suggestSlot(shading, "Design 1, 5L Shading Heatmap Shading by Field Segment"), "shadow");
  assert.equal(suggestSlot(shading, "Solar Access by Month Southeastern Angle"), null);
  assert.equal(suggestSlot(sim, "Detailed Layout2"), "site");
  assert.equal(suggestSlot(sim, "Report Project Location System Metrics"), null);
});

test("degradation follows the module datasheet's linear warranty", async () => {
  const { toProject } = await import("../js/offer/quick.js");
  const module = { ...base.module, degradation_first_pct: 1, degradation_annual_pct: 0.4 };
  const { values } = buildOfferValues({ ...base, module }, new Date("2026-03-05T00:00:00"));
  assert.equal(values.Y1L, "0.0%");
  assert.equal(values.Y2L, "1.0%");
  assert.equal(values.Y25L, "10.2%");
  assert.equal(values.Degradation, "1% in the first year and 0.4");
  // a library entry loaded before the figures were recorded gets them from the built-in data
  const old = { id: 3, make: "Jinko Solar", model: "JKM720N-66HL5-BDV", wp: 720 };
  const p = toProject({ client_name: "X", module_id: 3, module_count: 10 }, { module: new Map([[3, old]]), inverter: new Map() });
  assert.equal(p.module.degradation_first_pct, 1);
  assert.equal(p.module.degradation_annual_pct, 0.4);
});

test("sub-systems: checked against the design, and a table slide in the deck", async () => {
  const { toProject, subsystemIssues } = await import("../js/offer/quick.js");
  const module = { ...base.module, id: 7, wp: 720 }, inverter = { ...base.inverter, id: 9, ac_kw: 150 };
  const lookup = { module: new Map([[7, module]]), inverter: new Map([[9, inverter]]), client: new Map() };
  const o = { client_name: "ADC", price_per_kwp: 300, module_id: 7, module_count: 805, inverter_id: 9, inverter_qty: 4, split_system: true,
              subsystems: [{ name: "POC 1", desc: "East roof", modules: 435, inverters: 2 }, { name: "POC 2", desc: "West roofs", modules: 370, inverters: 2 }] };
  assert.deepEqual(subsystemIssues(o, lookup), []);
  const off = subsystemIssues({ ...o, subsystems: [{ ...o.subsystems[0] }, { ...o.subsystems[1], modules: 365, inverters: 1 }] }, lookup);
  assert.equal(off.length, 2);
  assert.match(off[0], /800 PV modules.*805: 5 \(3\.6 kWp\) short/);
  assert.match(off[1], /3 inverters.*4: 1 \(150 kW AC\) short/);
  assert.deepEqual(subsystemIssues({ ...o, split_system: false, subsystems: [] }, lookup), []);

  const p = toProject(o, lookup);
  const { values, months, flow, subsystems } = buildOfferValues(p, new Date("2026-03-05T00:00:00"));
  const render = async (rows) => {
    const out = await renderPptx(template, { values, months, flow, subsystems: rows, images: {}, moduleModel: module.model, inverterModel: inverter.model });
    const zip = await JSZip.loadAsync(out.bytes);
    let text = "";
    for (const f of Object.keys(zip.files).filter((n) => /^ppt\/slides\/slide\d+\.xml$/.test(n))) text += await zip.file(f).async("string");
    return text;
  };
  const text = await render(subsystems);
  assert.ok(text.includes("System Breakdown"));
  for (const t of ["POC 1", "East roof", "435", "313.2", "POC 2", "266.4", "300", "579.6", "805", "600"]) assert.ok(text.includes(`>${t}<`), t);
  assert.ok(!/\{\{SS_/.test(text));
  assert.ok(!(await render([])).includes("System Breakdown"), "no slide when the system isn't split");
});

test("schedule rows follow the Gantt chart: added activities get rows", async () => {
  const { DEFAULT_SCHEDULE } = await import("../js/offer/quick.js");
  const many = [...DEFAULT_SCHEDULE.map((a) => ({ name: a.name, start: a.start, weeks: a.weeks })),
    { name: "Snag list", start: 18, weeks: 2 }, { name: "Training", start: 19, weeks: 1 }, { name: "Extra works", start: 5, weeks: 3 }];
  const { values, months, flow } = buildOfferValues(base, new Date("2026-03-05T00:00:00"));
  const out = await renderPptx(template, { values, months, flow, images: {}, schedule: many, moduleModel: base.module.model, inverterModel: base.inverter.model });
  const zip = await JSZip.loadAsync(out.bytes);
  const slides = [];
  for (const f of Object.keys(zip.files).filter((n) => /^ppt\/slides\/slide\d+\.xml$/.test(n))) {
    const x = await zip.file(f).async("string");
    if (x.includes(">W1<") || x.includes(">W21<")) slides.push(x);
  }
  const first = slides.find((x) => x.includes(">W1<"));
  for (const t of ["Snag list", "Training", "Extra works"]) assert.ok(first.includes(`>${t}<`), t);
  assert.ok(first.includes(">11<"), "activities are numbered in order");
  const ids = [...first.matchAll(/a16:rowId [^>]*val="(\d+)"/g)].map((m) => m[1]);
  assert.equal(new Set(ids).size, ids.length, "row ids stay unique");
});
