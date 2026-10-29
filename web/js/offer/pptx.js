// Fill web/templates/offer_deck.pptx in the browser (made by tools/prepare_offer_template.py).
//
// The template carries {{Placeholders}} in its text, image slots (p:pic with descr "img:<key>")
// and slide tags in p:cSld/@name:
//   offer:ds_module:<model> / offer:ds_inverter:<model>  datasheet slides of one model
//   offer:spec_module / offer:spec_inverter             generic spec tables (used otherwise)
//   offer:needs:<image>                                  dropped when that image is missing
//   offer:needs:subsystems                               dropped unless there are several sub-systems or inverter models
// Logos (p:pic with descr "logo:<key>") are moved to a corner of image <key>.
// Schedule tables (a W1, W2, ... header row) get one row per activity, shaded in its weeks.
// Charts: chart1 monthly energy (MWh), chart2 25-year energy + loss, chart3 cumulative cash flow.
import { replacePlaceholders } from "../docgen/render.js";

const NS = {
  a: "http://schemas.openxmlformats.org/drawingml/2006/main",
  p: "http://schemas.openxmlformats.org/presentationml/2006/main",
  r: "http://schemas.openxmlformats.org/officeDocument/2006/relationships",
  c: "http://schemas.openxmlformats.org/drawingml/2006/chart",
  rel: "http://schemas.openxmlformats.org/package/2006/relationships",
  ct: "http://schemas.openxmlformats.org/package/2006/content-types",
};
const PPTX_MIME = "application/vnd.openxmlformats-officedocument.presentationml.presentation";
const IMAGE_REL = "http://schemas.openxmlformats.org/officeDocument/2006/relationships/image";
const byTag = (root, ns, local) => Array.from(root.getElementsByTagNameNS(NS[ns], local));
const child = (el, ns, local) => Array.from(el.childNodes).find((n) => n.namespaceURI === NS[ns] && n.localName === local);

const relsPath = (part) => part.replace(/([^/]+)$/, "_rels/$1.rels");
const resolve = (base, target) => {
  const parts = base.split("/").slice(0, -1);
  for (const seg of target.split("/")) {
    if (seg === "..") parts.pop();
    else if (seg !== ".") parts.push(seg);
  }
  return parts.join("/");
};

class Pptx {
  constructor(zip) { this.zip = zip; this.trees = new Map(); this.mediaN = 0; }
  static async open(data) { return new Pptx(await globalThis.JSZip.loadAsync(data)); }
  async tree(name) {
    if (!this.trees.has(name)) {
      const file = this.zip.file(name);
      if (!file) return null;
      this.trees.set(name, new DOMParser().parseFromString(await file.async("string"), "application/xml"));
    }
    return this.trees.get(name);
  }
  remove(name) { this.zip.remove(name); this.trees.delete(name); }
  async rels(part) { return this.tree(relsPath(part)); }

  async addImage(part, bytes, ext) {
    this.mediaN += 1;
    const filename = `offer${this.mediaN}.${ext}`;
    this.zip.file("ppt/media/" + filename, bytes);
    const ct = await this.tree("[Content_Types].xml");
    if (!byTag(ct, "ct", "Default").some((d) => (d.getAttribute("Extension") || "").toLowerCase() === ext)) {
      const el = ct.createElementNS(NS.ct, "Default");
      el.setAttribute("Extension", ext);
      el.setAttribute("ContentType", ext === "png" ? "image/png" : "image/jpeg");
      ct.documentElement.insertBefore(el, ct.documentElement.firstChild);
    }
    const rels = await this.rels(part);
    const ids = new Set(byTag(rels, "rel", "Relationship").map((r) => r.getAttribute("Id")));
    let n = 1;
    while (ids.has(`rIdI${n}`)) n++;
    const el = rels.createElementNS(NS.rel, "Relationship");
    el.setAttribute("Id", `rIdI${n}`);
    el.setAttribute("Type", IMAGE_REL);
    el.setAttribute("Target", "../media/" + filename);
    rels.documentElement.appendChild(el);
    return `rIdI${n}`;
  }

  /** Slides in presentation order: { part, sldId, rel }. */
  async slides() {
    const pres = await this.tree("ppt/presentation.xml");
    const rels = await this.rels("ppt/presentation.xml");
    const byId = new Map(byTag(rels, "rel", "Relationship").map((r) => [r.getAttribute("Id"), r]));
    return byTag(pres, "p", "sldId").map((sldId) => {
      const rel = byId.get(sldId.getAttributeNS(NS.r, "id"));
      return { sldId, rel, part: resolve("ppt/presentation.xml", rel.getAttribute("Target")) };
    });
  }

  async dropSlide(s) {
    s.sldId.parentNode.removeChild(s.sldId);
    s.rel.parentNode.removeChild(s.rel);
    const rels = await this.rels(s.part);
    const ct = await this.tree("[Content_Types].xml");
    const dropOverride = (part) => byTag(ct, "ct", "Override").filter((o) => o.getAttribute("PartName") === "/" + part).forEach((o) => o.parentNode.removeChild(o));
    for (const r of rels ? byTag(rels, "rel", "Relationship") : []) {
      if (/notesSlide$/.test(r.getAttribute("Type"))) {
        const notes = resolve(s.part, r.getAttribute("Target"));
        this.remove(notes); this.remove(relsPath(notes)); dropOverride(notes);
      }
    }
    this.remove(s.part); this.remove(relsPath(s.part)); dropOverride(s.part);
  }

  async bytes() {
    const ser = new XMLSerializer();
    for (const [name, doc] of this.trees) {
      let xml = ser.serializeToString(doc);
      if (!xml.startsWith("<?xml")) xml = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n' + xml;
      this.zip.file(name, xml);
    }
    return this.zip.generateAsync({ type: "uint8array", compression: "DEFLATE", mimeType: PPTX_MIME });
  }
}

// ---- charts ------------------------------------------------------------------------------

function setPoints(doc, cache, values, isNumber) {
  while (cache.firstChild) cache.removeChild(cache.firstChild);
  const ns = NS.c;
  if (isNumber) {
    const fc = doc.createElementNS(ns, "c:formatCode");
    fc.textContent = "General";
    cache.appendChild(fc);
  }
  const pc = doc.createElementNS(ns, "c:ptCount");
  pc.setAttribute("val", String(values.length));
  cache.appendChild(pc);
  values.forEach((v, i) => {
    const pt = doc.createElementNS(ns, "c:pt");
    pt.setAttribute("idx", String(i));
    const el = doc.createElementNS(ns, "c:v");
    el.textContent = String(v);
    pt.appendChild(el);
    cache.appendChild(pt);
  });
}

/** Rewrite the cached categories and values of series `index` (the chart has no workbook). */
function setSeries(doc, index, cats, vals) {
  const ser = byTag(doc, "c", "ser")[index];
  if (!ser) return;
  const fix = (holder, values, isNumber) => {
    if (!holder) return;
    const ref = child(holder, "c", "numRef") || child(holder, "c", "strRef");
    const f = ref && child(ref, "c", "f");
    if (f) f.textContent = f.textContent.replace(/\$(\d+):\$([A-Z]+)\$(\d+)$/, (m, a, col) => `$${a}:$${col}$${Number(a) + values.length - 1}`);
    const cache = ref && (child(ref, "c", "numCache") || child(ref, "c", "strCache"));
    if (cache) setPoints(doc, cache, values, cache.localName === "numCache" && isNumber);
  };
  if (cats) fix(child(ser, "c", "cat"), cats, false);
  fix(child(ser, "c", "val"), vals, true);
}

// ---- images ------------------------------------------------------------------------------

const LOGO_MARGIN = 64008; // 0.07 in

async function fillImages(deck, part, root, images) {
  const placed = {};
  for (const pic of byTag(root, "p", "pic")) {
    const pr = byTag(pic, "p", "cNvPr")[0];
    const tag = pr?.getAttribute("descr") || "";
    if (!tag.startsWith("img:")) continue;
    const key = tag.slice(4);
    const img = images[key];
    if (!img) { pic.parentNode.removeChild(pic); continue; }
    const rid = await deck.addImage(part, img.bytes, img.ext);
    byTag(pic, "a", "blip")[0].setAttributeNS(NS.r, "r:embed", rid);
    const xfrm = byTag(pic, "a", "xfrm")[0], off = child(xfrm, "a", "off"), ext = child(xfrm, "a", "ext");
    const bx = Number(off.getAttribute("x")), by = Number(off.getAttribute("y"));
    const bw = Number(ext.getAttribute("cx")), bh = Number(ext.getAttribute("cy"));
    const scale = Math.min(bw / img.width, bh / img.height);
    const w = Math.round(img.width * scale), h = Math.round(img.height * scale);
    const x = bx + Math.floor((bw - w) / 2), y = by + Math.floor((bh - h) / 2);
    off.setAttribute("x", String(x));
    off.setAttribute("y", String(y));
    ext.setAttribute("cx", String(w));
    ext.setAttribute("cy", String(h));
    pr.setAttribute("descr", "");
    placed[key] = { x, y, w, h, corner: img.logoCorner || "tl" };
  }
  // logos tagged "logo:<key>" go in the chosen corner of that picture, or away with it
  for (const pic of byTag(root, "p", "pic")) {
    const pr = byTag(pic, "p", "cNvPr")[0];
    const tag = pr?.getAttribute("descr") || "";
    if (!tag.startsWith("logo:")) continue;
    const box = placed[tag.slice(5)];
    if (!box) { pic.parentNode.removeChild(pic); continue; }
    const xfrm = byTag(pic, "a", "xfrm")[0], off = child(xfrm, "a", "off"), ext = child(xfrm, "a", "ext");
    let lw = Number(ext.getAttribute("cx")), lh = Number(ext.getAttribute("cy"));
    const fit = Math.min(1, (box.w * 0.3) / lw); // never more than 30% of the picture's width
    lw = Math.round(lw * fit); lh = Math.round(lh * fit);
    const right = box.corner[1] === "r", bottom = box.corner[0] === "b";
    off.setAttribute("x", String(right ? box.x + box.w - lw - LOGO_MARGIN : box.x + LOGO_MARGIN));
    off.setAttribute("y", String(bottom ? box.y + box.h - lh - LOGO_MARGIN : box.y + LOGO_MARGIN));
    ext.setAttribute("cx", String(lw));
    ext.setAttribute("cy", String(lh));
    pr.setAttribute("descr", "");
  }
}

// ---- schedule ----------------------------------------------------------------------------

const cellText = (tc) => byTag(tc, "a", "t").map((t) => t.textContent).join("").trim();

/** Replace a table cell's text, keeping the first run's formatting. */
function setCellText(tc, text) {
  const paras = byTag(tc, "a", "p");
  paras.slice(1).forEach((p) => p.parentNode.removeChild(p));
  const runs = byTag(paras[0], "a", "r");
  runs.slice(1).forEach((r) => r.parentNode.removeChild(r));
  if (runs[0]) byTag(runs[0], "a", "t")[0].textContent = text;
}

/** The tcPr's own fill (its last solidFill / noFill child, not a border's). */
function setCellFill(doc, tc, filled, fillTemplate) {
  const pr = child(tc, "a", "tcPr");
  if (!pr) return;
  const old = Array.from(pr.childNodes).filter((n) => n.namespaceURI === NS.a && (n.localName === "solidFill" || n.localName === "noFill")).pop();
  const next = filled ? fillTemplate.cloneNode(true) : doc.createElementNS(NS.a, "a:noFill");
  if (old) pr.replaceChild(next, old); else pr.appendChild(next);
}

const SCHEDULE_BOTTOM = 4650000; // EMU: schedule rows stay above the slide's footer

/**
 * Fill the "Execution Schedule" tables: the second header row names the weeks (W1, W2, ...),
 * and the activity rows (first cell a number) are rebuilt from `schedule` = [{ name, start, weeks }]:
 * one row per activity that runs in this table's weeks, numbered in schedule order, shaded in
 * its weeks. Rows get shorter (and their text smaller) when more activities have to fit.
 * Returns the last week shaded on this slide (0 when the slide has no schedule).
 */
export function fillSchedule(root, schedule) {
  let used = 0;
  for (const tbl of byTag(root, "a", "tbl")) {
    const rows = byTag(tbl, "a", "tr");
    const weekRow = rows.find((r) => byTag(r, "a", "tc").some((tc) => /^W\d+$/.test(cellText(tc))));
    if (!weekRow) continue;
    const weeks = byTag(weekRow, "a", "tc").map((tc) => { const m = cellText(tc).match(/^W(\d+)$/); return m ? Number(m[1]) : null; });
    const shown = weeks.filter((w) => w !== null), lo = Math.min(...shown), hi = Math.max(...shown);
    const data = rows.slice(rows.indexOf(weekRow) + 1).filter((r) => /^\d+$/.test(cellText(byTag(r, "a", "tc")[0])));
    const ownFill = (tc) => { const pr = child(tc, "a", "tcPr"); return pr && Array.from(pr.childNodes).filter((n) => n.namespaceURI === NS.a && (n.localName === "solidFill" || n.localName === "noFill")).pop(); };
    const fillTemplate = data.flatMap((r) => byTag(r, "a", "tc").map(ownFill)).find((f) => f?.localName === "solidFill");
    if (!data.length || !fillTemplate) continue;

    const proto = data[0];
    const protoH = Math.round(data.reduce((t, r) => t + Number(r.getAttribute("h")), 0) / data.length);
    const acts = schedule.map((a, i) => ({ ...a, n: i + 1 }))
      .filter((a) => a.weeks > 0 && a.start <= hi && a.start + a.weeks - 1 >= lo);
    const frame = tbl.parentNode.parentNode.parentNode;
    const xfrm = child(frame, "p", "xfrm");
    const top = Number(child(xfrm, "a", "off").getAttribute("y"));
    const headH = rows.slice(0, rows.indexOf(weekRow) + 1).reduce((t, r) => t + Number(r.getAttribute("h")), 0);
    // room down to the footer, or to the first shape below the table's header (the template's note)
    const x0 = Number(child(xfrm, "a", "off").getAttribute("x")), x1 = x0 + Number(child(xfrm, "a", "ext").getAttribute("cx"));
    let bottom = SCHEDULE_BOTTOM;
    for (const el of Array.from(frame.parentNode.childNodes)) {
      if (el === frame || el.nodeType !== 1) continue;
      const off = byTag(el, "a", "off")[0], ext = byTag(el, "a", "ext").find((e) => e.hasAttribute("cx"));
      if (!off || !ext) continue;
      const y = Number(off.getAttribute("y")), x = Number(off.getAttribute("x")), w = Number(ext.getAttribute("cx"));
      if (y > top + headH && x < x1 && x + w > x0) bottom = Math.min(bottom, y);
    }
    const h = Math.min(protoH, Math.floor((bottom - top - headH) / Math.max(1, acts.length)));
    const scale = Math.max(0.7, h / protoH);
    for (const r of data) r.parentNode.removeChild(r);

    for (const a of acts) {
      const tr = proto.cloneNode(true);
      tr.setAttribute("h", String(h));
      const ext = child(tr, "a", "extLst");
      if (ext) tr.removeChild(ext); // the template's row id must stay unique
      const tcs = byTag(tr, "a", "tc");
      setCellText(tcs[0], String(a.n));
      setCellText(tcs[1], a.name || "");
      if (scale < 0.95) {
        for (const rpr of [...byTag(tr, "a", "rPr"), ...byTag(tr, "a", "endParaRPr")]) {
          const sz = Number(rpr.getAttribute("sz"));
          if (sz) rpr.setAttribute("sz", String(Math.round((sz * scale) / 50) * 50));
        }
      }
      tcs.forEach((tc, i) => {
        const w = weeks[i];
        if (w === null) return;
        const on = w >= a.start && w < a.start + a.weeks;
        setCellFill(root, tc, on, fillTemplate);
        if (on) used = Math.max(used, w);
      });
      tbl.appendChild(tr);
    }
    child(xfrm, "a", "ext").setAttribute("cy", String(byTag(tbl, "a", "tr").reduce((t, r) => t + Number(r.getAttribute("h")), 0)));
  }
  return used;
}

/**
 * The sub-system table: the row holding {{SS_Name}} is copied once per sub-system
 * ([{ name, mounting, module, modules, dc, inverters, ac, ratio }], already formatted) and then removed.
 */
export function fillSubsystems(root, rows) {
  for (const tr of byTag(root, "a", "tr")) {
    if (!cellText(byTag(tr, "a", "tc")[0]).includes("{{SS_Name}}")) continue;
    for (const r of rows) {
      const copy = tr.cloneNode(true);
      const tcs = byTag(copy, "a", "tc");
      [r.name, r.mounting, r.module, r.modules, r.dc, r.inverters, r.ac, r.ratio].forEach((text, i) => tcs[i] && setCellText(tcs[i], text ?? ""));
      tr.parentNode.insertBefore(copy, tr);
    }
    tr.parentNode.removeChild(tr);
    return;
  }
}

// ---- the deck ----------------------------------------------------------------------------

/** Which slides to keep, from their tags and the project's equipment and images. */
export function keepSlide(tag, { moduleModel, inverterModel, moduleModels, inverterModels, images, flags, dsModules, dsInverters }) {
  const [, kind, arg] = (tag || "").split(":");
  if (!tag.startsWith("offer:")) return true;
  // a system with several models keeps the datasheet slides of each
  if (kind === "ds_module") return arg === moduleModel || !!moduleModels?.includes(arg);
  if (kind === "ds_inverter") return arg === inverterModel || !!inverterModels?.includes(arg);
  if (kind === "spec_module") return !dsModules.has(moduleModel);
  if (kind === "spec_inverter") return !dsInverters.has(inverterModel);
  if (kind === "needs") return !!images[arg] || !!flags?.[arg];
  return true;
}

/**
 * @param template ArrayBuffer of offer_deck.pptx
 * @param input { values, months (12 kWh or null), flow (from cashFlow or null),
 *                moduleModel, inverterModel, moduleModels, inverterModels (all models used), schedule ([{ name, start, weeks }] or null),
 *                subsystems ([{ name, mounting, module, modules, dc, inverters, ac, ratio }] as text, or none),
 *                images: { site, shadow, structure, structure2 }, each { bytes, ext, width, height, logoCorner? } }
 * @returns { bytes, missing }
 */
export async function renderPptx(template, input) {
  const deck = await Pptx.open(template);
  const images = input.images || {};
  const missing = new Set();
  const slides = await deck.slides();

  const tags = [];
  for (const s of slides) {
    const root = await deck.tree(s.part);
    tags.push(byTag(root, "p", "cSld")[0]?.getAttribute("name") || "");
  }
  const dsModules = new Set(tags.filter((t) => t.startsWith("offer:ds_module:")).map((t) => t.split(":")[2]));
  const dsInverters = new Set(tags.filter((t) => t.startsWith("offer:ds_inverter:")).map((t) => t.split(":")[2]));
  const subsystems = input.subsystems || [];
  const ctx = { moduleModel: input.moduleModel, inverterModel: input.inverterModel, moduleModels: input.moduleModels,
                inverterModels: input.inverterModels, images, dsModules, dsInverters,
                flags: { subsystems: subsystems.length > 0 } };

  const lastWeek = input.schedule?.length ? Math.max(...input.schedule.map((a) => (a.weeks > 0 ? a.start + a.weeks - 1 : 0))) : null;
  for (let i = 0; i < slides.length; i++) {
    const s = slides[i];
    if (!keepSlide(tags[i], ctx)) { await deck.dropSlide(s); continue; }
    const root = await deck.tree(s.part);
    if (input.schedule?.length && byTag(root, "a", "tbl").length) {
      // a schedule slide whose weeks all come after the last activity is dropped
      const firstWeek = Math.min(...byTag(root, "a", "t").map((t) => t.textContent.match(/^W(\d+)$/)).filter(Boolean).map((m) => Number(m[1])));
      if (Number.isFinite(firstWeek) && firstWeek > lastWeek) { await deck.dropSlide(s); continue; }
      fillSchedule(root, input.schedule);
    }
    if (subsystems.length) fillSubsystems(root, subsystems);
    replacePlaceholders(root, input.values, missing, "a");
    await fillImages(deck, s.part, root, images);
  }

  const c1 = await deck.tree("ppt/charts/chart1.xml");
  if (c1 && input.months) setSeries(c1, 0, null, input.months.map((k) => +(k / 1000).toFixed(1)));
  const c2 = await deck.tree("ppt/charts/chart2.xml");
  if (c2 && input.flow) {
    setSeries(c2, 0, null, input.flow.years.map((y) => +(y.kwh / 1000).toFixed(2)));
    setSeries(c2, 1, null, input.flow.years.map((y) => +y.loss.toFixed(4)));
  }
  const c3 = await deck.tree("ppt/charts/chart3.xml");
  if (c3 && input.flow) {
    setSeries(c3, 0, input.flow.years.map((y) => String(y.n)), input.flow.years.map((y) => Math.round(y.cumulative)));
  }
  return { bytes: await deck.bytes(), missing: [...missing] };
}
