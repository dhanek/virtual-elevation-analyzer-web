<!-- GSD:project-start source:.planning/PROJECT.md -->
## Project

Virtual Elevation Analyzer Web is a privacy-first browser application for cyclists that analyzes FIT and CSV ride data using Robert Chung virtual elevation. It runs as a static frontend with a Rust/WebAssembly compute core and keeps ride processing in the browser.

Current focus: **Frontend UI Shell Stabilization**.
Core value: make trustworthy browser-based virtual elevation analysis work well without a fragile UI shell.
<!-- GSD:project-end -->

<!-- GSD:stack-start source:.planning/codebase/STACK.md -->
## Technology Stack

- Frontend: TypeScript 6 + Vite 8, strict typecheck, ESLint, Vitest
- Runtime UI: framework-free browser DOM code, Plotly integration, Leaflet map
- Compute core: Rust 2021 + wasm-bindgen compiled to WebAssembly
- Validation baseline: `cargo test --lib`, `wasm-pack build`, `npm run check`, `npm run lint`, `npm run test`, `npm run build`
<!-- GSD:stack-end -->

<!-- GSD:conventions-start source:.planning/codebase/CONVENTIONS.md -->
## Conventions

- Keep `AppState` state-only; do not move DOM nodes or service singletons into it
- Prefer extracted function-oriented modules for domain logic and shell helpers
- Keep plot builders pure where possible; keep DOM/Plotly wiring thin
- Use `frontend/src/utils/log.ts` instead of raw `console.*`
- Preserve existing analysis math, WASM interfaces, and mode-handler behavior unless a thin seam absolutely requires change
<!-- GSD:conventions-end -->

<!-- GSD:architecture-start source:.planning/codebase/ARCHITECTURE.md -->
## Architecture

- `frontend/src/main.ts` is the current composition/orchestration hotspot and the main stabilization target
- `frontend/src/state/AppState.ts` is the typed frontend state boundary
- `frontend/src/analysis/*`, `frontend/src/activity/*`, `frontend/src/modes/analysis/*`, and `frontend/src/plots/*` already hold extracted logic
- `frontend/src/components/MapVisualization.ts` is a secondary hotspot; only touch it when it clearly supports the main shell extraction
<!-- GSD:architecture-end -->

<!-- GSD:workflow-start source:GSD defaults -->
## GSD Workflow Enforcement

Before making repo changes, prefer entering through a GSD workflow so planning artifacts and execution context stay aligned.

Use these entry points:
- `/gsd-quick` for small fixes and ad-hoc tasks
- `/gsd-debug` for investigation and bug fixing
- `/gsd-plan-phase 1` / `/gsd-discuss-phase 1` for planned stabilization work
- `/gsd-execute-phase 1` once a phase plan exists

Do not bypass the current stabilization invariants:
- preserve auto-scroll to Analysis Parameters after file load
- preserve in-place GPS updates with tab/scroll retention
- preserve correct GPS-based air-speed calibration behavior
<!-- GSD:workflow-end -->

<!-- GSD:profile-start -->
## Developer Profile

> Profile not yet configured. Run `/gsd-profile-user` to generate your developer profile.
> This section is managed by `generate-claude-profile` - do not edit manually.
<!-- GSD:profile-end -->
