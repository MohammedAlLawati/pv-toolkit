// Read a Helioscope report (PDF) in the browser: the pictures in it, each page as a picture
// (for cropping the layout or shading view), and the system figures in its text.
// pdf.js is loaded only when a report is opened.

const PDFJS = "../../vendor/pdfjs/pdf.min.mjs";
const WORKER = new URL("../../vendor/pdfjs/pdf.worker.min.mjs", import.meta.url).href;
const MIN_PX = 250;   // smaller embedded images are logos and icons

let lib = null;
async function pdfjs() {
  if (!lib) {
    lib = await import(PDFJS);
    lib.GlobalWorkerOptions.workerSrc = WORKER;
  }
  return lib;
}

const numberIn = (s) => Number(String(s).replace(/,/g, ""));
const SCALE = { wh: 1e-3, kwh: 1, mwh: 1e3, gwh: 1e6, w: 1e-3, kw: 1, kwp: 1, mw: 1e3, mwp: 1e3 };
const scaled = (n, unit) => numberIn(n) * (SCALE[unit.toLowerCase()] ?? 1);

/**
 * Figures from a report's text: { dc_kwp, ac_kw, annual_gen_kwh, specific_yield, module, inverter }
 * (whichever were found). `models` = { modules: [{id, model}], inverters: [{id, model}] } from
 * the library: a model named in the report is picked.
 */
export function parseReport(text, models = { modules: [], inverters: [] }) {
  const t = String(text).replace(/\s+/g, " ");
  const out = {};
  let m = t.match(/Module DC\s*Nameplate\s*([\d,.]+)\s*(kWp|MWp|kW|MW)\b/i);
  if (m) out.dc_kwp = scaled(m[1], m[2]);
  m = t.match(/Inverter AC\s*Nameplate\s*([\d,.]+)\s*(kW|MW)\b/i);
  if (m) out.ac_kw = scaled(m[1], m[2]);
  m = t.match(/Annual\s*Production\s*([\d,.]+)\s*(GWh|MWh|kWh)\b/i);
  if (m) out.annual_gen_kwh = Math.round(scaled(m[1], m[2]));
  m = t.match(/kWh\s*\/\s*kWp\s*([\d,.]+)/i);
  if (m) out.specific_yield = numberIn(m[1]);
  const named = (rows) => rows.filter((r) => r.model && t.toLowerCase().includes(r.model.toLowerCase()))
    .sort((a, b) => b.model.length - a.model.length)[0];
  const mod = named(models.modules || []), inv = named(models.inverters || []);
  if (mod) out.module_id = mod.id;
  if (inv) out.inverter_id = inv.id;
  return out;
}

function canvasOf(w, h) {
  const c = document.createElement("canvas");
  c.width = w; c.height = h;
  return c;
}
const toBlob = (canvas, type = "image/jpeg") => new Promise((res) => canvas.toBlob(res, type, 0.92));

/** pdf.js image object -> canvas (bitmap, or raw pixels in one of its formats). */
function imageCanvas(img) {
  const { width: w, height: h } = img;
  const c = canvasOf(w, h);
  const ctx = c.getContext("2d");
  if (img.bitmap) { ctx.drawImage(img.bitmap, 0, 0); return c; }
  if (!img.data) return null;
  const out = ctx.createImageData(w, h), d = out.data, src = img.data;
  if (img.kind === 3) d.set(src.subarray(0, d.length));
  else if (img.kind === 2) for (let i = 0, j = 0; j < d.length; i += 3, j += 4) { d[j] = src[i]; d[j + 1] = src[i + 1]; d[j + 2] = src[i + 2]; d[j + 3] = 255; }
  else if (img.kind === 1) {
    const row = (w + 7) >> 3;
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const v = (src[y * row + (x >> 3)] >> (7 - (x & 7))) & 1 ? 255 : 0, j = (y * w + x) * 4;
      d[j] = d[j + 1] = d[j + 2] = v; d[j + 3] = 255;
    }
  } else return null;
  ctx.putImageData(out, 0, 0);
  return c;
}

const getObj = (objs, id) => new Promise((resolve) => {
  try { objs.get(id, resolve); } catch { resolve(null); }
  setTimeout(() => resolve(null), 4000);
});

/**
 * Open a report. Returns { text, images: [{blob, width, height, page}], pages: [{blob, width, height, page}] }.
 * `onProgress(message)` is called as pages are read.
 */
export async function readReport(file, onProgress = () => {}) {
  const pdf = await (await pdfjs()).getDocument({ data: new Uint8Array(await file.arrayBuffer()) }).promise;
  const { OPS } = lib;
  let text = "";
  const images = [], pages = [];
  for (let n = 1; n <= pdf.numPages; n++) {
    onProgress(`Reading page ${n} of ${pdf.numPages}…`);
    const page = await pdf.getPage(n);
    const tc = await page.getTextContent();
    text += tc.items.map((i) => i.str).join(" ") + "\n";

    const vp1 = page.getViewport({ scale: 1 });
    const vp = page.getViewport({ scale: Math.min(3, 1800 / vp1.width) });
    const canvas = canvasOf(Math.round(vp.width), Math.round(vp.height));
    const ctx = canvas.getContext("2d");
    ctx.fillStyle = "#fff"; ctx.fillRect(0, 0, canvas.width, canvas.height);
    await page.render({ canvasContext: ctx, canvas, viewport: vp }).promise;
    pages.push({ blob: await toBlob(canvas), width: canvas.width, height: canvas.height, page: n });

    // After rendering, the page's images are decoded and held in page.objs / commonObjs.
    const ops = await page.getOperatorList();
    const seen = new Set();
    for (let i = 0; i < ops.fnArray.length; i++) {
      if (ops.fnArray[i] !== OPS.paintImageXObject) continue;
      const id = ops.argsArray[i][0];
      if (seen.has(id)) continue;
      seen.add(id);
      const img = await getObj(id.startsWith("g_") ? page.commonObjs : page.objs, id);
      if (!img || img.width < MIN_PX || img.height < MIN_PX) continue;
      const c = imageCanvas(img);
      if (c) images.push({ blob: await toBlob(c), width: c.width, height: c.height, page: n });
    }
    page.cleanup();
  }
  await pdf.destroy();
  return { text, images, pages };
}

/** Cut a rectangle (in image pixels) out of an image blob. */
export async function crop(blob, { x, y, w, h }) {
  const bmp = await createImageBitmap(blob);
  const c = canvasOf(Math.round(w), Math.round(h));
  c.getContext("2d").drawImage(bmp, x, y, w, h, 0, 0, w, h);
  bmp.close?.();
  return { blob: await toBlob(c), width: c.width, height: c.height };
}
