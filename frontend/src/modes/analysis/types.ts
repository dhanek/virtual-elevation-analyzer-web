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
	trim?: { start: number; end: number };
}

/** Everything the primitive resolves ONCE, before any segment loop. */
export interface ResolvedUpdateInputs {
	normalized: NormalizedActivityArrays;
	/** resolveWindSeries over the FULL series — the only offset/calibration site. */
	wind: WindSeriesResolution;
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
	/** Always null in plan 07-02; D-07/D-20 populates it in plan 07-04. */
	virtualElevationCompare: number[] | null;
	actualElevation: number[];
	supplementarySeries: SegmentSupplementarySeries;
	result: VEAnalysisResult;
}

export interface ModeAggregateStats {
	r2: number;
	rmse: number;
	veGain: number;
	actualGain: number;
	segmentCount: number;
	/** Mode-only figures, e.g. GPS-lap's closingError. */
	extra?: Record<string, number>;
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
