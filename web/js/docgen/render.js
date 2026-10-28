// Fill a prepared .docx template in the browser (ported from app/docgen/ooxml.py + render.py).
//
// Templates are the cleaned files made by tools/prepare_templates.py:
// - {{Placeholders}} in paragraphs, also when Word split them across runs;
// - shapes tagged in docPr@descr: "if:<flag>" (removed unless the flag is true),
//   "doc:<row>:<default>|<yes_x>|<no_x>|<na_x>" (Documents Required marks, always the default),
//   "img:<key>" (image slot, the picture is fitted and centred in the slot).
// Needs JSZip (window.JSZip in the browser) and DOMParser / XMLSerializer.

const NS = {
  w: "http://schemas.openxmlformats.org/wordprocessingml/2006/main",
  wp: "http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing",
  a: "http://schemas.openxmlformats.org/drawingml/2006/main",
  r: "http://schemas.openxmlformats.org/officeDocument/2006/relationships",
  rel: "http://schemas.openxmlformats.org/package/2006/relationships",
  ct: "http://schemas.openxmlformats.org/package/2006/content-types",
};
const XML_NS = "http://www.w3.org/XML/1998/namespace";
const PLACEHOLDER_RE = /\{\{\s*([A-Za-z0-9_]+)\s*\}\}/g;

const byTag = (root, ns, local) => Array.from(root.getElementsByTagNameNS(NS[ns], local));
const isW = (el, local) => el && el.namespaceURI === NS.w && el.localName === local;

function up(el, test) {
  let cur = el.parentNode;
  while (cur && !test(cur)) cur = cur.parentNode;
  return cur;
}

/** Text nodes of this paragraph only (not of text boxes nested inside it). */
function directTextNodes(p, ns) {
  return byTag(p, ns, "t").filter((t) => up(t, (el) => el.namespaceURI === NS[ns] && el.localName === "p") === p);
}

/** Fill {{Placeholders}} in every paragraph; `ns` is "w" (Word) or "a" (DrawingML, PowerPoint). */
export function replacePlaceholders(root, values, missing, ns = "w") {
  for (const p of byTag(root, ns, "p")) {
    const nodes = directTextNodes(p, ns);
    if (!nodes.length) continue;
    const texts = nodes.map((n) => n.textContent || "");
    const full = texts.join("");
    if (!full.includes("{{")) continue;
    const offsets = [];
    let pos = 0;
    for (const s of texts) { offsets.push(pos); pos += s.length; }
    const segOf = (i) => { let k = 0; while (k + 1 < offsets.length && offsets[k + 1] <= i) k++; return k; };
    const matches = [...full.matchAll(PLACEHOLDER_RE)].reverse();
    for (const m of matches) {
      const key = m[1];
      let val = "";
      if (key in values && values[key] !== null && values[key] !== undefined) val = String(values[key]);
      else missing.add(key);
      const s = m.index, e = m.index + m[0].length;
      const iS = segOf(s), iE = segOf(e - 1);
      const ls = s - offsets[iS], le = e - offsets[iE];
      if (iS === iE) texts[iS] = texts[iS].slice(0, ls) + val + texts[iS].slice(le);
      else {
        texts[iS] = texts[iS].slice(0, ls) + val;
        for (let k = iS + 1; k < iE; k++) texts[k] = "";
        texts[iE] = texts[iE].slice(le);
      }
    }
    nodes.forEach((n, i) => {
      n.textContent = texts[i];
      if (ns === "w") n.setAttributeNS(XML_NS, "xml:space", "preserve");
    });
  }
}

const docPr = (drawing) => byTag(drawing, "wp", "docPr")[0];
const runOf = (el) => up(el, (x) => isW(x, "r"));
const removeRun = (el) => { const r = runOf(el); if (r && r.parentNode) r.parentNode.removeChild(r); };

function posOffset(anchor, which) {
  const pos = byTag(anchor, "wp", which)[0];
  return byTag(pos, "wp", "posOffset")[0];
}

function setExtent(drawing, cx, cy) {
  const e = byTag(drawing, "wp", "extent")[0];
  e.setAttribute("cx", String(cx));
  e.setAttribute("cy", String(cy));
  for (const ext of byTag(drawing, "a", "ext")) {
    if (ext.parentNode && ext.parentNode.localName === "xfrm") {
      ext.setAttribute("cx", String(cx));
      ext.setAttribute("cy", String(cy));
    }
  }
  for (const local of ["sizeRelH", "sizeRelV"]) {
    for (const el of Array.from(drawing.getElementsByTagNameNS("http://schemas.microsoft.com/office/word/2010/wordprocessingDrawing", local))) {
      el.parentNode.removeChild(el);
    }
  }
}

/** A .docx held in memory with JSZip; XML parts parsed on demand. */
class Docx {
  constructor(zip) { this.zip = zip; this.trees = new Map(); this.mediaN = 0; }

  static async open(data) {
    const JSZip = globalThis.JSZip;
    return new Docx(await JSZip.loadAsync(data));
  }

  async tree(name) {
    if (!this.trees.has(name)) {
      const xml = await this.zip.file(name).async("string");
      this.trees.set(name, new DOMParser().parseFromString(xml, "application/xml"));
    }
    return this.trees.get(name);
  }

  xmlParts() {
    return Object.keys(this.zip.files).filter((n) => /^word\/(document|header\d*|footer\d*)\.xml$/.test(n));
  }

  async addMedia(bytes, ext) {
    this.mediaN += 1;
    const filename = `filled${this.mediaN}.${ext}`;
    this.zip.file("word/media/" + filename, bytes);
    const ct = await this.tree("[Content_Types].xml");
    const defaults = byTag(ct, "ct", "Default");
    if (!defaults.some((d) => (d.getAttribute("Extension") || "").toLowerCase() === ext)) {
      const el = ct.createElementNS(NS.ct, "Default");
      el.setAttribute("Extension", ext);
      el.setAttribute("ContentType", ext === "png" ? "image/png" : "image/jpeg");
      ct.documentElement.appendChild(el);
    }
    const rels = await this.tree("word/_rels/document.xml.rels");
    const ids = new Set(byTag(rels, "rel", "Relationship").map((r) => r.getAttribute("Id")));
    let n = 1;
    while (ids.has(`rIdX${n}`)) n++;
    const rid = `rIdX${n}`;
    const el = rels.createElementNS(NS.rel, "Relationship");
    el.setAttribute("Id", rid);
    el.setAttribute("Type", "http://schemas.openxmlformats.org/officeDocument/2006/relationships/image");
    el.setAttribute("Target", "media/" + filename);
    rels.documentElement.appendChild(el);
    return rid;
  }

  async toBlob() {
    const ser = new XMLSerializer();
    for (const [name, doc] of this.trees) {
      let xml = ser.serializeToString(doc);
      if (!xml.startsWith("<?xml")) xml = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n' + xml;
      this.zip.file(name, xml);
    }
    return this.zip.generateAsync({ type: "uint8array", compression: "DEFLATE",
                                    mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document" });
  }
}

/** Scale an image to fit a box, keeping its aspect ratio. */
function fit(img, boxCx, boxCy) {
  const scale = Math.min(boxCx / img.width, boxCy / img.height);
  return [Math.round(img.width * scale), Math.round(img.height * scale)];
}

/**
 * @param template ArrayBuffer / Uint8Array of the .docx template
 * @param input { values, flags, images: { key: { bytes, ext: "png"|"jpg", width, height } | null } }
 * @returns { bytes: Uint8Array, missing: string[] }
 */
export async function renderDocx(template, input) {
  const d = await Docx.open(template);
  const missing = new Set();
  const flags = input.flags || {}, images = input.images || {};
  for (const part of d.xmlParts()) {
    const root = await d.tree(part);
    replacePlaceholders(root, input.values, missing);
    if (part !== "word/document.xml") continue;

    for (const a of byTag(root, "wp", "anchor")) {
      if (!a.parentNode) continue;
      const tag = docPr(a)?.getAttribute("descr") || "";
      if (tag.startsWith("if:")) {
        if (!flags[tag.slice(3)]) removeRun(a);
      } else if (tag.startsWith("doc:")) {
        // the design form's Documents Required marks always stay as in the template
      } else if (tag.startsWith("img:")) {
        const img = images[tag.slice(4)];
        if (!img) { removeRun(a); continue; }
        const ext = byTag(a, "wp", "extent")[0];
        const cx = Number(ext.getAttribute("cx")), cy = Number(ext.getAttribute("cy"));
        const [w, h] = fit(img, cx, cy);
        const rid = await d.addMedia(img.bytes, img.ext);
        byTag(a, "a", "blip")[0].setAttributeNS(NS.r, "r:embed", rid);
        const ph = posOffset(a, "positionH"), pv = posOffset(a, "positionV");
        ph.textContent = String(Number(ph.textContent) + Math.floor((cx - w) / 2));
        pv.textContent = String(Number(pv.textContent) + Math.floor((cy - h) / 2));
        setExtent(a, w, h);
      }
    }
    for (const inl of byTag(root, "wp", "inline")) {
      const tag = docPr(inl)?.getAttribute("descr") || "";
      if (!tag.startsWith("img:")) continue;
      const img = images[tag.slice(4)];
      if (!img) { removeRun(inl); continue; }
      const ext = byTag(inl, "wp", "extent")[0];
      const [w, h] = fit(img, Number(ext.getAttribute("cx")), Number(ext.getAttribute("cy")));
      const rid = await d.addMedia(img.bytes, img.ext);
      byTag(inl, "a", "blip")[0].setAttributeNS(NS.r, "r:embed", rid);
      setExtent(inl, w, h);
    }
  }
  return { bytes: await d.toBlob(), missing: [...missing] };
}
