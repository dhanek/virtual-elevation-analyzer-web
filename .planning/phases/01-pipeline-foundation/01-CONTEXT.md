# Phase 1: Pipeline Foundation - Context

**Gathered:** 2026-04-22
**Status:** Ready for planning

<domain>
## Phase Boundary

Fix latent air-speed calibration bugs in Standard VE mode where changes in air-speed calibration don't trigger re-calculation and plot updates; establish unified render/update pipeline across Standard, GPS-lap, and Out-and-back modes.

</domain>

<decisions>
## Implementation Decisions

### Pipeline abstraction
- **D-01:** Centralized `handleParametersChange` in orchestrator (`frontend/src/shell/analysis/analyzeOrchestrator.ts`) as single source of truth for all parameter-change-triggered updates
- **D-02:** All parameter changes (CdA, Crr, trim start/end, air_speed_offset, airSpeedCalibrationPercent) trigger re-calculation through the centralized handler
- **D-03:** Mode-specific update functions are called by the orchestrator based on current mode, not by disparate slider events in each mode

### Air-speed calibration fix
- **D-04:** Bug is in trigger wiring, not in calibration math itself
- **D-05:** Fix ensures `air_speed_offset` and `airSpeedCalibrationPercent` changes propagate to calculation and plot updates in Standard VE mode
- **D-06:** Same trigger behavior applies consistently across Standard, GPS-lap, and Out-and-back modes

### Test strategy
- **D-07:** Add integration tests that verify parameter changes trigger the expected update calls
- **D-08:** Tests use mocked DOM and assert that update functions are called with correct parameters
- **D-09:** Tests work with existing Vitest infrastructure (node environment with mocks)
- **D-10:** No WASM runtime or full browser required for tests

### Mode-specific implementation
- **D-11:** Keep mode-specific semantics explicit in implementations
- **D-12:** Unified pipeline interface allows mode-specific implementations while sharing update orchestration

### Verification approach
- **D-13:** Use integration tests to verify trigger wiring works (primary verification)
- **D-14:** Manual browser verification as secondary check for end-to-end correctness

### Agent's Discretion
- Exact implementation details of the centralized handler
- Specific test file locations and naming conventions
- Whether to refactor existing trigger logic or add wrapper layer

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Pipeline and update flow
- `frontend/src/shell/analysis/analyzeOrchestrator.ts` - Centralized parameter change handler and orchestrator
- `frontend/src/shell/ve/bindStandardSliders.ts` - Standard VE slider binding and plot update (current trigger wiring)
- `frontend/src/shell/gpsLap/updateGpsLap.ts` - GPS lap update mechanism
- `frontend/src/shell/outAndBack/updateOutAndBack.ts` - Out-and-back update mechanism
- `frontend/src/state/AppState.ts` - State model (airSpeedCalibrationPercent property)

### Testing infrastructure
- `frontend/src/analysis/AirSpeedCalibration.test.ts` - Existing unit tests for calibration math
- `frontend/src/shell/analysis/prepareAnalysisPayload.test.ts` - Example of mock-based test patterns
- `frontend/vitest.config.ts` - Vitest configuration

### Air-speed calibration
- `frontend/src/analysis/AirSpeedCalibration.ts` - Calibration math functions
- `frontend/src/analysis/WindSourceResolver.ts` - Air speed offset and calibration application

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- `handleParametersChange` function already exists in orchestrator - needs enhancement to be comprehensive
- Existing integration test patterns in `prepareAnalysisPayload.test.ts` using mocked dependencies
- Vitest configured with node environment - tests run without browser/WASM

### Established Patterns
- AppState holds `airSpeedCalibrationPercent` in `analysis` namespace
- `AnalysisParametersComponent.setParameters()` triggers `onParametersChange` callback
- Slider event listeners trigger update functions (e.g., trimStartSlider dispatchEvent pattern)

### Integration Points
- `analyzeOrchestrator.ts` is the composition point between parameters and analysis modes
- Mode handlers in `frontend/src/modes/analysis/` provide mode-specific behavior
- Each shell module (ve, gpsLap, outAndBack) has its own render/update functions

### Known Issue Location
- `bindStandardSliders.ts` lines 400-450: Air speed calibration slider binding - needs to be triggered through centralized handler
- `handleParametersChange` in orchestrator (lines ~125-230): Currently doesn't handle air_speed_offset changes for Standard VE mode

</code_context>

<specifics>
## Specific Ideas

- "The bug was that changes in air-speed calibration did not trigger calculation and plots, not that the calculation itself was wrong"
- Keep mode-specific semantics explicit - don't over-abstract into "shared" code that hides differences
- All parameter changes (CdA, Crr, start/stop, air speed) need to trigger re-calculation consistently

</specifics>

<deferred>
## Deferred Ideas

None - discussion stayed within phase scope

</deferred>

---

*Phase: 01-pipeline-foundation*
*Context gathered: 2026-04-22*