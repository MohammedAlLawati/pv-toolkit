"""Design rule settings: every parameter and rule in one place.

A rule profile stores values for the PARAMS and a severity for each RULE. The rules page,
the sizing engine and the defaults all come from these lists, so adding a parameter or a
rule here makes it appear everywhere.

The values in the default "APSR / NAMA" profile are common engineering practice. They are
provisional until checked against the APSR connection guidelines and NAMA's rules. The
1-phase, LVRT and remote-control values come from APSR's "Technical Guidelines for Solar PV
Systems" (2017) as summarised publicly; the official PDF couldn't be read online.
"""
from __future__ import annotations

import json
from dataclasses import dataclass

from sqlalchemy import select
from sqlalchemy.orm import Session

SEVERITIES = {"hard": "Hard rule (blocks reports)", "warn": "Warning only", "off": "Off"}


@dataclass(frozen=True)
class Param:
    key: str
    label: str
    default: float | bool | None
    unit: str = ""
    hint: str = ""
    group: str = "General"
    type: str = "float"  # float | bool


@dataclass(frozen=True)
class Rule:
    key: str
    label: str
    default: str  # hard | warn | off
    hint: str = ""


PARAMS: list[Param] = [
    Param("t_min_c", "Design minimum temperature (record low)", 5, "°C",
          "Used for Voc and Vmp when cold. Each project can override it", "Site temperatures"),
    Param("t_max_c", "Design maximum ambient temperature", 50, "°C",
          "Used for the hot cell temperature. Each project can override it", "Site temperatures"),
    Param("hot_irradiance", "Irradiance for the hot cell temperature", 1000, "W/m²",
          "Cell temp = ambient + (NOCT − 20) / 800 × irradiance", "Site temperatures"),
    Param("default_noct", "NOCT when the datasheet gives none", 45, "°C", "", "Site temperatures"),

    Param("isc_factor", "Short-circuit safety factor", 1.25, "×",
          "String Isc × this factor is compared with the MPPT and connector limits (IEC 62548 uses 1.25)",
          "Currents"),
    Param("bifacial_gain", "Rear-side irradiance gain for bifacial modules", 0.10, "fraction",
          "Isc and Imp are raised by bifaciality × this gain, e.g. 0.80 × 0.10 = +8 %", "Currents"),

    Param("dcac_min", "DC/AC ratio: lowest", 1.00, "", "", "DC/AC ratio"),
    Param("dcac_target", "DC/AC ratio: target for recommendations", 1.20, "", "", "DC/AC ratio"),
    Param("dcac_max", "DC/AC ratio: highest", 1.30, "", "", "DC/AC ratio"),

    Param("max_ac_kw", "Max. AC capacity per connection", None, "kW",
          "Leave blank for no limit. Fill in from the APSR / NAMA rules", "Connection"),
    Param("single_phase_max_a", "Max. AC current on a 1-phase connection", 16, "A",
          "APSR Technical Guidelines: 1-phase LV connection only if the phase current is ≤ 16 A "
          "(about 3.7 kW at 230 V). Blank = no limit", "Connection"),
    Param("lvrt_kw", "LVRT (low-voltage ride-through) needed from", 11.08, "kW",
          "APSR Technical Guidelines. Shown as a reminder on designs at or above it", "Connection"),
    Param("remote_control_kw", "Remote control needed on LV from", 10, "kW",
          "APSR Technical Guidelines. Shown as a reminder", "Connection"),

    Param("dc_vdrop_max_pct", "Max. DC voltage drop", 1.5, "%", "String cable, at Vmp and Imp", "Cables"),
    Param("ac_vdrop_max_pct", "Max. AC voltage drop", 2.0, "%", "Inverter to point of connection", "Cables"),

    Param("block_design_form", "Also block the NAMA design form when a hard rule fails", False,
          group="Reports", type="bool",
          hint="Yield reports are always blocked. This adds the NAMA design approval form"),
]

RULES: list[Rule] = [
    Rule("data", "Module and inverter data complete", "hard",
         "Every check needs Voc, Isc, Vmp, Imp and the temperature coefficient, plus the inverter's voltage and MPPT limits"),
    Rule("string_split", "Modules split evenly into strings and inverters", "hard"),
    Rule("voc_max", "String Voc at record low ≤ inverter max. DC voltage", "hard"),
    Rule("voc_module", "String Voc at record low ≤ module max. system voltage", "hard"),
    Rule("voc_connector", "String Voc at record low ≤ the voltage the standard DC connectors allow", "hard",
         "E.g. Sungrow RT: 1000 V unless MC4 Evo2 connectors are fitted"),
    Rule("vmp_min", "String Vmp at hot cell temperature ≥ MPPT minimum", "hard"),
    Rule("vmp_max", "String Vmp at record low ≤ MPPT maximum", "hard"),
    Rule("strings_mppt", "Strings on each MPPT ≤ its input connectors", "hard"),
    Rule("isc_mppt", "Isc × safety factor on each MPPT ≤ its short-circuit limit", "hard"),
    Rule("imp_mppt", "Operating current on each MPPT ≤ its current limit", "hard"),
    Rule("connector_current", "String Isc × safety factor ≤ the DC connector rating", "hard"),
    Rule("ac_connection", "AC capacity ≤ the project's connection limit", "hard",
         "Approved load, spare transformer capacity or POC limit entered on the project"),
    Rule("ac_profile", "AC capacity ≤ the profile's max. per connection", "hard"),
    Rule("single_phase", "1-phase AC current ≤ the profile's 1-phase max.", "hard"),
    Rule("phase_match", "Inverter phases match the connection", "hard"),

    Rule("dcac_band", "DC/AC ratio inside the target band", "warn"),
    Rule("dc_power", "DC power per inverter ≤ its recommended max. PV power", "warn"),
    Rule("voc_standby", "String Voc at record low ≤ MPPT maximum", "warn",
         "Above it, the inverter waits in standby on cold mornings until the voltage falls"),
    Rule("start_v", "String Vmp at hot cell temperature ≥ the start-up voltage", "warn"),
    Rule("fuses", "No string fuses needed", "warn",
         "With 3 or more parallel strings, the reverse current can exceed the module's fuse rating"),
    Rule("vdrop_dc", "DC voltage drop within the limit", "warn"),
    Rule("vdrop_ac", "AC voltage drop within the limit", "warn"),
]

PARAM_BY_KEY = {p.key: p for p in PARAMS}
RULE_BY_KEY = {r.key: r for r in RULES}


def param_groups() -> list[tuple[str, list[Param]]]:
    out: dict[str, list[Param]] = {}
    for p in PARAMS:
        out.setdefault(p.group, []).append(p)
    return list(out.items())


@dataclass
class Settings:
    """A profile's values merged over the defaults."""
    values: dict
    severity: dict

    def __getattr__(self, key):
        try:
            return self.__dict__["values"][key]
        except KeyError as e:
            raise AttributeError(key) from e


def defaults() -> Settings:
    return Settings({p.key: p.default for p in PARAMS}, {r.key: r.default for r in RULES})


def settings_from_json(raw: str | None) -> Settings:
    s = defaults()
    try:
        data = json.loads(raw or "{}")
    except ValueError:
        data = {}
    for k, v in (data.get("values") or {}).items():
        if k in PARAM_BY_KEY:
            s.values[k] = v
    for k, v in (data.get("severity") or {}).items():
        if k in RULE_BY_KEY and v in SEVERITIES:
            s.severity[k] = v
    return s


def settings_to_json(s: Settings) -> str:
    return json.dumps({"values": s.values, "severity": s.severity})


DEFAULT_PROFILE_NAME = "APSR / NAMA (provisional)"


def ensure_default_profile(db: Session):
    from ..models import RuleProfile
    prof = db.scalar(select(RuleProfile).where(RuleProfile.is_default))
    if prof is None:
        prof = db.scalar(select(RuleProfile).order_by(RuleProfile.id))
        if prof is None:
            prof = RuleProfile(name=DEFAULT_PROFILE_NAME, settings_json=settings_to_json(defaults()))
            db.add(prof)
        prof.is_default = True
        db.commit()
    return prof


def settings_for(db: Session, project) -> Settings:
    prof = project.rule_profile if project is not None and project.rule_profile else ensure_default_profile(db)
    return settings_from_json(prof.settings_json)
