// The client record: who the client is and what they asked for. Engineering, paperwork and
// offer details are added later by the tools (stringing, sizing, yield, documents, offers).
//
// clients store record:
//   client_type            "residential" | "commercial" | "other"
//   name                   homeowner's name or company name
//   signatory_name         commercial: authorised signatory
//   id_no                  commercial: commercial registration (C.R.) number
//   meter_numbers          [string] electricity meter numbers (residential: one)
//   location_url           the Google Maps link as pasted
//   latitude, longitude    numbers, read from the link or typed
//   procurement            commercial: "Tender", "Direct contact" or a user-added option
//   required_capacity_kw   number the client asked for, in the unit below
//   required_capacity_unit "dc" (kWp) | "ac" (kWac)
//   installation_types     [string] e.g. ["Carpark", "Elevated Flat Roof"]
//   connectivity           "on-grid" | "off-grid" | "hybrid"
//   voltage_level          "LV" | "MV" | "HV"
//   notes
//   stringing              written by the stringing calculator (kept as is here)

export const CLIENT_TYPES = { residential: "Residential", commercial: "Commercial", other: "Other" };
export const CONNECTIVITY = { "on-grid": "On-grid", "off-grid": "Off-grid", hybrid: "Hybrid" };
export const VOLTAGE_LEVELS = { LV: "LV (low voltage)", MV: "MV (medium voltage)", HV: "HV (high voltage)" };
export const PROCUREMENT = ["Tender", "Direct contact"];
export const CAPACITY_UNITS = { dc: "kWp (DC)", ac: "kWac (AC)" };

export const NEW_CLIENT = {
  client_type: "residential", name: "", meter_numbers: [], location_url: "", latitude: null, longitude: null,
  required_capacity_kw: null, required_capacity_unit: "dc", installation_types: [],
  connectivity: "on-grid", voltage_level: "LV", procurement: "", signatory_name: "", id_no: "", notes: "",
};

const inRange = (lat, lon) => Number.isFinite(lat) && Number.isFinite(lon) && Math.abs(lat) <= 90 && Math.abs(lon) <= 180 && !(lat === 0 && lon === 0);
const pair = (a, b) => { const lat = Number(a), lon = Number(b); return inRange(lat, lon) ? { lat, lon } : null; };
const NUM = "(-?\\d{1,3}(?:\\.\\d+)?)";

/**
 * Coordinates from a Google Maps link, or from typed "lat, lon".
 * Returns { lat, lon } or null. A pinned place (!3d…!4d…) wins over the map's view centre (@lat,lon).
 * Short links (maps.app.goo.gl) carry no coordinates, so they give null.
 */
export function parseLocation(text) {
  const s = String(text || "").trim();
  if (!s) return null;
  let t = s;
  try { t = decodeURIComponent(s); } catch { /* keep as typed */ }
  const plain = t.match(new RegExp(`^${NUM}\\s*[, ]\\s*${NUM}$`));
  if (plain) return pair(plain[1], plain[2]);
  const pin = t.match(new RegExp(`!3d${NUM}!4d${NUM}`));
  if (pin) return pair(pin[1], pin[2]);
  for (const key of ["q", "query", "ll", "destination", "daddr", "center", "sll"]) {
    const m = t.match(new RegExp(`[?&]${key}=(?:loc:)?${NUM}\\s*,\\s*\\+?${NUM}`));
    if (m) return pair(m[1], m[2]);
  }
  const place = t.match(new RegExp(`/(?:place|search|dir)/(?:[^/]*/)?${NUM}\\s*,\\s*\\+?${NUM}`));
  if (place) return pair(place[1], place[2]);
  const at = t.match(new RegExp(`@${NUM},${NUM}`));
  if (at) return pair(at[1], at[2]);
  return null;
}

export const isShortMapsLink = (text) => /(?:maps\.app\.goo\.gl|goo\.gl\/maps)\//i.test(String(text || ""));

/** A link that opens the stored coordinates in Google Maps. */
export const mapsUrl = (lat, lon) => (inRange(lat, lon) ? `https://www.google.com/maps/search/?api=1&query=${lat},${lon}` : "");

/** The capacity the client asked for, e.g. { kw: 150, unit: "dc", label: "150 kWp" } or null. */
export function requiredCapacity(c) {
  const kw = Number(c?.required_capacity_kw);
  if (!c || c.required_capacity_kw === null || c.required_capacity_kw === undefined || c.required_capacity_kw === "" || !Number.isFinite(kw) || kw <= 0) return null;
  const unit = c.required_capacity_unit === "ac" ? "ac" : "dc";
  return { kw, unit, label: `${Number(kw.toPrecision(6))} ${unit === "ac" ? "kWac" : "kWp"}` };
}

/** Meter numbers from free text: one per line or separated by commas. Leading zeros are kept. */
export const splitMeters = (text) => String(text || "").split(/[\n,;]+/).map((x) => x.trim()).filter(Boolean);

/** NAMA premises type for a client type (the forms only know these four). */
export function premisesOf(c, fallback = "residential") {
  if (c?.client_type === "residential" || c?.client_type === "commercial") return c.client_type;
  return fallback;
}

/**
 * Fill the gaps in a project (design record) from its client: site coordinates, premises type,
 * meter / account number and installation type. The client's location and type win; the
 * project's own meter number and installation type win over the client's.
 */
export function withClientDefaults(p, c) {
  if (!c) return p;
  const out = { ...p };
  const has = (v) => v !== null && v !== undefined && v !== "";
  // the site is defined on the client; older design records keep their own coordinates
  if (Number.isFinite(c.latitude) && Number.isFinite(c.longitude)) { out.latitude = c.latitude; out.longitude = c.longitude; }
  if (c.client_type === "residential" || c.client_type === "commercial") out.premises_type = c.client_type;
  if (!has(out.account_no) && c.meter_numbers?.length) out.account_no = c.meter_numbers[0];
  if (!has(out.installation_type) && c.installation_types?.length) out.installation_type = c.installation_types.join(" / ");
  return out;
}

/** Normalise a record read from storage, so old clients (before client types) read sensibly. */
export function clientView(c) {
  if (!c) return null;
  const type = c.client_type || (c.signatory_name ? "commercial" : "residential");
  return { ...NEW_CLIENT, ...c, client_type: type,
    meter_numbers: Array.isArray(c.meter_numbers) ? c.meter_numbers : [],
    installation_types: Array.isArray(c.installation_types) ? c.installation_types : [] };
}
