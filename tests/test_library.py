"""Equipment library: Sungrow import, datasheet upload / reading / review, upgrades."""
from __future__ import annotations

import io
import re
import time
import zipfile
from pathlib import Path
from types import SimpleNamespace

import pyotp
import pytest
from fastapi.testclient import TestClient

from app import datasheets as dsx
from app.db import SessionLocal, init_db
from app.main import app
from app.models import Inverter, Module, User
from app.security import hash_password

SEED = Path(__file__).resolve().parents[1] / "app" / "seed" / "datasheets"
PW = "Library-Tests-42"


def csrf(html: str) -> str:
    return re.search(r'name="csrf_token" value="([^"]+)"', html).group(1)


@pytest.fixture(scope="module")
def c():
    init_db()
    secret = pyotp.random_base32()
    with SessionLocal() as db:
        db.add(User(username="libtester", password_hash=hash_password(PW), totp_secret=secret,
                    totp_confirmed=True))
        db.commit()
    with TestClient(app, base_url="https://testserver") as client:
        r = client.get("/login")
        client.post("/login", data={"username": "libtester", "password": PW, "csrf_token": csrf(r.text)})
        r = client.get("/login/2fa")
        client.post("/login/2fa", data={"code": pyotp.TOTP(secret).now(),
                                        "csrf_token": csrf(r.text)})
        assert client.get("/library", follow_redirects=False).status_code == 200
        yield client


def test_sungrow_import(c):
    tok = csrf(c.get("/library").text)
    c.post("/library/import-sungrow", data={"csrf_token": tok})
    with SessionLocal() as db:
        from app.seed.sungrow_mena import INVERTERS
        names = {x["model"] for x in INVERTERS}
        invs = [v for v in db.query(Inverter).filter(Inverter.make == "Sungrow").all() if v.model in names]
        by = {v.model: v for v in invs}
        assert len(invs) == 18
        assert sorted({v.category for v in invs}) == ["commercial", "residential", "utility"]
        assert sum(v.category == "residential" for v in invs) == 9
        rt = by["SG10RT-P2"]
        assert (rt.mppt_currents, rt.mppt_iscs, rt.mppt_strings) == ("32/16", "40/20", "2/1")
        assert rt.max_current_per_mppt == 32 and rt.strings_per_mppt == 2 and rt.sizing_ready
        assert by["SG150CX"].mppt_currents == "/".join(["48"] * 7)
        assert by["SG320HX-20"].max_dc_v == 1500 and by["SG320HX-20"].category == "utility"
        assert by["SG50CX-P2"].weight_kg == 41 and by["SG40CX-P2"].weight_kg == 40
        assert rt.datasheet is not None and rt.datasheet.data[:4] == b"%PDF"
    # second import refreshes, doesn't duplicate
    c.post("/library/import-sungrow", data={"csrf_token": tok})
    with SessionLocal() as db:
        assert db.query(Inverter).filter(Inverter.make == "Sungrow", Inverter.model.in_(names)).count() == 18
    page = c.get("/library?cat=utility").text
    assert "SG320HX-20" in page and "SG10RT-P2" not in page
    # project form groups inverters by category
    form = c.get("/projects/new").text
    assert '<optgroup label="Residential">' in form and '<optgroup label="Utility">' in form


def test_upload_with_text_reader(c):
    tok = csrf(c.get("/library").text)
    pdf = (SEED / "DS_20240709_SG25_30_33CX-P2_Datasheet_V5_EN.pdf").read_bytes()
    r = c.post("/library/upload", data={"kind": "inverter", "csrf_token": tok},
               files={"file": ("sg33.pdf", pdf, "application/pdf")}, follow_redirects=False)
    review_url = r.headers["location"]
    page = c.get(review_url).text
    assert "SG25CX-P2" in page and "SG33CX-P2" in page and "updates existing" in page
    did = review_url.split("/")[3]
    # save only the first column, as a renamed model, with a corrected value
    form = {"csrf_token": tok, "count": "3", "m0_include": "on", "m0_make": "Sungrow",
            "m0_model": "SG25CX-P2-TEST", "m0_ac_kw": "25", "m0_category": "commercial",
            "m0_num_mppt": "3", "m0_mppt_currents": "30", "m0_mppt_iscs": "40", "m0_max_dc_v": "1100",
            "m0_mppt_min_v": "160", "m0_mppt_max_v": "1000", "m0_internal_transformer": "false"}
    c.post(f"/library/datasheets/{did}/save", data=form)
    with SessionLocal() as db:
        v = db.query(Inverter).filter_by(model="SG25CX-P2-TEST").one()
        assert v.mppt_currents == "30/30/30" and v.datasheet_id == int(did)
        assert db.query(Inverter).filter_by(model="SG30CX-P2-TEST").count() == 0
    assert c.get(f"/library/datasheets/{did}/file").content[:4] == b"%PDF"


def test_text_reader_values():
    pdf = (SEED / "DS_20241106_SG150CX_Datasheet_V4_EN.pdf").read_bytes()
    res = dsx.extract(pdf, "application/pdf", "inverter")
    m = res.models[0]
    assert m["model"] == "SG150CX" and m["ac_kw"] == 150 and m["max_ac_kva"] == 165
    assert m["num_mppt"] == 7 and m["mppt_currents"] == "48" and m["mppt_iscs"] == "66"
    assert (m["mppt_min_v"], m["mppt_max_v"], m["max_dc_v"]) == (180, 1000, 1100)
    assert m["internal_transformer"] is False and m["category"] == "commercial"


def _tiny_pdf() -> bytes:
    from reportlab.pdfgen import canvas
    buf = io.BytesIO()
    cv = canvas.Canvas(buf)
    cv.drawString(72, 720, "Module datasheet (scanned)")
    cv.save()
    return buf.getvalue()


def test_upload_with_claude_reader(c, monkeypatch):
    """The Claude path: request shape and handling of the structured reply (API mocked)."""
    sent = {}

    class FakeMessages:
        def create(self, **kw):
            sent.update(kw)
            models = [dict(make="Jinko Solar", model=f"JKM{p}N-78HL4-BDV", wp=p, technology="N-type bifacial",
                           voc=v, isc=i, vmp=vm, imp=im, tc_voc_pct=-0.25, tc_isc_pct=0.045,
                           tc_pmax_pct=-0.29, noct_c=45, bifaciality=80, max_system_v=1500,
                           length_mm=2465, width_mm=1134, thickness_mm=30, cells=156, efficiency_pct=22.5)
                      for p, v, i, vm, im in [(630, 55.85, 14.08, 46.33, 13.6), (635, 56.05, 14.15, 46.52, 13.65)]]
            return SimpleNamespace(content=[SimpleNamespace(type="tool_use",
                                                            input={"models": models,
                                                                   "reading_notes": "clear table"})])

    monkeypatch.setenv("ANTHROPIC_API_KEY", "test-key")
    monkeypatch.setattr(dsx, "_client_factory", lambda: SimpleNamespace(messages=FakeMessages()))
    tok = csrf(c.get("/library").text)
    r = c.post("/library/upload", data={"kind": "module", "csrf_token": tok},
               files={"file": ("jinko.pdf", _tiny_pdf(), "application/pdf")}, follow_redirects=False)
    assert sent["tool_choice"]["name"] == "record_datasheet"
    assert sent["messages"][0]["content"][0]["type"] == "document"
    page = c.get(r.headers["location"]).text
    assert "JKM630N-78HL4-BDV" in page and "JKM635N-78HL4-BDV" in page
    assert "Reader&#39;s note: clear table" in page or "Reader's note: clear table" in page
    # bifaciality 80 is above 1 -> flagged by the checks before it is fixed by the user
    assert "Bifaciality should be a fraction" in page
    did = r.headers["location"].split("/")[3]
    form = {"csrf_token": tok, "count": "2", "m1_include": "on"}
    m = dict(make="Jinko Solar", model="JKM635N-78HL4-BDV", wp="635", voc="56.05", isc="14.15",
             vmp="46.52", imp="13.65", tc_voc_pct="-0.25", bifaciality="0.80", length_mm="2465",
             width_mm="1134", thickness_mm="30")
    form.update({f"m1_{k}": v for k, v in m.items()})
    c.post(f"/library/datasheets/{did}/save", data=form)
    with SessionLocal() as db:
        mod = db.query(Module).filter_by(model="JKM635N-78HL4-BDV").one()
        assert mod.sizing_ready and mod.bifaciality == 0.8 and mod.dims == "2465 × 1134 × 30 mm"
        assert db.query(Module).filter_by(model="JKM630N-78HL4-BDV").count() == 0


def test_claude_failure_falls_back(monkeypatch):
    class Boom:
        def create(self, **kw):
            raise RuntimeError("network down")
    monkeypatch.setenv("ANTHROPIC_API_KEY", "test-key")
    monkeypatch.setattr(dsx, "_client_factory", lambda: SimpleNamespace(messages=Boom()))
    pdf = (SEED / "DS_20240709_SG125CX-P2_Datasheet_V6_EN.pdf").read_bytes()
    res = dsx.extract(pdf, "application/pdf", "inverter")
    assert res.method == "text" and res.models[0]["model"] == "SG125CX-P2"
    assert any("Claude reader unavailable" in w for w in res.warnings)


def test_checks():
    assert dsx.check("module", dict(wp=600, voc=40, vmp=45, isc=14, imp=13, tc_voc_pct=-0.25))
    ok = dict(wp=625, voc=56.05, isc=14.15, vmp=46.52, imp=13.44, tc_voc_pct=-0.25, tc_isc_pct=0.045,
              tc_pmax_pct=-0.29, bifaciality=0.8)
    assert dsx.check("module", ok) == []
    bad_inv = dict(max_dc_v=1000, mppt_min_v=200, mppt_max_v=1100, num_mppt=2, mppt_currents="32/16/16")
    msgs = " ".join(dsx.check("inverter", bad_inv))
    assert "above the max. input voltage" in msgs and "lists 3 values but there are 2" in msgs


def test_add_missing_columns(tmp_path):
    """An older database (Phase 1 schema) gains the new columns on startup."""
    import sqlalchemy as sa
    from app import db as dbmod
    old = sa.create_engine(f"sqlite:///{tmp_path}/old.db")
    with old.begin() as conn:
        conn.execute(sa.text("CREATE TABLE inverters (id INTEGER PRIMARY KEY, make VARCHAR(80), "
                             "model VARCHAR(120), ac_kw FLOAT, phases INTEGER)"))
        conn.execute(sa.text("INSERT INTO inverters (make, model, ac_kw, phases) VALUES ('X','Y',5,3)"))
    orig = dbmod.engine
    dbmod.engine = old
    try:
        added = dbmod.add_missing_columns()
    finally:
        dbmod.engine = orig
    assert "inverters.mppt_currents" in added and "inverters.category" in added
    with old.connect() as conn:
        row = conn.execute(sa.text("SELECT model, category, internal_transformer FROM inverters")).one()
    assert row == ("Y", "residential", 0)


def test_design_checklist_is_template_default(c):
    """Documents Required marks always come from the template, whatever the project."""
    form = c.get("/projects/new").text
    assert 'name="doc_1"' not in form
    from app.docgen import ooxml as ox
    from app.docgen.render import RenderInput, render_docx
    out = render_docx("nama_design_above_11kw.docx", RenderInput(values={}, doc_status={}))
    d = ox.Docx(out.docx)
    for a in ox.anchors(d.doc):
        tag = ox.get_tag(a)
        if tag.startswith("doc:"):
            _, row, rest = tag.split(":", 2)
            default, yes_x, no_x, na_x = rest.split("|")
            assert ox.get_pos(a)[0] == int({"yes": yes_x, "na": na_x}[default])


def test_review_blank_keeps_existing_value(c):
    """Re-reading a datasheet for a model already in the library never wipes good values."""
    tok = csrf(c.get("/library").text)
    c.post("/library/import-sungrow", data={"csrf_token": tok})
    pdf = (SEED / "DS_20240709_SG36_40_50CX-P2_Datasheet_V5_EN.pdf").read_bytes()
    r = c.post("/library/upload", data={"kind": "inverter", "csrf_token": tok},
               files={"file": ("sg50.pdf", pdf, "application/pdf")}, follow_redirects=False)
    did = r.headers["location"].split("/")[3]
    c.post(f"/library/datasheets/{did}/save",
           data={"csrf_token": tok, "count": "3", "m2_include": "on", "m2_make": "Sungrow",
                 "m2_model": "SG50CX-P2", "m2_ac_kw": "50", "m2_weight_kg": "", "m2_notes": "",
                 "m2_category": "commercial", "m2_euro_eff_pct": "98.4"})
    with SessionLocal() as db:
        v = db.query(Inverter).filter_by(make="Sungrow", model="SG50CX-P2").one()
        assert v.weight_kg == 41 and v.mppt_currents == "30/30/30/30" and v.euro_eff_pct == 98.4
