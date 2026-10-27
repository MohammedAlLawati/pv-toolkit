// Design rule settings: every parameter and rule in one place (ported from app/sizing/rules.py).
// The values are common engineering practice plus APSR's Technical Guidelines (2017) as publicly
// summarised; IEC 62548-1 for the short-circuit factor.

export const SEVERITIES = {
 "hard": "Hard rule (blocks reports)",
 "warn": "Warning only",
 "off": "Off"
};

export const PARAMS = [
 {
  "key": "t_min_c",
  "label": "Design minimum temperature (record low)",
  "default": 5,
  "unit": "°C",
  "hint": "Used for Voc and Vmp when cold. Each project can override it",
  "group": "Site temperatures",
  "type": "float"
 },
 {
  "key": "t_max_c",
  "label": "Design maximum ambient temperature",
  "default": 50,
  "unit": "°C",
  "hint": "Used for the hot cell temperature. Each project can override it",
  "group": "Site temperatures",
  "type": "float"
 },
 {
  "key": "hot_irradiance",
  "label": "Irradiance for the hot cell temperature",
  "default": 1000,
  "unit": "W/m²",
  "hint": "Cell temp = ambient + (NOCT − 20) / 800 × irradiance",
  "group": "Site temperatures",
  "type": "float"
 },
 {
  "key": "default_noct",
  "label": "NOCT when the datasheet gives none",
  "default": 45,
  "unit": "°C",
  "hint": "",
  "group": "Site temperatures",
  "type": "float"
 },
 {
  "key": "isc_factor",
  "label": "Short-circuit safety factor (K_I)",
  "default": 1.25,
  "unit": "×",
  "hint": "IEC 62548-1: max. array short-circuit current = 1.25 × Isc(STC). It is compared with the inverter's per-MPPT short-circuit limit, the connector rating and the fuse check",
  "group": "Currents",
  "type": "float"
 },
 {
  "key": "rear_irradiance",
  "label": "Rear-side irradiance for bifacial modules",
  "default": 135,
  "unit": "W/m²",
  "hint": "Isc and Imp are raised by bifaciality × this / 1000. 135 W/m² is the BNPI test condition on bifacial datasheets (e.g. 0.80 × 0.135 = +10.8 %)",
  "group": "Currents",
  "type": "float"
 },
 {
  "key": "dcac_min",
  "label": "DC/AC ratio: lowest",
  "default": 1.0,
  "unit": "",
  "hint": "",
  "group": "DC/AC ratio",
  "type": "float"
 },
 {
  "key": "dcac_target",
  "label": "DC/AC ratio: target for recommendations",
  "default": 1.2,
  "unit": "",
  "hint": "",
  "group": "DC/AC ratio",
  "type": "float"
 },
 {
  "key": "dcac_max",
  "label": "DC/AC ratio: highest",
  "default": 1.3,
  "unit": "",
  "hint": "",
  "group": "DC/AC ratio",
  "type": "float"
 },
 {
  "key": "max_ac_kw",
  "label": "Max. AC capacity per connection",
  "default": null,
  "unit": "kW",
  "hint": "Leave blank for no limit. Fill in from the APSR / NAMA rules",
  "group": "Connection",
  "type": "float"
 },
 {
  "key": "single_phase_max_a",
  "label": "Max. AC current on a 1-phase connection",
  "default": 16,
  "unit": "A",
  "hint": "APSR Technical Guidelines: 1-phase LV connection only if the phase current is ≤ 16 A (about 3.7 kW at 230 V). Blank = no limit",
  "group": "Connection",
  "type": "float"
 },
 {
  "key": "lvrt_kw",
  "label": "LVRT (low-voltage ride-through) needed from",
  "default": 11.08,
  "unit": "kW",
  "hint": "APSR Technical Guidelines. Shown as a reminder on designs at or above it",
  "group": "Connection",
  "type": "float"
 },
 {
  "key": "remote_control_kw",
  "label": "Remote control needed on LV from",
  "default": 10,
  "unit": "kW",
  "hint": "APSR Technical Guidelines. Shown as a reminder",
  "group": "Connection",
  "type": "float"
 },
 {
  "key": "dc_vdrop_max_pct",
  "label": "Max. DC voltage drop",
  "default": 1.5,
  "unit": "%",
  "hint": "String cable, at Vmp and Imp",
  "group": "Cables",
  "type": "float"
 },
 {
  "key": "ac_vdrop_max_pct",
  "label": "Max. AC voltage drop",
  "default": 2.0,
  "unit": "%",
  "hint": "Inverter to point of connection",
  "group": "Cables",
  "type": "float"
 },
 {
  "key": "block_design_form",
  "label": "Also block the NAMA design form when a hard rule fails",
  "default": false,
  "unit": "",
  "hint": "Yield reports are always blocked. This adds the NAMA design approval form",
  "group": "Reports",
  "type": "bool"
 }
];

export const RULES = [
 {
  "key": "data",
  "label": "Module and inverter data complete",
  "default": "hard",
  "hint": "Every check needs Voc, Isc, Vmp, Imp and the temperature coefficient, plus the inverter's voltage and MPPT limits"
 },
 {
  "key": "string_split",
  "label": "Modules split evenly into strings and inverters",
  "default": "hard",
  "hint": ""
 },
 {
  "key": "voc_max",
  "label": "String Voc at record low ≤ inverter max. DC voltage",
  "default": "hard",
  "hint": ""
 },
 {
  "key": "voc_module",
  "label": "String Voc at record low ≤ module max. system voltage",
  "default": "hard",
  "hint": ""
 },
 {
  "key": "voc_connector",
  "label": "String Voc at record low ≤ the voltage the standard DC connectors allow",
  "default": "hard",
  "hint": "E.g. Sungrow RT: 1000 V unless MC4 Evo2 connectors are fitted"
 },
 {
  "key": "vmp_min",
  "label": "String Vmp at hot cell temperature ≥ MPPT minimum",
  "default": "hard",
  "hint": ""
 },
 {
  "key": "vmp_max",
  "label": "String Vmp at record low ≤ MPPT maximum",
  "default": "hard",
  "hint": ""
 },
 {
  "key": "strings_mppt",
  "label": "Strings on each MPPT ≤ its input connectors",
  "default": "hard",
  "hint": ""
 },
 {
  "key": "isc_mppt",
  "label": "Isc × safety factor on each MPPT ≤ its short-circuit limit",
  "default": "hard",
  "hint": "The inverter's absolute limit: above it the input can be damaged"
 },
 {
  "key": "imp_mppt",
  "label": "Operating current on each MPPT ≤ its current limit",
  "default": "warn",
  "hint": "Above it the inverter limits the current and clips output; it isn't a safety limit"
 },
 {
  "key": "connector_current",
  "label": "String Isc × safety factor ≤ the DC connector rating",
  "default": "hard",
  "hint": ""
 },
 {
  "key": "ac_connection",
  "label": "AC capacity ≤ the project's connection limit",
  "default": "hard",
  "hint": "Approved load, spare transformer capacity or POC limit entered on the project"
 },
 {
  "key": "ac_profile",
  "label": "AC capacity ≤ the profile's max. per connection",
  "default": "hard",
  "hint": ""
 },
 {
  "key": "single_phase",
  "label": "1-phase AC current ≤ the profile's 1-phase max.",
  "default": "hard",
  "hint": ""
 },
 {
  "key": "phase_match",
  "label": "Inverter phases match the connection",
  "default": "hard",
  "hint": ""
 },
 {
  "key": "dcac_band",
  "label": "DC/AC ratio inside the target band",
  "default": "warn",
  "hint": ""
 },
 {
  "key": "dc_power",
  "label": "DC power per inverter ≤ its recommended max. PV power",
  "default": "warn",
  "hint": ""
 },
 {
  "key": "voc_standby",
  "label": "String Voc at record low ≤ MPPT maximum",
  "default": "warn",
  "hint": "Above it, the inverter waits in standby on cold mornings until the voltage falls"
 },
 {
  "key": "start_v",
  "label": "String Vmp at hot cell temperature ≥ the start-up voltage",
  "default": "warn",
  "hint": ""
 },
 {
  "key": "fuses",
  "label": "No string fuses needed",
  "default": "warn",
  "hint": "With 3 or more parallel strings, the reverse current can exceed the module's fuse rating"
 },
 {
  "key": "vdrop_dc",
  "label": "DC voltage drop within the limit",
  "default": "warn",
  "hint": ""
 },
 {
  "key": "vdrop_ac",
  "label": "AC voltage drop within the limit",
  "default": "warn",
  "hint": ""
 }
];

export const PARAM_BY_KEY = Object.fromEntries(PARAMS.map((p) => [p.key, p]));
export const RULE_BY_KEY = Object.fromEntries(RULES.map((r) => [r.key, r]));
export const DEFAULT_PROFILE_NAME = "APSR / NAMA (provisional)";

export function paramGroups() {
  const out = new Map();
  for (const p of PARAMS) {
    if (!out.has(p.group)) out.set(p.group, []);
    out.get(p.group).push(p);
  }
  return [...out.entries()];
}

/** A profile's values merged over the defaults: { values, severity }. */
export function settingsFrom(profile) {
  const values = Object.fromEntries(PARAMS.map((p) => [p.key, p.default]));
  const severity = Object.fromEntries(RULES.map((r) => [r.key, r.default]));
  for (const [k, v] of Object.entries(profile?.values || {})) if (k in PARAM_BY_KEY) values[k] = v;
  for (const [k, v] of Object.entries(profile?.severity || {})) if (k in RULE_BY_KEY && v in SEVERITIES) severity[k] = v;
  return { values, severity };
}

export const defaults = () => settingsFrom(null);
