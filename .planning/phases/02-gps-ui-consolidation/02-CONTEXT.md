# Phase 2: GPS UI Consolidation - Context

**Gathered:** 2026-04-23
**Status:** Ready for planning

<domain>
## Phase Boundary

Move GPS analysis mode selector from Analysis Parameters (Section 2) into Section 3 near lap-selection UI. Synchronize selection state so mode choice drives immediate panel visibility changes and detection behavior.

</domain>

<decisions>
## Implementation Decisions

### Mode selector placement
- **D-01:** Mode selector positioned above the lap list in Section 3 sidebar
- **D-02:** Selector appears as a dropdown control matching existing UI patterns in the sidebar

### State synchronization (GPS-02)
- **D-03:** Remove `auto_lap_detection` from `AnalysisParameters.ts` entirely - this is a MOVE, not a copy
- **D-04:** State lives in Section 3 shell module (`section3Orchestration.ts`)
- **D-05:** Mode state drives all downstream visibility and behavior without sync copies

### Mode switching behavior
- **D-06:** Mode switch triggers immediate behavior change - no "Apply" button
- **D-07:** Switching modes clears previous GPS detections (different algorithms produce different results)
- **D-08:** FIT lap selection state is preserved across mode switches
- **D-09:** Panel visibility updates instantly when mode changes
- **D-10:** Map visualization reflects current mode immediately

### Default mode
- **D-11:** Default mode is "None" when GPS file is loaded
- **D-12:** No persistence of last used mode - always starts at "None"

### Agent's Discretion
- Exact dropdown UI implementation and styling
- How to wire mode change to trigger detection panels
- Specific animation/transitions for panel visibility

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Section 3 and lap selection
- `frontend/src/shell/section3/section3Orchestration.ts` - Section 3 orchestration, mode state, lap selection handling
- `frontend/src/shell/section3/renderSection3Template.ts` - Section 3 template generation (lap list, GPS panels)
- `frontend/src/shell/section3/bindLapSelection.ts` - Lap selection event binding

### GPS detection
- `frontend/src/utils/GpsLapDetection.ts` - GPS lap and out-and-back detection algorithms

### State model
- `frontend/src/state/AppState.ts` - UiState interface with `gpsLapDetectionResult`, `outAndBackResult`, `isGpsLapModeActive`
- `frontend/src/components/AnalysisParameters.ts` - Remove `auto_lap_detection` field (currently lines 12-17)

### Mode handlers
- `frontend/src/shell/gpsLap/` - GPS lap shell module
- `frontend/src/shell/outAndBack/` - Out-and-back shell module

</canonical_refs>


## Existing Code Insights

### Reusable Assets
- `isGpsLapSelectionMode()` helper function exists in `section3Orchestration.ts` (lines 68-73)
- `showGpsLapDetection` and `showOutAndBack` flags already control panel visibility in template
- GPS detection logic already exists in `runGpsLapDetection()` and `runOutAndBackDetection()` functions
- Mode constants match: "None", "GPS based lap splitting", "GPS based out and back", "GPS gate one way"

### Established Patterns
- Section 3 template uses `showGpsLapDetection` and `showOutAndBack` boolean flags
- Lap selection uses `gpsSelectedLaps` array in AppState
- Map visualization is updated via `mapVisualization.showDetectedLaps()`

### Integration Points
- Mode selector needs to be added to `renderSection3Template.ts`
- Mode state triggers panel visibility in `section3Orchestration.ts`
- Removing from AnalysisParameters.ts requires updating `handleParameterChange()` and form rendering

</code_context>

<specifics>
## Specific Ideas

- "Move, not copy" - the mode selector should be removed from Analysis Parameters, not duplicated
- Immediate behavior change - no intermediate "apply" state needed
- GPS lap and out-and-back are mutually exclusive modes, not additive features

</specifics>

<deferred>
## Deferred Ideas

None - discussion stayed within phase scope

</deferred>

---

*Phase: 02-gps-ui-consolidation*
*Context gathered: 2026-04-23*