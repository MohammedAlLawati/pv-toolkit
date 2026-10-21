"""Login (password + two-factor code), first-time 2FA setup, logout."""
from __future__ import annotations

import time

from fastapi import APIRouter, Depends, Request
from sqlalchemy import select
from sqlalchemy.orm import Session

from .. import security as sec
from ..db import get_db
from ..models import User
from ..web import redirect, render, s

router = APIRouter()
PENDING_SECONDS = 300
GENERIC_ERROR = "Incorrect username or password."


def _pending_user(request: Request, db: Session, key: str) -> User | None:
    uid = request.session.get(key)
    if not uid or request.session.get("pending_exp", 0) < time.time():
        return None
    return db.get(User, uid)


@router.get("/login")
def login_page(request: Request):
    if request.session.get("uid"):
        return redirect("/")
    return render(request, "login.html", step="password")


@router.post("/login", dependencies=[Depends(sec.check_csrf)])
async def login_submit(request: Request, db: Session = Depends(get_db)):
    form = await request.form()
    username, password = s(form, "username"), str(form.get("password", ""))
    user = db.scalar(select(User).where(User.username == username))
    if user is None:
        sec.verify_password(password, sec._DUMMY_HASH)  # equalise timing
        return render(request, "login.html", step="password", error=GENERIC_ERROR, status_code=400)
    if sec.is_locked(user):
        return render(request, "login.html", step="password", status_code=429,
                      error="Too many failed attempts. Try again in 15 minutes.")
    if not sec.verify_password(password, user.password_hash):
        sec.register_failure(user)
        db.commit()
        return render(request, "login.html", step="password", error=GENERIC_ERROR, status_code=400)

    csrf = request.session.get("csrf")
    request.session.clear()
    request.session["csrf"] = csrf
    request.session["pending_exp"] = int(time.time()) + PENDING_SECONDS
    if not user.totp_confirmed:
        if not user.totp_secret:
            user.totp_secret = sec.new_totp_secret()
            db.commit()
        request.session["setup_uid"] = user.id
        return redirect("/setup-2fa")
    request.session["pending_uid"] = user.id
    return redirect("/login/2fa")


@router.get("/login/2fa")
def twofa_page(request: Request, db: Session = Depends(get_db)):
    if not _pending_user(request, db, "pending_uid"):
        return redirect("/login")
    return render(request, "login.html", step="code")


@router.post("/login/2fa", dependencies=[Depends(sec.check_csrf)])
async def twofa_submit(request: Request, db: Session = Depends(get_db)):
    user = _pending_user(request, db, "pending_uid")
    if not user:
        return redirect("/login")
    if sec.is_locked(user):
        request.session.clear()
        return render(request, "login.html", step="password", status_code=429,
                      error="Too many failed attempts. Try again in 15 minutes.")
    form = await request.form()
    if not sec.verify_totp(user, s(form, "code")):
        sec.register_failure(user)
        db.commit()
        return render(request, "login.html", step="code", status_code=400,
                      error="That code didn't work. Check your authenticator app and try again.")
    sec.register_success(user)
    db.commit()
    sec.start_session(request, user)
    return redirect("/")


@router.get("/setup-2fa")
def setup_page(request: Request, db: Session = Depends(get_db)):
    user = _pending_user(request, db, "setup_uid")
    if not user:
        return redirect("/login")
    uri = sec.totp_uri(user)
    return render(request, "setup_2fa.html", qr=sec.totp_qr_svg(uri), secret=user.totp_secret)


@router.post("/setup-2fa", dependencies=[Depends(sec.check_csrf)])
async def setup_submit(request: Request, db: Session = Depends(get_db)):
    user = _pending_user(request, db, "setup_uid")
    if not user:
        return redirect("/login")
    form = await request.form()
    if not sec.verify_totp(user, s(form, "code")):
        uri = sec.totp_uri(user)
        return render(request, "setup_2fa.html", qr=sec.totp_qr_svg(uri), secret=user.totp_secret,
                      error="That code didn't match. Make sure your phone's clock is correct.",
                      status_code=400)
    user.totp_confirmed = True
    sec.register_success(user)
    db.commit()
    sec.start_session(request, user)
    return redirect("/")


@router.post("/logout", dependencies=[Depends(sec.check_csrf)])
def logout(request: Request, db: Session = Depends(get_db)):
    uid = request.session.get("uid")
    user = db.get(User, uid) if uid else None
    if user:
        user.session_version += 1  # invalidates every existing session cookie
        db.commit()
    request.session.clear()
    return redirect("/login")
