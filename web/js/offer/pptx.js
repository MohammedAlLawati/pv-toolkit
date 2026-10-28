// Fill web/templates/offer_deck.pptx in the browser (made by tools/prepare_offer_template.py).
//
// The template carries {{Placeholders}} in its text, image slots (p:pic with descr "img:<key>")
// and slide tags in p:cSld/@name:
//   offer:ds_module:<model> / offer:ds_inverter:<model>  datasheet slides of one model
//   offer:spec_module / offer:spec_inverter             generic spec tables (used otherwise)
//   offer:needs:<image>                                  dropped when that image is missing
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

async function fillImages(deck, part, root, images) {
  for (const pic of byTag(root, "p", "pic")) {
    const pr = byTag(pic, "p", "cNvPr")[0];
    const tag = pr?.getAttribute("descr") || "";
    if (!tag.startsWith("img:")) continue;
    const img = images[tag.slice(4)];
    if (!img) { pic.parentNode.removeChild(pic); continue; }
    const rid = await deck.addImage(part, img.bytes, img.ext);
    byTag(pic, "a", "blip")[0].setAttributeNS(NS.r, "r:embed", rid);
    const off = byTag(pic, "a", "off")[0], ext = byTag(pic, "a", "ext")[0];
    const bx = Number(off.getAttribute("x")), by = Number(off.getAttribute("y"));
    const bw = Number(ext.getAttribute("cx")), bh = Number(ext.getAttribute("cy"));
    const scale = Math.min(bw / img.width, bh / img.height);
    const w = Math.round(img.width * scale), h = Math.round(img.height * scale);
    off.setAttribute("x", String(bx + Math.floor((bw - w) / 2)));
    off.setAttribute("y", String(by + Math.floor((bh - h) / 2)));
    ext.setAttribute("cx", String(w));
    ext.setAttribute("cy", String(h));
    pr.setAttribute("descr", "");
  }
}

// ---- the deck ----------------------------------------------------------------------------

/** Which slides to keep, from their tags and the project's equipment and images. */
export function keepSlide(tag, { moduleModel, inverterModel, images, dsModules, dsInverters }) {
  const [, kind, arg] = (tag || "").split(":");
  if (!tag.startsWith("offer:")) return true;
  if (kind === "ds_module") return arg === moduleModel;
  if (kind === "ds_inverter") return arg === inverterModel;
  if (kind === "spec_module") return !dsModules.has(moduleModel);
  if (kind === "spec_inverter") return !dsInverters.has(inverterModel);
  if (kind === "needs") return !!images[arg];
  return true;
}

/**
 * @param template ArrayBuffer of offer_deck.pptx
 * @param input { values, months (12 kWh or null), flow (from cashFlow or null),
 *                moduleModel, inverterModel, images: { site, shadow, structure } }
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
  const ctx = { moduleModel: input.moduleModel, inverterModel: input.inverterModel, images, dsModules, dsInverters };

  for (let i = 0; i < slides.length; i++) {
    const s = slides[i];
    if (!keepSlide(tags[i], ctx)) { await deck.dropSlide(s); continue; }
    const root = await deck.tree(s.part);
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
