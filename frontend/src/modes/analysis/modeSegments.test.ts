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
import { buildFilteredDataFromProfiles } from './segmentSummary'

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
        resultCompare: null,
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
        // `summarize` reads these to build the per-segment virtual distances it
        // now writes to AppState (change-list entry (h)). Indexed by
        // `profile.indices`, i.e. the full activity.
        normalized: {
            timestamps: Array.from({ length: SAMPLE_COUNT }, (_, i) => i),
            velocity: Array.from({ length: SAMPLE_COUNT }, () => 10),
        },
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

    it('emits one segment per SELECTED LAP even when the laps are ADJACENT', () => {
        const handler = getAnalysisModeHandler(null);
        const segments = handler.getUpdateSegments(standardState([1, 2]));

        // The heart of D-19 Option B as the maintainer reaffirmed it: adjacency
        // does NOT merge. Two selected laps mean two independent calculator runs
        // and therefore a VE discontinuity at their shared boundary (D-09 entry
        // f), and N = 2 in "the mean of N per-lap fits" (entry g). Folding these
        // into one range would silently suppress both accepted consequences,
        // which is what an earlier revision of this handler did.
        expect(segments).toHaveLength(2);
        expect(segments.map(s => s.range)).toEqual([
            { startIdx: 0, endIdx: 9 },
            { startIdx: 10, endIdx: 19 },
        ]);
        expect(segments.map(s => s.label)).toEqual(['Lap 1', 'Lap 2']);
    });

    it('emits one INDEPENDENT segment per lap for a NON-CONTIGUOUS multi-lap selection', () => {
        const handler = getAnalysisModeHandler(null);
        const segments = handler.getUpdateSegments(standardState([1, 4]));

        expect(segments).toHaveLength(2);
        expect(segments.map(s => s.range)).toEqual([
            { startIdx: 0, endIdx: 9 },
            { startIdx: 30, endIdx: 39 },
        ]);
        // Full-activity indices, not lap-local ones.
        expect(segments[1].range.startIdx).toBe(30);
    });

    it('orders segments by index, not by the order the checkboxes were ticked', () => {
        const handler = getAnalysisModeHandler(null);
        // Lap 4 ticked before lap 1. The stitched output must still run in
        // ascending index order, because that is the order the analyze-time
        // selection (and therefore the trim slider's index space) is built in.
        const segments = handler.getUpdateSegments(standardState([4, 1]));

        expect(segments.map(s => s.range.startIdx)).toEqual([0, 30]);
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

/**
 * WR-06. THE UPDATE PATH BELONGS TO THE ANALYZED SELECTION, not to the live
 * checkboxes.
 *
 * `getUpdateSegments` resolved Standard's laps through `prepareSelection`, which
 * reads `appState.selectedLaps` — the LIVE checkbox state. But the panel being
 * updated, its trim sliders and `currentAnalyzedLaps` all belong to the
 * previously analyzed selection. `veSelectionGuard.veViewMatchesSelection`
 * exists precisely because those two diverge, and it was consulted only for map
 * markers.
 *
 * So ticking a different lap and then nudging CdA — without pressing Analyze —
 * computed segments for the NEW laps, mapped a trim window sized for the OLD
 * selection onto them, and let `summarize` overwrite `currentVEResult` /
 * `currentFilteredData` for a selection the user never analyzed.
 */
describe('standardMode update path vs live checkbox selection', () => {
    function divergedState(analyzed: number[], ticked: number[]): AppState {
        const appState = new AppState();
        appState.currentFitData = makeFitData();
        appState.currentLaps = [
            makeLap(0, 9),
            makeLap(10, 19),
            makeLap(20, 29),
            makeLap(30, 39),
        ];
        appState.currentAnalyzedLaps = analyzed;
        appState.selectedLaps = ticked;
        return appState;
    }

    it('updates the ANALYZED laps when the checkboxes have moved on', () => {
        const handler = getAnalysisModeHandler(null);

        // Analyzed lap 1; user has since ticked lap 4 without re-analyzing.
        const segments = handler.getUpdateSegments(divergedState([1], [4]));

        expect(segments).toHaveLength(1);
        expect(segments[0].range).toEqual({ startIdx: 0, endIdx: 9 });
        expect(segments[0].label).toBe('Lap 1');
    });

    it('follows the checkboxes once they have been analyzed', () => {
        const handler = getAnalysisModeHandler(null);

        // After Analyze the two agree, which is the ordinary case.
        const segments = handler.getUpdateSegments(divergedState([4], [4]));

        expect(segments).toHaveLength(1);
        expect(segments[0].range).toEqual({ startIdx: 30, endIdx: 39 });
    });

    /**
     * The analyze path is the one place `selectedLaps` IS the right source —
     * it is what the user just asked to analyze, and `currentAnalyzedLaps` still
     * holds the previous run at that moment.
     */
    it('leaves prepareSelection reading the live checkboxes for the analyze path', () => {
        const handler = getAnalysisModeHandler(null);

        const selection = handler.prepareSelection(divergedState([1], [4]));

        expect(selection.selectedItems).toEqual([4]);
    });
});

/**
 * THE TRIM WINDOW MUST REACH `currentFilteredData`.
 *
 * `mapTrimToSegments` does NOT narrow `segment.range` — it spreads the range
 * unchanged and adds a `trim` field (`standardSegments.ts:132`), and
 * `updateModeVEPlots.ts:218-224` builds `profile.indices` from `range` alone
 * because the calculator wants the full slice plus separate trim boundaries.
 *
 * So `profile.indices` is the UNTRIMMED range. A concatenation that walks it
 * without applying `trim` produces the whole selection, and Store Result then
 * averages power, speed and temperature over samples the rider explicitly
 * trimmed off — their acceleration and roll-out — and persists that to
 * IndexedDB and the CSV export.
 */
describe('buildFilteredDataFromProfiles honours the trim window', () => {
    function appStateWithSamples(count: number): AppState {
        const appState = new AppState();
        appState.currentFitData = {
            timestamps: Array.from({ length: count }, (_, i) => i),
            power: Array.from({ length: count }, (_, i) => i * 10),
            velocity: Array.from({ length: count }, (_, i) => i),
            temperature: Array.from({ length: count }, () => 20),
        } as any;
        return appState;
    }

    function profileWithTrim(
        startIdx: number,
        endIdx: number,
        trim: { start: number; end: number } | undefined,
    ): any {
        const indices: number[] = [];
        for (let i = startIdx; i <= endIdx; i++) indices.push(i);
        return { segment: { key: 's', label: 'Lap 1', range: { startIdx, endIdx }, trim }, indices };
    }

    it('emits only the trimmed samples of a segment', () => {
        const appState = appStateWithSamples(100);
        // Lap covers 0..99; the rider trimmed to the middle 20 samples.
        const profiles = [profileWithTrim(0, 99, { start: 40, end: 59 })];

        const filtered = buildFilteredDataFromProfiles(appState, profiles);

        expect(filtered.power).toHaveLength(20);
        expect(filtered.timestamps[0]).toBe(40);
        expect(filtered.timestamps[19]).toBe(59);
    });

    it('emits the whole segment when no trim is set', () => {
        const appState = appStateWithSamples(100);
        const profiles = [profileWithTrim(0, 99, undefined)];

        const filtered = buildFilteredDataFromProfiles(appState, profiles);

        expect(filtered.power).toHaveLength(100);
    });

    it('applies each segment its own trim across a multi-lap selection', () => {
        const appState = appStateWithSamples(100);
        const profiles = [
            profileWithTrim(0, 49, { start: 10, end: 19 }),
            profileWithTrim(50, 99, { start: 0, end: 4 }),
        ];

        const filtered = buildFilteredDataFromProfiles(appState, profiles);

        expect(filtered.power).toHaveLength(15);
        expect(filtered.timestamps[0]).toBe(10);
        expect(filtered.timestamps[10]).toBe(50);
    });
});

/**
 * WR-05. `FilteredAnalysisData` declares four `number[]` with an implied common
 * length (`AppState.ts:121-126`), and consumers index them in parallel. When the
 * activity carries no temperature channel the loop pushed nothing, so
 * `temperature` was `[]` against three full-length siblings — and
 * `calculateAverage` returns 0 for an empty array, so Store Result persisted
 * `avgTemperature: 0`, indistinguishable from a genuine 0 °C ride.
 *
 * That is the same confusion the earlier `Boolean([])` fix removed, one level
 * along: there the fabricated 0 came from `|| 0` per sample, here from an empty
 * array meeting a defaulting averager.
 */
describe('buildFilteredDataFromProfiles keeps temperature aligned', () => {
    function stateWithoutTemperature(count: number): AppState {
        const appState = new AppState();
        appState.currentFitData = {
            timestamps: Array.from({ length: count }, (_, i) => i),
            power: Array.from({ length: count }, () => 250),
            velocity: Array.from({ length: count }, () => 10),
            // no temperature channel at all
        } as any;
        return appState;
    }

    function fullProfile(count: number): any {
        const indices = Array.from({ length: count }, (_, i) => i);
        return { segment: { key: 's', label: 'Lap 1', range: { startIdx: 0, endIdx: count - 1 } }, indices }
    }

    it('emits a NaN per sample rather than an empty array', () => {
        const filtered = buildFilteredDataFromProfiles(stateWithoutTemperature(50), [fullProfile(50)])

        expect(filtered.temperature).toHaveLength(filtered.power.length)
        expect(filtered.temperature.every(Number.isNaN)).toBe(true)
    })
})
