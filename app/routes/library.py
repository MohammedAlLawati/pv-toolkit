"""Equipment library: modules and inverters, datasheet upload and review."""
from __future__ import annotations

import json
import os

from fastapi import APIRouter, Depends, HTTPException, Request
from fastapi.concurrency import run_in_threadpool
from fastapi.responses import Response
from sqlalchemy import select
from sqlalchemy.orm import Session

from .. import datasheets as dsx
from .. import security as sec
from ..db import get_db
from ..equipment_fields import CATEGORIES, FIELDS, groups, parse_value
from ..models import Datasheet, Inverter, Module, Project
from ..web import flash, i, redirect, render, s

router = APIRouter(dependencies=[Depends(sec.current_user), Depends(sec.check_csrf)])
MODELS = {"module": Module, "inverter": Inverter}
MAX_UPLOAD = 25_000_000


def _model(kind: str):
    if kind not in MODELS:
        raise HTTPException(404)
    return MODELS[kind]


def _sniff(data: bytes) -> str | None:
    if data[:5] == b"%PDF-":
        return "application/pdf"
    if data[:8] == b"\x89PNG\r\n\x1a\n":
        return "image/png"
    if data[:3] == b"\xff\xd8\xff":
        return "image/jpeg"
    return None


def apply_fields(item, kind: str, values: dict) -> list[str]:
    """Copy validated values onto a Module / Inverter. Returns problems with required fields."""
    problems = []
    for f in FIELDS[kind]:
        if f.key not in values:
            continue
        v = values[f.key]
        if f.key == "category" and v not in CATEGORIES:
            v = "residential"
        setattr(item, f.key, v)
        if f.required and v in (None, ""):
            problems.append(f"{f.label} is required.")
    if kind == "inverter":
        item.phases = item.phases or 3
        item.sync_mppt_summary()
    return problems


# ---- list ----------------------------------------------------------------------------

@router.get("/library")
def library(request: Request, cat: str = "", db: Session = Depends(get_db)):
    inverters = db.scalars(select(Inverter).order_by(Inverter.make, Inverter.ac_kw)).all()
    if cat in CATEGORIES:
        inverters = [v for v in inverters if v.category == cat]
    has_sungrow = db.scalar(select(Inverter.id).where(Inverter.make == "Sungrow",
                                                      Inverter.model == "SG150CX")) is not None
    return render(request, "library.html", nav="library", cat=cat, categories=CATEGORIES,
                  modules=db.scalars(select(Module).order_by(Module.make, Module.wp)).all(),
                  inverters=inverters, has_sungrow=has_sungrow,
                  claude_on=bool(os.environ.get("ANTHROPIC_API_KEY")))


@router.post("/library/import-sungrow")
def import_sungrow(request: Request, db: Session = Depends(get_db)):
    from ..seed import import_sungrow_mena
    added, updated = import_sungrow_mena(db)
    flash(request, f"Sungrow MENA range loaded: {added} added, {updated} refreshed.")
    return redirect("/library")


# ---- datasheet upload → review → save ------------------------------------------------------

@router.get("/library/upload")
def upload_page(request: Request, kind: str = "module"):
    _model(kind)
    return render(request, "datasheet_upload.html", nav="library", kind=kind,
                  claude_on=bool(os.environ.get("ANTHROPIC_API_KEY")), model_name=dsx.ANTHROPIC_MODEL)


@router.post("/library/upload")
async def upload(request: Request, db: Session = Depends(get_db)):
    form = await request.form()
    kind = s(form, "kind")
    _model(kind)
    up = form.get("file")
    if up is None or not getattr(up, "filename", ""):
        flash(request, "Choose a datasheet file to upload.", "error")
        return redirect(f"/library/upload?kind={kind}")
    data = await up.read()
    mime = _sniff(data)
    if len(data) > MAX_UPLOAD or mime is None:
        flash(request, "Upload a PDF, PNG or JPG under 25 MB.", "error")
        return redirect(f"/library/upload?kind={kind}")
    res = await run_in_threadpool(dsx.extract, data, mime, kind)
    ds = Datasheet(kind=kind, filename=up.filename[:255], mime=mime, data=data, method=res.method,
                   extracted_json=json.dumps({"models": res.models, "warnings": res.warnings},
                                             default=str))
    db.add(ds)
    db.commit()
    return redirect(f"/library/datasheets/{ds.id}/review")


def _existing(db: Session, kind: str, make: str, model: str):
    M = _model(kind)
    return db.scalar(select(M).where(M.make == make, M.model == model))


@router.get("/library/datasheets/{did}/review")
def review(did: int, request: Request, db: Session = Depends(get_db)):
    ds = db.get(Datasheet, did) or _404()
    payload = json.loads(ds.extracted_json or "{}")
    models = payload.get("models") or []
    if not models:  # nothing read: offer one blank column to fill by hand
        models = [{}]
    rows = []
    for m in models:
        ex = _existing(db, ds.kind, m.get("make") or "", m.get("model") or "")
        rows.append({"values": m, "checks": dsx.check(ds.kind, m) if m else [],
                     "existing": ex})
    return render(request, "datasheet_review.html", nav="library", ds=ds, rows=rows,
                  warnings=payload.get("warnings") or [], groups=groups(ds.kind),
                  categories=CATEGORIES)


@router.post("/library/datasheets/{did}/save")
async def review_save(did: int, request: Request, db: Session = Depends(get_db)):
    ds = db.get(Datasheet, did) or _404()
    form = await request.form()
    n = i(form, "count") or 0
    saved, errors = [], []
    for idx in range(n):
        if form.get(f"m{idx}_include") != "on":
            continue
        values = {f.key: parse_value(f, form.get(f"m{idx}_{f.key}")) for f in FIELDS[ds.kind]}
        missing = [f.label for f in FIELDS[ds.kind] if f.required and values.get(f.key) in (None, "")]
        if missing:
            errors.append(f"Column {idx + 1} ({values.get('model') or 'no model'}): "
                          f"missing {', '.join(missing)}.")
            continue
        existing = _existing(db, ds.kind, values["make"], values["model"])
        if existing is not None:
            # blanks keep what the library already has; only filled-in values overwrite
            values = {k: v for k, v in values.items()
                      if v not in (None, "") and not (k == "internal_transformer" and v is False
                                                      and existing.internal_transformer)}
        item = existing or MODELS[ds.kind]()
        apply_fields(item, ds.kind, values)
        item.datasheet = ds
        db.add(item)
        saved.append(values["model"])
    db.commit()
    if errors:
        flash(request, " ".join(errors), "error")
    if saved:
        flash(request, f"Saved to library: {', '.join(saved)}.")
        return redirect("/library")
    return redirect(f"/library/datasheets/{did}/review")


@router.get("/library/datasheets/{did}/file")
def datasheet_file(did: int, db: Session = Depends(get_db)):
    ds = db.get(Datasheet, did) or _404()
    safe = "".join(ch for ch in ds.filename if ch.isalnum() or ch in "._- ") or "datasheet"
    return Response(ds.data, media_type=ds.mime,
                    headers={"Content-Disposition": f'inline; filename="{safe}"',
                             "Cache-Control": "private, no-store"})


# ---- manual add / edit ----------------------------------------------------------------------

@router.get("/library/{kind}/new")
def equipment_new(kind: str, request: Request):
    _model(kind)
    return render(request, "equipment_form.html", nav="library", kind=kind, item=None,
                  groups=groups(kind), categories=CATEGORIES)


@router.get("/library/{kind}/{eid}")
def equipment_edit(kind: str, eid: int, request: Request, db: Session = Depends(get_db)):
    item = db.get(_model(kind), eid) or _404()
    used = db.scalar(select(Project.id).where(
        (Project.module_id if kind == "module" else Project.inverter_id) == eid).limit(1))
    return render(request, "equipment_form.html", nav="library", kind=kind, item=item,
                  groups=groups(kind), categories=CATEGORIES, used=used is not None,
                  checks=dsx.check(kind, {f.key: getattr(item, f.key, None) for f in FIELDS[kind]}))


@router.post("/library/{kind}/save")
async def equipment_save(kind: str, request: Request, db: Session = Depends(get_db)):
    M = _model(kind)
    form = await request.form()
    eid = i(form, "id")
    item = db.get(M, eid) if eid else M()
    if item is None:
        _404()
    values = {f.key: parse_value(f, form.get(f.key)) for f in FIELDS[kind]}
    missing = [f.label for f in FIELDS[kind] if f.required and values.get(f.key) in (None, "")]
    if missing:
        flash(request, "Required: " + ", ".join(missing) + ".", "error")
        return redirect(f"/library/{kind}/{eid}" if eid else f"/library/{kind}/new")
    apply_fields(item, kind, values)
    up = form.get("datasheet")
    if up is not None and getattr(up, "filename", ""):
        data = await up.read()
        mime = _sniff(data)
        if mime and len(data) <= MAX_UPLOAD:
            item.datasheet = Datasheet(kind=kind, filename=up.filename[:255], mime=mime, data=data,
                                       method="manual")
        else:
            flash(request, "The datasheet wasn't attached: use a PDF, PNG or JPG under 25 MB.", "error")
    db.add(item)
    db.commit()
    flash(request, f"Saved {item.make} {item.model}.")
    return redirect("/library")


@router.post("/library/{kind}/{eid}/delete")
def equipment_delete(kind: str, eid: int, request: Request, db: Session = Depends(get_db)):
    item = db.get(_model(kind), eid) or _404()
    db.delete(item)
    db.commit()
    flash(request, f"Deleted {item.make} {item.model}.")
    return redirect("/library")


def _404():
    raise HTTPException(status_code=404, detail="Not found")
