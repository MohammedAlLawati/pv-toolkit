"""Read equipment specifications out of manufacturer datasheets.

Two readers:
  * Claude (when ANTHROPIC_API_KEY is set): sends the PDF/image to the Claude API, which
    reads text *and* page images, so it copes with multi-model tables, merged cells and
    overlapping text layers. Recommended.
  * Text reader (no key needed): pattern-matches the PDF's text layer. Works on clean
    tables; leaves blanks it isn't sure about.

Whatever is read goes to a review screen first; nothing is saved without confirmation.
"""
from __future__ import annotations

import base64
import io
import json
import os
import re
from dataclasses import dataclass, field

from .equipment_fields import FIELDS, Field, parse_value, split_list

ANTHROPIC_MODEL = os.environ.get("ANTHROPIC_MODEL", "claude-sonnet-5-5")

KNOWN_MAKES = [
    "Sungrow", "Huawei", "SMA", "Fronius", "Growatt", "GoodWe", "Solis", "Ginlong", "SolarEdge",
    "Sofar", "Deye", "Kstar", "Delta", "ABB", "FIMER", "Power Electronics", "TBEA", "Chint Power",
    "Jinko", "JinkoSolar", "LONGi", "JA Solar", "Trina", "Canadian Solar", "Risen", "Astronergy",
    "Tongwei", "DAS Solar", "Aiko", "REC", "Qcells", "Q CELLS", "Hanwha", "First Solar", "Seraphim",
    "Suntech", "Yingli", "Waaree", "Adani", "Vikram", "GCL", "Znshine", "DMEGC", "Huasun",
]


@dataclass
class ExtractResult:
    models: list[dict]
    method: str                       # claude | text
    warnings: list[str] = field(default_factory=list)


# --------------------------------------------------------------------------------------
# Entry point
# --------------------------------------------------------------------------------------

def extract(data: bytes, mime: str, kind: str) -> ExtractResult:
    warnings: list[str] = []
    if os.environ.get("ANTHROPIC_API_KEY"):
        try:
            res = extract_with_claude(data, mime, kind)
            if res.models:
                return finish(res, kind)
            warnings.append("Claude found no models in this file; tried the text reader instead.")
        except Exception as exc:  # network / quota / bad file
            warnings.append(f"Claude reader unavailable ({type(exc).__name__}: {str(exc)[:160]}). "
                            "Used the text reader instead; check every value.")
    else:
        warnings.append("No Claude API key is set, so the basic text reader was used. It reads clean "
                        "tables well but leaves blanks where it isn't sure. Check every value.")
    if mime != "application/pdf":
        return ExtractResult([], "text", warnings + ["Images can only be read with the Claude reader."])
    res = extract_from_text(data, kind)
    res.warnings = warnings + res.warnings
    return finish(res, kind)


def finish(res: ExtractResult, kind: str) -> ExtractResult:
    """Type-convert, derive helpers, guess category, and drop empty rows."""
    clean = []
    for m in res.models:
        row = {}
        for f in FIELDS[kind]:
            row[f.key] = parse_value(f, m.get(f.key)) if f.type != "bool" else bool(m.get(f.key))
        if kind == "inverter":
            topo = (row.get("topology") or "").lower()
            if "transformerless" in topo or "non-isolated" in topo:
                row["internal_transformer"] = False
            if row.get("phases") is None and row.get("ac_voltage"):
                row["phases"] = 3 if re.search(r"\b3\s*/|3-?phase|three", row["ac_voltage"], re.I) else None
            row["category"] = m.get("category") or guess_category(row)
        if row.get("model"):
            clean.append(row)
    res.models = clean
    return res


def guess_category(row: dict) -> str:
    kw = row.get("ac_kw") or 0
    if kw > 250 or (row.get("max_dc_v") or 0) > 1100:
        return "utility"
    if kw <= 20 and (row.get("phases") in (1, None) or kw <= 20):
        return "residential"
    return "commercial"


# --------------------------------------------------------------------------------------
# Claude reader
# --------------------------------------------------------------------------------------

def _json_type(f: Field) -> list[str]:
    return {"float": ["number", "null"], "int": ["integer", "null"], "bool": ["boolean", "null"]}.get(
        f.type, ["string", "null"])


def tool_schema(kind: str) -> dict:
    props = {}
    for f in FIELDS[kind]:
        if not f.extract:
            continue
        desc = f.label + (f" [{f.unit}]" if f.unit else "") + (f". {f.hint}" if f.hint else "")
        props[f.key] = {"type": _json_type(f), "description": desc}
    return {
        "name": "record_datasheet",
        "description": f"Record the specifications of every {kind} model in the datasheet.",
        "input_schema": {
            "type": "object",
            "properties": {
                "models": {
                    "type": "array",
                    "description": "One entry per model / power class listed in the datasheet.",
                    "items": {"type": "object", "properties": props,
                              "required": [k for k in props]},
                },
                "reading_notes": {"type": "string",
                                  "description": "Anything ambiguous or hard to read."},
            },
            "required": ["models"],
        },
    }


INSTRUCTIONS = {
    "inverter": (
        "You are reading a PV inverter datasheet for a design engineer. Extract every model "
        "in the specification table (one entry per model column). Copy values exactly as "
        "printed; convert W to kW and VA to kVA. Where a cell spans several columns it "
        "applies to each of those models. For values that differ by MPPT (e.g. '32 A / 16 A' "
        "or '30 A * 12'), give the per-MPPT list separated by '/', e.g. '32/16' or a single "
        "'30' if all MPPTs are equal. For strings per MPPT use the same style (e.g. '2/1'); if "
        "only 'max. number of input connectors per MPPT' is given, use that. If the rated "
        "power depends on temperature, use the rating at 40-45 °C and put the full rating "
        "table in notes. Put footnotes that limit the design (e.g. voltage windows, connector "
        "requirements, derating) into notes. Use null for anything not stated; never guess."
    ),
    "module": (
        "You are reading a PV module datasheet for a design engineer. Extract one entry per "
        "power class (each column of the electrical table is a separate model; build the full "
        "model name for each class if the datasheet gives a pattern). Use STC values for "
        "Pmax, Voc, Isc, Vmp, Imp (ignore NOCT/NMOT rows except for the NOCT/NMOT temperature "
        "itself). Temperature coefficients in %/°C with their sign (Voc and Pmax negative, "
        "Isc positive). Bifaciality as a fraction (80% -> 0.80). Dimensions in mm. Values "
        "shared by all classes (dimensions, coefficients, max system voltage) apply to every "
        "entry. Use null for anything not stated; never guess."
    ),
}

_client_factory = None  # tests can replace this with a fake client


def _client():
    if _client_factory:
        return _client_factory()
    import anthropic
    return anthropic.Anthropic()


def extract_with_claude(data: bytes, mime: str, kind: str) -> ExtractResult:
    b64 = base64.standard_b64encode(data).decode()
    if mime == "application/pdf":
        block = {"type": "document", "source": {"type": "base64", "media_type": mime, "data": b64}}
    else:
        block = {"type": "image", "source": {"type": "base64", "media_type": mime, "data": b64}}
    msg = _client().messages.create(
        model=ANTHROPIC_MODEL,
        max_tokens=8000,
        tools=[tool_schema(kind)],
        tool_choice={"type": "tool", "name": "record_datasheet"},
        messages=[{"role": "user", "content": [block, {"type": "text", "text": INSTRUCTIONS[kind]}]}],
    )
    payload = next((b.input for b in msg.content if getattr(b, "type", "") == "tool_use"), None)
    if payload is None:
        return ExtractResult([], "claude", ["Claude did not return structured data."])
    warnings = []
    if payload.get("reading_notes"):
        warnings.append("Reader's note: " + str(payload["reading_notes"])[:600])
    return ExtractResult(list(payload.get("models") or []), "claude", warnings)


# --------------------------------------------------------------------------------------
# Text reader (fallback)
# --------------------------------------------------------------------------------------

NUM = r"[-+]?\d+(?:[.,]\d+)?"

INV_LABELS = {
    "max_dc_kw": r"recommended max\.? (?:pv )?input power|max\.? (?:pv|dc) input power",
    "max_dc_v": r"max\.? (?:pv |dc )?input voltage",
    "min_start": r"min\.? (?:pv )?input voltage\s*/\s*start",
    "start_v": r"start[- ]?up (?:input )?voltage",
    "rated_input_v": r"(?:rated|nominal) (?:pv |dc )?input voltage",
    "mppt_range": r"mpp[t]? (?:operating )?voltage range|mpp voltage range",
    "num_mppt": r"no\.? of independent mpp|number of (?:independent )?mppt",
    "mppt_strings": r"no\.? of pv strings per mppt|strings per mppt|input connectors? per mppt",
    "mppt_currents": r"max\.? (?:pv |dc )?input current",
    "mppt_iscs": r"max\.? (?:dc )?short[- ]circuit current",
    "max_connector_current_a": r"max\.? current for dc connector",
    "ac_kw": r"rated ac output power|^ ?ac output power|nominal ac (?:output )?power",
    "max_ac_kva": r"max\.? ac output apparent power",
    "max_ac_current_a": r"max\.? ac output current",
    "ac_voltage": r"(?:rated|nominal) ac voltage",
    "phases": r"feed-?in phases",
    "eff_pair": r"max\.? efficiency\s*/\s*european",
    "max_eff_pct": r"^ ?max\.? efficiency",
    "euro_eff_pct": r"european efficiency",
    "dimensions": r"dimensions",
    "weight_kg": r"^ ?weight",
    "ip_rating": r"degree of protection|ingress protection",
    "topology": r"topology|isolation method",
}
MOD_LABELS = {
    "wp": r"maximum power\s*\(?pmax|max(?:imum)?\.? power|rated power|pmax",
    "vmp": r"(?:maximum power|optimum operating|mpp) voltage|\bvmpp?\b",
    "imp": r"(?:maximum power|optimum operating|mpp) current|\bimpp?\b",
    "voc": r"open[- ]circuit voltage|\bvoc\b",
    "isc": r"short[- ]circuit current|\bisc\b",
    "efficiency_pct": r"module efficiency",
    "tc_pmax_pct": r"temperature coefficients? of pmax|pmax temperature",
    "tc_voc_pct": r"temperature coefficients? of voc|voc temperature",
    "tc_isc_pct": r"temperature coefficients? of isc|isc temperature",
    "noct_c": r"\bnoct\b|\bnmot\b|nominal operating cell",
    "max_system_v": r"max(?:imum)?\.? system voltage",
    "max_fuse_a": r"series fuse",
    "dimensions": r"dimensions",
    "weight_kg": r"^ ?weight",
    "cells": r"no\.? of cells|number of cells|cell (?:arrangement|number|quantity)",
    "bifaciality": r"bifaciality",
}
HEADER_LABELS = r"type designation|^ ?model(?: number| type)?\b|module type|^ ?type\b"


def _pdf_lines(data: bytes) -> list[str]:
    import pdfplumber
    lines = []
    with pdfplumber.open(io.BytesIO(data)) as pdf:
        for page in pdf.pages:
            page = page.dedupe_chars(tolerance=1)
            txt = page.extract_text(layout=True) or ""
            lines += [ln.strip() for ln in txt.splitlines() if ln.strip()]
    return lines


def _cells(rest: str) -> list[str]:
    return [c.strip() for c in re.split(r"\s{2,}", rest.strip()) if c.strip()]


def _after_label(line: str, pattern: str) -> str | None:
    m = re.search(pattern, line, re.I)
    if not m:
        return None
    rest = line[m.end():]
    # drop the remainder of the label (words up to the first wide gap) and footnote stars
    parts = re.split(r"\s{2,}", rest, maxsplit=1)
    if len(parts) == 2 and not re.search(r"\d", parts[0]):
        rest = parts[1]
    # footnote marks sit right after the label; stars between numbers mean "times"
    return re.sub(r"^[\s*]+", "", rest).strip()


def _nums(s: str) -> list[float]:
    return [float(x.replace(",", ".")) for x in re.findall(NUM, s)]


def _per_mppt(cell: str) -> str | None:
    """'48 A (32 A / 16 A)' -> '32/16';  '360 A ( 30 A * 12 )' -> '30';  '6 * 75 A' -> '75'."""
    m = re.search(rf"\(\s*({NUM})\s*A?\s*\*\s*(\d+)\s*\)", cell)
    if m:
        return m.group(1)
    m = re.search(rf"(\d+)\s*\*\s*({NUM})\s*A", cell)
    if m:
        return m.group(2)
    m = re.search(r"\(([^)]*)\)", cell)
    if m and "/" in m.group(1):
        vals = _nums(m.group(1))
        return "/".join(f"{v:g}" for v in vals) if vals else None
    vals = _nums(cell)
    return f"{vals[0]:g}" if vals else None


def extract_from_text(data: bytes, kind: str) -> ExtractResult:
    try:
        lines = _pdf_lines(data)
    except Exception as exc:
        return ExtractResult([], "text", [f"Couldn't read the PDF's text ({exc})."])
    text = "\n".join(lines)
    warnings: list[str] = []

    # model names from the header row
    names: list[str] = []
    for ln in lines:
        rest = _after_label(ln, HEADER_LABELS)
        if rest:
            cand = [c for c in _cells(rest) if re.search(r"\d", c) and re.search(r"[A-Za-z]", c)
                    and len(c) >= 4 and " " not in c.strip()]
            if cand:
                names = cand
                break
    if not names:
        return ExtractResult([], "text", ["Couldn't find model names in the text."])
    n = len(names)
    rows = [{"model": nm} for nm in names]

    make = next((mk for mk in KNOWN_MAKES if re.search(rf"\b{re.escape(mk)}\b", text, re.I)), "")
    for r in rows:
        r["make"] = make

    labels = INV_LABELS if kind == "inverter" else MOD_LABELS
    seen = set()
    for ln in lines:
        for key, pat in labels.items():
            if key in seen:
                continue
            rest = _after_label(ln, pat)
            if rest is None or not rest:
                continue
            seen.add(key)
            cells = _cells(rest)
            _assign(kind, key, rest, cells, rows, n, warnings)
            break
    if kind == "module":
        for r in rows:
            if r.get("dimensions"):
                d = _nums(r.pop("dimensions"))
                if len(d) >= 2:
                    r["length_mm"], r["width_mm"] = d[0], d[1]
                    if len(d) >= 3:
                        r["thickness_mm"] = d[2]
            if r.get("bifaciality") and r["bifaciality"] > 1:
                r["bifaciality"] = r["bifaciality"] / 100
            if r.get("wp") is None and re.search(r"\d{3}", r["model"]):
                pass
    if sum("values for" in w for w in warnings) >= 3:
        warnings.insert(0, "This PDF's text layer is jumbled (several values couldn't be matched to "
                           "models), so the text reader isn't reliable here. The Claude reader reads "
                           "the page itself and handles this file; otherwise enter values by hand.")
    return ExtractResult(rows, "text", warnings)


def _assign(kind, key, rest, cells, rows, n, warnings):
    def spread(values, target):
        if len(values) == n:
            for r, v in zip(rows, values):
                r[target] = v
        elif len(values) == 1:
            for r in rows:
                r[target] = values[0]
        else:
            label = next((f.label for f in FIELDS[kind] if f.key == target), target)
            warnings.append(f"{label}: found {len(values)} values for {n} models, so it was left blank.")

    if key == "min_start":
        v = _nums(rest)
        if len(v) >= 2:
            for r in rows:
                r["min_dc_v"], r["start_v"] = v[0], v[1]
                r.setdefault("mppt_min_v", v[0])
    elif key == "mppt_range":
        v = _nums(rest)
        if len(v) >= 2:
            for r in rows:
                r["mppt_min_v"], r["mppt_max_v"] = v[0], v[1]
    elif key == "eff_pair":
        v = _nums(rest)
        if len(v) == 2 * n or len(v) == 2:
            pairs = [v[i:i + 2] for i in range(0, len(v), 2)]
            spread([p[0] for p in pairs], "max_eff_pct")
            spread([p[1] for p in pairs], "euro_eff_pct")
    elif key in ("mppt_currents", "mppt_iscs"):
        vals = [_per_mppt(c) for c in cells] if len(cells) == n and n > 1 else [_per_mppt(rest)]
        spread([v for v in vals if v], key)
    elif key == "mppt_strings":
        vals = [re.sub(r"\s+", "", c) for c in cells if re.search(r"\d", c)]
        spread(vals, key)
    elif key in ("ac_voltage", "dimensions", "ip_rating", "topology"):
        spread([rest.strip()] if len(cells) <= 1 or key != "dimensions" else [cells[0]], key)
    elif key in ("ac_kw", "max_ac_kva", "max_dc_kw") and "@" in rest and n == 1:
        # temperature-dependent rating, e.g. "352 kVA @ 30 ℃ / 320 kVA @ 40 ℃"
        pairs = [(float(v), float(t)) for v, t in
                 re.findall(rf"({NUM})\s*k?V?A?W?\s*@\s*({NUM})\s*[℃°]", rest)]
        if pairs:
            chosen = max(pairs)[0] if key == "max_ac_kva" else min(pairs, key=lambda p: abs(p[1] - 42))[0]
            spread([chosen], key)
            for r in rows:
                r["notes"] = ((r.get("notes") or "") + f" Power rating: {rest.strip()}.").strip()
    elif key in ("ac_kw", "max_ac_kva", "max_dc_kw"):
        vals = []
        for c in cells:
            nums = _nums(c)
            if not nums:
                continue
            v = nums[0]
            if re.search(r"\d\s*(W|VA)\b", c) and not re.search(r"k(W|VA)", c):
                v /= 1000
            vals.append(v)
        spread(vals, key)
    elif key == "phases":
        v = _nums(rest)
        if v:
            spread([int(v[0])], key)
    else:
        vals = []
        for c in cells:
            nums = _nums(c)
            if nums:
                vals.append(nums[0])
        spread(vals, key)


# --------------------------------------------------------------------------------------
# Sanity checks (shown on the review screen)
# --------------------------------------------------------------------------------------

def check(kind: str, row: dict) -> list[str]:
    w = []
    g = row.get
    if kind == "module":
        if g("voc") and g("vmp") and g("voc") <= g("vmp"):
            w.append("Voc should be higher than Vmp.")
        if g("isc") and g("imp") and g("isc") <= g("imp"):
            w.append("Isc should be higher than Imp.")
        if g("vmp") and g("imp") and g("wp"):
            p = g("vmp") * g("imp")
            if abs(p - g("wp")) / g("wp") > 0.03:
                w.append(f"Vmp × Imp = {p:.0f} W, which doesn't match {g('wp'):g} Wp.")
        if g("tc_voc_pct") is not None and not -0.6 < g("tc_voc_pct") < 0:
            w.append("Voc temperature coefficient should be negative, around -0.2 to -0.35 %/°C.")
        if g("tc_pmax_pct") is not None and not -0.6 < g("tc_pmax_pct") < 0:
            w.append("Pmax temperature coefficient should be negative, around -0.25 to -0.40 %/°C.")
        if g("tc_isc_pct") is not None and not 0 < g("tc_isc_pct") < 0.2:
            w.append("Isc temperature coefficient should be small and positive (about 0.04-0.06 %/°C).")
        if g("bifaciality") is not None and not 0 < g("bifaciality") <= 1:
            w.append("Bifaciality should be a fraction between 0 and 1.")
        for k in ("voc", "isc", "vmp", "imp", "tc_voc_pct"):
            if g(k) is None:
                w.append(f"Missing {k}: needed for string sizing.")
                break
    else:
        if g("mppt_min_v") and g("mppt_max_v") and g("mppt_min_v") >= g("mppt_max_v"):
            w.append("MPPT minimum must be below the maximum.")
        if g("mppt_max_v") and g("max_dc_v") and g("mppt_max_v") > g("max_dc_v"):
            w.append("MPPT maximum is above the max. input voltage.")
        if g("ac_kw") and g("max_ac_kva") and g("max_ac_kva") < g("ac_kw") * 0.99:
            w.append("Max. apparent power is below the rated power.")
        nm = g("num_mppt")
        for k in ("mppt_strings", "mppt_currents", "mppt_iscs"):
            vals = split_list(g(k))
            if nm and len(vals) > 1 and len(vals) != nm:
                w.append(f"{k.replace('_', ' ')} lists {len(vals)} values but there are {nm} MPPTs.")
        cur, isc = split_list(g("mppt_currents")), split_list(g("mppt_iscs"))
        if cur and isc and len(cur) == len(isc) and any(i < c for c, i in zip(cur, isc)):
            w.append("Short-circuit current per MPPT should be at least the operating current.")
        if g("ac_kw") and g("max_dc_kw") and g("max_dc_kw") / g("ac_kw") > 2:
            w.append("Recommended max. PV power is more than twice the AC rating; please check.")
        for k in ("max_dc_v", "mppt_min_v", "mppt_max_v", "num_mppt", "mppt_currents"):
            if not g(k):
                w.append(f"Missing {k.replace('_', ' ')}: needed for string sizing.")
                break
    return w


def to_json(models: list[dict]) -> str:
    return json.dumps(models, ensure_ascii=False)
