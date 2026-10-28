// Every equipment field in one place (ported from app/equipment_fields.py). Forms and the
// datasheet reader are generated from these lists.

export const CATEGORIES = {
 "residential": "Residential",
 "commercial": "C&I",
 "utility": "Utility"
};

export const INVERTER_FIELDS = [
 {
  "key": "make",
  "label": "Manufacturer",
  "type": "str",
  "unit": "",
  "group": "General",
  "hint": "",
  "required": true,
  "extract": true
 },
 {
  "key": "model",
  "label": "Model",
  "type": "str",
  "unit": "",
  "group": "General",
  "hint": "",
  "required": true,
  "extract": true
 },
 {
  "key": "category",
  "label": "Category",
  "type": "str",
  "unit": "",
  "group": "General",
  "hint": "",
  "required": false,
  "extract": false
 },
 {
  "key": "ac_kw",
  "label": "Rated AC output power",
  "type": "float",
  "unit": "kW",
  "group": "General",
  "hint": "Nominal rated active power. If temperature-dependent, use the rating at 40-45 °C",
  "required": true,
  "extract": true
 },
 {
  "key": "max_ac_kva",
  "label": "Max. AC apparent power",
  "type": "float",
  "unit": "kVA",
  "group": "General",
  "hint": "",
  "required": false,
  "extract": true
 },
 {
  "key": "phases",
  "label": "AC phases",
  "type": "int",
  "unit": "",
  "group": "General",
  "hint": "1 or 3",
  "required": false,
  "extract": true
 },
 {
  "key": "ac_voltage",
  "label": "Rated AC voltage",
  "type": "str",
  "unit": "",
  "group": "General",
  "hint": "e.g. 3/N/PE, 230/400 V",
  "required": false,
  "extract": true
 },
 {
  "key": "max_ac_current_a",
  "label": "Max. AC output current",
  "type": "float",
  "unit": "A",
  "group": "General",
  "hint": "at 400 V if several are listed",
  "required": false,
  "extract": true
 },
 {
  "key": "internal_transformer",
  "label": "Internal (isolation) transformer",
  "type": "bool",
  "unit": "",
  "group": "General",
  "hint": "No when the topology is transformerless",
  "required": false,
  "extract": true
 },
 {
  "key": "topology",
  "label": "Topology",
  "type": "str",
  "unit": "",
  "group": "General",
  "hint": "e.g. Transformerless",
  "required": false,
  "extract": true
 },
 {
  "key": "max_dc_kw",
  "label": "Recommended max. PV input power",
  "type": "float",
  "unit": "kWp",
  "group": "DC input",
  "hint": "",
  "required": false,
  "extract": true
 },
 {
  "key": "max_dc_v",
  "label": "Max. PV input voltage",
  "type": "float",
  "unit": "V",
  "group": "DC input",
  "hint": "",
  "required": false,
  "extract": true
 },
 {
  "key": "start_v",
  "label": "Start-up input voltage",
  "type": "float",
  "unit": "V",
  "group": "DC input",
  "hint": "",
  "required": false,
  "extract": true
 },
 {
  "key": "min_dc_v",
  "label": "Min. PV input voltage",
  "type": "float",
  "unit": "V",
  "group": "DC input",
  "hint": "",
  "required": false,
  "extract": true
 },
 {
  "key": "rated_input_v",
  "label": "Rated / nominal PV input voltage",
  "type": "float",
  "unit": "V",
  "group": "DC input",
  "hint": "",
  "required": false,
  "extract": true
 },
 {
  "key": "mppt_min_v",
  "label": "MPPT voltage range – min",
  "type": "float",
  "unit": "V",
  "group": "DC input",
  "hint": "",
  "required": false,
  "extract": true
 },
 {
  "key": "mppt_max_v",
  "label": "MPPT voltage range – max",
  "type": "float",
  "unit": "V",
  "group": "DC input",
  "hint": "",
  "required": false,
  "extract": true
 },
 {
  "key": "num_mppt",
  "label": "Number of MPPTs",
  "type": "int",
  "unit": "",
  "group": "DC input",
  "hint": "",
  "required": false,
  "extract": true
 },
 {
  "key": "mppt_strings",
  "label": "Strings per MPPT",
  "type": "str",
  "unit": "",
  "group": "DC input",
  "hint": "one value per MPPT separated by '/', e.g. 2/1; a single number if all equal",
  "required": false,
  "extract": true
 },
 {
  "key": "mppt_currents",
  "label": "Max. input current per MPPT",
  "type": "str",
  "unit": "A",
  "group": "DC input",
  "hint": "per MPPT separated by '/', e.g. 32/16",
  "required": false,
  "extract": true
 },
 {
  "key": "mppt_iscs",
  "label": "Max. short-circuit current per MPPT",
  "type": "str",
  "unit": "A",
  "group": "DC input",
  "hint": "per MPPT separated by '/', e.g. 40/20",
  "required": false,
  "extract": true
 },
 {
  "key": "max_connector_current_a",
  "label": "Max. current per DC connector",
  "type": "float",
  "unit": "A",
  "group": "DC input",
  "hint": "",
  "required": false,
  "extract": true
 },
 {
  "key": "connector_limit_v",
  "label": "Max. DC voltage with the standard connectors",
  "type": "float",
  "unit": "V",
  "group": "DC input",
  "hint": "only when a footnote limits it below the max. PV input voltage, e.g. 1000 V unless MC4 Evo2 connectors are used",
  "required": false,
  "extract": true
 },
 {
  "key": "max_eff_pct",
  "label": "Max. efficiency",
  "type": "float",
  "unit": "%",
  "group": "Efficiency",
  "hint": "",
  "required": false,
  "extract": true
 },
 {
  "key": "euro_eff_pct",
  "label": "European efficiency",
  "type": "float",
  "unit": "%",
  "group": "Efficiency",
  "hint": "",
  "required": false,
  "extract": true
 },
 {
  "key": "dimensions",
  "label": "Dimensions (W × H × D)",
  "type": "str",
  "unit": "mm",
  "group": "Physical",
  "hint": "",
  "required": false,
  "extract": true
 },
 {
  "key": "weight_kg",
  "label": "Weight",
  "type": "float",
  "unit": "kg",
  "group": "Physical",
  "hint": "",
  "required": false,
  "extract": true
 },
 {
  "key": "ip_rating",
  "label": "Degree of protection",
  "type": "str",
  "unit": "",
  "group": "Physical",
  "hint": "e.g. IP66",
  "required": false,
  "extract": true
 },
 {
  "key": "notes",
  "label": "Design notes",
  "type": "text",
  "unit": "",
  "group": "Notes",
  "hint": "footnotes that limit the design, e.g. voltage limits or temperature derating",
  "required": false,
  "extract": true
 }
];

export const MODULE_FIELDS = [
 {
  "key": "make",
  "label": "Manufacturer",
  "type": "str",
  "unit": "",
  "group": "General",
  "hint": "",
  "required": true,
  "extract": true
 },
 {
  "key": "model",
  "label": "Model",
  "type": "str",
  "unit": "",
  "group": "General",
  "hint": "the exact model for this power class",
  "required": true,
  "extract": true
 },
 {
  "key": "wp",
  "label": "Rated power (Pmax, STC)",
  "type": "float",
  "unit": "Wp",
  "group": "General",
  "hint": "",
  "required": true,
  "extract": true
 },
 {
  "key": "technology",
  "label": "Technology",
  "type": "str",
  "unit": "",
  "group": "General",
  "hint": "e.g. N-type TOPCon bifacial, Mono PERC half-cut",
  "required": false,
  "extract": true
 },
 {
  "key": "cells",
  "label": "Number of cells",
  "type": "int",
  "unit": "",
  "group": "General",
  "hint": "",
  "required": false,
  "extract": true
 },
 {
  "key": "efficiency_pct",
  "label": "Module efficiency (STC)",
  "type": "float",
  "unit": "%",
  "group": "General",
  "hint": "",
  "required": false,
  "extract": true
 },
 {
  "key": "power_tolerance",
  "label": "Power tolerance",
  "type": "str",
  "unit": "",
  "group": "General",
  "hint": "e.g. 0~+3%",
  "required": false,
  "extract": true
 },
 {
  "key": "voc",
  "label": "Open-circuit voltage Voc (STC)",
  "type": "float",
  "unit": "V",
  "group": "Electrical (STC)",
  "hint": "",
  "required": false,
  "extract": true
 },
 {
  "key": "isc",
  "label": "Short-circuit current Isc (STC)",
  "type": "float",
  "unit": "A",
  "group": "Electrical (STC)",
  "hint": "",
  "required": false,
  "extract": true
 },
 {
  "key": "vmp",
  "label": "MPP voltage Vmp (STC)",
  "type": "float",
  "unit": "V",
  "group": "Electrical (STC)",
  "hint": "",
  "required": false,
  "extract": true
 },
 {
  "key": "imp",
  "label": "MPP current Imp (STC)",
  "type": "float",
  "unit": "A",
  "group": "Electrical (STC)",
  "hint": "",
  "required": false,
  "extract": true
 },
 {
  "key": "tc_voc_pct",
  "label": "Temp. coefficient of Voc",
  "type": "float",
  "unit": "%/°C",
  "group": "Temperature",
  "hint": "negative, e.g. -0.25",
  "required": false,
  "extract": true
 },
 {
  "key": "tc_isc_pct",
  "label": "Temp. coefficient of Isc",
  "type": "float",
  "unit": "%/°C",
  "group": "Temperature",
  "hint": "positive, e.g. 0.045",
  "required": false,
  "extract": true
 },
 {
  "key": "tc_pmax_pct",
  "label": "Temp. coefficient of Pmax",
  "type": "float",
  "unit": "%/°C",
  "group": "Temperature",
  "hint": "negative, e.g. -0.29",
  "required": false,
  "extract": true
 },
 {
  "key": "noct_c",
  "label": "NOCT / NMOT",
  "type": "float",
  "unit": "°C",
  "group": "Temperature",
  "hint": "",
  "required": false,
  "extract": true
 },
 {
  "key": "bifaciality",
  "label": "Bifaciality factor",
  "type": "float",
  "unit": "",
  "group": "Temperature",
  "hint": "as a fraction, e.g. 0.80; empty for mono-facial",
  "required": false,
  "extract": true
 },
 {
  "key": "max_system_v",
  "label": "Max. system voltage",
  "type": "float",
  "unit": "V",
  "group": "Limits",
  "hint": "",
  "required": false,
  "extract": true
 },
 {
  "key": "max_fuse_a",
  "label": "Max. series fuse rating",
  "type": "float",
  "unit": "A",
  "group": "Limits",
  "hint": "",
  "required": false,
  "extract": true
 },
 {
  "key": "length_mm",
  "label": "Length",
  "type": "float",
  "unit": "mm",
  "group": "Physical",
  "hint": "",
  "required": false,
  "extract": true
 },
 {
  "key": "width_mm",
  "label": "Width",
  "type": "float",
  "unit": "mm",
  "group": "Physical",
  "hint": "",
  "required": false,
  "extract": true
 },
 {
  "key": "thickness_mm",
  "label": "Thickness",
  "type": "float",
  "unit": "mm",
  "group": "Physical",
  "hint": "",
  "required": false,
  "extract": true
 },
 {
  "key": "weight_kg",
  "label": "Weight",
  "type": "float",
  "unit": "kg",
  "group": "Physical",
  "hint": "",
  "required": false,
  "extract": true
 },
 {
  "key": "degradation_first_pct",
  "label": "First-year degradation",
  "type": "float",
  "unit": "%",
  "group": "Warranty",
  "hint": "from the linear power warranty, e.g. 1",
  "required": false,
  "extract": true
 },
 {
  "key": "degradation_annual_pct",
  "label": "Annual degradation after year 1",
  "type": "float",
  "unit": "%",
  "group": "Warranty",
  "hint": "e.g. 0.40",
  "required": false,
  "extract": true
 },
 {
  "key": "notes",
  "label": "Design notes",
  "type": "text",
  "unit": "",
  "group": "Notes",
  "hint": "",
  "required": false,
  "extract": true
 }
];

export const FIELDS = { inverter: INVERTER_FIELDS, module: MODULE_FIELDS };

export function groups(kind) {
  const out = new Map();
  for (const f of FIELDS[kind]) {
    if (!out.has(f.group)) out.set(f.group, []);
    out.get(f.group).push(f);
  }
  return [...out.entries()];
}

/** Form / reader input -> the field's type (null when empty or invalid). */
export function parseValue(f, raw) {
  if (f.type === "bool") return ["1", "true", "yes", "on"].includes(String(raw ?? "").toLowerCase());
  const s = String(raw ?? "").trim();
  if (s === "") return null;
  if (f.type === "str" || f.type === "text") return s;
  const v = Number(s.replace(/,/g, "").replace("\u2212", "-"));
  if (!Number.isFinite(v)) return null;
  return f.type === "int" ? Math.round(v) : v;
}

/** "32/16" -> [32, 16];  "2" -> [2]. */
export function splitList(s) {
  const out = [];
  for (const part of String(s ?? "").replace(/,/g, "/").split("/")) {
    const v = parseFloat(part.trim().replace(/A$/, ""));
    if (Number.isFinite(v)) out.push(v);
  }
  return out;
}

export function moduleReady(m) {
  return !!m && ["voc", "isc", "vmp", "imp", "tc_voc_pct"].every((k) => m[k] !== null && m[k] !== undefined && m[k] !== "");
}

export function inverterReady(v) {
  return !!v && ["max_dc_v", "mppt_min_v", "mppt_max_v", "num_mppt"].every((k) => v[k] !== null && v[k] !== undefined && v[k] !== "")
    && !!(v.mppt_currents || v.max_current_per_mppt);
}

export const moduleLabel = (m) => `${m.make} ${m.model} (${fmtG(m.wp)} Wp)`;
export const inverterLabel = (v) => `${v.make} ${v.model} (${fmtG(v.ac_kw)} kW, ${v.phases}-ph)`;
export function moduleDims(m) {
  if (!m.length_mm || !m.width_mm) return "";
  return `${fmtG(m.length_mm)} × ${fmtG(m.width_mm)}${m.thickness_mm ? " × " + fmtG(m.thickness_mm) : ""} mm`;
}

/** Python's "%g": 545.0 -> "545", 13.94 -> "13.94". */
export function fmtG(v) {
  return v === null || v === undefined || v === "" ? "" : String(Number(Number(v).toPrecision(6)));
}

/** Fill the per-MPPT lists from single values (or the reverse) and the summary maxima. */
export function syncMpptSummary(inv) {
  const n = inv.num_mppt || 0;
  for (const [lst, single] of [["mppt_strings", "strings_per_mppt"], ["mppt_currents", "max_current_per_mppt"], ["mppt_iscs", "max_isc_per_mppt"]]) {
    const values = splitList(inv[lst]);
    if (values.length) {
      if (values.length === 1 && n > 1) inv[lst] = Array(n).fill(fmtG(values[0])).join("/");
      const top = Math.max(...values);
      inv[single] = single === "strings_per_mppt" ? Math.trunc(top) : top;
    } else if (inv[single] !== null && inv[single] !== undefined && n) {
      inv[lst] = Array(n).fill(fmtG(inv[single])).join("/");
    }
  }
  return inv;
}
