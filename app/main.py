"""Application entry point:  uvicorn app.main:app"""
from __future__ import annotations

from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI, Request
from fastapi.exceptions import HTTPException
from fastapi.staticfiles import StaticFiles
from starlette.middleware.sessions import SessionMiddleware

from . import config
from .db import init_db
from .routes import auth, library, projects, records, sizing
from .security import CSRFError, LoginRequired
from .web import redirect, render

@asynccontextmanager
async def lifespan(_app: FastAPI):
    init_db()
    yield


app = FastAPI(title=config.APP_NAME, docs_url=None, redoc_url=None, openapi_url=None,
              lifespan=lifespan)


@app.middleware("http")
async def security_headers(request: Request, call_next):
    response = await call_next(request)
    h = response.headers
    h["X-Content-Type-Options"] = "nosniff"
    h["X-Frame-Options"] = "DENY"
    h["Referrer-Policy"] = "same-origin"
    h["Permissions-Policy"] = "camera=(), microphone=(), geolocation=()"
    h["Content-Security-Policy"] = (
        "default-src 'self'; img-src 'self' data:; style-src 'self'; script-src 'self'; "
        "form-action 'self'; frame-ancestors 'none'; base-uri 'none'"
    )
    if request.url.path not in ("/healthz",) and not request.url.path.startswith("/static"):
        h.setdefault("Cache-Control", "no-store")
    return response


# added after the header middleware so it wraps it (runs first)
app.add_middleware(
    SessionMiddleware,
    secret_key=config.SECRET_KEY,
    session_cookie="pvt_session",
    max_age=config.SESSION_HOURS * 3600,
    same_site="lax",
    https_only=config.COOKIE_SECURE,
)

app.mount("/static", StaticFiles(directory=str(Path(__file__).parent / "static")), name="static")
app.include_router(auth.router)
app.include_router(records.router)
app.include_router(library.router)
app.include_router(projects.router)
app.include_router(sizing.router)


@app.exception_handler(LoginRequired)
async def _login_required(request: Request, exc: LoginRequired):
    return redirect("/login")


@app.exception_handler(CSRFError)
async def _csrf(request: Request, exc: CSRFError):
    return render(request, "error.html", status_code=403, title="Form expired",
                  message="This form was open too long or came from somewhere else. "
                          "Go back, refresh the page and try again.")


@app.exception_handler(404)
async def _not_found(request: Request, exc: HTTPException):
    return render(request, "error.html", status_code=404, title="Not found",
                  message="That page or record doesn't exist.")


@app.exception_handler(409)
async def _blocked(request: Request, exc: HTTPException):
    return render(request, "error.html", status_code=409, title="Blocked by the design check",
                  message=str(exc.detail))


@app.get("/healthz")
def healthz():
    return {"ok": True}

