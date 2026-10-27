"""Glue between the database records and the letter builder."""
from __future__ import annotations

import json
from datetime import date

from sqlalchemy import select
from sqlalchemy.orm import Session

from ..docgen.context import fmt_date
from ..models import Client, Letter, Letterhead, LetterTemplate, Party, Project
from .builder import DEFAULT_BOTTOM, DEFAULT_TOP, LetterData, SupplyPoint, build_docx
from .defaults import DEFAULT_PURPOSE, DEFAULT_TEMPLATES

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
    ("HTCContactName", "HTC contact name", ("commercial", "residential")),
    ("HTCContactTel", "HTC contact phone", ("commercial", "residential")),
    ("HTCContactEmail", "HTC contact e-mail", ("commercial", "residential")),
    ("HTCSignatoryName", "Signed for HTC by", ("commercial", "residential")),
    ("HTCSignatoryTitle", "Signatory's title", ("commercial", "residential")),
]
HTC_SIGNATORY_TITLE = "Project Engineer, Solar Division"


def form_fields(audience: str) -> list[tuple[str, str]]:
    return [(k, label) for k, label, aud in FORM_FIELDS if audience in aud]


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
            db.add(LetterTemplate(key=t["key"], name=t["name"], audience=t["audience"],
                                  recipient=t["recipient"], subject=t["subject"], body=t["body"],
                                  confirmation=t["confirmation"], enclosures=t["enclosures"],
                                  purpose=DEFAULT_PURPOSE, ref_prefix="HTC/NEDC"))
    db.commit()


def default_letterhead(db: Session) -> Letterhead | None:
    return (db.scalar(select(Letterhead).where(Letterhead.is_default))
            or db.scalars(select(Letterhead)).first())


def next_ref(db: Session, prefix: str, today: date | None = None) -> str:
    """HTC/NEDC/2026/001, counting letters already issued with that prefix this year."""
    year = (today or date.today()).year
    stem = f"{prefix.rstrip('/')}/{year}/"
    used = [r for r in db.scalars(select(Letter.ref).where(Letter.ref.like(f"{stem}%"))).all()]
    nums = [int(r[len(stem):]) for r in used if r[len(stem):].isdigit()]
    return f"{stem}{(max(nums) + 1 if nums else 1):03d}"


def _contractor(db: Session, project: Project | None) -> Party | None:
    if project and project.contractor:
        return project.contractor
    return (db.scalar(select(Party).where(Party.kind == "contractor", Party.is_default))
            or db.scalars(select(Party).where(Party.kind == "contractor")).first())


def prefill(db: Session, tpl: LetterTemplate, client: Client | None,
            project: Project | None) -> tuple[dict[str, str], list[dict[str, str]]]:
    """Starting values for a new letter, from the client, project and contractor."""
    if project and not client:
        client = project.client
    v: dict[str, str] = {"Purpose": tpl.purpose or DEFAULT_PURPOSE}
    ctr = _contractor(db, project)
    if ctr:
        v.update(HTCContactName=f"Eng. {ctr.engineer}" if ctr.engineer else "",
                 HTCContactTel=ctr.phone, HTCContactEmail=ctr.email,
                 HTCSignatoryName=ctr.engineer, HTCSignatoryTitle=HTC_SIGNATORY_TITLE)
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
        values=values,
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
    values = dict(letter.values, Ref=letter.ref, Date=fmt_date(letter.letter_date))
    top, bottom = _images(db, tpl)
    return build_docx(letter_data(tpl, values, letter.points), top, bottom)


SAMPLE = {
    "commercial": ({"ClientName": "Sample Trading & Contracting L.L.C.", "CRNo": "1234567",
                    "SignatoryName": "Ahmed Salim Al Harthy", "SignatoryID": "09876543",
                    "Location": "Ghala Industrial Area, Bausher, Muscat"},
                   [{"meter_no": "M-20451187", "account_no": "1100234567", "location": "Warehouse A"},
                    {"meter_no": "M-20451190", "account_no": "1100234568", "location": "Warehouse B"}]),
    "residential": ({"ClientName": "Salim Hamed Al Rawahi", "CivilID": "12345678",
                     "Location": "Al Mawaleh South, Seeb, Muscat"},
                    [{"account_no": "2200987654", "location": "Main house"}]),
}


def render_sample(db: Session, tpl: LetterTemplate) -> bytes:
    """The template filled with made-up data, to check the wording and layout."""
    values, points = prefill(db, tpl, None, None)
    sample_values, sample_points = SAMPLE.get(tpl.audience, SAMPLE["commercial"])
    values.update(sample_values)
    values.update(Ref=f"{tpl.ref_prefix}/{date.today().year}/000", Date=fmt_date(date.today()))
    top, bottom = _images(db, tpl)
    return build_docx(letter_data(tpl, values, sample_points), top, bottom)[0]


def dumps(v) -> str:
    return json.dumps(v, ensure_ascii=False)
