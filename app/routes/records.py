"""Dashboard, clients, contractor / consultant lists, account."""
from __future__ import annotations

import io

from fastapi import APIRouter, Depends, HTTPException, Request
from fastapi.responses import JSONResponse, Response
from PIL import Image
from sqlalchemy import func, or_, select
from sqlalchemy.orm import Session

from .. import security as sec
from ..db import get_db
from ..models import Client, Inverter, Module, Party, Project, User
from ..web import f, flash, i, redirect, render, s

router = APIRouter(dependencies=[Depends(sec.current_user), Depends(sec.check_csrf)])


# ---- dashboard -------------------------------------------------------------------------

@router.get("/")
def dashboard(request: Request, db: Session = Depends(get_db)):
    recent = db.scalars(select(Project).order_by(Project.updated_at.desc()).limit(8)).all()
    counts = {
        "clients": db.scalar(select(func.count(Client.id))),
        "projects": db.scalar(select(func.count(Project.id))),
        "modules": db.scalar(select(func.count(Module.id))),
        "inverters": db.scalar(select(func.count(Inverter.id))),
    }
    total_kwp = sum((p.dc_kwp or 0) for p in db.scalars(select(Project)).all())
    return render(request, "dashboard.html", nav="home", recent=recent, counts=counts,
                  total_kwp=total_kwp)


# ---- clients ---------------------------------------------------------------------------

CLIENT_FIELDS = ("name", "id_no", "mobile", "tel", "email", "governorate", "wilaya",
                 "village", "notes")


@router.get("/clients")
def clients(request: Request, q: str = "", db: Session = Depends(get_db)):
    stmt = select(Client).order_by(Client.name)
    if q:
        like = f"%{q}%"
        stmt = stmt.where(or_(Client.name.ilike(like), Client.mobile.ilike(like),
                              Client.id_no.ilike(like), Client.wilaya.ilike(like)))
    return render(request, "clients.html", nav="clients", clients=db.scalars(stmt).all(), q=q)


@router.get("/clients/new")
def client_new(request: Request):
    return render(request, "client_form.html", nav="clients", client=None)


@router.get("/clients/{cid}")
def client_edit(cid: int, request: Request, db: Session = Depends(get_db)):
    c = db.get(Client, cid) or _404()
    return render(request, "client_form.html", nav="clients", client=c)


@router.post("/clients/save")
async def client_save(request: Request, db: Session = Depends(get_db)):
    form = await request.form()
    cid = i(form, "id")
    c = db.get(Client, cid) if cid else Client()
    if c is None:
        _404()
    if not s(form, "name"):
        flash(request, "Client name is required.", "error")
        return redirect(f"/clients/{cid}" if cid else "/clients/new")
    for k in CLIENT_FIELDS:
        setattr(c, k, s(form, k))
    db.add(c)
    db.commit()
    flash(request, f"Saved {c.name}.")
    if s(form, "then") == "project":
        return redirect(f"/projects/new?client_id={c.id}")
    return redirect(f"/clients/{c.id}")


@router.post("/clients/{cid}/delete")
def client_delete(cid: int, request: Request, db: Session = Depends(get_db)):
    c = db.get(Client, cid) or _404()
    db.delete(c)
    db.commit()
    flash(request, f"Deleted {c.name} and their projects.")
    return redirect("/clients")


# ---- contractors & consultants ---------------------------------------------------------

@router.get("/parties")
def parties(request: Request, db: Session = Depends(get_db)):
    rows = db.scalars(select(Party).order_by(Party.kind, Party.name)).all()
    return render(request, "parties.html", nav="parties",
                  contractors=[p for p in rows if p.kind == "contractor"],
                  consultants=[p for p in rows if p.kind == "consultant"])


@router.get("/parties/new")
def party_new(request: Request, kind: str = "contractor"):
    return render(request, "party_form.html", nav="parties", party=None, kind=kind)


@router.get("/parties/{pid}")
def party_edit(pid: int, request: Request, db: Session = Depends(get_db)):
    p = db.get(Party, pid) or _404()
    return render(request, "party_form.html", nav="parties", party=p, kind=p.kind)


def _clean_image(raw: bytes) -> bytes:
    """Re-encode an uploaded stamp as PNG (strips anything that isn't pixels)."""
    im = Image.open(io.BytesIO(raw))
    im.load()
    if max(im.size) > 1200:
        im.thumbnail((1200, 1200))
    out = io.BytesIO()
    im.convert("RGBA").save(out, "PNG")
    return out.getvalue()


@router.post("/parties/save")
async def party_save(request: Request, db: Session = Depends(get_db)):
    form = await request.form()
    pid = i(form, "id")
    p = db.get(Party, pid) if pid else Party()
    p.kind = "consultant" if s(form, "kind") == "consultant" else "contractor"
    p.name = s(form, "name")
    if not p.name:
        flash(request, "Name is required.", "error")
        return redirect(request.headers.get("referer", "/parties"))
    for k in ("phone", "email", "address", "engineer"):
        setattr(p, k, s(form, k))
    upload = form.get("stamp")
    if upload is not None and getattr(upload, "filename", ""):
        raw = await upload.read()
        if len(raw) > 5_000_000:
            flash(request, "Stamp image must be under 5 MB.", "error")
            return redirect(request.headers.get("referer", "/parties"))
        try:
            p.stamp = _clean_image(raw)
        except Exception:
            flash(request, "That file isn't an image we can read (use PNG or JPG).", "error")
            return redirect(request.headers.get("referer", "/parties"))
    if form.get("remove_stamp") == "on":
        p.stamp = None
    if form.get("is_default") == "on":
        for other in db.scalars(select(Party).where(Party.kind == p.kind)).all():
            other.is_default = False
        p.is_default = True
    else:
        p.is_default = False
    db.add(p)
    db.commit()
    flash(request, f"Saved {p.name}.")
    return redirect("/parties")


@router.post("/parties/quick")
async def party_quick(request: Request, db: Session = Depends(get_db)):
    """Add a contractor / consultant from the project form without leaving it."""
    form = await request.form()
    name = s(form, "name")
    if not name:
        return JSONResponse({"error": "Name is required"}, status_code=400)
    p = Party(kind="consultant" if s(form, "kind") == "consultant" else "contractor",
              name=name, phone=s(form, "phone"), engineer=s(form, "engineer"))
    db.add(p)
    db.commit()
    return {"id": p.id, "name": p.name, "kind": p.kind}


@router.get("/parties/{pid}/stamp.png")
def party_stamp(pid: int, db: Session = Depends(get_db)):
    p = db.get(Party, pid)
    if not p or not p.stamp:
        _404()
    return Response(p.stamp, media_type="image/png", headers={"Cache-Control": "private, no-store"})


@router.post("/parties/{pid}/delete")
def party_delete(pid: int, request: Request, db: Session = Depends(get_db)):
    p = db.get(Party, pid) or _404()
    db.delete(p)
    db.commit()
    flash(request, f"Deleted {p.name}.")
    return redirect("/parties")


# ---- account ---------------------------------------------------------------------------

@router.get("/account")
def account(request: Request, user: User = Depends(sec.current_user)):
    return render(request, "account.html", nav="account", user=user)


@router.post("/account/password")
async def change_password(request: Request, user: User = Depends(sec.current_user),
                          db: Session = Depends(get_db)):
    form = await request.form()
    if not sec.verify_password(str(form.get("current", "")), user.password_hash):
        flash(request, "Current password is incorrect.", "error")
        return redirect("/account")
    new, confirm = str(form.get("new", "")), str(form.get("confirm", ""))
    problems = sec.password_problems(new)
    if new != confirm:
        problems.append("The two new passwords don't match.")
    if problems:
        flash(request, " ".join(problems), "error")
        return redirect("/account")
    user.password_hash = sec.hash_password(new)
    user.session_version += 1
    db.commit()
    request.session.clear()
    return redirect("/login")


def _404():
    raise HTTPException(status_code=404, detail="Not found")
