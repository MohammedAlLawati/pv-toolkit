"""Jinko Solar modules, checked against the datasheets in ./datasheets."""
from __future__ import annotations

TIGER_NEO_66HL5 = "Tiger_Neo_JKM710-735N-66HL5-BDV-Z3-EN.pdf"

_TN66 = dict(make="Jinko Solar", technology="N-type TOPCon bifacial, dual glass", cells=132,
             power_tolerance="0~+3%", tc_voc_pct=-0.25, tc_isc_pct=0.045, tc_pmax_pct=-0.29,
             bifaciality=0.80, max_system_v=1500, max_fuse_a=35, length_mm=2384, width_mm=1303,
             thickness_mm=33, weight_kg=37.5, datasheet=TIGER_NEO_66HL5,
             notes="Ships with JK03M connectors (MC4 / MC4-EVO2 on request): fit matching "
                   "connectors at the inverter. Bifaciality 80 ± 5 %. NOCT not on the datasheet.")

# (Wp, Vmp, Imp, Voc, Isc, efficiency %) from the STC table
_TN66_ROWS = [(710, 40.65, 17.47, 48.73, 18.53, 22.86), (715, 40.77, 17.54, 48.88, 18.60, 23.02),
              (720, 40.89, 17.61, 49.04, 18.67, 23.18), (725, 41.00, 17.69, 49.20, 18.74, 23.34),
              (730, 41.11, 17.76, 49.36, 18.81, 23.50), (735, 41.23, 17.83, 49.52, 18.88, 23.66)]

MODULES = [dict(_TN66, model=f"JKM{wp}N-66HL5-BDV", wp=wp, vmp=vmp, imp=imp, voc=voc, isc=isc,
                efficiency_pct=eff) for wp, vmp, imp, voc, isc, eff in _TN66_ROWS]
