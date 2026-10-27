"""Letters on the company letterhead: issued letters, letter templates and letterheads."""
from __future__ import annotations

import io
import re
from datetime import date

from fastapi import APIRouter, Depends, HTTPException, Request
from fastapi.concurrency import run_in_threadpool
from fastapi.responses import Response
from PIL import Image
from sqlalchemy import select
from sqlalchemy.orm import Session

from .. import security as sec
from ..db import get_db
from ..docgen.render import docx_to_pdf, soffice_available
from ..letters import service as ls
from ..letters.builder import BLOCKS, PLACEHOLDERS
from ..models import Client, Letter, Letterhead, LetterTemplate, Project
from ..web import fk, flash, i, redirect, render, s

router = APIRouter(dependencies=[Depends(sec.current_user), Depends(sec.check_csrf)])

DOCX = "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
AUDIENCES = {"commercial": "Commercial (company with C.R.)", "residential": "Residential (homeowner)"}
LANGUAGES = {"en": "English", "ar": "Arabic (right to left)"}
TEMPLATE_FIELDS = ("name", "recipient", "subject", "body", "confirmation", "enclosures",
                   "purpose", "ref_prefix")
MAX_POINTS = 20


def _404():
    raise HTTPException(status_code=404, detail="Not found")


def _file(data: bytes, name: str, ext: str) -> Response:
    safe = re.sub(r"[^A-Za-z0-9._-]+", "_", name).strip("_") or "letter"
    return Response(data, media_type="application/pdf" if ext == "pdf" else DOCX,
                    headers={"Content-Disposition": f'attachment; filename="{safe}.{ext}"',
                             "Cache-Control": "no-store"})


# ---- list ------------------------------------------------------------------------------

@router.get("/letters")
def letters(request: Request, db: Session = Depends(get_db)):
    ls.ensure_defaults(db)
    return render(request, "letters.html", nav="letters",
                  letters=db.scalars(select(Letter).order_by(Letter.id.desc()).limit(100)).all(),
                  templates=db.scalars(select(LetterTemplate).order_by(LetterTemplate.name)).all(),
                  letterheads=db.scalars(select(Letterhead).order_by(Letterhead.name)).all(),
                  audiences=AUDIENCES, languages=LANGUAGES)


# ---- templates -------------------------------------------------------------------------

@router.get("/letters/templates/new")
def template_new(request: Request, copy: int | None = None, db: Session = Depends(get_db)):
    src = db.get(LetterTemplate, copy) if copy else None
    return render(request, "letter_template_form.html", nav="letters", tpl=None, src=src,
                  audiences=AUDIENCES, languages=LANGUAGES, placeholders=PLACEHOLDERS, blocks=BLOCKS,
                  letterheads=db.scalars(select(Letterhead).order_by(Letterhead.name)).all())


@router.get("/letters/templates/{tid}")
def template_edit(tid: int, request: Request, db: Session = Depends(get_db)):
    tpl = db.get(LetterTemplate, tid) or _404()
    return render(request, "letter_template_form.html", nav="letters", tpl=tpl, src=tpl,
                  audiences=AUDIENCES, languages=LANGUAGES, placeholders=PLACEHOLDERS, blocks=BLOCKS,
                  letterheads=db.scalars(select(Letterhead).order_by(Letterhead.name)).all(),
                  pdf_ok=soffice_available())


@router.post("/letters/templates/save")
async def template_save(request: Request, db: Session = Depends(get_db)):
    form = await request.form()
    tid = i(form, "id")
    tpl = db.get(LetterTemplate, tid) if tid else LetterTemplate()
    if tpl is None:
        _404()
    if not s(form, "name"):
        flash(request, "Template name is required.", "error")
        return redirect(f"/letters/templates/{tid}" if tid else "/letters/templates/new")
    for k in TEMPLATE_FIELDS:
        setattr(tpl, k, str(form.get(k, "") or "").replace("\r\n", "\n").strip())
    tpl.audience = s(form, "audience") if s(form, "audience") in AUDIENCES else "commercial"
    tpl.language = s(form, "language") if s(form, "language") in LANGUAGES else "en"
    tpl.letterhead_id = fk(form, "letterhead_id")
    db.add(tpl)
    db.commit()
    flash(request, f"Saved template {tpl.name}.")
    return redirect(f"/letters/templates/{tpl.id}")


@router.post("/letters/templates/{tid}/reset")
def template_reset(tid: int, request: Request, db: Session = Depends(get_db)):
    tpl = db.get(LetterTemplate, tid) or _404()
    if ls.reset_to_builtin(tpl):
        db.commit()
        flash(request, f"Put {tpl.name} back to the built-in wording.")
    return redirect(f"/letters/templates/{tid}")


@router.post("/letters/templates/{tid}/delete")
def template_delete(tid: int, request: Request, db: Session = Depends(get_db)):
    tpl = db.get(LetterTemplate, tid) or _404()
    db.delete(tpl)
    db.commit()
    flash(request, f"Deleted template {tpl.name}. Letters already issued from it keep their values "
                   "but can't be downloaded again.")
    return redirect("/letters")


@router.get("/letters/templates/{tid}/sample.{ext}")
async def template_sample(tid: int, ext: str, db: Session = Depends(get_db)):
    tpl = db.get(LetterTemplate, tid) or _404()
    if ext not in ("docx", "pdf"):
        _404()
    data = await run_in_threadpool(ls.render_sample, db, tpl)
    if ext == "pdf":
        data = await run_in_threadpool(docx_to_pdf, data)
    return _file(data, f"Sample {tpl.name}", ext)


# ---- letterheads -----------------------------------------------------------------------

def _clean_png(raw: bytes) -> bytes:
    """Re-encode an uploaded letterhead image as PNG (strips anything that isn't pixels)."""
    im = Image.open(io.BytesIO(raw))
    im.load()
    if im.width > 4000:
        im.thumbnail((4000, 4000))
    out = io.BytesIO()
    im.convert("RGBA").save(out, "PNG")
    return out.getvalue()


@router.get("/letters/letterheads/new")
def letterhead_new(request: Request):
    return render(request, "letterhead_form.html", nav="letters", head=None)


@router.get("/letters/letterheads/{hid}")
def letterhead_edit(hid: int, request: Request, db: Session = Depends(get_db)):
    head = db.get(Letterhead, hid) or _404()
    return render(request, "letterhead_form.html", nav="letters", head=head)


@router.post("/letters/letterheads/save")
async def letterhead_save(request: Request, db: Session = Depends(get_db)):
    form = await request.form()
    hid = i(form, "id")
    head = db.get(Letterhead, hid) if hid else Letterhead()
    if head is None:
        _404()
    head.name = s(form, "name")
    back = f"/letters/letterheads/{hid}" if hid else "/letters/letterheads/new"
    if not head.name:
        flash(request, "Name is required.", "error")
        return redirect(back)
    for part in ("top", "bottom"):
        upload = form.get(part)
        if upload is not None and getattr(upload, "filename", ""):
            raw = await upload.read()
            if len(raw) > 10_000_000:
                flash(request, "Letterhead images must be under 10 MB.", "error")
                return redirect(back)
            try:
                setattr(head, part, _clean_png(raw))
            except Exception:
                flash(request, "That file isn't an image we can read (use PNG or JPG).", "error")
                return redirect(back)
        if form.get(f"remove_{part}") == "on":
            setattr(head, part, None)
    if form.get("is_default") == "on" or not db.scalars(select(Letterhead)).first():
        for other in db.scalars(select(Letterhead)).all():
            other.is_default = False
        head.is_default = True
    db.add(head)
    db.commit()
    flash(request, f"Saved letterhead {head.name}.")
    return redirect("/letters")


@router.get("/letters/letterheads/{hid}/{part}.png")
def letterhead_image(hid: int, part: str, db: Session = Depends(get_db)):
    head = db.get(Letterhead, hid)
    data = getattr(head, part, None) if head and part in ("top", "bottom") else None
    if not data:
        _404()
    return Response(data, media_type="image/png", headers={"Cache-Control": "private, no-store"})


@router.post("/letters/letterheads/{hid}/delete")
def letterhead_delete(hid: int, request: Request, db: Session = Depends(get_db)):
    head = db.get(Letterhead, hid) or _404()
    db.delete(head)
    db.commit()
    flash(request, f"Deleted letterhead {head.name}.")
    return redirect("/letters")


# ---- letters ---------------------------------------------------------------------------

def _form_ctx(db: Session, tpl: LetterTemplate) -> dict:
    return dict(
        tpl=tpl, fields=ls.form_fields(tpl), audiences=AUDIENCES,
        templates=db.scalars(select(LetterTemplate).order_by(LetterTemplate.name)).all(),
        clients=db.scalars(select(Client).order_by(Client.name)).all(),
        projects=db.scalars(select(Project).order_by(Project.name)).all(),
        pdf_ok=soffice_available())


def _rows(points: list[dict[str, str]], audience: str) -> list[dict[str, str]]:
    """Points plus empty rows to type into (no JavaScript needed)."""
    spare = 3 if audience == "commercial" else max(0, 2 - len(points))
    return points + [{} for _ in range(max(spare, 1 if not points else 0))]


@router.get("/letters/new")
def letter_new(request: Request, template_id: int | None = None, client_id: int | None = None,
               project_id: int | None = None, db: Session = Depends(get_db)):
    ls.ensure_defaults(db)
    tpl = db.get(LetterTemplate, template_id) if template_id else None
    tpl = tpl or db.scalars(select(LetterTemplate).order_by(LetterTemplate.id)).first()
    if tpl is None:
        flash(request, "Create a letter template first.", "error")
        return redirect("/letters/templates/new")
    client = db.get(Client, client_id) if client_id else None
    project = db.get(Project, project_id) if project_id else None
    values, points = ls.prefill(db, tpl, client, project)
    return render(request, "letter_form.html", nav="letters", letter=None, values=values,
                  rows=_rows(points, tpl.audience), ref=ls.next_ref(db, tpl.ref_prefix),
                  letter_date=date.today().isoformat(),
                  client_id=(client.id if client else (project.client_id if project else None)),
                  project_id=project.id if project else None, **_form_ctx(db, tpl))


@router.get("/letters/{lid}")
def letter_edit(lid: int, request: Request, db: Session = Depends(get_db)):
    letter = db.get(Letter, lid) or _404()
    tpl = letter.template
    if tpl is None:
        flash(request, "This letter's template was deleted, so it can't be edited.", "error")
        return redirect("/letters")
    _docx, missing = ls.render_letter(db, letter)
    labels = dict(ls.form_fields(tpl)) | {"MeterList": "meter numbers",
                                                   "AccountList": "account numbers", "Date": "date"}
    return render(request, "letter_form.html", nav="letters", letter=letter, values=letter.values,
                  missing=sorted(labels.get(k, k) for k in missing),
                  rows=_rows(letter.points, tpl.audience), ref=letter.ref,
                  letter_date=letter.letter_date.isoformat() if letter.letter_date else "",
                  client_id=letter.client_id, project_id=letter.project_id, **_form_ctx(db, tpl))


@router.post("/letters/save")
async def letter_save(request: Request, db: Session = Depends(get_db)):
    form = await request.form()
    lid = i(form, "id")
    letter = db.get(Letter, lid) if lid else Letter()
    if letter is None:
        _404()
    tpl = db.get(LetterTemplate, fk(form, "template_id") or 0) or _404()
    letter.template_id = tpl.id
    letter.client_id = fk(form, "client_id") if db.get(Client, fk(form, "client_id") or 0) else None
    letter.project_id = fk(form, "project_id") if db.get(Project, fk(form, "project_id") or 0) else None
    letter.ref = s(form, "ref") or ls.next_ref(db, tpl.ref_prefix)
    try:
        letter.letter_date = date.fromisoformat(s(form, "letter_date"))
    except ValueError:
        letter.letter_date = date.today()
    keys = {k for k, _ in ls.form_fields(tpl)}
    letter.values_json = ls.dumps({k: s(form, k) for k in sorted(keys)})
    accounts, places = form.getlist("account_no"), form.getlist("location")
    points = []
    for a, loc in zip(accounts, places):
        row = {"account_no": str(a).strip(), "location": str(loc).strip()}
        if any(row.values()):
            points.append(row)
    letter.points_json = ls.dumps(points[:MAX_POINTS])
    db.add(letter)
    db.commit()
    flash(request, f"Saved the letter for {letter.title}.")
    return redirect(f"/letters/{letter.id}")


@router.get("/letters/{lid}/letter.{ext}")
async def letter_file(lid: int, ext: str, db: Session = Depends(get_db)):
    letter = db.get(Letter, lid) or _404()
    if ext not in ("docx", "pdf") or letter.template is None:
        _404()
    data, _missing = await run_in_threadpool(ls.render_letter, db, letter)
    if ext == "pdf":
        data = await run_in_threadpool(docx_to_pdf, data)
    return _file(data, f"{letter.ref} {letter.title}".strip(), ext)


@router.post("/letters/{lid}/delete")
def letter_delete(lid: int, request: Request, db: Session = Depends(get_db)):
    letter = db.get(Letter, lid) or _404()
    db.delete(letter)
    db.commit()
    flash(request, f"Deleted the letter for {letter.title}.")
    return redirect("/letters")
