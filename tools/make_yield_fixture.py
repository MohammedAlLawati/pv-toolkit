"""Make web/tests/fixtures/yield_cases.json: reference values from pvlib for the yield model.

The browser app's sun position, Perez transposition, IAM, cell temperature and inverter
model (web/js/yield/) are checked against pvlib on these hours.

    pip install pvlib
    python tools/make_yield_fixture.py path/to/pvgis_tmy.json

Any PVGIS typical-year JSON works, e.g. pvlib's own test file
https://github.com/pvlib/pvlib-python/blob/main/tests/data/tmy_45.000_8.000_2005_2023.json
"""
import json
import sys
from pathlib import Path

import numpy as np
import pandas as pd
import pvlib

OUT = Path(__file__).resolve().parent.parent / "web" / "tests" / "fixtures" / "yield_cases.json"

# planes to test: (tilt, azimuth, albedo)
PLANES = [(35, 180, 0.2), (10, 90, 0.25), (25, 250, 0.3), (5, 0, 0.2)]
# sites (the PVGIS file's weather is placed at each one, to cover other latitudes and longitudes)
SITES = [(None, None), (23.588, 58.383), (-33.9, 18.4)]


def main(path):
    j = json.loads(Path(path).read_text())
    loc = j["inputs"]["location"]
    offset = float(loc.get("irradiance_time_offset") or 0)
    rows = j["outputs"]["tmy_hourly"]
    df = pd.DataFrame(rows)
    t = pd.to_datetime(df["time(UTC)"], format="%Y%m%d:%H%M", utc=True)
    # the same calendar year as weather.js (2019), then the irradiance offset
    t = t.map(lambda x: x.replace(year=2019)) + pd.Timedelta(hours=offset)
    df.index = pd.DatetimeIndex(t)
    df = df.sort_index()
    day = df[df["G(h)"] > 0]
    pick = day.iloc[::23]

    cases = []
    for lat, lon in SITES:
        la = loc["latitude"] if lat is None else lat
        lo = loc["longitude"] if lon is None else lon
        sp = pvlib.solarposition.get_solarposition(pick.index, la, lo, altitude=0, method="nrel_numpy")
        dni_extra = pvlib.irradiance.get_extra_radiation(pick.index, method="spencer")
        am = pvlib.atmosphere.get_relative_airmass(sp["apparent_zenith"], model="kastenyoung1989")
        for tilt, az, albedo in PLANES:
            poa = pvlib.irradiance.get_total_irradiance(
                tilt, az, sp["apparent_zenith"], sp["azimuth"], pick["Gb(n)"], pick["G(h)"], pick["Gd(h)"],
                dni_extra=dni_extra, airmass=am, albedo=albedo, model="perez",
                model_perez="allsitescomposite1990")
            aoi = pvlib.irradiance.aoi(tilt, az, sp["apparent_zenith"], sp["azimuth"])
            for ts in pick.index:
                z = float(sp.at[ts, "apparent_zenith"])
                if z >= 89.5:
                    continue
                r = pick.loc[ts]
                cases.append({
                    "ms": int(ts.value // 10**6), "lat": la, "lon": lo, "tilt": tilt, "az": az, "albedo": albedo,
                    "ghi": float(r["G(h)"]), "dni": float(r["Gb(n)"]), "dhi": float(r["Gd(h)"]),
                    "zenith": z, "azimuth": float(sp.at[ts, "azimuth"]), "dni_extra": float(dni_extra[ts]),
                    "aoi": float(aoi[ts]),
                    "poa_direct": float(poa.at[ts, "poa_direct"]), "poa_sky": float(np.nan_to_num(poa.at[ts, "poa_sky_diffuse"])),
                    "poa_ground": float(poa.at[ts, "poa_ground_diffuse"]),
                })

    # IAM: ASHRAE beam, and pvlib's Marion integration for sky and ground diffuse
    iam = []
    for tilt in (0, 5, 10, 20, 30, 45, 60, 90):
        d = pvlib.iam.marion_diffuse("ashrae", tilt, b=0.05)
        iam.append({"tilt": tilt, "b0": 0.05, "sky": float(d["sky"]), "ground": float(np.nan_to_num(d["ground"], nan=1.0))})
    beam = [{"aoi": a, "b0": 0.05, "iam": float(pvlib.iam.ashrae(a, 0.05))} for a in (0, 20, 40, 60, 70, 80, 85, 89)]

    temps = []
    for g, ta, ws, uc, uv, eff in [(800, 30, 1, 29, 0, 0.2), (1000, 45, 3, 20, 0, 0.22), (400, 10, 5, 29, 1.5, 0.18)]:
        tc = pvlib.temperature.pvsyst_cell(g, ta, ws, u_c=uc, u_v=uv, module_efficiency=eff, alpha_absorption=0.9)
        temps.append({"g": g, "ta": ta, "ws": ws, "uc": uc, "uv": uv, "eff": eff, "tc": float(tc)})

    inverter = []
    for pdc, pac0, eta in [(10000, 50000, 0.98), (40000, 50000, 0.98), (51000, 50000, 0.98), (500, 50000, 0.97), (2500, 5000, 0.965)]:
        pac = pvlib.inverter.pvwatts(pdc, pac0 / eta, eta_inv_nom=eta)
        inverter.append({"pdc": pdc, "pac0": pac0, "eta": eta, "pac": float(pac)})

    OUT.write_text(json.dumps({"pvlib": pvlib.__version__, "source": Path(path).name, "offset_h": offset,
                               "cases": cases, "iam_diffuse": iam, "iam_beam": beam, "temps": temps,
                               "inverter": inverter}, separators=(",", ":")))
    print(f"{len(cases)} cases -> {OUT}")


if __name__ == "__main__":
    main(sys.argv[1])
