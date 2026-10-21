"""Passwords, two-factor codes, sessions and CSRF protection."""
from __future__ import annotations

import base64
import hashlib
import hmac
import io
import secrets
import time
from datetime import datetime, timedelta

import bcrypt
import pyotp
import qrcode
import qrcode.image.svg
from fastapi import Depends, Request
from sqlalchemy.orm import Session

from . import config
from .db import get_db
from .models import User


# ---- passwords ------------------------------------------------------------------

def _prehash(password: str) -> bytes:
    # bcrypt only reads 72 bytes; pre-hashing lets long passphrases count in full.
    return base64.b64encode(hashlib.sha256(password.encode()).digest())


def hash_password(password: str) -> str:
    return bcrypt.hashpw(_prehash(password), bcrypt.gensalt(rounds=12)).decode()


def verify_password(password: str, hashed: str) -> bool:
    try:
        return bcrypt.checkpw(_prehash(password), hashed.encode())
    except ValueError:
        return False


# A real hash to compare against when the username is unknown, so response
# time does not reveal whether a username exists.
_DUMMY_HASH = hash_password(secrets.token_urlsafe(16))


def password_problems(password: str) -> list[str]:
    problems = []
    if len(password) < config.MIN_PASSWORD_LENGTH:
        problems.append(f"Use at least {config.MIN_PASSWORD_LENGTH} characters.")
    if password.lower() == password or password.upper() == password:
        problems.append("Mix upper- and lower-case letters.")
    if not any(c.isdigit() for c in password):
        problems.append("Include at least one number.")
    return problems


# ---- two-factor (TOTP, works with Google Authenticator, Microsoft Authenticator, 1Password...) --

def new_totp_secret() -> str:
    return pyotp.random_base32()


def totp_uri(user: User) -> str:
    return pyotp.TOTP(user.totp_secret).provisioning_uri(name=user.username,
                                                         issuer_name=config.APP_NAME)


def totp_qr_svg(uri: str) -> str:
    img = qrcode.make(uri, image_factory=qrcode.image.svg.SvgPathImage, box_size=8)
    buf = io.BytesIO()
    img.save(buf)
    return buf.getvalue().decode()


def verify_totp(user: User, code: str) -> bool:
    """Accept the current code (±30 s) once; a used code cannot be replayed."""
    code = "".join(ch for ch in code if ch.isdigit())
    if not user.totp_secret or len(code) != 6:
        return False
    totp = pyotp.TOTP(user.totp_secret)
    now_step = int(time.time()) // 30
    for step in (now_step - 1, now_step, now_step + 1):
        if hmac.compare_digest(totp.at(step * 30), code):
            if step <= (user.last_totp_step or 0):
                return False
            user.last_totp_step = step
            return True
    return False


# ---- lockout ----------------------------------------------------------------------

def is_locked(user: User) -> bool:
    return bool(user.locked_until and user.locked_until > datetime.utcnow())


def register_failure(user: User) -> None:
    user.failed_attempts = (user.failed_attempts or 0) + 1
    if user.failed_attempts >= config.MAX_FAILED_LOGINS:
        user.locked_until = datetime.utcnow() + timedelta(minutes=config.LOCKOUT_MINUTES)
        user.failed_attempts = 0


def register_success(user: User) -> None:
    user.failed_attempts = 0
    user.locked_until = None


# ---- sessions -----------------------------------------------------------------------

class LoginRequired(Exception):
    pass


class CSRFError(Exception):
    pass


def start_session(request: Request, user: User) -> None:
    request.session.clear()
    request.session.update({
        "uid": user.id,
        "sv": user.session_version,
        "csrf": secrets.token_urlsafe(32),
        "exp": int(time.time()) + config.SESSION_HOURS * 3600,
    })


def current_user(request: Request, db: Session = Depends(get_db)) -> User:
    s = request.session
    uid = s.get("uid")
    if not uid or s.get("exp", 0) < time.time():
        raise LoginRequired()
    user = db.get(User, uid)
    if not user or user.session_version != s.get("sv") or not user.totp_confirmed:
        request.session.clear()
        raise LoginRequired()
    return user


def csrf_token(request: Request) -> str:
    tok = request.session.get("csrf")
    if not tok:
        tok = secrets.token_urlsafe(32)
        request.session["csrf"] = tok
    return tok


async def check_csrf(request: Request) -> None:
    """Every state-changing request must carry the session's CSRF token."""
    if request.method in ("GET", "HEAD", "OPTIONS"):
        return
    sent = request.headers.get("x-csrf-token")
    if not sent:
        form = await request.form()
        sent = form.get("csrf_token")
    expected = request.session.get("csrf")
    if not expected or not sent or not hmac.compare_digest(str(sent), expected):
        raise CSRFError()
