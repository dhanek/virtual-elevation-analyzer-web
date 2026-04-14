# Virtual Elevation Analyzer Web

## What This Is

Virtual Elevation Analyzer Web is a privacy-first browser application for cyclists that analyzes FIT and CSV ride data using Robert Chung virtual elevation. It runs as a static frontend with a Rust/WebAssembly compute core, supports standard and GPS-based analysis workflows, and keeps ride processing in the browser rather than sending data to an application server.

## Core Value

Make trustworthy virtual elevation analysis of local ride data work well in the browser, without sacrificing correctness or forcing users through a fragile UI shell.

## Requirements

### Validated

- ✓ User can load FIT files in the browser and parse ride/lap data through the Rust/WASM core - existing
- ✓ User can load CSV activity data and normalize it into the shared frontend activity model - existing
- ✓ User can run standard virtual elevation analysis with persisted analysis parameters - existing
- ✓ User can run GPS-based lap splitting, out-and-back, and GPS gate one-way analysis flows - existing
- ✓ User can visualize ride data through plots and an interactive map workflow - existing
- ✓ User can use DEM and weather-assisted analysis inputs with browser-local persistence and caching - existing
- ✓ Project changes can be validated through backend tests, wasm build, frontend typecheck, lint, tests, and production build - existing

### Active

- [ ] Reduce the size and responsibility concentration of `frontend/src/main.ts` by extracting UI-shell logic into narrower modules
- [ ] Preserve current user-visible behavior while refactoring, including regression-sensitive scrolling, GPS auto-adjust, calibration, and in-place update flows
- [ ] Extract or simplify Section 3, VE panel, GPS-lap, out-and-back, and shared DOM/event/template glue so future UI-heavy work is safer
- [ ] Touch `frontend/src/components/MapVisualization.ts` only when it cleanly supports the main UI-shell stabilization work
- [ ] Keep room for the occasional small feature or behavior adjustment only when it directly enables or de-risks the structural refactor

### Out of Scope

- Broad backend algorithm refactor wave - the current phase is centered on frontend UI-shell stabilization
- UI redesign or framework migration - the goal is safer structure, not changing the product surface or moving to React/Vue/etc.
- Large feature expansion unrelated to stabilization - the next phase should reduce risk before another UI-heavy feature wave
- Worker/offload work by default - only revisit if profiling later shows the stabilized UI is still compute-bound

## Context

This is a brownfield TypeScript + Rust/WASM repository with a completed codebase map in `.planning/codebase/`. The app is already functional and deployable, with FIT/CSV ingestion, VE analysis, DEM/weather integration, multi-mode analysis, persistence, and CI validation already in place.

The main remaining architectural pressure point is concentrated frontend orchestration. `frontend/src/main.ts` is still very large and event-heavy, and `frontend/src/components/MapVisualization.ts` remains a secondary hotspot. Earlier refactoring work already extracted typed state, activity loading, analysis helpers, plot builders, mode handlers, logging, tests, and CSS, so the next leverage point is the remaining UI shell rather than another broad foundational rewrite.

Recent work also surfaced regression-sensitive behavior that must remain intact during this phase:

- auto-scroll to Analysis Parameters after successful file load
- in-place GPS auto-adjust and slider updates preserving active tab and scroll position
- correct GPS-based air-speed calibration behavior across GPS-based modes

This phase exists to make subsequent UI/workflow work safer, clearer, and less likely to break existing analysis behavior.

## Constraints

- **Tech stack**: Keep the current browser-first TypeScript + Vite frontend and Rust/WASM backend - the product already works on this stack and the phase is structural, not a platform rewrite
- **Architecture**: `AppState` must remain state-only - avoid turning it into a god object by mixing DOM nodes or service singletons into state
- **Behavior**: Preserve existing analysis math, WASM interfaces, plot builders, and mode-handler architecture unless only a thin seam is needed for extraction - correctness is more important than aggressive reorganization
- **Scope**: Prioritize shrinking `frontend/src/main.ts`; treat `frontend/src/components/MapVisualization.ts` as secondary - the goal is focused stabilization, not boiling the ocean
- **Validation**: Maintain CI-style confidence with `cargo test --lib`, `wasm-pack build`, `npm run check`, `npm run lint`, `npm run test`, and `npm run build` - this phase must protect working behavior while changing structure
- **Deployment**: Continue to support the current static GitHub Pages deployment model - no server-side architecture should be introduced
- **Privacy**: Keep ride processing browser-local - existing privacy-first behavior is part of the product identity

## Key Decisions

| Decision | Rationale | Outcome |
| -------- | --------- | ------- |
| Use the codebase map and live code as the source of truth for initialization | The repo is brownfield and older planning docs contain historical or stale material | ✓ Good |
| Center the next phase on targeted frontend UI-shell stabilization | The largest remaining risk is concentrated in `frontend/src/main.ts`, not in missing infrastructure | - Pending |
| Keep `MapVisualization.ts` secondary rather than making it a co-equal refactor target | The highest-value reduction is still in `main.ts`; map changes should only happen when they clearly support that work | - Pending |
| Allow occasional small behavior/feature adjustments only when they directly enable the refactor | A strict purity rule would make some necessary seams or lifecycle fixes harder, but broad feature work would dilute the phase | - Pending |
| Preserve regression-sensitive behaviors explicitly during the stabilization phase | Recent fixes around auto-scroll and GPS calibration are easy to accidentally break during UI-shell extraction | ✓ Good |
| Keep `AppState` state-only and avoid a new god-object rewrite | The project already established a healthier state boundary and should not regress during the next phase | ✓ Good |

## Evolution

This document evolves at phase transitions and milestone boundaries.

**After each phase transition** (via `/gsd-transition`):
1. Requirements invalidated? → Move to Out of Scope with reason
2. Requirements validated? → Move to Validated with phase reference
3. New requirements emerged? → Add to Active
4. Decisions to log? → Add to Key Decisions
5. "What This Is" still accurate? → Update if drifted

**After each milestone** (via `/gsd-complete-milestone`):
1. Full review of all sections
2. Core Value check - still the right priority?
3. Audit Out of Scope - reasons still valid?
4. Update Context with current state

---
*Last updated: 2026-04-12 after initialization*
