# Roadmap: Virtual Elevation Analyzer Web

## Overview

This roadmap delivers a targeted stabilization phase for the remaining frontend UI shell. The work is intentionally staged: first lock in guardrails and regression-sensitive behavior, then extract the largest `frontend/src/main.ts` responsibilities into narrower shell modules, then finish the main reduction and update planning/docs with the new boundaries. The goal is not a rewrite - it is to make future UI-heavy work safer without destabilizing the browser-based analysis experience that already works today.

## Phases

**Phase Numbering:**
- Integer phases (1, 2, 3): Planned milestone work
- Decimal phases (2.1, 2.2): Urgent insertions if needed during execution

- [x] **Phase 1: Guardrails and Regression Protection** - Lock in invariants, validation, and extraction seams before moving high-risk shell code (completed 2026-04-14)
- [x] **Phase 2: Shell Infrastructure and Delegation** - Introduce shared shell helpers and move top-level orchestration toward explicit module seams (completed 2026-04-15)
- [x] **Phase 3: Section 3 and Standard VE Shell Extraction** - Extract Section 3 and standard VE shell behavior while preserving current standard-mode behavior (completed 2026-04-16)
- [x] **Phase 4: GPS and Out-and-Back Shell Extraction** - Extract GPS-based shell behavior while preserving in-place updates and calibration correctness (completed 2026-04-19)
- [x] **Phase 5: Closeout, Secondary Cleanup, and Roadmap Sync** - Finish the `main.ts` reduction, apply only justified secondary cleanup, and sync planning/docs (completed 2026-04-19)
- [x] **Phase 6: Verification Artifact Backfill (Phases 03-05)** - Backfill missing phase verification artifacts and parity evidence so requirement closure is machine-verifiable (completed 2026-04-20)
- [ ] **Phase 7: Phase-02 Summary Frontmatter Repair** - Backfill `requirements_completed` metadata for phase-02 summaries to resolve partial requirement closure state
- [ ] **Phase 8: Regression Contract Anchor Sync** - Re-anchor regression-contract documentation to current shell ownership paths

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
- [x] 01-02: Decide and wire the practical regression verification path for fragile browser flows
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
- [x] 02-01: Extract shared DOM, event, and template helper seams for shell code
- [x] 02-02: Define shell module interfaces and dependency wiring from `main.ts`
- [x] 02-03: Move top-level workflow orchestration toward delegated shell modules

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
- [x] 03-01: Extract Section 3 lap-selection and GPS-detection shell behavior (completed 2026-04-15)
- [x] 03-02: Extract standard VE panel render, bind, and update shell behavior (completed 2026-04-16)
- [x] 03-03: Re-integrate preserved standard-mode behaviors and checkpoint validation (completed 2026-04-16)

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
- [x] 04-01: Extract GPS-lap shell render, tab, and update behavior
- [x] 04-02: Extract out-and-back shell render and update behavior
- [x] 04-03: Validate preserved GPS in-place update and calibration behavior at checkpoint depth

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
- [x] 05-01: Finish residual `main.ts` cleanup and only justified secondary UI-shell touch-ups
- [x] 05-02: Sync roadmap/project documentation and remaining hotspot guidance

### Phase 6: Verification Artifact Backfill (Phases 03-05)
**Goal**: Close milestone-blocking orphaned requirement gaps by creating missing phase verification artifacts and strengthening parity evidence where audit depth was partial
**Depends on**: Phase 5
**Requirements**: [SHEL-03, SHEL-04, BEHV-01, BEHV-02, SHEL-05, SHEL-06, BEHV-03, BEHV-04, CLOS-01, CLOS-02]
**Gap Closure**: Closes requirement and flow gaps from `.planning/v1.0-v1.0-MILESTONE-AUDIT.md` tied to missing `03/04/05-VERIFICATION.md` and BEHV-02 parity-evidence depth
**UI hint**: yes
**Canonical refs**: [.planning/REQUIREMENTS.md, .planning/v1.0-v1.0-MILESTONE-AUDIT.md, .planning/phases/03-section-3-and-standard-ve-shell-extraction, .planning/phases/04-gps-and-out-and-back-shell-extraction, .planning/phases/05-closeout-secondary-cleanup-and-roadmap-sync, docs/testing/ui-shell-regression-contract.md]
**Success Criteria** (what must be TRUE):
  1. `03-VERIFICATION.md`, `04-VERIFICATION.md`, and `05-VERIFICATION.md` exist with explicit requirement coverage and evidence.
  2. BEHV-02 standard VE parity evidence is elevated to the same artifact quality as other preserved-behavior flows.
  3. Previously orphaned requirements mapped to phases 03-05 are no longer orphaned in the 3-source requirement matrix.
**Plans**: 4 plans

Plans:
- [x] 06-01: Create Phase 03 verification artifact with requirement-evidence matrix (completed 2026-04-19)
- [x] 06-02: Create Phase 04 verification artifact with in-place update and calibration evidence matrix (completed 2026-04-19)
- [x] 06-03: Create Phase 05 verification artifact with closeout requirement evidence matrix (completed 2026-04-20)
- [x] 06-04: Strengthen BEHV-02 parity artifact depth and re-check matrix consistency (completed 2026-04-20)

### Phase 7: Phase-02 Summary Frontmatter Repair
**Goal**: Resolve partial requirement closure for Phase 2 by backfilling summary frontmatter metadata needed by the 3-source audit matrix
**Depends on**: Phase 6
**Requirements**: [SHEL-01, SHEL-02]
**Gap Closure**: Closes requirement gaps from `.planning/v1.0-v1.0-MILESTONE-AUDIT.md` where `02-VERIFICATION.md` passed but summary `requirements_completed` metadata is missing
**UI hint**: no
**Canonical refs**: [.planning/REQUIREMENTS.md, .planning/v1.0-v1.0-MILESTONE-AUDIT.md, .planning/phases/02-shell-infrastructure-and-delegation/02-01-SUMMARY.md, .planning/phases/02-shell-infrastructure-and-delegation/02-02-SUMMARY.md, .planning/phases/02-shell-infrastructure-and-delegation/02-03-SUMMARY.md, .planning/phases/02-shell-infrastructure-and-delegation/02-VERIFICATION.md]
**Success Criteria** (what must be TRUE):
  1. Every Phase-02 summary includes accurate `requirements_completed` frontmatter.
  2. SHEL-01 and SHEL-02 no longer appear partial in the 3-source requirement matrix.
  3. Phase-02 requirement evidence remains consistent across plan, summary, and verification artifacts.
**Plans**: 3 plans

Plans:
- [x] 07-01-PLAN.md — Backfill canonical frontmatter + requirements-completed for 02-01 summary
- [ ] 07-02-PLAN.md — Backfill canonical frontmatter + requirements-completed for 02-02 and 02-03 summaries
- [ ] 07-03-PLAN.md — Run focused SHEL-01/SHEL-02 matrix sanity check and record evidence

### Phase 8: Regression Contract Anchor Sync
**Goal**: Restore regression-contract documentation linkage quality by updating contract anchors to the current post-extraction shell ownership paths
**Depends on**: Phase 7
**Requirements**: [STAB-01]
**Gap Closure**: Closes integration gap from `.planning/v1.0-v1.0-MILESTONE-AUDIT.md` for regression-contract anchor drift
**UI hint**: no
**Canonical refs**: [.planning/REQUIREMENTS.md, .planning/v1.0-v1.0-MILESTONE-AUDIT.md, docs/testing/ui-shell-regression-contract.md, frontend/src/shell]
**Success Criteria** (what must be TRUE):
  1. Regression-contract anchors resolve to current shell modules instead of legacy `main.ts` anchors.
  2. STAB-01 regression verification path remains explicit and actionable after re-anchoring.
  3. Audit no longer flags docs-to-shell anchor drift for this milestone.
**Plans**: 0 plans

Plans:
- [ ] 08-01: Update regression-contract anchors to current shell ownership files
- [ ] 08-02: Validate and document anchor integrity against current shell module structure

## Progress

**Execution Order:**
Phases execute in numeric order: 1 → 2 → 3 → 4 → 5 → 6 → 7 → 8

| Phase | Plans Complete | Status | Completed |
|-------|----------------|--------|-----------|
| 1. Guardrails and Regression Protection | 3/3 | Complete | 2026-04-14 |
| 2. Shell Infrastructure and Delegation | 3/3 | Complete | 2026-04-15 |
| 3. Section 3 and Standard VE Shell Extraction | 3/3 | Complete | 2026-04-16 |
| 4. GPS and Out-and-Back Shell Extraction | 3/3 | Complete | 2026-04-19 |
| 5. Closeout, Secondary Cleanup, and Roadmap Sync | 2/2 | Complete | 2026-04-19 |
| 6. Verification Artifact Backfill (Phases 03-05) | 4/4 | Complete | 2026-04-20 |
| 7. Phase-02 Summary Frontmatter Repair | 0/3 | Planned | - |
| 8. Regression Contract Anchor Sync | 0/2 | Planned | - |
