#!/usr/bin/env python3
"""
sounding_sounderpy.py
Render a broadcast SHARPpy/SounderPy sounding image from a Vortex Radar profile.

Called by the Node server (model_data.js) as:
    python3 sounding_sounderpy.py <profile.json> <out.png>

<profile.json> is the app's decoded point sounding:
    { "levels": [ {p(hPa), z(m MSL), t(degC), td(degC), wdir(deg), wspd(kt)}, ... ],
      "surfaceZ": <m>,
      "meta": { lat, lon, model, modelId, fhr, date("YYYYMMDD"), cycle("HH"),
                cape, cin, title } }

Requires (installed on the host — see tools/SOUNDERPY_SETUP.md):
    pip install sounderpy metpy matplotlib numpy

On any error it prints a message to stderr and exits non-zero, so the server
falls back to the built-in renderer (the sounding feature never breaks).
"""
import sys
import json
import datetime as dt

def fail(msg):
    sys.stderr.write(str(msg) + "\n")
    sys.exit(1)

def main():
    if len(sys.argv) < 3:
        fail("usage: sounding_sounderpy.py <profile.json> <out.png>")
    in_path, out_path = sys.argv[1], sys.argv[2]

    try:
        with open(in_path, "r") as f:
            data = json.load(f)
    except Exception as e:
        fail("could not read profile json: %s" % e)

    # Headless matplotlib BEFORE importing sounderpy.
    try:
        import matplotlib
        matplotlib.use("Agg")
        import numpy as np
        import sounderpy as spy
        from metpy.units import units
    except Exception as e:
        fail("missing python deps (pip install sounderpy metpy matplotlib numpy): %s" % e)

    meta = data.get("meta", {}) or {}
    levels = [l for l in data.get("levels", [])
              if l.get("p") is not None and l.get("t") is not None
              and l.get("td") is not None and l.get("wdir") is not None
              and l.get("wspd") is not None and l.get("z") is not None]
    # SounderPy wants surface-first (descending pressure) and no duplicate levels.
    levels.sort(key=lambda l: -float(l["p"]))
    seen, uniq = set(), []
    for l in levels:
        pk = round(float(l["p"]), 1)
        if pk in seen:
            continue
        seen.add(pk)
        uniq.append(l)
    levels = uniq
    if len(levels) < 3:
        fail("not enough levels to build a sounding")

    p = np.array([float(l["p"]) for l in levels])
    z = np.array([float(l["z"]) for l in levels])
    T = np.array([float(l["t"]) for l in levels])
    Td = np.array([float(l["td"]) for l in levels])
    wdir = np.array([float(l["wdir"]) for l in levels])
    wspd = np.array([float(l["wspd"]) for l in levels])
    # meteorological wind components (kt)
    u = -wspd * np.sin(np.radians(wdir))
    v = -wspd * np.cos(np.radians(wdir))

    lat = float(meta.get("lat", 0.0))
    lon = float(meta.get("lon", 0.0))
    model = str(meta.get("model", "MODEL"))
    fhr = meta.get("fhr", 0)
    date = str(meta.get("date", ""))       # YYYYMMDD
    cycle = str(meta.get("cycle", "00"))   # HH

    # run-time / valid-time as [YYYY, MM, DD, HH] (SounderPy site_info format).
    def parts(dstr, hh):
        try:
            base = dt.datetime(int(dstr[0:4]), int(dstr[4:6]), int(dstr[6:8]), int(hh))
            return base
        except Exception:
            return dt.datetime.utcnow()
    run_dt = parts(date, cycle)
    try:
        valid_dt = run_dt + dt.timedelta(hours=int(fhr))
    except Exception:
        valid_dt = run_dt
    fmt = lambda d: [str(d.year), "%02d" % d.month, "%02d" % d.day, "%02d" % d.hour]

    site_info = {
        "site-id": str(meta.get("modelId", "PT")).upper(),
        "site-name": "%.3f, %.3f" % (lat, lon),
        "site-lctn": "",
        "site-latlon": [lat, lon],
        "site-elv": int(round(float(data.get("surfaceZ", z[0] if len(z) else 0)))),
        "source": "model",
        "model": model,
        "fcst-hour": "F%03d" % int(fhr) if str(fhr).lstrip("-").isdigit() else str(fhr),
        "run-time": fmt(run_dt),
        "valid-time": fmt(valid_dt),
    }

    clean_data = {
        "p": p * units.hPa,
        "z": z * units.meter,
        "T": T * units.degC,
        "Td": Td * units.degC,
        "u": u * units.kt,
        "v": v * units.kt,
        "site_info": site_info,
    }

    # SounderPy's own loaders attach a 'titles' block and its plotter reads it
    # unconditionally (plot.py: clean_data['titles']['top_title'] and friends).
    # Building clean_data by hand means building this too; without it every call
    # died with a bare KeyError: 'titles'.
    rt, vt = fmt(run_dt), fmt(valid_dt)
    clean_data["titles"] = {
        "top_title": "MODEL FORECAST VERTICAL PROFILE | %sZ %s %s"
                     % (vt[3], model, site_info["fcst-hour"]),
        "left_title": "%sZ %s %s | VALID: %s/%s/%s %sZ"
                      % (rt[3], model, site_info["fcst-hour"], vt[1], vt[2], vt[0], vt[3]),
        "right_title": "%.3f, %.3f    " % (lat, lon),
    }

    # Build the full SHARPpy-style plot. SounderPy's signature has shifted across
    # versions, so try the modern call first, then simpler fallbacks.
    fig = None
    tried = []
    # SounderPy 3.1.0: build_sounding(clean_data, style, color_blind, dark_mode,
    # storm_motion, special_parcels, radar, radar_time, map_zoom, modify_sfc,
    # show_theta, hodo_boundary, save, filename). There is no `show`; passing it
    # raised TypeError and burned the first attempt on every call.
    for kwargs in (
        dict(style="full", dark_mode=True, save=False),
        dict(style="full", dark_mode=True),
        dict(),
    ):
        try:
            fig = spy.build_sounding(clean_data, **kwargs)
            break
        except TypeError as e:
            tried.append(str(e))
            continue
        except Exception as e:
            tried.append(str(e))
            continue
    import matplotlib.pyplot as plt
    if not hasattr(fig, "savefig"):
        fig = plt.gcf()
    if fig is None or len(fig.get_axes()) == 0:
        fail("sounderpy build_sounding produced no figure; tried: %s" % " | ".join(tried[-3:]))

    try:
        fc = fig.get_facecolor()
        fig.savefig(out_path, dpi=110, bbox_inches="tight", facecolor=fc)
    except Exception as e:
        fail("could not save figure: %s" % e)
    print("OK")

if __name__ == "__main__":
    main()
