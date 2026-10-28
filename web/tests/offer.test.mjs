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
