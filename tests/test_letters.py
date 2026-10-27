"""Letters: built-in NEDC templates, letter form, Word/PDF output, template editing."""
from __future__ import annotations

import io
import re
import zipfile

import pyotp
import pytest
from fastapi.testclient import TestClient

from app.db import SessionLocal, init_db
from app.docgen.render import soffice_available
from app.letters.builder import BLANK, LetterData, SupplyPoint, build_docx, trim_blank_rows
from app.main import app
from app.models import Client, LetterTemplate, Party, Project, User
from app.security import hash_password

PW = "Letters-Tests-42"


def csrf(html: str) -> str:
    return re.search(r'name="csrf_token" value="([^"]+)"', html).group(1)


def body_xml(docx: bytes) -> str:
    return zipfile.ZipFile(io.BytesIO(docx)).read("word/document.xml").decode()


@pytest.fixture(scope="module")
def c():
    init_db()
    secret = pyotp.random_base32()
    with SessionLocal() as db:
        db.add(User(username="letters", password_hash=hash_password(PW), totp_secret=secret,
                    totp_confirmed=True))
        if not db.query(Party).filter_by(kind="contractor").first():
            db.add(Party(kind="contractor", name="Hussam Technology Company", phone="+968 9782 9469",
                         email="solar@htc.om", engineer="Al Muataz Al Tougi", is_default=True))
        co = Client(name="Al Noor Trading L.L.C.", id_no="1234567", wilaya="Bausher",
                    governorate="Muscat", signatory_name="Ahmed Al Harthy", signatory_id="09876543")
        home = Client(name="Salim Al Rawahi", id_no="12345678", wilaya="Seeb")
        db.add_all([co, home])
        db.flush()
        db.add(Project(client_id=home.id, name="Rawahi villa", account_no="2200987654"))
        db.commit()
    with TestClient(app, base_url="https://testserver") as client:
        r = client.get("/login")
        client.post("/login", data={"username": "letters", "password": PW, "csrf_token": csrf(r.text)})
        r = client.get("/login/2fa")
        client.post("/login/2fa", data={"code": pyotp.TOTP(secret).now(), "csrf_token": csrf(r.text)})
        yield client


def _ids():
    with SessionLocal() as db:
        tpl = {t.key: t.id for t in db.query(LetterTemplate).all() if t.key}
        co = db.query(Client).filter_by(name="Al Noor Trading L.L.C.").one().id
        proj = db.query(Project).filter_by(name="Rawahi villa").one().id
    return tpl, co, proj


def test_builder_fills_values_and_blocks():
    d = LetterData(audience="commercial", recipient="The Manager\nNEDC\nOman",
                   subject="On behalf of {{ClientName}} for Meter No. {{MeterList}}",
                   body="Dear Sir,\n\nWe write for **{{ClientName}}** (C.R. {{CRNo}}).\n\n[[details]]\n\n"
                        "[[points]]\n\n[[signatures]]",
                   confirmation="We, {{ClientName}}, confirm.", enclosures=["Copy of C.R."],
                   values={"ClientName": "Acme L.L.C.", "CRNo": "777"},
                   points=[SupplyPoint("M-1", "A-1"), SupplyPoint("M-2")])
    docx, missing = build_docx(d)
    xml = body_xml(docx)
    assert "Acme L.L.C." in xml and "M-1, M-2" in xml and "Copy of C.R." in xml
    assert "{{" not in xml and "[[" not in xml
    assert {"SignatoryName", "SignatoryID", "Date"} <= missing
    assert "Ref:" not in xml  # no reference given, so no reference line
    assert "word/header1.xml" in zipfile.ZipFile(io.BytesIO(docx)).namelist()


def test_trim_blank_rows():
    from PIL import Image
    im = Image.new("RGBA", (100, 60), (255, 255, 255, 0))
    im.paste((10, 20, 30, 255), (10, 20, 90, 30))
    buf = io.BytesIO()
    im.save(buf, "PNG")
    out = Image.open(io.BytesIO(trim_blank_rows(buf.getvalue(), pad=0)))
    assert out.size == (100, 10)


def test_builtin_templates_and_letterhead(c):
    page = c.get("/letters")
    assert page.status_code == 200
    assert "NEDC approved capacity request: commercial client" in page.text
    assert "NEDC approved capacity request: residential client" in page.text
    assert "NEDC approved capacity request: commercial client (Arabic)" in page.text
    assert "HTC (Hussam Technology Company)" in page.text
    tpl, _, _ = _ids()
    r = c.get(f"/letters/templates/{tpl['nedc_commercial']}/sample.docx")
    xml = body_xml(r.content)
    # the blank version: every input is a line to fill in, HTC's C.R. is printed, no names
    assert r.status_code == 200 and BLANK in xml and "1665626" in xml
    assert "Ref:" not in xml and "Enclosures" not in xml and "Tougi" not in xml


def test_commercial_letter_from_client(c):
    tpl, co, _ = _ids()
    page = c.get(f"/letters/new?template_id={tpl['nedc_commercial']}&client_id={co}")
    assert 'value="Ahmed Al Harthy"' in page.text and 'value="1234567"' in page.text
    assert 'name="ref"' not in page.text  # the NEDC letters carry no reference number
    assert 'name="Purpose"' not in page.text  # the wording doesn't use {{Purpose}}
    r = c.post("/letters/save", data={
        "csrf_token": csrf(page.text), "template_id": tpl["nedc_commercial"], "client_id": co,
        "letter_date": "2026-10-27", "ClientName": "Al Noor Trading L.L.C.",
        "CRNo": "1234567", "SignatoryName": "Ahmed Al Harthy", "SignatoryID": "09876543",
        "Location": "Bausher", "Purpose": "grid connection", "HTCSignatoryName": "Al Muataz Al Tougi",
        "account_no": ["A-111", "A-222", ""], "location": ["Shop", "", ""]},
        follow_redirects=False)
    assert r.status_code == 303
    lid = int(r.headers["location"].rsplit("/", 1)[1])
    view = c.get(f"/letters/{lid}")
    assert view.status_code == 200 and 'value="A-222"' in view.text
    xml = body_xml(c.get(f"/letters/{lid}/letter.docx").content)
    for text in ("Al Noor Trading L.L.C.", "1234567", "Ahmed Al Harthy", "09876543", "A-111",
                 "A-222", "Shop", "27 October 2026", "CLIENT CONFIRMATION"):
        assert text in xml, text
    # meter numbers only appear in the table, and nobody from HTC is named
    # account numbers only appear in the table (no meter column), and nobody from HTC is named
    assert "A-111, A-222" not in xml and "Meter No." not in xml and "Al Muataz" not in xml
    assert "approved solar PV capacity" in xml and "design" not in xml
    assert "{{" not in xml and "Ref:" not in xml


def test_residential_letter_from_project(c):
    tpl, _, proj = _ids()
    page = c.get(f"/letters/new?template_id={tpl['nedc_residential']}&project_id={proj}")
    assert 'value="Salim Al Rawahi"' in page.text and 'value="2200987654"' in page.text
    r = c.post("/letters/save", data={
        "csrf_token": csrf(page.text), "template_id": tpl["nedc_residential"], "project_id": proj,
        "ref": "", "letter_date": "2026-10-27", "ClientName": "Salim Al Rawahi", "CivilID": "12345678",
        "account_no": ["2200987654", "2200987655"], "location": ["", ""]},
        follow_redirects=False)
    lid = int(r.headers["location"].rsplit("/", 1)[1])
    xml = body_xml(c.get(f"/letters/{lid}/letter.docx").content)
    assert "2200987654" in xml and "2200987655" in xml and "HOMEOWNER CONFIRMATION" in xml
    if soffice_available():
        pdf = c.get(f"/letters/{lid}/letter.pdf")
        assert pdf.status_code == 200 and pdf.content[:4] == b"%PDF"


def test_new_template_and_letterhead_upload(c):
    from PIL import Image
    tok = csrf(c.get("/letters").text)
    r = c.post("/letters/templates/save", data={
        "csrf_token": tok, "name": "Municipality cover letter", "audience": "residential",
        "ref_prefix": "HTC/MM", "recipient": "Muscat Municipality", "subject": "Permit for {{ClientName}}",
        "body": "Dear Sir,\n\n- first point\n- second point\n\n[[htc_signature]]"},
        follow_redirects=False)
    tid = int(r.headers["location"].rsplit("/", 1)[1])
    xml = body_xml(c.get(f"/letters/templates/{tid}/sample.docx").content)
    assert f"Permit for {BLANK}" in xml and "second point" in xml
    # a template with a prefix numbers its letters
    page = c.get(f"/letters/new?template_id={tid}")
    ref = re.search(r'name="ref" value="([^"]+)"', page.text).group(1)
    assert re.fullmatch(r"HTC/MM/\d{4}/001", ref)
    c.post("/letters/save", data={"csrf_token": tok, "template_id": tid, "ref": ref,
                                  "letter_date": "2026-10-27", "ClientName": "X"})
    nxt = re.search(r'name="ref" value="([^"]+)"', c.get(f"/letters/new?template_id={tid}").text).group(1)
    assert nxt.endswith("/002")

    img = io.BytesIO()
    Image.new("RGB", (1200, 200), (0, 60, 120)).save(img, "PNG")
    r = c.post("/letters/letterheads/save", data={"csrf_token": tok, "name": "GreenOps"},
               files={"top": ("top.png", img.getvalue(), "image/png")}, follow_redirects=False)
    assert r.status_code == 303 and "GreenOps" in c.get("/letters").text


def test_arabic_letter_is_right_to_left(c):
    tpl, _, proj = _ids()
    page = c.get(f"/letters/new?template_id={tpl['nedc_residential_ar']}&project_id={proj}")
    r = c.post("/letters/save", data={
        "csrf_token": csrf(page.text), "template_id": tpl["nedc_residential_ar"], "project_id": proj,
        "letter_date": "2026-10-27", "ClientName": "سالم الرواحي", "CivilID": "12345678",
        "account_no": ["2200987654"], "location": [""]}, follow_redirects=False)
    lid = int(r.headers["location"].rsplit("/", 1)[1])
    xml = body_xml(c.get(f"/letters/{lid}/letter.docx").content)
    assert "سالم الرواحي" in xml and "شركة نماء لتوزيع الكهرباء" in xml and "1665626" in xml
    assert "27/10/2026" in xml and "<w:bidi/>" in xml and "<w:bidiVisual/>" in xml


def test_reset_builtin_wording(c):
    tpl, _, _ = _ids()
    tid = tpl["nedc_commercial"]
    tok = csrf(c.get("/letters").text)
    with SessionLocal() as db:
        t = db.get(LetterTemplate, tid)
        t.body = "edited"
        db.commit()
    c.post(f"/letters/templates/{tid}/reset", data={"csrf_token": tok})
    with SessionLocal() as db:
        assert "1665626" in db.get(LetterTemplate, tid).body
