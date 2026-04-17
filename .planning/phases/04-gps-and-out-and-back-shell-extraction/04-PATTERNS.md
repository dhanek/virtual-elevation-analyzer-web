# Phase 4: GPS and Out-and-Back Shell Extraction - Pattern Map

**Mapped:** 2026-04-17
**Files analyzed:** 16 new/modified files
**Analogs found:** 16 / 16

## File Classification

| New/Modified File | Role | Data Flow | Closest Analog | Match Quality |
|-------------------|------|-----------|----------------|---------------|
| `shell/gpsLap/renderGpsLap.ts` | controller | request-response | `shell/ve/renderStandardVe.ts` | exact |
| `shell/gpsLap/gpsLapPlots.ts` | utility | transform | `shell/ve/renderStandardVe.ts` (initializeVEAnalysis) | role-match |
| `shell/gpsLap/updateGpsLap.ts` | controller | request-response | `shell/ve/bindStandardSliders.ts` (updateVEPlots) | exact |
| `shell/gpsLap/gpsLapScreenshot.ts` | utility | file-I/O | `main.ts:2953-2969` (saveGpsLapScreenshot) | exact (verbatim lift) |
| `shell/gpsLap/types.ts` | model | N/A | `shell/analysis/types.ts` | role-match |
| `shell/gpsLap/index.ts` | config | N/A | `shell/ve/index.ts` | exact |
| `shell/outAndBack/renderOutAndBack.ts` | controller | request-response | `shell/ve/renderStandardVe.ts` | exact |
| `shell/outAndBack/outAndBackPlots.ts` | utility | transform | `shell/ve/renderStandardVe.ts` (initializeVEAnalysis) | role-match |
| `shell/outAndBack/updateOutAndBack.ts` | controller | request-response | `shell/ve/bindStandardSliders.ts` (updateVEPlots) | exact |
| `shell/outAndBack/outAndBackScreenshot.ts` | utility | file-I/O | `main.ts:4258-4274` (saveOutAndBackScreenshot) | exact (verbatim lift) |
| `shell/outAndBack/types.ts` | model | N/A | `shell/analysis/types.ts` | role-match |
| `shell/outAndBack/index.ts` | config | N/A | `shell/ve/index.ts` | exact |
| `shell/multiSegment/shared.ts` | utility | transform | `main.ts:2971-2973` (getMultiSegmentColor) | exact (verbatim lift) |
| `analysis/MultiSegmentSettings.ts` | service | CRUD | `analysis/MultiSegmentSettings.ts` (existing, growth) | exact |
| `analysis/MultiSegmentSettings.test.ts` | test | N/A | `analysis/MultiSegmentSettings.test.ts` (existing, growth) | exact |
| `main.ts` | controller | request-response | self (wiring update) | exact |

## Pattern Assignments

### `shell/gpsLap/renderGpsLap.ts` (controller, request-response)

**Analog:** `shell/ve/renderStandardVe.ts`

**Imports pattern** (lines 1-27):
```typescript
import { AppState } from '../../state/AppState';
import { log } from '../../utils/log';
import { setupTabSwitching } from '../dom/tabs';
import { bindActionFooter } from '../dom/actionFooter';
import { getSelectedWindSource, bindWindSourceRadios } from '../dom/windSource';
import {
    AIR_SPEED_CALIBRATION_MAX_PERCENT,
    AIR_SPEED_CALIBRATION_MIN_PERCENT,
    AIR_SPEED_CALIBRATION_STEP_PERCENT,
    calculateAutoAirSpeedCalibrationPercent,
    clampAirSpeedCalibrationPercent,
} from '../../analysis/AirSpeedCalibration';
import { ParameterStorage } from '../../utils/ParameterStorage';
import { ShellServices, ShellAnalysisContext } from '../analysis/types';
import { createVeCalculator } from '../../analysis/VeCalculatorFactory';
import { getNormalizedActivityArrays } from '../../analysis/ActivityArrayCache';
import { resolveWindSeries } from '../../analysis/WindSourceResolver';
import { buildSegmentSupplementarySeries } from '../../analysis/SegmentSupplementarySeries';
```

**DI pattern -- function receives dependencies explicitly** (renderStandardVe.ts lines 124-144):
```typescript
export async function showVirtualElevationAnalysisInline(
    appState: AppState,
    parameterStorage: ParameterStorage,
    parametersComponent: AnalysisParametersComponent | null,
    services: ShellServices,
    mapVisualization: MapVisualization | null,
    callbacks: StandardVeCallbacks,
    initialResult: any,
    analyzedLaps: number[],
    // ... data arrays ...
) {
    // appState, parameterStorage, services all passed in -- not closure-captured
```

**Callbacks interface pattern** (renderStandardVe.ts lines 33-38):
```typescript
export interface StandardVeCallbacks {
    onSaveScreenshot: () => void;
    onStoreResult: () => void;
    onExportAll: () => void;
    saveCurrentLapSettings: () => void;
}
```

**Tab setup + action footer binding pattern** (renderStandardVe.ts lines 326-330):
```typescript
    setupTabSwitching();

    bindActionFooter({
        onSaveScreenshot: callbacks.onSaveScreenshot,
        onStoreResult: callbacks.onStoreResult,
        onExportAll: callbacks.onExportAll
    });
```

---

### `shell/gpsLap/updateGpsLap.ts` (controller, request-response)

**Analog:** `shell/ve/bindStandardSliders.ts`

**Update function structure** (bindStandardSliders.ts lines 32-40):
```typescript
export function updateVEPlots(
    appState: AppState,
    analysisInput: AnalysisInput,
    trimStart: number,
    trimEnd: number
) {
    const windSource = getSelectedWindSource() as WindSource;
    void updateVEPlotsWithWindSource(appState, analysisInput, trimStart, trimEnd, windSource);
}
```

**Slider handler wiring pattern** (bindStandardSliders.ts lines 150-165):
```typescript
export function setupVESliders(
    appState: AppState,
    parametersComponent: AnalysisParametersComponent | null,
    services: ShellServices,
    mapVisualization: MapVisualization | null,
    saveCurrentLapSettings: () => void,
    timestamps: number[],
    power: number[],
    // ... receives all data as explicit params, not closure-captured
) {
```

**Air-speed calibration auto-adjust button pattern** (bindStandardSliders.ts lines 417-438):
```typescript
const autoAdjustButton = document.getElementById('autoAdjustCalibration') as HTMLButtonElement;
if (autoAdjustButton) {
    autoAdjustButton.onclick = () => {
        const trimStart = parseInt(trimStartSlider.value);
        const trimEnd = parseInt(trimEndSlider.value);
        const calibrationPercent = calculateAutoAirSpeedCalibrationPercent([
            {
                timestamps,
                groundSpeed: velocity,
                apparentSpeed: windSpeed,
                startIndex: trimStart,
                endIndex: trimEnd,
            },
        ]);
        if (calibrationPercent === null) return;
        airSpeedCalibrationSlider.value = calibrationPercent.toFixed(1);
        airSpeedCalibrationValue.value = calibrationPercent.toFixed(1);
        appState.airSpeedCalibrationPercent = calibrationPercent;
        updateVEPlots(appState, analysisInput, trimStart, trimEnd);
        saveCurrentLapSettings();
    };
}
```

**Key difference for GPS-lap/out-and-back:** The update functions (`updateGpsLapVEPlots`, `updateOutAndBackVEPlots`) in main.ts iterate over multiple segments/laps rather than a single data range, and they preserve tab/scroll state during re-render (BEHV-03). These are verbatim lifts per D-08 -- do not refactor the update flow.

---

### `shell/gpsLap/gpsLapPlots.ts` (utility, transform)

**Analog:** `shell/ve/renderStandardVe.ts` (initializeVEAnalysis function, lines 43-119)

**Plotly rendering pattern** (renderStandardVe.ts lines 109-113):
```typescript
Plotly.newPlot('vePlot', figures.elevation.data, figures.elevation.layout, figures.elevation.config);
Plotly.newPlot('veResidualsPlot', figures.residuals.data, figures.residuals.layout, figures.residuals.config);
Plotly.newPlot('windSpeedPlot', windSpeedFigure.data, windSpeedFigure.layout, windSpeedFigure.config);
```

**Multi-segment plot builder usage** (main.ts lines 2978-2995, source for verbatim lift):
```typescript
function renderGpsLapWindPlot(lapProfiles: LapVEProfile[]) {
    // Uses buildMultiSegmentWindFigure from plots/MultiSegmentPlotBuilders.ts
    // Uses getMultiSegmentColor from shared.ts
}
```

---

### `shell/gpsLap/gpsLapScreenshot.ts` (utility, file-I/O)

**Analog:** `main.ts` lines 2953-2969 (verbatim lift)

**Screenshot pattern:**
```typescript
async function saveGpsLapScreenshot() {
    const plotElement = document.getElementById('gpsLapVePlot');
    if (!plotElement) return;

    try {
        const Plotly = await waitForPlotly();
        const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
        await Plotly.downloadImage('gpsLapVePlot', {
            format: 'png',
            width: 1200,
            height: 600,
            filename: `gps-lap-ve-${timestamp}`
        });
    } catch (err) {
        log.error('Failed to save screenshot:', err);
    }
}
```

**After extraction:** Must receive `waitForPlotly` via `ShellAnalysisContext` instead of closure capture.

---

### `shell/gpsLap/types.ts` (model)

**Analog:** `shell/analysis/types.ts`

**Type definition pattern** (shell/analysis/types.ts lines 1-19):
```typescript
import type { AppState } from '../../state/AppState';

export interface ShellServices {
    appState: AppState;
    showLoading: (message: string) => void;
    hideLoading: () => void;
    showError: (message: string) => void;
}
```

**GPS-lap type to extract** (main.ts lines 2237-2245):
```typescript
interface LapVEProfile {
    lapNumber: number;
    distances: number[];      // km, relative to gate crossing (starting at 0)
    virtualElevation: number[];
    actualElevation: number[];
    supplementarySeries: SegmentSupplementarySeries;
    duration: number;         // seconds
    totalDistance: number;    // km
}
```

---

### `shell/gpsLap/index.ts` (config, barrel export)

**Analog:** `shell/ve/index.ts`

**Barrel export pattern** (shell/ve/index.ts lines 1-5):
```typescript
/**
 * Barrel export for standard VE shell modules.
 */
export * from './autoRho';
export * from './bindStandardSliders';
export * from './renderStandardVe';
```

---

### `shell/outAndBack/renderOutAndBack.ts` (controller, request-response)

**Analog:** `shell/ve/renderStandardVe.ts` -- same pattern as `shell/gpsLap/renderGpsLap.ts` above.

**Entry point function signature** (main.ts lines 3541-3546):
```typescript
async function showOutAndBackVEAnalysis(
    sections: OutAndBackSection[],
    fitData: any,
    params: AnalysisParameters,
    defaultAirSpeedOffset: number,
    reuseCurrentSettings: boolean = false,
) {
```

After extraction: `appState`, `parameterStorage`, `services` become explicit parameters per the ShellServices DI pattern.

---

### `shell/outAndBack/outAndBackPlots.ts` (utility, transform)

Same pattern as `shell/gpsLap/gpsLapPlots.ts` above. Uses `buildMultiSegmentWindFigure`, `buildMultiSegmentPowerFigure`, `buildMultiSegmentVirtualDistanceFigure` from `plots/MultiSegmentPlotBuilders.ts`.

---

### `shell/outAndBack/updateOutAndBack.ts` (controller, request-response)

Same pattern as `shell/gpsLap/updateGpsLap.ts` above. Verbatim lift per D-08.

---

### `shell/outAndBack/outAndBackScreenshot.ts` (utility, file-I/O)

**Analog:** `main.ts` lines 4258-4274 (verbatim lift)

```typescript
async function saveOutAndBackScreenshot() {
    const plotElement = document.getElementById('oabVePlot');
    if (!plotElement) return;

    try {
        const Plotly = await waitForPlotly();
        const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
        await Plotly.downloadImage('oabVePlot', {
            format: 'png',
            width: 1200,
            height: 600,
            filename: `out-and-back-ve-${timestamp}`
        });
    } catch (err) {
        log.error('Failed to save screenshot:', err);
    }
}
```

---

### `shell/outAndBack/types.ts` (model)

Same pattern as `shell/gpsLap/types.ts`. Contains `OutAndBackVEProfile` interface (main.ts lines 3519-3533).

---

### `shell/outAndBack/index.ts` (config, barrel export)

Same pattern as `shell/gpsLap/index.ts` and `shell/ve/index.ts`.

---

### `shell/multiSegment/shared.ts` (utility, transform)

**Analog:** `main.ts` lines 2226-2235, 2971-2973 (verbatim lift)

**Color constants and helper:**
```typescript
const MULTI_SEGMENT_COLORS = [
    '#4363d8',
    '#e6194b',
    '#3cb44b',
    '#f58231',
    '#911eb4',
    '#46f0f0',
    '#f032e6',
    '#bcf60c',
];

function getMultiSegmentColor(index: number): string {
    return MULTI_SEGMENT_COLORS[index % MULTI_SEGMENT_COLORS.length];
}
```

After extraction: export both `MULTI_SEGMENT_COLORS` and `getMultiSegmentColor`. Also export `interpolateElevation` (main.ts lines 3830-3842) if out-and-back uses it.

---

### `analysis/MultiSegmentSettings.ts` (service, CRUD -- existing file, growth via D-06)

**Analog:** self (existing file, 42 lines)

**Existing pattern** (MultiSegmentSettings.ts lines 1-42):
```typescript
import type { AnalysisParameters } from '../components/AnalysisParameters'
import type { LapSettings } from '../utils/ParameterStorage'
import { DEFAULT_AIR_SPEED_CALIBRATION_PERCENT } from './AirSpeedCalibration'

export interface ResolvedMultiSegmentSettings {
    params: AnalysisParameters
    airSpeedCalibrationPercent: number
}

// ... pure functions with explicit params, no DOM, no closure captures
```

**Functions to consolidate from main.ts** (D-06):

`resolveMultiSegmentAnalysisParams` (main.ts lines 3240-3259) -- currently captures `appState` and `parameterStorage` via closure. After: explicit params.

`saveCurrentMultiSegmentSettings` (main.ts lines 3261-3290) -- currently captures `appState` and `parameterStorage` via closure. After: explicit params.

`saveMapTrimSettings` (main.ts lines 3293-3312) -- currently captures `appState` and `parameterStorage` via closure. After: explicit params.

`buildAutoCalibrationSegmentsFromRanges` (main.ts lines 84-118) -- currently captures `appState` via closure. After: explicit `appState` param and imported analysis helpers.

**DI transformation pattern:** Each function must change from `function foo(...args)` (closure-captured deps) to `export function foo(appState: AppState, parameterStorage: ParameterStorage, ...args)` (explicit deps).

---

### `analysis/MultiSegmentSettings.test.ts` (test -- existing file, possible growth)

**Analog:** self (existing file)

**Test pattern** (MultiSegmentSettings.test.ts lines 1-6):
```typescript
import { describe, expect, it } from 'vitest'

import { DEFAULT_PARAMETERS } from '../components/AnalysisParameters'
import { DEFAULT_AIR_SPEED_CALIBRATION_PERCENT } from './AirSpeedCalibration'
import { resolveMultiSegmentSettings, sameSelection } from './MultiSegmentSettings'
```

Test structure: `describe` blocks per exported function, `it` blocks for each case. Pure function tests with no mocking.

---

### `main.ts` (controller -- wiring update)

**Wiring pattern** (main.ts lines 49-51):
```typescript
import { createModeRenderCallbacks } from './shell/analysis/renderDelegates'
```

After extraction: update `createModeRenderCallbacks` call to point gpsLap and outAndBack callbacks at the new `shell/gpsLap/` and `shell/outAndBack/` entry points. Remove extracted functions from main.ts. Update imports.

**Render delegate wiring** (renderDelegates.ts lines 54-66):
```typescript
export function createModeRenderCallbacks(
    callbacks: {
        standard: (args: StandardRenderArgs) => Promise<void> | void;
        gpsLap: ModeRenderCallbacks['gpsLap'];
        outAndBack: ModeRenderCallbacks['outAndBack'];
    },
): ModeRenderCallbacks {
    return {
        standard: createStandardRenderDelegate(callbacks.standard),
        gpsLap: createGpsLapRenderDelegate(callbacks.gpsLap),
        outAndBack: createOutAndBackRenderDelegate(callbacks.outAndBack),
    };
}
```

## Shared Patterns

### ShellServices DI
**Source:** `shell/analysis/types.ts` lines 1-19
**Apply to:** All new shell module files (renderGpsLap, updateGpsLap, renderOutAndBack, updateOutAndBack, screenshots)
```typescript
import type { AppState } from '../../state/AppState';

export interface ShellServices {
    appState: AppState;
    showLoading: (message: string) => void;
    hideLoading: () => void;
    showError: (message: string) => void;
}

export interface ShellAnalysisContext extends ShellServices {
    waitForPlotly: () => Promise<void>;
}
```

### Tab Switching
**Source:** `shell/dom/tabs.ts` lines 23-61
**Apply to:** `renderGpsLap.ts`, `renderOutAndBack.ts`, `updateGpsLap.ts`, `updateOutAndBack.ts`
```typescript
import { setupTabSwitching } from '../dom/tabs';
// ...
setupTabSwitching({
    wind: () => renderGpsLapWindPlot(lapProfiles),
    power: () => renderGpsLapPowerPlot(lapProfiles),
    vd: () => renderGpsLapVdPlot(lapProfiles),
});
```

### Action Footer Binding
**Source:** `shell/dom/actionFooter.ts` lines 19-43
**Apply to:** `renderGpsLap.ts`, `renderOutAndBack.ts`
```typescript
import { bindActionFooter } from '../dom/actionFooter';
// ...
bindActionFooter({
    onSaveScreenshot: () => saveGpsLapScreenshot(),
    onStoreResult: () => handleStoreResult(appState, resultsStorage),
    onExportAll: () => handleExportAllResults(resultsStorage),
});
```

### Wind Source Radio Binding
**Source:** `shell/dom/windSource.ts`
**Apply to:** `renderGpsLap.ts`, `renderOutAndBack.ts`
```typescript
import { getSelectedWindSource, bindWindSourceRadios } from '../dom/windSource';
```

### Barrel Export
**Source:** `shell/ve/index.ts` lines 1-5
**Apply to:** `shell/gpsLap/index.ts`, `shell/outAndBack/index.ts`
```typescript
export * from './renderGpsLap';
export * from './gpsLapPlots';
export * from './updateGpsLap';
export * from './gpsLapScreenshot';
```

### Error Handling
**Source:** `shell/ve/autoRho.ts` lines 55-268 (try/catch with services.showLoading/hideLoading)
**Apply to:** All async functions in shell modules
```typescript
try {
    services.showLoading('Calculating VE for each lap...');
    // ... analysis work ...
} catch (error) {
    log.error('Failed to ...:', error);
    services.showError('...');
} finally {
    services.hideLoading();
}
```

### Persistence Helper DI (D-06 consolidation)
**Source:** `analysis/MultiSegmentSettings.ts` existing pattern
**Apply to:** New functions consolidated into `MultiSegmentSettings.ts`
```typescript
// Existing: pure functions with explicit input objects
export function resolveMultiSegmentSettings(
    input: ResolveMultiSegmentSettingsInput,
): ResolvedMultiSegmentSettings {

// New additions follow the same pattern: explicit params, no closure captures
export async function resolveMultiSegmentAnalysisParams(
    appState: AppState,
    parameterStorage: ParameterStorage,
    analyzedItems: number[],
    params: AnalysisParameters,
    reuseCurrentSettings: boolean,
): Promise<AnalysisParameters> {
```

## No Analog Found

| File | Role | Data Flow | Reason |
|------|------|-----------|--------|
| (none) | -- | -- | All files have close analogs in the codebase from Phase 3 extraction |

All 16 files have either exact or role-match analogs. The Phase 3 `shell/ve/` extraction provides a complete template for the GPS-lap and out-and-back extractions.

## Metadata

**Analog search scope:** `frontend/src/shell/`, `frontend/src/analysis/`, `frontend/src/modes/`, `frontend/src/main.ts`
**Files scanned:** 30+
**Pattern extraction date:** 2026-04-17
