# Virtual Elevation Analyzer

> Live demo: https://dhanek.github.io/virtual-elevation-analyzer-web/

Virtual Elevation Analyzer is a privacy-first browser app for cycling analysis using Robert Chung's virtual elevation method. FIT/CSV ingestion, VE math, and most data handling run locally in the browser using TypeScript plus Rust compiled to WebAssembly.

## What it does

- Load **FIT** and **CSV** activity files
- Run **standard**, **GPS-lap**, and **out-and-back** virtual elevation workflows
- Visualize rides on a map with trim and selection controls
- Plot **virtual elevation**, **residuals**, **wind**, **power**, and **virtual distance** views
- Use **constant wind**, **FIT airspeed**, and comparison-oriented wind workflows
- Correct elevation with **AWS Terrain** tiles or **local GeoTIFF/world/prj** DEM files
- Save parameters and results locally in the browser via IndexedDB

## Privacy model

Ride files are processed locally in your browser and are not uploaded to an application backend.

Optional external requests may still happen for:
- map tiles
- weather lookup
- remote DEM / terrain tiles

Those requests support visualization or elevation/weather enrichment; they do not turn the app into a server-side processing system.

## Quick start

### Prerequisites

- Rust toolchain
- `wasm-pack`
- Node.js 20+

### Run locally

```bash
# install frontend dependencies
cd frontend
npm install

# build the Rust/WASM package used by the frontend
cd ../backend
wasm-pack build --target web --out-dir ../frontend/pkg

# start the frontend dev server
cd ../frontend
npm run dev
```

Then open the local Vite URL shown in the terminal.

### Watch mode

`npm run dev:all` (from the repo root) runs the Vite dev server *and*
`cargo watch`, so a change to the Rust crate rebuilds into `frontend/pkg` and
reloads the page. It needs `cargo install cargo-watch`; without it the script
still serves the frontend and tells you Rust changes will not rebuild.

Two things make that loop usable:

- **The page comes back to the ride you were on.** In a dev build the last
  activity file and the Section-3 selection are cached, and replayed on boot —
  a reload does not send you back to an empty drop zone. Load with `?fresh` to
  skip the replay, or use "Clear Saved Data" to drop the cache. Production
  builds never write it.
- **Watching works on WSL.** File events never fire for a checkout on a
  Windows drive (`/mnt/c/...`), which silently breaks every kind of reload.
  Vite is configured to poll there, detected automatically; `VITE_POLL=1` or
  `VITE_POLL=0` forces the choice.

Note that TypeScript changes trigger a full page reload rather than a hot
module swap — the shell has no teardown path, so nothing can accept an update
in place.

### Full local validation

```bash
cd backend && cargo test --lib
cd backend && wasm-pack build --target web --out-dir ../frontend/pkg
cd frontend && npm run check
cd frontend && npm run lint
cd frontend && npm run test
cd frontend && npm run build
```

### Production-style build

```bash
./build.sh
```

## Documentation

- [ARCHITECTURE.md](ARCHITECTURE.md) — module layout, WASM boundary, runtime flow
- [PROJECT_STATUS.md](PROJECT_STATUS.md) — current implementation snapshot and known gaps
- [ROADMAP.md](ROADMAP.md) — near-term engineering and product direction
- [DEPLOYMENT.md](DEPLOYMENT.md) — GitHub Pages deployment and CI flow
- [REFACTORING_REPORT.md](REFACTORING_REPORT.md) — engineering review that motivated the current cleanup work
- [REFACTORING_CHECKLIST.md](REFACTORING_CHECKLIST.md) — execution checklist for the refactor
- [README-IMPLEMENTATION.md](README-IMPLEMENTATION.md) — archived historical notes

## Repository layout

```text
virtual-elevation-analyzer-web/
├── backend/     # Rust/WASM numerical and parsing code
├── frontend/    # TypeScript/Vite UI
├── dist/        # production build output
├── ARCHITECTURE.md
├── PROJECT_STATUS.md
├── ROADMAP.md
└── DEPLOYMENT.md
```

## Current engineering status

The project is mid-refactor: core analysis logic has already been split into typed state, activity-loading, plotting, and mode modules, but `frontend/src/main.ts` still contains a large amount of UI composition and event wiring.

If you want the current cleanup status, start with:
- [REFACTORING_CHECKLIST.md](REFACTORING_CHECKLIST.md)
- [PROJECT_STATUS.md](PROJECT_STATUS.md)
