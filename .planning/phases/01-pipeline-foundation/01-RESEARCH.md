# Phase 1: Pipeline Foundation - Research

**Researched:** 2026-04-22
**Phase:** 1 - Pipeline Foundation
**Requirements:** PIPE-01, PIPE-02, PIPE-03

---

## Bug Analysis

### Root Cause

Changes in air-speed calibration do not trigger calculation and plot updates in Standard VE mode.

**The bug is in trigger wiring, NOT in calibration math.**

#### Issue 1: air_speed_offset slider bypasses orchestrator

In `bindStandardSliders.ts` lines 470-500:
```typescript
const updateAirSpeedOffset = () => {
    const value = parseInt(airSpeedOffsetSlider.value);
    if (parametersComponent && appState.currentParameters) {
        parametersComponent.setParameters({ air_speed_offset: value });  // ← triggers handleParametersChange
    }
    // ... updates error metric
    updateVEPlots(appState, analysisInput, trimStart, trimEnd);  // ← BUT this is a LOCAL call
    saveCurrentLapSettings();
};
```

**Problem:** The local `analysisInput` closure captures stale wind speed data. When `handleParametersChange` is called via `setParameters`, the orchestrator doesn't know to trigger VE plot updates for Standard mode.

#### Issue 2: handleParametersChange doesn't handle air_speed_offset for Standard VE

In `analyzeOrchestrator.ts` lines 125-230, `handleParametersChange` only:
1. Detects `auto_lap_detection` changes
2. Triggers auto-rho calculation
3. Dispatches `input` event on `trimStartSlider` (which only updates trim, not air-speed calibration)

**Missing:** No handling for `air_speed_offset` changes to trigger Standard VE re-render.

#### Issue 3: airSpeedCalibrationPercent bypasses orchestrator

In `bindStandardSliders.ts` lines 400-420:
```typescript
const updateAirSpeedCalibration = () => {
    appState.airSpeedCalibrationPercent = value;  // ← Direct state mutation
    updateVEPlots(appState, analysisInput, trimStart, trimEnd);  // ← Local call
};
```

**Problem:** This bypasses `handleParametersChange` entirely. While the local call works, it's inconsistent with the architecture decision to centralize parameter changes.

---

## Current Trigger Pattern Comparison

### Working Parameters (CdA, Crr, Trim Start/End)

All trigger through `updateVEPlots` → `updateVEPlotsWithWindSource` → creates new calculator → calculates VE → plots update.

### Broken Parameters (air_speed_offset, airSpeedCalibrationPercent)

- `air_speed_offset`: Calls `setParameters` (triggers orchestrator) but orchestrator doesn't route to VE update
- `airSpeedCalibrationPercent`: Direct state mutation + local `updateVEPlots` call

### GPS-Lap and Out-and-Back Modes

Both modes have their own update functions:
- `updateGpsLapVEPlots` - called by GPS mode handlers
- `updateOutAndBackVEPlots` - called by Out-and-Back mode handlers

These are triggered differently (through mode-specific handlers) and work correctly.

---

## Proposed Solution Architecture

### Decision: Centralize in handleParametersChange

The orchestrator's `handleParametersChange` should become the single point of truth for all parameter-change-triggered updates.

**Benefits:**
1. Consistent behavior across all modes
2. Clear separation between parameter storage (IndexedDB) and parameter effects (re-render)
3. Easier to add new parameters in the future

### Implementation Approach

1. **Extend handleParametersChange** to handle Standard VE updates when relevant parameters change
2. **Wire airSpeedCalibrationPercent** through the orchestrator (or create a dedicated handler)
3. **Use mode-specific update functions** called by the orchestrator

### Risk Assessment

| Risk | Mitigation |
| ---- | ---------- |
| Over-abstraction | Keep mode differences explicit; don't hide in "shared" code |
| Behavior drift | Document what was changed and verify against test cases |
| Circular dependency | Orchestrator already exists; this extends it, doesn't create new coupling |

---

## Test Strategy

### Test Location
`frontend/src/shell/analysis/parameterChangeHandler.test.ts` (new file)

### Test Coverage

1. **Parameter change triggers correct update function**
   - Mock orchestrator dependencies
   - Call `handleParametersChange` with air_speed_offset change
   - Assert `updateVEPlots` is called (or equivalent)

2. **No duplicate updates when parameter changes**
   - Avoid both orchestrator AND local slider handler triggering updates

3. **Mode-specific isolation**
   - Verify GPS-lap mode doesn't re-render for Standard VE parameters

### Test Pattern (from prepareAnalysisPayload.test.ts)
```typescript
import { describe, expect, it, vi } from 'vitest';
vi.mock('../../analysis/VeCalculatorFactory', () => ({
    createVeCalculator: vi.fn(() => ({
        calculate_virtual_elevation: vi.fn(/* ... */),
    })),
}));
```

---

## Files to Modify

1. **`frontend/src/shell/analysis/analyzeOrchestrator.ts`**
   - Extend `handleParametersChange` to handle Standard VE updates for air-speed parameters

2. **`frontend/src/shell/ve/bindStandardSliders.ts`**
   - Refactor air-speed calibration to use orchestrator (or document why local call is preferred)

3. **`frontend/src/shell/analysis/parameterChangeHandler.test.ts`** (new)
   - Integration tests for parameter change → update wiring

---

## Verification Criteria

1. User changes air_speed_offset in Standard VE mode → plots update with new wind calculation
2. User changes airSpeedCalibrationPercent → plots update with new calibration
3. User switches between Standard, GPS-lap, and Out-and-back modes → each mode's parameter changes behave correctly
4. All CI checks pass (cargo test, wasm-pack build, npm run check, npm run lint, npm run test, npm run build)