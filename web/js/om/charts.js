// O&M report charts, drawn as SVG (so they can be checked without a browser) and turned into
// PNG for the Word file by toPng() in the browser.
//
// Colours follow the HTC logo: blue and charcoal, with green kept for generation and trees.

export const COLORS = {
  blue: "#1650A6", charcoal: "#2C2E35", grey: "#5D6465", light: "#B1B2B3", grid: "#E4E5E6",
  green: "#2E7D32", greenLight: "#A5C8A7", trunk: "#7C4A1E", steel: "#788CBF",
};
const FONT = "Calibri, Carlito, 'Segoe UI', Arial, sans-serif";

export const CHART_W = 1300, CHART_H = 600;

const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

/** A round axis maximum and step for values up to `max`. */
export function niceScale(max, ticks = 5) {
  if (!(max > 0)) return { top: 1, step: 0.2 };
  const raw = max / ticks, mag = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 2.5, 5, 10].map((f) => f * mag).find((s) => s >= raw);
  return { top: Math.ceil(max / step) * step, step };
}

const fmtTick = (v) => (Math.abs(v) >= 1000 ? Math.round(v).toLocaleString("en-US") : String(Number(v.toFixed(2))));

function frame(w, h, body) {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}" font-family="${FONT}">`
    + `<rect width="${w}" height="${h}" fill="#ffffff"/>${body}</svg>`;
}

/**
 * Bar chart. bars: [{ label, value (null = n/a), color? }]. Options: ylabel, color, dp (bar label
 * decimals), line: { values, color, label, dp } on a right-hand axis, legend: [{ color, label, line? }].
 */
export function barChart(bars, { ylabel = "", color = COLORS.blue, dp = 1, line = null, legend = null, w = CHART_W, h = CHART_H } = {}) {
  const L = 120, R = line ? 120 : 40, T = 40, B = legend ? 130 : 80;
  const pw = w - L - R, ph = h - T - B;
  const vals = bars.map((b) => (Number.isFinite(b.value) ? b.value : 0));
  const s = niceScale(Math.max(...vals, 0) * 1.08);
  const y = (v) => T + ph - (v / s.top) * ph;
  let out = "";
  for (let v = 0; v <= s.top + 1e-9; v += s.step) {
    out += `<line x1="${L}" x2="${L + pw}" y1="${y(v)}" y2="${y(v)}" stroke="${COLORS.grid}" stroke-width="1.5"/>`;
    out += `<text x="${L - 14}" y="${y(v) + 9}" font-size="26" fill="${COLORS.charcoal}" text-anchor="end">${fmtTick(v)}</text>`;
  }
  out += `<line x1="${L}" x2="${L}" y1="${T}" y2="${T + ph}" stroke="${COLORS.light}" stroke-width="2"/>`;
  out += `<line x1="${L}" x2="${L + pw}" y1="${T + ph}" y2="${T + ph}" stroke="${COLORS.light}" stroke-width="2"/>`;
  out += `<text transform="translate(34 ${T + ph / 2}) rotate(-90)" font-size="26" fill="${COLORS.charcoal}" text-anchor="middle">${esc(ylabel)}</text>`;
  const n = Math.max(bars.length, 1), slot = pw / n, bw = Math.min(slot * 0.6, 110);
  bars.forEach((b, i) => {
    const cx = L + slot * (i + 0.5);
    if (Number.isFinite(b.value)) {
      out += `<rect x="${cx - bw / 2}" y="${y(b.value)}" width="${bw}" height="${T + ph - y(b.value)}" fill="${b.color || color}"/>`;
      out += `<text x="${cx}" y="${y(b.value) - 10}" font-size="24" fill="${COLORS.charcoal}" text-anchor="middle">${b.value.toFixed(dp)}</text>`;
    } else {
      out += `<text x="${cx}" y="${T + ph - 10}" font-size="24" fill="${COLORS.grey}" text-anchor="middle">n/a</text>`;
    }
    out += `<text x="${cx}" y="${T + ph + 38}" font-size="26" fill="${COLORS.charcoal}" text-anchor="middle">${esc(b.label)}</text>`;
  });
  if (line) {
    const ls = niceScale(Math.max(...line.values, 0) * 1.12);
    const ly = (v) => T + ph - (v / ls.top) * ph;
    for (let v = 0; v <= ls.top + 1e-9; v += ls.step) {
      out += `<text x="${L + pw + 14}" y="${ly(v) + 9}" font-size="26" fill="${COLORS.charcoal}">${fmtTick(v)}</text>`;
    }
    out += `<line x1="${L + pw}" x2="${L + pw}" y1="${T}" y2="${T + ph}" stroke="${COLORS.light}" stroke-width="2"/>`;
    if (line.ylabel) out += `<text transform="translate(${w - 24} ${T + ph / 2}) rotate(90)" font-size="26" fill="${COLORS.charcoal}" text-anchor="middle">${esc(line.ylabel)}</text>`;
    const pts = line.values.map((v, i) => `${L + slot * (i + 0.5)},${ly(v)}`);
    out += `<polyline points="${pts.join(" ")}" fill="none" stroke="${line.color}" stroke-width="4"/>`;
    for (const p of pts) { const [px, py] = p.split(","); out += `<circle cx="${px}" cy="${py}" r="7" fill="${line.color}"/>`; }
    const last = line.values[line.values.length - 1];
    if (Number.isFinite(last)) out += `<text x="${L + slot * (line.values.length - 0.5)}" y="${ly(last) - 16}" font-size="24" fill="${line.color}" text-anchor="middle">${last.toFixed(line.dp ?? 1)}</text>`;
  }
  if (legend) {
    const items = legend.map((it) => ({ ...it, width: 60 + it.label.length * 13 }));
    let x = L + pw / 2 - items.reduce((a, it) => a + it.width, 0) / 2;
    const ly = h - 40;
    for (const it of items) {
      out += it.line ? `<line x1="${x}" x2="${x + 36}" y1="${ly - 8}" y2="${ly - 8}" stroke="${it.color}" stroke-width="4"/><circle cx="${x + 18}" cy="${ly - 8}" r="6" fill="${it.color}"/>`
        : `<rect x="${x}" y="${ly - 22}" width="30" height="26" fill="${it.color}"/>`;
      out += `<text x="${x + 46}" y="${ly}" font-size="24" fill="${COLORS.charcoal}">${esc(it.label)}</text>`;
      x += it.width;
    }
  }
  return frame(w, h, out);
}

/** Tree pictogram: one row per month, 1 icon = TREES_PER_ICON trees, a part icon for the rest. */
export function treeChart(rows, per = 100, { w = CHART_W } = {}) {
  const rowH = 64, T = 20, B = 60, L = 110;
  const maxIcons = Math.max(1, ...rows.map((r) => Math.ceil(r.trees / per)));
  const iconW = Math.min(52, (w - L - 220) / maxIcons);
  const h = T + rows.length * rowH + B;
  let out = "";
  rows.forEach((r, i) => {
    const cy = T + i * rowH + rowH / 2;
    out += `<text x="${L - 20}" y="${cy + 9}" font-size="26" font-weight="bold" fill="${COLORS.blue}" text-anchor="end">${esc(r.label)}</text>`;
    const full = Math.floor(r.trees / per), rest = r.trees / per - full;
    const n = full + (rest > 0.05 ? 1 : 0);
    for (let k = 0; k < n; k++) {
      const cx = L + iconW * (k + 0.5), part = k >= full;
      const fill = part ? COLORS.greenLight : COLORS.green;
      out += `<rect x="${cx - 3.5}" y="${cy + 12}" width="7" height="14" fill="${COLORS.trunk}" opacity="${part ? 0.5 : 1}"/>`;
      out += `<polygon points="${cx - iconW * 0.36},${cy + 14} ${cx + iconW * 0.36},${cy + 14} ${cx},${cy - 26}" fill="${fill}"/>`;
    }
    out += `<text x="${L + iconW * maxIcons + 24}" y="${cy + 9}" font-size="24" fill="${COLORS.grey}">${Math.round(r.trees).toLocaleString("en-US")} trees</text>`;
  });
  out += `<text x="${w / 2}" y="${h - 18}" font-size="22" fill="${COLORS.grey}" text-anchor="middle">1 icon = ${per} trees (annual CO₂ absorption equivalent)</text>`;
  return frame(w, h, out);
}

/** The five report charts as SVG strings. */
export function reportCharts(calc) {
  const ms = calc.months;
  const lab = (d) => d.label + (d.partial ? "*" : d.mtd ? "†" : "");
  let cum = 0;
  const cumCo2 = ms.map((d) => (cum += d.co2 / 1000));
  return {
    gen: barChart(ms.map((d) => ({ label: lab(d), value: d.energy / 1000 })), { ylabel: "Monthly generation (MWh)", color: COLORS.green }),
    pr: barChart(ms.map((d) => ({ label: lab(d), value: d.pr, color: d.pr_calc ? COLORS.light : undefined })), { ylabel: "Performance ratio (%)", color: COLORS.charcoal }),
    irr: barChart(ms.map((d) => ({ label: lab(d), value: d.irr, color: d.irr_est ? COLORS.steel : undefined })), { ylabel: "Irradiation (kWh/m²)", color: COLORS.blue }),
    co2: barChart(ms.map((d) => ({ label: lab(d), value: d.co2 / 1000 })), {
      ylabel: "Monthly CO₂ avoided (t)", color: COLORS.blue,
      line: { values: cumCo2, color: COLORS.charcoal, ylabel: "Cumulative (t)" },
      legend: [{ color: COLORS.blue, label: "Monthly CO₂ avoided (t)" }, { color: COLORS.charcoal, label: "Cumulative CO₂ avoided (t)", line: true }],
    }),
    trees: treeChart(ms.map((d) => ({ label: d.label, trees: d.trees }))),
  };
}

/** Size of an SVG string from its width/height attributes. */
export function svgSize(svg) {
  const w = Number((svg.match(/\bwidth="(\d+(?:\.\d+)?)"/) || [])[1]) || CHART_W;
  const h = Number((svg.match(/\bheight="(\d+(?:\.\d+)?)"/) || [])[1]) || CHART_H;
  return { width: w, height: h };
}

/** Browser only: rasterise an SVG string to PNG bytes. */
export async function toPng(svg) {
  const { width, height } = svgSize(svg);
  const url = URL.createObjectURL(new Blob([svg], { type: "image/svg+xml" }));
  try {
    const img = new Image();
    img.decoding = "sync";
    await new Promise((res, rej) => { img.onload = res; img.onerror = () => rej(new Error("Couldn't draw a chart")); img.src = url; });
    const canvas = document.createElement("canvas");
    canvas.width = width; canvas.height = height;
    canvas.getContext("2d").drawImage(img, 0, 0, width, height);
    const blob = await new Promise((res) => canvas.toBlob(res, "image/png"));
    return { data: new Uint8Array(await blob.arrayBuffer()), width, height };
  } finally { URL.revokeObjectURL(url); }
}
