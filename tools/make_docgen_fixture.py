"""Write web/tests/fixtures/docgen_cases.json: the Python document generator's output for
a few sample projects, so the browser port (web/js/docgen) can be checked against it.

    python -m tools.make_docgen_fixture
"""
from __future__ import annotations

import io
import json
import zipfile
from datetime import date
from pathlib import Path

from lxml import etree

from app.docgen.context import DOCS, build_flags, build_values, doc_filename, missing_fields, template_for
from app.docgen.render import RenderInput, render_docx
from app.models import Client, Inverter, Module, Party, Project

OUT = Path(__file__).resolve().parent.parent / "web" / "tests" / "fixtures" / "docgen_cases.json"
W = "{http://schemas.openxmlformats.org/wordprocessingml/2006/main}"
WP = "{http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing}"
TODAY = date(2026, 3, 5)


def summary(docx: bytes) -> dict:
    """What the JS output must match: the text of every paragraph and the shapes left."""
    with zipfile.ZipFile(io.BytesIO(docx)) as z:
        root = etree.fromstring(z.read("word/document.xml"))
    texts = ["".join(t.text or "" for t in p.iter(W + "t")) for p in root.iter(W + "p")]
    shapes = [d.get("descr", "") for d in root.iter(WP + "docPr")]
    return {"text": "\n".join(texts), "shapes": shapes}


def plain(obj, fields):
    return {f: getattr(obj, f) for f in fields} if obj is not None else None


MODULE_F = ["id", "make", "model", "wp", "technology", "length_mm", "width_mm", "thickness_mm"]
INV_F = ["id", "make", "model", "ac_kw", "phases"]
CLIENT_F = ["id", "name", "id_no", "mobile", "tel", "email", "governorate", "wilaya", "village"]
PARTY_F = ["id", "kind", "name", "phone", "email", "address", "engineer"]
PROJECT_F = ["id", "name", "account_no", "premises_type", "connection_type", "mounting",
             "installation_type", "elevation_m", "project_area_m2", "module_count", "strings",
             "tilt_deg", "azimuth_deg", "inverter_qty", "phases", "internal_transformer",
             "annual_gen_kwh", "subtotal_omr", "vat_pct", "tariff_bz", "tariff_note",
             "degradation_pct", "agency_date", "reference_code"]


def projects():
    mod = Module(id=1, make="Jinko", model="JKM620N-66HL4M-BDV", wp=620, technology="Tiger Neo N-type Bifacial",
                 length_mm=2382, width_mm=1134, thickness_mm=30)
    inv_small = Inverter(id=1, make="Sungrow", model="SG10RT", ac_kw=10, phases=3)
    inv_big = Inverter(id=2, make="Sungrow", model="SG33CX-P2", ac_kw=33, phases=3)
    cons = Party(id=1, kind="consultant", name="Al Noor Engineering", phone="2412 3456", email="",
                 address="", engineer="Eng. Salim")
    ctr = Party(id=2, kind="contractor", name="HTC Solar LLC", phone="9123 4567", email="info@example.om",
                address="P.O. Box 1, Muscat", engineer="Eng. Mohammed")
    c1 = Client(id=1, name="Ahmed Salim Al Harthy", id_no="12345678", mobile="9988 7766", tel="",
                email="ahmed@example.com", governorate="Muscat", wilaya="Seeb", village="Mabelah")
    c2 = Client(id=2, name="Gulf Dates & Co. (SAOC)", id_no="CR 1234567", mobile="", tel="2444 5555",
                email="", governorate="Al Batinah South", wilaya="Barka", village="")
    base = dict(premises_type="residential", connection_type="self", mounting="rooftop",
                installation_type="Elevated Flat Roof", phases=3, internal_transformer=False,
                vat_pct=5.0, tariff_bz=32.0, tariff_note="targeting the consumption rate of the third slab",
                degradation_pct=0.65, reference_code="", agency_date=None)
    p1 = Project(id=1, name="Seeb villa", client=c1, module=mod, inverter=inv_small, consultant=cons,
                 contractor=ctr, account_no="ACC-001234", elevation_m=3.5, project_area_m2=1234.5,
                 module_count=18, strings=2, tilt_deg=15, azimuth_deg=180, inverter_qty=1,
                 annual_gen_kwh=19876.4, subtotal_omr=3450.5, **base)
    b2 = {**base, "premises_type": "agricultural", "connection_type": "lease", "mounting": "ground",
          "internal_transformer": True, "reference_code": "GDC", "agency_date": date(2026, 1, 9),
          "installation_type": "Ground mount"}
    p2 = Project(id=2, name="Barka farm", client=c2, module=mod, inverter=inv_big, consultant=None,
                 contractor=ctr, account_no="", elevation_m=None, project_area_m2=None,
                 module_count=120, strings=8, tilt_deg=20.5, azimuth_deg=175, inverter_qty=2,
                 annual_gen_kwh=None, subtotal_omr=None, **b2)
    return [p1, p2]


def main():
    cases = []
    for p in projects():
        record = plain(p, PROJECT_F)
        record["agency_date"] = p.agency_date.isoformat() if p.agency_date else None
        record.update(client=plain(p.client, CLIENT_F), module=plain(p.module, MODULE_F),
                      inverter=plain(p.inverter, INV_F), consultant=plain(p.consultant, PARTY_F),
                      contractor=plain(p.contractor, PARTY_F))
        values = build_values(p, today=TODAY)
        flags = build_flags(p)
        docs = {}
        for key in DOCS:
            tpl = template_for(key, p)
            res = render_docx(tpl, RenderInput(values=values, flags=flags, doc_status={}, images={}))
            docs[key] = {"template": tpl, "filename": doc_filename(key, p, "docx"),
                         "missing_fields": missing_fields(key, p),
                         "missing": sorted(res.missing), **summary(res.docx)}
        cases.append({"project": record, "today": TODAY.isoformat(), "values": values,
                      "flags": flags, "docs": docs})
    OUT.write_text(json.dumps(cases, ensure_ascii=False, indent=1))
    print(f"wrote {OUT} ({OUT.stat().st_size // 1024} KB)")


if __name__ == "__main__":
    main()
