// Pictures from Helioscope reports (PDF), read in the browser: the pictures placed on each
// page (cut from the rendered page, so they come out the right way up) and each page as a
// whole, for cropping. pdf.js is loaded only when a report is opened.
//
// HTC uses two reports: the simulation ("Annual Production Report", whose "Detailed Layout"
// goes on the location slide) and the shading report ("Shading Report", whose "Shading
// Heatmap" goes on the shadow analysis slide).

const PDFJS = "../../vendor/pdfjs/pdf.min.mjs";
const WORKER = new URL("../../vendor/pdfjs/pdf.worker.min.mjs", import.meta.url).href;
const MIN_PX = 250;        // smaller pictures are logos and icons
const MAX_PAGE_SHARE = 0.8; // a picture covering most of the page is a scanned page: crop it instead
const PAGE_PX = 2400;      // rendered page width

let lib = null;
async function pdfjs() {
  if (!lib) {
    lib = await import(PDFJS);
    lib.GlobalWorkerOptions.workerSrc = WORKER;
  }
  return lib;
}

const mul = (m, n) => [m[0] * n[0] + m[2] * n[1], m[1] * n[0] + m[3] * n[1], m[0] * n[2] + m[2] * n[3],
  m[1] * n[2] + m[3] * n[3], m[0] * n[4] + m[2] * n[5] + m[4], m[1] * n[4] + m[3] * n[5] + m[5]];

/** Where each picture is drawn on the page: [{ id, ctm }] in PDF user space. */
function placements(ops, OPS) {
  let ctm = [1, 0, 0, 1, 0, 0];
  const stack = [], out = [];
  for (let i = 0; i < ops.fnArray.length; i++) {
    const fn = ops.fnArray[i], args = ops.argsArray[i];
    if (fn === OPS.save) stack.push(ctm);
    else if (fn === OPS.restore) ctm = stack.pop() || ctm;
    else if (fn === OPS.transform) ctm = mul(ctm, args);
    else if (fn === OPS.paintFormXObjectBegin) { stack.push(ctm); if (Array.isArray(args?.[0]) && args[0].length === 6) ctm = mul(ctm, args[0]); }
    else if (fn === OPS.paintFormXObjectEnd) ctm = stack.pop() || ctm;
    else if (fn === OPS.paintImageXObject || fn === OPS.paintInlineImageXObject) {
      out.push({ id: typeof args[0] === "string" ? args[0] : `inline${i}`, w: args[1] ?? args[0]?.width, h: args[2] ?? args[0]?.height, ctm });
    }
  }
  return out;
}

/**
 * Which slot a picture suits, from the report it came from and the words on its page:
 * "shadow" for the shading heatmap, "site" for the detailed layout, else null.
 */
export function suggestSlot(reportText, pageText) {
  const shading = /Shading Report/i.test(reportText);
  if (shading && /Heatmap/i.test(pageText)) return "shadow";
  if (!shading && /Detailed Layout|Layout\d*\b/i.test(pageText) && !/Project Location/i.test(pageText)) return "site";
  return null;
}

function canvasOf(w, h) {
  const c = document.createElement("canvas");
  c.width = Math.max(1, Math.round(w)); c.height = Math.max(1, Math.round(h));
  return c;
}
const toBlob = (canvas, type = "image/jpeg") => new Promise((res) => canvas.toBlob(res, type, 0.92));

async function cut(src, x, y, w, h) {
  const c = canvasOf(w, h);
  c.getContext("2d").drawImage(src, x, y, w, h, 0, 0, c.width, c.height);
  return { blob: await toBlob(c), width: c.width, height: c.height };
}

/**
 * Open a report. Returns { name, kind, images: [{blob, width, height, page, slot}], pages: [{blob, width, height, page}] }.
 * `kind` is "shading", "simulation" or "report". `onProgress(message)` is called as pages are read.
 */
export async function readReport(file, onProgress = () => {}) {
  const pdf = await (await pdfjs()).getDocument({ data: new Uint8Array(await file.arrayBuffer()) }).promise;
  const { OPS } = lib;
  const pageTexts = [];
  for (let n = 1; n <= pdf.numPages; n++) {
    const tc = await (await pdf.getPage(n)).getTextContent();
    pageTexts.push(tc.items.map((i) => i.str).join(" "));
  }
  const text = pageTexts.join("\n");
  const kind = /Shading Report/i.test(text) ? "shading" : /Production Report/i.test(text) ? "simulation" : "report";

  const images = [], pages = [];
  for (let n = 1; n <= pdf.numPages; n++) {
    onProgress(`${file.name}: page ${n} of ${pdf.numPages}…`);
    const page = await pdf.getPage(n);
    const vp1 = page.getViewport({ scale: 1 });
    const vp = page.getViewport({ scale: Math.min(4, PAGE_PX / vp1.width) });
    const canvas = canvasOf(vp.width, vp.height);
    const ctx = canvas.getContext("2d");
    ctx.fillStyle = "#fff"; ctx.fillRect(0, 0, canvas.width, canvas.height);
    await page.render({ canvasContext: ctx, canvas, viewport: vp }).promise;
    pages.push({ blob: await toBlob(canvas), width: canvas.width, height: canvas.height, page: n });

    const seen = new Set();
    for (const pl of placements(await page.getOperatorList(), OPS)) {
      if ((pl.w && pl.w < MIN_PX) || (pl.h && pl.h < MIN_PX)) continue;
      const [a, b, c, d, e, f] = pl.ctm;
      const pts = [[e, f], [a + e, b + f], [c + e, d + f], [a + c + e, b + d + f]].map(([x, y]) => vp.convertToViewportPoint(x, y));
      const xs = pts.map((p) => p[0]), ys = pts.map((p) => p[1]);
      const x0 = Math.max(0, Math.min(...xs)), y0 = Math.max(0, Math.min(...ys));
      const x1 = Math.min(canvas.width, Math.max(...xs)), y1 = Math.min(canvas.height, Math.max(...ys));
      const w = x1 - x0, h = y1 - y0;
      if (w < MIN_PX / 2 || h < MIN_PX / 2) continue;
      if ((w * h) / (canvas.width * canvas.height) > MAX_PAGE_SHARE) continue;
      const key = `${Math.round(x0)},${Math.round(y0)},${Math.round(w)},${Math.round(h)}`;
      if (seen.has(key)) continue;
      seen.add(key);
      images.push({ ...(await cut(canvas, x0, y0, w, h)), page: n, slot: suggestSlot(text, pageTexts[n - 1]) });
    }
    page.cleanup();
  }
  await pdf.destroy();
  return { name: file.name, kind, images, pages };
}

/** Cut a rectangle (in image pixels) out of an image blob. */
export async function crop(blob, { x, y, w, h }) {
  const bmp = await createImageBitmap(blob);
  const out = await cut(bmp, x, y, w, h);
  bmp.close?.();
  return out;
}
