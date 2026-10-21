"""String and inverter sizing: the rules check and the design recommender.

Everything here is plain calculation on a `Design`, so it can be tested without a database
and reused by the yield report (Phase 3).

Temperature model
- Cold: the cell is at the design minimum ambient (dawn, little irradiance).
- Hot: cell = max. ambient + (NOCT − 20) / 800 × irradiance.
- Vmp coefficient: datasheets rarely give one. We use Pmax coefficient − Isc coefficient
  (Pmp = Vmp × Imp and Imp moves roughly like Isc), or the Voc coefficient when Pmax is
  missing. That is more negative than the Voc coefficient, so it errs on the safe side for
  both the MPPT-minimum and MPPT-maximum checks.
"""
from __future__ import annotations

import math
from dataclasses import dataclass, field

from ..equipment_fields import split_list
from .rules import RULE_BY_KEY, Settings

COPPER_RHO = 0.0217          # Ω·mm²/m, copper at about 70 °C
DC_SIZES = [4, 6, 10, 16]
AC_SIZES = [4, 6, 10, 16, 25, 35, 50, 70, 95, 120, 150, 185, 240, 300]


@dataclass
class Design:
    module: object | None
    inverter: object | None
    inverter_qty: int | None
    module_count: int | None
    strings: int | None
    phases: int = 3
    mppt_layout: str = ""            # strings per MPPT on each inverter, e.g. "2/1"; blank = automatic
    t_min_c: float | None = None     # project overrides; None = profile value
    t_max_c: float | None = None
    hv_connectors: bool = False      # connectors rated above the inverter's standard-connector limit
    connection_limit_kw: float | None = None
    dc_cable_m: float | None = None  # one-way string cable length
    dc_cable_mm2: float | None = None
    ac_cable_m: float | None = None
    ac_cable_mm2: float | None = None

    @classmethod
    def from_project(cls, p) -> "Design":
        return cls(module=p.module, inverter=p.inverter, inverter_qty=p.inverter_qty,
                   module_count=p.module_count, strings=p.strings, phases=p.phases,
                   mppt_layout=p.mppt_layout or "", t_min_c=p.t_min_c, t_max_c=p.t_max_c,
                   hv_connectors=bool(p.hv_connectors), connection_limit_kw=p.connection_limit_kw,
                   dc_cable_m=p.dc_cable_m, dc_cable_mm2=p.dc_cable_mm2,
                   ac_cable_m=p.ac_cable_m, ac_cable_mm2=p.ac_cable_mm2)


@dataclass
class Check:
    key: str
    status: str          # pass | warn | fail | unknown
    detail: str
    value: str = ""
    limit: str = ""

    @property
    def label(self) -> str:
        return RULE_BY_KEY[self.key].label


@dataclass
class MpptRow:
    index: int
    strings: int
    connectors: int | None
    isc: float | None          # design short-circuit current on this MPPT
    isc_limit: float | None
    imp: float | None          # operating current
    imp_limit: float | None


@dataclass
class InverterGroup:
    count: int                 # inverters with this layout
    strings: int               # strings per inverter
    mppts: list[MpptRow]
    overflow: int = 0          # strings that don't fit on the inputs
    dc_kwp: float | None = None


@dataclass
class Result:
    checks: list[Check] = field(default_factory=list)
    groups: list[InverterGroup] = field(default_factory=list)
    temps: dict = field(default_factory=dict)
    string: dict = field(default_factory=dict)       # string voltages / currents
    string_range: tuple[int, int] | None = None      # allowed modules per string
    modules_per_string: int | None = None
    dc_kwp: float | None = None
    ac_kw: float | None = None
    ratio: float | None = None
    cables: dict = field(default_factory=dict)
    notes: list[str] = field(default_factory=list)

    def _with(self, status):
        return [c for c in self.checks if c.status == status]

    @property
    def fails(self):
        return self._with("fail")

    @property
    def warnings(self):
        return self._with("warn")

    @property
    def unknown(self):
        return self._with("unknown")

    @property
    def blocked(self) -> bool:
        """True when a hard rule fails or can't be checked: reports must not be printed."""
        return bool(self.fails or self.unknown)

    @property
    def status(self) -> str:
        if self.fails:
            return "fail"
        if self.unknown:
            return "incomplete"
        return "warn" if self.warnings else "pass"


# ---- helpers ---------------------------------------------------------------------------

def _n(v, dp=1):
    return "—" if v is None else f"{v:,.{dp}f}"


def tc_vmp_pct(m) -> float | None:
    if m.tc_pmax_pct is not None and m.tc_isc_pct is not None:
        return m.tc_pmax_pct - m.tc_isc_pct
    return m.tc_voc_pct


def temperatures(d: Design, s: Settings, m=None) -> dict:
    t_min = d.t_min_c if d.t_min_c is not None else s.t_min_c
    t_max = d.t_max_c if d.t_max_c is not None else s.t_max_c
    noct = (m.noct_c if m is not None and m.noct_c else None) or s.default_noct
    return {"t_min": t_min, "t_max": t_max, "noct": noct,
            "cell_cold": t_min, "cell_hot": t_max + (noct - 20) / 800 * s.hot_irradiance}


def module_values(m, t: dict, s: Settings) -> dict:
    """Per-module voltages at the design temperatures and design currents."""
    tv = m.tc_voc_pct / 100
    tm = (tc_vmp_pct(m) or m.tc_voc_pct) / 100
    gain = 1 + (m.bifaciality or 0) * s.bifacial_gain
    return {
        "voc_cold": m.voc * (1 + tv * (t["cell_cold"] - 25)),
        "vmp_cold": m.vmp * (1 + tm * (t["cell_cold"] - 25)),
        "vmp_hot": m.vmp * (1 + tm * (t["cell_hot"] - 25)),
        "isc_design": m.isc * gain * s.isc_factor,
        "imp_design": m.imp * gain,
        "vmp": m.vmp, "imp": m.imp,
    }


def mppt_limits(inv) -> list[dict]:
    n = inv.num_mppt or 0

    def per(lst, single):
        vals = split_list(lst)
        if not vals and single is not None:
            vals = [single]
        if len(vals) == 1 and n > 1:
            vals = vals * n
        return (vals + [None] * n)[:n]

    conns, imps, iscs = (per(inv.mppt_strings, inv.strings_per_mppt),
                         per(inv.mppt_currents, inv.max_current_per_mppt),
                         per(inv.mppt_iscs, inv.max_isc_per_mppt))
    return [{"connectors": int(c) if c else None, "imp": i, "isc": sc}
            for c, i, sc in zip(conns, imps, iscs)]


def _enabled(s: Settings, key: str) -> bool:
    return s.severity.get(key, "off") != "off"


def mppt_caps(lims: list[dict], mv: dict, s: Settings, electrical: bool = True) -> list[int]:
    """How many strings each MPPT can take under the enabled rules."""
    caps = []
    for lim in lims:
        cap = lim["connectors"] if lim["connectors"] else 99
        if electrical and _enabled(s, "isc_mppt") and lim["isc"]:
            cap = min(cap, math.floor(lim["isc"] / mv["isc_design"] + 1e-9))
        if electrical and _enabled(s, "imp_mppt") and lim["imp"]:
            cap = min(cap, math.floor(lim["imp"] / mv["imp_design"] + 1e-9))
        caps.append(max(cap, 0))
    return caps


def allocate(n: int, caps: list[int]) -> tuple[list[int], int]:
    """Spread n strings over the MPPTs, keeping them as evenly filled as possible."""
    alloc = [0] * len(caps)
    for _ in range(n):
        open_ = [i for i in range(len(caps)) if alloc[i] < caps[i]]
        if not open_:
            break
        i = min(open_, key=lambda j: (alloc[j] / caps[j], j))
        alloc[i] += 1
    return alloc, n - sum(alloc)


def string_range(m, inv, mv: dict, s: Settings, hv_connectors: bool) -> tuple[int, int] | None:
    """Allowed modules per string under the enabled voltage rules (None if no length fits)."""
    hi, lo = 10_000, 1
    if _enabled(s, "voc_max") and inv.max_dc_v:
        hi = min(hi, math.floor(inv.max_dc_v / mv["voc_cold"]))
    if _enabled(s, "voc_module") and m.max_system_v:
        hi = min(hi, math.floor(m.max_system_v / mv["voc_cold"]))
    if _enabled(s, "voc_connector") and inv.connector_limit_v and not hv_connectors:
        hi = min(hi, math.floor(inv.connector_limit_v / mv["voc_cold"]))
    if _enabled(s, "vmp_max") and inv.mppt_max_v:
        hi = min(hi, math.floor(inv.mppt_max_v / mv["vmp_cold"]))
    if _enabled(s, "vmp_min") and inv.mppt_min_v:
        lo = max(lo, math.ceil(inv.mppt_min_v / mv["vmp_hot"]))
    return (lo, hi) if lo <= hi and hi < 10_000 else None


def _vdrop_dc(length, mm2, i, v):
    return 2 * length * i * COPPER_RHO / mm2 / v * 100


def _vdrop_ac(length, mm2, kw, phases):
    if phases == 1:
        i = kw * 1000 / 230
        return 2 * length * i * COPPER_RHO / mm2 / 230 * 100, i
    i = kw * 1000 / (math.sqrt(3) * 400)
    return math.sqrt(3) * length * i * COPPER_RHO / mm2 / 400 * 100, i


# ---- the rules check ---------------------------------------------------------------------

def check(d: Design, s: Settings) -> Result:
    r = Result()
    m, inv = d.module, d.inverter

    def add(key, ok, detail, value="", limit=""):
        sev = s.severity.get(key, RULE_BY_KEY[key].default)
        if sev == "off":
            return
        if ok is None:
            status = "unknown" if sev == "hard" else "warn"
        elif ok:
            status = "pass"
        else:
            status = "fail" if sev == "hard" else "warn"
        r.checks.append(Check(key, status, detail, value, limit))

    # capacities
    if m and d.module_count:
        r.dc_kwp = m.wp * d.module_count / 1000
    if inv and d.inverter_qty:
        r.ac_kw = inv.ac_kw * d.inverter_qty
    if r.dc_kwp and r.ac_kw:
        r.ratio = r.dc_kwp / r.ac_kw
    if inv and inv.notes:
        r.notes.append(f"{inv.make} {inv.model}: {inv.notes}")

    # data
    missing = []
    if not m:
        missing.append("module")
    elif not m.sizing_ready:
        missing.append(f"module {m.model}: " + ", ".join(
            k for k, v in (("Voc", m.voc), ("Isc", m.isc), ("Vmp", m.vmp), ("Imp", m.imp),
                           ("Voc temp. coefficient", m.tc_voc_pct)) if v is None))
    if not inv:
        missing.append("inverter")
    elif not inv.sizing_ready:
        missing.append(f"inverter {inv.model}: " + ", ".join(
            k for k, v in (("max. DC voltage", inv.max_dc_v), ("MPPT min.", inv.mppt_min_v),
                           ("MPPT max.", inv.mppt_max_v), ("number of MPPTs", inv.num_mppt),
                           ("current per MPPT", inv.mppt_currents or inv.max_current_per_mppt))
            if v is None))
    for k, lab in (("module_count", "number of modules"), ("strings", "number of strings"),
                   ("inverter_qty", "inverter quantity")):
        if not getattr(d, k):
            missing.append(lab)
    add("data", None if missing else True, "Missing: " + "; ".join(missing) if missing else "All values present.")
    _ac_checks(d, s, r, add)
    if missing:
        return r

    # string length and layout
    lims = mppt_limits(inv)
    layout = [int(x) for x in split_list(d.mppt_layout)] if d.mppt_layout.strip() else None
    split_ok = d.module_count % d.strings == 0
    L = d.module_count // d.strings if split_ok else None
    r.modules_per_string = L
    if not split_ok:
        problem = f"{d.module_count} modules don't divide evenly into {d.strings} strings."
    elif d.strings < d.inverter_qty:
        problem = f"{d.inverter_qty} inverters need at least one string each."
    elif layout and len(layout) > len(lims):
        problem = f"The MPPT layout lists {len(layout)} MPPTs; the {inv.model} has {len(lims)}."
    elif layout and sum(layout) * d.inverter_qty != d.strings:
        problem = (f"The layout {d.mppt_layout} puts {sum(layout)} strings on each of {d.inverter_qty} "
                   f"inverter(s) = {sum(layout) * d.inverter_qty}, but the project has {d.strings}.")
    else:
        problem = ""
    add("string_split", not problem, problem or f"{d.strings} strings of {L} modules.")
    if problem:
        return r

    t = temperatures(d, s, m)
    mv = module_values(m, t, s)
    r.temps = t
    sv = {k: v * L for k, v in mv.items() if k.startswith(("voc", "vmp"))}
    sv.update(isc_design=mv["isc_design"], imp_design=mv["imp_design"], vmp=mv["vmp"] * L)
    r.string = sv
    r.string_range = string_range(m, inv, mv, s, d.hv_connectors)
    tmin = f"{t['t_min']:g} °C"

    # voltages
    add("voc_max", sv["voc_cold"] <= inv.max_dc_v, f"Voc at {tmin}: {_n(sv['voc_cold'])} V.",
        f"{_n(sv['voc_cold'])} V", f"{inv.max_dc_v:g} V")
    if m.max_system_v:
        add("voc_module", sv["voc_cold"] <= m.max_system_v, f"Module rated {m.max_system_v:g} V.",
            f"{_n(sv['voc_cold'])} V", f"{m.max_system_v:g} V")
    if inv.connector_limit_v:
        over = sv["voc_cold"] > inv.connector_limit_v
        add("voc_connector", not over or d.hv_connectors,
            (f"Above {inv.connector_limit_v:g} V: fit connectors rated for it (e.g. MC4 Evo2) and tick "
             "'High-voltage connectors' on the project." if over and not d.hv_connectors else
             "High-voltage connectors fitted." if over else "Within the standard connector limit."),
            f"{_n(sv['voc_cold'])} V", f"{inv.connector_limit_v:g} V")
    add("vmp_min", sv["vmp_hot"] >= inv.mppt_min_v,
        f"Vmp at {t['cell_hot']:.0f} °C cell temperature: {_n(sv['vmp_hot'])} V.",
        f"{_n(sv['vmp_hot'])} V", f"{inv.mppt_min_v:g} V")
    add("vmp_max", sv["vmp_cold"] <= inv.mppt_max_v, f"Vmp at {tmin}: {_n(sv['vmp_cold'])} V.",
        f"{_n(sv['vmp_cold'])} V", f"{inv.mppt_max_v:g} V")
    add("voc_standby", sv["voc_cold"] <= inv.mppt_max_v,
        "Fine." if sv["voc_cold"] <= inv.mppt_max_v else
        "The inverter may wait in standby on cold mornings until the voltage falls.",
        f"{_n(sv['voc_cold'])} V", f"{inv.mppt_max_v:g} V")
    if inv.start_v:
        add("start_v", sv["vmp_hot"] >= inv.start_v, f"Start-up voltage {inv.start_v:g} V.",
            f"{_n(sv['vmp_hot'])} V", f"{inv.start_v:g} V")

    # strings over inverters and MPPTs
    if layout:
        groups_spec = [(d.inverter_qty, sum(layout))]
    else:
        base, extra = divmod(d.strings, d.inverter_qty)
        groups_spec = [(c, n) for c, n in ((d.inverter_qty - extra, base), (extra, base + 1)) if c]

    caps_e = mppt_caps(lims, mv, s, electrical=True)
    caps_c = mppt_caps(lims, mv, s, electrical=False)
    for count, n in groups_spec:
        if layout:
            alloc, overflow = (layout + [0] * len(lims))[:len(lims)], 0
        else:
            alloc, overflow = allocate(n, caps_e)
            if overflow:  # can't satisfy every limit: fill the connectors and let the checks say why
                alloc, overflow = allocate(n, caps_c)
        rows = [MpptRow(i + 1, a, lim["connectors"], a * mv["isc_design"] if a else 0, lim["isc"],
                        a * mv["imp_design"] if a else 0, lim["imp"]) for i, (a, lim) in enumerate(zip(alloc, lims))]
        r.groups.append(InverterGroup(count, n, rows, overflow, n * L * m.wp / 1000))

    def worst(attr, lim_attr):
        bad = [(g, row) for g in r.groups for row in g.mppts
               if getattr(row, lim_attr) and getattr(row, attr) > getattr(row, lim_attr) + 1e-9]
        return bad

    over_conn = [(g, row) for g in r.groups for row in g.mppts if row.connectors and row.strings > row.connectors]
    overflow = sum(g.overflow for g in r.groups)
    add("strings_mppt", not over_conn and not overflow,
        (f"{overflow} string(s) per inverter have no free input." if overflow else
         "; ".join(f"MPPT {row.index}: {row.strings} strings on {row.connectors} inputs" for _, row in over_conn)
         if over_conn else "Every string has an input."))
    if any(row.isc_limit for g in r.groups for row in g.mppts):
        bad = worst("isc", "isc_limit")
        add("isc_mppt", not bad,
            "; ".join(f"MPPT {row.index}: {row.strings} × {mv['isc_design']:.1f} A = {row.isc:.1f} A > {row.isc_limit:g} A"
                      for _, row in bad) or f"{mv['isc_design']:.2f} A per string incl. factor {s.isc_factor:g}.")
    if any(row.imp_limit for g in r.groups for row in g.mppts):
        bad = worst("imp", "imp_limit")
        add("imp_mppt", not bad,
            "; ".join(f"MPPT {row.index}: {row.imp:.1f} A > {row.imp_limit:g} A" for _, row in bad)
            or f"{mv['imp_design']:.2f} A per string.")
    if inv.max_connector_current_a:
        add("connector_current", mv["isc_design"] <= inv.max_connector_current_a,
            "Per string.", f"{mv['isc_design']:.1f} A", f"{inv.max_connector_current_a:g} A")
    if m.max_fuse_a:
        par = max((row.strings for g in r.groups for row in g.mppts), default=0)
        reverse = (par - 1) * m.isc * s.isc_factor
        add("fuses", par < 3 or reverse <= m.max_fuse_a,
            f"Up to {par} strings in parallel on one MPPT." + (
                f" Reverse current {reverse:.1f} A exceeds the module's {m.max_fuse_a:g} A fuse rating: "
                "string fuses are needed unless the inverter has them." if par >= 3 and reverse > m.max_fuse_a else ""))
    if inv.max_dc_kw:
        worst_dc = max(g.dc_kwp for g in r.groups)
        add("dc_power", worst_dc <= inv.max_dc_kw + 1e-9, "Per inverter.",
            f"{worst_dc:,.2f} kWp", f"{inv.max_dc_kw:g} kWp")
    if r.ratio:
        add("dcac_band", s.dcac_min <= r.ratio <= s.dcac_max, "Whole system.",
            f"{r.ratio:.2f}", f"{s.dcac_min:g}–{s.dcac_max:g}")

    _cable_checks(d, s, r, add, sv, mv)
    return r


def _ac_checks(d: Design, s: Settings, r: Result, add) -> None:
    inv = d.inverter
    if inv:
        add("phase_match", inv.phases == d.phases,
            f"Inverter {inv.phases}-phase, connection {d.phases}-phase.")
    if r.ac_kw is None:
        return
    if d.connection_limit_kw:
        add("ac_connection", r.ac_kw <= d.connection_limit_kw + 1e-9, "Limit entered on the project.",
            f"{r.ac_kw:,.2f} kW", f"{d.connection_limit_kw:g} kW")
    if s.max_ac_kw:
        add("ac_profile", r.ac_kw <= s.max_ac_kw + 1e-9, "Rule profile limit.",
            f"{r.ac_kw:,.2f} kW", f"{s.max_ac_kw:g} kW")
    if d.phases == 1 and s.single_phase_max_kw:
        add("single_phase", r.ac_kw <= s.single_phase_max_kw + 1e-9, "Rule profile limit.",
            f"{r.ac_kw:,.2f} kW", f"{s.single_phase_max_kw:g} kW")


def _cable_checks(d: Design, s: Settings, r: Result, add, sv, mv) -> None:
    if d.dc_cable_m:
        i, v = mv["imp_design"], sv["vmp"]
        rec = next((a for a in DC_SIZES if _vdrop_dc(d.dc_cable_m, a, i, v) <= s.dc_vdrop_max_pct), None)
        r.cables["dc_recommended"] = rec
        if d.dc_cable_mm2:
            drop = _vdrop_dc(d.dc_cable_m, d.dc_cable_mm2, i, v)
            r.cables["dc_drop"] = drop
            add("vdrop_dc", drop <= s.dc_vdrop_max_pct,
                f"{d.dc_cable_m:g} m of {d.dc_cable_mm2:g} mm² per string."
                + (f" {rec} mm² would meet the limit." if rec and drop > s.dc_vdrop_max_pct else ""),
                f"{drop:.2f} %", f"{s.dc_vdrop_max_pct:g} %")
    if d.ac_cable_m and r.ac_kw:
        rec = next((a for a in AC_SIZES if _vdrop_ac(d.ac_cable_m, a, r.ac_kw, d.phases)[0] <= s.ac_vdrop_max_pct), None)
        r.cables["ac_recommended"] = rec
        r.cables["ac_current"] = _vdrop_ac(d.ac_cable_m, 1, r.ac_kw, d.phases)[1]
        if d.ac_cable_mm2:
            drop, _ = _vdrop_ac(d.ac_cable_m, d.ac_cable_mm2, r.ac_kw, d.phases)
            r.cables["ac_drop"] = drop
            add("vdrop_ac", drop <= s.ac_vdrop_max_pct,
                f"{d.ac_cable_m:g} m of {d.ac_cable_mm2:g} mm² at full AC output."
                + (f" {rec} mm² would meet the limit." if rec and drop > s.ac_vdrop_max_pct else ""),
                f"{drop:.2f} %", f"{s.ac_vdrop_max_pct:g} %")


# ---- recommendations -----------------------------------------------------------------------

@dataclass
class Option:
    inverter: object
    inverter_qty: int
    modules_per_string: int
    strings: int
    result: Result
    score: float

    @property
    def module_count(self):
        return self.strings * self.modules_per_string


def recommend(base: Design, inverters: list, s: Settings, target_kind: str, target: float,
              limit: int = 6) -> list[Option]:
    """Best designs for a target, one per inverter model and quantity.

    target_kind: "dc" (kWp), "ac" (kW) or "modules" (most modules that fit, e.g. a roof count).
    Only designs that pass every hard rule are returned.
    """
    m = base.module
    if not m or not m.sizing_ready or not target or target <= 0:
        return []
    if target_kind == "ac":
        dc_target = target * s.dcac_target
    elif target_kind == "modules":
        dc_target = target * m.wp / 1000
    else:
        dc_target = target
    n_target = dc_target * 1000 / m.wp

    best: dict[tuple, Option] = {}
    for inv in inverters:
        if not inv.sizing_ready or inv.phases != base.phases:
            continue
        t = temperatures(base, s, m)
        mv = module_values(m, t, s)
        rng = string_range(m, inv, mv, s, base.hv_connectors)
        if not rng:
            continue
        per_inv_max = sum(mppt_caps(mppt_limits(inv), mv, s))
        if per_inv_max <= 0:
            continue
        if target_kind == "ac":
            qs = {max(1, math.floor(target / inv.ac_kw)), max(1, math.ceil(target / inv.ac_kw - 1e-9))}
        else:
            q_lo = max(1, math.ceil(dc_target / (inv.ac_kw * s.dcac_max) - 1e-9))
            q_hi = max(q_lo, math.floor(dc_target / (inv.ac_kw * s.dcac_min) + 1e-9))
            qs = set(range(q_lo, min(q_hi, q_lo + 40) + 1))
        for q in sorted(qs):
            for L in range(rng[0], rng[1] + 1):
                s0 = n_target / L
                for S in {math.floor(s0), math.ceil(s0)}:
                    if S < q or S > q * per_inv_max:
                        continue
                    if target_kind == "modules" and S * L > target:
                        continue
                    d = Design(**{**base.__dict__, "inverter": inv, "inverter_qty": q,
                                  "module_count": S * L, "strings": S, "mppt_layout": ""})
                    res = check(d, s)
                    if res.blocked:
                        continue
                    score = (3 * abs(res.dc_kwp - dc_target) / dc_target
                             + abs(res.ratio - s.dcac_target) / s.dcac_target
                             + 0.05 * len(res.warnings) + 0.1 * math.log(q) + 0.002 * (rng[1] - L))
                    if not s.dcac_min <= res.ratio <= s.dcac_max:
                        score += 0.5
                    if target_kind == "ac":
                        score += 3 * abs(res.ac_kw - target) / target
                    key = (getattr(inv, "id", None) or id(inv), q)
                    if key not in best or score < best[key].score:
                        best[key] = Option(inv, q, L, S, res, score)
    return sorted(best.values(), key=lambda o: o.score)[:limit]
