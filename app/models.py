"""Database tables.

Phase 1 covers users, clients, projects, equipment and the contractor / consultant
lists. Electrical datasheet fields on Module / Inverter are already here (nullable)
so the Phase 2 sizing engine can use the same library.
"""
from __future__ import annotations

import json
from datetime import date, datetime

from sqlalchemy import (Boolean, Date, DateTime, Float, ForeignKey, Integer, LargeBinary,
                        String, Text, func)
from sqlalchemy.orm import Mapped, mapped_column, relationship

from .db import Base


class User(Base):
    __tablename__ = "users"
    id: Mapped[int] = mapped_column(primary_key=True)
    username: Mapped[str] = mapped_column(String(80), unique=True)
    password_hash: Mapped[str] = mapped_column(String(200))
    totp_secret: Mapped[str | None] = mapped_column(String(64))
    totp_confirmed: Mapped[bool] = mapped_column(Boolean, default=False)
    failed_attempts: Mapped[int] = mapped_column(Integer, default=0)
    locked_until: Mapped[datetime | None] = mapped_column(DateTime)
    session_version: Mapped[int] = mapped_column(Integer, default=1)
    last_totp_step: Mapped[int] = mapped_column(Integer, default=0)  # blocks code reuse
    created_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now())


class Party(Base):
    """A contractor or consultant that appears on authority forms."""
    __tablename__ = "parties"
    id: Mapped[int] = mapped_column(primary_key=True)
    kind: Mapped[str] = mapped_column(String(20))  # "contractor" | "consultant"
    name: Mapped[str] = mapped_column(String(200))
    phone: Mapped[str] = mapped_column(String(60), default="")
    email: Mapped[str] = mapped_column(String(120), default="")
    address: Mapped[str] = mapped_column(Text, default="")
    engineer: Mapped[str] = mapped_column(String(120), default="")  # project engineer
    stamp: Mapped[bytes | None] = mapped_column(LargeBinary)        # optional stamp/signature image
    is_default: Mapped[bool] = mapped_column(Boolean, default=False)


class Client(Base):
    __tablename__ = "clients"
    id: Mapped[int] = mapped_column(primary_key=True)
    name: Mapped[str] = mapped_column(String(200))
    id_no: Mapped[str] = mapped_column(String(60), default="")      # civil ID or C.R.
    mobile: Mapped[str] = mapped_column(String(60), default="")
    tel: Mapped[str] = mapped_column(String(60), default="")
    email: Mapped[str] = mapped_column(String(120), default="")
    governorate: Mapped[str] = mapped_column(String(80), default="")
    wilaya: Mapped[str] = mapped_column(String(80), default="")
    village: Mapped[str] = mapped_column(String(80), default="")
    # companies only: the person who signs for the company (used on letters)
    signatory_name: Mapped[str] = mapped_column(String(200), default="")
    signatory_id: Mapped[str] = mapped_column(String(60), default="")
    notes: Mapped[str] = mapped_column(Text, default="")
    created_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now())
    projects: Mapped[list["Project"]] = relationship(back_populates="client",
                                                     cascade="all, delete-orphan")


class Datasheet(Base):
    """An uploaded manufacturer datasheet (PDF or image) and what was read from it."""
    __tablename__ = "datasheets"
    id: Mapped[int] = mapped_column(primary_key=True)
    kind: Mapped[str] = mapped_column(String(20))            # module | inverter
    filename: Mapped[str] = mapped_column(String(255))
    mime: Mapped[str] = mapped_column(String(80), default="application/pdf")
    data: Mapped[bytes] = mapped_column(LargeBinary)
    method: Mapped[str] = mapped_column(String(40), default="")   # claude | text | manual
    extracted_json: Mapped[str] = mapped_column(Text, default="")
    uploaded_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now())


class Module(Base):
    __tablename__ = "modules"
    id: Mapped[int] = mapped_column(primary_key=True)
    make: Mapped[str] = mapped_column(String(80))
    model: Mapped[str] = mapped_column(String(120))
    wp: Mapped[float] = mapped_column(Float)
    technology: Mapped[str] = mapped_column(String(120), default="")
    cells: Mapped[int | None] = mapped_column(Integer)
    efficiency_pct: Mapped[float | None] = mapped_column(Float)
    power_tolerance: Mapped[str | None] = mapped_column(String(40))
    length_mm: Mapped[float | None] = mapped_column(Float)
    width_mm: Mapped[float | None] = mapped_column(Float)
    thickness_mm: Mapped[float | None] = mapped_column(Float)
    weight_kg: Mapped[float | None] = mapped_column(Float)
    # electrical datasheet (STC) - used by the Phase 2 sizing engine
    voc: Mapped[float | None] = mapped_column(Float)
    isc: Mapped[float | None] = mapped_column(Float)
    vmp: Mapped[float | None] = mapped_column(Float)
    imp: Mapped[float | None] = mapped_column(Float)
    tc_voc_pct: Mapped[float | None] = mapped_column(Float)   # %/°C, negative
    tc_isc_pct: Mapped[float | None] = mapped_column(Float)   # %/°C, positive
    tc_pmax_pct: Mapped[float | None] = mapped_column(Float)  # %/°C, negative
    noct_c: Mapped[float | None] = mapped_column(Float)
    bifaciality: Mapped[float | None] = mapped_column(Float)
    max_system_v: Mapped[float | None] = mapped_column(Float)
    max_fuse_a: Mapped[float | None] = mapped_column(Float)
    notes: Mapped[str | None] = mapped_column(Text)
    datasheet_id: Mapped[int | None] = mapped_column(ForeignKey("datasheets.id", ondelete="SET NULL"))
    datasheet: Mapped[Datasheet | None] = relationship()

    @property
    def label(self) -> str:
        return f"{self.make} {self.model} ({self.wp:g} Wp)"

    @property
    def dims(self) -> str:
        if self.length_mm and self.width_mm:
            t = f" × {self.thickness_mm:g}" if self.thickness_mm else ""
            return f"{self.length_mm:g} × {self.width_mm:g}{t} mm"
        return ""

    @property
    def sizing_ready(self) -> bool:
        return all(v is not None for v in (self.voc, self.isc, self.vmp, self.imp, self.tc_voc_pct))


class Inverter(Base):
    __tablename__ = "inverters"
    id: Mapped[int] = mapped_column(primary_key=True)
    make: Mapped[str] = mapped_column(String(80))
    model: Mapped[str] = mapped_column(String(120))
    category: Mapped[str] = mapped_column(String(20), default="residential")  # residential|commercial|utility
    ac_kw: Mapped[float] = mapped_column(Float)
    max_ac_kva: Mapped[float | None] = mapped_column(Float)
    phases: Mapped[int] = mapped_column(Integer, default=3)
    ac_voltage: Mapped[str | None] = mapped_column(String(80))
    max_ac_current_a: Mapped[float | None] = mapped_column(Float)
    internal_transformer: Mapped[bool] = mapped_column(Boolean, default=False)
    topology: Mapped[str | None] = mapped_column(String(60))
    # DC input - used by the Phase 2 sizing engine
    max_dc_kw: Mapped[float | None] = mapped_column(Float)      # recommended max PV power
    max_dc_v: Mapped[float | None] = mapped_column(Float)
    start_v: Mapped[float | None] = mapped_column(Float)
    min_dc_v: Mapped[float | None] = mapped_column(Float)
    rated_input_v: Mapped[float | None] = mapped_column(Float)
    mppt_min_v: Mapped[float | None] = mapped_column(Float)
    mppt_max_v: Mapped[float | None] = mapped_column(Float)
    num_mppt: Mapped[int | None] = mapped_column(Integer)
    mppt_strings: Mapped[str | None] = mapped_column(String(80))    # "2/1"
    mppt_currents: Mapped[str | None] = mapped_column(String(120))  # "32/16"  (A)
    mppt_iscs: Mapped[str | None] = mapped_column(String(120))      # "40/20"  (A)
    max_connector_current_a: Mapped[float | None] = mapped_column(Float)
    connector_limit_v: Mapped[float | None] = mapped_column(Float)  # e.g. 1000 V for standard MC4 on RT
    # summary numbers (largest MPPT), kept in step with the lists above
    strings_per_mppt: Mapped[int | None] = mapped_column(Integer)
    max_current_per_mppt: Mapped[float | None] = mapped_column(Float)
    max_isc_per_mppt: Mapped[float | None] = mapped_column(Float)
    max_eff_pct: Mapped[float | None] = mapped_column(Float)
    euro_eff_pct: Mapped[float | None] = mapped_column(Float)
    dimensions: Mapped[str | None] = mapped_column(String(80))
    weight_kg: Mapped[float | None] = mapped_column(Float)
    ip_rating: Mapped[str | None] = mapped_column(String(20))
    notes: Mapped[str | None] = mapped_column(Text)
    datasheet_id: Mapped[int | None] = mapped_column(ForeignKey("datasheets.id", ondelete="SET NULL"))
    datasheet: Mapped[Datasheet | None] = relationship()

    @property
    def label(self) -> str:
        return f"{self.make} {self.model} ({self.ac_kw:g} kW, {self.phases}-ph)"

    @property
    def sizing_ready(self) -> bool:
        return all(v is not None for v in (self.max_dc_v, self.mppt_min_v, self.mppt_max_v,
                                           self.num_mppt, self.mppt_currents or self.max_current_per_mppt))

    def sync_mppt_summary(self) -> None:
        """Fill the per-MPPT lists from single values (or the reverse) and the summary maxima."""
        from .equipment_fields import split_list
        n = self.num_mppt or 0
        for lst, single in (("mppt_strings", "strings_per_mppt"), ("mppt_currents", "max_current_per_mppt"),
                            ("mppt_iscs", "max_isc_per_mppt")):
            values = split_list(getattr(self, lst))
            if values:
                if len(values) == 1 and n > 1:
                    setattr(self, lst, "/".join([f"{values[0]:g}"] * n))
                top = max(values)
                setattr(self, single, int(top) if single == "strings_per_mppt" else top)
            elif getattr(self, single) is not None and n:
                v = getattr(self, single)
                setattr(self, lst, "/".join([f"{v:g}"] * n))


class RuleProfile(Base):
    """A set of design-rule values and severities (see sizing/rules.py)."""
    __tablename__ = "rule_profiles"
    id: Mapped[int] = mapped_column(primary_key=True)
    name: Mapped[str] = mapped_column(String(120))
    is_default: Mapped[bool] = mapped_column(Boolean, default=False)
    settings_json: Mapped[str] = mapped_column(Text, default="")


# Documents Required rows on the NAMA design approval form (row number -> text)
NAMA_DOC_ROWS = {
    1: "Solar PV Initial Enquiry Acceptance",
    2: "Operation and Maintenance Plan (Contract)",
    3: "Building Permit from the Municipality",
    4: "Civil Defense (if applicable)",
    5: "Harmonic and Short Circuit Study",
    6: "Detailed plan of project electricity connection points",
    7: "Electricity Production Details (PVsyst or other)",
    8: "Connected load & maximum demand schedules at each connection point",
    9: "Updated Demand confirmation",
    10: "Single line diagram, with details of POC, earth pits (AC & DC)",
    11: "Lightning arrester and protection system",
    12: "Site layout plan / PV Modules arrangement design",
    13: "Structural drawings / Civil Layout (with designer's declaration)",
    14: "Wiring diagram and cable layout and labeling",
    15: "Plan of substation location (depend on capacity)",
    16: "Solar PV modules Datasheet, Warranty, and Certificate",
    17: "Inverters Datasheet, Warranty, and Certificate",
    18: "Wind load analysis report",
    19: "Interface Protections compliance (APSR Clause 5.2 MV / 6.2 LV)",
    20: "Protection single-line diagram and Settings",
    21: "Other drawings/technical specifications as applicable",
}
NAMA_DOC_DEFAULTS = {1: "yes", 2: "yes", 3: "yes", 4: "na", 5: "yes", 6: "na", 7: "yes",
                     8: "na", 9: "na", 10: "yes", 11: "na", 12: "yes", 13: "na", 14: "yes",
                     15: "na", 16: "yes", 17: "yes", 18: "na", 19: "na", 20: "yes", 21: "na"}

PREMISES_TYPES = ["residential", "commercial", "governmental", "agricultural"]
CONNECTION_TYPES = {"self": "Self-investment", "lease": "Lease", "hybrid": "Hybrid"}
MOUNTING_TYPES = {"rooftop": "Rooftop", "carpark": "Car park", "ground": "Ground mount",
                  "other": "Other"}
PROJECT_STATUSES = ["draft", "initial submitted", "initial approved", "design submitted",
                    "design approved", "installed", "commissioned", "on hold", "lost"]


class Project(Base):
    __tablename__ = "projects"
    id: Mapped[int] = mapped_column(primary_key=True)
    client_id: Mapped[int] = mapped_column(ForeignKey("clients.id", ondelete="CASCADE"))
    client: Mapped[Client] = relationship(back_populates="projects")
    name: Mapped[str] = mapped_column(String(200))
    status: Mapped[str] = mapped_column(String(40), default="draft")

    # site / account
    account_no: Mapped[str] = mapped_column(String(60), default="")
    premises_type: Mapped[str] = mapped_column(String(20), default="residential")
    connection_type: Mapped[str] = mapped_column(String(20), default="self")
    mounting: Mapped[str] = mapped_column(String(20), default="rooftop")
    installation_type: Mapped[str] = mapped_column(String(120), default="Elevated Flat Roof")
    elevation_m: Mapped[float | None] = mapped_column(Float)
    project_area_m2: Mapped[float | None] = mapped_column(Float)
    latitude: Mapped[float | None] = mapped_column(Float)
    longitude: Mapped[float | None] = mapped_column(Float)

    # system
    module_id: Mapped[int | None] = mapped_column(ForeignKey("modules.id", ondelete="SET NULL"))
    module: Mapped[Module | None] = relationship()
    module_count: Mapped[int | None] = mapped_column(Integer)
    strings: Mapped[int | None] = mapped_column(Integer)
    tilt_deg: Mapped[float | None] = mapped_column(Float)
    azimuth_deg: Mapped[float | None] = mapped_column(Float)
    inverter_id: Mapped[int | None] = mapped_column(ForeignKey("inverters.id", ondelete="SET NULL"))
    inverter: Mapped[Inverter | None] = relationship()
    inverter_qty: Mapped[int | None] = mapped_column(Integer, default=1)
    phases: Mapped[int] = mapped_column(Integer, default=3)
    internal_transformer: Mapped[bool] = mapped_column(Boolean, default=False)
    annual_gen_kwh: Mapped[float | None] = mapped_column(Float)

    # sizing (Phase 2)
    rule_profile_id: Mapped[int | None] = mapped_column(ForeignKey("rule_profiles.id", ondelete="SET NULL"))
    rule_profile: Mapped[RuleProfile | None] = relationship()
    mppt_layout: Mapped[str] = mapped_column(String(80), default="")      # strings per MPPT, e.g. "2/1"
    t_min_c: Mapped[float | None] = mapped_column(Float)                  # site record low
    t_max_c: Mapped[float | None] = mapped_column(Float)                  # site max. ambient
    hv_connectors: Mapped[bool] = mapped_column(Boolean, default=False)   # e.g. MC4 Evo2 fitted
    connection_limit_kw: Mapped[float | None] = mapped_column(Float)      # POC / transformer / approved load
    dc_cable_m: Mapped[float | None] = mapped_column(Float)
    dc_cable_mm2: Mapped[float | None] = mapped_column(Float)
    ac_cable_m: Mapped[float | None] = mapped_column(Float)
    ac_cable_mm2: Mapped[float | None] = mapped_column(Float)

    # commercial
    subtotal_omr: Mapped[float | None] = mapped_column(Float)
    vat_pct: Mapped[float] = mapped_column(Float, default=5.0)
    tariff_bz: Mapped[float] = mapped_column(Float, default=32.0)
    tariff_note: Mapped[str] = mapped_column(
        String(200), default="targeting the consumption rate of the third slab")
    degradation_pct: Mapped[float] = mapped_column(Float, default=0.65)

    # authority paperwork
    consultant_id: Mapped[int | None] = mapped_column(ForeignKey("parties.id", ondelete="SET NULL"))
    consultant: Mapped[Party | None] = relationship(foreign_keys=[consultant_id])
    contractor_id: Mapped[int | None] = mapped_column(ForeignKey("parties.id", ondelete="SET NULL"))
    contractor: Mapped[Party | None] = relationship(foreign_keys=[contractor_id])
    agency_date: Mapped[date | None] = mapped_column(Date)
    doc_status_json: Mapped[str] = mapped_column(Text, default="")
    reference_code: Mapped[str] = mapped_column(String(40), default="")  # e.g. ASH -> HTC/ASH/EA/01
    layout_image: Mapped[bytes | None] = mapped_column(LargeBinary)       # roof / site layout picture
    notes: Mapped[str] = mapped_column(Text, default="")

    created_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now(),
                                                 onupdate=func.now())

    # ---- derived values -------------------------------------------------------
    @property
    def dc_kwp(self) -> float | None:
        if self.module and self.module_count:
            return self.module.wp * self.module_count / 1000
        return None

    @property
    def ac_kw(self) -> float | None:
        if self.inverter and self.inverter_qty:
            return self.inverter.ac_kw * self.inverter_qty
        return None

    @property
    def dc_ac_ratio(self) -> float | None:
        if self.dc_kwp and self.ac_kw:
            return self.dc_kwp / self.ac_kw
        return None

    @property
    def above_11kw(self) -> bool:
        """NAMA uses the AC capacity for the 11 kW threshold."""
        return (self.ac_kw or 0) > 11

    @property
    def doc_status(self) -> dict[int, str]:
        status = dict(NAMA_DOC_DEFAULTS)
        if self.doc_status_json:
            status.update({int(k): v for k, v in json.loads(self.doc_status_json).items()})
        return status

    @doc_status.setter
    def doc_status(self, value: dict[int, str]) -> None:
        self.doc_status_json = json.dumps({str(k): v for k, v in value.items()})


# ---- letters ------------------------------------------------------------------------------

class Letterhead(Base):
    """Header and footer images printed on every letter page."""
    __tablename__ = "letterheads"
    id: Mapped[int] = mapped_column(primary_key=True)
    name: Mapped[str] = mapped_column(String(120))
    top: Mapped[bytes | None] = mapped_column(LargeBinary)      # PNG
    bottom: Mapped[bytes | None] = mapped_column(LargeBinary)   # PNG
    is_default: Mapped[bool] = mapped_column(Boolean, default=False)


class LetterTemplate(Base):
    """Wording of a letter. Body syntax is described in letters/defaults.py."""
    __tablename__ = "letter_templates"
    id: Mapped[int] = mapped_column(primary_key=True)
    key: Mapped[str] = mapped_column(String(60), default="")   # built-in templates only
    name: Mapped[str] = mapped_column(String(200))
    audience: Mapped[str] = mapped_column(String(20), default="commercial")  # commercial | residential
    language: Mapped[str] = mapped_column(String(5), default="en")           # en | ar
    recipient: Mapped[str] = mapped_column(Text, default="")
    subject: Mapped[str] = mapped_column(Text, default="")
    body: Mapped[str] = mapped_column(Text, default="")
    confirmation: Mapped[str] = mapped_column(Text, default="")
    enclosures: Mapped[str] = mapped_column(Text, default="")   # one per line
    purpose: Mapped[str] = mapped_column(Text, default="")      # default {{Purpose}}
    ref_prefix: Mapped[str] = mapped_column(String(60), default="")  # empty: letters aren't numbered
    letterhead_id: Mapped[int | None] = mapped_column(ForeignKey("letterheads.id", ondelete="SET NULL"))
    letterhead: Mapped[Letterhead | None] = relationship()
    updated_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now(),
                                                 onupdate=func.now())


class Letter(Base):
    """A letter issued from a template: the values typed on the letter form."""
    __tablename__ = "letters"
    id: Mapped[int] = mapped_column(primary_key=True)
    template_id: Mapped[int | None] = mapped_column(ForeignKey("letter_templates.id", ondelete="SET NULL"))
    template: Mapped[LetterTemplate | None] = relationship()
    client_id: Mapped[int | None] = mapped_column(ForeignKey("clients.id", ondelete="SET NULL"))
    client: Mapped[Client | None] = relationship()
    project_id: Mapped[int | None] = mapped_column(ForeignKey("projects.id", ondelete="SET NULL"))
    project: Mapped["Project | None"] = relationship()
    ref: Mapped[str] = mapped_column(String(80), default="")
    letter_date: Mapped[date | None] = mapped_column(Date)
    values_json: Mapped[str] = mapped_column(Text, default="{}")
    points_json: Mapped[str] = mapped_column(Text, default="[]")
    created_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now())

    @property
    def values(self) -> dict[str, str]:
        return json.loads(self.values_json or "{}")

    @property
    def points(self) -> list[dict[str, str]]:
        return json.loads(self.points_json or "[]")

    @property
    def title(self) -> str:
        return self.values.get("ClientName") or "Untitled letter"
