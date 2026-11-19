// Read the iSolarCloud "Monthly report" export (.xlsx) in the browser.
//
// The export has a title row ("Monthly report_Year_2026"), then a header row
// (Plant name | Time | Monthly yield(kWh) | PR(%) | Plant monthly irradiation(Wh/㎡)),
// then one row per month ("2026-01" … "2026-12"); months without data are blank.
//
//   const exp = await readExport(arrayBuffer);
//   // { plant: "MoHUP", year: 2026, months: { "2026-04": { energy: 8299.4, pr: 28.45, irr: 76.06 }, … } }
//   // irr is in kWh/m² (the export gives Wh/m²)
//
// Uses the JSZip global (vendor/jszip.min.js in the page; tests set globalThis.JSZip).

function decode(s) {
  return s.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d))).replace(/&amp;/g, "&");
}

const textOf = (frag) => [...frag.matchAll(/<t(?:\s[^>]*)?>([\s\S]*?)<\/t>/g)].map((m) => decode(m[1])).join("");

/** Column letters -> 0-based index ("A" -> 0, "AB" -> 27). */
function colIndex(ref) {
  const letters = ref.replace(/\d+/g, "");
  let n = 0;
  for (const ch of letters) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n - 1;
}

/** Rows of the first worksheet as arrays of strings / numbers ("" for empty cells). */
export async function sheetRows(data) {
  const zip = await globalThis.JSZip.loadAsync(data);
  const shared = [];
  const sst = zip.file("xl/sharedStrings.xml");
  if (sst) for (const m of (await sst.async("string")).matchAll(/<si>([\s\S]*?)<\/si>/g)) shared.push(textOf(m[1]));
  // the first sheet in workbook order
  let path = "xl/worksheets/sheet1.xml";
  const wb = zip.file("xl/workbook.xml"), rels = zip.file("xl/_rels/workbook.xml.rels");
  if (wb && rels) {
    const first = (await wb.async("string")).match(/<sheet\b[^>]*\br:id="([^"]+)"/);
    const target = first && (await rels.async("string")).match(new RegExp(`<Relationship\\b[^>]*Id="${first[1]}"[^>]*Target="([^"]+)"`))
      || first && (await rels.async("string")).match(new RegExp(`<Relationship\\b[^>]*Target="([^"]+)"[^>]*Id="${first[1]}"`));
    if (target) path = target[1].startsWith("/") ? target[1].slice(1) : `xl/${target[1].replace(/^\.\//, "")}`;
  }
  const sheet = zip.file(path) || zip.file(/xl\/worksheets\/sheet\d+\.xml$/)[0];
  if (!sheet) throw new Error("This file has no worksheet.");
  const xml = await sheet.async("string");  // small and flat: read with regular expressions
  const rows = [];
  for (const rm of xml.matchAll(/<row\b[^>]*>([\s\S]*?)<\/row>|<row\b[^>]*\/>/g)) {
    const row = [];
    for (const cm of (rm[1] || "").matchAll(/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
      const attrs = cm[1], body = cm[2] || "";
      const ref = attrs.match(/\br="([A-Z]+\d+)"/);
      const type = (attrs.match(/\bt="(\w+)"/) || [])[1];
      const v = (body.match(/<v>([\s\S]*?)<\/v>/) || [])[1];
      let val = "";
      if (type === "s") val = shared[Number(v)] ?? "";
      else if (type === "inlineStr") val = textOf(body);
      else if (type === "str" || type === "e") val = v !== undefined ? decode(v) : "";
      else if (type === "b") val = v === "1";
      else if (v !== undefined && v !== "") val = Number(v);
      const i = ref ? colIndex(ref[1]) : row.length;
      while (row.length < i) row.push("");
      row[i] = val;
    }
    rows.push(row);
  }
  return rows;
}

const num = (v) => {
  if (v === "" || v === null || v === undefined) return null;
  const n = typeof v === "number" ? v : Number(String(v).replace(/,/g, "").trim());
  return Number.isFinite(n) ? n : null;
};

/** Normalise a "Time" cell to "YYYY-MM" (text "2026-04", "2026/4", or an Excel date serial). */
export function monthKey(v) {
  if (typeof v === "number" && v > 20000 && v < 80000) {
    const d = new Date(Math.round((v - 25569) * 86400000));
    return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
  }
  const m = String(v ?? "").trim().match(/^(\d{4})[-/.](\d{1,2})/);
  return m ? `${m[1]}-${m[2].padStart(2, "0")}` : null;
}

/** Find the columns by their header names; throws a readable error when they're missing. */
export function parseExportRows(rows) {
  const hi = rows.findIndex((r) => r.some((c) => /^time$/i.test(String(c).trim())));
  if (hi < 0) throw new Error("Couldn't find the header row (Plant name, Time, Monthly yield…). Is this the iSolarCloud monthly report?");
  const hdr = rows[hi].map((c) => String(c).trim().toLowerCase());
  const col = (re) => hdr.findIndex((h) => re.test(h));
  const ci = { plant: col(/^plant name/), time: col(/^time$/), energy: col(/yield/), pr: col(/^pr\b/), irr: col(/irradiation/) };
  if (ci.energy < 0) throw new Error("Couldn't find the Monthly yield (kWh) column.");
  const irrUnit = ci.irr >= 0 && /wh\/(m|㎡)/i.test(hdr[ci.irr]) && !/kwh/i.test(hdr[ci.irr]) ? 1000 : 1;
  const months = {};
  let plant = "";
  for (const r of rows.slice(hi + 1)) {
    const key = monthKey(r[ci.time]);
    if (!key) continue;
    if (!plant && ci.plant >= 0 && r[ci.plant]) plant = String(r[ci.plant]).trim();
    const energy = num(r[ci.energy]);
    if (energy === null) continue;  // a month without data yet
    months[key] = {
      energy,
      pr: ci.pr >= 0 ? num(r[ci.pr]) : null,
      irr: ci.irr >= 0 && num(r[ci.irr]) !== null ? num(r[ci.irr]) / irrUnit : null,
    };
  }
  const keys = Object.keys(months).sort();
  if (!keys.length) throw new Error("The file has no monthly generation figures.");
  const title = rows.slice(0, hi).flat().map(String).join(" ");
  const ty = title.match(/(19|20)\d{2}/);
  return { plant, year: ty ? Number(ty[0]) : Number(keys[keys.length - 1].slice(0, 4)), months };
}

/** Read an export file (ArrayBuffer / Uint8Array / Blob). */
export async function readExport(data) {
  return parseExportRows(await sheetRows(data));
}
