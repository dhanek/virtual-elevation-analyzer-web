# ve-batch

Config preparation and batch driving for the Virtual Elevation Analyzer's
headless runner. The physics stays single-sourced in the app's Rust/WASM —
this package builds JSON configs, spawns `frontend/scripts/ve-run.ts`, and
collects the JSON that comes back.

```python
from pathlib import Path
from ve_batch import build_config, run_one, run_many, to_csv

cfg = build_config(
    mode="standard", laps=[2, 5],
    cda=0.28, crr=0.005,
    mass=85, eta=0.97,
    wind_source="fit", air_speed_calibration_percent=5,
    trim=(120, 640),
    notes="baseline",
)

result = run_one("ride.fit", cfg)                    # one file
results = run_many(sorted(Path("rides").glob("*.fit")), cfg)   # a sweep, ONE process
to_csv(results, "results.csv")
```

Requirements: `node`, `frontend/node_modules` installed (`npm install`), and
the WASM built (`wasm-pack build --target web --out-dir ../frontend/pkg` in
`backend/`). The frontend checkout is found relative to this package, or via
`VE_FRONTEND=/path/to/frontend`.

## The request schema (v1)

What `ve-run.ts` accepts on `--config` (`build_config` writes this for you).
The authoritative contract is `frontend/src/api/schema.ts`; the runner's
validator rejects unknown top-level keys loudly.

```jsonc
{
  "schemaVersion": 1,

  // Optional when the CLI gets --file (which wins). `path` is resolved
  // relative to the config file. `inline.channels` takes decoded arrays.
  "activity": { "path": "rides/2026-04-19.fit", "type": "fit" },

  // "standard" | "gpsLap" | "outAndBack". "compare" is NOT a mode — it is
  // inputs.windSource.
  "mode": "standard",

  // Exactly one selection shape, and it must match the mode:
  "selection": { "laps": [2, 5] },              // standard: 1-BASED lap ordinals
  // { "timeRanges": [{"start": ..., "end": ...}] }        // standard, explicit
  // { "indexRanges": [{"startIdx": 0, "endIdx": 900}],    // gpsLap
  //   "lapNumbers": [8, 9] }                              //   optional, 1:1
  // { "sections": [{ "sectionNumber": 1,                  // outAndBack —
  //     "outboundStartIdx": 100, "outboundEndIdx": 480,   //   outbound THEN
  //     "inboundStartIdx": 500, "inboundEndIdx": 890 }] } //   inbound

  // Two trim forms, never both; omit to run every segment's full extent.
  "trim": { "space": "selection", "start": 120, "end": 640 },   // the UI sliders' space
  // { "space": "segment", "bySegmentKey": { "s1-out": { "start": 5, "end": 300 } } }

  "inputs": {
    "cda": 0.28,
    "crr": 0.005,              // 22 °C-referenced; the runner applies temp correction
    "windSource": "fit",       // constant | fit | compare | none (default: by data)
    "airSpeedCalibrationPercent": 5,
    "rhoArray": null           // null: auto-resolve · false: constant rho · [...]: explicit
  },

  // AnalysisParameters; missing keys fill from the app's defaults and the
  // legacy patcher. wind_speed is the untransferred 10 m value —
  // wind_height_factor is applied once, inside the physics.
  // elevation_diff_source ("dem" | "barometer" | "manual") and
  // manual_elevation_diff_m ride along here too; they steer the app's
  // Convergence tab / auto-converge closure target and do not change any
  // number a headless run reports. baro_lag_seconds is different: a nonzero
  // value shifts the barometric elevation channel (the sensor records ~2 s
  // late on an Edge 520), which moves the actual-elevation trace and hence
  // the reported r2/rmse. Default 0 - never applied silently.
  "parameters": { "system_mass": 85, "eta": 0.97 },

  "output": {
    "includeSeries": false,    // per-sample arrays are big; off by default
    "csvRow": true,            // the app's RESULT_COLUMNS row
    "notes": "",
    "fileName": null
  }
}
```

## The response

One JSON object per line on stdout. `ok: false` carries
`error: {code, message, details}`; the exit code mirrors it (0 ok · 2 invalid
config · 3 activity load · 4 no valid segments · 1 unexpected), but the
envelope is always parseable — never read stderr for structure.

Key fields on success: `run` (what actually ran, including `crrApplied`),
`aggregate` (THE APP'S OWN aggregate — GPS-lap's r² is scored against the
mean-elevation profile and clamped at 0, not a per-segment mean),
`segments[]` (per-segment r²/RMSE/gains, plus the compare leg when
`windSource: "compare"`), `coverage` (`selected` vs `covered` — which of the
selected items the numbers actually describe), `csvRow`
(`headers`/`values`/`quoteAlways`, rendered through the app's own column
table so a batch CSV and the app's Export CSV are the same table), optional
`series`, and `warnings` (non-finite samples are emitted as null AND counted
here — a null in a series always has a warning naming it).

## Batching

`run_many` uses the runner's `--batch` mode by default: one process, NDJSON
in/out, order as correlation — vite-node + WASM boot is seconds of fixed cost
you pay once instead of per file. A failed ride yields an `ok: false` outcome
(and a CSV row with its `Error` column filled) rather than aborting the
sweep. `parallel=N` switches to a per-file process pool when isolation
matters more than throughput.
