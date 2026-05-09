# Virtual Elevation Analyzer Web

## What This Is

Virtual Elevation Analyzer Web is a privacy-first browser application for cyclists that analyzes FIT and CSV ride data using Robert Chung virtual elevation. It runs as a static frontend with a Rust/WebAssembly compute core, supports standard and GPS-based analysis workflows, and keeps ride processing in the browser rather than sending data to an application server.

## Core Value

Make trustworthy virtual elevation analysis of local ride data work well in the browser, without sacrificing correctness or forcing users through a fragile UI shell.

## Current Milestone: v1.1 Enhancement Wave

**Goal:** Users can use the same VE analysis tool with identical results, better performance, enhanced features, and a cleaned design.

**Target features:**

- **Performance**: Worker offload for multi-lap VE analysis to improve slider responsiveness (combined with PERF-01)
- **Pipeline unification**: Fix latent air-speed calibration bugs in Standard VE mode; unify render/update pipeline across all modes
- **GPS mode UI consolidation**: Move GPS analysis mode selector from Analysis Parameters into Section 3 near lap-selection UI
- **Elevation smoothing**: Clarify data processing vs visualization layer ownership and implement consistently
- **Continuous weather sampling**: Exploratory spike for per-quarter-hour weather sampling with interpolation (go/no-go decision)
- **Map cleanup**: Improve MapVisualization.ts structure and optionally polish visuals (MAP-01)
- **Testing improvements**: Add/improve tests per feature area (TEST-01)
- **CSS cleanup**: Address CSS debt from v1.0 stabilization (CSS-01)

**Key constraints:**

- No breaking changes to VE calculation logic
- Must maintain browser-local privacy model

## Requirements

### Validated

- ✓ User can load FIT files in the browser and parse ride/lap data through the Rust/WASM core - existing
- ✓ User can load CSV activity data and normalize it into the shared frontend activity model - existing
- ✓ User can run standard virtual elevation analysis with persisted analysis parameters - existing
- ✓ User can run GPS-based lap splitting, out-and-back, and GPS gate one-way analysis flows - existing
- ✓ User can visualize ride data through plots and an interactive map workflow - existing
- ✓ User can use DEM and weather-assisted analysis inputs with browser-local persistence and caching - existing
- ✓ Project changes can be validated through backend tests, wasm build, frontend typecheck, lint, tests, and production build - existing
- ✓ Phase 1 established a committed UI-shell regression contract, manual browser checklist, CI-parity guardrail script, and hotspot inventory - validated in Phase 1
- ✓ Phase 2 introduced shared shell infrastructure and delegation seams away from `frontend/src/main.ts`
- ✓ Phase 3 extracted Section 3 and standard VE shell behavior while preserving auto-scroll and standard analysis behavior
- ✓ Phase 4 extracted GPS-lap and out-and-back shell behavior while preserving tab/scroll retention and calibration correctness
- ✓ Phase 5 reduced `frontend/src/main.ts` to composition-root wiring and synchronized planning/docs with the stabilized shell boundaries
- ✓ **PERF-01** profile-first responsiveness contract validated with deterministic gate artifacts and shared recompute runner (validated in Phase 3: Worker Offload)

### Active

- [ ] **PIPE-01**: Fix latent air-speed calibration bugs in Standard VE mode; unify render/update pipeline
- [ ] **GPS-01**: Move GPS analysis mode selector from Analysis Parameters into Section 3
- [ ] **SMOOTH-01**: Clarify elevation smoothing ownership (data vs visualization layer) and implement consistently
- [ ] **WEATH-01**: Spike continuous weather sampling with per-quarter-hour interpolation
- [ ] **MAP-01**: Address MapVisualization.ts complexity (structure minimum, visual polish ideal)
- [ ] **TEST-01**: Add/improve tests per feature area
- [ ] **CSS-01**: Address CSS debt identified during v1.0 stabilization

### Out of Scope

- Broad backend algorithm refactor wave - the current phase is centered on frontend enhancement, not core algorithm changes
- UI redesign or framework migration - the goal is cleaner implementation, not changing the product surface
- Large feature expansion unrelated to enhancement scope - focus is on the features listed in Current Milestone
- Breaking changes to VE calculation logic - correctness of existing analysis must be preserved

## Context

This is a brownfield TypeScript + Rust/WASM repository with a completed codebase map in `.planning/codebase/`. The app remains functional and deployable, with FIT/CSV ingestion, VE analysis, DEM/weather integration, multi-mode analysis, persistence, and CI validation in place.

The UI-shell stabilization milestone is now complete. `frontend/src/main.ts` has been reduced to composition-root responsibilities (DOM capture + service construction + shell bootstrap dispatch), while the previous orchestration hotspots now live in dedicated shell modules under `frontend/src/shell/` (`app`, `analysis`, `fileLoad`, `section3`, `dem`, plus prior `ve`, `gpsLap`, and `outAndBack`).

Regression-sensitive behavior remained the closeout guardrail throughout execution:

- auto-scroll to Analysis Parameters after successful file load
- in-place GPS auto-adjust and slider updates preserving active tab and scroll position
- correct GPS-based air-speed calibration behavior across GPS-based modes

`frontend/src/components/MapVisualization.ts` remains a secondary hotspot and was not expanded into full lifecycle decomposition during this milestone; MAP-01 remains deferred to v2.

## Constraints

- **Tech stack**: Keep the current browser-first TypeScript + Vite frontend and Rust/WASM backend - the product already works on this stack and the phase is structural, not a platform rewrite
- **Architecture**: `AppState` must remain state-only - avoid turning it into a god object by mixing DOM nodes or service singletons into state
- **Behavior**: Preserve existing analysis math, WASM interfaces, plot builders, and mode-handler architecture unless only a thin seam is needed for extraction - correctness is more important than aggressive reorganization
- **Scope**: Prioritize shrinking `frontend/src/main.ts`; treat `frontend/src/components/MapVisualization.ts` as secondary - the goal is focused stabilization, not boiling the ocean
- **Validation**: Maintain CI-style confidence with `cargo test --lib`, `wasm-pack build`, `npm run check`, `npm run lint`, `npm run test`, and `npm run build` - this phase must protect working behavior while changing structure
- **Deployment**: Continue to support the current static GitHub Pages deployment model - no server-side architecture should be introduced
- **Privacy**: Keep ride processing browser-local - existing privacy-first behavior is part of the product identity

## Key Decisions

| Decision                                                                              | Rationale                                                                                                             | Outcome |
| ------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------- | ------- |
| Use the codebase map and live code as the source of truth for initialization          | The repo is brownfield and older planning docs contain historical or stale material                                   | ✓ Good  |
| Center the next phase on targeted frontend UI-shell stabilization                     | The largest remaining risk is concentrated in `frontend/src/main.ts`, not in missing infrastructure                   | ✓ Good  |
| Keep `MapVisualization.ts` secondary rather than making it a co-equal refactor target | The highest-value reduction is still in `main.ts`; map changes should only happen when they clearly support that work | ✓ Good  |
| Keep closeout extraction structural-only (no behavior drift)                          | Regression-sensitive shell behavior had to remain stable while ownership moved across modules                         | ✓ Good  |
| Preserve regression-sensitive behaviors explicitly during the stabilization phase     | Recent fixes around auto-scroll and GPS calibration are easy to accidentally break during UI-shell extraction         | ✓ Good  |
| Keep `AppState` state-only and avoid a new god-object rewrite                         | The project already established a healthier state boundary and should not regress during the next phase               | ✓ Good  |

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

_Last updated: 2026-05-09 after Phase 3 completion_

_Previous milestone: v1.0 (UI Shell Stabilization) - completed 2026-04-22_
