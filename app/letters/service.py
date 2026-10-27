"""Glue between the database records and the letter builder."""
from __future__ import annotations

import json
from datetime import date

from sqlalchemy import select
from sqlalchemy.orm import Session

from ..docgen.context import fmt_date
from ..models import Client, Letter, Letterhead, LetterTemplate, Project
from .builder import DEFAULT_BOTTOM, DEFAULT_TOP, LetterData, SupplyPoint, build_docx
from .defaults import DEFAULT_TEMPLATES

# fields on the letter form, in order: (key, label, audiences)
FORM_FIELDS = [
    ("ClientName", "Company name", ("commercial",)),
    ("ClientName", "Homeowner's full name", ("residential",)),
    ("CRNo", "C.R. number", ("commercial",)),
    ("SignatoryName", "Authorised signatory's name", ("commercial",)),
    ("SignatoryID", "Authorised signatory's ID number", ("commercial",)),
    ("CivilID", "Homeowner's civil ID", ("residential",)),
    ("Location", "Premises location", ("commercial", "residential")),
    ("Purpose", "What the letter is about", ("commercial", "residential")),
]
BUILTIN = {t["key"]: t for t in DEFAULT_TEMPLATES}
TEMPLATE_TEXT = ("language", "name", "audience", "recipient", "subject", "body", "confirmation",
                 "purpose")


def form_fields(tpl: LetterTemplate) -> list[tuple[str, str]]:
    """The inputs a template's letter form asks for; Purpose only when the wording uses it."""
    text = " ".join((tpl.subject, tpl.body, tpl.confirmation))
    return [(k, label) for k, label, aud in FORM_FIELDS
            if tpl.audience in aud and (k != "Purpose" or "{{Purpose}}" in text.replace(" ", ""))]


def ensure_defaults(db: Session) -> None:
    """Create the HTC letterhead and the built-in templates the first time."""
    head = db.scalar(select(Letterhead).where(Letterhead.is_default))
    if head is None and not db.scalars(select(Letterhead)).first():
        head = Letterhead(name="HTC (Hussam Technology Company)", is_default=True,
                          top=DEFAULT_TOP.read_bytes() if DEFAULT_TOP.exists() else None,
                          bottom=DEFAULT_BOTTOM.read_bytes() if DEFAULT_BOTTOM.exists() else None)
        db.add(head)
    existing = set(db.scalars(select(LetterTemplate.key)).all())
    for t in DEFAULT_TEMPLATES:
        if t["key"] not in existing:
            tpl = LetterTemplate(key=t["key"])
            reset_to_builtin(tpl)
            db.add(tpl)
    db.commit()


def reset_to_builtin(tpl: LetterTemplate) -> bool:
    """Put a built-in template's wording back to the shipped version."""
    src = BUILTIN.get(tpl.key)
    if src is None:
        return False
    for k in TEMPLATE_TEXT:
        setattr(tpl, k, src[k])
    tpl.enclosures = src.get("enclosures", "")
    tpl.ref_prefix = src.get("ref_prefix", "")
    return True


def default_letterhead(db: Session) -> Letterhead | None:
    return (db.scalar(select(Letterhead).where(Letterhead.is_default))
            or db.scalars(select(Letterhead)).first())


def next_ref(db: Session, prefix: str, today: date | None = None) -> str:
    """HTC/NEDC/2026/001, counting letters already issued with that prefix this year.
    Templates without a prefix don't number their letters."""
    if not prefix.strip():
        return ""
    year = (today or date.today()).year
    stem = f"{prefix.rstrip('/')}/{year}/"
    used = [r for r in db.scalars(select(Letter.ref).where(Letter.ref.like(f"{stem}%"))).all()]
    nums = [int(r[len(stem):]) for r in used if r[len(stem):].isdigit()]
    return f"{stem}{(max(nums) + 1 if nums else 1):03d}"


def prefill(db: Session, tpl: LetterTemplate, client: Client | None,
            project: Project | None) -> tuple[dict[str, str], list[dict[str, str]]]:
    """Starting values for a new letter, from the client, project and contractor."""
    if project and not client:
        client = project.client
    v: dict[str, str] = {"Purpose": tpl.purpose}
    if client:
        v["ClientName"] = client.name
        if tpl.audience == "commercial":
            v.update(CRNo=client.id_no, SignatoryName=client.signatory_name,
                     SignatoryID=client.signatory_id)
        else:
            v["CivilID"] = client.id_no
        v["Location"] = ", ".join(x for x in (client.village, client.wilaya, client.governorate) if x)
    points = []
    if project and project.account_no:
        key = "meter_no" if tpl.audience == "commercial" else "account_no"
        points.append({key: project.account_no})
    return v, points


def letter_data(tpl: LetterTemplate, values: dict[str, str], points: list[dict[str, str]]
                ) -> LetterData:
    return LetterData(
        audience=tpl.audience, recipient=tpl.recipient, subject=tpl.subject, body=tpl.body,
        confirmation=tpl.confirmation, enclosures=[e for e in tpl.enclosures.splitlines() if e.strip()],
        values=values, language=tpl.language or "en",
        points=[SupplyPoint(p.get("meter_no", ""), p.get("account_no", ""), p.get("location", ""))
                for p in points])


def _images(db: Session, tpl: LetterTemplate) -> tuple[bytes | None, bytes | None]:
    head = tpl.letterhead or default_letterhead(db)
    if head is None:
        return b"", b""  # no letterhead: plain paper
    return head.top or b"", head.bottom or b""


def render_letter(db: Session, letter: Letter) -> tuple[bytes, set[str]]:
    tpl = letter.template
    if tpl is None:
        raise ValueError("This letter's template was deleted.")
    values = dict(letter.values, Ref=letter.ref, Date=letter_date_text(tpl, letter.letter_date))
    top, bottom = _images(db, tpl)
    return build_docx(letter_data(tpl, values, letter.points), top, bottom)


def letter_date_text(tpl: LetterTemplate, d: date | None) -> str:
    if d is None:
        return ""
    return d.strftime("%d/%m/%Y") if tpl.language == "ar" else fmt_date(d)


def render_sample(db: Session, tpl: LetterTemplate) -> bytes:
    """The template with every input left blank, to check the wording and layout."""
    top, bottom = _images(db, tpl)
    return build_docx(letter_data(tpl, {"Purpose": tpl.purpose}, []), top, bottom)[0]


def dumps(v) -> str:
    return json.dumps(v, ensure_ascii=False)
