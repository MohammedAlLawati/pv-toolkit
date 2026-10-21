"""Admin commands, run on the server:

    python -m app.cli create-user          create your login (asks for a password)
    python -m app.cli reset-2fa            if you lose your phone: next login shows a new QR code
    python -m app.cli set-password         reset a forgotten password
    python -m app.cli unlock               clear a login lockout
    python -m app.cli seed                 add starter equipment + your contractor / consultant
    python -m app.cli import-sungrow       load / refresh the Sungrow MENA inverter range
"""
from __future__ import annotations

import getpass
import sys

from sqlalchemy import select

from .db import SessionLocal, init_db
from .models import Module, Party, User
from .security import hash_password, password_problems


def _ask_password() -> str:
    while True:
        pw = getpass.getpass("Password: ")
        problems = password_problems(pw)
        if problems:
            print("  " + " ".join(problems))
            continue
        if getpass.getpass("Repeat password: ") != pw:
            print("  Passwords don't match.")
            continue
        return pw


def _user(db, username: str | None = None) -> User:
    users = db.scalars(select(User)).all()
    if username:
        users = [u for u in users if u.username == username]
    if not users:
        sys.exit("No such user. Run: python -m app.cli create-user")
    return users[0]


def create_user(username: str | None = None) -> None:
    with SessionLocal() as db:
        if db.scalars(select(User)).first():
            sys.exit("A user already exists (this app is single-user). "
                     "Use set-password or reset-2fa instead.")
        username = username or input("Username: ").strip()
        if not username:
            sys.exit("Username is required.")
        db.add(User(username=username, password_hash=hash_password(_ask_password())))
        db.commit()
    print(f"Created '{username}'. Log in at your site's address; you'll be asked to scan a "
          "QR code with an authenticator app on the first login.")


def reset_2fa(username: str | None = None) -> None:
    with SessionLocal() as db:
        u = _user(db, username)
        u.totp_secret, u.totp_confirmed, u.last_totp_step = None, False, 0
        u.session_version += 1
        db.commit()
    print("Two-factor reset. Your next login will show a new QR code.")


def set_password(username: str | None = None) -> None:
    with SessionLocal() as db:
        u = _user(db, username)
        u.password_hash = hash_password(_ask_password())
        u.session_version += 1
        u.failed_attempts, u.locked_until = 0, None
        db.commit()
    print("Password changed; all sessions signed out.")


def unlock(username: str | None = None) -> None:
    with SessionLocal() as db:
        u = _user(db, username)
        u.failed_attempts, u.locked_until = 0, None
        db.commit()
    print("Unlocked.")


STARTER_ELECTRICAL = dict(
    voc=49.52, isc=13.94, vmp=41.80, imp=13.04, tc_voc_pct=-0.28, tc_isc_pct=0.048,
    tc_pmax_pct=-0.35, noct_c=45, max_system_v=1500, max_fuse_a=25, cells=144,
    notes="Electrical values entered from Jinko's public datasheet, not from your copy. "
          "Check them, or upload your datasheet to replace them.")


def seed() -> None:
    """Starter records. Datasheet values should be checked against current datasheets."""
    with SessionLocal() as db:
        if not db.scalars(select(Party)).first():
            db.add_all([
                Party(kind="contractor", name="Hussam Technology Company", phone="+968 9782 9469",
                      email="solar@htc.om", engineer="Al Muataz Al Tougi", is_default=True,
                      address="Suite 2, Bldg. 1386, Way 6130, Bausher, P.O. Box 2240, "
                              "Al Khuwair, Muscat 133, Oman"),
                Party(kind="consultant", name="Sabla Engineering Consultant", phone="22011757",
                      engineer="Jamal Alzeedi", is_default=True),
            ])
        if not db.scalars(select(Module)).first():
            db.add(Module(make="Jinko Solar", model="JKM545M-72HL4-V", wp=545,
                          technology="Mono PERC half-cut", length_mm=2256, width_mm=1133,
                          thickness_mm=35))
            db.flush()
        starter = db.scalar(select(Module).where(Module.model == "JKM545M-72HL4-V"))
        if starter is not None and starter.voc is None:
            # electrical values from Jinko's public Tiger Pro 72HC datasheet; not yet checked
            # against the user's own copy, which the note says
            for k, v in STARTER_ELECTRICAL.items():
                setattr(starter, k, v)
        db.commit()
        from .seed import import_jinko_modules, import_sungrow_mena
        added, updated = import_sungrow_mena(db)
        import_jinko_modules(db)
    print(f"Seeded contractor, consultant, the Jinko modules and the Sungrow MENA inverter range "
          f"({added} added, {updated} refreshed).")


def import_sungrow() -> None:
    from .seed import import_sungrow_mena
    with SessionLocal() as db:
        added, updated = import_sungrow_mena(db)
    print(f"Sungrow MENA range: {added} added, {updated} refreshed.")


COMMANDS = {"import-sungrow": import_sungrow, "create-user": create_user, "reset-2fa": reset_2fa, "set-password": set_password,
            "unlock": unlock, "seed": seed}

if __name__ == "__main__":
    init_db()
    if len(sys.argv) < 2 or sys.argv[1] not in COMMANDS:
        print(__doc__)
        sys.exit(1)
    COMMANDS[sys.argv[1]](*sys.argv[2:])
