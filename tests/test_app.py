"""End-to-end tests:  pytest -q"""
from __future__ import annotations

import io
import os
import re
import tempfile
import time
import zipfile

import pyotp
import pytest


from fastapi.testclient import TestClient  # noqa: E402

from app.db import SessionLocal, init_db  # noqa: E402
from app.main import app  # noqa: E402
from app.models import User  # noqa: E402
from app.security import hash_password  # noqa: E402

PASSWORD = "Correct-Horse-42"


def csrf(html: str) -> str:
    return re.search(r'name="csrf_token" value="([^"]+)"', html).group(1)


def code_for(secret: str, offset_steps: int = 0) -> str:
    return pyotp.TOTP(secret).at(time.time() + 30 * offset_steps)


@pytest.fixture(scope="module")
def client():
    init_db()
    with SessionLocal() as db:
        db.add(User(username="mohammed", password_hash=hash_password(PASSWORD)))
        db.commit()
    with TestClient(app, base_url="https://testserver") as c:
        yield c


def login(c: TestClient, password=PASSWORD):
    r = c.get("/login")
    return c.post("/login", data={"username": "mohammed", "password": password,
                                  "csrf_token": csrf(r.text)}, follow_redirects=False)


def test_requires_login(client):
    r = client.get("/projects", follow_redirects=False)
    assert r.status_code == 303 and r.headers["location"] == "/login"


def test_wrong_password_and_no_csrf(client):
    assert login(client, "nope").status_code == 400
    r = client.post("/login", data={"username": "mohammed", "password": PASSWORD})
    assert r.status_code == 403  # missing CSRF token


def test_first_login_sets_up_2fa_then_second_login_asks_code(client):
    r = login(client)
    assert r.headers["location"] == "/setup-2fa"
    page = client.get("/setup-2fa")
    assert "<svg" in page.text
    with SessionLocal() as db:
        secret = db.query(User).one().totp_secret
    r = client.post("/setup-2fa", data={"code": "000000", "csrf_token": csrf(page.text)})
    assert r.status_code == 400
    r = client.post("/setup-2fa", data={"code": code_for(secret), "csrf_token": csrf(page.text)},
                    follow_redirects=False)
    assert r.headers["location"] == "/"
    assert client.get("/", follow_redirects=False).status_code == 200

    # sign out invalidates the session
    client.post("/logout", data={"csrf_token": csrf(client.get("/").text)})
    assert client.get("/", follow_redirects=False).status_code == 303

    r = login(client)
    assert r.headers["location"] == "/login/2fa"
    page = client.get("/login/2fa")
    # the code used during setup cannot be replayed
    r = client.post("/login/2fa", data={"code": code_for(secret), "csrf_token": csrf(page.text)})
    assert r.status_code == 400
    r = client.post("/login/2fa", data={"code": code_for(secret, 1), "csrf_token": csrf(page.text)},
                    follow_redirects=False)
    assert r.headers["location"] == "/"


def test_full_project_flow(client):
    tok = csrf(client.get("/").text)
    r = client.post("/clients/save", data={"csrf_token": tok, "name": "Ahmed Salim Al Harthy",
                                           "id_no": "12345678", "mobile": "99123456",
                                           "wilaya": "Seeb", "governorate": "Muscat"},
                    follow_redirects=False)
    cid = int(r.headers["location"].rsplit("/", 1)[1])
    client.post("/library/module/save", data={"csrf_token": tok, "make": "Jinko Solar",
                                              "model": "JKM620N-78HL4-BDV", "wp": "620",
                                              "technology": "N-type bifacial", "length_mm": "2382",
                                              "width_mm": "1134", "thickness_mm": "30"})
    client.post("/library/inverter/save", data={"csrf_token": tok, "make": "Sungrow",
                                                "model": "SG10RT", "ac_kw": "10", "phases": "3"})
    stamp = io.BytesIO()
    from PIL import Image
    Image.new("RGBA", (200, 200), (20, 40, 200, 255)).save(stamp, "PNG")
    client.post("/parties/save", data={"csrf_token": tok, "kind": "contractor",
                                       "name": "Hussam Technology Company", "phone": "+968 9782 9469",
                                       "engineer": "Al Muataz Al Tougi", "is_default": "on"},
                files={"stamp": ("stamp.png", stamp.getvalue(), "image/png")})
    r = client.post("/parties/quick", data={"kind": "consultant", "name": "Sabla Engineering Consultant",
                                            "phone": "22011757", "engineer": "Jamal Alzeedi"},
                    headers={"X-CSRF-Token": tok})
    consultant_id = r.json()["id"]

    page = client.get(f"/projects/new?client_id={cid}")
    assert "Hussam Technology Company" in page.text
    data = {"csrf_token": tok, "client_id": cid, "name": "Al Harthy villa", "account_no": "08023459",
            "premises_type": "residential", "connection_type": "self", "mounting": "rooftop",
            "installation_type": "Elevated Flat Roof", "elevation_m": "2", "project_area_m2": "60",
            "module_id": "1", "module_count": "18", "strings": "2", "tilt_deg": "5",
            "azimuth_deg": "180", "inverter_id": "1", "inverter_qty": "1", "phases": "3",
            "internal_transformer": "no", "annual_gen_kwh": "17850", "subtotal_omr": "2950",
            "vat_pct": "5", "tariff_bz": "32", "degradation_pct": "0.65",
            "consultant_id": consultant_id, "contractor_id": "1"}
    layout = io.BytesIO()
    Image.new("RGB", (1600, 900), (200, 220, 240)).save(layout, "JPEG")
    r = client.post("/projects/save", data=data, follow_redirects=False,
                    files={"layout_image": ("layout.jpg", layout.getvalue(), "image/jpeg")})
    pid = int(r.headers["location"].rsplit("/", 1)[1])
    view = client.get(f"/projects/{pid}")
    assert "11.16 kWp" in view.text and "11 kW and below" in view.text

    for key in ("initial", "agency", "design", "execution"):
        r = client.get(f"/projects/{pid}/documents/{key}.docx")
        assert r.status_code == 200, key
        xml = zipfile.ZipFile(io.BytesIO(r.content)).read("word/document.xml").decode()
        assert "{{" not in xml, f"unfilled placeholder in {key}"
        assert "Ahmed Salim Al Harthy" in xml
    xml = zipfile.ZipFile(io.BytesIO(client.get(f"/projects/{pid}/documents/design.docx").content)
                          ).read("word/document.xml").decode()
    assert "17,850" in xml and "JKM620N-78HL4-BDV" in xml and "180" in xml
    ea = zipfile.ZipFile(io.BytesIO(client.get(f"/projects/{pid}/documents/execution.docx").content)
                         ).read("word/document.xml").decode()
    assert "2,950.000" in ea and "3,097.500" in ea  # subtotal and total with 5% VAT
    z = zipfile.ZipFile(io.BytesIO(client.get(f"/projects/{pid}/documents/execution.docx").content))
    assert "HTC/ASAH/EA/01" in "".join(re.findall(r"<w:t[^>]*>([^<]*)<", z.read("word/footer1.xml").decode()))
    assert any(n.startswith("word/media/filled") for n in z.namelist())  # layout image placed
    assert client.get(f"/projects/{pid}/layout.png").status_code == 200

    r = client.get(f"/projects/{pid}/pack.zip?pdf=0")
    names = zipfile.ZipFile(io.BytesIO(r.content)).namelist()
    assert len(names) == 3 and any("Below_11kW" in n for n in names)

    # above 11 kW AC switches the design form
    data.update(inverter_qty="2", module_count="36", strings="4")
    data["id"] = pid
    client.post("/projects/save", data=data)
    r = client.get(f"/projects/{pid}/documents/design.docx")
    assert "Above_11kW" in r.headers["content-disposition"]


def test_security_headers(client):
    r = client.get("/login")
    assert "frame-ancestors 'none'" in r.headers["content-security-policy"]
    assert r.headers["x-frame-options"] == "DENY"
