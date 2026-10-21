"""Build clean, fully-placeholdered document templates from the originals.

Run from the project root:   python tools/prepare_templates.py

Reads   source_templates/*.docx   (the files exactly as they were supplied)
Writes  app/doc_templates/*.docx  (the files the app fills in)

What it fixes
-------------
NAMA design approval forms (above / below 11 kW):
  * hard-coded values (Jinko, 2256x1133x35 mm, strings=2, tilt=5, azimuth=208,
    545 Wp, inverter qty=1, "RT") become placeholders
  * annual production is written in kWh, matching the form's label
  * an azimuth box is added to the >11 kW form (it had none)
  * the "1 phase / 3 phases" and "internal transformer Yes / No" marks
    follow the project instead of being fixed
  * each Documents Required row (Yes / No / NA) is tagged so the app can set it
NAMA initial service application form:
  * every value box is re-laid-out on its line (no more overlapping text)
  * tick marks (premises type, connection type, phases, mounting) follow the project
  * Tel, E-mail, Village and Governorate get boxes
  * consultant / contractor names, phones, engineers, signatures and stamps are
    removed from the scanned background and replaced by boxes filled from the
    contractor / consultant lists (stamps become optional per-company images)
Execution agreement:
  * module make / type / rating, inverter make / quantity / unit rating,
    contractor details, degradation and tariff become placeholders
"""
from __future__ import annotations

import io
import statistics
import sys
from pathlib import Path

from PIL import Image

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from app.docgen import ooxml as ox  # noqa: E402

SRC = ROOT / "source_templates"
OUT = ROOT / "app" / "doc_templates"
PX = ox.EMU_PER_PX100  # EMU per pixel on a 100 dpi render of a Letter page
MARGIN = 914400        # the forms' column / paragraph origin sits 1 inch in


def page_x(px: float) -> int:
    return int(px * PX - MARGIN)


def page_y(px: float) -> int:
    return int(px * PX - MARGIN)


# --------------------------------------------------------------------------------
# Design approval forms
# --------------------------------------------------------------------------------

DESIGN_TEXT_MAP = {
    "5": "{{Tilt}}",
    "JInko": "{{ModuleMake}} {{ModuleModel}}",
    "2256 ×1133×35mm": "{{ModuleDims}}",
    "2": "{{Strings}}",
    "1": "{{InverterQty}}",
    "{{InverterMake}} RT": "{{InverterMake}} {{InverterModel}}",
    "{{InverterMake}} RTRT": "{{InverterMake}} {{InverterModel}}",
    "{{AnnualGen}} MWh": "{{AnnualGenKWh}}",
    "{{AnnualGen}},000": "{{AnnualGenKWh}}",
    "208": "{{Azimuth}}",
    "545": "{{PanelCap}}",
}


def prepare_design_form(src: Path, dst: Path) -> None:
    d = ox.Docx.open(src)
    root = d.doc
    ox.strip_fallbacks(root)
    tilt_anchor = azimuth_found = None
    doc_boxes = []
    for a in ox.anchors(root):
        txt = ox.anchor_text(a).strip()
        geom = ox.anchor_geom(a)
        if txt in DESIGN_TEXT_MAP:
            new = DESIGN_TEXT_MAP[txt]
            ox.set_textbox_text(a, new, size_halfpt=20, font="Arial")
            if new == "{{Tilt}}":
                tilt_anchor = a
            if new == "{{Azimuth}}":
                azimuth_found = a
        elif txt.startswith("{{"):
            # existing placeholder boxes: same font everywhere
            ox.set_textbox_text(a, txt.replace(" ", "") if txt.count("{{") == 1 else txt,
                                size_halfpt=20, font="Arial")
        elif geom == "frame":
            cx, _ = ox.get_extent(a)
            x, y = ox.get_pos(a)
            if cx > 600000:   # frame around "3 phases"
                ox.set_tag(a, "if:phase3")
                c = ox.clone_anchor(a)
                ox.set_tag(c, "if:phase1")
                ox.set_pos(c, x=x - 668000)
                ox.set_extent(c, 668000, ox.get_extent(a)[1])
            else:             # frame around "No" (internal transformer)
                ox.set_tag(a, "if:trafo_no")
                c = ox.clone_anchor(a)
                ox.set_tag(c, "if:trafo_yes")
                ox.set_pos(c, x=x - 348000)
        elif geom == "rect" and not txt and not ox.is_picture(a):
            doc_boxes.append(a)

    if azimuth_found is None and tilt_anchor is not None:
        # >11 kW form has no azimuth box: add one on the Rotation / Azimuth row
        c = ox.clone_anchor(tilt_anchor)
        x, y = ox.get_pos(tilt_anchor)
        ox.set_pos(c, y=y + 263000)
        ox.set_textbox_text(c, "{{Azimuth}}", size_halfpt=20, font="Arial")

    # Documents Required boxes: one per row, sorted top to bottom
    doc_boxes.sort(key=lambda a: ox.get_pos(a)[1])
    xs = [ox.get_pos(a)[0] for a in doc_boxes]
    yes_x = int(statistics.median([x for x in xs if x < 3800000]))
    na_x = int(statistics.median([x for x in xs if x >= 3800000]))
    no_x = int(yes_x + (na_x - yes_x) * 0.57)
    for i, a in enumerate(doc_boxes, 1):
        x = ox.get_pos(a)[0]
        default = "yes" if x < 3800000 else "na"
        ox.set_tag(a, f"doc:{i}:{default}|{yes_x}|{no_x}|{na_x}")
    d.save(dst)
    print(f"  {dst.name}: {len(doc_boxes)} checklist rows")


# --------------------------------------------------------------------------------
# Initial service application form
# --------------------------------------------------------------------------------

# (text, left px, centre-line px, width px, alignment) on a 100 dpi render
INITIAL_FIELDS = [
    ("{{Name}}", 112, 131, 640, "left"),
    ("{{Tel}}", 52, 157, 105, "left"),
    ("{{Contact}}", 306, 157, 130, "left"),
    ("{{IDNo}}", 590, 157, 120, "left"),
    ("{{Email}}", 64, 190, 600, "left"),
    ("{{Village}}", 64, 218, 115, "left"),
    ("{{Wilaya}}", 306, 218, 150, "left"),
    ("{{Governorate}}", 600, 218, 150, "left"),
    ("{{AccountNo}}", 184, 307, 400, "left"),
    ("{{AnnualGen}}", 133, 397, 66, "right"),
    ("{{PanelNo}}", 166, 419, 98, "left"),
    ("{{PanelCap}}", 160, 441, 82, "right"),
    ("{{ModuleMake}}", 166, 463, 130, "left"),
    ("{{Capacity}} kWp / {{InverterCap}} kWac", 554, 397, 143, "left"),
    ("{{ProjectArea}} sqm", 566, 419, 125, "left"),
    ("{{InverterMake}}", 566, 441, 125, "left"),
    ("{{ConsultantName}}", 64, 565, 230, "left"),
    ("{{ConsultantTel}}", 52, 590, 235, "left"),
    ("{{ConsultantEngineer}}", 102, 613, 190, "left"),
    ("{{ContractorName}}", 480, 565, 245, "left"),
    ("{{ContractorTel}}", 466, 590, 255, "left"),
    ("{{ContractorEngineer}}", 506, 613, 220, "left"),
]

# (flag, checkbox centre px)
INITIAL_TICKS = [
    ("prem_agricultural", 233, 283), ("prem_governmental", 400, 283),
    ("prem_commercial", 561, 283), ("prem_residential", 722, 283),
    ("conn_self", 231, 368), ("conn_lease", 436, 368), ("conn_hybrid", 635, 368),
    ("phase3", 193, 505), ("phase1", 332, 505),
    ("mount_rooftop", 605, 483), ("mount_carpark", 689, 483),
    ("mount_ground", 606, 505), ("mount_other", 687, 505),
]

# stamp / signature image slots: (tag, left, top, width, height) px
INITIAL_IMAGES = [
    ("img:consultant_stamp", 160, 600, 120, 95),
    ("img:contractor_stamp", 575, 600, 120, 95),
]

# background clean-up, in page px
WHITE_RECTS = [
    (551, 386, 697, 408),                      # printed "kWp / kW ac" units
    (56, 549, 298, 575), (46, 576, 294, 598), (98, 598, 294, 622), (136, 623, 296, 652),
    (478, 549, 728, 575), (460, 576, 728, 598), (502, 598, 728, 622), (543, 623, 728, 652),
    (140, 646, 425, 655), (540, 646, 738, 655),  # strip between signature line and red bar
]
INK_REGIONS = [(130, 545, 425, 712), (520, 545, 736, 712)]
# where the stamps sat: also clear faint grey residue there
STAMP_AREAS = [(270, 553, 378, 668), (625, 588, 736, 668)]


def _clean_background(img: Image.Image) -> Image.Image:
    img = img.convert("RGB")
    w, h = img.size
    sx, sy = w / 849.6, h / 1100.5
    px = img.load()

    def box(x0, y0, x1, y1):
        return int(x0 * sx), int(y0 * sy), int(x1 * sx), int(y1 * sy)

    # 1. restore the pre-ticked "3 phases" box using the empty "Single phase" box
    src = img.crop(box(322, 495, 342, 515))
    img.paste(src, box(183, 495, 203, 515)[:2])

    # 2. remove stamps / signatures (blue ink everywhere, dark ink over the red bar)
    for x0, y0, x1, y1 in INK_REGIONS:
        X0, Y0, X1, Y1 = box(x0, y0, x1, y1)
        for y in range(Y0, Y1):
            row = [px[x, y] for x in range(X0, X1)]
            reds = sum(1 for r, g, b in row if r > 170 and g < 110 and b < 120)
            in_bar = reds > 0.45 * len(row)
            bg = (226, 35, 52) if in_bar else (255, 255, 255)
            if in_bar:
                bgs = [c for c in row if c[0] > 170 and c[1] < 110 and c[2] < 120]
                bg = tuple(int(statistics.median(ch)) for ch in zip(*bgs))
            for x in range(X0, X1):
                r, g, b = px[x, y]
                blue = b - r > 12 and b - g > 4 and b > 70
                reddish = r > 165 and g < 125 and b < 135
                whiteish = r > 200 and g > 200 and b > 200
                dark_on_bar = in_bar and not reddish and not whiteish
                if blue or dark_on_bar:
                    px[x, y] = bg

    # 2b. faint grey residue (light, non-red pixels) where the stamps were
    for x0, y0, x1, y1 in STAMP_AREAS:
        X0, Y0, X1, Y1 = box(x0, y0, x1, y1)
        for y in range(Y0, Y1):
            for x in range(X0, X1):
                r, g, b = px[x, y]
                lum = 0.3 * r + 0.59 * g + 0.11 * b
                reddish = (r > 165 and g < 125 and b < 135) or (r - g > 45 and r > 180)
                if reddish:
                    continue
                if 120 < lum < 240 and not reddish and max(r, g, b) - min(r, g, b) < 60 or (b - r > 8 and lum > 90):
                    px[x, y] = (255, 255, 255)

    # 3. blank the value areas (old names, phone numbers, engineers, signatures)
    from PIL import ImageDraw
    dr = ImageDraw.Draw(img)
    for r in WHITE_RECTS:
        dr.rectangle(box(*r), fill=(255, 255, 255))
    # 4. the consultant's Arabic labels sat under its stamp: replace them with the
    #    identical (clean) labels from the contractor column, 419 px to the right
    src = img.crop(box(724, 575, 838, 653))
    img.paste(src, box(724 - 419, 575, 838 - 419, 653)[:2])

    # 5. on the red "Terms & Conditions" bar, between its English and Arabic titles,
    #     anything that isn't bar-red is stamp residue: paint it bar-red
    for x0, x1 in ((185, 425), (520, 692)):
        X0, X1 = int(x0 * sx), int(x1 * sx)
        for y in range(int(645 * sy), int(700 * sy)):
            row = [px[x, y] for x in range(X0, X1)]
            bgs = [c for c in row if c[0] > 170 and c[1] < 110 and c[2] < 120]
            if len(bgs) < 0.45 * len(row):
                continue
            bar = tuple(int(statistics.median(ch)) for ch in zip(*bgs))
            for x in range(X0, X1):
                r, g, b = px[x, y]
                if not (r > 170 and g < 110 and b < 120):
                    px[x, y] = bar

    return img


def _transparent_png() -> bytes:
    b = io.BytesIO()
    Image.new("RGBA", (4, 4), (255, 255, 255, 0)).save(b, "PNG")
    return b.getvalue()


def prepare_initial_form(src: Path, dst: Path) -> None:
    d = ox.Docx.open(src)
    root = d.doc
    ox.strip_fallbacks(root)
    all_anchors = ox.anchors(root)
    pic = next(a for a in all_anchors if ox.is_picture(a))
    x_proto = next(a for a in all_anchors if ox.anchor_geom(a) == "mathMultiply")
    tb_proto = next(a for a in all_anchors if "{{IDNo}}" in ox.anchor_text(a).replace("|", ""))
    pic_run = ox.anchor_run(pic)

    # background image clean-up
    blip = pic.find(".//" + ox.q("a:blip"))
    media = d.rel_target(blip.get(ox.q("r:embed")))
    bg = _clean_background(Image.open(io.BytesIO(d.parts[media])))
    out = io.BytesIO()
    bg.save(out, "JPEG", quality=92)
    d.parts[media] = out.getvalue()

    # all new shapes go into the background picture's paragraph so that positions
    # are simple page coordinates
    last = pic_run
    for text, x, yc, w, align in INITIAL_FIELDS:
        a = ox.clone_anchor(tb_proto, after=last)
        last = ox.anchor_run(a)
        ox.set_pos(a, x=page_x(x), y=page_y(yc - 10), rel_h="column", rel_v="paragraph")
        ox.set_extent(a, w * PX, 20 * PX)
        ox.set_textbox_text(a, text, align=align, size_halfpt=17 if "kWac" in text else 19, font="Arial",
                            zero_insets=True, v_center=True)
    for flag, cx, cy in INITIAL_TICKS:
        a = ox.clone_anchor(x_proto, after=last)
        last = ox.anchor_run(a)
        ox.set_pos(a, x=page_x(cx - 11), y=page_y(cy - 9), rel_h="column", rel_v="paragraph")
        ox.set_tag(a, "if:" + flag)
    for i, (tag, x, y, w, h) in enumerate(INITIAL_IMAGES, 1):
        rid = d.add_media(_transparent_png(), f"slot{i}.png")
        a = ox.clone_anchor(pic, after=last)
        last = ox.anchor_run(a)
        a.set("behindDoc", "0")
        a.set("relativeHeight", str(251800000 + i))
        ox.set_pos(a, x=page_x(x), y=page_y(y), rel_h="column", rel_v="paragraph")
        ox.set_extent(a, w * PX, h * PX)
        b = a.find(".//" + ox.q("a:blip"))
        b.set(ox.q("r:embed"), rid)
        for sr in a.iter(ox.q("a:srcRect")):
            sr.getparent().remove(sr)
        ox.set_tag(a, tag)

    # remove the original boxes and tick marks
    for a in all_anchors:
        if a is not pic:
            ox.remove_anchor(a)
    d.save(dst)
    print(f"  {dst.name}: {len(INITIAL_FIELDS)} fields, {len(INITIAL_TICKS)} tick marks")


# --------------------------------------------------------------------------------
# Execution agreement (residential)
# --------------------------------------------------------------------------------

EA_EXACT = {
    "Hussam Technology Company": "{{ContractorName}}",
    "Contact: 9791 3822": "Contact: {{ContractorTel}}",
    "Email: solar@htc.om": "Email: {{ContractorEmail}}",
    "Jinko Half-cut Panels": "{{ModuleDescription}}",
    "Sungrow RT Series": "{{InverterDescription}}",
    "Elevated Flat Roof ({{Elevation}}m high)": "{{InstallationType}}",
}
# value paragraph that follows a label paragraph
EA_AFTER_LABEL = {
    "PV Module Rating (Wp)": "{{PanelCap}}",
    "Total no. of Inverters": "{{InverterQty}}",
    "PV Inverter Rating (kWAC)": "{{InverterUnitKW}}",
}


def prepare_execution_agreement(src: Path, dst: Path) -> None:
    d = ox.Docx.open(src)
    root = d.doc
    paras = list(ox.iter_body_paragraphs(root))
    texts = [ox.paragraph_text(p) for p in paras]
    done = set()
    for i, (p, t) in enumerate(zip(paras, texts)):
        s = t.strip()
        if s in EA_EXACT and s not in done:
            ox.set_paragraph_text(p, EA_EXACT[s])
            done.add(s)
        elif s.startswith("Suite 2, Bldg.") and "addr" not in done:
            ox.set_paragraph_text(p, "{{ContractorAddress}}")
            for br in list(p.iter(ox.q("w:br"))):   # address now wraps on its own
                br.getparent().remove(br)
            done.add("addr")
        elif s == "DESIGN SUMMARY" and "layout" not in done:
            # the empty single-cell table below the heading becomes a layout-image slot
            tbl = p.getnext()
            while tbl is not None and tbl.tag != ox.q("w:tbl"):
                tbl = tbl.getnext()
            cell_p = tbl.find(".//" + ox.q("w:tc") + "/" + ox.q("w:p"))
            ppr = cell_p.find(ox.q("w:pPr"))
            ppr.find(ox.q("w:jc")).set(ox.q("w:val"), "center")
            rid = d.add_media(_transparent_png(), "layout_slot.png")
            cell_p.append(ox.inline_picture_run(root, rid, int(6.35 * 914400),
                                                int(4.70 * 914400), "img:layout"))
            done.add("layout")
        elif "Onwards degradation YOY" in s:
            ox.set_paragraph_text(p, t.replace("0.65%", "{{Degradation}}%"))
            done.add("deg")
        elif "32bz/kWh" in t:
            ox.set_paragraph_text(p, t.replace("32bz/kWh", "{{TariffBz}}bz/kWh")
                                  .replace("targeting the consumption rate of the third slab",
                                           "{{TariffNote}}"))
            done.add("tariff")
        elif s in EA_AFTER_LABEL:
            for j in range(i + 1, min(i + 6, len(paras))):
                if texts[j].strip():
                    ox.set_paragraph_text(paras[j], EA_AFTER_LABEL[s])
                    done.add(s)
                    break
    expected = set(EA_EXACT) | set(EA_AFTER_LABEL) | {"addr", "deg", "tariff", "layout"}
    missing = expected - done
    if missing:
        raise SystemExit(f"Execution agreement: could not find {missing}")
    d.save(dst)
    print(f"  {dst.name}: {len(done)} replacements")


def prepare_plain(src: Path, dst: Path) -> None:
    d = ox.Docx.open(src)
    ox.strip_fallbacks(d.doc)
    d.save(dst)
    print(f"  {dst.name}: copied (placeholders only)")


def main() -> None:
    OUT.mkdir(parents=True, exist_ok=True)
    print("Preparing templates ->", OUT)
    prepare_design_form(SRC / "NAMA_Design_Above_11kW.docx", OUT / "nama_design_above_11kw.docx")
    prepare_design_form(SRC / "NAMA_Design_Below_11kW.docx", OUT / "nama_design_below_11kw.docx")
    prepare_initial_form(SRC / "NAMA_Initial_Form.docx", OUT / "nama_initial_form.docx")
    prepare_plain(SRC / "NAMA_Agency_Contract.docx", OUT / "nama_agency_contract.docx")
    prepare_execution_agreement(SRC / "Execution_Agreement.docx", OUT / "execution_agreement.docx")


if __name__ == "__main__":
    main()
