# Roadmap: Virtual Elevation Analyzer Web

## Overview

This roadmap delivers a targeted stabilization phase for the remaining frontend UI shell. The work is intentionally staged: first lock in guardrails and regression-sensitive behavior, then extract the largest `frontend/src/main.ts` responsibilities into narrower shell modules, then finish the main reduction and update planning/docs with the new boundaries. The goal is not a rewrite - it is to make future UI-heavy work safer without destabilizing the browser-based analysis experience that already works today.

## Phases

**Phase Numbering:**
- Integer phases (1, 2, 3): Planned milestone work
- Decimal phases (2.1, 2.2): Urgent insertions if needed during execution

- [ ] **Phase 1: Guardrails and Regression Protection** - Lock in invariants, validation, and extraction seams before moving high-risk shell code
- [ ] **Phase 2: Shell Infrastructure and Delegation** - Introduce shared shell helpers and move top-level orchestration toward explicit module seams
- [ ] **Phase 3: Section 3 and Standard VE Shell Extraction** - Extract Section 3 and standard VE shell behavior while preserving current standard-mode behavior
- [ ] **Phase 4: GPS and Out-and-Back Shell Extraction** - Extract GPS-based shell behavior while preserving in-place updates and calibration correctness
- [ ] **Phase 5: Closeout, Secondary Cleanup, and Roadmap Sync** - Finish the `main.ts` reduction, apply only justified secondary cleanup, and sync planning/docs

## Phase Details

### Phase 1: Guardrails and Regression Protection
**Goal**: Make the fragile UI-shell behavior explicit, lock the validation contract, and define the first safe extraction seams before moving major feature logic out of `frontend/src/main.ts`
**Depends on**: Nothing (first phase)
**Requirements**: [STAB-01, STAB-02]
**UI hint**: yes
**Canonical refs**: [.planning/PROJECT.md, .planning/REQUIREMENTS.md, .planning/research/SUMMARY.md, frontend/src/main.ts, frontend/src/state/AppState.ts, frontend/src/analysis/AirSpeedCalibration.ts, frontend/src/analysis/MultiSegmentSettings.ts, frontend/src/modes/analysis/AnalysisModes.ts, frontend/src/components/MapVisualization.ts]
**Success Criteria** (what must be TRUE):
  1. The stabilization phase has an explicit regression verification path for auto-scroll, GPS in-place updates, and GPS calibration behavior.
  2. CI parity remains the default checkpoint contract for the refactor work.
  3. The first shell boundaries and extraction targets are documented clearly enough that later phase planning does not depend on rediscovering the same hotspots.
**Plans**: 3 plans

Plans:
- [x] 01-01: Capture regression-sensitive UI-shell invariants and verification checklist
- [ ] 01-02: Decide and wire the practical regression verification path for fragile browser flows
- [x] 01-03: Prepare the first `main.ts` delegation seams and extraction inventory

### Phase 2: Shell Infrastructure and Delegation
**Goal**: Introduce shared shell helpers and move top-level UI-shell orchestration toward explicit module seams without changing analysis semantics
**Depends on**: Phase 1
**Requirements**: [SHEL-01, SHEL-02]
**UI hint**: yes
**Canonical refs**: [.planning/PROJECT.md, .planning/REQUIREMENTS.md, frontend/src/main.ts, frontend/src/state/AppState.ts, frontend/src/components/AnalysisParameters.ts, frontend/src/plots/PlotContext.ts, frontend/src/plots/StandardPlotBuilders.ts, frontend/src/utils/log.ts]
**Success Criteria** (what must be TRUE):
  1. Repeated DOM, event, and template patterns have a shared home instead of being duplicated across shell code paths.
  2. `frontend/src/main.ts` delegates top-level shell responsibilities through explicit module seams rather than continuing to own every implementation detail directly.
  3. `AppState` remains state-only and the refactor does not collapse new DOM/service responsibilities into it.
**Plans**: 3 plans

Plans:
- [ ] 02-01: Extract shared DOM, event, and template helper seams for shell code
- [ ] 02-02: Define shell module interfaces and dependency wiring from `main.ts`
- [ ] 02-03: Move top-level workflow orchestration toward delegated shell modules

### Phase 3: Section 3 and Standard VE Shell Extraction
**Goal**: Extract Section 3 and standard VE shell behavior into narrower modules while preserving standard analysis behavior and file-load navigation behavior
**Depends on**: Phase 2
**Requirements**: [SHEL-03, SHEL-04, BEHV-01, BEHV-02]
**UI hint**: yes
**Canonical refs**: [.planning/PROJECT.md, .planning/REQUIREMENTS.md, frontend/src/main.ts, frontend/src/components/FitFileProcessor.ts, frontend/src/components/AnalysisParameters.ts, frontend/src/activity/ActivityLoader.ts, frontend/src/modes/analysis/standardMode.ts, frontend/src/plots/StandardPlotBuilders.ts]
**Success Criteria** (what must be TRUE):
  1. User still auto-scrolls to Analysis Parameters after a successful FIT or CSV file load.
  2. User can configure and run standard virtual elevation analysis with unchanged visible behavior and analysis outputs.
  3. Section 3 and standard VE shell logic live outside `frontend/src/main.ts` behind narrower module boundaries.
**Plans**: 3 plans

Plans:
- [ ] 03-01: Extract Section 3 lap-selection and GPS-detection shell behavior
- [ ] 03-02: Extract standard VE panel render, bind, and update shell behavior
- [ ] 03-03: Re-integrate preserved standard-mode behaviors and checkpoint validation

### Phase 4: GPS and Out-and-Back Shell Extraction
**Goal**: Extract GPS-lap and out-and-back shell behavior into dedicated modules while preserving in-place updates, tab/scroll retention, and GPS calibration correctness
**Depends on**: Phase 3
**Requirements**: [SHEL-05, SHEL-06, BEHV-03, BEHV-04]
**UI hint**: yes
**Canonical refs**: [.planning/PROJECT.md, .planning/REQUIREMENTS.md, frontend/src/main.ts, frontend/src/modes/analysis/gpsLapMode.ts, frontend/src/modes/analysis/outAndBackMode.ts, frontend/src/analysis/AirSpeedCalibration.ts, frontend/src/analysis/MultiSegmentSettings.ts, frontend/src/plots/MultiSegmentPlotBuilders.ts, frontend/src/utils/GpsLapDetection.ts]
**Success Criteria** (what must be TRUE):
  1. GPS in-place updates preserve active tab and scroll position during auto-adjust and slider changes.
  2. GPS lap, GPS gate one-way, and out-and-back modes retain correct air-speed calibration behavior after shell extraction.
  3. GPS-lap and out-and-back shell logic live outside `frontend/src/main.ts` behind narrower module boundaries.
**Plans**: 3 plans

Plans:
- [ ] 04-01: Extract GPS-lap shell render, tab, and update behavior
- [ ] 04-02: Extract out-and-back shell render and update behavior
- [ ] 04-03: Validate preserved GPS in-place update and calibration behavior at checkpoint depth

### Phase 5: Closeout, Secondary Cleanup, and Roadmap Sync
**Goal**: Finish the `main.ts` reduction, apply only clearly justified secondary cleanup, and sync planning/docs with the stabilized shell boundaries
**Depends on**: Phase 4
**Requirements**: [CLOS-01, CLOS-02]
**UI hint**: yes
**Canonical refs**: [.planning/PROJECT.md, .planning/REQUIREMENTS.md, .planning/research/SUMMARY.md, frontend/src/main.ts, frontend/src/components/MapVisualization.ts, ARCHITECTURE.md, ROADMAP.md]
**Success Criteria** (what must be TRUE):
  1. `frontend/src/main.ts` functions primarily as a composition root and is materially smaller than the pre-phase baseline.
  2. Any touched `frontend/src/components/MapVisualization.ts` changes remain secondary and reduce coupling instead of expanding scope.
  3. Planning/project docs reflect the stabilized shell boundaries and the next set of remaining hotspots accurately.
**Plans**: 2 plans

Plans:
- [ ] 05-01: Finish residual `main.ts` cleanup and only justified secondary UI-shell touch-ups
- [ ] 05-02: Sync roadmap/project documentation and remaining hotspot guidance

## Progress

**Execution Order:**
Phases execute in numeric order: 1 → 2 → 3 → 4 → 5

| Phase | Plans Complete | Status | Completed |
|-------|----------------|--------|-----------|
| 1. Guardrails and Regression Protection | 2/3 | In Progress|  |
| 2. Shell Infrastructure and Delegation | 0/3 | Not started | - |
| 3. Section 3 and Standard VE Shell Extraction | 0/3 | Not started | - |
| 4. GPS and Out-and-Back Shell Extraction | 0/3 | Not started | - |
| 5. Closeout, Secondary Cleanup, and Roadmap Sync | 0/2 | Not started | - |
