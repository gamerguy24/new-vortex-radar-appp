# SounderPy soundings — server setup (Linux)

The sounding tool will show an **exact SHARPpy/SounderPy image** when this Python
renderer is installed on the box that runs the app. If it isn't installed (or
anything errors), the app **automatically falls back** to the built-in JS
Skew‑T — so the sounding feature always works; SounderPy only upgrades the look.

Nothing else in the radar depends on this. It's an additive endpoint
(`GET /api/models/:id/sounding/image`) plus the Python script
`tools/sounding_sounderpy.py`.

## 1. Install Python + SounderPy on the Linux server

```bash
# Debian/Ubuntu: system Python + venv + build basics
sudo apt update
sudo apt install -y python3 python3-venv python3-pip

# Create an isolated venv next to the app (recommended)
cd /path/to/VortexRadar
python3 -m venv .venv-sounderpy
. .venv-sounderpy/bin/activate
pip install --upgrade pip
pip install sounderpy metpy matplotlib numpy
```

`sounderpy` pulls in SHARPpy, MetPy, matplotlib and numpy. First install is a
few hundred MB.

## 2. Point the app at that Python

The server calls `python3` by default. If you used a venv (recommended), set the
env var to that interpreter so the app uses the environment with SounderPy:

```bash
# in the app's .env (or the service's environment)
SOUNDERPY_PYTHON=/path/to/VortexRadar/.venv-sounderpy/bin/python
# optional: raise the per-render timeout (ms) on slow boxes
# SOUNDERPY_TIMEOUT_MS=90000
```

Restart the Node app after setting it.

## 3. Test it directly

```bash
# make a tiny profile and render it
cat > /tmp/prof.json <<'JSON'
{"levels":[{"type":9,"p":1000,"z":345,"t":26,"td":22,"wdir":150,"wspd":15},
{"p":850,"z":1500,"t":18,"td":15,"wdir":200,"wspd":30},
{"p":500,"z":5880,"t":-11,"td":-20,"wdir":250,"wspd":55},
{"p":250,"z":10900,"t":-49,"td":-60,"wdir":262,"wspd":80}],
"surfaceZ":345,"meta":{"lat":35.18,"lon":-97.44,"model":"GFS","modelId":"gfs","fhr":24,"date":"20260420","cycle":"00","title":"GFS 00Z +24h"}}
JSON

/path/to/.venv-sounderpy/bin/python tools/sounding_sounderpy.py /tmp/prof.json /tmp/out.png
# → prints "OK" and writes /tmp/out.png  (open it to confirm the SounderPy image)
```

If it prints `OK` and writes a PNG, the app will serve that image in the sounding
tool. If it errors, the message tells you what's missing — fix it and retry; the
app keeps working on the built-in renderer meanwhile.

## Notes / troubleshooting

- **Signature mismatch:** SounderPy's `build_sounding()` arguments have changed
  across versions. The script tries the modern call then simpler fallbacks. If a
  new version breaks it, the error is printed; ping me with the version
  (`pip show sounderpy`) and I'll adjust the call.
- **Headless:** the script forces the matplotlib `Agg` backend, so no display is
  needed.
- **Performance:** each render spawns Python + matplotlib (a few seconds) and is
  cached per model/run/hour/point. Fine for on‑demand soundings.
- **Disable:** set `SOUNDERPY_PYTHON=/bin/false` (or just don't install the deps)
  and the app uses the built‑in renderer everywhere.
