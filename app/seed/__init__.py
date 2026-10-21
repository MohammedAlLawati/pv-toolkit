"""Built-in equipment sets that can be loaded into the library with one click."""
from __future__ import annotations

from pathlib import Path

from sqlalchemy import select
from sqlalchemy.orm import Session

from ..equipment_fields import INVERTER_FIELDS, MODULE_FIELDS
from ..models import Datasheet, Inverter, Module

DATASHEET_DIR = Path(__file__).parent / "datasheets"


def import_sungrow_mena(db: Session) -> tuple[int, int]:
    """Add (or refresh) the Sungrow MENA inverter range. Returns (added, updated)."""
    from .sungrow_mena import INVERTERS

    sheets: dict[str, Datasheet] = {}
    added = updated = 0
    for spec in INVERTERS:
        spec = dict(spec)
        fname = spec.pop("datasheet")
        if fname not in sheets:
            ds = db.scalar(select(Datasheet).where(Datasheet.filename == fname))
            if ds is None:
                ds = Datasheet(kind="inverter", filename=fname, mime="application/pdf",
                               data=(DATASHEET_DIR / fname).read_bytes(), method="manual")
                db.add(ds)
                db.flush()
            sheets[fname] = ds
        inv = db.scalar(select(Inverter).where(Inverter.make == spec["make"],
                                               Inverter.model == spec["model"]))
        if inv is None:
            inv = Inverter()
            db.add(inv)
            added += 1
        else:
            updated += 1
        for f in INVERTER_FIELDS:
            if f.key in spec:
                setattr(inv, f.key, spec[f.key])
        inv.datasheet = sheets[fname]
        inv.sync_mppt_summary()
    db.commit()
    return added, updated


def import_jinko_modules(db: Session) -> tuple[int, int]:
    """Add (or refresh) the Jinko modules from the user's datasheets. Returns (added, updated)."""
    from .jinko_modules import MODULES

    added = updated = 0
    for spec in MODULES:
        spec = dict(spec)
        fname = spec.pop("datasheet")
        ds = db.scalar(select(Datasheet).where(Datasheet.filename == fname)) if fname else None
        if ds is None and fname:
            ds = Datasheet(kind="module", filename=fname, mime="application/pdf",
                           data=(DATASHEET_DIR / fname).read_bytes(), method="manual")
            db.add(ds)
            db.flush()
        mod = db.scalar(select(Module).where(Module.make == spec["make"], Module.model == spec["model"]))
        if mod is None:
            mod = Module()
            db.add(mod)
            added += 1
        else:
            updated += 1
        for f in MODULE_FIELDS:
            if f.key in spec:
                setattr(mod, f.key, spec[f.key])
        if ds is not None:
            mod.datasheet = ds
    db.commit()
    return added, updated
