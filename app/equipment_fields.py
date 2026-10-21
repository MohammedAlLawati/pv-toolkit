"""Every equipment field in one place.

The edit forms, the datasheet extractor (its JSON schema and instructions), the review
screen and the sanity checks are all generated from these lists, so adding a field here
makes it appear everywhere.
"""
from __future__ import annotations

from dataclasses import dataclass


@dataclass(frozen=True)
class Field:
    key: str
    label: str
    type: str = "float"          # float | int | str | bool | text
    unit: str = ""
    group: str = "General"
    hint: str = ""               # shown under the input and given to the extractor
    required: bool = False
    extract: bool = True         # ask the datasheet reader for it


CATEGORIES = {"residential": "Residential", "commercial": "C&I", "utility": "Utility"}

INVERTER_FIELDS: list[Field] = [
    Field("make", "Manufacturer", "str", required=True),
    Field("model", "Model", "str", required=True),
    Field("category", "Category", "str", extract=False),
    Field("ac_kw", "Rated AC output power", unit="kW", required=True,
          hint="Nominal rated active power. If temperature-dependent, use the rating at 40-45 °C"),
    Field("max_ac_kva", "Max. AC apparent power", unit="kVA"),
    Field("phases", "AC phases", "int", hint="1 or 3"),
    Field("ac_voltage", "Rated AC voltage", "str", hint="e.g. 3/N/PE, 230/400 V"),
    Field("max_ac_current_a", "Max. AC output current", unit="A", hint="at 400 V if several are listed"),
    Field("internal_transformer", "Internal (isolation) transformer", "bool",
          hint="No when the topology is transformerless"),
    Field("topology", "Topology", "str", hint="e.g. Transformerless"),

    Field("max_dc_kw", "Recommended max. PV input power", unit="kWp", group="DC input"),
    Field("max_dc_v", "Max. PV input voltage", unit="V", group="DC input"),
    Field("start_v", "Start-up input voltage", unit="V", group="DC input"),
    Field("min_dc_v", "Min. PV input voltage", unit="V", group="DC input"),
    Field("rated_input_v", "Rated / nominal PV input voltage", unit="V", group="DC input"),
    Field("mppt_min_v", "MPPT voltage range – min", unit="V", group="DC input"),
    Field("mppt_max_v", "MPPT voltage range – max", unit="V", group="DC input"),
    Field("num_mppt", "Number of MPPTs", "int", group="DC input"),
    Field("mppt_strings", "Strings per MPPT", "str", group="DC input",
          hint="one value per MPPT separated by '/', e.g. 2/1; a single number if all equal"),
    Field("mppt_currents", "Max. input current per MPPT", "str", unit="A", group="DC input",
          hint="per MPPT separated by '/', e.g. 32/16"),
    Field("mppt_iscs", "Max. short-circuit current per MPPT", "str", unit="A", group="DC input",
          hint="per MPPT separated by '/', e.g. 40/20"),
    Field("max_connector_current_a", "Max. current per DC connector", unit="A", group="DC input"),

    Field("max_eff_pct", "Max. efficiency", unit="%", group="Efficiency"),
    Field("euro_eff_pct", "European efficiency", unit="%", group="Efficiency"),

    Field("dimensions", "Dimensions (W × H × D)", "str", unit="mm", group="Physical"),
    Field("weight_kg", "Weight", unit="kg", group="Physical"),
    Field("ip_rating", "Degree of protection", "str", group="Physical", hint="e.g. IP66"),
    Field("notes", "Design notes", "text", group="Notes",
          hint="footnotes that limit the design, e.g. voltage limits or temperature derating"),
]

MODULE_FIELDS: list[Field] = [
    Field("make", "Manufacturer", "str", required=True),
    Field("model", "Model", "str", required=True, hint="the exact model for this power class"),
    Field("wp", "Rated power (Pmax, STC)", unit="Wp", required=True),
    Field("technology", "Technology", "str", hint="e.g. N-type TOPCon bifacial, Mono PERC half-cut"),
    Field("cells", "Number of cells", "int"),
    Field("efficiency_pct", "Module efficiency (STC)", unit="%"),
    Field("power_tolerance", "Power tolerance", "str", hint="e.g. 0~+3%"),

    Field("voc", "Open-circuit voltage Voc (STC)", unit="V", group="Electrical (STC)"),
    Field("isc", "Short-circuit current Isc (STC)", unit="A", group="Electrical (STC)"),
    Field("vmp", "MPP voltage Vmp (STC)", unit="V", group="Electrical (STC)"),
    Field("imp", "MPP current Imp (STC)", unit="A", group="Electrical (STC)"),
    Field("tc_voc_pct", "Temp. coefficient of Voc", unit="%/°C", group="Temperature",
          hint="negative, e.g. -0.25"),
    Field("tc_isc_pct", "Temp. coefficient of Isc", unit="%/°C", group="Temperature",
          hint="positive, e.g. 0.045"),
    Field("tc_pmax_pct", "Temp. coefficient of Pmax", unit="%/°C", group="Temperature",
          hint="negative, e.g. -0.29"),
    Field("noct_c", "NOCT / NMOT", unit="°C", group="Temperature"),
    Field("bifaciality", "Bifaciality factor", group="Temperature",
          hint="as a fraction, e.g. 0.80; empty for mono-facial"),

    Field("max_system_v", "Max. system voltage", unit="V", group="Limits"),
    Field("max_fuse_a", "Max. series fuse rating", unit="A", group="Limits"),

    Field("length_mm", "Length", unit="mm", group="Physical"),
    Field("width_mm", "Width", unit="mm", group="Physical"),
    Field("thickness_mm", "Thickness", unit="mm", group="Physical"),
    Field("weight_kg", "Weight", unit="kg", group="Physical"),
    Field("notes", "Design notes", "text", group="Notes"),
]

FIELDS = {"inverter": INVERTER_FIELDS, "module": MODULE_FIELDS}


def groups(kind: str) -> list[tuple[str, list[Field]]]:
    out: dict[str, list[Field]] = {}
    for f in FIELDS[kind]:
        out.setdefault(f.group, []).append(f)
    return list(out.items())


def parse_value(f: Field, raw):
    """Convert form / extractor input to the field's Python type (None when empty or invalid)."""
    if raw is None:
        return None if f.type != "bool" else False
    if f.type == "bool":
        return str(raw).lower() in ("1", "true", "yes", "on")
    s = str(raw).strip()
    if s == "":
        return None
    if f.type in ("str", "text"):
        return s
    s = s.replace(",", "").replace("−", "-")
    try:
        v = float(s)
    except ValueError:
        return None
    return int(round(v)) if f.type == "int" else v


def split_list(s: str | None) -> list[float]:
    """'32/16' -> [32.0, 16.0];  '2' -> [2.0]."""
    out = []
    for part in (s or "").replace(",", "/").split("/"):
        part = part.strip().rstrip("A").strip()
        try:
            out.append(float(part))
        except ValueError:
            pass
    return out
