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

test("quick offer: capacities, price and a client name make a whole deck", async () => {
  const { toProject, annualKwh, quickMissing } = await import("../js/offer/quick.js");
  const module = { ...base.module, id: 7 }, inverter = { ...base.inverter, id: 9 };
  const lookup = { module: new Map([[7, module]]), inverter: new Map([[9, inverter]]), client: new Map() };
  const o = { client_name: "Al Noor Trading", dc_kwp: 148.8, ac_kw: 125, subtotal_omr: 52000, module_id: 7, inverter_id: 9,
              tariff_bz: 32, degradation_pct: 0.65, specific_yield: 1650 };
  assert.deepEqual(quickMissing(o), []);
  assert.deepEqual(quickMissing({ ...o, subtotal_omr: null, client_name: "" }), ["Client name", "Price"]);
  assert.equal(annualKwh(o).kwh, 148.8 * 1650);
  assert.equal(annualKwh({ ...o, annual_gen_kwh: 250000 }).source, "annual");

  const p = toProject(o, lookup);
  assert.equal(p.module_count, Math.round(148800 / module.wp));
  assert.equal(p.inverter_qty, Math.max(1, Math.round(125 / inverter.ac_kw)));
  const { text, values } = await deck(p);
  assert.equal(values.DCCapacity, "148.8");     // stated capacity, not module count × Wp
  assert.equal(values.ACCapacity, "125");
  assert.equal(values.Name, "Al Noor Trading");
  assert.equal(values.AnnualGenKWh, "245,520");
  assert.ok(values.PaybackText && values.ROI && values.CO2Tonnes);
  assert.ok(!/\{\{\w+\}\}/.test(text), "no placeholder left unfilled");
  assert.ok(text.includes("Al Noor Trading"));
});

test("Helioscope report text: system figures and named equipment", async () => {
  const { parseReport } = await import("../js/offer/helioscope.js");
  const text = `System Metrics Design Design 1 Module DC Nameplate 148.2 kWp Inverter AC Nameplate 125.0 kW Load Ratio: 1.19
    Annual Production 245.6 MWh Performance Ratio 80.1% kWh/kWp 1,657.2 Weather Dataset TMY, 10km grid
    Components Inverters SG125CX-P2 (Sungrow) 1 (125.0 kW) Module Jinko Solar, JKM620N-78HL4-BDV (620W) 239 (148.2 kW)`;
  const f = parseReport(text, { modules: [{ id: 1, model: "JKM620N-78HL4-BDV" }, { id: 2, model: "JKM620N" }],
                                inverters: [{ id: 5, model: "SG125CX-P2" }, { id: 6, model: "SG150CX" }] });
  assert.deepEqual(f, { dc_kwp: 148.2, ac_kw: 125, annual_gen_kwh: 245600, specific_yield: 1657.2, module_id: 1, inverter_id: 5 });
  assert.deepEqual(parseReport("Module DC Nameplate 1.25 MWp Annual Production 2,010.5 MWh"), { dc_kwp: 1250, annual_gen_kwh: 2010500 });
});
