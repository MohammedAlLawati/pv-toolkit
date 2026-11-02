"""Cut the product picture out of each datasheet in web/data/datasheets, for the offer deck.

    python -m tools.extract_product_images

Writes web/data/products/<datasheet name>.png (the browser looks a library item's datasheet
up there). Sungrow datasheets carry the inverter as a picture with a transparency mask on page
1; Jinko draws the module as vector graphics, so that page is rendered and cropped (CROPS).
Needs poppler's pdfimages / pdftoppm.
"""
import subprocess
import tempfile
from pathlib import Path

from PIL import Image

ROOT = Path(__file__).resolve().parent.parent
SRC = ROOT / "web" / "data" / "datasheets"
OUT = ROOT / "web" / "data" / "products"
MAX_PX = 900
MIN_PX = 300

# datasheets whose product is drawn, not placed as a picture: page 1 crop as fractions (x0, y0, x1, y1)
CROPS = {"Tiger_Neo_JKM710-735N-66HL5-BDV-Z3-EN": (0.56, 0.08, 0.95, 0.53)}


def embedded(pdf: Path, tmp: Path):
    """The largest page-1 picture that has a transparency mask, as RGBA, or None."""
    listing = subprocess.run(["pdfimages", "-list", "-f", "1", "-l", "1", str(pdf)],
                             capture_output=True, text=True).stdout.splitlines()[2:]
    rows = [r.split() for r in listing]
    subprocess.run(["pdfimages", "-f", "1", "-l", "1", "-png", str(pdf), str(tmp / "i")], capture_output=True)
    best = None
    for i, r in enumerate(rows):
        if r[2] != "image" or i + 1 >= len(rows) or rows[i + 1][2] != "smask":
            continue
        w, h = int(r[3]), int(r[4])
        if min(w, h) < MIN_PX or (best and w * h <= best[1] * best[2]):
            continue
        best = (i, w, h)
    if not best:
        return None
    i = best[0]
    rgb = Image.open(tmp / f"i-{i:03d}.png").convert("RGB")
    mask = Image.open(tmp / f"i-{i + 1:03d}.png").convert("L").resize(rgb.size)
    rgb.putalpha(mask)
    return rgb


def rendered(pdf: Path, box, tmp: Path):
    subprocess.run(["pdftoppm", "-f", "1", "-l", "1", "-r", "200", "-png", str(pdf), str(tmp / "p")], capture_output=True)
    page = Image.open(next(tmp.glob("p-*.png"))).convert("RGB")
    w, h = page.size
    return page.crop((int(box[0] * w), int(box[1] * h), int(box[2] * w), int(box[3] * h)))


def main() -> None:
    OUT.mkdir(exist_ok=True)
    for pdf in sorted(SRC.glob("*.pdf")):
        with tempfile.TemporaryDirectory() as t:
            tmp = Path(t)
            im = rendered(pdf, CROPS[pdf.stem], tmp) if pdf.stem in CROPS else embedded(pdf, tmp)
        if im is None:
            print(f"no product picture in {pdf.name}")
            continue
        if im.mode == "RGBA":
            im = im.crop(im.getchannel("A").getbbox())
        im.thumbnail((MAX_PX, MAX_PX))
        im.save(OUT / f"{pdf.stem}.png", optimize=True)
        print(f"wrote {pdf.stem}.png {im.size}")


if __name__ == "__main__":
    main()
