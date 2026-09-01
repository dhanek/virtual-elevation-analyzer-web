/**
 * Standard-mode glue between the DOM sliders and the mode-agnostic primitive.
 *
 * Everything here is pure and node-testable: no element is read, no figure is
 * built. The Plotly-facing half lives in `bindStandardSliders.ts`.
 *
 * WHY THIS FILE EXISTS — the D-19 Option B index problem.
 *
 * Under the maintainer's D-19 ruling (Option B, 2026-08-03) Standard emits ONE
 * SEGMENT PER SELECTED LAP and each segment is integrated by its own calculator
 * run. That leaves three index spaces to reconcile, and getting them confused is
 * exactly the class of bug this phase exists to remove:
 *
 *   1. FULL-ACTIVITY indices — what `ModeSegment.range` always holds.
 *   2. ANALYZE-SELECTION indices — 0..n-1 over the concatenated, DEDUPLICATED
 *      selection that `prepareAnalysisPayload` built. The trim sliders live
 *      here: their max is `filteredTimestamps.length - 1`.
 *   3. SEGMENT-LOCAL indices — 0..L-1 over one segment's own extract, which is
 *      the space `ModeSegment.trim` is defined in and the space
 *      `calculate_virtual_elevation(cda, crr, trimStart, trimEnd)` expects.
 *
 * Spaces 1 and 2 are NOT interchangeable. Adjacent laps share their boundary
 * record, so the deduplicated selection is SHORTER than the sum of the segment
 * lengths (for the golden fixture: 1436 versus 1442 over seven laps). Mapping
 * trim by arithmetic on space 2 would drift by one sample per lap boundary.
 *
 * `mapTrimToSegments` therefore routes through space 1, which is the single
 * index space D-19 exists to establish: it looks the trim endpoints up in
 * `selectedIndices` to get full-activity indices, then subtracts each segment's
 * own `startIdx`. No arithmetic ever crosses a boundary.
 */
import { resolveWindSeries } from "../../analysis/WindSourceResolver";
import type { NormalizedActivityArrays } from "../../analysis/ActivityArrayCache";
import type { ModeSegment, SegmentVeProfile } from "../../modes/analysis/types";
import type { ReferenceElevationSeries } from "../../analysis/elevationProfiles";
import type { AppState, WindSource } from "../../state/AppState";

/**
 * A segment with fewer than this many samples inside the trim window is
 * EXCLUDED from the update entirely rather than clamped.
 *
 * `calculate_metrics` (`backend/src/virtual_elevation.rs:546`) returns ZEROS
 * when `min_len < 3`. Under Option B the headline r²/RMSE are the MEAN of the
 * per-lap fits (D-09 entry g), so letting a lap that falls outside the trim
 * window contribute zeros would drag that mean toward 0 — a silently wrong
 * headline number. The maintainer ruled: exclude, do not contribute zeros.
 *
 * ACCEPTED CONSEQUENCE, stated plainly: the headline metric can therefore cover
 * FEWER laps than are selected, with nothing on screen saying so. The covered
 * count is available as `ModeAggregateStats.segmentCount`; surfacing it in the
 * UI is a recorded follow-up, deliberately not built here.
 */
export const MIN_TRIMMED_SEGMENT_SAMPLES = 3;

/**
 * The apparent-wind series for the current selection, resolved the ONE way
 * (D-05).
 *
 * This replaces the five hand-written offset+calibration copies that Standard
 * used to carry, which research found were running three different algorithms.
 * Offset and calibration are applied by `resolveWindSeries` over the FULL
 * activity and only then sliced — that ordering is what stops
 * `applyAirSpeedOffset`'s index shift from dragging air-speed samples across a
 * lap boundary in a multi-lap selection (D-09 change-list entry c).
 */
export function resolveSelectionWindSeries(
	appState: AppState,
	selectedIndices: number[],
	windSource: WindSource,
): number[] {
	const fitData = appState.currentFitData;
	if (!fitData) {
		return [];
	}

	const resolved = resolveWindSeries({
		fitData,
		windSource,
		params: appState.currentParameters,
		airSpeedCalibrationPercent: appState.airSpeedCalibrationPercent,
	});

	if (selectedIndices.length === 0) {
		return resolved.windSpeed;
	}
	return selectedIndices.map((index) => resolved.windSpeed[index]);
}

/**
 * Which wind series the Standard PLACEHOLDER calculator is handed (D-05, the
 * last inline copy).
 *
 * `initializeVEAnalysis` paints once before the sliders are bound. Its plots
 * already read `resolveSelectionWindSeries`, but its calculator used to read
 * the RAW FIT channel — so the placeholder fit and the wind plotted under it
 * described different winds whenever an offset or a calibration was set. Phase
 * 7 filed this as unobservable, because a synthetic `input` on #trimStartSlider
 * replaces the paint immediately and the placeholder result is never written to
 * `appState`. Both remain true; neither makes the divergence correct, and both
 * are properties of the CALLER that a future edit can remove.
 *
 * @param windSource   The selected source, already narrowed to fit/constant.
 * @param rawWindSpeed The selection's FIT channel as recorded.
 * @param resolved     `resolveSelectionWindSeries` over the same selection.
 */
export function resolvePlaceholderWindSpeed(
	windSource: "fit" | "constant",
	rawWindSpeed: number[],
	resolved: number[],
): number[] {
	// Constant wind has no per-sample channel: the calculator derives it from
	// the params, and a filled array would be a second, disagreeing source.
	if (windSource !== "fit") {
		return new Array<number>(rawWindSpeed.length).fill(NaN);
	}
	// `resolveSelectionWindSeries` yields [] with no loaded fitData, and slices
	// to the selection otherwise. Anything but an exact length match means the
	// two are not in the same index space, and a short array under the
	// calculator is a worse bug than an un-offset one.
	if (resolved.length !== rawWindSpeed.length) {
		return rawWindSpeed;
	}
	return resolved;
}

/**
 * Map the global trim window onto each segment, dropping segments the window
 * does not meaningfully cover.
 *
 * @param segments        Handler segments, full-activity ranges (space 1).
 * @param selectedIndices Analyze-selection index -> full-activity index.
 * @param trimStart       Slider value, an ANALYZE-SELECTION index (space 2).
 * @param trimEnd         Slider value, an ANALYZE-SELECTION index (space 2).
 */
export function mapTrimToSegments(
	segments: ModeSegment[],
	selectedIndices: number[],
	trimStart: number,
	trimEnd: number,
): ModeSegment[] {
	if (segments.length === 0) {
		return segments;
	}

	// Without a usable mapping there is no honest way to place the window, so
	// leave every segment untrimmed rather than guess. The primitive then
	// defaults each segment to its own full extent.
	if (selectedIndices.length === 0) {
		return segments;
	}

	const lastSelected = selectedIndices.length - 1;
	const startSlot = clamp(Math.min(trimStart, trimEnd), 0, lastSelected);
	const endSlot = clamp(Math.max(trimStart, trimEnd), 0, lastSelected);
	const fullStart = selectedIndices[startSlot];
	const fullEnd = selectedIndices[endSlot];

	const trimmed: ModeSegment[] = [];
	for (const segment of segments) {
		const { startIdx, endIdx } = segment.range;
		const localStart = Math.max(0, fullStart - startIdx);
		const localEnd = Math.min(endIdx - startIdx, fullEnd - startIdx);

		if (localEnd - localStart + 1 < MIN_TRIMMED_SEGMENT_SAMPLES) {
			// Outside the window, or covered too thinly to fit. See
			// MIN_TRIMMED_SEGMENT_SAMPLES.
			continue;
		}

		trimmed.push({ ...segment, trim: { start: localStart, end: localEnd } });
	}

	return trimmed;
}

export interface StitchedStandardSeries {
	length: number;
	/** Trim boundaries expressed in STITCHED-output indices, for the plot context. */
	trimStart: number;
	trimEnd: number;
	virtualElevation: number[];
	/**
	 * The stitched constant-wind leg, non-null iff the update ran under
	 * `compare` (D-07/D-20). Same length as `virtualElevation`, so the two can be
	 * drawn against one plot context.
	 */
	virtualElevationCompare: number[] | null;
	actualElevation: number[];
	/**
	 * The stitched NON-master elevation channel (see `SegmentVeProfile`),
	 * non-null iff the profiles carry one. Same length as `actualElevation`.
	 */
	referenceElevation: ReferenceElevationSeries | null;
	timestamps: number[];
	velocity: number[];
	power: number[];
	apparentWindSpeedMps: number[];
	/**
	 * Ground distance in km, accumulated across the WHOLE selection.
	 *
	 * The x-axis of every Standard plot under the distance setting. Each
	 * segment's `distancesKm` is relative to its own first sample
	 * (`buildRelativeDistanceSeries`), so a bare concatenation would restart at
	 * zero on every lap boundary; the running total carried between segments is
	 * what makes this monotonic and what makes the before/main/after regions
	 * line up. Maintainer ruling 2026-08-31, over the alternative of plotting
	 * the raw FIT odometer — which jumps backwards whenever the selected laps
	 * are not contiguous.
	 */
	cumulativeDistanceKm: number[];
}

/**
 * Is a distance axis meaningful for this selection?
 *
 * False when the FIT file carries no usable distance channel: the series is
 * then flat at zero, and an axis whose every tick reads 0.00 km is worse than
 * no switch at all. Checked on the total rather than per sample, because a
 * stationary stretch inside a ride is legitimate and repeats a value honestly.
 */
export function hasUsableDistance(series: Pick<StitchedStandardSeries, 'cumulativeDistanceKm'>): boolean {
	const km = series.cumulativeDistanceKm;
	if (km.length < 2) return false;
	const last = km[km.length - 1];
	return Number.isFinite(last) && last > 0;
}

/**
 * Concatenate the per-segment outputs into the single series the Standard
 * figures draw.
 *
 * Under Option B the VE trace is DISCONTINUOUS at each lap boundary, because
 * `build_virtual_elevation` restarts its integration from
 * `cumulative_elevation = 0.0` per run (D-09 entry f). That discontinuity is the
 * accepted consequence of the ruling, not a stitching defect.
 */
export function stitchStandardProfiles(
	profiles: SegmentVeProfile[],
	normalized: Pick<NormalizedActivityArrays, "timestamps" | "velocity">,
): StitchedStandardSeries {
	const virtualElevation: number[] = [];
	// Built only when the profiles actually carry a compare leg, so that a
	// non-compare update keeps producing `null` rather than an empty array a
	// renderer could mistake for "compare with nothing in it".
	const isCompare = profiles.some(
		(profile) => profile.virtualElevationCompare !== null,
	);
	const virtualElevationCompare: number[] | null = isCompare ? [] : null;
	const actualElevation: number[] = [];
	// Same all-or-nothing shape as the compare leg: built only when at least
	// one profile carries a reference, padded with NaN over any that does not,
	// so the series never shortens and slides later samples off their x.
	const referenceLabel =
		profiles.find((profile) => profile.referenceElevation)?.referenceElevation
			?.label ?? null;
	const referenceSeries: number[] | null = referenceLabel ? [] : null;
	const timestamps: number[] = [];
	const velocity: number[] = [];
	const power: number[] = [];
	const apparentWindSpeedMps: number[] = [];
	const cumulativeDistanceKm: number[] = [];

	// Carried ACROSS segments: each segment's `distancesKm` restarts at zero, so
	// without this the axis would reset on every lap boundary.
	let distanceOffsetKm = 0;
	let offset = 0;
	let trimStart = 0;
	let trimEnd = 0;
	let seenFirstTrim = false;

	for (const profile of profiles) {
		const length = profile.virtualElevation.length;
		const localStart = profile.segment.trim?.start ?? 0;
		const localEnd = profile.segment.trim?.end ?? Math.max(0, length - 1);

		if (!seenFirstTrim) {
			trimStart = offset + localStart;
			seenFirstTrim = true;
		}
		trimEnd = offset + localEnd;

		virtualElevation.push(...profile.virtualElevation);
		if (virtualElevationCompare) {
			// A segment that somehow carries no compare leg contributes NaN over
			// its own extent rather than shortening the series, which would slide
			// every later sample onto the wrong x position.
			virtualElevationCompare.push(
				...(profile.virtualElevationCompare ??
					new Array<number>(length).fill(Number.NaN)),
			);
		}
		actualElevation.push(...profile.actualElevation);
		if (referenceSeries) {
			referenceSeries.push(
				...(profile.referenceElevation?.series ??
					new Array<number>(length).fill(Number.NaN)),
			);
		}
		power.push(...profile.supplementarySeries.powerWatts);

		// Same padding rule as the compare leg above — a segment contributes its
		// own EXTENT rather than shortening the series, which would slide every
		// later sample onto the wrong x position — but padded with THE LAST
		// KNOWN DISTANCE rather than with zero, and the running total advances
		// by that same value.
		//
		// The loop walks `length` (the VE series) while `segmentKm` is whatever
		// the distance channel supplied, and the two are only assumed equal.
		// Zero is the wrong pad the moment they are not: it puts the tail back at
		// the SEGMENT'S OWN ORIGIN, a jump backwards mid-segment, and the offset
		// read off the end of the ARRAY (`segmentKm[segmentKm.length - 1]`) then
		// advanced by a distance no sample had been placed at, pushing every
		// later segment past a tail that had already fallen behind. Both halves
		// of a non-monotonic axis, right where the trim lines are drawn. Holding
		// the last finite value keeps the axis flat across the gap instead, and
		// covers a hole in the middle of the channel as well as a short one at
		// the end.
		//
		// Unchanged in the two cases that already worked: a full channel ends at
		// `segmentKm[length - 1]` exactly as before, and a channel that is absent
		// entirely still contributes a flat run at the current offset and leaves
		// the running total where it was, so the segments after it stay where
		// they belong.
		const segmentKm = profile.supplementarySeries.distancesKm;
		let lastLocal = 0;
		for (let i = 0; i < length; i += 1) {
			const local = segmentKm[i];
			if (Number.isFinite(local)) lastLocal = local;
			cumulativeDistanceKm.push(distanceOffsetKm + lastLocal);
		}
		distanceOffsetKm += lastLocal;

		apparentWindSpeedMps.push(
			...profile.supplementarySeries.apparentWindSpeedMps,
		);
		for (const index of profile.indices) {
			timestamps.push(normalized.timestamps[index]);
			velocity.push(normalized.velocity[index]);
		}

		offset += length;
	}

	return {
		length: offset,
		trimStart,
		trimEnd,
		virtualElevation,
		virtualElevationCompare,
		actualElevation,
		referenceElevation:
			referenceLabel && referenceSeries
				? { label: referenceLabel, series: referenceSeries }
				: null,
		timestamps,
		velocity,
		power,
		apparentWindSpeedMps,
		cumulativeDistanceKm,
	};
}

function clamp(value: number, min: number, max: number): number {
	if (!Number.isFinite(value)) {
		return min;
	}
	return Math.max(min, Math.min(value, max));
}
