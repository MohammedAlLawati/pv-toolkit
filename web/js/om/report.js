// Build the monthly O&M report and the site checklist (.docx) in the browser.
//
//   const blob = await buildReport({ report, site, calc, charts, photos, letterhead });
//   const blob = await buildChecklist({ site, letterhead });
//
// charts: { gen, pr, irr, co2, trees } as { data: Uint8Array (PNG), width, height } (optional,
//         left out when missing, e.g. in tests)
// photos: [{ label, before, after }] with each picture as { data, width, height } or null
// letterhead: { top, bottom } as { data, width, height } PNGs. They run edge to edge across the
//         page; without them the documents are on plain paper.
// opts.output: "blob" (default) or "buffer" (Node).

import {
  AlignmentType, BorderStyle, CheckBox, Document, HeightRule, LineRuleType, Footer, Header, ImageRun, LevelFormat, Packer, PageBreak, PageNumber,
  Paragraph, ShadingType, Table, TableCell, TableLayoutType, TableRow, TextRun, VerticalAlign, WidthType,
} from "../../vendor/docx/docx.mjs";
import { CHECKLIST, MONTHS, fmt, fmtDate, inverterText, isCleaning, isInspection, monthName, reportNo,
         EMISSION_FACTOR, TREE_KG } from "./model.js";

// HTC logo palette
const BLUE = "1650A6", CHARCOAL = "2C2E35", GREY = "5D6465";
const ZEBRA = "F3F4F4", TOTAL = "DCE3F2", SECTION = "E4E5E6", SAMPLE = "FFF59D", RULE = "C9CBCC";
const FONT = "Calibri";
const PAGE_W = 21.0, PAGE_H = 29.7, SIDE = 2.0;
const CONTENT = PAGE_W - 2 * SIDE;   // 17 cm

const cm = (v) => Math.round(v * 567);
const pt = (v) => Math.round(v * 20);
const px = (vcm) => (vcm / 2.54) * 96;

// ---- text --------------------------------------------------------------------------------

function run(text, { size = 10, bold = false, italic = false, color, highlight } = {}) {
  return new TextRun({ text: String(text ?? ""), size: Math.round(size * 2), bold, italics: italic, color, font: FONT,
    shading: highlight ? { type: ShadingType.CLEAR, fill: highlight, color: "auto" } : undefined });
}

function para(children, { after = 5, before = 0, align, keepNext = false, indent, border } = {}) {
  return new Paragraph({
    children: Array.isArray(children) ? children : [run(children)],
    alignment: align, keepNext, indent, border,
    spacing: { before: pt(before), after: pt(after), line: 264, lineRule: LineRuleType.AUTO },
  });
}

const text = (s, o = {}) => para([run(s, o)], o);
const note = (s) => para([run(s, { size: 8, italic: true, color: GREY })], { before: 2, after: 6 });

function h1(s) {
  return new Paragraph({
    children: [run(s, { size: 15, bold: true, color: BLUE })], keepNext: true,
    spacing: { before: pt(14), after: pt(8) },
    border: { bottom: { style: BorderStyle.SINGLE, size: 12, color: BLUE, space: 4 } },
  });
}
const h2 = (s) => para([run(s, { size: 11.5, bold: true, color: CHARCOAL })], { before: 10, after: 4, keepNext: true });
const bullet = (s) => new Paragraph({ children: [run(s)], numbering: { reference: "bullets", level: 0 }, spacing: { after: pt(3) } });
const pageBreak = () => new Paragraph({ children: [new PageBreak()] });

// ---- tables ------------------------------------------------------------------------------

const line = (color = RULE, size = 4) => ({ style: BorderStyle.SINGLE, size, color });
const GRID = { top: line(), bottom: line(), left: line(), right: line(), insideHorizontal: line(), insideVertical: line() };
const ALIGN = { L: AlignmentType.LEFT, C: AlignmentType.CENTER, R: AlignmentType.RIGHT };

function cell(content, { width, fill, align = "L", bold = false, color, size = 8.5, span, keepNext = false, italic = false } = {}) {
  const paras = (Array.isArray(content) ? content : [content]).map((c) => (c instanceof Paragraph ? c
    : new Paragraph({ children: [run(c, { size, bold, color, italic })], alignment: ALIGN[align], keepNext, spacing: { before: 0, after: 0 } })));
  return new TableCell({
    children: paras, columnSpan: span,
    width: width ? { size: cm(width), type: WidthType.DXA } : undefined,
    shading: fill ? { type: ShadingType.CLEAR, fill, color: "auto" } : undefined,
    verticalAlign: VerticalAlign.CENTER,
    margins: { top: 40, bottom: 40, left: 90, right: 90 },
  });
}

/**
 * header: [string], rows: [[string]], widths in cm. opts: total (row indexes), section (row
 * indexes: one merged label cell), sample (highlighted), bold (row indexes), align ("LRRC"…).
 */
function table(header, rows, widths, { total = [], section = [], sample = [], bold = [], align, size = 8.5, keep } = {}) {
  const al = align || "L".repeat(header.length);
  const keepAll = keep ?? rows.length <= 15;
  const trs = [new TableRow({
    tableHeader: true, cantSplit: true,
    children: header.map((h, i) => cell(h, { width: widths[i], fill: BLUE, color: "FFFFFF", bold: true, align: "C", size, keepNext: true })),
  })];
  rows.forEach((r, ri) => {
    const keepNext = keepAll && ri < rows.length - 1;
    if (section.includes(ri)) {
      trs.push(new TableRow({ cantSplit: true, children: [cell(r[0], { span: header.length, fill: SECTION, bold: true, color: BLUE, size, keepNext: true, width: widths.reduce((a, b) => a + b, 0) })] }));
      return;
    }
    const fill = total.includes(ri) ? TOTAL : sample.includes(ri) ? SAMPLE : ri % 2 ? ZEBRA : undefined;
    trs.push(new TableRow({
      cantSplit: true,
      children: r.map((v, ci) => cell(v, { width: widths[ci], fill, align: al[ci], size, keepNext,
        bold: ci === 0 || total.includes(ri) || bold.includes(ri), color: ci === 0 ? BLUE : undefined })),
    }));
  });
  return new Table({
    rows: trs, borders: GRID, layout: TableLayoutType.FIXED, alignment: AlignmentType.CENTER,
    width: { size: cm(widths.reduce((a, b) => a + b, 0)), type: WidthType.DXA },
    columnWidths: widths.map(cm),
  });
}

function image(img, widthCm) {
  const w = px(widthCm);
  return new ImageRun({ type: img.type || "png", data: img.data, transformation: { width: Math.round(w), height: Math.round(w * img.height / img.width) } });
}

function figure(img, widthCm, caption) {
  if (!img) return [];
  return [
    para([image(img, widthCm)], { align: AlignmentType.CENTER, keepNext: true, after: 2 }),
    para([run(caption, { size: 8, italic: true, color: GREY })], { align: AlignmentType.CENTER, after: 8 }),
  ];
}

// ---- page frame --------------------------------------------------------------------------

/** Page set-up with the letterhead running edge to edge (header at the very top, footer at the bottom). */
function frame(letterhead, footerText) {
  const top = letterhead?.top, bottom = letterhead?.bottom;
  const hCm = (img) => (img ? PAGE_W * img.height / img.width : 0);
  const bleed = { left: -cm(SIDE), right: -cm(SIDE) };
  const pageNo = new Paragraph({
    alignment: AlignmentType.RIGHT, spacing: { before: 0, after: pt(2) },
    children: [run(`${footerText}   |   Page `, { size: 7.5, color: GREY }),
      new TextRun({ children: [PageNumber.CURRENT], size: 15, color: GREY, font: FONT })],
  });
  return {
    page: {
      size: { width: cm(PAGE_W), height: cm(PAGE_H) },
      margin: {
        top: cm(top ? hCm(top) + 0.4 : 2.0), bottom: cm(bottom ? hCm(bottom) + 0.9 : 2.0),
        left: cm(SIDE), right: cm(SIDE), header: 0, footer: 0,
      },
    },
    headers: { default: new Header({ children: [top
      ? new Paragraph({ indent: bleed, spacing: { before: 0, after: 0 }, children: [image(top, PAGE_W)] })
      : new Paragraph({ children: [] })] }) },
    footers: { default: new Footer({ children: [
      new Paragraph({ children: [], spacing: { before: 0, after: 0 } }),
      ...(bottom ? [pageNo, new Paragraph({ indent: bleed, spacing: { before: 0, after: 0 }, children: [image(bottom, PAGE_W)] })]
        : [pageNo]),
    ] }) },
  };
}

function makeDoc(title, sectionProps, children) {
  return new Document({
    creator: "PV Toolkit", title,
    styles: { default: { document: { run: { font: FONT, size: 20 } } } },
    numbering: { config: [{ reference: "bullets", levels: [{ level: 0, format: LevelFormat.BULLET, text: "•", alignment: AlignmentType.LEFT,
      style: { paragraph: { indent: { left: cm(0.6), hanging: cm(0.35) } } } }] }] },
    sections: [{ properties: { page: sectionProps.page }, headers: sectionProps.headers, footers: sectionProps.footers, children }],
  });
}

const pack = (doc, output) => (output === "buffer" ? Packer.toBuffer(doc) : Packer.toBlob(doc));

// ---- report ------------------------------------------------------------------------------

export async function buildReport({ report: r, site, calc, charts = {}, photos = [], letterhead = null }, { output = "blob" } = {}) {
  const months = calc.months, tot = calc.totals, cur = calc.current;
  if (!months.length || !tot || !cur) throw new Error(calc.problems[0] || "No generation figures for the report month.");
  const first = months[0], last = months[months.length - 1];
  const no = reportNo(r, site);
  const month = monthName(r.report_month);
  const ytd = months.length > 1 ? `${MONTHS[first.m - 1]} – ${MONTHS[last.m - 1]} ${last.y}` : month;
  const rd = r.report_date ? new Date(`${r.report_date}T00:00:00`) : null;
  const period = month + (cur.mtd && rd ? ` (to ${rd.getDate()} ${MONTHS[cur.m - 1]}, month-to-date)` : "");
  const P = Number(site.capacity_kwp);
  const inv = inverterText(site);
  const lab = (d) => d.label + (d.partial ? "*" : d.mtd ? "†" : "");
  const out = [];

  // cover
  out.push(para([], { before: 60, after: 0 }));
  out.push(para([run("M O N T H L Y   O P E R A T I O N   &   M A I N T E N A N C E   R E P O R T", { size: 10, bold: true, color: BLUE })], { after: 4 }));
  out.push(para([run(`${site.plant_name} Solar PV Plant`, { size: 26, bold: true, color: CHARCOAL })], { after: 4 }));
  out.push(para([run(`${month}  |  Year-to-date ${ytd}`, { size: 12, color: GREY })],
    { after: 18, border: { bottom: { style: BorderStyle.SINGLE, size: 18, color: BLUE, space: 8 } } }));
  const info = [
    ["Client", site.client_name],
    ["Plant", [site.plant_name, P ? `${fmt(P, P % 1 ? 1 : 0)} kWp DC` : "", site.installation].filter(Boolean).join("  |  ")],
    ["Inverters", inv || null],
    ["Location", site.location || null],
    ["Report month", period],
    ["Cumulative period", ytd],
    ["Report no.", no],
    ["Report date", r.report_date ? fmtDate(r.report_date) : null],
    ["Prepared by", r.prepared_by || "____________________"],
  ];
  for (const [k, v] of info) {
    out.push(para([run(`${k}:  `, { bold: true, color: BLUE }), v === null ? run("To be confirmed", { highlight: SAMPLE }) : run(v)], { after: 2 }));
  }
  out.push(pageBreak());

  // 1. executive summary
  out.push(h1("1. Executive Summary"));
  out.push(text(`This monthly report covers the operation of the ${site.plant_name} solar PV plant in ${period}, with cumulative figures `
    + `for the calendar year to date (${ytd}). Energy generation, irradiation and performance ratio (PR) are taken from the plant `
    + "monitoring system (Sungrow iSolarCloud).", { after: 6 }));
  out.push(h2(`This month – ${month}${cur.mtd ? " (month-to-date)" : ""}`));
  out.push(bullet(`Generation: ${fmt(cur.energy)} kWh${cur.sy !== null ? `, a specific yield of ${fmt(cur.sy)} kWh/kWp` : ""}.`));
  if (cur.pr !== null) out.push(bullet(`Performance ratio: ${fmt(cur.pr)} %${cur.irr !== null ? ` at ${fmt(cur.irr)} kWh/m² irradiation` : ""}.`));
  out.push(bullet(`CO₂ avoided: ${fmt(cur.co2 / 1000, 2)} tonnes, equal to about ${fmt(cur.trees, 0)} trees.`));
  const mlog = calc.log.filter((e) => e.date.slice(0, 7) === r.report_month);
  const cl = mlog.filter(isCleaning).map((e) => fmtDate(e.date)), ins = mlog.filter(isInspection).map((e) => fmtDate(e.date));
  out.push(bullet(`Maintenance: ${cl.length ? `module cleaning on ${cl.join(", ")}` : "no module cleaning"}; ${ins.length ? `inspection on ${ins.join(", ")}` : "no inspection"}.`));
  const open = (r.findings || []).filter((f) => f.finding && String(f.status || "Open").toLowerCase() !== "closed");
  out.push(bullet(`${open.length} open inspection finding${open.length === 1 ? "" : "s"}; see section 5.`));
  out.push(h2(`Year to date – ${ytd}`));
  out.push(bullet(`Cumulative generation: ${fmt(tot.energy)} kWh (${fmt(tot.energy / 1000)} MWh)${tot.sy !== null ? `, a specific yield of ${fmt(tot.sy, 0)} kWh/kWp` : ""}.`));
  if (months.length > 1) out.push(bullet(`Highest monthly generation: ${tot.top.label} (${fmt(tot.top.energy)} kWh).`));
  if (tot.pr !== null) {
    out.push(bullet(`Energy-weighted average PR for ${tot.pr_range}: ${fmt(tot.pr)} %`
      + (tot.pr_low !== tot.pr_high ? ` (monthly range ${fmt(tot.pr_low.pr)} % in ${tot.pr_low.label} to ${fmt(tot.pr_high.pr)} % in ${tot.pr_high.label}).` : ".")));
  }
  out.push(bullet(`Cumulative CO₂ avoided: ${fmt(tot.co2 / 1000)} tonnes, equivalent to the annual absorption of about ${fmt(tot.trees, 0)} trees.`));
  out.push(bullet(`Maintenance this year: ${calc.log.filter(isCleaning).length} module cleaning(s) and ${calc.log.filter(isInspection).length} inspection(s).`));
  const marks = [];
  if (first.partial) marks.push(`* ${first.label} is a part-month (commissioning)`);
  if (last.mtd) marks.push(`† ${last.label} is month-to-date`);
  if (marks.length) out.push(note(marks.join("; ") + "."));

  // 2. plant data
  out.push(h1("2. Plant Data and Calculation Basis"));
  const rows = [["Client", site.client_name], ["Plant name", site.plant_name],
    ["Installed DC capacity", P ? `${fmt(P, P % 1 ? 1 : 0)} kWp DC` : "To be confirmed"],
    ["Installation type", site.installation || "—"],
    ["Inverters", inv || "To be confirmed"]];
  const invRow = rows.length - 1;
  if (site.commissioning_month) rows.push(["Commissioned", monthName(site.commissioning_month)]);
  if (site.location) rows.push(["Location", site.location]);
  rows.push(
    ["Generation", "Monthly yield (kWh) from the iSolarCloud monitoring export, used as reported."],
    ["Irradiation", "Plant monthly irradiation from the iSolarCloud export (Wh/m², shown as kWh/m²)."],
    ["Performance Ratio", "Monthly PR (%) from the iSolarCloud export, used as reported. The year-to-date PR is the energy-weighted average of the monthly values."],
    ["CO₂ avoided", `Generation × ${EMISSION_FACTOR} kg CO₂/kWh (Oman grid emission factor).`],
    ["Tree equivalent", `CO₂ avoided ÷ ${TREE_KG} kg CO₂ absorbed per tree per year.`],
  );
  out.push(table(["Item", "Value / Basis"], rows, [4.5, 12.5], { sample: inv ? [] : [invRow] }));

  // 3. generation
  out.push(h1("3. Generation, PR and Irradiation – Year to Date"));
  out.push(text(`Monthly generation, irradiation and PR for ${ytd}. The report month is shown in bold and the totals are cumulative for the calendar year.`));
  const gen = months.map((d) => [lab(d), fmt(d.energy), d.irr !== null ? fmt(d.irr) : "n/a", d.pr !== null ? fmt(d.pr) : "n/a",
    d.sy !== null ? fmt(d.sy) : "n/a", fmt(d.cum)]);
  gen.push(["YTD total / avg.", fmt(tot.energy), fmt(tot.irr), tot.pr !== null ? fmt(tot.pr) : "n/a", tot.sy !== null ? fmt(tot.sy) : "n/a", fmt(tot.energy)]);
  out.push(table(["Month", "Generation (kWh)", "Irradiation (kWh/m²)", "PR (%)", "Specific yield (kWh/kWp)", "Cumulative (kWh)"], gen,
    [2.6, 2.9, 2.9, 2.0, 3.1, 3.5], { total: [gen.length - 1], bold: [months.indexOf(cur)], align: "LRRRRR" }));
  let nt = "YTD PR is energy-weighted";
  if (first.partial) nt += ` and excludes ${first.label}* (commissioning month)`;
  nt += ".";
  if (last.mtd) nt += ` ${last.label}†: month-to-date.`;
  const capped = months.filter((d) => d.pr !== null && Math.abs(d.pr - 90) < 1e-6).map((d) => d.label);
  if (capped.length) nt += ` PR for ${capped.join(", ")} is reported by the monitoring system as exactly 90.0 %, which may be a capped value.`;
  const NAMES = { energy: "generation", irr: "irradiation", pr: "PR" };
  const fixed = months.filter((d) => d.edited?.length).map((d) => `${d.label} (${d.edited.map((k) => NAMES[k] || k).join(", ")})`);
  if (fixed.length) nt += ` Corrected by hand, differing from the monitoring export: ${fixed.join("; ")}.`;
  out.push(note(nt));
  out.push(h2("Monthly generation"), ...figure(charts.gen, 15, "Figure 1 – Monthly energy generation (MWh)."));
  out.push(h2("Monthly performance ratio"), ...figure(charts.pr, 15, "Figure 2 – Monthly performance ratio (%)."));
  out.push(h2("Monthly irradiation"), ...figure(charts.irr, 15, "Figure 3 – Monthly irradiation (kWh/m²)."));

  // 4. environment
  out.push(h1("4. Environmental Impact"));
  out.push(text(`By supplying ${fmt(tot.energy / 1000)} MWh of clean electricity this year, the plant avoided about ${fmt(tot.co2 / 1000)} tonnes of CO₂ `
    + `that would otherwise have been emitted by grid generation (${EMISSION_FACTOR} kg CO₂/kWh). This equals the yearly CO₂ uptake of about ${fmt(tot.trees, 0)} mature trees.`));
  const env = months.map((d) => [d.label, fmt(d.energy), fmt(d.co2, 0), fmt(d.co2 / 1000, 2), fmt(d.trees, 0)]);
  env.push(["Total", fmt(tot.energy), fmt(tot.co2, 0), fmt(tot.co2 / 1000, 2), fmt(tot.trees, 0)]);
  out.push(table(["Month", "Generation (kWh)", "CO₂ avoided (kg)", "CO₂ avoided (t)", "Tree equivalent"], env,
    [2.6, 3.6, 3.6, 3.6, 3.6], { total: [env.length - 1], align: "LRRRR" }));
  out.push(...figure(charts.co2, 15, "Figure 4 – Monthly and cumulative CO₂ emissions avoided."));
  out.push(h2("Tree-planting equivalent"), ...figure(charts.trees, 14.5, "Figure 5 – Trees required to absorb the avoided CO₂ over one year."));

  // 5. maintenance
  out.push(h1("5. Maintenance Activity"));
  out.push(h2(`5.1 Maintenance log – year to date (${ytd})`));
  if (calc.log.length) {
    out.push(text(`Preventive maintenance carried out this calendar year; ${month} entries are in bold. Each inspection is recorded on the separate site checklist, referenced below.`));
    const logRows = calc.log.map((e) => [fmtDate(e.date), e.activity || "", e.scope || "", e.by || "",
      e.ref || (isInspection(e) ? `CL-${e.date}` : "—")]);
    out.push(table(["Date", "Activity", "Scope", "Done by", "Checklist ref."], logRows, [2.6, 4.6, 4.2, 2.8, 2.8],
      { bold: calc.log.map((e, i) => (e.date.slice(0, 7) === r.report_month ? i : -1)).filter((i) => i >= 0) }));
  } else {
    out.push(text("No maintenance activity recorded this year."));
  }
  out.push(h2(`5.2 PV module cleaning – ${month}`));
  const ck = r.checklist || null;
  const inMonth = (d) => d && d.slice(0, 7) === r.report_month;
  const cleanRec = (ck?.cleaning || []).filter((c) => inMonth(c.date) || (!c.date && (c.area || c.by)));
  if (cleanRec.length) {
    out.push(text(`Module cleaning recorded on the site checklist${ck.ref ? ` (${ck.ref})` : ""}:`));
    out.push(table(["Date", "Area / rows cleaned", "Method", "Soiling before", "Water (L)", "Done by"],
      cleanRec.map((c) => [c.date ? fmtDate(c.date) : c.date_text || "—", c.area || "—", c.method || "—", ({ Med: "Medium" }[c.soiling] || c.soiling || "—"), c.water || "—", c.by || "—"]),
      [2.4, 4.6, 2.2, 2.4, 2.0, 3.4], { align: "LLCCRL" }));
  }
  if (photos.length) {
    out.push(text("Regular cleaning removes dust and soiling from the module surface. In the Muscat region soiling is a major cause of PR loss, "
      + "especially between rain events. The photographs below record the module condition before and after cleaning."));
    for (const ph of photos) {
      const pic = (img, title) => cell([
        img ? para([image(img, 7.9)], { align: AlignmentType.CENTER, after: 2, keepNext: true })
          : para([run(`${title.toUpperCase()} – photo not added`, { size: 9, color: GREY, italic: true })], { align: AlignmentType.CENTER, before: 40, after: 40, keepNext: true }),
        para([run(title, { size: 9, bold: true, color: BLUE })], { align: AlignmentType.CENTER, after: 0 }),
      ], { width: 8.5 });
      out.push(new Table({
        rows: [new TableRow({ cantSplit: true, children: [pic(ph.before, "Before cleaning"), pic(ph.after, "After cleaning")] })],
        layout: TableLayoutType.FIXED, alignment: AlignmentType.CENTER, columnWidths: [cm(8.5), cm(8.5)],
        width: { size: cm(17), type: WidthType.DXA },
        borders: { top: line("FFFFFF", 0), bottom: line("FFFFFF", 0), left: line("FFFFFF", 0), right: line("FFFFFF", 0), insideHorizontal: line("FFFFFF", 0), insideVertical: line("FFFFFF", 0) },
      }));
      out.push(para([run(ph.label || "", { size: 8, italic: true, color: GREY })], { align: AlignmentType.CENTER, after: 8 }));
    }
  } else if (!cleanRec.length) {
    out.push(text(cl.length ? `Module cleaning was carried out on ${cl.join(", ")}.` : "No module cleaning was carried out this month."));
  }
  out.push(h2(`5.3 Inspection results – ${month}`));
  const fnd = (r.findings || []).filter((f) => f.finding);
  if (ck?.items?.length) {
    const n = { OK: 0, "Not OK": 0, "N/A": 0 };
    for (const it of ck.items) if (it.status in n) n[it.status]++;
    const blank = ck.items.length - n.OK - n["Not OK"] - n["N/A"];
    const who = [ck.visit_date ? `on ${fmtDate(ck.visit_date)}` : "", ck.inspected_by ? `by ${ck.inspected_by}` : ""].filter(Boolean).join(" ");
    out.push(text(`The site was inspected ${who || "this month"} against the ${ck.items.length}-item O&M checklist${ck.ref ? ` (${ck.ref}` : ""}`
      + `${ck.ref && ck.visit_type ? `, ${ck.visit_type.toLowerCase()} visit)` : ck.ref ? ")" : ""}: ${n.OK} OK, ${n["Not OK"]} Not OK, ${n["N/A"]} not applicable`
      + `${blank ? `, ${blank} not checked` : ""}.${ck.weather ? ` Weather: ${ck.weather}.` : ""}`));
    if (fnd.length) out.push(text("Items marked Not OK and other defects found are listed below with the action taken or planned."));
  } else if (ins.length) out.push(text("Inspections followed the site O&M checklist (issued as a separate document and filled in on site). Items marked Not OK are listed below with the action taken or planned."));
  if (fnd.length) {
    out.push(table(["Item", "Finding", "Severity", "Action", "Status"],
      fnd.map((f) => [String(f.item_no ?? ""), f.finding, f.severity || "", f.action || "", f.status || "Open"]),
      [1.4, 6.0, 2.0, 5.4, 2.2], { align: "CLCLC" }));
  } else {
    out.push(text(ins.length || ck?.items?.length ? "All checklist items were found OK; no defects recorded." : "No inspection was carried out this month."));
  }
  const remarks = (ck?.items || []).filter((it) => it.status !== "Not OK" && (it.remarks || it.photo));
  if (remarks.length) {
    out.push(para([run("Other remarks from the checklist", { bold: true, color: CHARCOAL })], { before: 6, after: 3, keepNext: true }));
    out.push(table(["Item", "Check", "Status", "Remarks", "Photo"],
      remarks.map((it) => [String(it.no), it.item, it.status || "—", it.remarks || "—", it.photo || "—"]),
      [1.2, 6.4, 1.6, 6.0, 1.8], { align: "CLCLC" }));
  }

  // data sources
  out.push(h1("Data Sources and Assumptions"));
  out.push(bullet(`Plant monitoring export: ${r.export_name || "iSolarCloud monthly report"}.`));
  if (r.checklist) out.push(bullet(`Site checklist${r.checklist.ref ? ` ${r.checklist.ref}` : ""}${r.checklist.visit_date ? ` of ${fmtDate(r.checklist.visit_date)}` : ""}${r.checklist.file_name ? ` (${r.checklist.file_name})` : ""}.`));
  out.push(bullet(`Oman grid emission factor ≈ ${EMISSION_FACTOR} kg CO₂/kWh.`));
  out.push(bullet(`Tree CO₂ absorption of ${TREE_KG} kg per tree per year (common conversion value).`));

  const doc = makeDoc(`${site.plant_name} O&M Report ${month}`, frame(letterhead, `${site.plant_name} Solar PV Plant  |  Monthly O&M Report – ${month}  |  ${no}`), out);
  return pack(doc, output);
}

// ---- checklist ----------------------------------------------------------------------------
// Word tick boxes (click to tick) so the filled-in file can be read back by checklist.js.
// Keep the labels and table headings in step with checklist.js.

export const CL = {
  status: ["OK", "Not OK", "N/A"],
  visit: ["Monthly", "Quarterly", "Annual", "After event"],
  method: ["Dry", "Wet", "Robot"],
  level: ["Low", "Med", "High"],
  title: "Preventive Maintenance Checklist",
};

function boxes(labels, { size = 7.5 } = {}) {
  const kids = [];
  labels.forEach((l, i) => {
    kids.push(new CheckBox({ checked: false }), run(` ${l}${i < labels.length - 1 ? "  " : ""}`, { size }));
  });
  return new Paragraph({ children: kids, spacing: { before: 0, after: 0 } });
}

export async function buildChecklist({ site, letterhead = null, items = CHECKLIST, ref = "", month = "" }, { output = "blob" } = {}) {
  const out = [];
  out.push(para([run("O & M   S I T E   C H E C K L I S T", { size: 9, bold: true, color: BLUE })], { after: 2 }));
  out.push(para([run(`${site.plant_name} Solar PV Plant – ${CL.title}`, { size: 17, bold: true, color: CHARCOAL })], { after: 2 }));
  const P = Number(site.capacity_kwp);
  out.push(para([run([site.installation, P ? `${fmt(P, P % 1 ? 1 : 0)} kWp DC` : "", inverterText(site), site.location].filter(Boolean).join("  |  "), { size: 9.5, color: GREY })],
    { after: 8, border: { bottom: { style: BorderStyle.SINGLE, size: 12, color: BLUE, space: 6 } } }));

  const hw = [2.8, 5.7, 2.8, 5.7];
  const lab = (t, w) => cell(t, { width: w, fill: SECTION, bold: true, color: BLUE, size: 8.5 });
  const val = (t, w) => cell(t, { width: w, size: 8.5 });
  const hdrRows = [
    [lab("Checklist ref.", hw[0]), val(ref, hw[1]), lab("Visit date", hw[2]), val("", hw[3])],
    [lab("Visit type", hw[0]), new TableCell({ children: [boxes(CL.visit, { size: 8 })], width: { size: cm(hw[1]), type: WidthType.DXA }, margins: { top: 40, bottom: 40, left: 90, right: 90 } }),
      lab("Weather / condition", hw[2]), val("", hw[3])],
    [lab("Inspected by", hw[0]), val("", hw[1]), lab("Reviewed by", hw[2]), val("", hw[3])],
    [lab("Signature", hw[0]), val("", hw[1]), lab("Signature", hw[2]), val("", hw[3])],
  ];
  out.push(new Table({
    rows: hdrRows.map((cells) => new TableRow({ cantSplit: true, height: { value: cm(0.75), rule: HeightRule.ATLEAST }, children: cells })),
    borders: GRID, layout: TableLayoutType.FIXED, alignment: AlignmentType.CENTER, columnWidths: hw.map(cm), width: { size: cm(17), type: WidthType.DXA },
  }));
  out.push(para([run("How to fill it in: ", { size: 8.5, bold: true, color: BLUE }), run(`type the visit date (e.g. 10/${month ? month.slice(5, 7) : "11"}/${month ? month.slice(0, 4) : "2026"}), click a box to tick it, `
    + "and write any defect or note in Remarks. Tick N/A for items not due on this visit. Not OK items also go in the Defects table at the end. "
    + "Save the file and upload it on the O&M report page: the ticks, remarks, cleaning record and defects go into the report.", { size: 8.5 })], { before: 4, after: 6 }));

  // inspection items
  const w = [0.8, 5.0, 1.6, 1.6, 3.7, 3.2, 1.1];
  const head = new TableRow({ tableHeader: true, cantSplit: true,
    children: ["No.", "Inspection item", "Frequency", "Date checked", "Status", "Remarks / action", "Photo ref."].map((h, i) => cell(h, { width: w[i], fill: BLUE, color: "FFFFFF", bold: true, align: "C", size: 7.5 })) });
  const trs = [head];
  let zebra = 0;
  for (const sct of items) {
    trs.push(new TableRow({ cantSplit: true, children: [cell(sct.section, { span: w.length, width: 17, fill: SECTION, bold: true, color: BLUE, size: 7.5, keepNext: true })] }));
    for (const [no, item, freq] of sct.items) {
      const fill = zebra++ % 2 ? ZEBRA : undefined;
      trs.push(new TableRow({ cantSplit: true, children: [
        cell(String(no), { width: w[0], fill, align: "C", bold: true, color: BLUE, size: 7.5 }),
        cell(item, { width: w[1], fill, size: 7.5 }),
        cell(freq, { width: w[2], fill, align: "C", size: 7.5 }),
        cell("", { width: w[3], fill, size: 7.5 }),
        new TableCell({ children: [boxes(CL.status)], width: { size: cm(w[4]), type: WidthType.DXA }, shading: fill ? { type: ShadingType.CLEAR, fill, color: "auto" } : undefined,
          verticalAlign: VerticalAlign.CENTER, margins: { top: 40, bottom: 40, left: 90, right: 90 } }),
        cell("", { width: w[5], fill, size: 7.5 }),
        cell("", { width: w[6], fill, size: 7.5 }),
      ] }));
    }
  }
  out.push(new Table({ rows: trs, borders: GRID, layout: TableLayoutType.FIXED, alignment: AlignmentType.CENTER, columnWidths: w.map(cm), width: { size: cm(17), type: WidthType.DXA } }));
  out.push(note("Safety: isolate the system and follow lock-out / tag-out before any electrical work. Do not walk on roof sheets without approved access and fall protection."));
  out.push(pageBreak());

  const boxCell = (labels, width) => new TableCell({ children: [boxes(labels)], width: { size: cm(width), type: WidthType.DXA }, verticalAlign: VerticalAlign.CENTER, margins: { top: 40, bottom: 40, left: 90, right: 90 } });
  const formTable = (headers, widths, makeRow, n = 6) => new Table({
    rows: [new TableRow({ tableHeader: true, cantSplit: true, children: headers.map((h, i) => cell(h, { width: widths[i], fill: BLUE, color: "FFFFFF", bold: true, align: "C", size: 7.5 })) }),
      ...Array.from({ length: n }, () => new TableRow({ cantSplit: true, height: { value: cm(0.7), rule: HeightRule.ATLEAST }, children: makeRow() }))],
    borders: GRID, layout: TableLayoutType.FIXED, alignment: AlignmentType.CENTER, columnWidths: widths.map(cm), width: { size: cm(17), type: WidthType.DXA },
  });
  out.push(h1("Module Cleaning Record"));
  const cw = [1.6, 2.6, 3.4, 3.3, 1.3, 1.6, 1.6, 1.6];
  out.push(formTable(["Date", "Area / rows cleaned", "Method", "Soiling before", "Water used (L)", "Before photo ref.", "After photo ref.", "Done by"], cw,
    () => cw.map((x, i) => (i === 2 ? boxCell(CL.method, x) : i === 3 ? boxCell(CL.level, x) : cell("", { width: x, size: 7.5 })))));
  out.push(h1("Defects Found (Not OK items)"));
  const dw = [0.8, 1.1, 4.3, 3.3, 4.2, 1.9, 1.4];
  out.push(formTable(["No.", "Item no.", "Defect description", "Severity", "Action taken / required", "Target date", "Status"], dw,
    () => dw.map((x, i) => (i === 0 ? cell("", { width: x, size: 7.5 }) : i === 3 ? boxCell(CL.level, x) : cell("", { width: x, size: 7.5 })))));

  const doc = makeDoc(`${site.plant_name} O&M Site Checklist`, frame(letterhead, `${site.plant_name} Solar PV Plant  |  O&M Site Checklist${ref ? `  |  ${ref}` : ""}`), out);
  return plainBoxes(await pack(doc, output), output);
}

/**
 * Show each tick box as a ☐ character in a text run, as Word itself writes them, instead of the
 * symbol run docx makes (which LibreOffice and some viewers draw as ticked).
 */
async function plainBoxes(file, output) {
  const zip = await globalThis.JSZip.loadAsync(file);
  const xml = (await zip.file("word/document.xml").async("string")).replace(/<w:sym w:char="2610" w:font="MS Gothic"\/>/g,
    '<w:rPr><w:rFonts w:ascii="MS Gothic" w:eastAsia="MS Gothic" w:hAnsi="MS Gothic" w:hint="eastAsia"/></w:rPr><w:t>\u2610</w:t>');
  zip.file("word/document.xml", xml);
  return zip.generateAsync(output === "buffer" ? { type: "nodebuffer" }
    : { type: "blob", mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document" });
}
