/**
 * Shared `summarize` machinery for the two segment modes.
 *
 * GPS-lap and out-and-back synthesise the SAME combined-result shape: one
 * concatenated `virtual_elevation`, aggregate r2/rmse/gains, and the three
 * virtual-distance fields ZEROED. GPS-lap has done this since
 * `updateGpsLap.ts:205-247`; out-and-back wrote none of it, which is N-1 /
 * D-17a and the reason Store Result and Export CSV persisted analyze-time
 * numbers rather than what was on screen.
 *
 * Factoring it here means the two modes cannot drift apart again.
 *
 * The three scalar virtual-distance fields on the combined shape stay ZEROED,
 * and that is now a narrower statement than it used to be. There is still no
 * single virtual distance for a multi-segment analysis — the concatenated
 * integral spans the gaps between segments and is not a distance anyone rode —
 * so no number is invented here. What changed under change-list entry (h) is
 * that the per-segment figures are no longer discarded: `summarize` writes them
 * to `appState.currentVirtualDistances`, one per segment, and Store Result and
 * Export CSV persist THOSE. See `segmentVirtualDistance.ts`.
 */
import { getNormalizedActivityArrays } from "../../analysis/ActivityArrayCache";
import type { SegmentVirtualDistance } from "../../analysis/VirtualDistance";
import type { AppState, WindSource } from "../../state/AppState";
import type { VEAnalysisResult } from "../../utils/ResultsStorage";
import { stackedVirtualDistances } from "./segmentVirtualDistance";
import type {
	ModeAggregateStats,
	ResolvedUpdateInputs,
	SegmentVeProfile,
} from "./types";

export function buildCombinedSegmentResult(
	profiles: SegmentVeProfile[],
	aggregate: ModeAggregateStats,
): VEAnalysisResult {
	const combinedVE: number[] = [];
	for (const profile of profiles) {
		combinedVE.push(...profile.virtualElevation);
	}

	return {
		r2: aggregate.r2,
		rmse: aggregate.rmse,
		ve_elevation_diff: aggregate.veGain,
		actual_elevation_diff: aggregate.actualGain,
		virtual_elevation: new Float64Array(combinedVE),
		// Deliberately zeroed — see the file header. The real per-segment
		// figures live on `appState.currentVirtualDistances`; nothing reads
		// these three scalars, and filling them with a total would be the
		// invented single number entry (h) exists to refuse.
		virtual_distance_air: 0,
		virtual_distance_ground: 0,
		vd_difference_percent: 0,
	};
}

/**
 * Rebuild `currentFilteredData` from the full-activity indices the profiles
 * actually consumed. Reproduces `updateGpsLap.ts:222-247`, including the
 * behaviour that `temperature` stays EMPTY when the activity carries none.
 */
export function buildFilteredDataFromProfiles(
	appState: AppState,
	profiles: SegmentVeProfile[],
): {
	power: number[];
	velocity: number[];
	timestamps: number[];
	temperature: number[];
} {
	// THE TRIM WINDOW IS APPLIED HERE, and it has to be.
	//
	// `mapTrimToSegments` does NOT narrow `segment.range` — it spreads the range
	// unchanged and adds a `trim` field (`standardSegments.ts:132`) — and
	// `updateModeVEPlots.ts:218-224` builds `profile.indices` from `range`
	// alone, because the calculator wants the FULL slice plus separate trim
	// boundaries (`:257-258`). So `profile.indices` is the UNTRIMMED range, and
	// walking it directly yields the whole selection.
	//
	// That mattered the moment `handleStoreResult` stopped slicing with the
	// trim-slider values: the averages then covered samples the rider had
	// explicitly trimmed off — their acceleration and roll-out — and persisted
	// them to IndexedDB and the CSV export. Applying the window at this one
	// concatenation is what makes `currentFilteredData` mean "the samples on
	// screen" for every mode, which is the space Store Result now reads.
	//
	// `trim.start` / `trim.end` are LOCAL offsets into the segment
	// (`standardSegments.ts:124-125`), so they index `profile.indices` directly.
	return buildFilteredDataFromIndexGroups(
		appState,
		profiles.map((profile) => {
			const trim = profile.segment.trim;
			if (!trim) {
				return profile.indices;
			}
			const start = Math.max(0, trim.start);
			const end = Math.min(trim.end, profile.indices.length - 1);
			return profile.indices.slice(start, end + 1);
		}),
	);
}

/**
 * THE ONE PLACE the analysed sample arrays are concatenated, for both the
 * analyze path and the update path (CR-01).
 *
 * `currentFilteredData` used to have three writers in different index spaces —
 * that divergence was CR-02 — and only ONE of them ran at analyze time, and
 * only for Standard. The two segment modes computed their profiles locally and
 * painted them directly, so this array was first written when the user touched
 * a control. Analyze then Store Result, with nothing in between, either refused
 * or averaged the previous analysis's samples.
 *
 * Taking index GROUPS rather than profiles is what lets both callers share the
 * implementation: the analyze path already holds `{startIdx, endIdx}` ranges for
 * its laps or legs, and the update path holds profiles. Neither has to fabricate
 * the other's shape, and there is no second concatenation to drift from this
 * one.
 */
export function buildFilteredDataFromIndexGroups(
	appState: AppState,
	indexGroups: number[][],
): {
	power: number[];
	velocity: number[];
	timestamps: number[];
	temperature: number[];
} {
	const profiles = indexGroups.map((indices) => ({ indices }));
	const power: number[] = [];
	const velocity: number[] = [];
	const timestamps: number[] = [];
	const temperature: number[] = [];

	const fitData = appState.currentFitData;
	if (!fitData) {
		return { power, velocity, timestamps, temperature };
	}

	const normalized = getNormalizedActivityArrays(fitData);
	// `Boolean([])` is TRUE, so an activity carrying an EMPTY temperature array
	// used to take the branch below and push a fabricated 0 for every sample —
	// which Store Result then reported as `avgTemperature: 0`, indistinguishable
	// from a genuine 0 °C ride. Presence is a non-empty array, not truthiness.
	const source = fitData.temperature;
	const hasTemperature = Array.isArray(source) && source.length > 0;

	for (const profile of profiles) {
		for (const index of profile.indices) {
			power.push(normalized.power[index]);
			velocity.push(normalized.velocity[index]);
			timestamps.push(normalized.timestamps[index]);
			// NaN for a missing/garbage sample, not `|| 0`. `|| 0` collapsed NaN
			// and a legitimate 0 °C onto the same value, so the averager could
			// only discard both or neither. NaN is the one marker that says "no
			// reading" without also claiming a temperature.
			//
			// PUSHED UNCONDITIONALLY, including when the activity has no
			// temperature channel at all. `FilteredAnalysisData` declares four
			// `number[]` with an implied common length (`AppState.ts:121-126`)
			// and consumers index them in parallel; leaving this one empty
			// against three full-length siblings broke that, and an empty array
			// reaching `calculateAverage` came back as 0 — persisted as
			// `avgTemperature: 0`, indistinguishable from a genuine 0 °C ride.
			const value = hasTemperature ? source[index] : Number.NaN;
			temperature.push(Number.isFinite(value) ? value : Number.NaN);
		}
	}

	return { power, velocity, timestamps, temperature };
}

/**
 * Resolve what `currentWindSource` should record. 'compare' is preserved as
 * requested rather than collapsed, matching `updateGpsLap.ts:215-219`.
 */
export function resolveRecordedWindSource(
	requested: WindSource,
	resolved: "constant" | "fit" | "none",
): WindSource {
	return requested === "compare" ? "compare" : resolved;
}

/**
 * Establish `currentFilteredData` at ANALYZE time for a segment mode, from the
 * index ranges the render already resolved (CR-01).
 *
 * The invariant this exists to make true: once a segment mode's panel is on
 * screen, the analysed samples behind it are in AppState — so Store Result
 * describes what the user is looking at whether or not they have touched a
 * control yet.
 *
 * It goes through `buildFilteredDataFromIndexGroups`, the same concatenation
 * `summarize` uses, rather than assembling the arrays here. That is the point:
 * a second assembly would be a fourth writer of this field, and writers of this
 * field disagreeing with each other is exactly what CR-02 was.
 *
 * Ranges are clamped to the activity length because a range is an inclusive
 * `{startIdx, endIdx}` pair resolved from GPS geometry, and a trailing lap can
 * name an index one past the last sample.
 */
export function seedSegmentModeFilteredData(
	appState: AppState,
	ranges: Array<{ startIdx: number; endIdx: number }>,
): void {
	const fitData = appState.currentFitData;
	if (!fitData) {
		return;
	}

	const sampleCount = getNormalizedActivityArrays(fitData).timestamps.length;
	const indexGroups = ranges.map((range) => {
		const indices: number[] = [];
		const end = Math.min(range.endIdx, sampleCount - 1);
		for (let i = Math.max(range.startIdx, 0); i <= end; i++) {
			indices.push(i);
		}
		return indices;
	});

	appState.currentFilteredData = buildFilteredDataFromIndexGroups(
		appState,
		indexGroups,
	);
}

/**
 * The whole segment-mode AppState write, in one place.
 *
 * `virtualDistances` defaults to one entry per profile, read off the same
 * cumulative series the mode's stacked VD plot draws. Out-and-back overrides it
 * because its profiles are LEGS, two per section, and the maintainer ruled that
 * both the header and the export carry one section total rather than 2N lines.
 */
export function writeSegmentModeResultState(
	appState: AppState,
	profiles: SegmentVeProfile[],
	aggregate: ModeAggregateStats,
	inputs: ResolvedUpdateInputs,
	analyzedItems: number[],
	virtualDistances: SegmentVirtualDistance[] = stackedVirtualDistances(
		profiles.map((profile) => ({
			label: profile.segment.label,
			metrics: profile.supplementarySeries,
		})),
	),
): void {
	appState.currentVEResult = buildCombinedSegmentResult(profiles, aggregate);
	appState.currentVirtualDistances = virtualDistances;
	appState.currentFilteredData = buildFilteredDataFromProfiles(
		appState,
		profiles,
	);
	appState.currentWindSource = resolveRecordedWindSource(
		inputs.windSource,
		inputs.wind.selectedWindSource,
	);
	appState.currentAnalyzedLaps = analyzedItems;
}
