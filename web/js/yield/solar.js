// Sun position and irradiance on a tilted plane.
//
// - Sun position: NOAA's solar calculator equations (Meeus), within about 0.01° for 1950–2050,
//   with NOAA's refraction correction for the apparent elevation.
// - Extraterrestrial irradiance: Spencer (1971), as pvlib's default.
// - Sky diffuse on the plane: Perez et al. (1990), all-sites composite coefficients, with the
//   Kasten & Young (1989) air mass, as pvlib's `perez` (and PVsyst's default).
// Angles are in degrees at the interface. Azimuths are clockwise from north (180 = south).

const RAD = Math.PI / 180;
const DEG = 180 / Math.PI;
const mod = (a, n) => ((a % n) + n) % n;

/** Sun position at a UTC instant (ms since 1970). Returns { zenith, azimuth, elevation } (apparent). */
export function sunPosition(ms, lat, lon) {
  const jd = ms / 86400000 + 2440587.5;
  const T = (jd - 2451545) / 36525;
  const L0 = mod(280.46646 + T * (36000.76983 + T * 0.0003032), 360);
  const M = 357.52911 + T * (35999.05029 - 0.0001537 * T);
  const e = 0.016708634 - T * (0.000042037 + 0.0000001267 * T);
  const Mr = M * RAD;
  const C = Math.sin(Mr) * (1.914602 - T * (0.004817 + 0.000014 * T)) + Math.sin(2 * Mr) * (0.019993 - 0.000101 * T)
          + Math.sin(3 * Mr) * 0.000289;
  const omega = (125.04 - 1934.136 * T) * RAD;
  const lambda = (L0 + C - 0.00569 - 0.00478 * Math.sin(omega)) * RAD;
  const eps0 = 23 + (26 + (21.448 - T * (46.815 + T * (0.00059 - T * 0.001813))) / 60) / 60;
  const eps = (eps0 + 0.00256 * Math.cos(omega)) * RAD;
  const decl = Math.asin(Math.sin(eps) * Math.sin(lambda));
  const y = Math.tan(eps / 2) ** 2;
  const L0r = L0 * RAD;
  const eot = 4 * DEG * (y * Math.sin(2 * L0r) - 2 * e * Math.sin(Mr) + 4 * e * y * Math.sin(Mr) * Math.cos(2 * L0r)
                         - 0.5 * y * y * Math.sin(4 * L0r) - 1.25 * e * e * Math.sin(2 * Mr)); // minutes
  const minutes = mod(ms / 60000, 1440);
  const tst = minutes + eot + 4 * lon;
  const ha = (tst / 4 - 180) * RAD;
  const phi = lat * RAD;
  const cosZ = Math.max(-1, Math.min(1, Math.sin(phi) * Math.sin(decl) + Math.cos(phi) * Math.cos(decl) * Math.cos(ha)));
  const zen = Math.acos(cosZ) * DEG;
  const az = mod(Math.atan2(Math.sin(ha), Math.cos(ha) * Math.sin(phi) - Math.tan(decl) * Math.cos(phi)) * DEG + 180, 360);
  const el = 90 - zen;
  return { zenith: 90 - (el + refraction(el)), azimuth: az, elevation: el + refraction(el) };
}

/** NOAA's atmospheric refraction correction (degrees) for a true elevation in degrees. */
function refraction(el) {
  if (el > 85) return 0;
  const te = Math.tan(el * RAD);
  let r;
  if (el > 5) r = 58.1 / te - 0.07 / te ** 3 + 0.000086 / te ** 5;
  else if (el > -0.575) r = 1735 + el * (-518.2 + el * (103.4 + el * (-12.79 + el * 0.711)));
  else r = -20.772 / te;
  return r / 3600;
}

/** Extraterrestrial normal irradiance (W/m²) on a day of the year (1–366). */
export function extraRadiation(doy) {
  const b = (2 * Math.PI * (doy - 1)) / 365;
  return 1366.1 * (1.00011 + 0.034221 * Math.cos(b) + 0.00128 * Math.sin(b) + 0.000719 * Math.cos(2 * b) + 0.000077 * Math.sin(2 * b));
}

export function dayOfYear(ms) {
  const d = new Date(ms);
  return Math.floor((ms - Date.UTC(d.getUTCFullYear(), 0, 1)) / 86400000) + 1;
}

/** Relative air mass, Kasten & Young (1989). NaN with the sun below the horizon. */
export function airMass(zenith) {
  if (zenith >= 90) return NaN;
  return 1 / (Math.cos(zenith * RAD) + 0.50572 * (96.07995 - zenith) ** -1.6364);
}

/** Cosine of the angle of incidence on a plane (tilt, azimuth) for a sun (zenith, azimuth). */
export function cosIncidence(tilt, surfAz, zenith, sunAz) {
  const t = tilt * RAD, z = zenith * RAD;
  return Math.cos(z) * Math.cos(t) + Math.sin(z) * Math.sin(t) * Math.cos((sunAz - surfAz) * RAD);
}

// Perez et al. 1990, Table 6 ("allsitescomposite1990" in pvlib): [f11, f12, f13, f21, f22, f23] for the 8 clearness bins.
const PEREZ = [
  [-0.008, 0.588, -0.062, -0.06, 0.072, -0.022],
  [0.13, 0.683, -0.151, -0.019, 0.066, -0.029],
  [0.33, 0.487, -0.221, 0.055, -0.064, -0.026],
  [0.568, 0.187, -0.295, 0.109, -0.152, -0.014],
  [0.873, -0.392, -0.362, 0.226, -0.462, 0.001],
  [1.132, -1.237, -0.412, 0.288, -0.823, 0.056],
  [1.06, -1.6, -0.359, 0.264, -1.127, 0.131],
  [0.678, -0.327, -0.25, 0.156, -1.377, 0.251],
];
const PEREZ_BINS = [1.065, 1.23, 1.5, 1.95, 2.8, 4.5, 6.2];

/**
 * Sky diffuse on a tilted plane (W/m²), Perez 1990. With the sun below the horizon (where the
 * model is undefined) the isotropic sky is used, which only matters for twilight diffuse.
 * Returns { total, circumsolar } so the circumsolar part can be treated like beam.
 */
export function perezDiffuse(tilt, cosAoi, dhi, dni, dniExtra, zenith) {
  if (!(dhi > 0)) return { total: 0, circumsolar: 0 };
  const iso = dhi * (1 + Math.cos(tilt * RAD)) / 2;
  if (zenith >= 90) return { total: iso, circumsolar: 0 };
  const z = zenith * RAD;
  const kz3 = 1.041 * z ** 3;
  const eps = ((dhi + dni) / dhi + kz3) / (1 + kz3);
  let bin = 0;
  while (bin < PEREZ_BINS.length && eps >= PEREZ_BINS[bin]) bin++;
  const [f11, f12, f13, f21, f22, f23] = PEREZ[bin];
  const delta = (dhi * airMass(zenith)) / dniExtra;
  const F1 = Math.max(f11 + f12 * delta + f13 * z, 0);
  const F2 = f21 + f22 * delta + f23 * z;
  const A = Math.max(cosAoi, 0);
  const B = Math.max(Math.cos(z), Math.cos(85 * RAD));
  const iso1 = 0.5 * (1 - F1) * (1 + Math.cos(tilt * RAD));
  const circ = (F1 * A) / B;
  const hor = F2 * Math.sin(tilt * RAD);
  const total = Math.max(dhi * (iso1 + circ + hor), 0);
  return { total, circumsolar: Math.min(total, dhi * circ) };
}

/** ASHRAE incidence angle modifier, 1 − b0 (1/cos θ − 1), clipped to 0…1. */
export function iamAshrae(cosAoi, b0) {
  if (cosAoi <= 0) return 0;
  return Math.max(0, Math.min(1, 1 - b0 * (1 / cosAoi - 1)));
}

/**
 * Average IAM for isotropic light from the sky dome and from the ground, as seen by a plane
 * at `tilt`: integrates iam(θ)·cos θ over the directions the plane sees on each side of the horizon.
 */
export function diffuseIam(tilt, b0) {
  const t = tilt * RAD;
  // plane normal in a frame with z up: n = (sin t, 0, cos t)
  let skyW = 0, skyI = 0, gndW = 0, gndI = 0;
  const N = 90, P = 180;
  for (let i = 0; i < N; i++) {
    const th = ((i + 0.5) / N) * (Math.PI / 2);
    const w0 = Math.cos(th) * Math.sin(th);
    const iam = iamAshrae(Math.cos(th), b0);
    for (let j = 0; j < P; j++) {
      const ph = ((j + 0.5) / P) * 2 * Math.PI;
      // direction in plane coordinates, rotated into the horizon frame (vertical component only)
      const up = Math.cos(th) * Math.cos(t) - Math.sin(th) * Math.cos(ph) * Math.sin(t);
      if (up >= 0) { skyW += w0; skyI += w0 * iam; } else { gndW += w0; gndI += w0 * iam; }
    }
  }
  return { sky: skyW ? skyI / skyW : 1, ground: gndW ? gndI / gndW : 1 };
}
