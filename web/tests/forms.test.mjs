// Standalone forms: each form asks for the inputs its template uses, and the inputs fill it.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import JSZip from "jszip";
import { DOMParser, XMLSerializer } from "@xmldom/xmldom";

globalThis.JSZip = JSZip;
globalThis.DOMParser = DOMParser;
globalThis.XMLSerializer = XMLSerializer;

const { FIELDS, fieldsFor, templateKeys, toProject, formTitle } = await import("../js/forms/fields.js");
const { renderDocx } = await import("../js/docgen/render.js");
const ctx = await import("../js/docgen/context.js");

const template = (name) => readFileSync(new URL(`../templates/${name}`, import.meta.url));
const TEMPLATES = ["nama_initial_form.docx", "nama_agency_contract.docx", "nama_design_above_11kw.docx",
                   "nama_design_below_11kw.docx", "execution_agreement.docx"];

const VALUES = {
  client_name: "Test Client LLC", id_no: "1234567", mobile: "99112233", tel: "24000000", email: "a@b.om",
  governorate: "Muscat", wilaya: "Seeb", village: "Al Khoud", reference_code: "TC", account_no: "30012345",
  premises_type: "commercial", connection_type: "self", mounting: "rooftop", project_area_m2: "250",
  installation_type: "Elevated Flat Roof", elevation_m: "2", agency_date: "2026-11-02",
  module_make: "Jinko Solar", module_model: "JKM620N", module_technology: "N-type", module_wp: "620",
  module_dims: "2465 × 1134 × 30", module_count: "40", strings: "2", tilt_deg: "10", azimuth_deg: "180",
  inverter_make: "Sungrow", inverter_model: "SG20RT", inverter_kw: "20", inverter_qty: "1", phases: "3",
  internal_transformer: false, annual_gen_kwh: "45000", degradation_pct: "0.5", subtotal_omr: "9500",
  tariff_bz: "32", tariff_note: "third slab",
};

test("every placeholder in every template is fed by an input", async () => {
  const fed = new Set(FIELDS.flatMap((f) => f.feeds));
  // Filled from the date the form is made.
  const automatic = new Set(["Today"]);
  for (const name of TEMPLATES) {
    for (const key of await templateKeys(template(name))) {
      if (key.startsWith("img:") || automatic.has(key)) continue;
      if (key.startsWith("if:")) { assert.ok(fed.has(key), `${name}: ${key} has no input`); continue; }
      assert.ok(fed.has(key), `${name}: {{${key}}} has no input`);
    }
  }
});

test("each form asks only for what its template uses", async () => {
  const agency = fieldsFor(await templateKeys(template("nama_agency_contract.docx"))).map((f) => f.key);
  assert.ok(agency.includes("client_name") && agency.includes("account_no"));
  assert.ok(!agency.includes("consultant_id") && !agency.includes("subtotal_omr"));
  const initial = fieldsFor(await templateKeys(template("nama_initial_form.docx"))).map((f) => f.key);
  assert.ok(initial.includes("consultant_id") && initial.includes("premises_type"));
  assert.ok(!initial.includes("subtotal_omr"));
});

test("inputs fill the template with nothing missing", async () => {
  const p = toProject(VALUES);
  for (const name of TEMPLATES) {
    const out = await renderDocx(template(name), { values: ctx.buildValues(p), flags: ctx.buildFlags(p), images: {} });
    assert.deepEqual([...out.missing], [], name);
  }
  const values = ctx.buildValues(p);
  assert.equal(values.Capacity, "24.8");
  assert.equal(values.InverterCap, "20");
  assert.equal(values.ModuleDims, "2465 × 1134 × 30 mm");
  assert.equal(values.Name, "Test Client LLC");
});

test("the New Connection form follows the AC capacity", () => {
  assert.match(formTitle("design", { inverter_kw: "20", inverter_qty: "1" }), /above 11 kW/);
  assert.match(formTitle("design", { inverter_kw: "5", inverter_qty: "2" }), /11 kW and below/);
  assert.equal(ctx.templateFor("design", toProject({ inverter_kw: "11", inverter_qty: "1" })), "nama_design_below_11kw.docx");
});
