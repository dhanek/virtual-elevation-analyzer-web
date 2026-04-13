# INTEGRATIONS

**Project:** `virtual-elevation-analyzer-web`  
**Mapped:** 2026-04-12

## Integration model

This repo is mostly self-contained. The important integrations are browser APIs, static asset/CDN dependencies, third-party weather/DEM services, and GitHub Pages deployment.

There is no authentication provider, database server, webhook processor, or backend API owned by this project.

## External services and network dependencies

| Integration | Purpose | Code paths | Notes |
| --- | --- | --- | --- |
| Plotly CDN | Chart rendering | `frontend/src/main.ts` | Loaded dynamically from `https://cdn.plot.ly/plotly-basic-2.27.0.min.js` |
| Leaflet CSS via unpkg | Map styling | `frontend/src/components/MapVisualization.ts` | Injected at runtime from `https://unpkg.com/leaflet@1.9.4/dist/leaflet.css` |
| OpenStreetMap tile servers | Base map tiles | `frontend/src/components/MapVisualization.ts`, `frontend/index.html` CSP | Map rendering depends on live tile fetches |
| Open-Meteo Forecast API | Recent weather lookup | `frontend/src/utils/WeatherAPI.ts` | Used for automatic rho / air-density estimation |
| Open-Meteo Archive API | Historical weather lookup | `frontend/src/utils/WeatherAPI.ts` | Used when activity date is too old for forecast endpoint |
| AWS Terrain Tiles S3 | Remote DEM elevation tiles | `frontend/src/utils/RemoteDEMService.ts`, `frontend/src/utils/MultiDEMManager.ts` | Current remote DEM source exposed in the UI |
| OpenTopography Global DEM API | Alternate remote DEM source | `frontend/src/utils/RemoteDEMService.ts`, `frontend/src/utils/RemoteDEMConfig.ts` | Client exists in code; current UI shell does not expose it |
| GitHub Pages | Static hosting | `.github/workflows/deploy.yml` | Deploy target for `dist/` |

## Browser APIs and persistence

### IndexedDB

The app uses several separate IndexedDB databases.

| Database | File(s) | Purpose |
| --- | --- | --- |
| `VirtualElevationAnalyzer` | `frontend/src/utils/ParameterStorage.ts` | Per-file analysis parameters, lap settings, GPS gate settings |
| `VirtualElevationResults` | `frontend/src/utils/ResultsStorage.ts` | Stored VE result summaries and exports |
| `ve-weather-cache` | `frontend/src/utils/WeatherCache.ts` | Permanent weather cache keyed by location/date/slot |
| `ve-elevation-profiles` | `frontend/src/utils/DEMManager.ts` | Cached corrected elevation profiles |

### `localStorage`

`frontend/src/utils/RemoteDEMConfig.ts` stores user preferences in `localStorage`:

- `opentopo-api-key`
- `remote-dem-sources`
- `remote-dem-dataset`

`frontend/src/main.ts` also reads `remote-dem-sources` directly when restoring DEM source preference.

### File and save APIs

- `frontend/src/components/FitFileProcessor.ts` reads uploaded FIT files through `File.arrayBuffer()`
- `frontend/src/main.ts` reads uploaded CSV and DEM files through browser file APIs
- `frontend/src/utils/ResultsStorage.ts` uses `browser-fs-access` (`fileSave`) for screenshot and CSV export

## WASM boundary integration

The frontend integrates with the wasm-pack output in `frontend/pkg/`.

### Direct imports

- `frontend/src/main.ts` imports:
  - `init` from `../pkg/virtual_elevation_analyzer.js`
  - `AirDensityCalculator` from `../pkg/virtual_elevation_analyzer.js`
- `frontend/src/components/FitFileProcessor.ts` dynamically imports `@wasm/virtual_elevation_analyzer.js`
- `frontend/src/utils/DEMManager.ts` imports `DEMProcessor` from `../../pkg/virtual_elevation_analyzer`
- `frontend/src/analysis/VeCalculatorFactory.ts` imports `create_ve_calculator` and `create_ve_calculator_with_rho_array`

### Backend exports involved

Key exported Rust surfaces come from:

- `backend/src/fit_parser.rs`
- `backend/src/virtual_elevation.rs`
- `backend/src/air_density.rs`
- `backend/src/dem_processor.rs`
- `backend/src/utils.rs`

## Deployment / CI integration

Deployment is defined in `.github/workflows/deploy.yml`.

It integrates:

- Rust toolchain setup
- `wasm-pack` installation
- Node.js setup with npm caching
- frontend validation (`check`, `lint`, `test`, `build`)
- GitHub Pages artifact upload and deploy

## CSP and allowlist relationships

`frontend/index.html` defines a static Content Security Policy.

Important allowlists:

- `script-src` allows `https://cdn.plot.ly`
- `style-src` allows `https://unpkg.com`
- `img-src` allows `https://*.tile.openstreetmap.org`
- `connect-src` allows:
  - `https://*.tile.openstreetmap.org`
  - `https://api.open-meteo.com`
  - `https://archive-api.open-meteo.com`
  - `https://s3.amazonaws.com`

Notably, `connect-src` does **not** currently include `https://portal.opentopography.org`, even though an OpenTopography client exists in `frontend/src/utils/RemoteDEMService.ts`.

## Integration gaps / partial wiring

### OpenTopography is present in code but not fully wired through the current shell

Evidence:

- client exists in `frontend/src/utils/RemoteDEMService.ts`
- configuration storage exists in `frontend/src/utils/RemoteDEMConfig.ts`
- current selector in `frontend/index.html` exposes only:
  - `aws-terrain`
  - `none`
  - `local`
- `frontend/src/main.ts` only maps the active UI selector to `aws-terrain` or local/none behavior

This looks like a dormant or unfinished integration rather than a primary active feature.

## Non-integrations intentionally absent

The repo currently does **not** integrate with:

- OAuth or user auth
- Stripe or payments
- a custom backend API
- server-side data processing
- message queues or webhooks
- analytics SDKs

That aligns with the app's privacy-first, browser-local design.
