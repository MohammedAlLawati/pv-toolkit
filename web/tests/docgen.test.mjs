// The browser document generator must give the same documents as app/docgen (Python).
// Fixture: web/tests/fixtures/docgen_cases.json, made by tools/make_docgen_fixture.py.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import JSZip from "jszip";
import { DOMParser, XMLSerializer } from "@xmldom/xmldom";

globalThis.JSZip = JSZip;
globalThis.DOMParser = DOMParser;
globalThis.XMLSerializer = XMLSerializer;

const { renderDocx } = await import("../js/docgen/render.js");
const ctx = await import("../js/docgen/context.js");

const cases = JSON.parse(readFileSync(new URL("./fixtures/docgen_cases.json", import.meta.url)));
const W = "http://schemas.openxmlformats.org/wordprocessingml/2006/main";
const WP = "http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing";

async function summary(bytes) {
  const zip = await JSZip.loadAsync(bytes);
  const root = new DOMParser().parseFromString(await zip.file("word/document.xml").async("string"), "application/xml");
  const paras = Array.from(root.getElementsByTagNameNS(W, "p"));
  const text = paras.map((p) => Array.from(p.getElementsByTagNameNS(W, "t")).map((t) => t.textContent).join("")).join("\n");
  const shapes = Array.from(root.getElementsByTagNameNS(WP, "docPr")).map((d) => d.getAttribute("descr") || "");
  return { text, shapes };
}

const template = (name) => readFileSync(new URL("../templates/" + name, import.meta.url));

for (const c of cases) {
  const p = c.project;
  test(`values and flags: ${p.name}`, () => {
    const today = new Date(c.today + "T00:00:00");
    assert.deepEqual(ctx.buildValues(p, today), c.values);
    assert.deepEqual(ctx.buildFlags(p), c.flags);
  });

  for (const [key, want] of Object.entries(c.docs)) {
    test(`${key}: ${p.name}`, async () => {
      assert.equal(ctx.templateFor(key, p), want.template);
      assert.equal(ctx.docFilename(key, p), want.filename);
      assert.deepEqual(ctx.missingFields(key, p), want.missing_fields);
      const out = await renderDocx(template(want.template), { values: c.values, flags: c.flags, images: {} });
      assert.deepEqual(out.missing.sort(), want.missing);
      const got = await summary(out.bytes);
      assert.deepEqual(got.shapes, want.shapes);
      assert.equal(got.text, want.text);
      assert.ok(!got.text.includes("{{"));
    });
  }
}

test("stamp image is fitted into its slot", async () => {
  const c = cases[0];
  // 1x1 PNG, pretend it is 400 x 200 so the fit is easy to check
  const png = Uint8Array.from(atob("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg=="), (ch) => ch.charCodeAt(0));
  const img = { bytes: png, ext: "png", width: 400, height: 200 };
  const name = c.docs.initial.template;
  const out = await renderDocx(template(name), { values: c.values, flags: c.flags,
                                                 images: { consultant_stamp: img, contractor_stamp: img } });
  const zip = await JSZip.loadAsync(out.bytes);
  assert.ok(zip.file("word/media/filled1.png"));
  const xml = await zip.file("word/document.xml").async("string");
  const root = new DOMParser().parseFromString(xml, "application/xml");
  const stamps = Array.from(root.getElementsByTagNameNS(WP, "docPr")).filter((d) => /^img:/.test(d.getAttribute("descr")));
  assert.ok(stamps.length >= 1, "template has stamp slots");
  for (const d of stamps) {
    const ext = d.parentNode.getElementsByTagNameNS(WP, "extent")[0];
    const cx = Number(ext.getAttribute("cx")), cy = Number(ext.getAttribute("cy"));
    assert.ok(Math.abs(cx / cy - 2) < 0.01, `aspect kept (${cx} x ${cy})`);
  }
});
