# Vortex Radar — Tornado Potential

> **Vortex Radar Tornado Potential is an experimental radar-derived analysis tool.
> It is not an official warning system and does not replace alerts or warnings
> issued by the National Weather Service.**

An experimental engine that analyses NEXRAD Level 2 velocity data for rotation,
tracks storms between scans, and produces a 0–100 **Tornado Potential Score**.
It never issues warnings, never says a tornado will occur, and never presents
itself as an official product.

**It is off by default.** Deploying this code changes nothing until you set
`enabled: true`.

---

## 1. Files created / modified

### Created — backend engine
| File | Purpose |
|---|---|
| `backend/tornado/index.js` | Mount point (`attachTornado`) |
| `backend/tornado/config.js` | Config load/merge/validate + hot reload |
| `backend/tornado/logger.js` | Structured timestamped logging + ring buffer |
| `backend/tornado/geo.js` | Polar→lat/lon, distance, bearing, **beam height** |
| `backend/tornado/radar_source.js` | Level 2 ingest, scan de-duplication, per-site isolation |
| `backend/tornado/rotation.js` | Couplet detection, azimuthal shear, QC filters, confidence |
| `backend/tornado/storms.js` | Cell identification, scan-to-scan tracking, trend analysis, projections |
| `backend/tornado/environment.js` | CAPE/CIN/shear/SRH from **the app's own GRIB pipeline** |
| `backend/tornado/nws.js` | Official NWS alerts, kept separate from the score |
| `backend/tornado/score.js` | The weighted 0–100 score |
| `backend/tornado/history.js` | JSONL observation log (future ML training set) |
| `backend/tornado/alerts.js` | Threshold crossings, cooldown, alert feed |
| `backend/tornado/engine.js` | Scan loop, site selection, failure isolation, state persistence |
| `backend/tornado/api.js` | JSON API router |

### Created — frontend, config, tools
| File | Purpose |
|---|---|
| `components/tornado_potential.js` | Map layer, summary panel, storm detail panel, alerts |
| `config/tornado.json` | All tunables (hot-reloaded) |
| `tools/tornado_selftest.js` | Ground-truth tests for the detector |
| `tools/tornado_replay.js` | Run real volumes through the pipeline / historical replay |
| `docs/TORNADO_POTENTIAL.md` | This document |

### Modified (all additive)
| File | Change |
|---|---|
| `server.js` | Mounts the subsystem inside `try/catch`, after Critical Alerts |
| `model_data.js` | Exports `latestRun`, `fetchIdx`, `s3KeyUrl`, `availableHours` — no behaviour change |
| `index.html` | "Tornado Potential" menu row + component `<script>` |

Nothing existing was replaced. No radar functionality was changed.

---

## 2. Installation

No new dependencies. It reuses what the app already has.

```bash
cd /path/to/VortexRadar
git pull                      # or copy the files above
node tools/tornado_selftest.js    # verify the detector: expect "29 passed, 0 failed"
```

Enable it:

```bash
# edit config/tornado.json → "enabled": true
# or:
TORNADO_ENABLED=1 npm start
```

`config/tornado.json` is re-read on change — retune a live system without a restart.

---

## 3. Environment variables

| Variable | Default | Meaning |
|---|---|---|
| `TORNADO_ENABLED` | unset | `1`/`true` turns the engine on, overriding the config file |
| `TORNADO_SITES` | unset | Comma-separated radar ids (`KFFC,KTLX`). Disables auto-selection |
| `TORNADO_POLL_SECONDS` | `60` | Scan cadence |
| `TORNADO_CONFIG` | `config/tornado.json` | Alternate config path |
| `NWS_USER_AGENT` | app default | Contact string sent to NWS/NOAA (they ask for one) |
| `DATA_DIR` | `server_data/` | Where history + restart state are written |

---

## 4. Configuration options

All in `config/tornado.json`.

**Top level** — `enabled`, `sites` (explicit list; empty = auto-select).

**`autoSelectSites`** — `enabled`, `maxSites` (6), `fromNwsWarnings`, `fromSavedLocations`, `extraSites`.
With no explicit sites, the engine follows the weather: radars nearest active
tornado/severe warnings first, then radars near saved locations. On a quiet day
it watches little and costs almost nothing.

**`scan`** — `pollSeconds` (60), `siteTimeoutMs` (90000), `maxConcurrentSites` (2),
`staleVolumeMinutes` (20; older volumes are ignored).

**`weights`** — must describe the 0–100 score; normalised automatically if they
don't sum to 1 (with a log line saying so).

| Weight | Default |
|---|---|
| `coupletStrength` | 0.30 |
| `shearIncrease` | 0.20 |
| `lowLevelRotation` | 0.15 |
| `rotationTightening` | 0.10 |
| `stormStructure` | 0.10 |
| `stormRelativeVelocity` | 0.05 |
| `instability` | 0.05 |
| `helicityShear` | 0.05 |

**`detection`** — the false-positive controls. `minDeltaVMs` (20), `minRotationalVelocityMs` (10),
`minReflectivityDbz` (35), `minSupportingGates` (4), `maxCoupletDiameterKm` (12),
`minRangeKm`/`maxRangeKm` (8/230), `maxBeamHeightKmForLowLevel` (3.0),
`nyquistAliasFactor` (0.92), `seedLags` (`[1,3,6]`), `azimuthWindow`, `gateWindow`.

> Lowering `minDeltaVMs` or `minReflectivityDbz` increases detections **and false
> alarms** sharply. On a quiet day, dropping ΔV from 20 to 14 m/s took KTLX from
> 1–3 detections per scan to 32.

**`storms`** — `cellReflectivityDbz` (40), `gridKm` (2), `maxTrackDistanceKm` (20),
`maxCoastMinutes` (15), `circulationAttachKm` (15), `projectionMinutes` `[15,30,45,60]`.

**`modifiers`** — `persistenceMaxBonus` (0.15), `persistenceFullMinutes` (20),
`decayFactor` (0.55, applied when rotation ends), `aliasPenalty` (0.85),
`confidenceFloor` (0.45 — the fraction of its score a zero-confidence detection keeps).

**`environment`** — `enabled`, `cacheMinutes` (30), `maxPointsPerCycle` (4), `timeoutMs`.

**`alerts`** — `enabled`, `minScore` (60), `minConfidence` (`MEDIUM`),
`cooldownMinutes` (10), `minScoreIncrease` (10).

**`history`** — `enabled`, `retainDays` (90).

**`logging`** — `level` (`error|warn|info|debug`), `logScans`, `logDetections`.

---

## 5. API

All routes require a session (same auth as the rest of the app). Every scored
payload carries `experimental: true` and the disclaimer.

| Route | Returns |
|---|---|
| `GET /api/tornado-potential` | Scored storms, ranked. `?minScore=40` |
| `GET /api/tornado-potential/:stormId` | One storm, full detail |
| `GET /api/storms` | Every tracked storm. `?site=KFFC` |
| `GET /api/storms/:stormId` | One storm |
| `GET /api/rotation` | Current circulations only |
| `GET /api/rotation/history/:stormId` | Scan-by-scan rotation + score history |
| `GET /api/tornado-potential/alerts/feed` | Threshold crossings. `?since=<ISO>` |
| `GET /api/tornado-potential/meta/status` | Engine health, config, recent log (admin) |
| `GET /api/tornado-potential/replay/days` | UTC days with recorded history |
| `GET /api/tornado-potential/replay/:day` | Recorded observations. `?site=&minScore=` |

```json
{
  "stormId": "ST-1024",
  "latitude": 33.57, "longitude": -85.15,
  "score": 78, "category": "HIGH", "confidence": "HIGH",
  "rotation": "STRONG", "trend": "INCREASING", "persistenceMinutes": 14,
  "stormMotion": { "direction": 245, "compass": "WSW", "speedMph": 32 },
  "official": { "tornadoWarning": null, "hasOfficialWarning": false },
  "experimental": true
}
```

---

## 6. Running on Linux

```bash
node server.js                 # engine starts with the app when enabled
```

The engine is in-process. It runs on `setInterval` with `unref()`, so it never
holds the process open, and it does its work only when a radar site publishes a
new volume.

---

## 7. Running 24/7 with systemd

`/etc/systemd/system/vortexradar.service`:

```ini
[Unit]
Description=Vortex Radar
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=vortex
WorkingDirectory=/opt/vortexradar
ExecStart=/usr/bin/node server.js
Restart=always
RestartSec=5
Environment=NODE_ENV=production
Environment=TORNADO_ENABLED=1
Environment=NWS_USER_AGENT=VortexRadar (your-domain.com, you@example.com)
StandardOutput=journal
StandardError=journal
# The engine is memory-hungry only while decoding a volume (~150-300 MB peak).
MemoryMax=2G

[Install]
WantedBy=multi-user.target
```

```bash
sudo systemctl daemon-reload
sudo systemctl enable --now vortexradar
journalctl -u vortexradar -f | grep TORNADO
```

Tracked storms are checkpointed to `$DATA_DIR/tornado-state.json` each cycle and
restored on boot **only if less than 30 minutes old** — stale tracks are worse
than none, because a storm from two hours ago is not where you left it.

---

## 8. Testing the rotation detector

```bash
node tools/tornado_selftest.js
```

Ten groups of ground-truth checks against synthetic sweeps containing a Rankine
vortex at a known azimuth, range and strength — so the reported position, ΔV and
shear can be checked against the real answer. Includes negative cases for each QC
filter (no-reflectivity clutter, isolated spike, ±Nyquist folding, weak broad
shear), a five-scan strengthening sequence, a decay case, and degenerate inputs.

Against real data:

```bash
node tools/tornado_replay.js --site KTLX --limit 6
node tools/tornado_replay.js --site KFFC --day 2026-08-24 --from 20:00 --to 22:00
node tools/tornado_replay.js --site KTLX --limit 4 --json > run.json
```

---

## 9. Replaying historical storms

`tools/tornado_replay.js` feeds archived volumes through the same
rotation → tracking → scoring path the live engine uses, so the output is what
the engine would have produced at the time.

```bash
node tools/tornado_replay.js --site KTLX --day 2026-08-24 --limit 12
```

It prints a per-scan table and a per-storm score evolution
(`ST-1003 scans=4 peak=78 path: 31 → 44 → 62 → 78`).

Recorded live output is also queryable:
`GET /api/tornado-potential/replay/days`, then `GET /api/tornado-potential/replay/2026-08-24`.

**Archive availability.** Unidata THREDDS carries recent days and needs no
credentials. Older events live in the AWS `noaa-nexrad-level2` bucket, whose
anonymous listing is blocked on some networks (it is on this one). Download those
volumes yourself and pass them in:

```bash
node tools/tornado_replay.js --site KTLX --files ./KTLX_1.ar2v,./KTLX_2.ar2v
```

---

## 10. Known limitations and accuracy concerns

**This has not been verified against confirmed tornado reports.** It has been
tested for correctness (does it measure what it claims) — not for skill (does a
high score mean a tornado). No POD, FAR or lead-time numbers exist yet. Do not
present it as validated.

1. **Radar cannot see tornadoes.** It sees rotation in a beam that widens and
   climbs with distance. Beyond ~120 km the 0.5° beam is above 2 km AGL and says
   little about the surface. Reported `beamHeightKm` and the confidence value
   both reflect this — a distant detection is downweighted, not hidden.

2. **False alarms are inherent.** Mesocyclones vastly outnumber tornadoes.
   Non-tornadic supercells will score HIGH. Gust fronts, outflow boundaries and
   the odd sidelobe artifact can survive QC.

3. **Velocity aliasing.** Textbook ±Nyquist folds are rejected outright and
   near-Nyquist detections are penalised, but this is not a dealiasing algorithm.

4. **Storm cells are approximate.** Reflectivity is thresholded onto a ~2 km grid
   and clustered — fast and stable, but not a full SCIT. Cells that merge or split
   can hand IDs around.

5. **Projections are dead reckoning.** "Projected Storm Motion" extrapolates the
   recent track in a straight line. Storms turn, and tornadoes do not necessarily
   follow the parent cell. It is not a tornado path.

6. **Environmental data is a model analysis**, from HRRR (or NAM/GFS) f00 —
   the same NOAA GRIB the app's own soundings use. It is a forecast field, not an
   observation, and can be materially wrong near a storm. If it is unavailable,
   those weights redistribute and the result is flagged `partial`.

7. **The lowest tilt only.** One 0.5° sweep per volume — no vertical continuity
   check, so a mid-level mesocyclone with no low-level circulation looks the same
   as one that is descending.

8. **Scores are not probabilities.** 78 does not mean 78%. It is a weighted
   summary on an arbitrary scale. Calibration would require the labelled dataset
   `history.js` is accumulating.

9. **The ML path is scaffolding only.** Observations are logged with the features
   and the official-warning label; `history.labelReports()` attaches confirmed
   reports. No model is trained, and `ml.enabled` does nothing yet. It is not
   scientifically validated and must not be described as such.

10. **Single-radar analysis.** No multi-radar merging; a storm equidistant from
    two sites may be tracked twice with different IDs.

---

## Logging

```
2026-08-24T19:52:44.101Z [TORNADO] scan.received site=KTLX vol=Level2_KTLX_20260824_1952.ar2v ageMin=1.2 velGates=1832 tilt=0.5
2026-08-24T19:52:44.318Z [TORNADO] storm.detected storm=ST-1003 site=KTLX lat=35.331 lon=-96.617 dbz=47
2026-08-24T19:52:44.402Z [TORNADO] rotation.detected site=KTLX dv=28 shear=0.01884 beam=0.91 conf=0.71
2026-08-24T19:52:44.409Z [TORNADO] scan.analysed site=KTLX storms=3 circulations=1 ms=128
2026-08-24T19:57:02.550Z [TORNADO] alert.threshold storm=ST-1003 from=36 to=64 conf=HIGH official=false
```

`GET /api/tornado-potential/meta/status` returns the recent ring buffer without
needing shell access.
