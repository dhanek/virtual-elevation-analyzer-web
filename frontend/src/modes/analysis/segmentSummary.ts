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
 * The zeroed virtual-distance fields are reproduced DELIBERATELY and must not
 * be "improved" here: populating them is a listed Deferred Idea in 07-CONTEXT.md
 * and would move stored output with no D-09 change-list entry.
 */
import { getNormalizedActivityArrays } from "../../analysis/ActivityArrayCache";
import type { AppState, WindSource } from "../../state/AppState";
import type { VEAnalysisResult } from "../../utils/ResultsStorage";
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
		// Deliberately zeroed — see the file header.
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
	const power: number[] = [];
	const velocity: number[] = [];
	const timestamps: number[] = [];
	const temperature: number[] = [];

	const fitData = appState.currentFitData;
	if (!fitData) {
		return { power, velocity, timestamps, temperature };
	}

	const normalized = getNormalizedActivityArrays(fitData);
	const hasTemperature = Boolean(fitData.temperature);

	for (const profile of profiles) {
		for (const index of profile.indices) {
			power.push(normalized.power[index]);
			velocity.push(normalized.velocity[index]);
			timestamps.push(normalized.timestamps[index]);
			if (hasTemperature) {
				temperature.push(fitData.temperature![index] || 0);
			}
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
 * The whole segment-mode AppState write, in one place.
 */
export function writeSegmentModeResultState(
	appState: AppState,
	profiles: SegmentVeProfile[],
	aggregate: ModeAggregateStats,
	inputs: ResolvedUpdateInputs,
	analyzedItems: number[],
): void {
	appState.currentVEResult = buildCombinedSegmentResult(profiles, aggregate);
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
