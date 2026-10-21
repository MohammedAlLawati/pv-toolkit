"""Low-level helpers for editing .docx files (WordprocessingML) with lxml.

Used by both the one-off template preparation script (tools/prepare_templates.py)
and the runtime renderer (app/docgen/render.py).
"""
from __future__ import annotations

import copy
import io
import re
import zipfile
from typing import Iterator

from lxml import etree

NS = {
    "w": "http://schemas.openxmlformats.org/wordprocessingml/2006/main",
    "wp": "http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing",
    "a": "http://schemas.openxmlformats.org/drawingml/2006/main",
    "wps": "http://schemas.microsoft.com/office/word/2010/wordprocessingShape",
    "mc": "http://schemas.openxmlformats.org/markup-compatibility/2006",
    "pic": "http://schemas.openxmlformats.org/drawingml/2006/picture",
    "r": "http://schemas.openxmlformats.org/officeDocument/2006/relationships",
    "wp14": "http://schemas.microsoft.com/office/word/2010/wordprocessingDrawing",
    "rel": "http://schemas.openxmlformats.org/package/2006/relationships",
    "ct": "http://schemas.openxmlformats.org/package/2006/content-types",
}
W = "{%s}" % NS["w"]
XML_SPACE = "{http://www.w3.org/XML/1998/namespace}space"

EMU_PER_INCH = 914400
# Positions used in the template preparation are measured on a 100 dpi render.
EMU_PER_PX100 = EMU_PER_INCH // 100  # 9144


def q(tag: str) -> str:
    prefix, local = tag.split(":")
    return "{%s}%s" % (NS[prefix], local)


class Docx:
    """A .docx held in memory: every zip part as bytes, XML parts parsed on demand."""

    def __init__(self, data: bytes):
        self.parts: dict[str, bytes] = {}
        with zipfile.ZipFile(io.BytesIO(data)) as z:
            self.order = z.namelist()
            for n in self.order:
                self.parts[n] = z.read(n)
        self._trees: dict[str, etree._ElementTree] = {}

    @classmethod
    def open(cls, path) -> "Docx":
        with open(path, "rb") as f:
            return cls(f.read())

    def tree(self, name: str) -> etree._Element:
        if name not in self._trees:
            self._trees[name] = etree.fromstring(self.parts[name])
        return self._trees[name]

    @property
    def doc(self) -> etree._Element:
        return self.tree("word/document.xml")

    def xml_parts(self) -> list[str]:
        """Main body plus headers/footers: everything that can hold placeholders."""
        return [n for n in self.order
                if re.fullmatch(r"word/(document|header\d*|footer\d*)\.xml", n)]

    def to_bytes(self) -> bytes:
        for n, t in self._trees.items():
            self.parts[n] = etree.tostring(t, xml_declaration=True, encoding="UTF-8", standalone=True)
        out = io.BytesIO()
        with zipfile.ZipFile(out, "w", zipfile.ZIP_DEFLATED) as z:
            for n in self.order:
                z.writestr(n, self.parts[n])
        return out.getvalue()

    def save(self, path) -> None:
        with open(path, "wb") as f:
            f.write(self.to_bytes())

    # ---- relationships / media ------------------------------------------------
    def rels(self) -> etree._Element:
        return self.tree("word/_rels/document.xml.rels")

    def rel_target(self, rid: str) -> str:
        for r in self.rels():
            if r.get("Id") == rid:
                return "word/" + r.get("Target").lstrip("/").replace("word/", "", 1)
        raise KeyError(rid)

    def add_media(self, data: bytes, filename: str) -> str:
        """Add a media file and return its new relationship id."""
        path = "word/media/" + filename
        self.parts[path] = data
        if path not in self.order:
            self.order.append(path)
        ext = filename.rsplit(".", 1)[1].lower()
        ct = self.tree("[Content_Types].xml")
        if not any(d.get("Extension", "").lower() == ext for d in ct.findall(q("ct:Default"))):
            mime = {"png": "image/png", "jpg": "image/jpeg", "jpeg": "image/jpeg"}[ext]
            el = etree.SubElement(ct, q("ct:Default"))
            el.set("Extension", ext)
            el.set("ContentType", mime)
        rels = self.rels()
        ids = {r.get("Id") for r in rels}
        n = 1
        while f"rIdX{n}" in ids:
            n += 1
        rid = f"rIdX{n}"
        el = etree.SubElement(rels, q("rel:Relationship"))
        el.set("Id", rid)
        el.set("Type", "http://schemas.openxmlformats.org/officeDocument/2006/relationships/image")
        el.set("Target", "media/" + filename)
        return rid


# ---- anchors (floating shapes, text boxes, pictures) -------------------------

def anchors(root: etree._Element) -> list[etree._Element]:
    return list(root.iter(q("wp:anchor")))


def strip_fallbacks(root: etree._Element) -> None:
    """Remove legacy VML fallbacks so every shape exists exactly once."""
    for fb in list(root.iter(q("mc:Fallback"))):
        fb.getparent().remove(fb)


def anchor_run(anchor: etree._Element) -> etree._Element:
    el = anchor
    while el is not None and el.tag != W + "r":
        el = el.getparent()
    return el


def anchor_text(anchor: etree._Element) -> str:
    return "".join(t.text or "" for t in anchor.iter(W + "t"))


def anchor_geom(anchor: etree._Element) -> str | None:
    g = anchor.find(".//" + q("a:prstGeom"))
    return g.get("prst") if g is not None else None


def is_picture(anchor: etree._Element) -> bool:
    return anchor.find(".//" + q("pic:pic")) is not None


def docpr(anchor: etree._Element) -> etree._Element:
    return anchor.find(q("wp:docPr"))


def get_tag(anchor: etree._Element) -> str:
    return docpr(anchor).get("descr", "")


def set_tag(anchor: etree._Element, tag: str) -> None:
    docpr(anchor).set("descr", tag)


def get_pos(anchor: etree._Element) -> tuple[int, int]:
    h = anchor.find(q("wp:positionH") + "/" + q("wp:posOffset"))
    v = anchor.find(q("wp:positionV") + "/" + q("wp:posOffset"))
    return int(h.text), int(v.text)


def set_pos(anchor: etree._Element, x: int | None = None, y: int | None = None,
            rel_h: str | None = None, rel_v: str | None = None) -> None:
    ph = anchor.find(q("wp:positionH"))
    pv = anchor.find(q("wp:positionV"))
    if x is not None:
        ph.find(q("wp:posOffset")).text = str(int(x))
    if y is not None:
        pv.find(q("wp:posOffset")).text = str(int(y))
    if rel_h:
        ph.set("relativeFrom", rel_h)
    if rel_v:
        pv.set("relativeFrom", rel_v)


def get_extent(anchor: etree._Element) -> tuple[int, int]:
    e = anchor.find(q("wp:extent"))
    return int(e.get("cx")), int(e.get("cy"))


def set_extent(anchor: etree._Element, cx: int, cy: int) -> None:
    e = anchor.find(q("wp:extent"))
    e.set("cx", str(int(cx)))
    e.set("cy", str(int(cy)))
    for ext in anchor.iter(q("a:ext")):
        if ext.getparent().tag == q("a:xfrm"):
            ext.set("cx", str(int(cx)))
            ext.set("cy", str(int(cy)))
    # Relative sizing would override the absolute extent in Word.
    for tag in ("wp14:sizeRelH", "wp14:sizeRelV"):
        for el in anchor.findall(q(tag)):
            anchor.remove(el)


def _max_docpr_id(root: etree._Element) -> int:
    ids = [int(d.get("id")) for d in root.iter(q("wp:docPr")) if d.get("id", "").isdigit()]
    return max(ids or [0])


def clone_anchor(anchor: etree._Element, after: etree._Element | None = None) -> etree._Element:
    """Duplicate the run holding `anchor`; insert the copy after `after` (a run) or the original."""
    run = anchor_run(anchor)
    root = run.getroottree().getroot()
    new_run = copy.deepcopy(run)
    (after if after is not None else run).addnext(new_run)
    new_anchor = next(new_run.iter(q("wp:anchor")))
    for attr in ("anchorId", "editId"):
        new_anchor.attrib.pop("{%s}%s" % (NS["wp14"], attr), None)
    for p in new_run.iter(W + "p"):
        for attr in list(p.attrib):
            if "paraId" in attr or "textId" in attr:
                del p.attrib[attr]
    dp = docpr(new_anchor)
    dp.set("id", str(_max_docpr_id(root) + 1))
    return new_anchor


def remove_anchor(anchor: etree._Element) -> None:
    run = anchor_run(anchor)
    run.getparent().remove(run)


def set_textbox_text(anchor: etree._Element, text: str, align: str | None = None,
                     size_halfpt: int | None = None, font: str | None = None,
                     zero_insets: bool = False, v_center: bool = False) -> None:
    """Replace all text in a text box with a single run holding `text`."""
    content = anchor.find(".//" + q("w:txbxContent"))
    paras = content.findall(q("w:p"))
    p = paras[0]
    for extra in paras[1:]:
        content.remove(extra)
    first_rpr = None
    for r in p.findall(q("w:r")):
        if first_rpr is None and r.find(q("w:rPr")) is not None:
            first_rpr = copy.deepcopy(r.find(q("w:rPr")))
    for child in list(p):
        if child.tag != q("w:pPr"):
            p.remove(child)
    ppr = p.find(q("w:pPr"))
    if ppr is None:
        ppr = etree.SubElement(p, q("w:pPr"))
        p.insert(0, ppr)
    if align:
        jc = ppr.find(q("w:jc"))
        if jc is None:
            jc = etree.SubElement(ppr, q("w:jc"))
        jc.set(q("w:val"), align)
    # no paragraph spacing inside boxes
    sp = ppr.find(q("w:spacing"))
    if sp is None:
        sp = etree.SubElement(ppr, q("w:spacing"))
    sp.set(q("w:before"), "0")
    sp.set(q("w:after"), "0")
    sp.set(q("w:line"), "240")
    sp.set(q("w:lineRule"), "auto")
    r = etree.SubElement(p, q("w:r"))
    rpr = first_rpr if first_rpr is not None else etree.Element(q("w:rPr"))
    if font:
        for old in rpr.findall(q("w:rFonts")):
            rpr.remove(old)
        f = etree.Element(q("w:rFonts"))
        for k in ("ascii", "hAnsi", "cs"):
            f.set(q("w:" + k), font)
        rpr.insert(0, f)
    if size_halfpt:
        for tag in ("w:sz", "w:szCs"):
            for old in rpr.findall(q(tag)):
                rpr.remove(old)
            el = etree.SubElement(rpr, q(tag))
            el.set(q("w:val"), str(size_halfpt))
    r.append(rpr)
    t = etree.SubElement(r, q("w:t"))
    t.text = text
    t.set(XML_SPACE, "preserve")
    body = anchor.find(".//" + q("wps:bodyPr"))
    if body is not None:
        if zero_insets:
            for k in ("lIns", "tIns", "rIns", "bIns"):
                body.set(k, "0")
        if v_center:
            body.set("anchor", "ctr")


def inline_picture_run(root: etree._Element, rid: str, cx: int, cy: int, tag: str) -> etree._Element:
    """A <w:r> holding an in-line picture (used for image slots inside table cells)."""
    pid = _max_docpr_id(root) + 1
    xml = f'''<w:r xmlns:w="{NS['w']}" xmlns:wp="{NS['wp']}" xmlns:a="{NS['a']}"
 xmlns:pic="{NS['pic']}" xmlns:r="{NS['r']}"><w:drawing>
<wp:inline distT="0" distB="0" distL="0" distR="0"><wp:extent cx="{cx}" cy="{cy}"/>
<wp:docPr id="{pid}" name="Image slot {pid}" descr="{tag}"/>
<wp:cNvGraphicFramePr><a:graphicFrameLocks noChangeAspect="1"/></wp:cNvGraphicFramePr>
<a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture">
<pic:pic><pic:nvPicPr><pic:cNvPr id="{pid}" name="slot{pid}.png"/><pic:cNvPicPr/></pic:nvPicPr>
<pic:blipFill><a:blip r:embed="{rid}"/><a:stretch><a:fillRect/></a:stretch></pic:blipFill>
<pic:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="{cx}" cy="{cy}"/></a:xfrm>
<a:prstGeom prst="rect"><a:avLst/></a:prstGeom></pic:spPr></pic:pic>
</a:graphicData></a:graphic></wp:inline></w:drawing></w:r>'''
    return etree.fromstring(xml)


def inlines(root: etree._Element) -> list[etree._Element]:
    return list(root.iter(q("wp:inline")))


# ---- placeholder replacement --------------------------------------------------

PLACEHOLDER_RE = re.compile(r"\{\{\s*([A-Za-z0-9_]+)\s*\}\}")


def _direct_text_nodes(p: etree._Element) -> list[etree._Element]:
    """w:t nodes belonging to this paragraph only (not to text boxes nested inside it)."""
    out = []
    for t in p.iter(W + "t"):
        # walk up to the nearest paragraph: it must be `p`
        el = t.getparent()
        while el is not None and el.tag != W + "p":
            el = el.getparent()
        if el is p:
            out.append(t)
    return out


def replace_placeholders(root: etree._Element, values: dict[str, str], missing: set[str]) -> None:
    """Replace {{Key}} in every paragraph, even when Word split it across several runs.

    Only the runs that the placeholder spans are touched, so surrounding formatting
    (e.g. a bold label before the value) is preserved.
    """
    for p in root.iter(W + "p"):
        nodes = _direct_text_nodes(p)
        if not nodes:
            continue
        texts = [n.text or "" for n in nodes]
        full = "".join(texts)
        if "{{" not in full:
            continue
        offsets, pos = [], 0
        for s in texts:
            offsets.append(pos)
            pos += len(s)

        def seg_of(i: int) -> int:
            k = 0
            while k + 1 < len(offsets) and offsets[k + 1] <= i:
                k += 1
            return k

        for m in reversed(list(PLACEHOLDER_RE.finditer(full))):
            key = m.group(1)
            if key in values and values[key] is not None:
                val = str(values[key])
            else:
                missing.add(key)
                val = ""
            s, e = m.span()
            i_s, i_e = seg_of(s), seg_of(e - 1)
            ls, le = s - offsets[i_s], e - offsets[i_e]
            if i_s == i_e:
                texts[i_s] = texts[i_s][:ls] + val + texts[i_s][le:]
            else:
                texts[i_s] = texts[i_s][:ls] + val
                for k in range(i_s + 1, i_e):
                    texts[k] = ""
                texts[i_e] = texts[i_e][le:]
        for n, s in zip(nodes, texts):
            n.text = s
            n.set(XML_SPACE, "preserve")


def paragraph_text(p: etree._Element) -> str:
    return "".join(t.text or "" for t in _direct_text_nodes(p))


def set_paragraph_text(p: etree._Element, text: str) -> None:
    nodes = _direct_text_nodes(p)
    if not nodes:
        return
    nodes[0].text = text
    nodes[0].set(XML_SPACE, "preserve")
    for n in nodes[1:]:
        n.text = ""


def iter_body_paragraphs(root: etree._Element) -> Iterator[etree._Element]:
    """Paragraphs in document order, skipping those inside text boxes."""
    for p in root.iter(W + "p"):
        if p.getparent() is not None and p.getparent().tag == q("w:txbxContent"):
            continue
        yield p
