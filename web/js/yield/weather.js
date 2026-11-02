// Hourly weather for the yield simulation: PVGIS typical-year files (JSON or CSV) and EPW files.
//
// The result is the same whatever the source:
//   { source, name, lat, lon, elevation, offset_h, years,
//     time: [ms UTC at which to place the sun for each hour], ghi, dni, dhi, tamb, wind }
//
// PVGIS TMY rows are stamped HH:00 UTC; since PVGIS 5.3 the file gives the irradiance time
// offset (about 0.17 h: the satellite image time), which is added before placing the sun.
// EPW rows are hour-ending in local standard time, so the sun is placed half an hour earlier,
// except for PVGIS's own EPW export, which is in UTC and states its offset in a comment.
//
// PVGIS doesn't let a web page call it directly (no CORS), so the app links to the file and
// the user drops the downloaded file back in.

export const PVGIS_API = "https://re.jrc.ec.europa.eu/api/v5_3/";
export const PVGIS_SITE = "https://re.jrc.ec.europa.eu/pvg_tools/en/";

/** A link that downloads the PVGIS typical year for a site, as a JSON file. */
export function pvgisTmyUrl(lat, lon) {
  return `${PVGIS_API}tmy?lat=${Number(lat).toFixed(4)}&lon=${Number(lon).toFixed(4)}&outputformat=json&browser=1`;
}

/** Read a weather file's text; `name` is only used to label it. Throws with a readable message. */
export function parseWeather(text, name = "") {
  const t = text.replace(/^﻿/, "").trimStart();
  if (t.startsWith("{")) return fromPvgisJson(JSON.parse(t), name);
  if (/^LOCATION,/i.test(t)) return fromEpw(t, name);
  if (/time\(UTC\)/.test(t)) return fromPvgisCsv(t, name);
  throw new Error("This doesn't look like a PVGIS typical-year file (JSON or CSV) or an EPW file.");
}

const stamp = (s) => {
  const m = /^(\d{4})(\d{2})(\d{2}):(\d{2})(\d{2})$/.exec(String(s).trim());
  if (!m) throw new Error(`Unexpected time "${s}" in the PVGIS file.`);
  return { y: +m[1], mo: +m[2], d: +m[3], h: +m[4], mi: +m[5] };
};

/**
 * Typical-year rows come from different years (one per month). They are put on one
 * calendar year in order, keeping month, day and hour, so months and days of the year line up.
 */
function finish(w, rows) {
  if (rows.length < 8760) throw new Error(`The file has ${rows.length} hours; a full year (8,760) is needed.`);
  rows.sort((a, b) => a.mo - b.mo || a.d - b.d || a.h - b.h || a.mi - b.mi);
  const keep = rows.filter((r) => !(r.mo === 2 && r.d === 29)).slice(0, 8760);
  const YEAR = 2019; // any non-leap year
  const off = (w.offset_h || 0) * 3600000;
  const out = { ...w, time: [], month: [], ghi: [], dni: [], dhi: [], tamb: [], wind: [] };
  for (const r of keep) {
    out.time.push(Date.UTC(YEAR, r.mo - 1, r.d, r.h, r.mi) + off + (r.shift_ms || 0));
    out.month.push(r.mo - 1);
    out.ghi.push(Math.max(0, r.ghi));
    out.dni.push(Math.max(0, r.dni));
    out.dhi.push(Math.max(0, r.dhi));
    out.tamb.push(r.tamb);
    out.wind.push(Math.max(0, r.wind || 0));
  }
  return out;
}

function fromPvgisJson(j, name) {
  const rows = j?.outputs?.tmy_hourly;
  const loc = j?.inputs?.location || {};
  if (!Array.isArray(rows)) throw new Error("This JSON file isn't a PVGIS typical-year (TMY) file.");
  const md = j.inputs?.meteo_data || {};
  return finish({
    source: `PVGIS TMY (${[md.radiation_db, md.meteo_db].filter(Boolean).join(" / ") || "PVGIS"}${md.year_min ? `, ${md.year_min}–${md.year_max}` : ""})`,
    name, lat: loc.latitude, lon: loc.longitude, elevation: loc.elevation ?? null,
    offset_h: Number(loc.irradiance_time_offset) || 0,
    years: (j.outputs.months_selected || []).map((x) => x.year),
  }, rows.map((r) => ({ ...stamp(r["time(UTC)"]), ghi: r["G(h)"], dni: r["Gb(n)"], dhi: r["Gd(h)"], tamb: r.T2m, wind: r.WS10m })));
}

function fromPvgisCsv(text, name) {
  const lines = text.split(/\r?\n/);
  const head = (re) => { const l = lines.find((x) => re.test(x)); return l ? Number(l.split(":").pop()) : null; };
  const i0 = lines.findIndex((l) => l.startsWith("time(UTC)"));
  const cols = lines[i0].split(",");
  const ix = (k) => { const i = cols.indexOf(k); if (i < 0) throw new Error(`The PVGIS file has no ${k} column.`); return i; };
  const [it, ig, ib, id, ita, iw] = ["time(UTC)", "G(h)", "Gb(n)", "Gd(h)", "T2m", "WS10m"].map(ix);
  const rows = [];
  for (let i = i0 + 1; i < lines.length; i++) {
    const c = lines[i].split(",");
    if (c.length < cols.length || !/^\d{8}:\d{4}$/.test(c[it])) break;
    rows.push({ ...stamp(c[it]), ghi: +c[ig], dni: +c[ib], dhi: +c[id], tamb: +c[ita], wind: +c[iw] });
  }
  return finish({ source: "PVGIS TMY", name, lat: head(/^Latitude/), lon: head(/^Longitude/), elevation: head(/^Elevation/),
                  offset_h: head(/^Irradiance Time Offset/) || 0, years: [] }, rows);
}

function fromEpw(text, name) {
  const lines = text.split(/\r?\n/);
  const loc = lines[0].split(",");
  const tz = Number(loc[8]);
  const comment = lines.find((l) => /Irradiance Time Offset/i.test(l));
  const pvgis = !!comment;
  const offset = pvgis ? Number(comment.split(":").pop()) : 0;
  const rows = [];
  const start = lines.findIndex((l) => /^DATA PERIODS/i.test(l)) + 1 || 8;
  for (const l of lines.slice(start)) {
    const c = l.split(",");
    if (c.length < 22) continue;
    // hour 1 = the hour ending at 01:00. Plain EPW: local standard time, sun at mid-hour.
    rows.push({ y: +c[0], mo: +c[1], d: +c[2], h: +c[3], mi: 0, shift_ms: pvgis ? 0 : -1800000 - tz * 3600000,
                ghi: +c[13], dni: +c[14], dhi: +c[15], tamb: +c[6], wind: +c[21] });
  }
  // a missing value in EPW is 9999 / 999.9
  for (const r of rows) for (const k of ["ghi", "dni", "dhi"]) if (r[k] >= 9999) r[k] = 0;
  return finish({ source: pvgis ? "PVGIS TMY (EPW)" : "EPW", name, lat: Number(loc[6]), lon: Number(loc[7]),
                  elevation: Number(loc[9]) || null, offset_h: offset, years: [] }, rows);
}

/** Compact copy for storage (numbers rounded; times rebuilt from the first one). */
export function pack(w) {
  const r1 = (a) => a.map((v) => Math.round(v * 10) / 10);
  return { ...w, ghi: r1(w.ghi), dni: r1(w.dni), dhi: r1(w.dhi), tamb: r1(w.tamb), wind: r1(w.wind) };
}

/** Distance in km between two sites (to warn when the file is for somewhere else). */
export function distanceKm(lat1, lon1, lat2, lon2) {
  const R = 6371, rad = Math.PI / 180;
  const a = Math.sin(((lat2 - lat1) * rad) / 2) ** 2
          + Math.cos(lat1 * rad) * Math.cos(lat2 * rad) * Math.sin(((lon2 - lon1) * rad) / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}
