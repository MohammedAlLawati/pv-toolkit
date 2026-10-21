"""Shared helpers for route modules: templates, flash messages, form parsing."""
from __future__ import annotations

from pathlib import Path

from fastapi import Request
from fastapi.responses import RedirectResponse
from fastapi.templating import Jinja2Templates

from . import config
from .security import csrf_token

templates = Jinja2Templates(directory=str(Path(__file__).parent / "templates"))
templates.env.globals["APP_NAME"] = config.APP_NAME
templates.env.globals["csrf_token"] = csrf_token


def _fmt(v, dp=2):
    if v is None or v == "":
        return "—"
    s = f"{v:,.{dp}f}"
    return s.rstrip("0").rstrip(".") if "." in s else s


templates.env.filters["num"] = _fmt


def render(request: Request, name: str, status_code: int = 200, **ctx):
    ctx["flashes"] = request.session.pop("flashes", [])
    ctx.setdefault("nav", "")
    return templates.TemplateResponse(request, name, ctx, status_code=status_code)


def flash(request: Request, message: str, kind: str = "ok") -> None:
    request.session.setdefault("flashes", [])
    request.session["flashes"] = request.session["flashes"] + [[kind, message]]


def redirect(url: str) -> RedirectResponse:
    return RedirectResponse(url, status_code=303)


# ---- form parsing --------------------------------------------------------------------

def s(form, key: str, default: str = "") -> str:
    return str(form.get(key, default) or "").strip()


def f(form, key: str) -> float | None:
    raw = s(form, key).replace(",", "")
    if raw == "":
        return None
    try:
        return float(raw)
    except ValueError:
        return None


def i(form, key: str) -> int | None:
    v = f(form, key)
    return int(round(v)) if v is not None else None


def fk(form, key: str) -> int | None:
    raw = s(form, key)
    return int(raw) if raw.isdigit() else None
