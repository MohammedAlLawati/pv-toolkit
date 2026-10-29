"""Build web/templates/offer_deck.pptx from source_templates/EPC_Offer_Template.pptx.

    python -m tools.prepare_offer_template

The browser fills the result (web/js/offer/). This script:
- turns the old project's figures into {{Placeholders}} (cover, schematic, design summary,
  installation overview, engineering notes, energy tables, financial text, commercial table);
- tags slides in p:cSld/@name ("offer:..."): datasheet slides for one module / inverter
  model, the shadow slide (dropped without a shadow image) and two new spec slides
  (a table of the library values, used when the template has no datasheet slides);
- adds image slots (p:pic with descr "img:<key>") for the site, shadow and two structure (3D view)
  pictures, and tags the HTC logos that sit on them (descr "logo:<key>");
- puts "Client: {{Name}}" and a client logo slot on the cover, and adds a components slide (pictures
  of the module and inverter models used, tagged "offer:needs:components") after slide 18;
- adds a sub-system breakdown slide after the design summary (tagged "offer:needs:subsystems": mounting,
  modules, inverter combination and DC/AC ratio of each sub-system);
- turns the shadow slide's three paragraphs into {{ShadeP1..3}} (they change when shading is high);
- replaces the CO2 picture with text and the cash-flow picture with a chart;
- unlinks the charts from the original Excel file (the path named another client);
- re-encodes large photos so the template stays small.
"""
from __future__ import annotations

import copy
import io
import re
import zipfile
from pathlib import Path

from lxml import etree
from PIL import Image

ROOT = Path(__file__).resolve().parent.parent
SRC = ROOT / "source_templates" / "EPC_Offer_Template.pptx"
OUT = ROOT / "web" / "templates" / "offer_deck.pptx"

NS = {
    "a": "http://schemas.openxmlformats.org/drawingml/2006/main",
    "p": "http://schemas.openxmlformats.org/presentationml/2006/main",
    "r": "http://schemas.openxmlformats.org/officeDocument/2006/relationships",
    "c": "http://schemas.openxmlformats.org/drawingml/2006/chart",
    "rel": "http://schemas.openxmlformats.org/package/2006/relationships",
    "ct": "http://schemas.openxmlformats.org/package/2006/content-types",
}
EMU = 914400
SLIDE_REL = "http://schemas.openxmlformats.org/officeDocument/2006/relationships/slide"
CHART_REL = "http://schemas.openxmlformats.org/officeDocument/2006/relationships/chart"
IMAGE_REL = "http://schemas.openxmlformats.org/officeDocument/2006/relationships/image"


def q(tag: str) -> str:
    pre, local = tag.split(":")
    return f"{{{NS[pre]}}}{local}"


def emu(inches: float) -> str:
    return str(int(round(inches * EMU)))


class Pkg:
    def __init__(self, path: Path):
        with zipfile.ZipFile(path) as z:
            self.order = z.namelist()
            self.parts = {n: z.read(n) for n in self.order}
        self.trees: dict[str, etree._Element] = {}

    def tree(self, name: str) -> etree._Element:
        if name not in self.trees:
            self.trees[name] = etree.fromstring(self.parts[name])
        return self.trees[name]

    def put(self, name: str, data: bytes) -> None:
        self.parts[name] = data
        self.trees.pop(name, None)
        if name not in self.order:
            self.order.append(name)

    def drop(self, name: str) -> None:
        self.parts.pop(name, None)
        self.trees.pop(name, None)
        if name in self.order:
            self.order.remove(name)

    def save(self, path: Path) -> None:
        for n, t in self.trees.items():
            self.parts[n] = etree.tostring(t, xml_declaration=True, encoding="UTF-8", standalone=True)
        path.parent.mkdir(parents=True, exist_ok=True)
        with zipfile.ZipFile(path, "w", zipfile.ZIP_DEFLATED) as z:
            for n in self.order:
                z.writestr(n, self.parts[n])

    def slide(self, n: int) -> etree._Element:
        return self.tree(f"ppt/slides/slide{n}.xml")

    def rels(self, part: str) -> etree._Element:
        d, f = part.rsplit("/", 1)
        return self.tree(f"{d}/_rels/{f}.rels")

    def add_override(self, part: str, ctype: str) -> None:
        ct = self.tree("[Content_Types].xml")
        el = etree.SubElement(ct, q("ct:Override"))
        el.set("PartName", "/" + part)
        el.set("ContentType", ctype)


# ---- text helpers ----------------------------------------------------------------------

def runs_text(p) -> str:
    return "".join(t.text or "" for t in p.iter(q("a:t")))


def set_run(root, old: str, new: str, count: int = 1) -> None:
    """Replace the text of runs whose whole text is `old`."""
    hits = [t for t in root.iter(q("a:t")) if t.text == old]
    assert len(hits) >= count, f"{old!r}: found {len(hits)}"
    for t in hits[:count]:
        t.text = new
        rpr = t.getparent().find(q("a:rPr"))
        if rpr is not None:
            for h in rpr.findall(q("a:highlight")):
                rpr.remove(h)


def set_para(p, text: str) -> None:
    """Put `text` in the paragraph's first run (keeping its formatting); drop the others."""
    rs = p.findall(q("a:r"))
    if not rs:
        raise AssertionError("paragraph without runs: " + runs_text(p))
    rs[0].find(q("a:t")).text = text
    for r in rs[1:]:
        p.remove(r)
    for br in p.findall(q("a:br")):
        p.remove(br)


def para_with(root, needle: str):
    hits = [p for p in root.iter(q("a:p")) if needle in runs_text(p)]
    assert hits, f"no paragraph with {needle!r}"
    return hits[0]


def cell_set(tc, text: str, rpr_from=None) -> None:
    """Text of a table cell's first paragraph; an empty cell gets a run like `rpr_from`."""
    p = tc.find(".//" + q("a:p"))
    rs = p.findall(q("a:r"))
    if rs:
        set_para(p, text)
        return
    r = etree.Element(q("a:r"))
    if rpr_from is not None:
        r.append(copy.deepcopy(rpr_from))
    etree.SubElement(r, q("a:t")).text = text
    end = p.find(q("a:endParaRPr"))
    if end is not None:
        end.addprevious(r)
    else:
        p.append(r)


def tables(slide):
    return [gf.find(".//" + q("a:tbl")) for gf in slide.iter(q("p:graphicFrame"))
            if gf.find(".//" + q("a:tbl")) is not None]


def first_rpr(tc):
    r = tc.find(".//" + q("a:r"))
    return r.find(q("a:rPr")) if r is not None else None


def shape_named(slide, name: str):
    for el in slide.iter(q("p:cNvPr")):
        if el.get("name") == name:
            return el.getparent().getparent()
    raise AssertionError("no shape " + name)


def tag_slide(slide, tag: str) -> None:
    slide.find(q("p:cSld")).set("name", tag)


def tag_logo(slide, name: str, key: str) -> None:
    """Mark a logo picture to sit in a corner of image slot `key` (moved there by the browser,
    dropped with the image), and bring it in front of the slot."""
    pic = shape_named(slide, name)
    pic.find(".//" + q("p:cNvPr")).set("descr", f"logo:{key}")
    tree = pic.getparent()
    tree.remove(pic)
    tree.append(pic)


def max_shape_id(slide) -> int:
    return max(int(e.get("id")) for e in slide.iter(q("p:cNvPr")))


# ---- shapes ----------------------------------------------------------------------------

PIC_XML = """<p:pic xmlns:p="{p}" xmlns:a="{a}" xmlns:r="{r}">
  <p:nvPicPr><p:cNvPr id="{id}" name="{name}" descr="{descr}"/><p:cNvPicPr><a:picLocks noChangeAspect="1"/></p:cNvPicPr><p:nvPr/></p:nvPicPr>
  <p:blipFill><a:blip r:embed="{rid}"/><a:stretch><a:fillRect/></a:stretch></p:blipFill>
  <p:spPr><a:xfrm><a:off x="{x}" y="{y}"/><a:ext cx="{cx}" cy="{cy}"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></p:spPr>
</p:pic>"""


def add_image_slot(pkg: Pkg, n: int, key: str, x: float, y: float, w: float, h: float) -> None:
    """A placeholder picture the browser swaps for the project's image (or removes)."""
    part = f"ppt/slides/slide{n}.xml"
    slide = pkg.slide(n)
    media = f"ppt/media/slot_{key}.png"
    if media not in pkg.parts:
        buf = io.BytesIO()
        Image.new("RGB", (16, 9), (230, 233, 238)).save(buf, "PNG")
        pkg.put(media, buf.getvalue())
    rid = add_rel(pkg, part, IMAGE_REL, f"../media/slot_{key}.png")
    pic = etree.fromstring(PIC_XML.format(p=NS["p"], a=NS["a"], r=NS["r"], id=max_shape_id(slide) + 1,
                                          name=f"Image {key}", descr=f"img:{key}", rid=rid,
                                          x=emu(x), y=emu(y), cx=emu(w), cy=emu(h)))
    slide.find(q("p:cSld")).find(q("p:spTree")).append(pic)


def add_rel(pkg: Pkg, part: str, rtype: str, target: str) -> str:
    rels = pkg.rels(part)
    ids = {r.get("Id") for r in rels}
    n = 1
    while f"rIdO{n}" in ids:
        n += 1
    el = etree.SubElement(rels, q("rel:Relationship"))
    el.set("Id", f"rIdO{n}")
    el.set("Type", rtype)
    el.set("Target", target)
    return f"rIdO{n}"


def textbox(slide, x, y, w, h, paras: list[str], size=14, color="2E7D32") -> None:
    sp_xml = f"""<p:sp xmlns:p="{NS['p']}" xmlns:a="{NS['a']}">
  <p:nvSpPr><p:cNvPr id="{max_shape_id(slide) + 1}" name="Offer text"/><p:cNvSpPr txBox="1"/><p:nvPr/></p:nvSpPr>
  <p:spPr><a:xfrm><a:off x="{emu(x)}" y="{emu(y)}"/><a:ext cx="{emu(w)}" cy="{emu(h)}"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom><a:noFill/></p:spPr>
  <p:txBody><a:bodyPr wrap="square" rtlCol="0" anchor="ctr"><a:normAutofit/></a:bodyPr><a:lstStyle/></p:txBody>
</p:sp>"""
    sp = etree.fromstring(sp_xml)
    body = sp.find(q("p:txBody"))
    for text in paras:
        p = etree.SubElement(body, q("a:p"))
        ppr = etree.SubElement(p, q("a:pPr"), marL="285750", indent="-285750")
        etree.SubElement(ppr, q("a:spcAft")).append(etree.Element(q("a:spcPts"), val="900"))
        etree.SubElement(ppr, q("a:buFont"), typeface="Arial")
        etree.SubElement(ppr, q("a:buChar"), char="•")
        r = etree.SubElement(p, q("a:r"))
        rpr = etree.SubElement(r, q("a:rPr"), lang="en-US", sz=str(size * 100), dirty="0")
        fill = etree.SubElement(rpr, q("a:solidFill"))
        etree.SubElement(fill, q("a:srgbClr"), val=color)
        etree.SubElement(r, q("a:t")).text = text
    slide.find(q("p:cSld")).find(q("p:spTree")).append(sp)


def remove_shape(pkg: Pkg, n: int, name: str):
    """Remove a shape; returns its (x, y, cx, cy) in EMU."""
    shp = shape_named(pkg.slide(n), name)
    xfrm = shp.find(".//" + q("a:xfrm"))
    if xfrm is None:
        xfrm = shp.find(q("p:xfrm"))
    off, ext = xfrm.find(q("a:off")), xfrm.find(q("a:ext"))
    box = tuple(int(v) for v in (off.get("x"), off.get("y"), ext.get("cx"), ext.get("cy")))
    blip = shp.find(".//" + q("a:blip"))
    shp.getparent().remove(shp)
    if blip is not None:  # drop the picture's relationship unless another shape still uses it
        rid = blip.get(q("r:embed"))
        if not any(b.get(q("r:embed")) == rid for b in pkg.slide(n).iter(q("a:blip"))):
            rels = pkg.rels(f"ppt/slides/slide{n}.xml")
            for r in list(rels):
                if r.get("Id") == rid:
                    rels.remove(r)
    return box


# ---- slides ----------------------------------------------------------------------------

def clone_slide(pkg: Pkg, src: int, new: int, after_slide: int) -> None:
    """Copy slide `src` (without its notes) as slide `new`, placed after `after_slide`."""
    pkg.put(f"ppt/slides/slide{new}.xml", pkg.parts[f"ppt/slides/slide{src}.xml"])
    rels = etree.fromstring(pkg.parts[f"ppt/slides/_rels/slide{src}.xml.rels"])
    for r in list(rels):
        if "notesSlide" in r.get("Type"):
            rels.remove(r)
    pkg.put(f"ppt/slides/_rels/slide{new}.xml.rels", etree.tostring(rels, xml_declaration=True, encoding="UTF-8", standalone=True))
    pkg.add_override(f"ppt/slides/slide{new}.xml", "application/vnd.openxmlformats-officedocument.presentationml.slide+xml")
    rid = add_rel(pkg, "ppt/presentation.xml", SLIDE_REL, f"slides/slide{new}.xml")
    pres = pkg.tree("ppt/presentation.xml")
    lst = pres.find(q("p:sldIdLst"))
    prel = pkg.rels("ppt/presentation.xml")
    target_rid = next(r.get("Id") for r in prel if r.get("Target") == f"slides/slide{after_slide}.xml")
    anchor = next(s for s in lst if s.get(q("r:id")) == target_rid)
    new_id = max(int(s.get("id")) for s in lst) + 1
    el = etree.Element(q("p:sldId"), id=str(new_id))
    el.set(q("r:id"), rid)
    anchor.addnext(el)


def spec_slide(pkg: Pkg, n: int, table_src, title: str, rows: list[tuple[str, str]], tag: str) -> None:
    slide = pkg.slide(n)
    tag_slide(slide, tag)
    sub = [p for p in slide.iter(q("a:p")) if "Specification" in runs_text(p) and "Component" not in runs_text(p)][0]
    set_para(sub, title)
    x, y, cx, cy = remove_shape(pkg, n, "Picture 2")
    gf = copy.deepcopy(table_src.getparent().getparent().getparent())  # a:tbl -> graphicData -> graphic -> graphicFrame
    gf.find(q("p:nvGraphicFramePr")).find(q("p:cNvPr")).set("id", str(max_shape_id(slide) + 1))
    xfrm = gf.find(q("p:xfrm"))
    xfrm.find(q("a:off")).set("x", emu(2.0))
    xfrm.find(q("a:off")).set("y", str(y))
    tbl = gf.find(".//" + q("a:tbl"))
    trs = tbl.findall(q("a:tr"))
    head, body = trs[0], trs[1]
    for tr in trs[1:]:
        tbl.remove(tr)
    cell_set(head.findall(q("a:tc"))[0], title.split(" Specification")[0])
    rpr = first_rpr(body.findall(q("a:tc"))[0])
    row_h = int(cy * 0.95 / (len(rows) + 1))
    head.set("h", str(row_h))
    for label, value in rows:
        tr = copy.deepcopy(body)
        tr.set("h", str(row_h))
        tcs = tr.findall(q("a:tc"))
        cell_set(tcs[0], label, rpr)
        cell_set(tcs[1], value, rpr)
        tbl.append(tr)
    slide.find(q("p:cSld")).find(q("p:spTree")).append(gf)


# The sub-system table: [header, width (in), placeholder]. The browser copies the {{SS_*}} row
# once per sub-system and drops the slide when the system isn't split.
SUBSYSTEM_COLS = [("Sub-system", 1.25, "{{SS_Name}}"), ("Installation", 1.6, "{{SS_Mounting}}"),
                  ("PV module", 1.25, "{{SS_Module}}"), ("Panels", 0.75, "{{SS_Modules}}"),
                  ("DC (kWp)", 0.8, "{{SS_DC}}"), ("Inverters", 1.65, "{{SS_Inverters}}"),
                  ("AC (kW)", 0.75, "{{SS_AC}}"), ("DC/AC", 0.65, "{{SS_Ratio}}")]
SUBSYSTEM_TOTALS = ["Total", "", "", "{{SS_TotModules}}", "{{SS_TotDC}}", "{{SS_TotInverters}}", "{{SS_TotAC}}",
                    "{{SS_TotRatio}}"]


def subsystem_slide(pkg: Pkg, n: int) -> None:
    """Turn a copy of the design summary slide into the sub-system breakdown table."""
    slide = pkg.slide(n)
    tag_slide(slide, "offer:needs:subsystems")
    set_para(para_with(slide, "Design Summary"), "System Breakdown")
    tbl = tables(slide)[0]
    rows = tbl.findall(q("a:tr"))
    head_tc, label_tc, value_tc = rows[0].findall(q("a:tc"))[0], *rows[1].findall(q("a:tc"))[:2]
    rpr = first_rpr(value_tc)
    grid = tbl.find(q("a:tblGrid"))
    for gc in list(grid):
        grid.remove(gc)
    for _, w, _ in SUBSYSTEM_COLS:
        etree.SubElement(grid, q("a:gridCol"), w=emu(w))
    for tr in rows:
        tbl.remove(tr)

    def row(h, texts, first, rest):
        tr = etree.SubElement(tbl, q("a:tr"), h=str(h))
        for i, text in enumerate(texts):
            tc = copy.deepcopy(first if i == 0 else rest)
            for attr in ("gridSpan", "hMerge"):
                tc.attrib.pop(attr, None)
            cell_set(tc, text, rpr)
            tr.append(tc)
        return tr

    row(rows[0].get("h"), [c[0] for c in SUBSYSTEM_COLS], head_tc, head_tc)
    row(417935, [c[2] for c in SUBSYSTEM_COLS], label_tc, value_tc)
    row(417935, SUBSYSTEM_TOTALS, label_tc, value_tc)
    xfrm = tbl.getparent().getparent().getparent().find(q("p:xfrm"))
    xfrm.find(q("a:off")).set("x", emu(0.5))
    xfrm.find(q("a:ext")).set("cx", str(sum(int(emu(w)) for _, w, _ in SUBSYSTEM_COLS)))
    xfrm.find(q("a:ext")).set("cy", str(sum(int(tr.get("h")) for tr in tbl.findall(q("a:tr")))))


# The components slide: a picture and caption per module / inverter model used, in up to
# COMPONENT_SLOTS columns (the browser spreads the ones in use across the width).
COMPONENT_SLOTS = 4


def caption(slide, x, y, w, h, name: str, lines) -> None:
    """A centred text box: a bold first line, then smaller green lines."""
    sp = etree.fromstring(f"""<p:sp xmlns:p="{NS['p']}" xmlns:a="{NS['a']}">
  <p:nvSpPr><p:cNvPr id="{max_shape_id(slide) + 1}" name="{name}"/><p:cNvSpPr txBox="1"/><p:nvPr/></p:nvSpPr>
  <p:spPr><a:xfrm><a:off x="{emu(x)}" y="{emu(y)}"/><a:ext cx="{emu(w)}" cy="{emu(h)}"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom><a:noFill/></p:spPr>
  <p:txBody><a:bodyPr wrap="square" rtlCol="0" anchor="t"><a:normAutofit/></a:bodyPr><a:lstStyle/></p:txBody>
</p:sp>""")
    body = sp.find(q("p:txBody"))
    for i, text in enumerate(lines):
        para = etree.SubElement(body, q("a:p"))
        etree.SubElement(para, q("a:pPr"), algn="ctr")
        r = etree.SubElement(para, q("a:r"))
        rpr = etree.SubElement(r, q("a:rPr"), lang="en-US", sz="1100" if i == 0 else "1000", b="1" if i == 0 else "0", dirty="0")
        fill = etree.SubElement(rpr, q("a:solidFill"))
        etree.SubElement(fill, q("a:srgbClr"), val="404040" if i == 0 else "2E7D32")
        etree.SubElement(r, q("a:t")).text = text
    slide.find(q("p:cSld")).find(q("p:spTree")).append(sp)


def components_slide(pkg: Pkg, n: int) -> None:
    """A copy of the first datasheet slide, emptied, with a picture slot and caption per component."""
    clone_slide(pkg, 19, n, after_slide=18)
    slide = pkg.slide(n)
    tag_slide(slide, "offer:needs:components")
    for name in ("Picture 17", "Picture 2"):
        remove_shape(pkg, n, name)
    set_para(para_with(slide, "PV Module Specification from Manufacturer"), "Selected Components for the Proposed System")
    col = 9.0 / COMPONENT_SLOTS
    for k in range(1, COMPONENT_SLOTS + 1):
        x = 0.5 + (k - 1) * col
        add_image_slot(pkg, n, f"comp{k}", x + 0.15, 1.25, col - 0.3, 2.65)
        caption(slide, x + 0.05, 4.0, col - 0.1, 0.85, f"Component caption {k}", [f"{{{{Comp{k}Name}}}}", f"{{{{Comp{k}Role}}}}"])


def copy_chart(pkg: Pkg, src: int, new: int) -> None:
    """Copy a chart with its own style and colour parts (PowerPoint expects one set per chart)."""
    pkg.put(f"ppt/charts/chart{new}.xml", pkg.parts[f"ppt/charts/chart{src}.xml"])
    rels = etree.fromstring(pkg.parts[f"ppt/charts/_rels/chart{src}.xml.rels"])
    for r in rels:
        m = re.match(r"(style|colors)\d+\.xml$", r.get("Target"))
        if m:
            target = f"{m.group(1)}{new}.xml"
            pkg.put(f"ppt/charts/{target}", pkg.parts["ppt/charts/" + r.get("Target")])
            pkg.add_override(f"ppt/charts/{target}", "application/vnd.ms-office.chartstyle+xml" if m.group(1) == "style"
                             else "application/vnd.ms-office.chartcolorstyle+xml")
            r.set("Target", target)
    pkg.put(f"ppt/charts/_rels/chart{new}.xml.rels", etree.tostring(rels, xml_declaration=True, encoding="UTF-8", standalone=True))
    pkg.add_override(f"ppt/charts/chart{new}.xml", "application/vnd.openxmlformats-officedocument.drawingml.chart+xml")


def unlink_chart(pkg: Pkg, n: int) -> None:
    chart = pkg.tree(f"ppt/charts/chart{n}.xml")
    for tag in ("c:externalData", "c:autoUpdate"):
        for el in chart.iter(q(tag)):
            el.getparent().remove(el)
    rels = pkg.rels(f"ppt/charts/chart{n}.xml")
    for r in list(rels):
        if r.get("TargetMode") == "External" or "oleObject" in r.get("Type") or "package" in r.get("Type"):
            rels.remove(r)
    for f in chart.iter(q("c:f")):  # formulas named the other client's workbook sheet
        f.text = re.sub(r"^[^!]*!", "Sheet1!", f.text or "")


def chart_texts(pkg: Pkg, n: int) -> list:
    return list(pkg.tree(f"ppt/charts/chart{n}.xml").iter(q("a:t")))


# ---- images ----------------------------------------------------------------------------

def shrink_photos(pkg: Pkg) -> None:
    """Big photographic PNGs become JPEGs (max 1920 px) so the template downloads quickly."""
    renames = {}
    for name in [n for n in pkg.order if n.startswith("ppt/media/")]:
        data = pkg.parts[name]
        if len(data) < 300_000:
            continue
        im = Image.open(io.BytesIO(data))
        im.load()
        has_alpha = im.mode in ("RGBA", "LA") and im.getchannel("A").getextrema()[0] < 250
        if has_alpha:
            if max(im.size) > 1920:
                im.thumbnail((1920, 1920))
                buf = io.BytesIO()
                im.save(buf, "PNG", optimize=True)
                pkg.put(name, buf.getvalue())
            continue
        im = im.convert("RGB")
        im.thumbnail((1920, 1920))
        buf = io.BytesIO()
        im.save(buf, "JPEG", quality=85, optimize=True)
        new = re.sub(r"\.\w+$", ".jpeg", name) if not name.endswith((".jpeg", ".jpg")) else name
        if new != name and new in pkg.parts:
            new = name.rsplit(".", 1)[0] + "_s.jpeg"
        pkg.drop(name)
        pkg.put(new, buf.getvalue())
        if new != name:
            renames[name.split("/")[-1]] = new.split("/")[-1]
    if not renames:
        return
    for n in [x for x in pkg.order if x.endswith(".rels")]:
        rels = pkg.tree(n)
        for r in rels:
            tgt = r.get("Target", "")
            base = tgt.rsplit("/", 1)[-1]
            if base in renames:
                r.set("Target", tgt[: -len(base)] + renames[base])
    ct = pkg.tree("[Content_Types].xml")
    if not any(d.get("Extension", "").lower() == "jpeg" for d in ct.findall(q("ct:Default"))):
        el = etree.Element(q("ct:Default"), Extension="jpeg", ContentType="image/jpeg")
        ct.insert(0, el)


# ---- the template ----------------------------------------------------------------------

MODULE_SPECS = [("Model", "{{ModuleModel}}"), ("Rated power (Pmax)", "{{PanelCap}} Wp"),
                ("Technology", "{{PanelType}}"), ("Cells", "{{S_cells}}"), ("Module efficiency", "{{S_eff}} %"),
                ("Open-circuit voltage (Voc)", "{{S_voc}} V"), ("Short-circuit current (Isc)", "{{S_isc}} A"),
                ("Voltage at Pmax (Vmp)", "{{S_vmp}} V"), ("Current at Pmax (Imp)", "{{S_imp}} A"),
                ("Temp. coefficient of Pmax", "{{S_tcp}} %/°C"), ("Temp. coefficient of Voc", "{{S_tcv}} %/°C"),
                ("Bifaciality", "{{S_bif}}"), ("Max. system voltage", "{{S_msv}} V DC"),
                ("Dimensions", "{{ModuleDims}}"), ("Weight", "{{S_wt}} kg")]
INVERTER_SPECS = [("Model", "{{InverterModel}}"), ("Rated AC output power", "{{InverterUnitKW}} kW"),
                  ("Max. AC apparent power", "{{S_kva}} kVA"), ("AC grid", "{{S_grid}}"),
                  ("Max. PV input voltage", "{{S_maxv}} V"), ("MPPT voltage range", "{{S_mppt}} V"),
                  ("Number of MPPTs", "{{S_nmppt}}"), ("Strings per MPPT", "{{S_spm}}"),
                  ("Max. input current per MPPT", "{{S_ipm}} A"), ("Max. short-circuit current per MPPT", "{{S_iscpm}} A"),
                  ("Max. efficiency", "{{S_effi}} %"), ("Topology", "{{S_topo}}"), ("Protection", "{{S_ip}}"),
                  ("Dimensions (W × H × D)", "{{S_dims}} mm"), ("Weight", "{{S_wti}} kg")]


def build() -> None:
    pkg = Pkg(SRC)

    # 1 cover: the client under the title, and the client's logo above it
    s = pkg.slide(1)
    p = para_with(s, "EPC of Solar PV System")
    np_ = copy.deepcopy(p)
    set_para(np_, "Client: {{Name}}")
    np_.find(q("a:r")).find(q("a:rPr")).set("cap", "none")
    p.addnext(np_)
    add_image_slot(pkg, 1, "client_logo", 3.8, 0.95, 2.4, 1.05)
    # 2 contents: offer reference
    set_run(pkg.slide(2), "HTC//TCO/01", "HTC/{{Abbreviation}}/TCO/01")
    # 12 schematic
    set_run(pkg.slide(12), "kWac", "{{ACCapacity}} kWac")
    set_run(pkg.slide(12), "kWp", "{{DCCapacity}} kWp")
    # 14 / 16 / 17 project pictures
    add_image_slot(pkg, 14, "site", 0.4, 1.0, 5.4, 3.95)
    add_image_slot(pkg, 16, "shadow", 0.4, 1.1, 5.6, 3.95)
    tag_slide(pkg.slide(16), "offer:needs:shadow")
    s16 = pkg.slide(16)
    for key, needle in (("ShadeP1", "As demonstrated in the simulation"), ("ShadeP2", "This is visually confirmed"),
                        ("ShadeP3", "The uniform shading analysis")):
        set_para(para_with(s16, needle), "{{%s}}" % key)
    tag_logo(s16, "Picture 1", "shadow")
    # 17: the two 3D angle views from the shading report, side by side
    add_image_slot(pkg, 17, "structure", 0.45, 1.0, 4.4, 3.3)
    add_image_slot(pkg, 17, "structure2", 5.15, 1.0, 4.4, 3.3)
    s17 = pkg.slide(17)
    tag_logo(s17, "Picture 10", "structure")
    tag_logo(s17, "Picture 1", "structure2")
    set_run(s17, "Installation Type:", "Installation Type: {{InstallationType}}")
    set_run(s17, "Tilt / Orientation:", "Tilt / Orientation: {{Tilt}}° / {{Orientation}}")
    set_run(s17, "Height: m", "Height: {{Elevation}} m")
    # 15 design summary
    tbl15 = tables(pkg.slide(15))[0]
    rows = tbl15.findall(q("a:tr"))
    rpr = first_rpr(rows[1].findall(q("a:tc"))[1])
    for i, text in enumerate(["{{InstallationType}}", "{{PanelNo}} modules", "{{PanelType}}", "{{PanelCap}}",
                              "{{ModuleMake}}", "{{DCCapacity}}", "{{InverterMake}}", "{{ACCapacity}}",
                              "{{DCACRatioPct}} %"], start=1):
        cell_set(rows[i].findall(q("a:tc"))[1], text, rpr)
    # 19-25 datasheet slides of particular models, plus generic spec slides
    for n in (19, 20, 21):
        tag_slide(pkg.slide(n), "offer:ds_module:JKM620N-78HL4-BDV")
    for n in (22, 23):
        tag_slide(pkg.slide(n), "offer:ds_inverter:SG150CX")
    for n in (24, 25):
        tag_slide(pkg.slide(n), "offer:ds_inverter:SG125CX-P2")
    components_slide(pkg, 50)
    clone_slide(pkg, 15, 49, after_slide=15)
    subsystem_slide(pkg, 49)
    clone_slide(pkg, 23, 47, after_slide=21)
    clone_slide(pkg, 23, 48, after_slide=25)
    spec_slide(pkg, 47, tbl15, "{{ModuleMake}} {{ModuleModel}} PV Module Specification from Manufacturer’s Datasheet",
               MODULE_SPECS, "offer:spec_module")
    spec_slide(pkg, 48, tbl15, "{{InverterMake}} {{InverterModel}} Solar PV Inverter Specification from Manufacturer’s Datasheet",
               INVERTER_SPECS, "offer:spec_inverter")
    # 27 engineering notes
    s27 = pkg.slide(27)
    set_run(s27, "710Wp", "{{PanelCap}}Wp")
    set_run(s27, "AstroEnergy", "{{ModuleMake}}")
    set_run(s27, "125kW ", "{{InverterMix}} ")
    set_run(s27, "(125kW CX-P2) from ", "from ")
    set_run(s27, "Sungrow", "{{InverterMake}}")
    for h in list(s27.iter(q("a:highlight"))):
        h.getparent().remove(h)
    # 28 carbon: the picture held another project's numbers
    s28 = pkg.slide(28)
    set_para(para_with(s28, "Green House Gas Equivalents"), "Green House Gas Equivalents for the Proposed PV System")
    remove_shape(pkg, 28, "Picture 1")
    textbox(s28, 1.4, 1.1, 7.2, 4.2, [
        "{{PanelNo}} PV modules (each {{PanelCap}} Wp)",
        "{{DCCapacity}} kWp installed capacity, {{AnnualGenKWh}} kWh of energy per year",
        "{{Homes}} Omani houses energised per year",
        "{{GasGallons}} gallons of gas saved per year",
        "{{CO2Tonnes}} tonnes of CO₂ emissions avoided per year",
        "{{Cars}} cars taken off the road per year, or the carbon sequestered by {{Seedlings}} tree seedlings grown for 10 years",
    ])
    # 29 monthly energy
    s29 = pkg.slide(29)
    tbl = tables(s29)[0]
    rows = tbl.findall(q("a:tr"))
    set_para(rows[0].findall(q("a:tc"))[1].find(".//" + q("a:p")), "Monthly Energy Yield of the PV System (kWh)")
    for i in range(1, 13):
        cell_set(rows[i].findall(q("a:tc"))[1], f"{{{{M{i}}}}}")
    cell_set(rows[13].findall(q("a:tc"))[1], "{{MTotal}}")
    for t in chart_texts(pkg, 1):
        if "Annual Solar Energy Yield" in (t.text or ""):
            t.text = "Monthly Solar Energy Yield (MWh)"
        elif "energy" in (t.text or "").lower():
            t.text = "Energy (MWh)"
    # 30 degradation tables
    s30 = pkg.slide(30)
    t1, t2 = tables(s30)
    for tbl_, first in ((t1, 1), (t2, 21)):
        for i, tr in enumerate(tbl_.findall(q("a:tr"))[1:]):
            y = first + i
            tcs = tr.findall(q("a:tc"))
            cell_set(tcs[1], f"{{{{Y{y}E}}}}")
            cell_set(tcs[2], f"{{{{Y{y}L}}}}")
    p = para_with(s30, "degradation factor")
    for t in p.iter(q("a:t")):
        t.text = (t.text or "").replace("0.65%", "{{Degradation}}%")
    assert "{{Degradation}}" in runs_text(p)
    # 32 financial analysis: text, and a chart in place of the old graph picture
    s32 = pkg.slide(32)
    set_run(s32, "The graph represents the cost of the energy produced by the system over 25 years if it was taken from the grid at the tariff of 33bz/kwh. ",
            "The graph shows the cumulative cash flow over 25 years, valuing the energy produced at the grid tariff of {{TariffBz}} bz/kWh. ")
    set_run(s32, "3 Years & 02 Months", "{{PaybackText}}")
    set_run(s32, "Considering an annual savings due to the value of electricity generated of 235,808.100 OMR, The ",
            "With annual savings from the value of the electricity generated of {{AnnualSavings}} OMR in the first year, the ")
    set_run(s32, "28.9%", "{{ROI}}%")
    x, y, cx, cy = remove_shape(pkg, 32, "Picture 2")
    copy_chart(pkg, 1, 3)
    gf = copy.deepcopy(next(g for g in s29.iter(q("p:graphicFrame")) if g.find(".//" + q("c:chart")) is not None))
    gf.find(q("p:nvGraphicFramePr")).find(q("p:cNvPr")).set("id", str(max_shape_id(s32) + 1))
    xfrm = gf.find(q("p:xfrm"))
    xfrm.find(q("a:off")).set("x", str(x))
    xfrm.find(q("a:off")).set("y", str(y))
    xfrm.find(q("a:ext")).set("cx", str(cx))
    xfrm.find(q("a:ext")).set("cy", str(cy))
    gf.find(".//" + q("c:chart")).set(q("r:id"), add_rel(pkg, "ppt/slides/slide32.xml", CHART_REL, "../charts/chart3.xml"))
    s32.find(q("p:cSld")).find(q("p:spTree")).append(gf)
    for t in chart_texts(pkg, 3):
        if "Annual Solar Energy Yield" in (t.text or ""):
            t.text = "Cumulative Cash Flow (OMR)"
        elif "energy" in (t.text or "").lower():
            t.text = "OMR"
    c3 = pkg.tree("ppt/charts/chart3.xml")
    for sv in c3.iter(q("c:showVal")):
        sv.set("val", "0")
    # 42 commercial table
    s42 = pkg.slide(42)
    set_run(s42, "Metal Sheet Installation", "{{InstallationType}}")
    row = tables(s42)[0].findall(q("a:tr"))[1]
    tcs = row.findall(q("a:tc"))
    rpr = first_rpr(tcs[0])
    for tc, text in zip(tcs[1:], ["{{DCCapacity}}", "{{ACCapacity}}", "{{OmrPerKwp}}", "{{Subtotal}}"]):
        cell_set(tc, text, rpr)

    for n in (1, 2, 3):
        unlink_chart(pkg, n)
    shrink_photos(pkg)
    pkg.save(OUT)
    print(f"wrote {OUT} ({OUT.stat().st_size // 1024} KB)")


if __name__ == "__main__":
    build()
