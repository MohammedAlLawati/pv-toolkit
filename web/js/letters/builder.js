// Build a letter (.docx) on the company letterhead, in the browser.
// Port of app/letters/builder.py: same layout, wording comes from defaults.js.
//
//   const blob = await buildLetter("nedc_commercial", "en", {
//     ClientName, CRNo, SignatoryName, SignatoryID,      // commercial
//     CivilID,                                           // residential
//     Location, Date,
//     points: [{ meter_no, account_no, location }],      // table rows
//   });
//
// Every value is optional: anything left empty prints as a line to fill in by hand.
// The letterhead images come from the user's one-time upload (store "files":
// letterhead_top / letterhead_bottom); without them the letter is on plain paper.

import {
  AlignmentType, BorderStyle, CharacterSet, Document, Footer, Header, ImageRun, LineRuleType, Packer, Paragraph,
  ShadingType, Table, TableCell, TableLayoutType, TableRow, TextRun, UnderlineType, VerticalAlign,
  WidthType,
} from "../../vendor/docx/docx.mjs";
import { BLANK, LABELS, getTemplate } from "./defaults.js";

const NAVY = "1F3A68";
const GREY = "595959";
const LABEL_FILL = "E8EDF5";
const FONT = "Calibri";
const FONT_AR = "Noto Naskh Arabic";  // embedded in Arabic letters, so Word shows it without installing
const AR_SIZE_BOOST = 1.5;            // Arabic reads smaller than Latin at the same point size
const FONT_FILES = ["NotoNaskhArabic-Regular.ttf", "NotoNaskhArabic-Bold.ttf"];

const cm = (v) => Math.round(v * 567);           // centimetres -> twips
const pt = (v) => Math.round(v * 20);            // points -> twips
const CONTENT_CM = 16.6;                         // A4 width minus 2.2 cm margins

// ---- values ------------------------------------------------------------------------------

function completeValues(lang, values) {
  const v = { ...values };
  v.CompanyName = LABELS[lang].company;
  const pts = values.points || [];
  v.MeterList = pts.map((p) => p.meter_no).filter(Boolean).join(", ");
  v.AccountList = pts.map((p) => p.account_no).filter(Boolean).join(", ");
  return v;
}

function fill(text, v) {
  return text.replace(/\{\{\s*([A-Za-z0-9_]+)\s*\}\}/g, (_, k) => v[k] || BLANK);
}

// ---- builders (each takes the letter context `c`) ----------------------------------------

function runs(c, text, { size = 10.5, bold = false, color, underline = false } = {}) {
  return [new TextRun({
    text,
    bold,
    size: Math.round(size * 2),
    color,
    underline: underline ? { type: UnderlineType.SINGLE } : undefined,
    font: c.rtl ? { ascii: FONT, hAnsi: FONT, cs: FONT_AR, eastAsia: FONT } : FONT,
    ...(c.rtl ? {
      rightToLeft: true, boldComplexScript: bold,
      sizeComplexScript: Math.round((size + AR_SIZE_BOOST) * 2),
    } : {}),
  })];
}

// text with **bold** markers -> runs
function textRuns(c, text, opts = {}) {
  return text.split("**")
    .map((t, i) => [t, i % 2 === 1])
    .filter(([t]) => t)
    .flatMap(([t, b]) => runs(c, t, { ...opts, bold: opts.bold || b }));
}

function para(c, text = "", { size = 10.5, bold = false, color, after = 6, align, underline } = {}) {
  return new Paragraph({
    children: text ? textRuns(c, text, { size, bold, color, underline }) : [],
    alignment: align,
    bidirectional: c.rtl || undefined,
    spacing: {
      before: 0, after: pt(after),
      // Arabic fonts have tall ascenders; a fixed line height keeps the page compact
      ...(c.rtl ? { line: pt((size + AR_SIZE_BOOST) * 1.5), lineRule: LineRuleType.EXACT }
        : { line: 264, lineRule: LineRuleType.AUTO }),
    },
  });
}

function gap(c, height) {
  return new Paragraph({
    children: [], bidirectional: c.rtl || undefined,
    spacing: { before: 0, after: 0, line: pt(height), lineRule: LineRuleType.EXACT },
  });
}

const NONE = { style: BorderStyle.NONE, size: 0, color: "FFFFFF" };
const NO_BORDERS = { top: NONE, bottom: NONE, left: NONE, right: NONE, insideHorizontal: NONE, insideVertical: NONE };
const line = (color = "A6A6A6", size = 4) => ({ style: BorderStyle.SINGLE, size, color });
const GRID = { top: line(), bottom: line(), left: line(), right: line(), insideHorizontal: line(), insideVertical: line() };

function cell(c, children, { width, fill, span, borders, align } = {}) {
  return new TableCell({
    children: Array.isArray(children) ? children : [cellPara(c, children, { align })],
    width: width ? { size: cm(width), type: WidthType.DXA } : undefined,
    columnSpan: span,
    shading: fill ? { fill, type: ShadingType.CLEAR, color: "auto" } : undefined,
    borders,
    verticalAlign: VerticalAlign.TOP,
    margins: { left: 100, right: 100 },
  });
}

function cellPara(c, text, { bold = false, size = 10, color, align, minLine } = {}) {
  return new Paragraph({
    children: text ? textRuns(c, text, { size, bold, color }) : [],
    alignment: align,
    bidirectional: c.rtl || undefined,
    spacing: {
      before: pt(2), after: pt(2),
      ...(minLine ? { line: pt(minLine), lineRule: LineRuleType.AT_LEAST }
        : c.rtl ? { line: pt((size + AR_SIZE_BOOST) * 1.5), lineRule: LineRuleType.EXACT } : {}),
    },
  });
}

function table(c, rows, widths, { borders = GRID } = {}) {
  return new Table({
    rows,
    width: { size: cm(widths.reduce((a, b) => a + b, 0)), type: WidthType.DXA },
    columnWidths: widths.map(cm),
    layout: TableLayoutType.FIXED,
    borders,
    visuallyRightToLeft: c.rtl || undefined,  // columns run right to left
  });
}

// ---- blocks ------------------------------------------------------------------------------

function blockDetails(c) {
  const { L, v } = c;
  const widths = c.rtl ? [3.4, 5.4, 3.6, 4.2] : [3.8, 5.8, 3.0, 4.0];
  const pairs = c.t.audience === "commercial"
    ? [[L.company_name, v.ClientName, L.cr, v.CRNo], [L.signatory, v.SignatoryName, L.signatory_id, v.SignatoryID]]
    : [[L.homeowner, v.ClientName, L.civil_id, v.CivilID]];
  const rows = pairs.map((r) => new TableRow({
    children: r.map((txt, j) => j % 2 === 0
      ? cell(c, [cellPara(c, txt, { bold: true })], { width: widths[j], fill: LABEL_FILL })
      : cell(c, [cellPara(c, txt || "")], { width: widths[j] })),
  }));
  rows.push(new TableRow({
    children: [
      cell(c, [cellPara(c, L.location, { bold: true })], { width: widths[0], fill: LABEL_FILL }),
      cell(c, [cellPara(c, v.Location || "")], { width: widths[1] + widths[2] + widths[3], span: 3 }),
    ],
  }));
  return [table(c, rows, widths), gap(c, 9)];
}

function blockPoints(c) {
  const { L, t } = c;
  let pts = (c.v.points || []).filter((p) => p.meter_no || p.account_no || p.location);
  let cols = [["meter_no", L.meter], ["account_no", L.account], ["location", L.place]];
  if (t.audience === "residential") cols = [cols[1], ["meter_no", L.meter_opt], cols[2]];
  let keep;
  if (pts.length) {
    // drop columns nobody filled in, but always keep the main number column
    keep = cols.filter(([k], i) => i === 0 || pts.some((p) => p[k]));
  } else {
    // nothing entered yet: empty rows to fill by hand
    keep = cols;
    pts = Array.from({ length: t.audience === "commercial" ? 3 : 2 }, () => ({}));
  }
  const total = CONTENT_CM - 1.2;
  const widths = keep.length === 3 ? [1.2, 4.4, 4.4, total - 8.8] : [1.2, ...keep.map(() => total / keep.length)];
  const white = "FFFFFF";
  const header = new TableRow({
    tableHeader: true,
    children: [L.no, ...keep.map(([, h]) => h)].map((h, j) =>
      cell(c, [cellPara(c, h, { bold: true, color: white })], { width: widths[j], fill: NAVY })),
  });
  const body = pts.map((p, n) => new TableRow({
    children: [
      cell(c, [cellPara(c, String(n + 1), { align: AlignmentType.CENTER })], { width: widths[0] }),
      ...keep.map(([k], j) => cell(c, [cellPara(c, p[k] || "", { minLine: 15 })], { width: widths[j + 1] })),
    ],
  }));
  return [table(c, [header, ...body], widths), gap(c, 9)];
}

function htcSignoff(c) {
  const { L, v } = c;
  return [
    para(c, L.faithfully, { after: 2 }),
    para(c, `${L.for} **${v.CompanyName}**`, { after: 10 }),
    ...["name", "designation", "signature"].map((k) => para(c, `**${L[k]}:**  ${BLANK}`, { after: 6, size: 9.5 })),
    para(c, `**${L.stamp}:**`, { after: 0, size: 9.5 }),
  ];
}

function confirmationBox(c) {
  const { L, v, t } = c;
  const who = t.audience === "commercial" ? L.client_box : L.owner_box;
  const date = L.date.replace(/:$/, "");
  const lines = t.audience === "commercial"
    ? [[L.signatory, v.SignatoryName], [L.id, v.SignatoryID], [L.signature, ""], [date, ""], [L.stamp, null]]
    : [[L.homeowner, v.ClientName], [L.civil_id, v.CivilID], [L.signature, ""], [date, ""]];
  const box = line(NAVY, 8);
  return {
    borders: { top: box, bottom: box, left: box, right: box },
    children: [
      cellPara(c, who, { bold: true, size: 9.5, color: NAVY }),
      para(c, fill(t.confirmation, v), { size: 9.5, after: 5 }),
      ...lines.map(([label, val]) => para(c,
        val === null ? `**${label}:**` : `**${label}:**  ${val || BLANK}`,
        { size: 9.5, after: val === null ? 22 : 5 })),
    ],
  };
}

function blockSignatures(c) {
  if (!c.t.confirmation.trim()) return blockHtcSignature(c);
  const box = confirmationBox(c);
  const row = new TableRow({
    cantSplit: true,
    children: [
      cell(c, htcSignoff(c), { width: 7.4, borders: NO_BORDERS }),
      cell(c, [gap(c, 1)], { width: 0.5, borders: NO_BORDERS }),
      cell(c, box.children, { width: 8.7, borders: box.borders }),
    ],
  });
  return [table(c, [row], [7.4, 0.5, 8.7], { borders: NO_BORDERS })];
}

function blockHtcSignature(c) {
  return [...htcSignoff(c), gap(c, 8)];
}

function blockClientSignature(c) {
  if (!c.t.confirmation.trim()) return [];
  const box = confirmationBox(c);
  const row = new TableRow({ cantSplit: true, children: [cell(c, box.children, { width: CONTENT_CM, borders: box.borders })] });
  return [table(c, [row], [CONTENT_CM], { borders: NO_BORDERS })];
}

const BLOCKS = {
  details: blockDetails,
  points: blockPoints,
  signatures: blockSignatures,
  htc_signature: blockHtcSignature,
  client_signature: blockClientSignature,
};

// ---- letterhead --------------------------------------------------------------------------

async function toBytes(x) {
  if (!x) return null;
  if (x instanceof Uint8Array) return x;
  if (x instanceof ArrayBuffer) return new Uint8Array(x);
  if (typeof Blob !== "undefined" && x instanceof Blob) return new Uint8Array(await x.arrayBuffer());
  if (x.data) return toBytes(x.data);  // a store record like { name, type, data }
  return null;
}

// Cut empty (white or transparent) rows off the top and bottom of a letterhead image,
// re-encoded as PNG. Returns { data, width, height } in pixels.
async function prepareImage(bytes) {
  if (typeof createImageBitmap === "undefined" || typeof OffscreenCanvas === "undefined") {
    return { data: bytes, ...pngSize(bytes) };  // no canvas (e.g. tests in Node): use as is
  }
  const bmp = await createImageBitmap(new Blob([bytes]));
  const canvas = new OffscreenCanvas(bmp.width, bmp.height);
  const g = canvas.getContext("2d");
  g.drawImage(bmp, 0, 0);
  const px = g.getImageData(0, 0, bmp.width, bmp.height).data;
  const inked = (y) => {
    for (let x = 0; x < bmp.width; x++) {
      const i = (y * bmp.width + x) * 4;
      const a = px[i + 3] / 255;
      const lum = (px[i] * 0.299 + px[i + 1] * 0.587 + px[i + 2] * 0.114) * a + 255 * (1 - a);
      if (255 - lum > 12) return true;
    }
    return false;
  };
  let top = 0, bottom = bmp.height - 1;
  while (top < bottom && !inked(top)) top++;
  while (bottom > top && !inked(bottom)) bottom--;
  top = Math.max(0, top - 4);
  bottom = Math.min(bmp.height - 1, bottom + 4);
  const h = bottom - top + 1;
  const out = new OffscreenCanvas(bmp.width, h);
  out.getContext("2d").drawImage(canvas, 0, top, bmp.width, h, 0, 0, bmp.width, h);
  const blob = await out.convertToBlob({ type: "image/png" });
  return { data: new Uint8Array(await blob.arrayBuffer()), width: bmp.width, height: h };
}

function pngSize(b) {
  // PNG IHDR holds width/height at bytes 16-23
  if (b.length > 24 && b[0] === 0x89 && b[1] === 0x50) {
    const dv = new DataView(b.buffer, b.byteOffset);
    return { width: dv.getUint32(16), height: dv.getUint32(20) };
  }
  return { width: 933, height: 185 };
}

async function letterheadPart(c, bytes, Kind) {
  if (!bytes) return new Kind({ children: [new Paragraph({ children: [] })] });
  const img = await prepareImage(bytes);
  const widthPx = ((CONTENT_CM + 4.0 - 0.6) / 2.54) * 96;  // images run almost edge to edge
  return new Kind({
    children: [new Paragraph({
      alignment: AlignmentType.CENTER,
      indent: { left: -cm(2.0), right: -cm(2.0) },
      spacing: { after: 0 },
      children: [new ImageRun({
        type: "png", data: img.data,
        transformation: { width: Math.round(widthPx), height: Math.round(widthPx * img.height / img.width) },
      })],
    })],
  });
}

async function loadLetterhead() {
  try {
    const store = await import("../store.js");
    const [top, bottom] = await Promise.all([store.getFile("letterhead_top"), store.getFile("letterhead_bottom")]);
    return { top, bottom };
  } catch {
    return {};
  }
}

async function loadArabicFonts() {
  return Promise.all(FONT_FILES.map(async (f) => {
    const r = await fetch(new URL(`../../fonts/${f}`, import.meta.url));
    if (!r.ok) throw new Error(`Couldn't load ${f}`);
    return new Uint8Array(await r.arrayBuffer());
  }));
}

// ---- document ----------------------------------------------------------------------------

/**
 * Build a letter. `template` is a key from defaults.js ("nedc_commercial") or a template
 * object { audience, recipient, subject, body, confirmation }.
 * opts: { letterhead: { top, bottom } } to skip the store, { fonts: [regular, bold] } to skip
 * fetching the Arabic font, { output: "blob" | "buffer" }.
 */
export async function buildLetter(template, lang = "en", values = {}, opts = {}) {
  const t = typeof template === "string" ? getTemplate(template, lang) : { lang, ...template };
  const rtl = lang === "ar";
  const L = LABELS[rtl ? "ar" : "en"];
  const v = completeValues(rtl ? "ar" : "en", values);
  const c = { t, L, v, rtl };

  const head = opts.letterhead || await loadLetterhead();
  const [top, bottom] = await Promise.all([toBytes(head.top), toBytes(head.bottom)]);

  const children = [];
  // date line (no reference number on these letters)
  const end = rtl ? AlignmentType.LEFT : AlignmentType.RIGHT;
  children.push(table(c, [new TableRow({
    children: [
      cell(c, [cellPara(c, v.Ref ? `**${L.ref}** ${v.Ref}` : "", { size: 10.5 })], { width: 8.3, borders: NO_BORDERS }),
      cell(c, [cellPara(c, `**${L.date}** ${v.Date || BLANK}`, { size: 10.5, align: end })], { width: 8.3, borders: NO_BORDERS }),
    ],
  })], [8.3, 8.3], { borders: NO_BORDERS }), gap(c, 6));

  const lines = fill(t.recipient, v).split("\n").filter((s) => s.trim());
  lines.forEach((ln, n) => children.push(para(c, ln, { after: 0, bold: n === lines.length - 2 && lines.length > 1 })));
  children.push(gap(c, 10));

  children.push(new Paragraph({
    children: [
      ...runs(c, `${L.subject} `, { bold: true, underline: true }),
      ...textRuns(c, fill(t.subject, v), { bold: true, underline: true }),
    ],
    bidirectional: rtl || undefined,
    spacing: { after: pt(8) },
  }));

  for (let chunk of t.body.trim().split(/\n\s*\n/)) {
    chunk = chunk.trim();
    const m = chunk.match(/^\[\[\s*([a-z_]+)\s*\]\]$/);
    if (m) {
      if (BLOCKS[m[1]]) children.push(...BLOCKS[m[1]](c));
      continue;
    }
    const text = fill(chunk, v);
    const ls = text.split("\n");
    if (ls.every((s) => s.trimStart().startsWith("- "))) {
      for (const s of ls) {
        children.push(new Paragraph({
          children: textRuns(c, "•  " + s.trimStart().slice(2)),
          bidirectional: rtl || undefined,
          indent: { start: cm(0.6), hanging: cm(0.4) },
          spacing: { after: pt(2) },
        }));
      }
      children.push(gap(c, 6));
    } else {
      children.push(para(c, ls.join(" "), { after: 7, align: AlignmentType.JUSTIFIED }));
    }
  }
  // the paragraph Word needs after a closing table: make it tiny so it can't spill a page
  children.push(gap(c, 1));

  const fonts = rtl ? (opts.fonts || await loadArabicFonts()) : null;
  const doc = new Document({
    creator: "PV Toolkit",
    title: fill(t.subject, v),
    styles: { default: { document: { run: { font: rtl ? { ascii: FONT, hAnsi: FONT, cs: FONT_AR } : FONT, size: 21 } } } },
    fonts: fonts ? [
      { name: FONT_AR, data: fonts[0], characterSet: CharacterSet.ARABIC },
    ] : undefined,
    sections: [{
      properties: {
        page: {
          size: { width: cm(21.0), height: cm(29.7) },
          margin: { top: cm(3.9), bottom: cm(2.9), left: cm(2.2), right: cm(2.2), header: cm(0.4), footer: cm(0.3) },
        },
      },
      headers: { default: await letterheadPart(c, top, Header) },
      footers: { default: await letterheadPart(c, bottom, Footer) },
      children,
    }],
  });
  return opts.output === "buffer" ? Packer.toBuffer(doc) : Packer.toBlob(doc);
}

export { getTemplate };
