# Roadmap: Virtual Elevation Analyzer Web v1.1

**Milestone:** v1.1 Enhancement Wave
**Created:** 2026-04-22
**Total Phases:** 6
**Total Requirements:** 16

## Phase Overview

| Phase | Name | Goal | Requirements | Success Criteria | Status |
| ----- | ---- | ---- | ----------- | ---------------- | ------ |
| 1 | Pipeline Foundation | Fix air-speed calibration bugs; establish unified update pipeline | PIPE-01, PIPE-02, PIPE-03 | 4 | ✓ Complete |
| 2 | GPS UI Consolidation | Relocate GPS mode selector to Section 3 with state sync | GPS-01, GPS-02 | 3 |
| 3 | Worker Offload | Background VE computation for slider responsiveness | PERF-01 | 3 |
| 4 | Smoothing Clarity | Document and implement consistent smoothing ownership | SMOOTH-01, SMOOTH-02 | 3 |
| 5 | CSS + Map Cleanup | Structural CSS improvements; MapVisualization refactor | CSS-01, CSS-02, MAP-01, MAP-02 | 4 |
| 6 | Weather Spike | Exploratory spike with go/no-go decision | WEATH-01, WEATH-02, WEATH-03, TEST-01 | 4 |

---

## Phase 1: Pipeline Foundation

**Goal:** Fix latent air-speed calibration bugs in Standard VE mode; establish unified render/update pipeline across all analysis modes.

### Requirements

- **PIPE-01**: User gets correct air-speed calibration results in Standard VE mode (fix latent bugs)
- **PIPE-02**: User observes consistent render/update behavior across Standard, GPS-lap, and Out-and-back modes
- **PIPE-03**: Maintainer can run unified analysis pipeline with mode-specific implementations

### Success Criteria

1. User runs Standard VE analysis with air-speed calibration and gets correct results (verified against known test case)
2. User switches between Standard, GPS-lap, and Out-and-back modes and observes consistent update patterns
3. Maintainer can add a new analysis mode without modifying shared pipeline code
4. All CI checks pass (cargo test, wasm-pack build, npm run check, npm run lint, npm run test, npm run build)

### Key Decisions

- Keep mode-specific semantics explicit in implementations
- Air-speed bug fix documented with before/after behavior description
- Pipeline interface allows mode-specific implementations while sharing update orchestration

### Risks

- Over-abstraction: Keep mode differences explicit rather than hiding in "shared" code
- Behavior drift: Document what air-speed "bugs" were and verify fixes don't break existing workarounds

---

## Phase 2: GPS UI Consolidation

**Goal:** Move GPS analysis mode selector from Analysis Parameters into Section 3 near lap-selection UI; ensure state synchronization.

### Requirements

- **GPS-01**: User can access GPS analysis mode selector from Section 3 near lap-selection UI (relocated from Analysis Parameters)
- **GPS-02**: User's GPS mode selection state stays synchronized across all relevant UI locations

### Success Criteria

1. User opens Section 3 and sees GPS analysis mode selector near lap-selection controls
2. User selects GPS mode in Section 3 and it correctly affects analysis behavior
3. GPS mode state remains synchronized when switching between modes, refreshing data, or navigating

### Key Decisions

- GPS mode state lives in AppState as single source of truth
- Section 3 shell reads/writes GPS mode state
- GPS mode selector removed from Analysis Parameters (or becomes read-only indicator)

### Risks

- State sync gap: Map all GPS mode state dependencies before UI move
- Duplicate controls: Ensure no lingering GPS mode selector in old location

---

## Phase 3: Worker Offload

**Goal:** Improve slider interaction responsiveness during multi-lap VE analysis through background computation.

**Note:** This phase is contingent on profiling data confirming main-thread blocking. If profiling shows no blocking issue, skip this phase and proceed to Phase 4.

### Requirements

- **PERF-01**: User experiences responsive slider interactions during multi-lap VE analysis (profile first, implement worker offload only if profiling confirms main-thread blocking)

### Success Criteria

1. Profile data confirms main thread blocking during multi-lap recompute (if not, skip to Phase 4)
2. User adjusts slider during multi-lap analysis and UI remains responsive (no visible freeze)
3. User sees progress indication for long computations; computation can be cancelled by new input

### Key Decisions

- Start with debounced main-thread updates as v1 implementation
- Add Web Worker only if debounce doesn't solve responsiveness issue
- Worker lifecycle properly managed (terminate on module destroy)

### Risks

- Premature complexity: Profile before adding workers
- Transfer overhead: Use transferable objects to avoid clone cost

---

## Phase 4: Smoothing Clarity

**Goal:** Clarify where elevation smoothing belongs (data processing vs visualization layer) and implement consistently.

### Requirements

- **SMOOTH-01**: Maintainer knows where elevation smoothing is applied (data layer vs visualization layer ownership documented)
- **SMOOTH-02**: User observes consistent smoothing behavior across all analysis modes

### Success Criteria

1. Maintainer can explain where elevation smoothing is applied (data layer)
2. User runs analysis in Standard, GPS-lap, and Out-and-back modes and gets same smoothing results
3. Smoothing parameters affect all analysis modes consistently

### Key Decisions

- Elevation smoothing applied at data layer (recommended approach)
- Single source of truth for smoothing parameters
- Visualization layer may show comparison (raw vs smoothed) but doesn't apply smoothing

### Risks

- Multiple layers: Ensure smoothing not duplicated in visualization layer
- Parameter naming: Standardize smoothing parameter names across modes

---

## Phase 5: CSS + Map Cleanup

**Goal:** Address CSS debt from v1.0 stabilization; improve MapVisualization.ts structure (minimum).

### Requirements

- **CSS-01**: User sees cleaner, more consistent UI styling without layout regressions
- **CSS-02**: Maintainer can work with organized CSS patterns (debt reduction from v1.0)
- **MAP-01**: Maintainer can work with MapVisualization.ts without full rewrite (structural improvement minimum)
- **MAP-02**: User sees no behavioral changes to map visualization from v1.0 (visual polish optional)

### Success Criteria

1. User loads ride and interacts with map; behavior matches v1.0 (no visual changes unless approved)
2. Maintainer can navigate MapVisualization.ts structure without documentation
3. User sees no layout regressions in CSS changes (manual verification checklist)
4. CSS patterns are organized and follow consistent naming/conventions

### Key Decisions

- Map cleanup is structural only (minimum); visual polish is optional
- CSS cleanup preserves visual behavior; pattern organization only
- Both work on parallel tracks within same phase

### Risks

- Scope expansion: Map is structural minimum, no visual changes unless explicitly approved
- CSS visual drift: Establish visual baseline before changes

---

## Phase 6: Weather Spike

**Goal:** Exploratory spike for continuous weather sampling with per-quarter-hour interpolation; make go/no-go decision.

### Requirements

- **WEATH-01**: User gets weather data for entire ride duration (per-quarter-hour sampling with interpolation)
- **WEATH-02**: Maintainer can make go/no-go decision on continuous weather sampling after spike (with explicit success criteria)
- **WEATH-03**: User experiences graceful degradation when weather API is unavailable
- **TEST-01**: Maintainer has appropriate test coverage for new and changed functionality per feature area

### Success Criteria

1. Spike demonstrates weather data for rides longer than current sampling (per-quarter-hour vs current)
2. Spike includes go/no-go criteria: interpolation quality, API reliability, implementation complexity
3. If go: User sees continuous weather data with interpolation for longer rides
4. If no-go: Weather spike documented with rationale for deferral

### Key Decisions

- Timeboxed spike: 1-2 weeks maximum
- Explicit go/no-go criteria defined upfront:
  - Interpolation quality meets user expectations
  - API reliability is acceptable
  - Implementation complexity fits timeline
- Graceful degradation always implemented regardless of spike outcome

### Risks

- Scope creep: Spike stays exploratory until go decision
- Timebox overrun: Hard stop at original timebox
- Integration complexity: Weather API integration may reveal issues

---

## Requirements Traceability

| Requirement | Phase | Status |
| ----------- | ----- | ------ |
| PERF-01 | Phase 3 | Pending |
| PIPE-01 | Phase 1 | Pending |
| PIPE-02 | Phase 1 | Pending |
| PIPE-03 | Phase 1 | Pending |
| GPS-01 | Phase 2 | Pending |
| GPS-02 | Phase 2 | Pending |
| SMOOTH-01 | Phase 4 | Pending |
| SMOOTH-02 | Phase 4 | Pending |
| WEATH-01 | Phase 6 | Pending |
| WEATH-02 | Phase 6 | Pending |
| WEATH-03 | Phase 6 | Pending |
| MAP-01 | Phase 5 | Pending |
| MAP-02 | Phase 5 | Pending |
| TEST-01 | Phase 6 | Pending |
| CSS-01 | Phase 5 | Pending |
| CSS-02 | Phase 5 | Pending |

**Coverage:**
- v1.1 requirements: 16 total
- Mapped to phases: 16 ✓
- Unmapped: 0 ✓

---

## Phase Dependencies

```
Phase 1 (Pipeline Foundation)
    ├── Phase 2 (GPS UI) - GPS state sync uses existing state model
    └── Phase 3 (Worker) - Worker integrates with unified pipeline
Phase 4 (Smoothing) - Can proceed independently, uses Phase 1 pipeline
Phase 5 (CSS + Map) - Can proceed independently
Phase 6 (Weather) - Can spike independently, TEST-01 depends on all phases
```

---

## Risks and Mitigations

| Risk | Phase | Mitigation |
| ---- | ----- | ---------- |
| Over-abstracted pipeline | Phase 1 | Keep mode-specific semantics explicit |
| GPS state sync gap | Phase 2 | Map dependencies before UI move |
| Premature workerization | Phase 3 | Profile first, debounce first |
| Multiple smoothing layers | Phase 4 | Document ownership, single source |
| Map scope expansion | Phase 5 | Hard scope boundary (structural only) |
| Weather scope creep | Phase 6 | Timebox + go/no-go gate |

---

## Constraints

- **No breaking changes**: VE calculation logic must remain unchanged
- **Browser-local privacy**: Ride data stays in browser
- **Regression protection**: All existing CI checks must pass throughout

---
*Roadmap created: 2026-04-22 for v1.1 Enhancement Wave*
*6 phases | 16 requirements | 100% coverage*
