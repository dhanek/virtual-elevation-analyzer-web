/**
 * @vitest-environment jsdom
 *
 * TEMPORARY REPRO — wind height slider vs auto-converge driven values,
 * through the REAL bound controls, funnel and primitive.
 */
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterEach, beforeAll, describe, expect, test } from 'vitest';
import { initSync } from '@wasm/virtual_elevation_analyzer.js';
import type { AppState } from '../state/AppState';
import type { ModeUpdateCallbacks } from '../modes/analysis/types';
import { isGoldenRidePresent, loadGoldenRide } from './__fixtures__/loadGoldenRide';
import { bindModeControls } from '../shell/analysis/bindModeControls';
import {
    clearModeUpdateCallbacks,
    registerModeUpdateCallbacks,
} from '../shell/analysis/modeUpdateCallbacks';
import { resetModeUpdateRequests } from '../shell/analysis/requestModeUpdate';
import { configureParameterMerge } from '../shell/analysis/parametersSync';
import { resetRecomputeThrottle } from '../shell/analysis/recomputeRunner';

const WASM_PATH = resolve(process.cwd(), 'pkg/virtual_elevation_analyzer_bg.wasm');
const built = existsSync(WASM_PATH);
const fixturePresent = isGoldenRidePresent();

const noopCallbacks: ModeUpdateCallbacks = {
    aggregate: profiles => ({
        r2: 0, rmse: 0, veGain: 0, actualGain: 0, segmentCount: profiles.length,
    }),
    renderVe: () => {},
    renderWind: () => {},
    renderPower: () => {},
    renderVd: () => {},
    renderConvergence: () => {},
    renderMetrics: () => {},
};

function makeState(ride: ReturnType<typeof loadGoldenRide>): AppState {
    return {
        fitRawElevation: null,
        demRawNearestElevation: null,
        demInterpolatedSmoothed5ptElevation: null,
        activeDisplayProfile: 'fit-raw',
        currentFitData: ride.fitData,
        currentParameters: {
            ...ride.params,
            wind_speed: 3,
            wind_direction: 90,
            wind_entry: 'weather',
            wind_height_factor: 1.0,
        },
        airSpeedCalibrationPercent: 5,
        currentOverlayLapNumbers: null,
        currentAnalyzedLaps: [],
        currentFilteredData: null,
        currentVEResult: null,
        currentWindSource: 'constant',
        outAndBackSections: [],
        outAndBackSelectedSections: [],
        gpsDetectedLaps: [],
        gpsSelectedLaps: [],
        currentLaps: ride.laps,
        selectedLaps: ride.laps.map((_, i) => i + 1),
        isCalculatingAutoRho: false,
        autoConverge: { enabled: true, cdaLocked: false, crrLocked: true },
        isGpsLapModeActive: false,
        currentGpsLapIndexRanges: null,
    } as unknown as AppState;
}

function renderPanel(windSource: string): void {
    document.body.innerHTML = `
        <div id="veAnalysisSection">
            <input type="range" id="cdaSlider" min="0.1" max="0.5" step="0.001" value="0.28">
            <input type="number" id="cdaValue" value="0.280">
            <input type="range" id="crrSlider" min="0.001" max="0.02" step="0.0001" value="0.0050">
            <input type="number" id="crrValue" value="0.0050">
            <input type="range" id="windHeightSlider" min="0" max="100" step="1" value="100">
            <input type="number" id="windHeightValue" value="100">
            <span id="windHeightReadout"></span>
            <div id="autoConvergeLocks" hidden>
                <input type="checkbox" id="cdaLockToggle">
                <input type="checkbox" id="crrLockToggle">
                <div id="autoConvergeStatus" hidden></div>
            </div>
            <label><input type="radio" name="windSource" value="WIND_SOURCE" checked></label>
        </div>
    `.replace('WIND_SOURCE', windSource);
}

function el(id: string): HTMLInputElement {
    return document.getElementById(id) as HTMLInputElement;
}

async function settle(): Promise<void> {
    await new Promise(resolve => setTimeout(resolve, 250));
}

describe.skipIf(!built || !fixturePresent)('wind height + auto-converge, real chain', () => {
    beforeAll(() => {
        initSync({ module: readFileSync(WASM_PATH) });
    });

    afterEach(() => {
        resetModeUpdateRequests();
        clearModeUpdateCallbacks();
        configureParameterMerge(null);
        resetRecomputeThrottle();
    });

    async function runScenario(mode: 'standard' | 'gpsLap', windSource = 'constant', bothLocked = false) {
        const ride = loadGoldenRide();
        const appState = makeState(ride);
        if (mode === 'gpsLap') {
            (appState as unknown as Record<string, unknown>).isGpsLapModeActive = true;
            appState.currentGpsLapIndexRanges = ride.indexRanges;
        }
        if (bothLocked) {
            (appState.autoConverge as { cdaLocked: boolean }).cdaLocked = true;
        }
        renderPanel(windSource);
        registerModeUpdateCallbacks(mode, () => noopCallbacks);
        // The orchestrator's no-component fallback: merge straight into params.
        configureParameterMerge(fields => {
            Object.assign(
                appState.currentParameters as unknown as Record<string, unknown>,
                fields,
            );
        });
        bindModeControls({
            appState,
            modeId: mode,
            saveSettings: () => {},
        });

        // Pass 1: k = 1.0 (checkbox nudge to force an initial solve).
        if (bothLocked) {
            const cdaLock = el('cdaLockToggle');
            cdaLock.checked = true;
            cdaLock.dispatchEvent(new Event('change'));
        }
        const crrLock = el('crrLockToggle');
        crrLock.checked = true;
        crrLock.dispatchEvent(new Event('change'));
        await settle();
        console.log('status line:', document.getElementById('autoConvergeStatus')?.textContent,
            'hidden:', document.getElementById('autoConvergeStatus')?.hidden);
        const crrAtK100 = el('crrValue').value;
        console.log('crr at k=1.0:', crrAtK100);

        // Pass 2: drag the wind height slider to 20%.
        const slider = el('windHeightSlider');
        slider.value = '20';
        slider.dispatchEvent(new Event('input'));
        await settle();
        const crrAfterDrag = el('crrValue').value;
        console.log('crr after drag to k=0.2:', crrAfterDrag,
            'params k =', (appState.currentParameters as unknown as { wind_height_factor: number }).wind_height_factor);

        // Pass 3: toggle the lock off and on (the user's workaround).
        crrLock.checked = false;
        crrLock.dispatchEvent(new Event('change'));
        await settle();
        crrLock.checked = true;
        crrLock.dispatchEvent(new Event('change'));
        await settle();
        const crrAfterToggle = el('crrValue').value;
        console.log('crr after lock toggle:', crrAfterToggle);

        return { crrAtK100, crrAfterDrag, crrAfterToggle };
    }

    test('standard: dragging the wind height slider re-drives the locked Crr', async () => {
        const r = await runScenario('standard');
        expect(r.crrAfterDrag).toBe(r.crrAfterToggle);
        expect(r.crrAfterDrag).not.toBe(r.crrAtK100);
    }, 30000);

    test('gpsLap: dragging the wind height slider re-drives the locked Crr', async () => {
        const r = await runScenario('gpsLap');
        expect(r.crrAfterDrag).toBe(r.crrAfterToggle);
        expect(r.crrAfterDrag).not.toBe(r.crrAtK100);
    }, 30000);

    test('gpsLap under COMPARE: does the driven Crr respond to k at all?', async () => {
        const r = await runScenario('gpsLap', 'compare');
        console.log('compare scenario:', r);
        expect(r.crrAfterDrag).not.toBe(r.crrAtK100);
    }, 30000);

    test('gpsLap BOTH locked: does the pair respond to k?', async () => {
        const r = await runScenario('gpsLap', 'constant', true);
        console.log('both-locked scenario:', r);
        console.log('cda value after drag:', el('cdaValue').value);
        expect(r.crrAfterDrag).not.toBe(r.crrAtK100);
    }, 30000);
});
