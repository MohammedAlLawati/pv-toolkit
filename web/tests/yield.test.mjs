// The yield model's building blocks against pvlib (fixture: tools/make_yield_fixture.py),
// the weather readers, and the whole year on a synthetic site.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { airMass, cosIncidence, diffuseIam, iamAshrae, perezDiffuse, sunPosition, extraRadiation, dayOfYear } from "../js/yield/solar.js";
import { cellTemp, inverterAc, settingsWithDefaults, simulate } from "../js/yield/model.js";
import { parseWeather, pvgisTmyUrl } from "../js/yield/weather.js";

const fx = JSON.parse(readFileSync(new URL("./fixtures/yield_cases.json", import.meta.url)));
const RAD = Math.PI / 180;

test("sun position matches pvlib (NREL SPA) within 0.02°", () => {
  let worst = 0;
  for (const c of fx.cases) {
    const s = sunPosition(c.ms, c.lat, c.lon);
    const dAz = Math.abs(((s.azimuth - c.azimuth + 540) % 360) - 180);
    worst = Math.max(worst, Math.abs(s.zenith - c.zenith), c.zenith < 88 ? dAz * Math.sin(c.zenith * RAD) : 0);
  }
  assert.ok(worst < 0.02, `worst difference ${worst}°`);
});

test("extraterrestrial irradiance matches pvlib (Spencer)", () => {
  for (const c of fx.cases.slice(0, 200)) assert.ok(Math.abs(extraRadiation(dayOfYear(c.ms)) - c.dni_extra) < 0.05);
});

test("plane-of-array irradiance matches pvlib's Perez model", () => {
  let n = 0;
  for (const c of fx.cases) {
    // pvlib's sun angles, so this checks the transposition alone
    const cosA = cosIncidence(c.tilt, c.az, c.zenith, c.azimuth);
    assert.ok(Math.abs(Math.acos(Math.max(-1, Math.min(1, cosA))) / RAD - c.aoi) < 1e-6);
    const beam = c.dni * Math.max(cosA, 0);
    const sky = perezDiffuse(c.tilt, cosA, c.dhi, c.dni, c.dni_extra, c.zenith).total;
    const gnd = c.ghi * c.albedo * (1 - Math.cos(c.tilt * RAD)) / 2;
    assert.ok(Math.abs(beam - c.poa_direct) < 1e-6, "beam");
    assert.ok(Math.abs(gnd - c.poa_ground) < 1e-6, "ground");
    // pvlib bins exactly-on-the-edge clearness the same way; allow a hair for float noise
    assert.ok(Math.abs(sky - c.poa_sky) < 0.01 + 1e-4 * c.poa_sky, `sky ${sky} vs ${c.poa_sky} at ${JSON.stringify(c)}`);
    n++;
  }
  assert.ok(n > 1000);
});

test("air mass is Kasten & Young", () => {
  assert.ok(Math.abs(airMass(0) - 0.99971) < 1e-5);
  assert.ok(Math.abs(airMass(60) - 1.9942) < 1e-3);
  assert.ok(Number.isNaN(airMass(95)));
});

test("incidence angle modifiers match pvlib", () => {
  for (const b of fx.iam_beam) assert.ok(Math.abs(iamAshrae(Math.cos(b.aoi * RAD), b.b0) - b.iam) < 1e-9, `aoi ${b.aoi}`);
  for (const d of fx.iam_diffuse) {
    const mine = diffuseIam(d.tilt, d.b0);
    assert.ok(Math.abs(mine.sky - d.sky) < 0.003, `sky at ${d.tilt}°: ${mine.sky} vs ${d.sky}`);
    if (d.tilt >= 10) assert.ok(Math.abs(mine.ground - d.ground) < 0.01, `ground at ${d.tilt}°: ${mine.ground} vs ${d.ground}`);
  }
});

test("cell temperature and inverter match pvlib", () => {
  for (const t of fx.temps) assert.ok(Math.abs(cellTemp(t.g, t.ta, t.ws, t.uc, t.uv, t.eff) - t.tc) < 1e-9);
  for (const v of fx.inverter) assert.ok(Math.abs(Math.min(inverterAc(v.pdc, v.pac0, v.eta), v.pac0) - v.pac) < 1e-6, JSON.stringify(v));
});

// ---- weather files -----------------------------------------------------------------------

/** A clear-sky-ish synthetic year (PVGIS JSON, CSV and EPW text) for a site. */
function synthetic(lat, lon, offset = 0.1761) {
  const rows = [];
  for (let d = 0; d < 365; d++) {
    for (let h = 0; h < 24; h++) {
      const ms = Date.UTC(2019, 0, 1 + d, h) + offset * 3600000;
      const s = sunPosition(ms, lat, lon);
      const cz = Math.max(0, Math.cos(s.zenith * RAD));
      const dni = cz > 0.02 ? 900 * Math.exp(-0.15 / cz) : 0;
      const dhi = cz > 0 ? 60 + 40 * cz : 0;
      rows.push({ dt: new Date(Date.UTC(2019, 0, 1 + d, h)), ghi: dni * cz + dhi, dni, dhi, t: 20 + 10 * cz + 8 * Math.sin((d / 365) * 2 * Math.PI - 1.8), ws: 2 });
    }
  }
  const p2 = (n) => String(n).padStart(2, "0");
  const st = (x) => `${x.getUTCFullYear()}${p2(x.getUTCMonth() + 1)}${p2(x.getUTCDate())}:${p2(x.getUTCHours())}00`;
  const r2 = (v) => Math.round(v * 100) / 100;
  const json = JSON.stringify({ inputs: { location: { latitude: lat, longitude: lon, elevation: 10, irradiance_time_offset: offset }, meteo_data: { radiation_db: "TEST" } },
    outputs: { months_selected: [], tmy_hourly: rows.map((r) => ({ "time(UTC)": st(r.dt), T2m: r2(r.t), RH: 50, "G(h)": r2(r.ghi), "Gb(n)": r2(r.dni), "Gd(h)": r2(r.dhi), "IR(h)": 300, WS10m: r.ws, WD10m: 0, SP: 101325 })) } });
  const csv = [`Latitude (decimal degrees): ${lat}`, `Longitude (decimal degrees): ${lon}`, "Elevation (m): 10", `Irradiance Time Offset (h): ${offset}`, "month,year",
    "time(UTC),T2m,RH,G(h),Gb(n),Gd(h),IR(h),WS10m,WD10m,SP",
    ...rows.map((r) => `${st(r.dt)},${r2(r.t)},50,${r2(r.ghi)},${r2(r.dni)},${r2(r.dhi)},300,${r.ws},0,101325`), "", "T2m: 2-m air temperature"].join("\n");
  // EPW from PVGIS: hour-ending stamps in UTC, offset in a comment
  const epw = [`LOCATION,unknown,-,unknown,ECMWF/ERA,unknown,${lat},${lon},1,10`, "DESIGN CONDITIONS,0", "TYPICAL/EXTREME PERIODS,0", "GROUND TEMPERATURES,0",
    "HOLIDAYS/DAYLIGHT SAVING,No,0,0,0", "COMMENTS 1,test", `COMMENTS 2,Irradiance Time Offset (h):${offset - 1}`, "DATA PERIODS,1,1,Data,Tuesday, 1/ 1,12/31",
    ...rows.map((r) => { const e = new Date(r.dt.getTime() + 3600000); const sameDay = e.getUTCHours() === 0 ? r.dt : e;
      return [2019, sameDay.getUTCMonth() + 1, sameDay.getUTCDate(), e.getUTCHours() || 24, 0, "x", r2(r.t), 5, 50, 101325, 9999, 9999, 300, r2(r.ghi), r2(r.dni), r2(r.dhi), 0, 0, 0, 0, 0, r.ws, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0].join(","); })].join("\n");
  return { json, csv, epw };
}

test("PVGIS JSON, CSV and EPW files read the same", () => {
  const f = synthetic(23.588, 58.383);
  const [a, b, c] = [f.json, f.csv, f.epw].map((t) => parseWeather(t));
  for (const w of [a, b, c]) {
    assert.equal(w.time.length, 8760);
    assert.equal(w.lat, 23.588);
    assert.equal(new Date(w.time[0]).toISOString(), "2019-01-01T00:10:33.960Z");
  }
  for (const k of ["ghi", "dni", "dhi", "tamb", "month"]) { assert.deepEqual(b[k], a[k], k); assert.deepEqual(c[k], a[k], k); }
  assert.deepEqual(c.time, a.time);
  assert.throws(() => parseWeather("hello"), /doesn't look like/);
  assert.throws(() => parseWeather(f.csv.split("\n").slice(0, 400).join("\n")), /8,760/);
  assert.match(pvgisTmyUrl(23.5, 58.4), /tmy\?lat=23\.5000&lon=58\.4000&outputformat=json/);
});

test("a plain EPW (local standard time, hour ending) places the sun at mid-hour", () => {
  const lines = synthetic(23.588, 58.383).epw.split("\n").filter((l) => !/Irradiance Time Offset/.test(l));
  lines[0] = lines[0].replace(",1,10", ",4,10");
  const w = parseWeather(lines.join("\n"));
  // hour ending 01:00 local (UTC+4) = 20:30 UTC the day before
  assert.equal(new Date(w.time[0]).toISOString(), "2018-12-31T20:30:00.000Z");
});

// ---- the whole year ------------------------------------------------------------------------

const SYS = { lat: 23.588, lon: 58.383, tilt: 20, azimuth: 180, modules: 200, module_wp: 600, dc_wp: 120000, gamma: -0.003,
              module_eff: 0.22, bifaciality: 0.8, inverters: 1, inverter_kw: 100, ac_w: 100000, inv_eff: 0.983, dc_drop_pct: null, ac_drop_pct: null };

test("a year adds up: monthly sums, loss chain and PR", () => {
  const w = parseWeather(synthetic(SYS.lat, SYS.lon).json);
  const r = simulate(w, SYS, settingsWithDefaults({}));
  const sum = r.monthly.reduce((a, m) => a + m.e_grid, 0);
  assert.ok(Math.abs(sum - r.year.e_grid) < 1e-6);
  assert.ok(r.year.pr > 0.7 && r.year.pr < 0.9, `PR ${r.year.pr}`);
  assert.ok(r.year.e_grid < r.year.e_array);
  // chaining every step's % from the array nominal energy gives the grid energy
  const i0 = r.losses.findIndex((l) => l.kind === "start-e");
  let e = r.losses[i0].value;
  for (const l of r.losses.slice(i0 + 1)) if (l.kind === "e") e *= 1 + l.pct / 100;
  assert.ok(Math.abs(e - r.year.e_grid) / r.year.e_grid < 1e-9);
  // hot site: the temperature loss is real, and soiling takes exactly its share
  const temp = r.losses.find((l) => l.label === "Module temperature");
  assert.ok(temp.pct < -4, `temperature ${temp.pct}`);
  assert.ok(Math.abs(r.losses.find((l) => l.label === "Soiling").pct + 2) < 1e-9);
});

test("settings move the result the right way", () => {
  const w = parseWeather(synthetic(SYS.lat, SYS.lon).json);
  const base = simulate(w, SYS, settingsWithDefaults({})).year.e_grid;
  const run = (cfg, sys = SYS) => simulate(w, sys, settingsWithDefaults(cfg)).year.e_grid;
  assert.ok(Math.abs(run({ availability_pct: 1 }) / base - 0.99) < 1e-9);
  assert.ok(run({ soiling_pct: 5 }) < base);
  assert.ok(run({ bifacial: true }) > base * 1.02);
  assert.ok(run({ mount: "semi" }) < base);
  assert.ok(run({}, { ...SYS, ac_w: 60000 }) < base * 0.95, "clipping at DC/AC 2");
  assert.ok(run({ shading_pct: 3 }) < base * 0.975);
  // facing north at 23.6° N loses a lot
  assert.ok(run({}, { ...SYS, azimuth: 0, tilt: 30 }) < base * 0.85);
});
