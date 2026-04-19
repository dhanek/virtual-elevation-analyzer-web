# Requirements: Virtual Elevation Analyzer Web

**Defined:** 2026-04-12
**Core Value:** Make trustworthy virtual elevation analysis of local ride data work well in the browser, without sacrificing correctness or forcing users through a fragile UI shell.

## v1 Requirements

Requirements for this stabilization initiative. Each maps to exactly one roadmap phase.

### Stabilization Safety

- [x] **STAB-01**: Maintainer can verify regression-sensitive UI-shell behavior through a repeatable verification path instead of relying on memory alone
- [x] **STAB-02**: Project continues to pass backend tests, wasm build, frontend typecheck, lint, unit tests, and production build at stabilization checkpoints

### Shell Architecture

- [x] **SHEL-01**: Maintainer can delegate top-level UI-shell orchestration through explicit shell modules instead of embedding those responsibilities throughout `frontend/src/main.ts`
- [x] **SHEL-02**: Maintainer has shared DOM, event, and template helpers for repeated dynamic shell patterns instead of re-implementing the same wiring per panel
- [x] **SHEL-03**: Maintainer can change Section 3 lap-selection and GPS-detection UI behavior without editing unrelated analysis-panel code in `frontend/src/main.ts`
- [x] **SHEL-04**: Maintainer can change standard VE panel shell behavior without editing unrelated GPS-lap or out-and-back shell code in `frontend/src/main.ts`
- [x] **SHEL-05**: Maintainer can change GPS-lap shell behavior without editing unrelated standard VE or out-and-back shell code in `frontend/src/main.ts`
- [x] **SHEL-06**: Maintainer can change out-and-back shell behavior without editing unrelated standard VE or GPS-lap shell code in `frontend/src/main.ts`

### Behavior Preservation

- [x] **BEHV-01**: User still auto-scrolls to Analysis Parameters after a successful FIT or CSV file load
- [x] **BEHV-02**: User can run standard virtual elevation analysis after shell extraction with unchanged visible behavior and analysis outputs
- [x] **BEHV-03**: User keeps active tab and scroll position during in-place GPS auto-adjust and slider updates after shell extraction
- [x] **BEHV-04**: User gets correct GPS-based air-speed calibration behavior across GPS lap, GPS gate one-way, and out-and-back modes after shell extraction

### Closeout

- [x] **CLOS-01**: Maintainer ends the phase with `frontend/src/main.ts` functioning primarily as a composition root and materially smaller than the pre-phase baseline
- [x] **CLOS-02**: Maintainer can understand the stabilized shell boundaries and remaining hotspots from updated planning/project documentation at phase close

## v2 Requirements

Deferred until the main shell stabilization proves its value.

### Validation and Testing

- **TEST-01**: Maintainer has browser-level smoke coverage for the highest-risk upload, scroll, tab-preservation, and GPS update flows if manual verification proves too brittle

### Secondary Cleanup

- **MAP-01**: Maintainer can reduce `frontend/src/components/MapVisualization.ts` through explicit lifecycle helpers if shell extraction proves it is the next bottleneck
- **CSS-01**: Maintainer can further reduce remaining dynamic HTML and inline-style hotspots after the main shell extraction settles

### Performance Follow-Up

- **PERF-01**: Maintainer re-profiles UI update performance after stabilization before considering worker or offload work

## Out of Scope

Explicitly excluded for this stabilization initiative.

| Feature | Reason |
| ------- | ------ |
| Framework migration | Would turn a targeted stabilization effort into a rewrite and blur regression attribution |
| UI redesign | The goal is structural safety, not changing the product surface |
| Broad backend refactor | The current risk is concentrated in the frontend UI shell, not the WASM analysis core |
| Worker/offload work by default | Existing profiling does not justify it as the first move for this phase |
| Unrelated feature expansion | This project is meant to reduce risk before the next UI-heavy feature wave |

## Traceability

Which phases cover which requirements. Updated during roadmap creation.

| Requirement | Phase | Status |
| ----------- | ----- | ------ |
| STAB-01 | Phase 1 | Complete |
| STAB-02 | Phase 1 | Complete |
| SHEL-01 | Phase 2 | Complete |
| SHEL-02 | Phase 2 | Complete |
| SHEL-03 | Phase 3 | Complete |
| SHEL-04 | Phase 3 | Complete |
| BEHV-01 | Phase 3 | Complete |
| BEHV-02 | Phase 3 | Complete |
| SHEL-05 | Phase 4 | Complete |
| SHEL-06 | Phase 4 | Complete |
| BEHV-03 | Phase 4 | Complete |
| BEHV-04 | Phase 4 | Complete |
| CLOS-01 | Phase 5 | Complete |
| CLOS-02 | Phase 5 | Complete |

**Coverage:**
- v1 requirements: 14 total
- Mapped to phases: 14
- Unmapped: 0 ✓

---
*Requirements defined: 2026-04-12*
*Last updated: 2026-04-19 after Phase 5 completion*
