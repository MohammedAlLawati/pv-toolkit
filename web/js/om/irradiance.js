// Irradiation for plants without a weather station: NASA POWER satellite data (free, no key,
// any use), hourly, put on the module plane with the same sun position and Perez sky model as
// the yield simulation. Sums are in kWh/m² per month, like the iSolarCloud export.
//
//   const est = await estimateIrradiation(site, [{ key: "2026-11", from: "2026-11-01", to: "2026-11-19" }]);
//   // { "2026-11": { irr, days, days_expected, filled, plane, source, fetched_at } }
//
// NASA POWER: https://power.larc.nasa.gov (CERES / FLASHFlux satellite data, about 1° grid,
// recent days follow with a few days' delay). A month with more than a fifth of its days missing
// is not estimated; a few missing days are filled with the month's average day, and said so.
import { cosIncidence, dayOfYear, extraRadiation, perezDiffuse, sunPosition } from "../yield/solar.js";

export const POWER_SITE = "https://power.larc.nasa.gov/data-access-viewer/";
export const SOURCE = "NASA POWER";
const PARAMS = ["ALLSKY_SFC_SW_DWN", "ALLSKY_SFC_SW_DNI", "ALLSKY_SFC_SW_DIFF"];
const ALBEDO = 0.2;
const MAX_MISSING = 0.2;

const ymd = (iso) => iso.replaceAll("-", "");

/** The NASA POWER hourly request for one point and date range ("YYYY-MM-DD"), in UTC hours. */
export function powerUrl(lat, lon, from, to) {
  return "https://power.larc.nasa.gov/api/temporal/hourly/point"
    + `?parameters=${PARAMS.join(",")}&community=RE&longitude=${Number(lon).toFixed(4)}&latitude=${Number(lat).toFixed(4)}`
    + `&start=${ymd(from)}&end=${ymd(to)}&time-standard=UTC&format=JSON`;
}

/** Days ("YYYY-MM-DD") from `from` to `to`, inclusive. */
function days(from, to) {
  const out = [];
  for (let t = Date.parse(`${from}T00:00:00Z`), end = Date.parse(`${to}T00:00:00Z`); t <= end; t += 86400000) out.push(new Date(t).toISOString().slice(0, 10));
  return out;
}

/**
 * Irradiation (kWh/m²) on the plane (tilt, azimuth) for the days from…to, from a NASA POWER hourly
 * JSON. Returns { irr, days, days_expected, filled } or { error }.
 */
export function sumPower(json, { lat, lon, tilt = 0, azimuth = 180 }, from, to) {
  const p = json?.properties?.parameter;
  if (!p?.ALLSKY_SFC_SW_DWN) return { error: "NASA POWER sent no irradiation." };
  const fill = Number(json?.header?.fill_value ?? -999);
  const ok = (v) => Number.isFinite(v) && v !== fill && v > -1;
  const flat = !(Number(tilt) > 0.5);
  const want = days(from, to);
  const perDay = new Map();
  for (const d of want) {
    let wh = 0, complete = true;
    for (let h = 0; h < 24; h++) {
      const k = `${ymd(d)}${String(h).padStart(2, "0")}`;
      const ghi = Number(p.ALLSKY_SFC_SW_DWN[k]);
      if (!ok(ghi)) { complete = false; break; }
      if (ghi <= 0) continue;
      if (flat) { wh += ghi; continue; }
      const dni = Number(p.ALLSKY_SFC_SW_DNI?.[k]), dhi = Number(p.ALLSKY_SFC_SW_DIFF?.[k]);
      if (!ok(dni) || !ok(dhi)) { complete = false; break; }
      const ms = Date.parse(`${d}T${String(h).padStart(2, "0")}:30:00Z`);
      const sun = sunPosition(ms, lat, lon);
      const cosA = cosIncidence(tilt, azimuth, sun.zenith, sun.azimuth);
      const up = sun.zenith < 90;
      const beam = up ? dni * Math.max(cosA, 0) : 0;
      const sky = perezDiffuse(tilt, cosA, dhi, up ? dni : 0, extraRadiation(dayOfYear(ms)), sun.zenith).total;
      const ground = ghi * ALBEDO * (1 - Math.cos((tilt * Math.PI) / 180)) / 2;
      wh += beam + sky + ground;
    }
    if (complete) perDay.set(d, wh);
  }
  const n = perDay.size, expected = want.length;
  if (!n || (expected - n) / expected > MAX_MISSING) {
    return { error: `NASA POWER has data for only ${n} of ${expected} day(s) from ${from} to ${to}${n ? "" : " yet"}.`, days: n, days_expected: expected };
  }
  const total = [...perDay.values()].reduce((a, v) => a + v, 0);
  return { irr: (total / n) * expected / 1000, days: n, days_expected: expected, filled: expected - n };
}

/**
 * Estimate the irradiation of each month in `months` ([{ key, from, to }]) for the site
 * (site.lat, site.lon, site.tilt, site.azimuth). One request per month. `fetchFn` for tests.
 */
export async function estimateIrradiation(site, months, fetchFn = globalThis.fetch) {
  if (!Number.isFinite(site.lat) || !Number.isFinite(site.lon)) throw new Error("Add the plant's latitude and longitude first.");
  const tilt = Number(site.tilt) || 0, azimuth = Number.isFinite(Number(site.azimuth)) ? Number(site.azimuth) : 180;
  const out = {}, problems = [];
  await Promise.all(months.map(async (m) => {
    let json;
    try {
      const res = await fetchFn(powerUrl(site.lat, site.lon, m.from, m.to));
      if (!res.ok) throw new Error(`NASA POWER answered ${res.status}`);
      json = await res.json();
    } catch (err) {
      problems.push(`${m.key}: ${err.message || "couldn't reach NASA POWER"}`);
      return;
    }
    const s = sumPower(json, { lat: site.lat, lon: site.lon, tilt, azimuth }, m.from, m.to);
    if (s.error) { problems.push(`${m.key}: ${s.error}`); return; }
    out[m.key] = { irr: s.irr, days: s.days, days_expected: s.days_expected, filled: s.filled, from: m.from, to: m.to,
      plane: tilt > 0.5 ? { tilt, azimuth } : null, source: SOURCE, fetched_at: new Date().toISOString() };
  }));
  return { estimates: out, problems };
}

/** Plain words for how an estimate was made, for the page and the report. */
export function describe(est) {
  return `${SOURCE} satellite data, ${est.plane ? `on the module plane (${est.plane.tilt}° tilt, ${est.plane.azimuth}° azimuth)` : "horizontal"}`
    + (est.filled ? `, ${est.filled} missing day(s) taken as the month's average` : "");
}
