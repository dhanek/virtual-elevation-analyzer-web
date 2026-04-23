---
wave: 1
depends_on: []
requirements_addressed:
  - PIPE-01
  - PIPE-02
  - PIPE-03
files_modified:
  - frontend/src/shell/analysis/analyzeOrchestrator.ts
  - frontend/src/shell/ve/bindStandardSliders.ts
autonomous: true
---

# Plan: Phase 1 - Pipeline Foundation (Centralized Parameter Handler)

**Phase:** 1
**Wave:** 1
**Status:** Ready for execution

## Objective

Fix latent air-speed calibration bugs in Standard VE mode; establish unified render/update pipeline across all analysis modes.

## Problem Statement

Changes in `air_speed_offset` and `airSpeedCalibrationPercent` do not trigger correct VE plot updates in Standard VE mode:
1. `air_speed_offset` slider calls `setParameters` (triggers orchestrator) but orchestrator doesn't route to VE update
2. `airSpeedCalibrationPercent` direct state mutation + local `updateVEPlots` call bypasses orchestrator

## Tasks

### Task 1: Fix air_speed_offset in handleParametersChange

<read_first>
- frontend/src/shell/analysis/analyzeOrchestrator.ts (lines 125-230, handleParametersChange function)
- frontend/src/shell/ve/bindStandardSliders.ts (lines 470-500, updateAirSpeedOffset function)
- frontend/src/state/AppState.ts (analysis state with airSpeedCalibrationPercent)
</read_first>

<action>
In `analyzeOrchestrator.ts`, add detection for `air_speed_offset` changes in `handleParametersChange`. When `air_speed_offset` changes and VE section is visible (check `veSection && !veSection.classList.contains("hidden")`), dispatch `input` event on `trimStartSlider` to trigger recalculation.

The current code already dispatches for VE visibility - extend it to also handle air_speed_offset specifically:

```typescript
// Check if air_speed_offset changed (new parameter in this fix)
const airSpeedOffsetChanged = // detect air_speed_offset in parameters

if (veSection && !veSection.classList.contains("hidden")) {
    const trimStartSlider = document.getElementById("trimStartSlider") as HTMLInputElement;
    if (trimStartSlider) {
        // Check if this is a Standard VE mode (not GPS-lap or Out-and-back)
        const isStandardMode = !document.getElementById('gpsLapSection')?.classList.contains('hidden') === false 
            && !document.getElementById('outAndBackSection')?.classList.contains('hidden');
        
        if (isStandardMode || airSpeedOffsetChanged) {
            trimStartSlider.dispatchEvent(new Event("input", { bubbles: true }));
        }
    }
}
```

Update `bindStandardSliders.ts` to remove the duplicate `updateVEPlots` call in `updateAirSpeedOffset` since the orchestrator will handle it now. Keep the error metric update and `saveCurrentLapSettings()`.
</action>

<acceptance_criteria>
- grep "airSpeedOffsetChanged" frontend/src/shell/analysis/analyzeOrchestrator.ts returns the new variable declaration
- grep "dispatchEvent.*input.*trimStartSlider" frontend/src/shell/analysis/analyzeOrchestrator.ts finds the trigger code
- grep "updateAirSpeedOffset" frontend/src/shell/ve/bindStandardSliders.ts no longer has duplicate updateVEPlots call after fix
</acceptance_criteria>

---

### Task 2: Wire airSpeedCalibrationPercent through orchestrator

<read_first>
- frontend/src/shell/ve/bindStandardSliders.ts (lines 400-420, updateAirSpeedCalibration function)
- frontend/src/state/AppState.ts (analysis.airSpeedCalibrationPercent property)
</read_first>

<action>
Option A (Recommended): Add airSpeedCalibrationPercent detection to handleParametersChange

In `analyzeOrchestrator.ts`, track the previous `airSpeedCalibrationPercent` value and detect changes. When changed and VE is visible, trigger recalculation.

However, `airSpeedCalibrationPercent` lives in AppState, not in the AnalysisParameters object passed to `handleParametersChange`. So the orchestrator can't detect it directly from parameters.

Option B (Pragmatic): Keep local call but document the architectural decision

Since `airSpeedCalibrationPercent` is AppState-level (not persisted with file), it makes sense for it to bypass the parameter storage layer. The local `updateVEPlots` call is actually correct for this case.

Add a comment in `bindStandardSliders.ts` explaining why airSpeedCalibrationPercent uses local call:
```typescript
// airSpeedCalibrationPercent lives in AppState (not persisted per-file)
// so it bypasses the parameter storage layer and uses local update.
// This is intentional - it's a runtime adjustment, not a saved parameter.
```

Add a JSDoc-style documentation in `analyzeOrchestrator.ts` explaining which parameters trigger orchestrator updates and which don't.
</action>

<acceptance_criteria>
- grep "AppState.*not persisted" frontend/src/shell/ve/bindStandardSliders.ts finds the explanatory comment
- grep "parameter.*orchestrator" frontend/src/shell/analysis/analyzeOrchestrator.ts finds documentation about which parameters trigger updates
</acceptance_criteria>

---

### Task 3: Add integration test for parameter change → update wiring

<read_first>
- frontend/src/shell/analysis/prepareAnalysisPayload.test.ts (existing test pattern)
- frontend/src/shell/analysis/analyzeOrchestrator.ts (handleParametersChange function)
- frontend/vitest.config.ts
</read_first>

<action>
Create new test file: `frontend/src/shell/analysis/parameterChangeHandler.test.ts`

```typescript
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import type { AnalyzeOrchestratorDependencies } from './analyzeOrchestrator';
import { configureAnalyzeOrchestrator, handleParametersChange } from './analyzeOrchestrator';

// Mock dependencies
const mockAppState = {
    previousAutoLapDetection: 'None',
    currentParameters: null,
    isLoadingParameters: false,
    currentFileHash: 'test-hash',
    selectedFile: { name: 'test.fit' },
    currentFitData: {},
    currentLaps: [],
    gpsLapDetectionResult: null,
    gpsDetectedLaps: [],
    gpsSelectedLaps: [],
    outAndBackSections: [],
    outAndBackSelectedSections: [],
};

const mockParameterStorage = {
    saveParameters: vi.fn().mockResolvedValue(undefined),
};

const mockResultsStorage = {
    saveResult: vi.fn().mockResolvedValue(undefined),
};

const mockGetMapVisualization = () => null;
const mockGetParametersComponent = () => null;
const mockSetParametersComponent = vi.fn();
const mockInitializeSection3 = vi.fn();
const mockShowLoading = vi.fn();
const mockHideLoading = vi.fn();
const mockShowError = vi.fn();

describe('handleParametersChange', () => {
    let deps: AnalyzeOrchestratorDependencies;

    beforeEach(() => {
        deps = {
            appState: mockAppState as any,
            parameterStorage: mockParameterStorage as any,
            resultsStorage: mockResultsStorage as any,
            getMapVisualization: mockGetMapVisualization,
            getParametersComponent: mockGetParametersComponent,
            setParametersComponent: mockSetParametersComponent,
            initializeSection3: mockInitializeSection3,
            showLoading: mockShowLoading,
            hideLoading: mockHideLoading,
            showError: mockShowError,
        };
        configureAnalyzeOrchestrator(deps);
    });

    afterEach(() => {
        vi.clearAllMocks();
    });

    it('triggers VE update when air_speed_offset changes', async () => {
        // Setup: VE section visible with trimStartSlider
        const veSection = document.createElement('div');
        veSection.id = 'veSection';
        document.body.appendChild(veSection);

        const trimStartSlider = document.createElement('input');
        trimStartSlider.id = 'trimStartSlider';
        document.body.appendChild(trimStartSlider);

        const dispatchSpy = vi.spyOn(trimStartSlider, 'dispatchEvent');

        // Set initial parameters
        mockAppState.currentParameters = {
            air_speed_offset: 2,
            // ... other required params
        } as any;

        // Change air_speed_offset
        await handleParametersChange({
            ...mockAppState.currentParameters,
            air_speed_offset: 5,  // Changed from 2
        } as any);

        // Verify: trimStartSlider dispatchEvent called (triggering VE recalc)
        expect(dispatchSpy).toHaveBeenCalled();

        // Cleanup
        document.body.removeChild(veSection);
        document.body.removeChild(trimStartSlider);
    });

    it('does not trigger update when parameters are loading from storage', async () => {
        mockAppState.isLoadingParameters = true;
        
        const veSection = document.createElement('div');
        veSection.id = 'veSection';
        document.body.appendChild(veSection);

        const trimStartSlider = document.createElement('input');
        trimStartSlider.id = 'trimStartSlider';
        document.body.appendChild(trimStartSlider);

        const dispatchSpy = vi.spyOn(trimStartSlider, 'dispatchEvent');

        mockAppState.currentParameters = { air_speed_offset: 2 } as any;

        await handleParametersChange({
            ...mockAppState.currentParameters,
            air_speed_offset: 5,
        } as any);

        // Should not trigger when loading
        expect(dispatchSpy).not.toHaveBeenCalled();

        document.body.removeChild(veSection);
        document.body.removeChild(trimStartSlider);
    });
});
```

Run tests: `cd frontend && npm run test -- --run parameterChangeHandler`

Add to CI in `.github/workflows/deploy.yml` after existing frontend test step.
</action>

<acceptance_criteria>
- test "parameterChangeHandler.test.ts" frontend/src/shell/analysis/parameterChangeHandler.test.ts exists
- grep "describe.*handleParametersChange" frontend/src/shell/analysis/parameterChangeHandler.test.ts finds test suite
- grep "triggers VE update when air_speed_offset changes" frontend/src/shell/analysis/parameterChangeHandler.test.ts finds test case
- npm run test -- --run passes (may need adjustment based on actual orchestrator behavior)
</acceptance_criteria>

---

### Task 4: Verify mode consistency (Standard, GPS-lap, Out-and-back)

<read_first>
- frontend/src/shell/analysis/analyzeOrchestrator.ts (mode detection logic)
- frontend/src/shell/gpsLap/updateGpsLap.ts (GPS mode update)
- frontend/src/shell/outAndBack/updateOutAndBack.ts (OAB mode update)
- frontend/src/shell/ve/bindStandardSliders.ts (Standard mode update)
</read_first>

<action>
Audit the three mode update paths to ensure consistency:

**Standard VE Mode:**
- Parameters: CdA, Crr, trim start/end, air_speed_offset, airSpeedCalibrationPercent
- Update trigger: `updateVEPlots` function
- Currently: air_speed_offset and airSpeedCalibrationPercent work via local calls

**GPS-Lap Mode:**
- Parameters: CdA, Crr (wind source selector triggers different path)
- Update trigger: `updateGpsLapVEPlots` function
- Path: Mode handler → `recalculateGpsLapVE` → creates new analysis

**Out-and-Back Mode:**
- Parameters: CdA, Crr (wind source selector)
- Update trigger: `updateOutAndBackVEPlots` function
- Path: Mode handler → `recalculateOutAndBackVE` → creates new analysis

Add a documentation block in `analyzeOrchestrator.ts` summarizing the update paths:

```typescript
/**
 * Parameter update paths by mode:
 * 
 * Standard VE:
 *   - trim sliders → dispatchEvent → handleParametersChange → orchestrator
 *   - CdA/Crr sliders → local updateVEPlots call
 *   - air_speed_offset → setParameters → handleParametersChange → dispatchEvent
 *   - airSpeedCalibrationPercent → local updateVEPlots call (AppState-level, not persisted)
 * 
 * GPS-Lap:
 *   - CdA/Crr sliders → mode handler → recalculateGpsLapVE → showGpsLapVEAnalysis
 * 
 * Out-and-Back:
 *   - CdA/Crr sliders → mode handler → recalculateOutAndBackVE → showOutAndBackVEAnalysis
 */
```

Create a verification checklist in `REFACTORING_CHECKLIST.md`:

```markdown
## Pipeline Consistency Check (Phase 1 verification)

- [ ] air_speed_offset changes trigger VE recalculation in Standard mode
- [ ] airSpeedCalibrationPercent changes trigger VE recalculation in Standard mode
- [ ] GPS-lap mode updates work independently
- [ ] Out-and-back mode updates work independently
- [ ] No duplicate triggers when parameters change
```
</action>

<acceptance_criteria>
- grep "Parameter update paths" frontend/src/shell/analysis/analyzeOrchestrator.ts finds the documentation block
- grep "Pipeline Consistency Check" REFACTORING_CHECKLIST.md contains verification checklist
</acceptance_criteria>

---

## Success Criteria

1. User changes air_speed_offset in Standard VE mode → plots update with new wind calculation
2. User changes airSpeedCalibrationPercent → plots update with new calibration  
3. Parameter change tests pass
4. All CI checks pass (cargo test, wasm-pack build, npm run check, npm run lint, npm run test, npm run build)
5. Pipeline consistency documented

## Verification

After execution, run:
```bash
cd frontend && npm run test -- --run parameterChangeHandler
npm run test  # full test suite
```

Manual verification:
1. Load a FIT file with air-speed data
2. Open Standard VE analysis
3. Change air_speed_offset slider → plots should update
4. Change airSpeedCalibrationPercent slider → plots should update
5. Switch to GPS-lap mode → parameter changes should work correctly
6. Switch to Out-and-back mode → parameter changes should work correctly

---

*Plan created: 2026-04-22*
*Phase: 01-pipeline-foundation*