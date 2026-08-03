import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { beforeAll, describe, expect, test } from 'vitest';
import { initSync } from '@wasm/virtual_elevation_analyzer.js';

import { getNormalizedActivityArrays } from './ActivityArrayCache';
import { createVeCalculator } from './VeCalculatorFactory';
// NOTE: `resolveWindSeries`, `buildSegmentSupplementarySeries`,
// `extractSegmentData` and `applyAirSpeedOffset` used to be imported here so
// this harness could RE-IMPLEMENT the segment spine and Standard's inline wind
// composition. All four are gone: every mode runner now calls the real
// `updateModeVEPlots`, and the one branch that still composes by hand (compare,
// which plan 07-04 owns) takes its wind from the real production helper.
import { prepareAnalysisPayload } from '../shell/analysis/prepareAnalysisPayload';
import { resolveSelectionWindSeries } from '../shell/ve/standardSegments';
import { updateModeVEPlots } from '../shell/analysis/updateModeVEPlots';
import { getAnalysisModeHandler } from '../modes/analysis/AnalysisModes';
import type { ModeUpdateCallbacks, SegmentVeProfile } from '../modes/analysis/types';
import {
    calculateGpsLapStats,
    calculateMeanElevationProfile,
} from '../shell/gpsLap/gpsLapPlots';
import type { AppState } from '../state/AppState';
import { isGoldenRidePresent, loadGoldenRide } from './__fixtures__/loadGoldenRide';

/**
 * D-08 / D-09 GOLDEN VALUE GUARDS — the gate for phase 07.
 *
 * Fifteen committed literals: {standard, gpsLap, outAndBack} x {fit, constant}
 * x {rho present, rho absent} = 12, plus standard x compare x {rho present, rho
 * absent} = 2, plus one D-21 virtual-distance case added by plan 07-02 Task 4.
 * The first fourteen were captured from a tree containing ZERO phase-07
 * pipeline edits.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * HARNESS FIDELITY — DISCHARGED as of plan 07-02 Task 4.
 *
 * Plan 07-01 could not call the production update paths: they were DOM-coupled
 * (`updateVEPlotsWithWindSource` read `document.getElementById("cdaSlider")`)
 * and all three ended in `Plotly.react`. So the original harness RE-IMPLEMENTED
 * the slice-and-loop spine — exactly the trap 07-VALIDATION.md flags in
 * `parameterChangeHandler.test.ts`, where a test that re-implements what it
 * claims to test stays green if production is replaced with junk. The literals
 * were labelled PROVISIONAL for that reason.
 *
 * They are no longer provisional. Every mode runner in this file now drives the
 * REAL `updateModeVEPlots` with an injected no-op renderer:
 *   - GPS-lap and out-and-back were re-pointed in Task 3, and their eight
 *     literals held UNCHANGED — which is the proof the mirror was faithful;
 *   - Standard is re-pointed here. Its four non-compare literals MOVED, by
 *     design and by maintainer ruling: D-19 Option B replaces one calculator
 *     run over the concatenated selection with one run PER SELECTED LAP. The
 *     movement is recorded under named change-list entries (f) and (g) in
 *     07-GOLDEN-BASELINE.md, never silently re-baselined.
 *
 * The only branch still composed by hand is `compare` (cases 5 and 6), which
 * plan 07-02 deliberately leaves outside the primitive for plan 07-04 (D-20).
 * Even that branch now takes its wind from the production helper
 * `resolveSelectionWindSeries`, so no offset/calibration algorithm is mirrored
 * anywhere in this file.
 *
 * A CROSS-CHECK WORTH KNOWING ABOUT. The fixture's Standard selection is laps
 * 8-14, whose per-lap ranges are exactly the fixture's `indexRanges` — the same
 * ranges the GPS-lap runner uses. So under Option B, Standard and GPS-lap
 * compute the identical thing and their literals are identical. That is not a
 * copy-paste: it is the maintainer's stated reason for choosing Option B, that
 * Standard should report the way the segment modes already do.
 * ─────────────────────────────────────────────────────────────────────────────
 */

const WASM_PATH = fileURLToPath(
    new URL('../../pkg/virtual_elevation_analyzer_bg.wasm', import.meta.url),
);

const built = existsSync(WASM_PATH);
const fixturePresent = isGoldenRidePresent();

/**
 * D-10 anti-vacuity guard, deliberately OUTSIDE the `describe.skipIf` below.
 * A golden file that silently skips itself in CI is not a guard — Phase 6 WR-02
 * is the precedent where a promised parity bar turned out to be entirely
 * unenforced. Locally this is a no-op so a developer without a wasm build is not
 * blocked; under CI `deploy.yml` builds WASM before running tests, so either
 * artifact being absent is a real failure.
 */
test('wasm artifact and golden fixture are present in CI', () => {
    if (process.env.CI) {
        expect(built).toBe(true);
        expect(fixturePresent).toBe(true);
    }
});

/** Fixed inputs. Named so a literal is never a bare number at a call site. */
const GOLDEN_CDA = 0.28;
const GOLDEN_CRR = 0.005;
/**
 * DELIBERATELY NON-ZERO. The plan specified "airSpeedCalibrationPercent at its
 * default", but the default is 0 and `WindSourceResolver.ts:71` guards the
 * calibration branch behind `!== 0`. At 0 the multiplier never executes, so
 * D-10 mutation (c) — flipping `1 + pct/100` to `1 - pct/100` at :72 — cannot
 * be observed failing, and the whole calibration path is untested by the golden
 * set. A guard that cannot fail is not a guard.
 */
const GOLDEN_CALIBRATION_PERCENT: number = 5;
/** 10 decimal places: survives a WASM rebuild, not a bit-parity freeze (D-09). */
const PRECISION = 10;

/**
 * Case 15 (D-21 / N-6). Sum over the seven Standard segments of each segment's
 * final accumulated virtual distance, in km, at
 * `airSpeedCalibrationPercent = 5`.
 *
 * The air total is the number a SECOND application of the calibration
 * multiplier moves; the ground total is the control that must stay put.
 */
const VD_AIR_KM_TOTAL = 14.076827100000003;
const VD_GROUND_KM_TOTAL = 14.497571;

type WindMode = 'fit' | 'constant';

interface GoldenCase {
    r2: number;
    rmse: number;
    veElevationDiff: number;
    actualElevationDiff: number;
    veLength: number;
    veFirst: number;
    veMid: number;
    veLast: number;
    /** Sum over the WHOLE array, so an interior-only change cannot hide. */
    veChecksum: number;
}

/**
 * Assert a case against committed literals. Three sampled points would let an
 * interior change slip through; the checksum closes that. Full-array equality is
 * the intent, but 14 full dumps are unreadable.
 */
function expectGolden(actual: GoldenCase, expected: GoldenCase): void {
    expect(actual.veLength).toBe(expected.veLength);
    expect(actual.r2).toBeCloseTo(expected.r2, PRECISION);
    expect(actual.rmse).toBeCloseTo(expected.rmse, PRECISION);
    expect(actual.veElevationDiff).toBeCloseTo(expected.veElevationDiff, PRECISION);
    expect(actual.actualElevationDiff).toBeCloseTo(expected.actualElevationDiff, PRECISION);
    expect(actual.veFirst).toBeCloseTo(expected.veFirst, PRECISION);
    expect(actual.veMid).toBeCloseTo(expected.veMid, PRECISION);
    expect(actual.veLast).toBeCloseTo(expected.veLast, PRECISION);
    expect(actual.veChecksum).toBeCloseTo(expected.veChecksum, PRECISION);
}

function summarise(result: {
    r2: number;
    rmse: number;
    ve_elevation_diff: number;
    actual_elevation_diff: number;
    virtual_elevation: Float64Array;
}): GoldenCase {
    const ve = Array.from(result.virtual_elevation);
    return {
        r2: result.r2,
        rmse: result.rmse,
        veElevationDiff: result.ve_elevation_diff,
        actualElevationDiff: result.actual_elevation_diff,
        veLength: ve.length,
        veFirst: ve[0],
        veMid: ve[Math.floor(ve.length / 2)],
        veLast: ve[ve.length - 1],
        veChecksum: ve.reduce((sum, v) => sum + v, 0),
    };
}

/** Aggregate N per-segment results into one case, for the two GPS modes. */
function summariseSegments(results: ReturnType<typeof summarise>[]): GoldenCase {
    const total = results.length;
    const concatenatedLength = results.reduce((n, r) => n + r.veLength, 0);
    return {
        r2: results.reduce((s, r) => s + r.r2, 0) / total,
        rmse: results.reduce((s, r) => s + r.rmse, 0) / total,
        veElevationDiff: results.reduce((s, r) => s + r.veElevationDiff, 0) / total,
        actualElevationDiff: results.reduce((s, r) => s + r.actualElevationDiff, 0) / total,
        veLength: concatenatedLength,
        veFirst: results[0].veFirst,
        veMid: results[Math.floor(total / 2)].veMid,
        veLast: results[total - 1].veLast,
        veChecksum: results.reduce((s, r) => s + r.veChecksum, 0),
    };
}

describe.skipIf(!built || !fixturePresent)('golden VE values (real WASM)', () => {
    beforeAll(() => {
        initSync({ module: readFileSync(WASM_PATH) });
    });

    /**
     * Minimal AppState stand-in. Only the fields `prepareAnalysisPayload` and
     * `resolveElevationProfile` actually read — deliberately not a full mock, so
     * a future field this harness ignores fails loudly rather than silently.
     */
    function makeAppState(): AppState {
        return {
            fitRawElevation: null,
            demRawNearestElevation: null,
            demInterpolatedSmoothed5ptElevation: null,
            activeDisplayProfile: 'fit-raw',
        } as unknown as AppState;
    }

    /**
     * AppState stand-in for the UPDATE path. Same principle as `makeAppState`:
     * only the fields `updateModeVEPlots` and the handlers actually read, so a
     * field this harness forgets fails loudly.
     */
    function makeUpdateAppState(ride: ReturnType<typeof loadGoldenRide>): AppState {
        return {
            ...(makeAppState() as unknown as Record<string, unknown>),
            currentFitData: ride.fitData,
            currentParameters: ride.params,
            airSpeedCalibrationPercent: GOLDEN_CALIBRATION_PERCENT,
            currentRhoArray: null,
            currentGpsLapIndexRanges: null,
            currentOverlayLapNumbers: null,
            currentAnalyzedLaps: [],
            currentFilteredData: null,
            currentVEResult: null,
            currentWindSource: 'none',
            outAndBackSections: [],
            outAndBackSelectedSections: [],
            gpsDetectedLaps: [],
            gpsSelectedLaps: [],
            // Standard selects by lap NUMBER over `currentLaps`; the handler
            // turns those into per-lap time ranges and then into per-lap
            // full-activity index ranges (D-19 Option B).
            currentLaps: ride.laps,
            selectedLaps: ride.laps.map((_, i) => i + 1),
        } as unknown as AppState;
    }

    /**
     * The injected renderer is a no-op: these cases assert per-segment numbers,
     * so nothing needs to be drawn. `aggregate` returns the per-segment means,
     * which is only used by `summarize`'s AppState write here.
     */
    function noopCallbacks(): ModeUpdateCallbacks {
        return {
            aggregate: profiles => ({
                r2: profiles.reduce((s, p) => s + p.result.r2, 0) / profiles.length,
                rmse: profiles.reduce((s, p) => s + p.result.rmse, 0) / profiles.length,
                veGain: profiles.reduce((s, p) => s + p.result.ve_elevation_diff, 0) / profiles.length,
                actualGain: profiles.reduce((s, p) => s + p.result.actual_elevation_diff, 0) / profiles.length,
                segmentCount: profiles.length,
            }),
            renderVe: () => {},
            renderWind: () => {},
            renderPower: () => {},
            renderVd: () => {},
            renderMetrics: () => {},
        };
    }

    /** Adapt a SegmentVeProfile to the LapVEProfile shape the stat helpers take. */
    function toLapProfile(profile: SegmentVeProfile) {
        return {
            lapNumber: 0,
            distances: profile.distancesKm,
            virtualElevation: profile.virtualElevation,
            actualElevation: profile.actualElevation,
            supplementarySeries: profile.supplementarySeries,
            duration: 0,
            totalDistance: 0,
        };
    }

    // ── Standard ────────────────────────────────────────────────────────────
    /**
     * Mirrors the Standard ANALYZE leg by calling the real
     * `prepareAnalysisPayload` (prepareAnalysisPayload.ts:42), then the UPDATE
     * composition at bindStandardSliders.ts:146-335: trim over the concatenated
     * selection, wind resolved per source, offset+calibration applied outside
     * the calculator.
     */
    /**
     * The Standard ANALYZE leg's own result — the calculator built INSIDE
     * `prepareAnalysisPayload` at :112-134, which is where `rhoArray` reaches
     * WASM on that path (:121).
     *
     * This exists because D-10 mutation (b) — deleting that `rhoArray` argument
     * — did NOT fail the 14 cases. `runStandard` consumes `payload.filteredData`
     * and `payload.rhoArray` but builds its own calculator for the UPDATE
     * composition, so the analyze-leg calculator was never asserted and the
     * mutation was invisible. The mutation found a hole in the harness, which is
     * precisely what it is for; this closes it.
     */
    function runStandardAnalyzeLeg(withRho: boolean): GoldenCase {
        const ride = loadGoldenRide();
        const payload = prepareAnalysisPayload({
            appState: makeAppState(),
            fitData: ride.fitData,
            selection: {
                mode: 'standard',
                selectedItems: [],
                selectedEntries: [],
                indexRanges: null,
                timeRanges: ride.laps.map(lap => ({ start: lap.start_time, end: lap.end_time })),
                outAndBackSections: null,
                emptySelectionMessage: '',
            },
            params: ride.params,
            cda: GOLDEN_CDA,
            crr: GOLDEN_CRR,
            getNormalizedActivityArrays,
            calculateRhoArray: withRho ? () => ride.rhoArray : undefined,
        });
        return summarise(payload.initialResult);
    }

    /**
     * RE-POINTED at the real `updateModeVEPlots` (plan 07-02 Task 4).
     *
     * No `segments` override is passed, so each segment defaults to its own full
     * extent — which is what the trim sliders hold at their defaults
     * (`bindStandardSliders.ts` maps the full window onto every lap). The
     * production binder's own mapping is guarded separately, with real numbers,
     * in `shell/ve/standardSegments.test.ts`.
     */
    async function runStandardUpdate(wind: WindMode, withRho: boolean) {
        const ride = loadGoldenRide();
        const appState = makeUpdateAppState(ride);

        const outcome = await updateModeVEPlots({
            appState,
            handler: getAnalysisModeHandler(null),
            callbacks: noopCallbacks(),
            windSource: wind,
            cda: GOLDEN_CDA,
            crr: GOLDEN_CRR,
            isTabActive: () => false,
            resolveRho: withRho ? () => ride.rhoArray : () => null,
        });

        expect(outcome).not.toBeNull();
        // One segment per selected lap. Seven selected laps, seven independent
        // integrations — the shape D-19 Option B specifies.
        expect(outcome!.profiles).toHaveLength(ride.laps.length);
        return outcome!;
    }

    async function runStandard(wind: WindMode, withRho: boolean): Promise<GoldenCase> {
        const outcome = await runStandardUpdate(wind, withRho);
        return summariseSegments(outcome.profiles.map(p => summarise(p.result)));
    }

    /**
     * The `compare` branch is NOT routed through the primitive by this plan —
     * D-20 gives it to plan 07-04 — so cases 5 and 6 keep the plan-01
     * composition, over the concatenated (deduplicated) selection with a single
     * calculator per method. They must NOT move.
     *
     * The one thing that did change here: the fit series comes from the
     * production helper `resolveSelectionWindSeries` rather than a hand-written
     * offset+calibration copy, matching what the production compare branch now
     * does. The helper resolves over the FULL activity and slices afterwards; on
     * this fixture the selection IS the full activity, so the numbers are
     * unchanged, but on a real non-contiguous multi-lap ride compare inherits
     * change-list entry (c) along with everything else.
     */
    function runStandardCompare(withRho: boolean): GoldenCase {
        const ride = loadGoldenRide();
        const appState = makeUpdateAppState(ride);

        const payload = prepareAnalysisPayload({
            appState,
            fitData: ride.fitData,
            selection: {
                mode: 'standard',
                selectedItems: [],
                selectedEntries: [],
                indexRanges: null,
                timeRanges: ride.laps.map(lap => ({ start: lap.start_time, end: lap.end_time })),
                outAndBackSections: null,
                emptySelectionMessage: '',
            },
            params: ride.params,
            cda: GOLDEN_CDA,
            crr: GOLDEN_CRR,
            getNormalizedActivityArrays,
            calculateRhoArray: withRho ? () => ride.rhoArray : undefined,
        });

        const analysisInput = payload.filteredData;
        const rhoArray = withRho ? payload.rhoArray : null;
        const trimStart = 0;
        const trimEnd = analysisInput.timestamps.length - 1;

        // bindStandardSliders.ts — constant wind is an all-NaN series.
        const constantWind = new Array<number>(analysisInput.windSpeed.length).fill(Number.NaN);
        const fitWind = resolveSelectionWindSeries(appState, payload.selectedIndices, 'fit');

        const calculate = (windSpeed: number[]) => {
            const calculator = createVeCalculator({
                timestamps: analysisInput.timestamps,
                power: analysisInput.power,
                velocity: analysisInput.velocity,
                positionLat: analysisInput.positionLat,
                positionLong: analysisInput.positionLong,
                altitude: analysisInput.altitude,
                distance: analysisInput.distance,
                windSpeed,
                rhoArray,
                params: ride.params,
                cda: GOLDEN_CDA,
                crr: GOLDEN_CRR,
            });
            return calculator.calculate_virtual_elevation(
                GOLDEN_CDA,
                GOLDEN_CRR,
                trimStart,
                trimEnd,
            );
        };

        const constantResult = summarise(calculate(constantWind));
        const fitResult = summarise(calculate(fitWind));
        return {
            r2: (constantResult.r2 + fitResult.r2) / 2,
            rmse: (constantResult.rmse + fitResult.rmse) / 2,
            veElevationDiff: (constantResult.veElevationDiff + fitResult.veElevationDiff) / 2,
            actualElevationDiff:
                (constantResult.actualElevationDiff + fitResult.actualElevationDiff) / 2,
            veLength: constantResult.veLength,
            veFirst: constantResult.veFirst,
            veMid: fitResult.veMid,
            veLast: fitResult.veLast,
            veChecksum: constantResult.veChecksum + fitResult.veChecksum,
        };
    }

    // ── GPS-lap ─────────────────────────────────────────────────────────────
    /**
     * RE-POINTED at the real `updateModeVEPlots` (plan 07-02 Task 3).
     *
     * This function used to RE-IMPLEMENT the slice-and-loop spine, which is the
     * trap 07-VALIDATION.md flags in `parameterChangeHandler.test.ts`: a mirror
     * stays green if production is replaced with junk. It now drives the actual
     * primitive with an injected no-op renderer, so the eight segment-mode
     * literals holding IS the proof the mirror was faithful.
     *
     * The literals must hold UNCHANGED: the fixture carries no DEM profile, so
     * `resolveElevationProfile` returns 'fit-raw' and change-list entry (d)
     * cannot fire here. Movement would be a defect, not a change-list entry.
     */
    async function runGpsLap(wind: WindMode, withRho: boolean): Promise<GoldenCase> {
        const ride = loadGoldenRide();
        const appState = makeUpdateAppState(ride);
        appState.currentGpsLapIndexRanges = ride.indexRanges;

        const outcome = await updateModeVEPlots({
            appState,
            handler: getAnalysisModeHandler('GPS based lap splitting'),
            callbacks: noopCallbacks(),
            windSource: wind,
            cda: GOLDEN_CDA,
            crr: GOLDEN_CRR,
            isTabActive: () => false,
            resolveRho: withRho ? () => ride.rhoArray : () => null,
        });

        expect(outcome).not.toBeNull();

        // The REAL aggregation helpers, exercised on the primitive's output.
        const profiles = outcome!.profiles.map(toLapProfile);
        const meanElevation = calculateMeanElevationProfile(profiles as never);
        const stats = calculateGpsLapStats(profiles as never, meanElevation);
        expect(Number.isFinite(stats.meanR2)).toBe(true);

        return summariseSegments(outcome!.profiles.map(p => summarise(p.result)));
    }

    // ── Out-and-back ────────────────────────────────────────────────────────
    /** Mirrors updateOutAndBack.ts:68-289 (outbound then inbound per section). */
    async function runOutAndBack(wind: WindMode, withRho: boolean): Promise<GoldenCase> {
        const ride = loadGoldenRide();
        const appState = makeUpdateAppState(ride);
        // The fixture carries only the index fields; the direction/duration
        // fields OutAndBackSection also declares are not read by the segment
        // builder, so the narrower fixture type is widened here deliberately.
        appState.outAndBackSections = ride.sections as unknown as AppState['outAndBackSections'];
        appState.outAndBackSelectedSections = ride.sections.map(s => s.sectionNumber);

        const outcome = await updateModeVEPlots({
            appState,
            handler: getAnalysisModeHandler('GPS based out and back'),
            callbacks: noopCallbacks(),
            windSource: wind,
            cda: GOLDEN_CDA,
            crr: GOLDEN_CRR,
            isTabActive: () => false,
            resolveRho: withRho ? () => ride.rhoArray : () => null,
        });

        expect(outcome).not.toBeNull();
        // 2N segments, outbound then inbound. This is the section-to-leg
        // mapping plan 07-01 had to leave UNGUARDED because the production
        // function was Plotly-coupled and could only be mirrored; re-pointing
        // brings it under the literals, which is what makes D-10 mutation (b)
        // observable at its specified site for the first time.
        expect(outcome!.profiles).toHaveLength(ride.sections.length * 2);

        return summariseSegments(outcome!.profiles.map(p => summarise(p.result)));
    }

    // ═══════════════════════════ THE 14 LITERALS ═══════════════════════════
    // Captured at cb2c7f8 + this plan's additive commits only. `git diff
    // cb2c7f8 HEAD --name-only -- frontend/src/shell frontend/src/modes
    // frontend/src/plots` is EMPTY: no pipeline source was touched to enable
    // capture. See 07-GOLDEN-BASELINE.md for the table and the mutation record.

    /**
     * NOTE on `actualElevationDiff`: it is −1 for every Standard case and
     * −1/7 for every segment-mode case, identical across wind source and rho.
     * That is correct, not a sentinel — the fixture's altitude runs
     * 1063.9 → 1062.9 m, exactly −1.000 after 1-dp rounding — but it means this
     * particular field pins the altitude INPUT rather than the VE math, and no
     * wind/rho regression can ever move it. It is asserted for completeness;
     * `r2`, `rmse`, `veElevationDiff` and the checksum are the load-bearing ones.
     */
    /**
     * RE-BASELINED 2026-08-03 by plan 07-02 Task 4, under D-09 named change-list
     * entries (f) and (g) — NEVER silently. The pre-refactor values are
     * preserved verbatim in `07-GOLDEN-BASELINE.md`, alongside the reason each
     * one moved.
     *
     * Why they moved: D-19 Option B (maintainer ruling, 2026-08-03) replaces
     * Standard's single calculator run over the concatenated 1436-sample
     * selection with SEVEN independent runs, one per selected lap.
     *   - `veLength` 1436 -> 1442: adjacent laps share their boundary record, so
     *     concatenating seven per-lap outputs double-counts six samples. This is
     *     the convention the two segment modes already follow.
     *   - `r2` / `rmse` / the gains become the MEAN of the seven per-lap fits
     *     (entry g), not one fit over the whole selection.
     *   - the VE array becomes seven independently zero-based segments stitched
     *     together (entry f) — `build_virtual_elevation` restarts its
     *     integration from `cumulative_elevation = 0.0` per run.
     *
     * They are IDENTICAL to the gpsLap literals below, and that is the point:
     * the fixture's seven Standard laps resolve to exactly the seven ranges
     * GPS-lap uses, so under Option B the two modes compute the same thing. Any
     * future divergence between the two blocks is a defect in one of them.
     */
    const GOLDEN: Record<string, GoldenCase> = {
        'standard / fit / rho present': {
            r2: 0.3135718941005455, rmse: 5.163938255431569,
            veElevationDiff: 8.635857151837952, actualElevationDiff: -0.14285714285714285,
            veLength: 1442, veFirst: 0.13080271636508098,
            veMid: 1.8930276578777034, veLast: 18.64123262055564,
            veChecksum: 7459.003136834831,
        },
        'standard / fit / rho absent': {
            r2: 0.31396442776478145, rmse: 5.444012415025426,
            veElevationDiff: 9.118447594906716, actualElevationDiff: -0.14285714285714285,
            veLength: 1442, veFirst: 0.13300666843549439,
            veMid: 1.9873054396522434, veLast: 19.192691384772218,
            veChecksum: 7859.641202644601,
        },
        'standard / constant / rho present': {
            r2: 0.24966734009391217, rmse: 3.065921297319822,
            veElevationDiff: 4.90796476465448, actualElevationDiff: -0.14285714285714285,
            veLength: 1442, veFirst: 0.08454169112765618,
            veMid: 0.525320250493201, veLast: 11.447807151240204,
            veChecksum: 4274.079504001773,
        },
        'standard / constant / rho absent': {
            r2: 0.2645543180169767, rmse: 3.337191098428614,
            veElevationDiff: 5.429462686581246, actualElevationDiff: -0.14285714285714285,
            veLength: 1442, veFirst: 0.08735132354814168,
            veMid: 0.6339384644627134, veLast: 12.059466638124354,
            veChecksum: 4707.914727056141,
        },
        'standard / compare / rho present': {
            r2: 0.37076455698221766, rmse: 27.660186515290867,
            veElevationDiff: 47.36263303718022, actualElevationDiff: -1,
            veLength: 1436, veFirst: 0.08454169112765618,
            veMid: 34.314201998008826, veLast: 60.58180277923049,
            veChecksum: 69710.61308842475,
        },
        'standard / compare / rho absent': {
            r2: 0.36803843146696, rmse: 29.832327736438977,
            veElevationDiff: 50.877350103641106, actualElevationDiff: -1,
            veLength: 1436, veFirst: 0.08735132354814168,
            veMid: 36.22807384732491, veLast: 63.96213983278249,
            veChecksum: 75296.93643148862,
        },
        'gpsLap / fit / rho present': {
            r2: 0.3135718941005455, rmse: 5.163938255431569,
            veElevationDiff: 8.635857151837952, actualElevationDiff: -0.14285714285714285,
            veLength: 1442, veFirst: 0.13080271636508098,
            veMid: 1.8930276578777034, veLast: 18.64123262055564,
            veChecksum: 7459.003136834831,
        },
        'gpsLap / fit / rho absent': {
            r2: 0.31396442776478145, rmse: 5.444012415025426,
            veElevationDiff: 9.118447594906716, actualElevationDiff: -0.14285714285714285,
            veLength: 1442, veFirst: 0.13300666843549439,
            veMid: 1.9873054396522434, veLast: 19.192691384772218,
            veChecksum: 7859.641202644601,
        },
        'gpsLap / constant / rho present': {
            r2: 0.24966734009391217, rmse: 3.065921297319822,
            veElevationDiff: 4.90796476465448, actualElevationDiff: -0.14285714285714285,
            veLength: 1442, veFirst: 0.08454169112765618,
            veMid: 0.525320250493201, veLast: 11.447807151240204,
            veChecksum: 4274.079504001773,
        },
        'gpsLap / constant / rho absent': {
            r2: 0.2645543180169767, rmse: 3.337191098428614,
            veElevationDiff: 5.429462686581246, actualElevationDiff: -0.14285714285714285,
            veLength: 1442, veFirst: 0.08735132354814168,
            veMid: 0.6339384644627134, veLast: 12.059466638124354,
            veChecksum: 4707.914727056141,
        },
        'outAndBack / fit / rho present': {
            r2: 0.23663811128037052, rmse: 2.5665616731550385,
            veElevationDiff: 4.318108702531325, actualElevationDiff: -0.07142857142857142,
            veLength: 1442, veFirst: 0.13080271636508098,
            veMid: 0.4664237112543842, veLast: 9.096511330968736,
            veChecksum: 3693.674836894759,
        },
        'outAndBack / fit / rho absent': {
            r2: 0.23625407922230043, rmse: 2.7033292363874706,
            veElevationDiff: 4.558366481255591, actualElevationDiff: -0.07142857142857142,
            veLength: 1442, veFirst: 0.13300666843549439,
            veMid: 0.49649120046216566, veLast: 9.371555806705198,
            veChecksum: 3894.979372637538,
        },
        'outAndBack / constant / rho present': {
            r2: 0.18038551601327346, rmse: 1.534731117106101,
            veElevationDiff: 2.481708024655112, actualElevationDiff: -0.07142857142857142,
            veLength: 1442, veFirst: 0.08454169112765618,
            veMid: -0.0339774492845063, veLast: 4.30530931973201,
            veChecksum: 1936.4822330829263,
        },
        'outAndBack / constant / rho absent': {
            r2: 0.18985744230377524, rmse: 1.656348402207844,
            veElevationDiff: 2.741150094809736, actualElevationDiff: -0.07142857142857142,
            veLength: 1442, veFirst: 0.08735132354814168,
            veMid: 0.0011447390494593451, veLast: 4.621526001894558,
            veChecksum: 2155.8332506962365,
        },
    };

    const ANALYZE_LEG: Record<string, GoldenCase> = {
        'rho present': {
            r2: 0.3409142470926482, rmse: 53.03262090234332,
            veElevationDiff: 91.91350458652892, actualElevationDiff: -1,
            veLength: 1436, veFirst: 0.1494676973283636,
            veMid: 49.47813311925598, veLast: 92.06297228385738,
            veChecksum: 67076.78628283592,
        },
        'rho absent': {
            r2: 0.3407910199483517, rmse: 54.92825535110805,
            veElevationDiff: 94.97854270576909, actualElevationDiff: -1,
            veLength: 1436, veFirst: 0.1514272589472916,
            veMid: 51.21412767834871, veLast: 95.12996996471627,
            veChecksum: 69506.78545986385,
        },
    };

    test('standard / fit / rho present', async () => {
        expectGolden(await runStandard('fit', true), GOLDEN['standard / fit / rho present']);
    });
    test('standard / fit / rho absent', async () => {
        expectGolden(await runStandard('fit', false), GOLDEN['standard / fit / rho absent']);
    });
    test('standard / constant / rho present', async () => {
        expectGolden(await runStandard('constant', true), GOLDEN['standard / constant / rho present']);
    });
    test('standard / constant / rho absent', async () => {
        expectGolden(await runStandard('constant', false), GOLDEN['standard / constant / rho absent']);
    });
    test('standard / compare / rho present', () => {
        expectGolden(runStandardCompare(true), GOLDEN['standard / compare / rho present']);
    });
    test('standard / compare / rho absent', () => {
        expectGolden(runStandardCompare(false), GOLDEN['standard / compare / rho absent']);
    });

    /**
     * CASE 15 — the D-21 / N-6 guard, added by plan 07-02 Task 4.
     *
     * `virtualDistanceAirKm` is the number a double application of the air-speed
     * calibration moves, and it is the ONLY golden number that moves for that
     * reason: r² and RMSE come from the calculator, which never saw the
     * multiplier. Plan 01 deferred this row here because the hazard could not
     * exist until D-05 pre-calibrated the series.
     *
     * The literal is the SUM over segments of each segment's final accumulated
     * air distance, so a change in any one lap moves it. At
     * GOLDEN_CALIBRATION_PERCENT = 5 a second application would scale it by a
     * further 1.05.
     */
    test('standard / fit / rho present / virtual distance is calibrated exactly once', async () => {
        const outcome = await runStandardUpdate('fit', true);

        const totalAirKm = outcome.profiles.reduce((sum, profile) => {
            const series = profile.supplementarySeries.virtualDistanceAirKm;
            return sum + series[series.length - 1];
        }, 0);
        const totalGroundKm = outcome.profiles.reduce((sum, profile) => {
            const series = profile.supplementarySeries.virtualDistanceGroundKm;
            return sum + series[series.length - 1];
        }, 0);

        // The D-21 assertions come FIRST so that a double application is the
        // first thing this case reports, rather than being masked by the r²
        // failure a doubled wind series also produces.
        expect(totalAirKm).toBeCloseTo(VD_AIR_KM_TOTAL, PRECISION);
        // Ground distance carries no calibration at all, so it must NOT move
        // when the multiplier is reintroduced — that asymmetry is what makes the
        // air assertion specific to the double-apply rather than to any change.
        expect(totalGroundKm).toBeCloseTo(VD_GROUND_KM_TOTAL, PRECISION);
        // The double-application value, stated so the mutation row is
        // reproducible: re-adding `1 + pct/100` anywhere in the resolved path
        // scales the air total by a further 1.05 and this assertion fails.
        expect(totalAirKm).not.toBeCloseTo(VD_AIR_KM_TOTAL * 1.05, 3);

        expect(outcome.aggregate.r2).toBeCloseTo(
            GOLDEN['standard / fit / rho present'].r2,
            PRECISION,
        );
        expect(outcome.aggregate.rmse).toBeCloseTo(
            GOLDEN['standard / fit / rho present'].rmse,
            PRECISION,
        );
    });

    test('gpsLap / fit / rho present', async () => {
        expectGolden(await runGpsLap('fit', true), GOLDEN['gpsLap / fit / rho present']);
    });
    test('gpsLap / fit / rho absent', async () => {
        expectGolden(await runGpsLap('fit', false), GOLDEN['gpsLap / fit / rho absent']);
    });
    test('gpsLap / constant / rho present', async () => {
        expectGolden(await runGpsLap('constant', true), GOLDEN['gpsLap / constant / rho present']);
    });
    test('gpsLap / constant / rho absent', async () => {
        expectGolden(await runGpsLap('constant', false), GOLDEN['gpsLap / constant / rho absent']);
    });

    test('outAndBack / fit / rho present', async () => {
        expectGolden(await runOutAndBack('fit', true), GOLDEN['outAndBack / fit / rho present']);
    });
    test('outAndBack / fit / rho absent', async () => {
        expectGolden(await runOutAndBack('fit', false), GOLDEN['outAndBack / fit / rho absent']);
    });
    test('outAndBack / constant / rho present', async () => {
        expectGolden(await runOutAndBack('constant', true), GOLDEN['outAndBack / constant / rho present']);
    });
    test('outAndBack / constant / rho absent', async () => {
        expectGolden(await runOutAndBack('constant', false), GOLDEN['outAndBack / constant / rho absent']);
    });

    /**
     * rho must actually change the answer. Without this, "rho present" and
     * "rho absent" could be the same code path and all 14 literals would still
     * pass — D-10 mutation (b) proves it reaches WASM, this proves the AXIS is
     * not degenerate in the fixture itself.
     */
    /**
     * Two ADDITIONAL guards beyond the specified 14, covering the Standard
     * analyze leg. Not part of the 14-case D-09 baseline; they exist solely so
     * that deleting the `rhoArray` argument at `prepareAnalysisPayload.ts:121`
     * is observable. See `runStandardAnalyzeLeg`.
     */
    test('standard analyze leg (prepareAnalysisPayload) / rho present', () => {
        expectGolden(runStandardAnalyzeLeg(true), ANALYZE_LEG['rho present']);
    });
    test('standard analyze leg (prepareAnalysisPayload) / rho absent', () => {
        expectGolden(runStandardAnalyzeLeg(false), ANALYZE_LEG['rho absent']);
    });

    test('the rho axis is not vacuous', () => {
        for (const mode of ['standard', 'gpsLap', 'outAndBack'] as const) {
            const withRho = GOLDEN[`${mode} / fit / rho present`];
            const withoutRho = GOLDEN[`${mode} / fit / rho absent`];
            expect(withRho.veChecksum).not.toBeCloseTo(withoutRho.veChecksum, 3);
        }
    });
});
