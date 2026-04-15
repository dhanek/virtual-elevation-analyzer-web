# Phase 3: Section 3 and Standard VE Shell Extraction - Research

**Researched:** 2026-04-15
**Domain:** Brownfield frontend UI-shell refactoring
**Confidence:** HIGH

## User Constraints (from CONTEXT.md)
- **D-01:** Fully extract Section 3 shell logic (lap selection, GPS detection panel setup).
- **D-02:** Fully extract standard Virtual Elevation panel render, bind, and update logic.
- **D-03:** Keep `AppState` state-only. Use the `ShellServices` dependency injection pattern established in Phase 2.
- **D-04:** Defer GPS-lap and out-and-back shell extraction to Phase 4.
- **D-05:** Preserve auto-scroll to Analysis Parameters after a successful FIT or CSV file load (BEHV-01).
- **D-06:** Preserve standard virtual elevation analysis with unchanged visible behavior and analysis outputs (BEHV-02).

## Current Code Findings

### 1. Remaining `initializeSection3` Logic
In Phase 2, the HTML template rendering and the lap checkbox binding were extracted to `frontend/src/shell/section3/`. What remains in `initializeSection3` in `main.ts` is:
- Binding the GPS gate sliders (`gpsGateSlider`, `gpsGateValue`) and the "detect laps" button.
- Binding the Out-and-back gate sliders (`oabGateASlider`, `oabGateBSlider`) and the "detect sections" button.
- Map initialization via `MapVisualization`.
- Map trim slider bindings.

These bindings should be extracted into `frontend/src/shell/section3/` modules (e.g., `bindGpsDetection.ts`, `bindOutAndBackDetection.ts`, `bindMapTrim.ts`). The top-level `initializeSection3` should become a simple orchestrator that delegates to these binders.

### 2. Standard VE Panel Behavior
The standard VE panel logic is currently scattered across:
- `showVirtualElevationAnalysisInline`: Renders the plots, sets up tab switching (already using the Phase 2 helper), sets up action footers (already using the Phase 2 helper).
- `initializeVEAnalysis`: Prepares inputs and calls plot builders.
- `setupVESliders`: Extremely large function (601 lines) that binds `rhoSlider`, `cdaSlider`, `crrSlider`, `trimStartSlider`, `trimEndSlider`, handles auto-rho, and synchronizes with map trim controls.
- `calculateAutoRho`: Auto-rho calculation logic.
- `updateVEPlotsWithWindSource` / `updateVEPlots`: Update functions.

These should be moved into `frontend/src/shell/ve/` (e.g., `renderStandardVe.ts`, `bindStandardVeSliders.ts`, `autoRho.ts`). They will use `ShellServices` and `AnalysisPayload` interfaces defined in Phase 2.

### 3. File-Load Navigation
In `processFitFile` and `processCsvFile`, after a successful load, the code calls `activateSection(2)` and `scrollToSection('parametersSection')`. These calls are straightforward and already work. When extracting `FitFileProcessor` or CSV loading callbacks, we must ensure these `scrollToSection` calls are retained. Since they are currently in `main.ts`, we just need to ensure we don't accidentally remove them when cleaning up.

## Validation Architecture

Phase 3 will rely on the CI parity checks and the manual UI-shell guardrails script.

### Automated baseline remains unchanged
```bash
bash scripts/validate-ui-shell-guardrails.sh --ci-only
```
Includes: `cargo test --lib`, `wasm-pack build`, `npm run check`, `npm run lint`, `npm run test`, `npm run build`.

### Manual guardrail contract
- `docs/testing/ui-shell-manual-checklist.md` must pass, particularly:
  - FIT/CSV auto-scroll to Analysis Parameters
  - Standard VE analysis behaves correctly (cda/crr changes update plots).

## Architecture Recommendations

1. **Section 3 Extraction:**
   - Create `frontend/src/shell/section3/bindGpsDetection.ts`
   - Create `frontend/src/shell/section3/bindOutAndBackDetection.ts`
   - Update `initializeSection3` in `main.ts` to call these.

2. **Standard VE Shell Extraction:**
   - Create `frontend/src/shell/ve/renderStandardVe.ts` (moving `showVirtualElevationAnalysisInline` and `initializeVEAnalysis`).
   - Create `frontend/src/shell/ve/bindStandardSliders.ts` (moving `setupVESliders`).
   - Create `frontend/src/shell/ve/autoRho.ts` (moving `calculateAutoRho`).

3. **Dependency Injection:**
   - The newly extracted functions should take `ShellServices` or specific callbacks so they don't depend on global `appState` implicitly.
