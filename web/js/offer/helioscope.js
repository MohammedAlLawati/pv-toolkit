// Helioscope reports (PDF), read in the browser: the system figures in their text, the
// monthly production read off the bar chart, the pictures placed on each page (cut from the
// rendered page, so they come out the right way up), the two 3D angle views on the shading
// report's scanned page, the monthly AC energy in that page's "Solar Access by Month" table
// (text recognition with tesseract.js), and each page as a whole, for cropping. pdf.js and
// tesseract.js are loaded only when a report is opened.
//
// HTC uses two reports: the simulation ("Annual Production Report", whose "Detailed Layout"
// goes on the location slide) and the shading report ("Shading Report", whose "Shading
// Heatmap" goes on the shadow analysis slide).

const PDFJS = "../../vendor/pdfjs/pdf.min.mjs";
const WORKER = new URL("../../vendor/pdfjs/pdf.worker.min.mjs", import.meta.url).href;
const MIN_PX = 250;        // smaller pictures are logos and icons
const MAX_PAGE_SHARE = 0.8; // a picture covering most of the page is a scanned page: crop it instead
const PAGE_PX = 2400;      // rendered page width
const TESS = new URL("../../vendor/tesseract/", import.meta.url).href;
const TABLE_SHARE = 0.24;  // the Solar Access by Month table sits in the top quarter of the scanned page

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

// ---- figures from the text ----------------------------------------------------------------

const numberIn = (str) => Number(String(str).replace(/,/g, ""));
const UNIT = { wh: 1e-3, kwh: 1, mwh: 1e3, gwh: 1e6, w: 1e-3, kw: 1, kwp: 1, mw: 1e3, mwp: 1e3 };
const scaled = (n, unit) => numberIn(n) * (UNIT[unit.toLowerCase()] ?? 1);
const near = (a, b) => Math.abs(a - b) <= Math.max(0.5, 0.01 * b);

/**
 * Figures from a report's text (simulation and/or shading report), whichever are found:
 * { dc_kwp, ac_kw, annual_gen_kwh, specific_yield, pr_pct, shading_loss_pct, module_count, inverter_qty,
 *   module_wp, module_model, inverter_model, tilt_deg, azimuth_deg, racking,
 *   module_id, inverter_id }. `library` = { modules, inverters } picks the models it names.
 */
export function parseReport(text, library = { modules: [], inverters: [] }) {
  const t = String(text).replace(/\s+/g, " ").replace(/-\s+(?=[A-Z0-9])/g, "-");
  const out = {};
  let m = t.match(/Module DC\s*Nameplate\s*([\d,.]+)\s*(kWp|MWp|kW|MW)\b/i);
  if (m) out.dc_kwp = scaled(m[1], m[2]);
  m = t.match(/Inverter AC\s*Nameplate\s*([\d,.]+)\s*(kW|MW)\b/i);
  if (m) out.ac_kw = scaled(m[1], m[2]);
  m = t.match(/Annual\s*Production\s*([\d,.]+)\s*(GWh|MWh|kWh)\b/i);
  if (m) out.annual_gen_kwh = Math.round(scaled(m[1], m[2]));
  m = t.match(/Performance\s*Ratio\s*([\d.]+)\s*%/i);
  if (m) out.pr_pct = Number(m[1]);
  m = t.match(/kWh\s*\/\s*kWp\s*([\d,.]+)/i);
  if (m) out.specific_yield = numberIn(m[1]);
  m = t.match(/\bShading\s*:+\s*([\d.]+)\s*%/i);
  if (m) out.shading_loss_pct = Number(m[1]);
  else if ((m = t.match(/Totals, weighted by kWp.*?([\d.]+)%\s*([\d.]+)%\s*([\d.]+)%/i))) out.shading_loss_pct = +(100 - Number(m[2])).toFixed(1);

  // Components: "Inverters SG150CX (Sungrow) 4 (600.00 kW)", "Module Jinko Solar, JKM720N-... (720W) 805 (579.60 kW)"
  m = t.match(/Inverters?\s+([A-Za-z0-9][\w.\-]*)\s*\(([^)]*)\)\s*(\d[\d,]*)\s*\(\s*([\d,.]+)\s*(kW|MW)\s*\)/);
  if (m) { out.inverter_model = m[1]; out.inverter_qty = numberIn(m[3]); out.ac_kw ??= scaled(m[4], m[5]); }
  m = t.match(/Module\s+(?:([^,()]{2,40}),\s*)?([A-Za-z0-9][\w.\-]*)\s*\((\d{2,4}(?:\.\d+)?)\s*W\)\s*(\d[\d,]*)\s*\(\s*([\d,.]+)\s*(kW|MW)\s*\)/);
  if (m) { out.module_model = m[2]; out.module_wp = Number(m[3]); out.module_count = numberIn(m[4]); out.dc_kwp ??= scaled(m[5], m[6]); }
  else {
    // the components table (page 3) read in another order: "Module Jinko Solar, JKM720N-66HL5- 805 (579.60 BDV-Z6-EN (720W) kW)"
    const row = t.match(/\bModule\s+(?!DC|Binning|&)(.{0,160}?)\bkW\s*\)/);
    if (row) {
      const cnt = row[1].match(/(?:^|[\s-])(\d[\d,]*)\s*\(\s*([\d,.]+)(?=\s)/);
      const rest = cnt ? row[1].replace(cnt[0].trimStart().replace(/^-/, ""), "") : row[1];
      const wp = rest.match(/\((\d{2,4}(?:\.\d+)?)\s*W\)/);
      const model = rest.replace(/-\s+/g, "-").match(/([A-Z]{2,}[\w.]*-[\w.\-]*)/);
      if (cnt) { out.module_count = numberIn(cnt[1]); out.dc_kwp ??= numberIn(cnt[2]); }
      if (wp) out.module_wp = Number(wp[1]);
      if (model) out.module_model = model[1].replace(/-$/, "");
    }
  }
  // else the field segments' module counts (page 3), added up
  if (!out.module_count) {
    let sum = 0;
    for (const fs of t.matchAll(/FS-\d+\s.*?\b\d+x\d+\s+(\d+)\s+(\d+)\s+[\d,.]+\s*kW\b/g)) sum += Number(fs[2]);
    if (sum) out.module_count = sum;
  }
  // else DC capacity ÷ module rating
  if (!out.module_count && out.dc_kwp && out.module_wp) out.module_count = Math.round((out.dc_kwp * 1000) / out.module_wp);

  // "Solar Access by Month" table (shading report): the AC energy of each month, exact
  m = t.match(/AC\s*Power\s*\(\s*kWh\s*\)((?:\s*[\d,]+(?:\.\d+)?){12})/i);
  if (m) {
    const months = m[1].trim().split(/\s+/).map(numberIn);
    if (months.every((x) => x > 0)) out.monthly_kwh = months;
  }

  // the field segment with the most power gives the tilt and orientation
  let best = null;
  for (const fs of t.matchAll(/FS-\d+\s+(.*?)\s(\d+(?:\.\d+)?)°\s+(\d+(?:\.\d+)?)°.*?\s([\d,.]+)\s*kW\b/g)) {
    const kw = numberIn(fs[4]);
    if (!best || kw > best.kw) best = { racking: fs[1], tilt: Number(fs[2]), az: Number(fs[3]), kw };
  }
  if (best) { out.tilt_deg = best.tilt; out.azimuth_deg = +best.az.toFixed(1); out.racking = best.racking.replace(/\s*(Landscape|Portrait).*$/i, "").trim(); }

  // library items: a model named in the report (longest match), else same Wp / kW
  // (the model can be split by the count when the components table is read out of order)
  const lower = `${t} ${t.replace(/-\d[\d,]*\s*\([\d,.]+\s+/g, "-")}`.toLowerCase();
  const named = (rows) => rows.filter((r) => r.model && lower.includes(r.model.toLowerCase())).sort((a, b) => b.model.length - a.model.length)[0];
  const mod = named(library.modules || []) || (out.module_wp && (library.modules || []).find((x) => x.wp === out.module_wp && out.module_model?.startsWith(x.model.slice(0, 4))));
  const inv = named(library.inverters || []);
  if (mod) out.module_id = mod.id;
  if (inv) out.inverter_id = inv.id;
  if (out.module_count && out.dc_kwp && out.module_wp && !near(out.module_count * out.module_wp / 1000, out.dc_kwp)) delete out.module_wp;
  return out;
}

/** Spread an annual figure over 12 months in the shape of the bar heights read off the chart. */
export function monthsFromBars(heights, annualKwh) {
  if (!heights || heights.length !== 12 || heights.some((h) => !(h > 0))) return null;
  const sum = heights.reduce((a, b) => a + b, 0);
  return heights.map((h) => (annualKwh ? (h / sum) * annualKwh : h));
}

// ---- pixels ----------------------------------------------------------------------------------

const isBarColour = (r, g, b) => r > 200 && g > 110 && g < 215 && b < 150 && r - b > 90;

/**
 * Monthly production read off the "Monthly Production" bar chart: for each month label, the
 * height of the orange bar above the axis' 0, in the axis' units. Null if the chart isn't there.
 */
function readBars(ctx, vp, items) {
  const at = (it) => {
    const [x, y] = vp.convertToViewportPoint(it.transform[4], it.transform[5]);
    const [x2] = vp.convertToViewportPoint(it.transform[4] + it.width, it.transform[5]);
    const h = it.height * vp.scale;
    return { x: (x + x2) / 2, left: x, y: y - h / 2, str: it.str.trim() };
  };
  const MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  const months = MON.map((mo) => items.filter((i) => i.str.trim() === mo).map(at)).map((c) => c[0]);
  if (months.some((m) => !m)) return null;
  const axis = items.map(at).filter((p) => /^\d+(\.\d+)?[kM]?$/.test(p.str) && p.left < months[0].x && p.y < months[0].y + 2)
    .map((p) => ({ ...p, v: parseFloat(p.str) * (p.str.endsWith("M") ? 1e6 : p.str.endsWith("k") ? 1e3 : 1) }));
  const zero = axis.find((p) => p.v === 0), top = axis.sort((a, b) => b.v - a.v)[0];
  if (!zero || !top || top.v === 0) return null;
  const perPx = top.v / (zero.y - top.y);
  const { width } = ctx.canvas;
  const img = ctx.getImageData(0, 0, width, Math.ceil(zero.y) + 2).data;
  const px = (x, y) => { const i = (Math.round(y) * width + Math.round(x)) * 4; return [img[i], img[i + 1], img[i + 2]]; };
  const heights = months.map((mo) => {
    let y = zero.y;
    while (y > 0 && !isBarColour(...px(mo.x, y))) y -= 1;          // up from the axis line to the bar
    const bottom = y;
    while (y > top.y - 40 && isBarColour(...px(mo.x, y))) y -= 1;
    return bottom - y > 1 ? (zero.y - y) * perPx : null;
  });
  return heights.every((h) => h > 0) ? heights : null;
}

/**
 * Panels on a scanned page (no text): a run of grey rule lines at the panel's header and one at
 * its foot. Returns the picture area of the lowest panel in each half of the page, left first.
 */
function scannedPanels(ctx) {
  const { width: W, height: H } = ctx.canvas;
  const d = ctx.getImageData(0, 0, W, H).data;
  const out = [];
  for (const [x0, x1] of [[0, W >> 1], [W >> 1, W]]) {
    const lines = [];
    for (let y = 0; y < H; y++) {
      let run = 0, best = 0, start = 0, bestStart = 0;
      for (let x = x0; x < x1; x++) {
        const i = (y * W + x) * 4, r = d[i], g = d[i + 1], b = d[i + 2];
        const mx = Math.max(r, g, b), mn = Math.min(r, g, b);
        if (mn > 150 && mx < 235 && mx - mn < 12) { if (!run) start = x; run++; if (run > best) { best = run; bestStart = start; } } else run = 0;
      }
      if (best > (x1 - x0) * 0.6) lines.push({ y, x: bestStart, w: best });
    }
    // the lowest tall gap between two rules that is mostly picture (not blank page above the footer)
    const inked = (a, b) => {
      let n = 0, ink = 0;
      for (let y = a.y + 2; y < b.y - 2; y += 4) for (let x = b.x; x < b.x + b.w; x += 4) {
        const i = (y * W + x) * 4; n++;
        if (Math.min(d[i], d[i + 1], d[i + 2]) < 235) ink++;
      }
      return n && ink / n > 0.3;
    };
    let panel = null;
    for (let k = lines.length - 1; k > 0 && !panel; k--) {
      const foot = lines[k], head = lines[k - 1];
      if (foot.y - head.y > H * 0.1 && inked(head, foot)) panel = { head, foot };
    }
    if (!panel) continue;
    const { head, foot } = panel;
    const inset = Math.round(W * 0.003);
    out.push({ x: foot.x + inset, y: head.y + inset, w: foot.w - 2 * inset, h: foot.y - head.y - 2 * inset });
  }
  return out;
}

/** The corner of a picture with the least going on (lowest colour variance): "tl", "tr", "bl" or "br". */
export function quietCorner(ctx, box = { x: 0, y: 0, w: ctx.canvas.width, h: ctx.canvas.height }) {
  const cw = Math.round(box.w * 0.25), ch = Math.round(box.h * 0.22);
  const spots = { tl: [box.x, box.y], tr: [box.x + box.w - cw, box.y], bl: [box.x, box.y + box.h - ch], br: [box.x + box.w - cw, box.y + box.h - ch] };
  let bestKey = "tl", bestScore = Infinity;
  for (const [key, [x, y]] of Object.entries(spots)) {
    const d = ctx.getImageData(x, y, cw, ch).data;
    let n = 0, sum = 0, sum2 = 0;
    for (let i = 0; i < d.length; i += 16) { const v = (d[i] + d[i + 1] + d[i + 2]) / 3; sum += v; sum2 += v * v; n++; }
    const score = sum2 / n - (sum / n) ** 2;
    if (score < bestScore) { bestScore = score; bestKey = key; }
  }
  return bestKey;
}

function canvasOf(w, h) {
  const c = document.createElement("canvas");
  c.width = Math.max(1, Math.round(w)); c.height = Math.max(1, Math.round(h));
  return c;
}
const toBlob = (canvas, type = "image/jpeg") => new Promise((res) => canvas.toBlob(res, type, 0.92));

async function cut(src, x, y, w, h) {
  const c = canvasOf(w, h);
  const ctx = c.getContext("2d", { willReadFrequently: true });
  ctx.drawImage(src, x, y, w, h, 0, 0, c.width, c.height);
  return { blob: await toBlob(c), width: c.width, height: c.height, corner: quietCorner(ctx) };
}

/**
 * Open a report. Returns { name, kind, figures, bars, table, images: [{blob, width, height, corner, page, slot}],
 * pages: [{blob, width, height, page}] }. `kind` is "shading", "simulation" or "report";
 * `bars` is the monthly production read off the chart (12 numbers) or null; `table` is the AC
 * Power row of the scanned Solar Access by Month table (12 kWh figures, unchecked) or null.
 * `onProgress(message)` is called as pages are read.
 */
export async function readReport(file, onProgress = () => {}) {
  const pdf = await (await pdfjs()).getDocument({ data: new Uint8Array(await file.arrayBuffer()) }).promise;
  const { OPS } = lib;
  const pageItems = [];
  for (let n = 1; n <= pdf.numPages; n++) pageItems.push((await (await pdf.getPage(n)).getTextContent()).items);
  const pageTexts = pageItems.map((items) => items.map((i) => i.str).join(" "));
  const text = pageTexts.join("\n");
  const kind = /Shading Report/i.test(text) ? "shading" : /Production Report/i.test(text) ? "simulation" : "report";

  const images = [], pages = [];
  let bars = null, table = null;
  for (let n = 1; n <= pdf.numPages; n++) {
    onProgress(`${file.name}: page ${n} of ${pdf.numPages}…`);
    const page = await pdf.getPage(n);
    const vp1 = page.getViewport({ scale: 1 });
    const vp = page.getViewport({ scale: Math.min(4, PAGE_PX / vp1.width) });
    const canvas = canvasOf(vp.width, vp.height);
    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    ctx.fillStyle = "#fff"; ctx.fillRect(0, 0, canvas.width, canvas.height);
    await page.render({ canvasContext: ctx, canvas, viewport: vp }).promise;
    pages.push({ blob: await toBlob(canvas), width: canvas.width, height: canvas.height, page: n });

    if (!bars && /Monthly Production/i.test(pageTexts[n - 1])) bars = readBars(ctx, vp, pageItems[n - 1]);

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
    // the shading report's second page is a scan: its two 3D angle views go on the structure slide
    if (kind === "shading" && pageTexts[n - 1].trim().length < 20) {
      const panels = scannedPanels(ctx);
      for (const [i, r] of panels.entries()) images.push({ ...(await cut(canvas, r.x, r.y, r.w, r.h)), page: n, slot: i ? "structure2" : "structure" });
      table ||= await readTable(canvas, onProgress);
    }
    page.cleanup();
  }
  await pdf.destroy();
  return { name: file.name, kind, figures: parseReport(text), text, bars, table, images, pages };
}

/**
 * The 12 figures of the "AC Power (kWh)" row in recognised text (the scanned Solar Access by
 * Month table), or null. Helioscope prints each with one decimal ("67,892.3"); recognition often
 * drops or swaps the separators ("67,8923"), so a figure is its digits ÷ 10.
 */
export function acPowerRow(text) {
  const line = String(text).split("\n").find((l) => /AC\s*Power/i.test(l));
  if (!line) return null;
  const vals = line.replace(/^.*?kWh\s*\)?/i, "").trim().split(/\s+/).map((tok) => tok.replace(/[^\d]/g, ""))
    .filter(Boolean).map((digits) => Number(digits) / 10);
  return vals.length === 12 && vals.every((v) => v > 0) ? vals : null;
}

/**
 * Whether recognised monthly figures can be trusted: they add up to the annual figure (within 1%)
 * and each month matches the bar chart's shape (within 4%). Without those to check against, no.
 */
export function monthsAgree(months, barMonths, annualKwh) {
  if (!months || months.length !== 12) return false;
  const sum = months.reduce((a, b) => a + b, 0);
  if (!annualKwh || Math.abs(sum - annualKwh) > 0.01 * annualKwh) return false;
  if (!barMonths) return false;
  return months.every((m, i) => Math.abs(m - barMonths[i]) <= 0.04 * barMonths[i]);
}

/** Read the scanned table's AC Power row off the top of the page (null when it can't). */
async function readTable(canvas, onProgress) {
  try {
    onProgress("Reading the Solar Access by Month table…");
    const h = Math.round(canvas.height * TABLE_SHARE);
    const top = canvasOf(canvas.width, h);
    top.getContext("2d").drawImage(canvas, 0, 0, canvas.width, h, 0, 0, canvas.width, h);
    const tess = await import(`${TESS}tesseract.esm.min.js`);
    const createWorker = tess.createWorker || tess.default.createWorker;
    const worker = await createWorker("eng", 1, { workerPath: `${TESS}worker.min.js`, corePath: `${TESS}core`, langPath: `${TESS}lang`,
                                                  workerBlobURL: false, gzip: true, cacheMethod: "none" });
    try {
      await worker.setParameters({ tessedit_pageseg_mode: "6" });
      const { data } = await worker.recognize(top);
      return acPowerRow(data.text);
    } finally { await worker.terminate(); }
  } catch (err) {
    console.warn("Solar Access table not read:", err);
    return null;
  }
}

/** Cut a rectangle (in image pixels) out of an image blob. */
export async function crop(blob, { x, y, w, h }) {
  const bmp = await createImageBitmap(blob);
  const out = await cut(bmp, x, y, w, h);
  bmp.close?.();
  return out;
}
