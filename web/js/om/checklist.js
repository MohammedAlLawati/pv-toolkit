// Read a filled-in site checklist (.docx made by buildChecklist in report.js) back into data.
//
//   const cl = await readChecklist(arrayBuffer, "2026-11");
//   // { ref, visit_date, visit_type, weather, inspected_by, reviewed_by,
//   //   items:    [{ no, item, date, status: "OK" | "Not OK" | "N/A" | "", remarks, photo }],
//   //   cleaning: [{ date, area, method, soiling, water, before, after, by }],
//   //   defects:  [{ no, item_no, description, severity, action, target, status }] }
//
// Tick boxes are Word check-box controls: ticked when <w14:checked w14:val="1"/> (or the box shows
// ☒ / ☑). A box replaced by a typed X, ✓ or ✔ in front of its label counts as ticked too.
// Uses the JSZip global.
import { parseDate } from "./model.js";
import { CL } from "./report.js";

const decode = (s) => s.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, "&");
const TICKED = new Set(["2612", "2611", "2713", "2714", "2715", "2716", "2717", "2718", "25A0", "25A3"]);

/** Split XML into top-level elements of one tag (no nesting of that tag inside, as in our tables). */
const parts = (xml, tag) => [...xml.matchAll(new RegExp(`<w:${tag}[ >][\\s\\S]*?</w:${tag}>`, "g"))].map((m) => m[0]);

/** A cell as { text, boxes: [bool] in order, labelled: { label: bool } }. */
function readCell(tc) {
  const boxes = [];
  let text = "";
  // walk runs and check boxes in document order
  const re = /<w:sdt>[\s\S]*?<\/w:sdt>|<w:t(?:\s[^>]*)?>([\s\S]*?)<\/w:t>|<w:tab\/>|<\/w:p>/g;
  let m;
  const tokens = [];
  while ((m = re.exec(tc))) {
    if (m[0].startsWith("<w:sdt>")) {
      const cb = m[0].includes("w14:checkbox");
      if (cb) {
        const val = (m[0].match(/<w14:checked w14:val="(\w+)"/) || [])[1];
        const sym = (m[0].match(/<w:sym [^>]*w:char="([0-9A-Fa-f]+)"/) || [])[1];
        const glyph = (m[0].match(/<w:t(?:\s[^>]*)?>([\s\S]*?)<\/w:t>/) || [])[1] || "";
        const on = val === "1" || val === "true" || (sym && TICKED.has(sym.toUpperCase())) || /[☒☑✓✔✗✘■]/.test(glyph);
        boxes.push(on);
        tokens.push({ box: boxes.length - 1 });
      } else {
        const t = [...m[0].matchAll(/<w:t(?:\s[^>]*)?>([\s\S]*?)<\/w:t>/g)].map((x) => decode(x[1])).join("");
        tokens.push({ text: t });
        text += t;
      }
    } else if (m[0] === "</w:p>") { tokens.push({ text: "\n" }); text += "\n"; }
    else if (m[0] === "<w:tab/>") { tokens.push({ text: " " }); text += " "; }
    else { const t = decode(m[1]); tokens.push({ text: t }); text += t; }
  }
  return { text: text.replace(/\n+$/, "").trim(), boxes, tokens };
}

/** Which of `labels` is ticked in a cell: Word boxes first, else a typed X / ✓ before a label, else a lone label. */
function choice(c, labels) {
  if (c.boxes.length === labels.length && c.boxes.some(Boolean)) {
    const picked = labels.filter((_, i) => c.boxes[i]);
    if (picked.length > 1 && picked.includes("Not OK")) return "Not OK";   // a problem ticked is a problem
    return picked.length === 1 ? picked[0] : picked.join(" / ");
  }
  const t = c.text.replace(/[☐□]/g, "").replace(/\s+/g, " ").trim();
  if (!t) return "";
  // "X OK", "✓ Not OK", "[x] N/A"
  for (const l of [...labels].sort((a, b) => b.length - a.length)) {
    const esc = l.replace(/[.*+?^${}()|[\]\\/]/g, "\\$&");
    if (new RegExp(`(?:^|\\s)(?:[xX✓✔☒☑■]|\\[[xX]\\])\\s*${esc}(?:\\s|$)`).test(t)) return l;
  }
  // only one label left in the cell (the others deleted), or the label typed on its own
  const left = labels.filter((l) => new RegExp(`(?:^|\\s)${l.replace(/[.*+?^${}()|[\]\\/]/g, "\\$&")}(?:\\s|$)`, "i").test(t));
  const exact = labels.find((l) => l.toLowerCase() === t.toLowerCase());
  if (exact) return exact;
  if (left.length === 1 && !(left[0] === "OK" && /not\s*ok/i.test(t))) return left[0];
  if (/not\s*ok/i.test(t) && labels.includes("Not OK") && !/(^|\s)ok(\s|$)/i.test(t.replace(/not\s*ok/ig, ""))) return "Not OK";
  return "";
}

const clean = (s) => String(s || "").replace(/^[_\s/.-]+$/, "").replace(/\s+\n/g, "\n").trim();

function tableRows(tbl) { return parts(tbl, "tr").map((tr) => parts(tr, "tc").map(readCell)); }

/** Read the filled checklist. `month` ("YYYY-MM") completes dates typed without a year. */
export async function readChecklist(data, month = "") {
  const zip = await globalThis.JSZip.loadAsync(data);
  const doc = zip.file("word/document.xml");
  if (!doc) throw new Error("This isn't a Word file.");
  const xml = await doc.async("string");
  const tables = parts(xml, "tbl").map(tableRows);
  const head = (rows) => rows[0]?.map((c) => c.text.toLowerCase()) || [];
  const find = (want) => tables.find((rows) => want.every((w) => head(rows).some((h) => h.startsWith(w))));
  const out = { ref: "", visit_date: "", visit_type: "", weather: "", inspected_by: "", reviewed_by: "", items: [], cleaning: [], defects: [] };

  // header block: label | value | label | value
  const hdr = tables.find((rows) => rows.some((r) => r[0]?.text.toLowerCase().startsWith("checklist ref")));
  if (!hdr && !find(["no.", "inspection item"])) throw new Error("This doesn't look like the O&M site checklist made by this page.");
  for (const r of hdr || []) {
    for (let i = 0; i + 1 < r.length; i += 2) {
      const k = r[i].text.toLowerCase(), v = r[i + 1];
      if (k.startsWith("checklist ref")) out.ref = clean(v.text).replace(/^CL-[_-]+$/, "");
      else if (k.startsWith("visit date")) out.visit_date = parseDate(clean(v.text), month);
      else if (k.startsWith("visit type")) out.visit_type = choice(v, CL.visit);
      else if (k.startsWith("weather")) out.weather = clean(v.text);
      else if (k.startsWith("inspected by")) out.inspected_by = clean(v.text);
      else if (k.startsWith("reviewed by")) out.reviewed_by = clean(v.text);
    }
  }
  const items = find(["no.", "inspection item"]);
  for (const r of (items || []).slice(1)) {
    if (r.length < 7 || !/^\d+$/.test(r[0].text)) continue;
    out.items.push({
      no: Number(r[0].text), item: r[1].text, frequency: r[2].text,
      date: parseDate(clean(r[3].text), month) || (out.visit_date && clean(r[3].text) ? "" : ""),
      date_text: clean(r[3].text),
      status: choice(r[4], CL.status), remarks: clean(r[5].text), photo: clean(r[6].text),
    });
  }
  const cleaning = find(["date", "area"]);
  for (const r of (cleaning || []).slice(1)) {
    if (r.length < 8) continue;
    const row = { date: parseDate(clean(r[0].text), month), date_text: clean(r[0].text), area: clean(r[1].text), method: choice(r[2], CL.method),
      soiling: choice(r[3], CL.level), water: clean(r[4].text), before: clean(r[5].text), after: clean(r[6].text), by: clean(r[7].text) };
    if (row.date_text || row.area || row.by || row.water) out.cleaning.push(row);
  }
  const defects = find(["no.", "item no"]);
  for (const r of (defects || []).slice(1)) {
    if (r.length < 7) continue;
    const row = { no: clean(r[0].text), item_no: clean(r[1].text).replace(/\D+/g, ""), description: clean(r[2].text), severity: choice(r[3], CL.level),
      action: clean(r[4].text), target: clean(r[5].text), status: clean(r[6].text) };
    if (row.description || row.action) out.defects.push(row);
  }
  return out;
}

const SEV = { Low: "Low", Med: "Medium", High: "High" };

/**
 * What the report takes from a read checklist: visits for the maintenance log, and findings
 * (Not OK items, joined with the Defects table by item number, plus defects for other items).
 */
export function fromChecklist(cl, month = "") {
  const visits = [];
  const inMonth = (d) => d && (!month || d.slice(0, 7) === month);
  const cleanDates = new Set(cl.cleaning.map((c) => c.date).filter(Boolean));
  if (cl.visit_date) {
    const both = cleanDates.has(cl.visit_date);
    visits.push({ date: cl.visit_date, activity: both ? "Cleaning and general inspection" : `${cl.visit_type && !cl.visit_type.includes("/") ? `${cl.visit_type} ` : ""}inspection (checklist)`.replace(/^./, (c) => c.toUpperCase()),
      scope: both ? cl.cleaning.filter((c) => c.date === cl.visit_date).map((c) => c.area).filter(Boolean).join(", ") || "Checklist sections A to G" : "Checklist sections A to G",
      by: cl.inspected_by, ref: cl.ref });
  }
  for (const c of cl.cleaning) {
    if (!c.date || c.date === cl.visit_date || visits.some((v) => v.date === c.date)) continue;
    visits.push({ date: c.date, activity: "Module cleaning", scope: c.area, by: c.by, ref: cl.ref });
  }
  const findings = [];
  const defectFor = (no) => cl.defects.find((d) => d.item_no && Number(d.item_no) === no);
  for (const it of cl.items.filter((x) => x.status === "Not OK")) {
    const d = defectFor(it.no);
    findings.push({ item_no: String(it.no), finding: d?.description || it.remarks || it.item, severity: SEV[d?.severity] || "Medium",
      action: d?.action || "", status: /closed|done|fixed|complete/i.test(d?.status || "") ? "Closed" : "Open", from_checklist: true });
  }
  for (const d of cl.defects) {
    if (d.item_no && findings.some((f) => f.item_no === d.item_no)) continue;
    findings.push({ item_no: d.item_no, finding: d.description || d.action, severity: SEV[d.severity] || "Medium", action: d.action,
      status: /closed|done|fixed|complete/i.test(d.status) ? "Closed" : "Open", from_checklist: true });
  }
  const counts = { OK: 0, "Not OK": 0, "N/A": 0, blank: 0 };
  for (const it of cl.items) counts[it.status in counts ? it.status : "blank"]++;
  return { visits: visits.filter((v) => inMonth(v.date)), outside: visits.filter((v) => !inMonth(v.date)), findings, counts };
}
