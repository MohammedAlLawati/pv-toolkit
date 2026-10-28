// Small helpers shared by every page: escaping, formatting, forms, toasts, files.

const ESC = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };
export const esc = (v) => (v === null || v === undefined ? "" : String(v).replace(/[&<>"']/g, (c) => ESC[c]));

/** Raw HTML that html`` must not escape. */
export class Raw { constructor(s) { this.s = s; } toString() { return this.s; } }
export const raw = (s) => new Raw(s);

/** Tagged template that escapes every value except Raw / arrays of Raw. */
export function html(strings, ...values) {
  let out = strings[0];
  values.forEach((v, i) => {
    if (Array.isArray(v)) out += v.map((x) => (x instanceof Raw ? x.s : esc(x))).join("");
    else out += v instanceof Raw ? v.s : esc(v);
    out += strings[i + 1];
  });
  return raw(out);
}

/** Like Python's "{:,.2f}" with trailing zeros dropped; "—" for empty. */
export function num(v, dp = 2) {
  if (v === null || v === undefined || v === "" || !Number.isFinite(Number(v))) return "—";
  let s = Number(v).toFixed(dp);
  const [i, f] = s.split(".");
  s = i.replace(/\B(?=(\d{3})+(?!\d))/g, ",") + (f !== undefined ? "." + f : "");
  return s.includes(".") ? s.replace(/0+$/, "").replace(/\.$/, "") : s;
}

/** Python's "%g" for form values; "" for empty. */
export const g = (v) => (v === null || v === undefined || v === "" ? "" : String(Number(Number(v).toPrecision(6))));

export const sel = (cond) => (cond ? "selected" : "");
export const chk = (cond) => (cond ? "checked" : "");
export const capitalize = (s) => (s ? s[0].toUpperCase() + s.slice(1) : "");
export const shortDate = (iso) => (iso ? new Date(iso).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" }) : "");

// ---- forms -------------------------------------------------------------------------------

export const str = (fd, k) => String(fd.get(k) ?? "").trim();
export function float(fd, k) {
  const s = str(fd, k).replace(/,/g, "");
  if (s === "") return null;
  const v = Number(s);
  return Number.isFinite(v) ? v : null;
}
export const int = (fd, k) => { const v = float(fd, k); return v === null ? null : Math.round(v); };
export const fkey = (fd, k) => { const s = str(fd, k); return /^\d+$/.test(s) ? Number(s) : null; };

// ---- feedback ----------------------------------------------------------------------------

export function toast(message, kind = "ok", ms = 5000) {
  let wrap = document.querySelector(".toast-wrap");
  if (!wrap) { wrap = document.createElement("div"); wrap.className = "toast-wrap"; document.body.append(wrap); }
  const el = document.createElement("div");
  el.className = `flash ${kind}`;
  el.textContent = message;
  wrap.append(el);
  setTimeout(() => el.remove(), kind === "error" ? ms * 2 : ms);
}

/** Open a page; re-renders when it is already the current one. */
export function go(hash) {
  if (location.hash === hash) window.dispatchEvent(new HashChangeEvent("hashchange"));
  else location.hash = hash;
}

// ---- files -------------------------------------------------------------------------------

export function download(blob, filename) {
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 30000);
}

const urls = new Map();
/** An object URL for a stored file (kept until the page changes). */
export function fileUrl(rec) {
  if (!rec || !rec.blob) return "";
  if (!urls.has(rec.id)) urls.set(rec.id, URL.createObjectURL(rec.blob));
  return urls.get(rec.id);
}
export function releaseUrls() { for (const u of urls.values()) URL.revokeObjectURL(u); urls.clear(); }

/**
 * Read an uploaded picture and re-encode it (at most `maxPx` on the long side) so stored
 * images are small and their size is known. PNG stays PNG (keeps transparency).
 * Returns { blob, width, height, ext }.
 */
export async function readImage(file, maxPx = 2400) {
  const bmp = await createImageBitmap(file);
  const scale = Math.min(1, maxPx / Math.max(bmp.width, bmp.height));
  const w = Math.max(1, Math.round(bmp.width * scale)), h = Math.max(1, Math.round(bmp.height * scale));
  const canvas = document.createElement("canvas");
  canvas.width = w; canvas.height = h;
  const ctx = canvas.getContext("2d");
  const png = file.type === "image/png";
  if (!png) { ctx.fillStyle = "#fff"; ctx.fillRect(0, 0, w, h); }
  ctx.drawImage(bmp, 0, 0, w, h);
  bmp.close?.();
  const type = png ? "image/png" : "image/jpeg";
  const blob = await new Promise((res) => canvas.toBlob(res, type, 0.92));
  return { blob, width: w, height: h, ext: png ? "png" : "jpg" };
}
