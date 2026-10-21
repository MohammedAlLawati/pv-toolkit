"""Sizing engine, rules check, recommendations and the sizing pages."""
from __future__ import annotations

import re

import pyotp
import pytest
from fastapi.testclient import TestClient

from app.db import SessionLocal, init_db
from app.main import app
from app.models import Client, Inverter, Module, Project, RuleProfile, User
from app.security import hash_password
from app.seed.sungrow_mena import INVERTERS
from app.sizing import rules as rl
from app.sizing.engine import Design, allocate, check, recommend

PW = "Sizing-Tests-42"
JINKO = dict(make="Jinko Solar", model="JKM545M-72HL4-V (test)", wp=545, voc=49.52, isc=13.94,
             vmp=41.80, imp=13.04, tc_voc_pct=-0.28, tc_isc_pct=0.048, tc_pmax_pct=-0.35,
             noct_c=45, max_system_v=1500, max_fuse_a=25)


def csrf(html: str) -> str:
    return re.search(r'name="csrf_token" value="([^"]+)"', html).group(1)


def sungrow() -> dict[str, Inverter]:
    out = {}
    for n, spec in enumerate(INVERTERS):
        spec = dict(spec)
        spec.pop("datasheet")
        inv = Inverter(**spec)
        inv.id = 1000 + n
        inv.sync_mppt_summary()
        out[inv.model] = inv
    return out


INV = sungrow()
MOD = Module(**JINKO)
S = rl.defaults()


def design(**kw) -> Design:
    base = dict(module=MOD, inverter=INV["SG10RT-P2"], inverter_qty=1, module_count=22, strings=2)
    base.update(kw)
    return Design(**base)


def by_key(result):
    return {c.key: c for c in result.checks}


# ---- engine -----------------------------------------------------------------------------

def test_string_voltages_and_range():
    r = check(design(), S)
    assert r.status == "pass" and not r.blocked
    # Voc at 5 °C: 49.52 × (1 − 0.0028 × −20) = 52.29 V per module
    assert r.string["voc_cold"] == pytest.approx(52.293 * 11, rel=1e-3)
    # hot cell = 50 + 25/800 × 1000 = 81.25 °C
    assert r.temps["cell_hot"] == pytest.approx(81.25)
    # RT series: the 1000 V standard-connector limit sets the longest string (19 × 52.29 = 993.6 V)
    assert r.string_range == (5, 19)
    assert r.string_range[1] == 19
    assert check(design(hv_connectors=True), S).string_range == (5, 21)  # then 1100 V max. DC


def test_connector_limit_blocks_unless_hv_connectors():
    r = check(design(module_count=40, strings=2), S)        # 20 per string: 1045.9 V
    assert by_key(r)["voc_connector"].status == "fail" and r.blocked
    r = check(design(module_count=40, strings=2, hv_connectors=True), S)
    assert by_key(r)["voc_connector"].status == "pass"
    assert by_key(r)["voc_standby"].status == "warn"         # above the 1000 V MPPT max.
    r = check(design(module_count=44, strings=2, hv_connectors=True), S)   # 22 × 52.29 > 1100 V
    assert by_key(r)["voc_max"].status == "fail"


def test_mppt_minimum_when_hot():
    r = check(design(module_count=8, strings=2), S)          # 4 per string: 4 × 32.4 = 129.8 V < 160 V
    assert by_key(r)["vmp_min"].status == "fail"


def test_per_mppt_limits_use_the_lists():
    # SG10RT: MPPT 1 takes 2 strings (32 A / 40 A), MPPT 2 takes 1 (16 A / 20 A)
    r = check(design(module_count=33, strings=3), S)
    assert [row.strings for row in r.groups[0].mppts] == [2, 1]
    assert by_key(r)["isc_mppt"].status == "pass"
    # forcing 2 strings onto MPPT 2 breaks its 1 input, 16 A and 20 A limits
    r = check(design(module_count=33, strings=3, mppt_layout="1/2"), S)
    k = by_key(r)
    assert k["strings_mppt"].status == k["isc_mppt"].status == k["imp_mppt"].status == "fail"
    # 4 strings don't fit a 2/1 inverter
    r = check(design(module_count=44, strings=4), S)
    assert by_key(r)["strings_mppt"].status == "fail" and r.groups[0].overflow == 1


def test_layout_and_split_errors():
    assert by_key(check(design(module_count=23, strings=2), S))["string_split"].status == "fail"
    r = check(design(mppt_layout="2/2"), S)
    assert "puts 4 strings" in by_key(r)["string_split"].detail
    assert allocate(5, [2, 2, 2]) == ([2, 2, 1], 0)
    assert allocate(7, [2, 2, 2]) == ([2, 2, 2], 1)


def test_missing_data_blocks():
    bare = Module(make="X", model="Y", wp=545)
    r = check(design(module=bare), S)
    assert r.status == "incomplete" and r.blocked
    assert "Voc" in by_key(r)["data"].detail


def test_ac_limits_and_warnings():
    r = check(design(connection_limit_kw=8), S)
    assert by_key(r)["ac_connection"].status == "fail"
    s = rl.defaults()
    s.values["single_phase_max_kw"] = 5
    r = check(design(phases=1), s)
    assert by_key(r)["phase_match"].status == "fail"         # SG10RT is 3-phase
    assert by_key(r)["single_phase"].status == "fail"
    r = check(design(module_count=18, strings=2), S)         # 9.81 kWp on 10 kW
    assert by_key(r)["dcac_band"].status == "warn" and not r.blocked


def test_severity_settings():
    s = rl.defaults()
    s.severity["voc_connector"] = "warn"
    r = check(design(module_count=40, strings=2), s)
    assert by_key(r)["voc_connector"].status == "warn" and not r.blocked
    s.severity["voc_connector"] = "off"
    assert "voc_connector" not in by_key(check(design(module_count=40, strings=2), s))
    assert check(design(module_count=40, strings=2), s).string_range == (5, 21)


def test_fuses_and_cables():
    hx = INV["SG320HX-20"]
    r = check(design(inverter=hx, module_count=28 * 25, strings=25), S)
    assert [row.strings for row in r.groups[0].mppts] == [5, 4, 4, 4, 4, 4]
    assert by_key(r)["fuses"].status == "warn"
    r = check(design(dc_cable_m=40, dc_cable_mm2=4, ac_cable_m=80, ac_cable_mm2=4), S)
    k = by_key(r)
    assert k["vdrop_dc"].status == "pass" and r.cables["dc_recommended"] == 4
    assert k["vdrop_ac"].status == "warn" and r.cables["ac_recommended"] > 4


def test_recommend_targets():
    invs = list(INV.values())
    opts = recommend(design(), invs, S, "dc", 12)
    assert opts and opts[0].inverter.model == "SG10RT-P2" and opts[0].inverter_qty == 1
    assert all(not o.result.blocked for o in opts)
    opts = recommend(design(), invs, S, "ac", 100)
    assert opts and all(abs(o.result.ac_kw - 100) <= 25 for o in opts)
    assert all(S.dcac_min <= o.result.ratio <= S.dcac_max for o in opts[:3])
    opts = recommend(design(), invs, S, "modules", 30)
    assert opts and all(o.module_count <= 30 for o in opts)
    # utility scale is quick enough to run on a page request
    opts = recommend(design(), invs, S, "dc", 5000)
    assert opts and all(not o.result.blocked for o in opts)
    assert recommend(design(module=Module(make="X", model="Y", wp=545)), invs, S, "dc", 12) == []


# ---- pages ------------------------------------------------------------------------------

@pytest.fixture(scope="module")
def c():
    init_db()
    secret = pyotp.random_base32()
    with SessionLocal() as db:
        db.add(User(username="sizer", password_hash=hash_password(PW), totp_secret=secret,
                    totp_confirmed=True))
        mod = Module(**JINKO)
        inv = Inverter(**{k: v for k, v in INVERTERS[4].items() if k != "datasheet"})  # SG10RT-P2
        inv.sync_mppt_summary()
        cl = Client(name="Sizing Test Client")
        db.add_all([mod, inv, cl])
        db.flush()
        db.add(Project(client_id=cl.id, name="Sizing villa", module_id=mod.id, inverter_id=inv.id,
                       inverter_qty=1, module_count=22, strings=2, phases=3))
        db.commit()
    with TestClient(app, base_url="https://testserver") as client:
        r = client.get("/login")
        client.post("/login", data={"username": "sizer", "password": PW, "csrf_token": csrf(r.text)})
        r = client.get("/login/2fa")
        client.post("/login/2fa", data={"code": pyotp.TOTP(secret).now(), "csrf_token": csrf(r.text)})
        yield client


def _project():
    with SessionLocal() as db:
        p = db.query(Project).filter(Project.name == "Sizing villa").one()
        return p.id, p.module_id, p.inverter_id


def test_sizing_pages(c):
    pid, mid, iid = _project()
    assert "Sizing villa" in c.get("/sizing").text
    page = c.get(f"/projects/{pid}/sizing")
    assert page.status_code == 200 and "Every rule passes" in page.text
    assert "Every rule passes" in c.get(f"/projects/{pid}").text
    tok = csrf(page.text)

    form = {"csrf_token": tok, "module_id": mid, "inverter_id": iid, "inverter_qty": "1",
            "module_count": "40", "strings": "2", "phases": "3"}
    r = c.post(f"/projects/{pid}/sizing/preview", data=form)
    assert "reports blocked" in r.text and "standard DC connectors" in r.text
    assert _project() and c.get(f"/projects/{pid}/sizing").text.count("Every rule passes") >= 1  # not saved

    r = c.post(f"/projects/{pid}/sizing", data=form)
    assert "hard rule(s) fail" in r.text
    form["hv_connectors"] = "yes"
    r = c.post(f"/projects/{pid}/sizing", data=form)
    assert "Design saved" in r.text and "hard rule(s) fail" not in r.text

    r = c.get(f"/projects/{pid}/sizing", params={"module_id": mid, "target_kind": "dc", "target": "12",
                                                 "scope": "any"})
    assert "Use this" in r.text
    r = c.post(f"/projects/{pid}/sizing/apply", data={"csrf_token": tok, "module_id": mid, "inverter_id": iid,
                                                      "inverter_qty": "1", "module_count": "22", "strings": "2"})
    assert "Applied: 22 modules in 2 strings" in r.text


def test_rule_profile_edits_and_design_form_blocking(c):
    pid, mid, iid = _project()
    page = c.get("/rules")
    assert rl.DEFAULT_PROFILE_NAME in page.text
    tok = csrf(page.text)
    with SessionLocal() as db:
        prof = db.query(RuleProfile).filter(RuleProfile.is_default).one()
        prof_id = prof.id
    data = {"csrf_token": tok, "name": rl.DEFAULT_PROFILE_NAME, "is_default": "on",
            **{p.key: ("" if p.default is None else p.default) for p in rl.PARAMS if p.type != "bool"},
            **{"sev_" + r.key: r.default for r in rl.RULES}}
    data["max_ac_kw"] = "8"
    data["block_design_form"] = "on"
    r = c.post(f"/rules/{prof_id}", data=data)
    assert "Rule profile saved" in r.text

    view = c.get(f"/projects/{pid}")
    assert "Blocked by design check" in view.text
    assert c.get(f"/projects/{pid}/documents/design.docx").status_code == 409
    assert c.get(f"/projects/{pid}/documents/initial.docx").status_code == 200

    data.pop("block_design_form")
    data["max_ac_kw"] = ""
    c.post(f"/rules/{prof_id}", data=data)
    assert c.get(f"/projects/{pid}/documents/design.docx").status_code == 200

    r = c.post(f"/rules/{prof_id}/copy", data={"csrf_token": tok})
    assert "(copy)" in r.text
