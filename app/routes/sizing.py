"""String and inverter sizing: per-project design check, recommendations and rule profiles."""
from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, Request
from fastapi.responses import HTMLResponse
from sqlalchemy import select
from sqlalchemy.orm import Session

from .. import security as sec
from ..db import get_db
from ..equipment_fields import CATEGORIES
from ..models import Inverter, Module, Project, RuleProfile
from ..sizing import rules as rl
from ..sizing.engine import Design, check, recommend
from ..web import f, fk, flash, i, redirect, render, s, templates

router = APIRouter(dependencies=[Depends(sec.current_user), Depends(sec.check_csrf)])

DESIGN_FLOATS = ("t_min_c", "t_max_c", "connection_limit_kw", "dc_cable_m", "dc_cable_mm2",
                 "ac_cable_m", "ac_cable_mm2")
TARGETS = {"dc": "DC capacity (kWp)", "ac": "AC capacity (kW)", "modules": "Modules that fit (max.)"}


def _get(db: Session, pid: int) -> Project:
    p = db.get(Project, pid)
    if not p:
        raise HTTPException(404, "Project not found")
    return p


def project_check(db: Session, p: Project):
    """The rules check for a saved project (used by the project page and documents)."""
    return check(Design.from_project(p), rl.settings_for(db, p))


def _inverters(db: Session) -> list[Inverter]:
    return sorted(db.scalars(select(Inverter)).all(),
                  key=lambda v: (list(CATEGORIES).index(v.category) if v.category in CATEGORIES else 9,
                                 v.make, v.ac_kw))


def _apply_form(p, form, db: Session) -> None:
    """Copy the design inputs from the sizing form onto a project (or a stand-in object)."""
    p.module_id, p.inverter_id = fk(form, "module_id"), fk(form, "inverter_id")
    p.module = db.get(Module, p.module_id) if p.module_id else None
    p.inverter = db.get(Inverter, p.inverter_id) if p.inverter_id else None
    for k in ("module_count", "strings", "inverter_qty"):
        setattr(p, k, i(form, k))
    for k in DESIGN_FLOATS:
        setattr(p, k, f(form, k))
    p.phases = 1 if s(form, "phases") == "1" else 3
    p.mppt_layout = s(form, "mppt_layout").replace(" ", "")
    p.hv_connectors = s(form, "hv_connectors") == "yes"
    pid = fk(form, "rule_profile_id")
    p.rule_profile_id = pid
    p.rule_profile = db.get(RuleProfile, pid) if pid else None


def _page_ctx(db: Session, p: Project) -> dict:
    rl.ensure_default_profile(db)
    return dict(
        modules=db.scalars(select(Module).order_by(Module.make, Module.wp)).all(),
        inverters=_inverters(db), categories=CATEGORIES, targets=TARGETS,
        profiles=db.scalars(select(RuleProfile).order_by(RuleProfile.name)).all(),
        settings=rl.settings_for(db, p),
    )


@router.get("/sizing")
def sizing_index(request: Request, db: Session = Depends(get_db)):
    projects = db.scalars(select(Project).order_by(Project.updated_at.desc())).all()
    rows = [(p, project_check(db, p)) for p in projects]
    return render(request, "sizing_index.html", nav="sizing", rows=rows)


@router.get("/projects/{pid}/sizing")
def sizing_page(pid: int, request: Request, target_kind: str = "", target: str = "",
                scope: str = "any", module_id: str = "", db: Session = Depends(get_db)):
    p = _get(db, pid)
    ctx = _page_ctx(db, p)
    result = check(Design.from_project(p), ctx["settings"])
    options, rec = None, None
    if target_kind in TARGETS:
        try:
            tval = float(target.replace(",", ""))
        except ValueError:
            tval = 0
        mod = db.get(Module, int(module_id)) if module_id.isdigit() else p.module
        invs = ctx["inverters"]
        if scope in CATEGORIES:
            invs = [v for v in invs if v.category == scope]
        elif scope.isdigit():
            invs = [v for v in invs if v.id == int(scope)]
        base = Design.from_project(p)
        base.module = mod
        options = recommend(base, invs, ctx["settings"], target_kind, tval) if mod else []
        rec = dict(target_kind=target_kind, target=target, scope=scope, module=mod)
    return render(request, "sizing.html", nav="sizing", p=p, r=result, options=options, rec=rec, **ctx)


@router.post("/projects/{pid}/sizing")
async def sizing_save(pid: int, request: Request, db: Session = Depends(get_db)):
    p = _get(db, pid)
    form = await request.form()
    _apply_form(p, form, db)
    db.commit()
    r = project_check(db, p)
    if r.fails:
        flash(request, f"Design saved. {len(r.fails)} hard rule(s) fail, so reports are blocked.", "error")
    elif r.unknown:
        flash(request, "Design saved. Some rules can't be checked yet: see 'Missing'.", "warn")
    else:
        flash(request, "Design saved." + (f" {len(r.warnings)} warning(s)." if r.warnings else
                                          " Every rule passes."), "warn" if r.warnings else "ok")
    return redirect(f"/projects/{p.id}/sizing")


@router.post("/projects/{pid}/sizing/preview", response_class=HTMLResponse)
async def sizing_preview(pid: int, request: Request, db: Session = Depends(get_db)):
    """Check unsaved inputs as they are typed (the page swaps in the returned results)."""
    p = _get(db, pid)
    form = await request.form()

    class Draft:  # a stand-in so the saved project isn't touched
        pass
    d = Draft()
    _apply_form(d, form, db)
    result = check(Design.from_project(d), rl.settings_for(db, d))
    return templates.TemplateResponse(request, "_sizing_results.html", {"r": result, "p": p})


@router.post("/projects/{pid}/sizing/apply")
async def sizing_apply(pid: int, request: Request, db: Session = Depends(get_db)):
    p = _get(db, pid)
    form = await request.form()
    mid, iid = fk(form, "module_id"), fk(form, "inverter_id")
    if not (mid and db.get(Module, mid) and iid and db.get(Inverter, iid)):
        raise HTTPException(400, "Unknown module or inverter")
    p.module_id, p.inverter_id = mid, iid
    p.inverter_qty, p.module_count, p.strings = i(form, "inverter_qty"), i(form, "module_count"), i(form, "strings")
    p.mppt_layout = ""
    inv = db.get(Inverter, iid)
    p.internal_transformer = inv.internal_transformer
    db.commit()
    flash(request, f"Applied: {p.module_count} modules in {p.strings} strings on {p.inverter_qty} × {inv.model}. "
                   "Change anything below; every change is re-checked.")
    return redirect(f"/projects/{p.id}/sizing")


# ---- rule profiles ---------------------------------------------------------------------

@router.get("/rules")
def rules_page(request: Request, pid: int | None = None, db: Session = Depends(get_db)):
    rl.ensure_default_profile(db)
    profiles = db.scalars(select(RuleProfile).order_by(RuleProfile.name)).all()
    prof = db.get(RuleProfile, pid) if pid else next(x for x in profiles if x.is_default)
    if not prof:
        raise HTTPException(404)
    return render(request, "rules.html", nav="rules", profiles=profiles, prof=prof,
                  st=rl.settings_from_json(prof.settings_json), groups=rl.param_groups(),
                  rules=rl.RULES, severities=rl.SEVERITIES)


@router.post("/rules/{pid}")
async def rules_save(pid: int, request: Request, db: Session = Depends(get_db)):
    prof = db.get(RuleProfile, pid)
    if not prof:
        raise HTTPException(404)
    form = await request.form()
    st = rl.settings_from_json(prof.settings_json)
    for prm in rl.PARAMS:
        if prm.type == "bool":
            st.values[prm.key] = s(form, prm.key) == "on"
        else:
            st.values[prm.key] = f(form, prm.key)
            if st.values[prm.key] is None and prm.default is not None:
                st.values[prm.key] = prm.default   # only optional limits may be blank
    for rule in rl.RULES:
        v = s(form, "sev_" + rule.key)
        if v in rl.SEVERITIES:
            st.severity[rule.key] = v
    if st.values["dcac_min"] > st.values["dcac_max"]:
        flash(request, "The lowest DC/AC ratio must be below the highest. Nothing was saved.", "error")
        return redirect(f"/rules?pid={pid}")
    prof.name = s(form, "name") or prof.name
    prof.settings_json = rl.settings_to_json(st)
    if s(form, "is_default") == "on" and not prof.is_default:
        for other in db.scalars(select(RuleProfile)).all():
            other.is_default = False
        prof.is_default = True
    db.commit()
    flash(request, "Rule profile saved. Every project using it is re-checked.")
    return redirect(f"/rules?pid={pid}")


@router.post("/rules/{pid}/copy")
def rules_copy(pid: int, request: Request, db: Session = Depends(get_db)):
    src = db.get(RuleProfile, pid)
    if not src:
        raise HTTPException(404)
    new = RuleProfile(name=f"{src.name} (copy)", settings_json=src.settings_json, is_default=False)
    db.add(new)
    db.commit()
    flash(request, "Profile copied. Rename it and change the values you need.")
    return redirect(f"/rules?pid={new.id}")
