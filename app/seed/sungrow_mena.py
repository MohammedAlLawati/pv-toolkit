"""Sungrow MENA inverter range, entered by hand from the datasheets in ./datasheets.

Values were read from the datasheet tables (not the text layer) and cross-checked.
"""
from __future__ import annotations

RT_FILE_SMALL = "DS_20231113_SG5.0_6.0_7.0_8.0_10_12RT-P2_Datasheet_V2_EN.pdf"
RT_FILE_LARGE = "DS_20231113_SG15_17_20RT-P2_Datasheet_V2_EN.pdf"
CX_FILE_33 = "DS_20240709_SG25_30_33CX-P2_Datasheet_V5_EN.pdf"
CX_FILE_50 = "DS_20240709_SG36_40_50CX-P2_Datasheet_V5_EN.pdf"
CX_FILE_125 = "DS_20240709_SG125CX-P2_Datasheet_V6_EN.pdf"
CX_FILE_150 = "DS_20241106_SG150CX_Datasheet_V4_EN.pdf"
HX_FILE_320 = "DS_20231209_SG320HX-20_Datasheet_V5_EN.pdf"

_RT = dict(make="Sungrow", category="residential", phases=3, ac_voltage="3/N/PE, 230/400 V",
           internal_transformer=False, topology="Transformerless", max_dc_v=1100, min_dc_v=160,
           start_v=180, rated_input_v=600, mppt_min_v=160, mppt_max_v=1000, num_mppt=2,
           max_eff_pct=98.3, dimensions="370 × 480 × 195", ip_rating="IP65",
           notes="Inverter goes to standby between 1000 V and 1100 V DC. If the max. system DC "
                 "voltage exceeds 1000 V, MC4 Evo2 connectors must be used (the supplied MC4 "
                 "connectors may not).")
_RT_SMALL = dict(_RT, mppt_strings="1/1", mppt_currents="16/16", mppt_iscs="20/20", weight_kg=18)
_RT_MID = dict(_RT, mppt_strings="2/1", mppt_currents="32/16", mppt_iscs="40/20", weight_kg=18)
_RT_LARGE = dict(_RT, mppt_strings="2/2", mppt_currents="32/32", mppt_iscs="40/40", weight_kg=22)

_CX = dict(make="Sungrow", category="commercial", phases=3, ac_voltage="3/N/PE, 230/400 V",
           internal_transformer=False, topology="Transformerless", max_dc_v=1100, min_dc_v=160,
           start_v=200, rated_input_v=600, mppt_min_v=160, mppt_max_v=1000,
           max_connector_current_a=30, dimensions="645 × 575 × 245", ip_rating="IP66")
_CX33 = dict(_CX, num_mppt=3, mppt_strings="2/2/2", mppt_currents="30/30/30", mppt_iscs="40/40/40",
             weight_kg=38)
_CX50 = dict(_CX, num_mppt=4, mppt_strings="2/2/2/2", mppt_currents="30/30/30/30",
             mppt_iscs="40/40/40/40", max_eff_pct=98.5, euro_eff_pct=98.3)

INVERTERS = [
    # ---- residential (3-phase RT-P2) ----
    dict(_RT_SMALL, model="SG5.0RT-P2", ac_kw=5, max_ac_kva=5.5, max_ac_current_a=8.3, max_dc_kw=7.5,
         euro_eff_pct=97.2, datasheet=RT_FILE_SMALL),
    dict(_RT_SMALL, model="SG6.0RT-P2", ac_kw=6, max_ac_kva=6.6, max_ac_current_a=10.0, max_dc_kw=9.0,
         euro_eff_pct=97.4, datasheet=RT_FILE_SMALL),
    dict(_RT_MID, model="SG7.0RT-P2", ac_kw=7, max_ac_kva=7.7, max_ac_current_a=11.7, max_dc_kw=10.5,
         euro_eff_pct=97.6, datasheet=RT_FILE_SMALL),
    dict(_RT_MID, model="SG8.0RT-P2", ac_kw=8, max_ac_kva=8.8, max_ac_current_a=13.3, max_dc_kw=12,
         euro_eff_pct=97.7, datasheet=RT_FILE_SMALL),
    dict(_RT_MID, model="SG10RT-P2", ac_kw=10, max_ac_kva=11, max_ac_current_a=16.7, max_dc_kw=15,
         euro_eff_pct=97.8, datasheet=RT_FILE_SMALL),
    dict(_RT_MID, model="SG12RT-P2", ac_kw=12, max_ac_kva=13.2, max_ac_current_a=20.0, max_dc_kw=18,
         euro_eff_pct=97.9, datasheet=RT_FILE_SMALL),
    dict(_RT_LARGE, model="SG15RT-P2", ac_kw=15, max_ac_kva=16.5, max_ac_current_a=25.0, max_dc_kw=22.5,
         euro_eff_pct=97.9, datasheet=RT_FILE_LARGE),
    dict(_RT_LARGE, model="SG17RT-P2", ac_kw=17, max_ac_kva=18.7, max_ac_current_a=28.3, max_dc_kw=25.5,
         euro_eff_pct=97.9, datasheet=RT_FILE_LARGE),
    dict(_RT_LARGE, model="SG20RT-P2", ac_kw=20, max_ac_kva=22, max_ac_current_a=31.9, max_dc_kw=30,
         euro_eff_pct=97.9, datasheet=RT_FILE_LARGE),
    # ---- commercial & industrial (CX) ----
    dict(_CX33, model="SG25CX-P2", ac_kw=25, max_ac_kva=27.5, max_ac_current_a=41.8, max_dc_kw=35,
         max_eff_pct=98.4, euro_eff_pct=98.2, datasheet=CX_FILE_33),
    dict(_CX33, model="SG30CX-P2", ac_kw=30, max_ac_kva=33, max_ac_current_a=50.2, max_dc_kw=42,
         max_eff_pct=98.5, euro_eff_pct=98.3, datasheet=CX_FILE_33),
    dict(_CX33, model="SG33CX-P2", ac_kw=33, max_ac_kva=36.3, max_ac_current_a=55.2, max_dc_kw=46.2,
         max_eff_pct=98.5, euro_eff_pct=98.3, datasheet=CX_FILE_33),
    dict(_CX50, model="SG36CX-P2", ac_kw=36, max_ac_kva=40, max_ac_current_a=60.2, max_dc_kw=50.4,
         weight_kg=40, datasheet=CX_FILE_50),
    dict(_CX50, model="SG40CX-P2", ac_kw=40, max_ac_kva=44, max_ac_current_a=66.9, max_dc_kw=56,
         weight_kg=40, datasheet=CX_FILE_50),
    dict(_CX50, model="SG50CX-P2", ac_kw=50, max_ac_kva=55, max_ac_current_a=83.6, max_dc_kw=70,
         weight_kg=41, datasheet=CX_FILE_50),
    dict(_CX, model="SG125CX-P2", ac_kw=125, max_ac_kva=125, max_ac_current_a=181.1, max_dc_kw=175,
         min_dc_v=180, mppt_min_v=180, num_mppt=12, mppt_strings="/".join(["2"] * 12),
         mppt_currents="/".join(["30"] * 12), mppt_iscs="/".join(["40"] * 12),
         max_eff_pct=98.5, euro_eff_pct=98.3, dimensions="1020 × 795 × 360", weight_kg=93,
         datasheet=CX_FILE_125),
    dict(_CX, model="SG150CX", ac_kw=150, max_ac_kva=165, max_ac_current_a=240.6, max_dc_kw=210,
         min_dc_v=180, mppt_min_v=180, num_mppt=7, mppt_strings="/".join(["3"] * 7),
         mppt_currents="/".join(["48"] * 7), mppt_iscs="/".join(["66"] * 7),
         max_eff_pct=98.8, euro_eff_pct=98.2, dimensions="1025 × 795 × 360", weight_kg=100,
         notes="Rated 150 kW @ 45 °C, 143 kW @ 50 °C. Max. apparent power 165 kVA @ 40 °C, "
               "150 kVA @ 45 °C, 143 kVA @ 50 °C. Max. AC current 250.7 A @ 380 V, 240.6 A @ 400 V. "
               "Datasheet marked 'Preliminary'.",
         datasheet=CX_FILE_150),
    # ---- utility (HX, 1500 V) ----
    dict(make="Sungrow", model="SG320HX-20", category="utility", phases=3, ac_voltage="3/PE, 800 V",
         internal_transformer=False, topology="Transformerless", ac_kw=320, max_ac_kva=352,
         max_ac_current_a=254, max_dc_v=1500, min_dc_v=500, start_v=550, rated_input_v=1080,
         mppt_min_v=500, mppt_max_v=1500, num_mppt=6, mppt_strings="/".join(["5"] * 6),
         mppt_currents="/".join(["75"] * 6), mppt_iscs="/".join(["125"] * 6),
         max_eff_pct=99.02, euro_eff_pct=98.8, dimensions="1147 × 778 × 371", weight_kg=110,
         ip_rating="IP66",
         notes="AC output 352 kVA @ 30 °C / 320 kVA @ 40 °C / 301.8 kVA @ 50 °C / 300 kVA @ 51 °C. "
               "800 V AC output: connects through a dedicated MV step-up transformer. "
               "Strings per MPPT = max. input connectors per MPPT (5).",
         datasheet=HX_FILE_320),
]
