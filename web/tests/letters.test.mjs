// Letter builder checks:  node --test web/tests/
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildLetter } from "../js/letters/builder.js";
import { BLANK, TEMPLATES } from "../js/letters/defaults.js";

const fonts = ["Regular", "Bold"].map((w) =>
  readFileSync(new URL(`../fonts/NotoNaskhArabic-${w}.ttf`, import.meta.url)));

async function documentXml(...args) {
  const buf = await buildLetter(...args);
  const path = join(mkdtempSync(join(tmpdir(), "letter-")), "x.docx");
  writeFileSync(path, buf);
  return execFileSync("unzip", ["-p", path, "word/document.xml"]).toString();
}

const opts = { letterhead: {}, fonts, output: "buffer" };

test("every built-in letter builds blank, with no leftover markup", async () => {
  for (const key of Object.keys(TEMPLATES)) for (const lang of ["en", "ar"]) {
    const xml = await documentXml(key, lang, {}, opts);
    assert.ok(xml.includes(BLANK), `${key}/${lang} shows blanks`);
    assert.ok(xml.includes("1665626"), `${key}/${lang} has HTC's C.R.`);
    assert.ok(!/\{\{|\[\[/.test(xml), `${key}/${lang} has no placeholders left`);
  }
});

test("values land in the tables, not the sentences", async () => {
  const xml = await documentXml("nedc_commercial", "en", {
    ClientName: "Acme L.L.C.", CRNo: "777", SignatoryName: "Ahmed", SignatoryID: "0987",
    Date: "27 October 2026", points: [{ account_no: "A-1" }, { account_no: "A-2", location: "Shop" }],
  }, opts);
  for (const s of ["Acme L.L.C.", "777", "Ahmed", "0987", "27 October 2026", "A-1", "A-2", "Shop"]) {
    assert.ok(xml.includes(s), s);
  }
  assert.ok(!xml.includes("A-1, A-2") && !xml.includes("Meter No."));
  assert.ok(!xml.includes("Ref:"));
});

test("Arabic letters are right to left", async () => {
  const xml = await documentXml("nedc_residential", "ar", { ClientName: "سالم الرواحي" }, opts);
  assert.ok(xml.includes("سالم الرواحي") && xml.includes("شركة نماء لتوزيع الكهرباء"));
  assert.ok(xml.includes("<w:bidi/>") && xml.includes("<w:bidiVisual/>") && xml.includes("<w:rtl/>"));
});
