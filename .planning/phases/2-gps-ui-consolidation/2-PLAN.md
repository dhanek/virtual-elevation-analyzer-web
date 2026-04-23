---
phase: 2
wave: 1
depends_on: []
requirements_addressed: [GPS-01, GPS-02]
files_modified:
  - frontend/src/components/AnalysisParameters.ts
  - frontend/src/shell/section3/renderSection3Template.ts
  - frontend/src/shell/section3/section3Orchestration.ts
  - frontend/src/shell/section3/bindLapSelection.ts
  - frontend/src/shell/analysis/analyzeOrchestrator.ts
  - frontend/src/shell/fileLoad/fileLoadOrchestration.ts
  - frontend/src/shell/dem/demHandlers.ts
  - frontend/src/utils/ParameterStorage.ts
  - frontend/src/state/AppState.ts
  - frontend/src/analysis/WindSourceResolver.test.ts
  - frontend/src/analysis/SegmentSupplementarySeries.test.ts
  - frontend/src/shell/analysis/prepareAnalysisPayload.test.ts
autonomous: true
---

# Phase 2: GPS UI Consolidation - Plan

**Phase:** 2
**Wave:** 1
**Goal:** Move GPS analysis mode selector from Analysis Parameters into Section 3 near lap-selection UI; ensure state synchronization.

## Objective

User can access GPS analysis mode selector from Section 3 sidebar near lap-selection controls. Mode selection state is synchronized across all relevant UI locations. GPS mode state lives in Section 3 shell as single source of truth (per D-04).

---

## Tasks

### Task 1: Add GPS Mode State to Section 3 Orchestration

<read_first>
- frontend/src/shell/section3/section3Orchestration.ts
</read_first>

<action>
Add GPS mode state to the `Section3Dependencies` interface and implement the following changes:

1. Add a `gpsAnalysisMode` field to `Section3Dependencies` interface with type `'None' | 'GPS based lap splitting' | 'GPS based out and back' | 'GPS gate one way'` initialized to `'None'`

2. Create a `getGpsAnalysisMode()` getter function that returns the current mode

3. Create a `setGpsAnalysisMode(mode: string)` function that:
   - Updates the GPS mode state
   - If mode changes from non-"None" to "None", clears GPS detections per D-07
   - If mode changes to a different mode, clears previous detections per D-07
   - Calls `updateGpsMarkerButtonState()` to refresh UI visibility
   - Calls `updateOutAndBackButtonState()` to refresh UI visibility
   - Updates map visualization if mode changes (clear existing lap markers)

4. Update `runGpsLapDetection()` at line 200 to use `getGpsAnalysisMode()` instead of `deps.appState.currentParameters?.auto_lap_detection`

5. Update `updateGpsMarkerButtonState()` at line 450 to use `getGpsAnalysisMode()` instead of `deps.appState.currentParameters?.auto_lap_detection`

6. Update `updateOutAndBackButtonState()` at line 396 to use `getGpsAnalysisMode()` instead of `deps.appState.currentParameters?.auto_lap_detection`
</action>

<acceptance_criteria>
- grep "getGpsAnalysisMode" frontend/src/shell/section3/section3Orchestration.ts contains function definition
- grep "setGpsAnalysisMode" frontend/src/shell/section3/section3Orchestration.ts contains function definition
- grep "currentParameters?.auto_lap_detection" frontend/src/shell/section3/section3Orchestration.ts returns NO results (replaced by getGpsAnalysisMode)
- GPS mode state defaults to 'None'
</acceptance_criteria>

---

### Task 2: Update Section 3 Template with GPS Mode Selector

<read_first>
- frontend/src/shell/section3/renderSection3Template.ts
- frontend/src/shell/section3/section3Orchestration.ts (check for existing patterns)
- .planning/phases/2-gps-ui-consolidation/02-UI-SPEC.md
</read_first>

<action>
Update `renderSection3Template()` to include the GPS mode selector dropdown:

1. Add `gpsAnalysisMode: string` to `Section3TemplateInput` interface

2. Add GPS mode selector dropdown at the TOP of the sidebar content (above Lap Selection panel per D-01):
   ```html
   <div class="gps-mode-selector">
       <label for="gpsAnalysisMode">GPS Analysis Mode</label>
       <select id="gpsAnalysisMode">
           <option value="None">None</option>
           <option value="GPS based lap splitting">GPS based lap splitting</option>
           <option value="GPS based out and back">GPS based out and back</option>
           <option value="GPS gate one way">GPS gate one way</option>
       </select>
   </div>
   ```

3. Add `data-gps-mode="<mode>"` attribute to the `<select>` element for binding

4. Pass `gpsAnalysisMode` to determine panel visibility:
   - `showGpsLapDetection = hasGpsData && isGpsLapSelectionMode(gpsAnalysisMode)`
   - `showOutAndBack = hasGpsData && gpsAnalysisMode === 'GPS based out and back'`
   - Import `isGpsLapSelectionMode` from section3Orchestration.ts

5. Apply styling per UI-SPEC.md:
   - Border: 1px solid #d4d4d4
   - Border-radius: 2px
   - Padding: 0.5rem
   - Background: white
   - Font-size: 14px
   - Label: "GPS Analysis Mode" positioned above (14px, weight 500, color #2d3748)
</action>

<acceptance_criteria>
- grep "gpsAnalysisMode" frontend/src/shell/section3/renderSection3Template.ts returns matches
- grep 'id="gpsAnalysisMode"' frontend/src/shell/section3/renderSection3Template.ts returns 1 match
- grep "GPS Analysis Mode" frontend/src/shell/section3/renderSection3Template.ts returns 1 match
- grep "value=\"None\"" frontend/src/shell/section3/renderSection3Template.ts returns 1 match
- grep "value=\"GPS based lap splitting\"" frontend/src/shell/section3/renderSection3Template.ts returns 1 match
- Template accepts gpsAnalysisMode parameter and uses it for panel visibility
</acceptance_criteria>

---

### Task 3: Bind GPS Mode Selector Event Handler

<read_first>
- frontend/src/shell/section3/bindLapSelection.ts
- frontend/src/shell/section3/section3Orchestration.ts (check setGpsAnalysisMode)
</read_first>

<action>
Create event binding for the GPS mode selector in `bindLapSelection.ts`:

1. Export a new function `bindGpsModeSelector()` that:
   - Selects the `#gpsAnalysisMode` element
   - Sets initial value from `getGpsAnalysisMode()`
   - Adds `change` event listener that calls `setGpsAnalysisMode()` with selected value
   - Returns the cleanup function

2. Import `getGpsAnalysisMode` and `setGpsAnalysisMode` from section3Orchestration.ts

3. Update the return statement of the module to include the new binding

4. If `bindLapSelection.ts` doesn't export the main binding function, add the event binding to `section3Orchestration.ts` initializeSection3() function instead (after template render, before existing bindings)
</action>

<acceptance_criteria>
- grep "bindGpsModeSelector" frontend/src/shell/section3/bindLapSelection.ts OR frontend/src/shell/section3/section3Orchestration.ts returns matches
- grep "gpsAnalysisMode" frontend/src/shell/section3/*.ts returns matches for event binding
- GPS mode selector change triggers setGpsAnalysisMode call
</acceptance_criteria>

---

### Task 4: Remove auto_lap_detection from Analysis Parameters

<read_first>
- frontend/src/components/AnalysisParameters.ts
- frontend/src/shell/app/initializeApplication.ts (check for any references)
</read_first>

<action>
Remove `auto_lap_detection` field from AnalysisParameters component:

1. Remove from `AnalysisParameters` interface (line 12-17):
   ```typescript
   auto_lap_detection: 'None' | 'GPS based lap splitting' | 'GPS based out and back' | 'GPS gate one way';
   ```

2. Remove from `DEFAULT_PARAMETERS` object:
   ```typescript
   auto_lap_detection: 'None',
   ```

3. Remove the dropdown HTML and event listener for `auto_lap_detection` from `render()` method (in the param-compact-grid section)

4. Remove from `handleParameterChange()` - remove the line that reads auto_lap_detection value

5. Remove from `updateUI()` - remove the line that sets auto_lap_detection value

6. Search entire codebase for any remaining references to `auto_lap_detection` and remove or update them
</action>

<acceptance_criteria>
- grep "auto_lap_detection" frontend/src/components/AnalysisParameters.ts returns NO results
- grep "Auto Lap Detection" frontend/src/components/AnalysisParameters.ts returns NO results
- grep "id=\"auto_lap_detection\"" frontend/src/components/AnalysisParameters.ts returns NO results
- grep "auto_lap_detection" frontend/src/ returns NO results outside of comments
</acceptance_criteria>

---

### Task 5: Update initializeSection3 to Pass GPS Mode

<read_first>
- frontend/src/shell/section3/section3Orchestration.ts
- frontend/src/shell/section3/renderSection3Template.ts
</read_first>

<action>
Update `initializeSection3()` function to pass the GPS mode to the template:

1. In `initializeSection3()`, get the current GPS mode: `const gpsMode = getGpsAnalysisMode();`

2. Pass `gpsMode` to `renderSection3Template()` call

3. Move `bindGpsModeSelector()` call to `initializeSection3()` (after template render, before other bindings)

4. After mode selector is bound, sync the select element value with state in case of persistence (should be 'None' per D-12)
</action>

<acceptance_criteria>
- grep "renderSection3Template" frontend/src/shell/section3/section3Orchestration.ts shows gpsMode parameter passed
- grep "bindGpsModeSelector" frontend/src/shell/section3/section3Orchestration.ts returns matches
</acceptance_criteria>

---

### Task 6: Verify State Synchronization

<read_first>
- frontend/src/shell/section3/section3Orchestration.ts
- frontend/src/shell/section3/renderSection3Template.ts
</read_first>

<action>
Verify and fix any state synchronization issues:

1. When GPS mode changes:
   - Panel visibility updates immediately (no "Apply" button per D-06)
   - Map visualization updates (per D-09, D-10)
   - Previous detections cleared if mode changed (per D-07)

2. Check that `updateGpsMarkerButtonState()` and `updateOutAndBackButtonState()` are called when mode changes

3. Verify map markers are cleared when switching modes:
   - In `setGpsAnalysisMode()`, add calls to clear map visualization
   - Add: `deps.getMapVisualization()?.clearDetectedLaps();`
   - Add: `deps.getMapVisualization()?.clearGpsMarker();`
   - Add: `deps.getMapVisualization()?.clearOutAndBackMarkers();`

4. Test that switching between modes doesn't leave stale UI state
</action>

<acceptance_criteria>
- grep "clearDetectedLaps" frontend/src/shell/section3/section3Orchestration.ts returns matches in setGpsAnalysisMode
- grep "clearGpsMarker" frontend/src/shell/section3/section3Orchestration.ts returns matches in setGpsAnalysisMode
- grep "clearOutAndBackMarkers" frontend/src/shell/section3/section3Orchestration.ts returns matches in setGpsAnalysisMode
</acceptance_criteria>

---

## Verification Criteria

| ID | Criterion |
|----|-----------|
| V1 | User opens Section 3 and sees GPS mode selector near top of sidebar |
| V2 | GPS mode selector has correct options: None, GPS based lap splitting, GPS based out and back, GPS gate one way |
| V3 | Selecting a mode shows the appropriate detection panel (GPS lap or Out & Back) |
| V4 | Selecting "None" hides all GPS detection panels |
| V5 | Switching modes clears previous detections (verified via map markers disappearing) |
| V6 | Analysis Parameters no longer has GPS mode selector |
| V7 | Mode selection persists correctly when switching between FIT laps |
| V8 | All CI checks pass (cargo test, wasm-pack build, npm run check, npm run lint, npm run test, npm run build) |

## Must-Haves for Goal-Backward Verification

1. **GPS mode selector visible in Section 3** - User can access from the new location
2. **No GPS mode selector in Analysis Parameters** - Verify original location is clean
3. **State synchronization works** - Mode changes immediately affect behavior without apply button
4. **Map reflects mode changes** - Visualization updates instantly

---

## Additional References Found

The following files also reference `auto_lap_detection` and need updates:

| File | Reference | Action |
|------|-----------|--------|
| `analyzeOrchestrator.ts` | Checks if mode changed to re-render Section 3 | Update to use Section 3 state |
| `fileLoadOrchestration.ts` | Reads mode for file load initialization | May need removal |
| `ParameterStorage.ts` | Default value in storage | Remove field |
| `demHandlers.ts` | Reads mode for DEM handling | May need removal |

## Dependencies

- Phase 1: Pipeline Foundation (completed) - provides the Section 3 shell structure

## Notes

- Per D-12: No persistence of last used mode - always starts at "None" when GPS file loaded
- Per D-08: FIT lap selection state is preserved across mode switches
- GPS mode state lives in Section 3 shell, not AppState (per D-04)

---


### Task 7: Update analyzeOrchestrator.ts (Section 3 Re-render Logic)

<read_first>
- frontend/src/shell/analysis/analyzeOrchestrator.ts
- frontend/src/shell/section3/section3Orchestration.ts
</read_first>

<action>
Update the analyzeOrchestrator to remove `auto_lap_detection` dependency:

1. Find and remove the code block that tracks `previousAutoLapDetection` in `handleParametersChange()`

2. Remove the conditional block that re-renders Section 3 based on `lapDetectionChanged`

3. Remove `previousAutoLapDetection` from `UiState` interface in `AppState.ts` (if it's only used for this comparison)

4. Search for any other uses of `previousAutoLapDetection` and remove them
</action>

<acceptance_criteria>
- grep "previousAutoLapDetection" frontend/src/shell/analysis/analyzeOrchestrator.ts returns NO results
- grep "auto_lap_detection" frontend/src/shell/analysis/analyzeOrchestrator.ts returns NO results
- grep "lapDetectionChanged" frontend/src/shell/analysis/analyzeOrchestrator.ts returns NO results
</acceptance_criteria>

---

### Task 8: Update Other Files Referencing auto_lap_detection

<read_first>
- frontend/src/shell/fileLoad/fileLoadOrchestration.ts
- frontend/src/shell/dem/demHandlers.ts
- frontend/src/utils/ParameterStorage.ts
</read_first>

<action>
Remove or update `auto_lap_detection` references in other files:

1. **fileLoadOrchestration.ts** - Remove or update reference to `auto_lap_detection`

2. **demHandlers.ts** - Remove or update reference to `auto_lap_detection`

3. **ParameterStorage.ts** - Remove `auto_lap_detection: 'None'` from default objects

4. **Test files** - Update test fixtures:
   - `WindSourceResolver.test.ts`
   - `SegmentSupplementarySeries.test.ts`
   - `prepareAnalysisPayload.test.ts`
   - Remove `auto_lap_detection` field from test parameter objects
</action>

<acceptance_criteria>
- grep "auto_lap_detection" frontend/src/shell/fileLoad/fileLoadOrchestration.ts returns NO results
- grep "auto_lap_detection" frontend/src/shell/dem/demHandlers.ts returns NO results
- grep "auto_lap_detection" frontend/src/utils/ParameterStorage.ts returns NO results
- grep "auto_lap_detection" frontend/src/analysis/*.test.ts returns NO results
</acceptance_criteria>
