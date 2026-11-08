// Residential offers: the inputs work out the system and price and fill the Execution Agreement.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import JSZip from "jszip";
import { DOMParser, XMLSerializer } from "@xmldom/xmldom";

globalThis.JSZip = JSZip;
globalThis.DOMParser = DOMParser;
globalThis.XMLSerializer = XMLSerializer;

const R = await import("../js/residential/offer.js");
const { renderDocx } = await import("../js/docgen/render.js");
const ctx = await import("../js/docgen/context.js");

const module = { id: 1, make: "Jinko Solar", model: "JKM620N-66HL4M-BDV", technology: "N-type TOPCon bifacial", wp: 620,
                 degradation_first_pct: 1, degradation_annual_pct: 0.4 };
const inverters = [
  { id: 10, make: "Sungrow", model: "SG10RT", ac_kw: 10, category: "residential" },
  { id: 11, make: "Sungrow", model: "SG12RT", ac_kw: 12, category: "residential" },
  { id: 12, make: "Sungrow", model: "SG110CX", ac_kw: 110, category: "commercial" },
];
const lookup = { module: new Map([[1, module]]), inverter: new Map(inverters.map((i) => [i.id, i])) };
const parties = [{ id: 5, kind: "contractor", name: "HTC", address: "Muscat", phone: "24000000", email: "info@htc.om" }];

const OFFER = { ...R.RESIDENTIAL_DEFAULTS, client_name: "Ahmed Al Balushi", account_no: "30012345", wilaya: "Seeb",
                mobile: "99112233", installation_type: "Elevated Flat Roof", elevation_m: 2,
                module_id: 1, modules: 18, inverter_id: 10, inverter_qty: 1, price_per_kwp: 300, contractor_id: 5 };

test("totals: capacities, price with VAT, generation estimate and payback", () => {
  const t = R.totals(OFFER, lookup);
  assert.equal(t.dc, 11.16);
  assert.equal(t.ac, 10);
  assert.equal(t.band, "ok");
  assert.equal(t.subtotal, 3348);
  assert.equal(t.vat, 167.4);
  assert.equal(t.total, 3515.4);
  assert.equal(t.kwhSource, "yield");
  assert.equal(t.kwh, Math.round(11.16 * 1650));
  assert.equal(t.degradation.pct, 0.4);       // from the module datasheet
  assert.ok(Math.abs(t.payback - 3515.4 / ((t.kwh * 32) / 1000)) < 1e-9);
  assert.equal(R.totals({ ...OFFER, annual_gen_kwh: 19000, degradation_pct: 0.55 }, lookup).kwh, 19000);
  assert.equal(R.totals({ ...OFFER, degradation_pct: 0.55 }, lookup).degradation.pct, 0.55);
});

test("suggestions: one residential model within the DC/AC limits", () => {
  const s = R.suggestions(11.16, inverters);
  assert.ok(s.length > 0);
  for (const x of s) {
    assert.ok(x.ratio >= 0.8 - 1e-9 && x.ratio <= 1.25 + 1e-9, x.label);
    assert.notEqual(x.inverter_id, 12);
  }
  assert.equal(s[0].qty, 1);
});

test("panelsFor rounds up", () => {
  assert.equal(R.panelsFor(10, 620), 17);
  assert.equal(R.panelsFor(12.4, 620), 20);
});

test("missing lists what the document still needs", () => {
  assert.deepEqual(R.missing(OFFER, lookup), []);
  assert.deepEqual(R.missing({ ...OFFER, account_no: "", price_per_kwp: null }, lookup), ["Meter account number", "Price per kWp"]);
  assert.match(R.ratioIssue({ ...OFFER, modules: 30 }, lookup), /outside/);
});

test("fills every placeholder of the Execution Agreement", async () => {
  const p = R.toProject(OFFER, lookup, parties);
  const v = ctx.buildValues(p);
  const out = await renderDocx(readFileSync(new URL("../templates/execution_agreement.docx", import.meta.url)),
                               { values: v, flags: ctx.buildFlags(p), images: {} });
  assert.deepEqual([...out.missing], []);
  assert.equal(v.FirstName, "Ahmed Al Balushi");
  assert.equal(v.MeterNo, "30012345");
  assert.equal(v.DCCapacity, "11.16");
  assert.equal(v.ACCapacity, "10");
  assert.equal(v.InverterDescription, "Sungrow SG10RT");
  assert.equal(v.InstallationType, "Elevated Flat Roof (2m high)");
  assert.equal(v.Subtotal, "3,348.000");
  assert.equal(v.FinalPrice, "3,515.400");
  assert.equal(v.Degradation, "0.4");
  assert.equal(v.ContractorName, "HTC");
  assert.equal(R.filename(OFFER), "Residential_Offer_Ahmed_Al_Balushi.docx");
});
