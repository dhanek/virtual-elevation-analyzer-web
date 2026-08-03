/**
 * Type-B guards for the update-side members added to AnalysisModeHandler.
 *
 * Follows `syncStateOverlay.test.ts`: drives the REAL handlers through the REAL
 * registry (`getAnalysisModeHandler`) against hand-built AppState fixtures. No
 * module is mocked, so a rewrite of the handlers to junk fails these tests.
 */
import { describe, expect, it } from 'vitest';
import { AppState } from '../../state/AppState';
import type { ActivityDataLike, ActivityLapLike } from '../../state/AppState';
import type { DetectedLap, OutAndBackSection } from '../../utils/GpsLapDetection';
import { getAnalysisModeHandler } from './AnalysisModes';
import { indicesToRanges } from './standardMode';
import type { ModeAggregateStats, ResolvedUpdateInputs, SegmentVeProfile } from './types';

const SAMPLE_COUNT = 40;

function makeFitData(): ActivityDataLike {
    const timestamps = Array.from({ length: SAMPLE_COUNT }, (_, i) => i);
    return {
        timestamps,
        power: timestamps.map(() => 200),
        velocity: timestamps.map(() => 10),
        position_lat: timestamps.map(() => 45),
        position_long: timestamps.map(() => -30),
        altitude: timestamps.map(() => 100),
        distance: timestamps.map(i => i * 10),
        temperature: timestamps.map(() => 16),
    } as unknown as ActivityDataLike;
}

function makeLap(startTime: number, endTime: number): ActivityLapLike {
    return { start_time: startTime, end_time: endTime } as unknown as ActivityLapLike;
}

function makeDetectedLap(lapNumber: number, startIdx: number, endIdx: number): DetectedLap {
    return { lapNumber, startIdx, endIdx } as unknown as DetectedLap;
}

function makeSection(sectionNumber: number, base: number): OutAndBackSection {
    return {
        sectionNumber,
        outboundStartIdx: base,
        outboundEndIdx: base + 4,
        inboundStartIdx: base + 5,
        inboundEndIdx: base + 9,
    } as unknown as OutAndBackSection;
}

/** Inclusive index run, e.g. range(20, 24) -> [20, 21, 22, 23, 24]. */
function range(startIdx: number, endIdx: number): number[] {
    return Array.from({ length: endIdx - startIdx + 1 }, (_, i) => startIdx + i);
}

/** A profile carrying just enough for `summarize` to do its work. */
function makeProfile(indices: number[]): SegmentVeProfile {
    return {
        segment: { key: 'k', label: 'l', range: { startIdx: indices[0], endIdx: indices[indices.length - 1] } },
        indices,
        distancesKm: indices.map((_, i) => i / 1000),
        timeIndices: indices.map((_, i) => i),
        virtualElevation: indices.map(() => 1),
        virtualElevationCompare: null,
        actualElevation: indices.map(() => 100),
        supplementarySeries: {
            distancesKm: [],
            powerWatts: [],
            apparentWindSpeedMps: [],
            virtualDistanceAirKm: [],
            virtualDistanceGroundKm: [],
        },
        result: {
            virtual_elevation: new Float64Array(indices.length),
            r2: 0.5,
            rmse: 1,
            ve_elevation_diff: 2,
            actual_elevation_diff: 3,
            virtual_distance_air: 0,
            virtual_distance_ground: 0,
            vd_difference_percent: 0,
        },
    };
}

const AGGREGATE: ModeAggregateStats = {
    r2: 0.5,
    rmse: 1,
    veGain: 2,
    actualGain: 3,
    segmentCount: 1,
};

function makeInputs(): ResolvedUpdateInputs {
    return {
        wind: { selectedWindSource: 'fit' },
        windSource: 'fit',
    } as unknown as ResolvedUpdateInputs;
}

describe('indicesToRanges', () => {
    it('folds contiguous indices into one range and splits at every gap', () => {
        expect(indicesToRanges([0, 1, 2, 3])).toEqual([{ startIdx: 0, endIdx: 3 }]);
        expect(indicesToRanges([0, 1, 5, 6, 7])).toEqual([
            { startIdx: 0, endIdx: 1 },
            { startIdx: 5, endIdx: 7 },
        ]);
        expect(indicesToRanges([])).toEqual([]);
    });
});

describe('standardMode.getUpdateSegments (D-19 Option B)', () => {
    function standardState(selected: number[]): AppState {
        const appState = new AppState();
        appState.currentFitData = makeFitData();
        // Four laps of ten samples each, over timestamps 0..39.
        appState.currentLaps = [
            makeLap(0, 9),
            makeLap(10, 19),
            makeLap(20, 29),
            makeLap(30, 39),
        ];
        appState.selectedLaps = selected;
        return appState;
    }

    it('emits ONE segment per contiguous run, with full-activity indices', () => {
        const handler = getAnalysisModeHandler(null);
        const segments = handler.getUpdateSegments(standardState([1, 2]));

        // Laps 1 and 2 are adjacent, so they form a single contiguous run.
        expect(segments).toHaveLength(1);
        expect(segments[0].range).toEqual({ startIdx: 0, endIdx: 19 });
    });

    it('emits one INDEPENDENT segment per run for a NON-CONTIGUOUS multi-lap selection', () => {
        const handler = getAnalysisModeHandler(null);
        const segments = handler.getUpdateSegments(standardState([1, 4]));

        // This is the D-19 Option B shape: laps 1 and 4 integrate separately.
        expect(segments).toHaveLength(2);
        expect(segments.map(s => s.range)).toEqual([
            { startIdx: 0, endIdx: 9 },
            { startIdx: 30, endIdx: 39 },
        ]);
        // Full-activity indices, not lap-local ones.
        expect(segments[1].range.startIdx).toBe(30);
    });

    it('summarize writes all three AppState result fields', () => {
        const handler = getAnalysisModeHandler(null);
        const appState = standardState([1]);
        const profiles = [makeProfile([0, 1, 2, 3])];

        handler.summarize(appState, profiles, AGGREGATE, makeInputs());

        expect(appState.currentVEResult).not.toBeNull();
        expect(appState.currentFilteredData).not.toBeNull();
        expect(appState.currentFilteredData!.power).toHaveLength(4);
        expect(appState.currentWindSource).toBe('fit');
    });
});

describe('gpsLapMode.getUpdateSegments', () => {
    it('uses the ACTIVE overlay ranges — stacked-from-standard, where gpsDetectedLaps is EMPTY', () => {
        const handler = getAnalysisModeHandler('GPS based lap splitting');
        const appState = new AppState();
        appState.currentFitData = makeFitData();
        // The stacked-from-standard overlay: no GPS detection has run at all,
        // the ranges live only on currentGpsLapIndexRanges.
        appState.gpsDetectedLaps = [];
        appState.gpsSelectedLaps = [];
        appState.currentGpsLapIndexRanges = [
            { startIdx: 0, endIdx: 9 },
            { startIdx: 20, endIdx: 29 },
        ];
        appState.currentOverlayLapNumbers = [1, 3];

        const segments = handler.getUpdateSegments(appState);

        expect(segments).toHaveLength(2);
        expect(segments.map(s => s.range)).toEqual([
            { startIdx: 0, endIdx: 9 },
            { startIdx: 20, endIdx: 29 },
        ]);
        expect(segments.map(s => s.label)).toEqual(['Lap 1', 'Lap 3']);
    });

    it('falls back to the selected detected laps when no active ranges are set', () => {
        const handler = getAnalysisModeHandler('GPS based lap splitting');
        const appState = new AppState();
        appState.currentFitData = makeFitData();
        appState.gpsDetectedLaps = [makeDetectedLap(1, 0, 9), makeDetectedLap(2, 10, 19)];
        appState.gpsSelectedLaps = [2];
        appState.currentGpsLapIndexRanges = null;

        const segments = handler.getUpdateSegments(appState);

        expect(segments).toHaveLength(1);
        expect(segments[0].range).toEqual({ startIdx: 10, endIdx: 19 });
    });

    it('summarize writes all three AppState result fields', () => {
        const handler = getAnalysisModeHandler('GPS based lap splitting');
        const appState = new AppState();
        appState.currentFitData = makeFitData();
        appState.currentGpsLapIndexRanges = [{ startIdx: 0, endIdx: 3 }];

        handler.summarize(appState, [makeProfile([0, 1, 2, 3])], AGGREGATE, makeInputs());

        expect(appState.currentVEResult).not.toBeNull();
        expect(appState.currentFilteredData).not.toBeNull();
        expect(appState.currentWindSource).toBe('fit');
        // The three virtual-distance fields stay zeroed -- deliberate, see
        // segmentSummary.ts. Populating them would move stored output.
        expect(appState.currentVEResult!.virtual_distance_air).toBe(0);
    });
});

describe('outAndBackMode.getUpdateSegments', () => {
    function oabState(): AppState {
        const appState = new AppState();
        appState.currentFitData = makeFitData();
        appState.outAndBackSections = [makeSection(1, 0), makeSection(2, 20)];
        appState.outAndBackSelectedSections = [1, 2];
        return appState;
    }

    it('yields 2N segments in outbound/inbound order', () => {
        const handler = getAnalysisModeHandler('GPS based out and back');
        const segments = handler.getUpdateSegments(oabState());

        expect(segments).toHaveLength(4);
        expect(segments.map(s => s.key)).toEqual(['s1-out', 's1-in', 's2-out', 's2-in']);
        expect(segments.map(s => s.range)).toEqual([
            { startIdx: 0, endIdx: 4 },
            { startIdx: 5, endIdx: 9 },
            { startIdx: 20, endIdx: 24 },
            { startIdx: 25, endIdx: 29 },
        ]);
    });

    it('summarize writes all three AppState result fields -- this is N-1 / D-17a', () => {
        const handler = getAnalysisModeHandler('GPS based out and back');
        const appState = oabState();

        // Before: out-and-back wrote NONE of these after the initial analyze.
        expect(appState.currentVEResult).toBeNull();
        expect(appState.currentFilteredData).toBeNull();

        // Ranges matching section 1's outbound (0..4) and inbound (5..9).
        handler.summarize(
            appState,
            [makeProfile([0, 1, 2, 3, 4]), makeProfile([5, 6, 7, 8, 9])],
            AGGREGATE,
            makeInputs(),
        );

        expect(appState.currentVEResult).not.toBeNull();
        expect(appState.currentFilteredData).not.toBeNull();
        expect(appState.currentWindSource).toBe('fit');
        // Section 2 produced no segment, so it is not reported as analysed.
        expect(appState.currentAnalyzedLaps).toEqual([1]);
    });

    it('reports a section whose legs were all skipped as NOT analysed', () => {
        const handler = getAnalysisModeHandler('GPS based out and back');
        const appState = oabState();

        // Only section 2's outbound (20..24) survived.
        handler.summarize(appState, [makeProfile(range(20, 24))], AGGREGATE, makeInputs());

        expect(appState.currentAnalyzedLaps).toEqual([2]);
    });

    it('computes segments from the ON-SCREEN sections, not the checkbox state', () => {
        const handler = getAnalysisModeHandler('GPS based out and back');
        const appState = oabState();
        // What was analysed and drawn.
        appState.currentOutAndBackSections = [makeSection(1, 0)];
        // The user then ticked a second box WITHOUT re-running the analysis.
        appState.outAndBackSelectedSections = [1, 2];

        const segments = handler.getUpdateSegments(appState);

        // A slider drag must still recompute exactly what is on screen.
        expect(segments.map(s => s.key)).toEqual(['s1-out', 's1-in']);
    });
});

describe('the registry carries the update members for every mode', () => {
    it('all three handlers implement both, so the registry cannot be partial', () => {
        for (const mode of [null, 'GPS based lap splitting', 'GPS based out and back']) {
            const handler = getAnalysisModeHandler(mode);
            expect(typeof handler.getUpdateSegments).toBe('function');
            expect(typeof handler.summarize).toBe('function');
        }
    });
});
