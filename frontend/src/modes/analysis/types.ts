import type { AnalysisParameters } from "../../components/AnalysisParameters";
import type { NormalizedActivityArrays } from "../../analysis/ActivityArrayCache";
import type { SegmentSupplementarySeries } from "../../analysis/SegmentSupplementarySeries";
import type { WindSeriesResolution } from "../../analysis/WindSourceResolver";
import type {
	ActivityDataLike,
	ActivityLapLike,
	AppState,
	LapIndexRange,
	WindSource,
} from "../../state/AppState";
import type {
	DetectedLap,
	OutAndBackSection,
} from "../../utils/GpsLapDetection";
import type { VEAnalysisResult } from "../../utils/ResultsStorage";

export type AnalysisModeId = "standard" | "gpsLap" | "outAndBack";

export interface TimeRange {
	start: number;
	end: number;
}

export type AnalysisSelectionEntry =
	| ActivityLapLike
	| DetectedLap
	| OutAndBackSection;

export interface PreparedAnalysisSelection {
	mode: AnalysisModeId;
	selectedItems: number[];
	selectedEntries: AnalysisSelectionEntry[];
	indexRanges: LapIndexRange[] | null;
	timeRanges: TimeRange[] | null;
	outAndBackSections: OutAndBackSection[] | null;
	emptySelectionMessage: string;
}

export interface FilteredAnalysisPayload {
	timestamps: number[];
	power: number[];
	velocity: number[];
	positionLat: number[];
	positionLong: number[];
	altitude: number[];
	distance: number[];
	windSpeed: number[];
	temperature: number[];
	cdaReference: number[] | null;
}

export interface StandardRenderArgs extends FilteredAnalysisPayload {
	initialResult: any;
	analyzedLaps: number[];
	selectedIndices: number[];
	defaultAirSpeedOffset: number;
}

export interface ModeRenderCallbacks {
	standard(args: StandardRenderArgs): Promise<void> | void;
	gpsLap(args: {
		lapIndexRanges: LapIndexRange[];
		fitData: ActivityDataLike;
		params: AnalysisParameters;
		defaultAirSpeedOffset: number;
	}): Promise<void> | void;
	outAndBack(args: {
		sections: OutAndBackSection[];
		fitData: ActivityDataLike;
		params: AnalysisParameters;
		defaultAirSpeedOffset: number;
	}): Promise<void> | void;
}

export interface ModeRenderArgs {
	appState: AppState;
	selection: PreparedAnalysisSelection;
	fitData: ActivityDataLike;
	params: AnalysisParameters;
	defaultAirSpeedOffset: number;
	initialResult: any;
	filteredData: FilteredAnalysisPayload;
	selectedIndices: number[];
	callbacks: ModeRenderCallbacks;
}

/**
 * One computable unit of work — exactly ONE `calculate_virtual_elevation` run.
 *
 * INDEX SPACE INVARIANT (D-19, Option B as ruled 2026-08-03):
 *
 *   - `range` is ALWAYS a pair of indices into the FULL activity arrays. It is
 *     never a slice offset, never a lap-local index, never a stitched-output
 *     index. Wind and its index-shifting offset are resolved on the full series
 *     BEFORE any slicing, which is what makes the multi-lap offset-ordering
 *     defect structurally impossible (change-list entry c).
 *   - `trim` is expressed in indices of THIS segment's own extract (0..n-1),
 *     where n is the length of the range.
 *   - There is no third index space.
 *
 * Standard emits one segment per contiguous run of selected laps, GPS-lap one
 * per active lap range, out-and-back two per section (outbound then inbound).
 * The rule is uniform: one calculator per ModeSegment.
 */
export interface ModeSegment {
	/** Stable identity for plot traces and legends. */
	key: string;
	/** Human label, e.g. "Lap 3" or "Section 2 outbound". */
	label: string;
	range: LapIndexRange;
	/**
	 * The mode's own number for this segment — the REAL lap number for GPS-lap,
	 * not an ordinal.
	 *
	 * Carried here because the number can only be resolved against the RANGE
	 * ORDINAL (the position in `resolveActiveGpsLapRanges`), and by the time
	 * `summarize` runs the profile list has been thinned: the primitive drops
	 * segments under `MIN_SEGMENT_SAMPLES`, drops segments whose calculator
	 * threw, and `mapTrimToSegments` drops segments the trim window does not
	 * cover. Re-deriving the number from the PROFILE ordinal at that point
	 * labels every lap after the first drop with the previous lap's number, and
	 * that number is the key `currentAnalyzedLaps` / `saveCurrentLapSettings` /
	 * Store Result are all written under.
	 *
	 * Set where the ordinal is still correct — in `getUpdateSegments` — and read
	 * downstream. `mapTrimToSegments` spreads the segment, so it survives the
	 * trim mapping.
	 */
	itemNumber?: number;
	trim?: { start: number; end: number };
}

/** Everything the primitive resolves ONCE, before any segment loop. */
export interface ResolvedUpdateInputs {
	normalized: NormalizedActivityArrays;
	/** resolveWindSeries over the FULL series — the only offset/calibration site. */
	wind: WindSeriesResolution;
	/**
	 * The SECOND full-series resolution, present iff the requested wind source is
	 * `compare`, and null for every other source (D-07/D-20, plan 07-04).
	 *
	 * A SIBLING rather than a union on `wind`, deliberately: `wind` keeps meaning
	 * "the primary series" for every downstream reader, so nothing that already
	 * reads `inputs.wind` has to learn about compare in order to keep compiling
	 * or to keep being correct.
	 */
	compareWind: WindSeriesResolution | null;
	/** resolveElevationProfile over the FULL series (D-06 / D-18). */
	altitude: number[];
	/** Full-length; the primitive slices per segment (D-06). */
	rhoArray: number[] | null;
	params: AnalysisParameters;
	cda: number;
	/** The raw 22 °C-referenced slider value. */
	crr: number;
	/** The temperature-corrected value actually handed to the physics. */
	appliedCrr: number;
	/** 'compare' is NOT collapsed here. */
	windSource: WindSource;
}

/**
 * One computed segment. Data only — no figure objects and no browser types.
 * (Stated without naming the plotting library or the global document object,
 * because the D-03 layering check for this directory is a mechanical grep and
 * a mention in prose would defeat it. Same lesson as plan 07-01, deviation 2.)
 */
export interface SegmentVeProfile {
	segment: ModeSegment;
	/** Full-activity indices this segment consumed, in order. */
	indices: number[];
	/** x-axis basis for the GPS modes. */
	distancesKm: number[];
	/** x-axis basis for Standard: 0..n-1 over this segment's extract. */
	timeIndices: number[];
	virtualElevation: number[];
	/**
	 * The constant-wind leg of a comparison, over the SAME samples as
	 * `virtualElevation` (D-07/D-20, plan 07-04).
	 *
	 * INVARIANT: non-null if and only if the requested wind source is `compare`.
	 * Every other source leaves it null, and the primary series is unchanged in
	 * every non-compare case. The two legs differ in exactly one input — the wind
	 * series — so any difference between them is physics, not bookkeeping.
	 */
	virtualElevationCompare: number[] | null;
	actualElevation: number[];
	supplementarySeries: SegmentSupplementarySeries;
	result: VEAnalysisResult;
	/**
	 * The constant-wind leg's own metrics, non-null under exactly the same
	 * condition as `virtualElevationCompare`.
	 *
	 * Carried rather than recomputed from the array: r² and RMSE come out of the
	 * calculator, and a mode-side reimplementation of them would be a second
	 * statistic that could drift from the one the primary series reports.
	 */
	resultCompare: VEAnalysisResult | null;
}

/**
 * The constant-wind leg's headline numbers, SIDE BY SIDE with the primary
 * leg's rather than averaged into them (07-04 ruling 2).
 *
 * An r² averaged across two different wind models describes neither model, so
 * the GPS modes display `fit / constant`. Standard's existing averaging is a
 * pre-phase behaviour that is NOT on the D-09 change list and is deliberately
 * left alone — it consumes this block, it does not motivate its shape.
 */
export interface ModeCompareStats {
	r2: number;
	rmse: number;
	veGain: number;
	actualGain: number;
	/** Mode-only figures for the constant leg, e.g. GPS-lap's closingError. */
	extra?: Record<string, number>;
}

export interface ModeAggregateStats {
	r2: number;
	rmse: number;
	veGain: number;
	actualGain: number;
	segmentCount: number;
	/** Mode-only figures, e.g. GPS-lap's closingError. */
	extra?: Record<string, number>;
	/**
	 * Present iff the update ran under `compare` (D-07/D-20).
	 *
	 * The extension goes on the OUTPUT side because that is the direction plan
	 * 02's contract runs: the primitive hands `aggregate` the profiles and takes
	 * back a `ModeAggregateStats`. Each mode computes its own second set of
	 * numbers from `SegmentVeProfile.virtualElevationCompare` / `resultCompare`,
	 * so the primitive never learns any mode's stat shape (D-02).
	 */
	compare?: ModeCompareStats;
}

/**
 * The update-side mirror of ModeRenderCallbacks, injected by the shell exactly
 * the way createModeRenderCallbacks is injected at analyzeOrchestrator.ts:492.
 *
 * Every member takes data and returns nothing meaningful — no figure objects
 * cross this boundary in either direction.
 */
export interface ModeUpdateCallbacks {
	aggregate(profiles: SegmentVeProfile[]): ModeAggregateStats;
	renderVe(
		profiles: SegmentVeProfile[],
		aggregate: ModeAggregateStats,
	): Promise<void> | void;
	renderWind(profiles: SegmentVeProfile[]): Promise<void> | void;
	renderPower(profiles: SegmentVeProfile[]): Promise<void> | void;
	renderVd(profiles: SegmentVeProfile[]): Promise<void> | void;
	renderMetrics(aggregate: ModeAggregateStats): Promise<void> | void;
}

export interface AnalysisModeHandler {
	id: AnalysisModeId;
	getSelectedItems(appState: AppState): number[];
	validate(appState: AppState): string | null;
	prepareSelection(appState: AppState): PreparedAnalysisSelection;
	syncState(appState: AppState, selection: PreparedAnalysisSelection): void;
	render(args: ModeRenderArgs): Promise<void> | void;

	/** Which segments this mode computes for the current AppState. */
	getUpdateSegments(appState: AppState): ModeSegment[];

	/**
	 * The seam that owns the AppState result writes for every mode — the fix
	 * for N-1 / D-17a, where out-and-back wrote none of them.
	 *
	 * `inputs` is passed so the seam is self-sufficient: `currentWindSource` is
	 * one of the three writes it owns, and the requested wind source (with
	 * 'compare' NOT collapsed) is only knowable from the resolved inputs.
	 */
	summarize(
		appState: AppState,
		profiles: SegmentVeProfile[],
		aggregate: ModeAggregateStats,
		inputs: ResolvedUpdateInputs,
	): void;
}
