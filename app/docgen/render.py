"""Fill a prepared .docx template with project data and convert to PDF."""
from __future__ import annotations

import io
import shutil
import subprocess
import tempfile
from dataclasses import dataclass, field
from pathlib import Path

from PIL import Image

from . import ooxml as ox

TEMPLATE_DIR = Path(__file__).resolve().parents[1] / "doc_templates"


@dataclass
class RenderInput:
    values: dict[str, str]                                  # {{Key}} -> text
    flags: dict[str, bool] = field(default_factory=dict)    # if:<flag> shapes
    doc_status: dict[int, str] = field(default_factory=dict)  # checklist row -> yes/no/na
    images: dict[str, bytes | None] = field(default_factory=dict)  # img:<key> -> png/jpg


@dataclass
class RenderResult:
    docx: bytes
    missing: set[str]


def _fit_image(data: bytes, box_cx: int, box_cy: int) -> tuple[bytes, str, int, int]:
    im = Image.open(io.BytesIO(data))
    im.load()
    fmt = "png"
    if im.mode not in ("RGBA", "LA", "P"):
        im = im.convert("RGB")
        fmt = "jpeg"
    w, h = im.size
    scale = min(box_cx / w, box_cy / h)
    out = io.BytesIO()
    im.save(out, "PNG" if fmt == "png" else "JPEG", quality=92)
    return out.getvalue(), ("png" if fmt == "png" else "jpg"), int(w * scale), int(h * scale)


def render_docx(template_name: str, data: RenderInput) -> RenderResult:
    d = ox.Docx.open(TEMPLATE_DIR / template_name)
    missing: set[str] = set()
    for part in d.xml_parts():
        root = d.tree(part)
        ox.replace_placeholders(root, data.values, missing)
        if part != "word/document.xml":
            continue
        img_n = 0
        for a in ox.anchors(root):
            tag = ox.get_tag(a)
            if tag.startswith("if:"):
                if not data.flags.get(tag[3:], False):
                    ox.remove_anchor(a)
            elif tag.startswith("doc:"):
                _, row, rest = tag.split(":", 2)
                default, yes_x, no_x, na_x = rest.split("|")
                status = data.doc_status.get(int(row), default)
                x = {"yes": yes_x, "no": no_x, "na": na_x}.get(status, yes_x)
                ox.set_pos(a, x=int(x))
            elif tag.startswith("img:"):
                img = data.images.get(tag[4:])
                if not img:
                    ox.remove_anchor(a)
                    continue
                cx, cy = ox.get_extent(a)
                payload, ext, w, h = _fit_image(img, cx, cy)
                img_n += 1
                rid = d.add_media(payload, f"filled{img_n}.{ext}")
                a.find(".//" + ox.q("a:blip")).set(ox.q("r:embed"), rid)
                x, y = ox.get_pos(a)
                ox.set_pos(a, x=x + (cx - w) // 2, y=y + (cy - h) // 2)
                ox.set_extent(a, w, h)
        for inl in ox.inlines(root):
            dp = inl.find(ox.q("wp:docPr"))
            tag = dp.get("descr", "") if dp is not None else ""
            if not tag.startswith("img:"):
                continue
            run = inl
            while run.tag != ox.W + "r":
                run = run.getparent()
            img = data.images.get(tag[4:])
            if not img:
                run.getparent().remove(run)
                continue
            ext_el = inl.find(ox.q("wp:extent"))
            payload, ext, w, h = _fit_image(img, int(ext_el.get("cx")), int(ext_el.get("cy")))
            img_n += 1
            rid = d.add_media(payload, f"filled{img_n}.{ext}")
            inl.find(".//" + ox.q("a:blip")).set(ox.q("r:embed"), rid)
            ext_el.set("cx", str(w))
            ext_el.set("cy", str(h))
            for e in inl.iter(ox.q("a:ext")):
                e.set("cx", str(w))
                e.set("cy", str(h))
    return RenderResult(docx=d.to_bytes(), missing=missing)


def soffice_available() -> bool:
    return shutil.which("soffice") is not None or shutil.which("libreoffice") is not None


def docx_to_pdf(docx: bytes, timeout: int = 120) -> bytes:
    exe = shutil.which("soffice") or shutil.which("libreoffice")
    if not exe:
        raise RuntimeError("LibreOffice is not installed, so PDF export is unavailable.")
    with tempfile.TemporaryDirectory() as tmp:
        src = Path(tmp) / "doc.docx"
        src.write_bytes(docx)
        # separate profile dir avoids clashes between concurrent conversions
        profile = Path(tmp) / "profile"
        subprocess.run(
            [exe, f"-env:UserInstallation=file://{profile}", "--headless",
             "--convert-to", "pdf", "--outdir", tmp, str(src)],
            check=True, timeout=timeout, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
        )
        return (Path(tmp) / "doc.pdf").read_bytes()
