#!/usr/bin/env bash
#
# tools/install_sounderpy.sh — put the real SounderPy sounding renderer on this
# box, then prove it works.
#
#   bash tools/install_sounderpy.sh
#
# Without this, the sounding tool falls back to the built-in JavaScript Skew-T.
# With it, the app serves the full SHARPpy-style SounderPy plot (skew-T,
# hodograph, map inset and the whole parameter panel).
#
# It creates an isolated virtual environment next to the app, so nothing is
# installed system-wide and removing .venv-sounderpy undoes it completely.
set -euo pipefail

cd "$(dirname "$0")/.."
ROOT="$(pwd)"
VENV="$ROOT/.venv-sounderpy"
PY_BIN="$VENV/bin/python"

echo "Echo Radar — SounderPy renderer install"
echo "  app:  $ROOT"
echo "  venv: $VENV"
echo

if ! command -v python3 >/dev/null 2>&1; then
  echo "python3 is not installed. On Debian/Ubuntu:"
  echo "  sudo apt update && sudo apt install -y python3 python3-venv python3-pip"
  exit 1
fi
echo "using $(python3 --version)"

if [ ! -x "$PY_BIN" ]; then
  echo "creating the virtual environment..."
  python3 -m venv "$VENV" || {
    echo
    echo "venv failed. Install the venv package first:"
    echo "  sudo apt install -y python3-venv"
    exit 1
  }
fi

echo "installing sounderpy, metpy, matplotlib and numpy (a few hundred MB, one time)..."
"$PY_BIN" -m pip install --upgrade pip >/dev/null
"$PY_BIN" -m pip install sounderpy metpy matplotlib numpy

# ── prove it renders, rather than hoping ─────────────────────────────────────
echo
echo "rendering a test sounding..."
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT
cat > "$TMP/profile.json" <<'JSON'
{"levels":[
 {"p":1000,"z":110,"t":29.0,"td":22.5,"wdir":160,"wspd":12},
 {"p":950,"z":560,"t":25.6,"td":21.0,"wdir":185,"wspd":24},
 {"p":900,"z":1020,"t":22.4,"td":19.0,"wdir":215,"wspd":32},
 {"p":850,"z":1500,"t":19.5,"td":16.5,"wdir":230,"wspd":36},
 {"p":800,"z":2010,"t":16.2,"td":12.0,"wdir":240,"wspd":40},
 {"p":700,"z":3100,"t":9.0,"td":1.0,"wdir":250,"wspd":46},
 {"p":600,"z":4320,"t":0.2,"td":-9.5,"wdir":255,"wspd":54},
 {"p":500,"z":5710,"t":-10.5,"td":-21.0,"wdir":260,"wspd":62},
 {"p":400,"z":7350,"t":-24.5,"td":-34.0,"wdir":265,"wspd":70},
 {"p":300,"z":9380,"t":-42.5,"td":-51.0,"wdir":270,"wspd":78},
 {"p":200,"z":12030,"t":-58.5,"td":-67.0,"wdir":275,"wspd":86},
 {"p":100,"z":16200,"t":-68.0,"td":-77.0,"wdir":280,"wspd":62}
],"surfaceZ":110,
 "meta":{"lat":33.64,"lon":-84.58,"model":"HRRR","modelId":"hrrr","fhr":0,"date":"20260930","cycle":"01"}}
JSON

if "$PY_BIN" "$ROOT/tools/sounding_sounderpy.py" "$TMP/profile.json" "$TMP/out.png" >/dev/null 2>"$TMP/err.txt" \
   && [ -s "$TMP/out.png" ]; then
  SIZE=$(wc -c < "$TMP/out.png")
  echo "  OK — rendered a $((SIZE / 1024)) KB sounding image"
else
  echo "  FAILED. The renderer said:"
  sed 's/^/    /' "$TMP/err.txt" | tail -12
  echo
  echo "The app still works — it falls back to the built-in Skew-T."
  exit 1
fi

# ── tell the app which interpreter to use ────────────────────────────────────
echo
echo "Add this line to the app's .env, then restart the server:"
echo
echo "  SOUNDERPY_PYTHON=$PY_BIN"
echo
if [ -f "$ROOT/.env" ] && ! grep -q '^SOUNDERPY_PYTHON=' "$ROOT/.env"; then
  read -r -p "Append it to .env now? [y/N] " ans
  case "$ans" in
    [yY]*)
      printf '\n# Python interpreter that has SounderPy (tools/install_sounderpy.sh)\nSOUNDERPY_PYTHON=%s\n' "$PY_BIN" >> "$ROOT/.env"
      echo "added. Restart the server to pick it up."
      ;;
    *) echo "left .env alone." ;;
  esac
fi
echo "done."
