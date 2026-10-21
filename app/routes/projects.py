"""Projects and their authority / client documents."""
from __future__ import annotations

import io
import zipfile
from datetime import date

from fastapi import APIRouter, Depends, HTTPException, Request
from fastapi.concurrency import run_in_threadpool
from fastapi.responses import Response
from sqlalchemy import or_, select
from sqlalchemy.orm import Session

from .. import security as sec
from ..db import get_db
from ..docgen import context as dc
from ..equipment_fields import CATEGORIES
from ..docgen.render import docx_to_pdf, render_docx, soffice_available
from ..models import (CONNECTION_TYPES, MOUNTING_TYPES, NAMA_DOC_ROWS, PREMISES_TYPES,
                      PROJECT_STATUSES, Client, Inverter, Module, Party, Project)
from ..web import f, fk, flash, i, redirect, render, s

router = APIRouter(dependencies=[Depends(sec.current_user), Depends(sec.check_csrf)])


def _get(db: Session, pid: int) -> Project:
    p = db.get(Project, pid)
    if not p:
        raise HTTPException(404, "Project not found")
    return p


def _form_options(db: Session) -> dict:
    parties = db.scalars(select(Party).order_by(Party.name)).all()
    return dict(
        clients=db.scalars(select(Client).order_by(Client.name)).all(),
        modules=db.scalars(select(Module).order_by(Module.make, Module.wp)).all(),
        inverters=sorted(db.scalars(select(Inverter)).all(),
                         key=lambda v: (list(CATEGORIES).index(v.category) if v.category in CATEGORIES else 9,
                                        v.make, v.ac_kw)),
        categories=CATEGORIES,
        contractors=[p for p in parties if p.kind == "contractor"],
        consultants=[p for p in parties if p.kind == "consultant"],
        premises_types=PREMISES_TYPES, connection_types=CONNECTION_TYPES,
        mounting_types=MOUNTING_TYPES, statuses=PROJECT_STATUSES, doc_rows=NAMA_DOC_ROWS,
    )


@router.get("/projects")
def projects(request: Request, q: str = "", status: str = "", db: Session = Depends(get_db)):
    stmt = select(Project).join(Client).order_by(Project.updated_at.desc())
    if q:
        like = f"%{q}%"
        stmt = stmt.where(or_(Project.name.ilike(like), Client.name.ilike(like),
                              Project.account_no.ilike(like)))
    if status:
        stmt = stmt.where(Project.status == status)
    return render(request, "projects.html", nav="projects", projects=db.scalars(stmt).all(),
                  q=q, status=status, statuses=PROJECT_STATUSES)


@router.get("/projects/new")
def project_new(request: Request, client_id: int | None = None, db: Session = Depends(get_db)):
    p = Project(client_id=client_id, inverter_qty=1, phases=3, vat_pct=5.0, tariff_bz=32.0,
                degradation_pct=0.65, premises_type="residential", connection_type="self",
                mounting="rooftop", installation_type="Elevated Flat Roof",
                tariff_note="targeting the consumption rate of the third slab")
    defaults = {pt.kind: pt.id for pt in db.scalars(select(Party).where(Party.is_default)).all()}
    p.contractor_id, p.consultant_id = defaults.get("contractor"), defaults.get("consultant")
    if client_id:
        c = db.get(Client, client_id)
        if c:
            p.name = f"{c.name} – Solar PV"
    return render(request, "project_form.html", nav="projects", p=p, is_new=True,
                  **_form_options(db))


@router.get("/projects/{pid}")
def project_view(pid: int, request: Request, db: Session = Depends(get_db)):
    p = _get(db, pid)
    docs = []
    for key, spec in dc.DOCS.items():
        title = spec.title
        if key == "design":
            title += " (above 11 kW AC)" if p.above_11kw else " (11 kW AC and below)"
        docs.append({"key": key, "title": title, "missing": dc.missing_fields(key, p)})
    from .sizing import project_check
    from ..sizing.rules import settings_for
    check = project_check(db, p)
    block_design = check.blocked and settings_for(db, p).block_design_form
    return render(request, "project_view.html", nav="projects", p=p, docs=docs, check=check,
                  block_design=block_design,
                  pdf_ok=soffice_available(), doc_rows=NAMA_DOC_ROWS,
                  connection_types=CONNECTION_TYPES, mounting_types=MOUNTING_TYPES)


@router.get("/projects/{pid}/edit")
def project_edit(pid: int, request: Request, db: Session = Depends(get_db)):
    p = _get(db, pid)
    return render(request, "project_form.html", nav="projects", p=p, is_new=False,
                  **_form_options(db))


@router.post("/projects/save")
async def project_save(request: Request, db: Session = Depends(get_db)):
    form = await request.form()
    pid = i(form, "id")
    p = _get(db, pid) if pid else Project()
    client_id = fk(form, "client_id")
    if not client_id or not db.get(Client, client_id):
        flash(request, "Choose a client for this project.", "error")
        return redirect(f"/projects/{pid}/edit" if pid else "/projects/new")
    p.client_id = client_id
    p.name = s(form, "name") or "Solar PV project"
    p.status = s(form, "status") if s(form, "status") in PROJECT_STATUSES else "draft"
    p.account_no = s(form, "account_no")
    p.premises_type = s(form, "premises_type") if s(form, "premises_type") in PREMISES_TYPES else "residential"
    p.connection_type = s(form, "connection_type") if s(form, "connection_type") in CONNECTION_TYPES else "self"
    p.mounting = s(form, "mounting") if s(form, "mounting") in MOUNTING_TYPES else "rooftop"
    p.installation_type = s(form, "installation_type")
    for k in ("elevation_m", "project_area_m2", "latitude", "longitude", "tilt_deg",
              "azimuth_deg", "annual_gen_kwh", "subtotal_omr"):
        setattr(p, k, f(form, k))
    for k in ("module_count", "strings", "inverter_qty"):
        setattr(p, k, i(form, k))
    p.module_id, p.inverter_id = fk(form, "module_id"), fk(form, "inverter_id")
    p.consultant_id, p.contractor_id = fk(form, "consultant_id"), fk(form, "contractor_id")
    p.phases = 1 if s(form, "phases") == "1" else 3
    p.internal_transformer = s(form, "internal_transformer") == "yes"
    p.vat_pct = f(form, "vat_pct") if f(form, "vat_pct") is not None else 5.0
    p.tariff_bz = f(form, "tariff_bz") if f(form, "tariff_bz") is not None else 32.0
    p.tariff_note = s(form, "tariff_note")
    p.degradation_pct = f(form, "degradation_pct") if f(form, "degradation_pct") is not None else 0.65
    raw_date = s(form, "agency_date")
    try:
        p.agency_date = date.fromisoformat(raw_date) if raw_date else None
    except ValueError:
        p.agency_date = None
    p.notes = s(form, "notes")
    p.reference_code = s(form, "reference_code").upper()
    upload = form.get("layout_image")
    if upload is not None and getattr(upload, "filename", ""):
        raw = await upload.read()
        try:
            if len(raw) > 15_000_000:
                raise ValueError("too large")
            p.layout_image = _clean_layout(raw)
        except Exception:
            flash(request, "Layout image must be a PNG or JPG under 15 MB; it wasn't saved.", "error")
    if form.get("remove_layout") == "on":
        p.layout_image = None
    db.add(p)
    db.commit()
    db.refresh(p)
    warn = _design_warnings(p)
    from .sizing import project_check
    chk = project_check(db, p)
    if chk.fails:
        warn.append(f"Design check: {len(chk.fails)} hard rule(s) fail. See String & inverter sizing.")
    flash(request, "Project saved." + (" " + " ".join(warn) if warn else ""),
          "warn" if warn else "ok")
    return redirect(f"/projects/{p.id}")


def _clean_layout(raw: bytes) -> bytes:
    """Re-encode an uploaded layout picture (max 2400 px) so only pixels are stored."""
    from PIL import Image
    im = Image.open(io.BytesIO(raw))
    im.load()
    im.thumbnail((2400, 2400))
    out = io.BytesIO()
    if im.mode in ("RGBA", "LA", "P"):
        im.convert("RGBA").save(out, "PNG", optimize=True)
    else:
        im.convert("RGB").save(out, "JPEG", quality=90)
    return out.getvalue()


@router.get("/projects/{pid}/layout.png")
def project_layout(pid: int, db: Session = Depends(get_db)):
    p = _get(db, pid)
    if not p.layout_image:
        raise HTTPException(404)
    mime = "image/png" if p.layout_image[:4] == b"\x89PNG" else "image/jpeg"
    return Response(p.layout_image, media_type=mime, headers={"Cache-Control": "private, no-store"})


def _design_warnings(p: Project) -> list[str]:
    """Basic consistency checks. The full rules engine arrives with the sizing module."""
    out = []
    if p.inverter and p.inverter.phases != p.phases:
        out.append(f"The inverter is {p.inverter.phases}-phase but the project says {p.phases}-phase.")
    if p.inverter and p.internal_transformer != p.inverter.internal_transformer:
        out.append("The internal-transformer answer differs from the inverter's datasheet setting.")
    if p.module_count and p.strings and p.module_count % p.strings:
        out.append(f"{p.module_count} modules don't divide evenly into {p.strings} strings.")
    if p.ac_kw and abs(p.ac_kw - 11) < 1e-9:
        out.append("AC capacity is exactly 11 kW, so the 'below 11 kW' design form will be used.")
    return out


@router.post("/projects/{pid}/duplicate")
def project_duplicate(pid: int, request: Request, db: Session = Depends(get_db)):
    src = _get(db, pid)
    skip = {"id", "created_at", "updated_at"}
    cols = {c.key: getattr(src, c.key) for c in Project.__table__.columns if c.key not in skip}
    cols["name"] = f"{src.name} (copy)"
    cols["status"] = "draft"
    new = Project(**cols)
    db.add(new)
    db.commit()
    flash(request, "Project duplicated. Change the client or details as needed.")
    return redirect(f"/projects/{new.id}/edit")


@router.post("/projects/{pid}/delete")
def project_delete(pid: int, request: Request, db: Session = Depends(get_db)):
    p = _get(db, pid)
    db.delete(p)
    db.commit()
    flash(request, "Project deleted.")
    return redirect("/projects")


# ---- documents -------------------------------------------------------------------------

def _design_blocked(db: Session, p: Project) -> bool:
    """The rule profile can block the NAMA design form while a hard rule fails."""
    from .sizing import project_check
    from ..sizing.rules import settings_for
    return settings_for(db, p).block_design_form and project_check(db, p).blocked


def _render(doc_key: str, p: Project) -> bytes:
    return render_docx(dc.template_for(doc_key, p), dc.build_input(p)).docx


@router.get("/projects/{pid}/documents/{doc_key}.{ext}")
async def project_document(pid: int, doc_key: str, ext: str, db: Session = Depends(get_db)):
    p = _get(db, pid)
    if doc_key not in dc.DOCS or ext not in ("docx", "pdf"):
        raise HTTPException(404)
    if doc_key == "design" and _design_blocked(db, p):
        raise HTTPException(409, "The design fails a hard rule; see String & inverter sizing.")
    data = await run_in_threadpool(_render, doc_key, p)
    if ext == "pdf":
        data = await run_in_threadpool(docx_to_pdf, data)
        mime = "application/pdf"
    else:
        mime = "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
    name = dc.doc_filename(doc_key, p, ext)
    return Response(data, media_type=mime,
                    headers={"Content-Disposition": f'attachment; filename="{name}"',
                             "Cache-Control": "no-store"})


@router.get("/projects/{pid}/pack.zip")
async def project_pack(pid: int, keys: str = "initial,agency,design", pdf: int = 1,
                       db: Session = Depends(get_db)):
    p = _get(db, pid)
    wanted = [k for k in keys.split(",") if k in dc.DOCS]
    if "design" in wanted and _design_blocked(db, p):
        raise HTTPException(409, "The design fails a hard rule; see String & inverter sizing.")

    def build() -> bytes:
        buf = io.BytesIO()
        with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as z:
            for k in wanted:
                docx = _render(k, p)
                z.writestr(dc.doc_filename(k, p, "docx"), docx)
                if pdf and soffice_available():
                    z.writestr(dc.doc_filename(k, p, "pdf"), docx_to_pdf(docx))
        return buf.getvalue()

    data = await run_in_threadpool(build)
    safe = dc.doc_filename("initial", p, "zip").replace("NAMA_Initial_Form_", "Submission_")
    return Response(data, media_type="application/zip",
                    headers={"Content-Disposition": f'attachment; filename="{safe}"',
                             "Cache-Control": "no-store"})
