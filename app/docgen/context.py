"""Turn a Project into the values, tick marks and images each document needs."""
from __future__ import annotations

from dataclasses import dataclass
from datetime import date

from ..models import Project
from .render import RenderInput


@dataclass(frozen=True)
class DocSpec:
    key: str
    title: str
    template: str
    required: tuple[tuple[str, str], ...]  # (attribute check name, human label)


def fmt_num(v: float | None, dp: int = 2, thousands: bool = False) -> str:
    if v is None:
        return ""
    s = f"{v:,.{dp}f}" if thousands else f"{v:.{dp}f}"
    if dp and "." in s:
        s = s.rstrip("0").rstrip(".")
    return s


def fmt_omr(v: float | None) -> str:
    return "" if v is None else f"{v:,.3f}"


def fmt_date(d: date | None) -> str:
    return d.strftime("%d %B %Y").lstrip("0") if d else ""


def initials(name: str) -> str:
    return "".join(w[0] for w in name.split() if w[:1].isalpha()).upper()[:5]


def build_values(p: Project, today: date | None = None) -> dict[str, str]:
    today = today or date.today()
    c, m, inv = p.client, p.module, p.inverter
    cons, ctr = p.consultant, p.contractor
    gen = p.annual_gen_kwh
    subtotal = p.subtotal_omr
    vat = subtotal * p.vat_pct / 100 if subtotal is not None else None
    final = subtotal + vat if subtotal is not None else None
    clean_value = gen * p.tariff_bz / 1000 if gen else None  # OMR per year
    payback = final / clean_value if final and clean_value else None
    install = p.installation_type or ""
    if p.elevation_m:
        install = f"{install} ({fmt_num(p.elevation_m, 1)}m high)".strip()

    v = {
        # client
        "Name": c.name, "FirstName": c.name, "IDNo": c.id_no, "Contact": c.mobile,
        "Tel": c.tel, "Email": c.email, "Governorate": c.governorate,
        "Wilaya": c.wilaya, "Wilayat": c.wilaya, "Village": c.village,
        "Abbreviation": p.reference_code or initials(c.name),
        # site / account
        "AccountNo": p.account_no, "MeterNo": p.account_no,
        "ProjectArea": fmt_num(p.project_area_m2, 1, True),
        "InstallationType": install, "Elevation": fmt_num(p.elevation_m, 1),
        # modules
        "ModuleMake": m.make if m else "", "ModuleModel": m.model if m else "",
        "PanelType": m.technology if m else "", "PanelCap": fmt_num(m.wp, 1) if m else "",
        "ModuleDims": m.dims if m else "",
        "ModuleDescription": f"{m.make} {m.technology}".strip() if m else "",
        "PanelNo": str(p.module_count or ""), "NoofPVModules": str(p.module_count or ""),
        "Strings": str(p.strings or ""),
        "Tilt": fmt_num(p.tilt_deg, 1), "Azimuth": fmt_num(p.azimuth_deg, 1),
        # inverters
        "InverterMake": inv.make if inv else "", "InverterModel": inv.model if inv else "",
        "InverterDescription": f"{inv.make} {inv.model}" if inv else "",
        "InverterQty": str(p.inverter_qty or ""),
        "InverterUnitKW": fmt_num(inv.ac_kw, 2) if inv else "",
        # capacities
        "Capacity": fmt_num(p.dc_kwp, 2), "DCCapacity": fmt_num(p.dc_kwp, 2),
        "InverterCap": fmt_num(p.ac_kw, 2), "ACCapacity": fmt_num(p.ac_kw, 2),
        "DCACRatio": fmt_num(p.dc_ac_ratio, 2),
        # energy
        "AnnualGen": fmt_num(gen / 1000, 2) if gen else "",           # MWh
        "YearlyGen": fmt_num(gen / 1000, 2) if gen else "",           # MWh
        "AnnualGenKWh": fmt_num(gen, 0, True) if gen else "",         # kWh
        "Degradation": fmt_num(p.degradation_pct, 2),
        # commercial
        "Subtotal": fmt_omr(subtotal), "VAT": fmt_omr(vat), "FinalPrice": fmt_omr(final),
        "TariffBz": fmt_num(p.tariff_bz, 1), "TariffNote": p.tariff_note,
        "CleanEnergyProduction": fmt_omr(clean_value),
        "PaybackPeriod": fmt_num(payback, 1) if payback else "",
        # dates
        "ENdate": fmt_date(p.agency_date or today), "Today": fmt_date(today),
        # parties
        "ConsultantName": cons.name if cons else "", "ConsultantTel": cons.phone if cons else "",
        "ConsultantEngineer": cons.engineer if cons else "",
        "ContractorName": ctr.name if ctr else "", "ContractorTel": ctr.phone if ctr else "",
        "ContractorEngineer": ctr.engineer if ctr else "",
        "ContractorEmail": ctr.email if ctr else "", "ContractorAddress": ctr.address if ctr else "",
    }
    return {k: ("" if val is None else str(val)) for k, val in v.items()}


def build_flags(p: Project) -> dict[str, bool]:
    f = {
        f"prem_{p.premises_type}": True,
        f"conn_{p.connection_type}": True,
        f"mount_{p.mounting}": True,
        "phase3": p.phases == 3, "phase1": p.phases == 1,
        "trafo_yes": bool(p.internal_transformer), "trafo_no": not p.internal_transformer,
    }
    return f


def build_input(p: Project) -> RenderInput:
    return RenderInput(
        values=build_values(p),
        flags=build_flags(p),
        doc_status={},  # design-form checklist: always the template's own Yes / NA marks
        images={
            "consultant_stamp": p.consultant.stamp if p.consultant else None,
            "contractor_stamp": p.contractor.stamp if p.contractor else None,
            "layout": p.layout_image,
        },
    )


# ---- which documents exist and what they need ---------------------------------------

_CLIENT = (("client_name", "Client name"), ("account_no", "Account number"))
_SYSTEM = (("module", "PV module"), ("module_count", "Number of modules"),
           ("inverter", "Inverter"), ("inverter_qty", "Inverter quantity"),
           ("annual_gen_kwh", "Annual generation"))

DOCS = {
    "initial": DocSpec("initial", "NAMA – Initial Service Application", "nama_initial_form.docx",
                       _CLIENT + (("id_no", "Client ID / C.R."), ("mobile", "Client mobile"),
                                  ("wilaya", "Wilayat"), ("project_area_m2", "Project area"),
                                  ("consultant", "Consultant"), ("contractor", "Contractor"))
                       + _SYSTEM),
    "agency": DocSpec("agency", "NAMA – Agency Contract", "nama_agency_contract.docx",
                      _CLIENT + (("id_no", "Client ID / C.R."), ("wilaya", "Wilayat"),
                                 ("module", "PV module"), ("module_count", "Number of modules"))),
    "design": DocSpec("design", "NAMA – Design Approval Application", "",
                      _CLIENT + _SYSTEM + (("strings", "Number of strings"),
                                           ("tilt_deg", "Tilt"), ("azimuth_deg", "Azimuth"))),
    "execution": DocSpec("execution", "Execution Agreement (residential)", "execution_agreement.docx",
                         _CLIENT + _SYSTEM + (("mobile", "Client mobile"), ("wilaya", "Wilayat"),
                                              ("subtotal_omr", "Price (subtotal)"),
                                              ("contractor", "Contractor"))),
}


def template_for(doc_key: str, p: Project) -> str:
    if doc_key == "design":
        return "nama_design_above_11kw.docx" if p.above_11kw else "nama_design_below_11kw.docx"
    return DOCS[doc_key].template


def missing_fields(doc_key: str, p: Project) -> list[str]:
    c = p.client
    lookup = {
        "client_name": c.name, "id_no": c.id_no, "mobile": c.mobile, "wilaya": c.wilaya,
    }
    out = []
    for attr, label in DOCS[doc_key].required:
        val = lookup[attr] if attr in lookup else getattr(p, attr)
        if val in (None, "", 0):
            out.append(label)
    return out


def doc_filename(doc_key: str, p: Project, ext: str) -> str:
    safe = "".join(ch if ch.isalnum() or ch in " -_" else "" for ch in p.client.name).strip()
    safe = "_".join(safe.split())[:40] or f"project{p.id}"
    names = {"initial": "NAMA_Initial_Form", "agency": "NAMA_Agency_Contract",
             "design": "NAMA_Design_Approval_" + ("Above" if p.above_11kw else "Below") + "_11kW",
             "execution": "Execution_Agreement"}
    return f"{names[doc_key]}_{safe}.{ext}"
