/**
 * GPS-lap's profile mapping and aggregate, extracted verbatim from
 * `createGpsLapUpdateCallbacks` (Convergence plan, C4).
 *
 * The aggregate is CONSEQUENTIAL, not cosmetic: `gpsLapMode.summarize` writes
 * it into `appState.currentVEResult`, so it is what Store Result and Export
 * CSV persist. The headless API computes the same numbers by calling these
 * same two functions — the sharing is the point, and it is what stops the API
 * quietly disagreeing with the screen in this mode (its stats run
 * `calculateGpsLapStats` over a mean-elevation profile, nothing like the
 * plain per-segment means a naive headless caller would write).
 *
 * The shell factory keeps its memoisation and the cross-update mean-elevation
 * cache; this module is the computation those layers wrap.
 */
import type { NormalizedActivityArrays } from "../../analysis/ActivityArrayCache";
import { gpsLapNumberForProfile } from "../../modes/analysis/gpsLapMode";
import type {
	ModeAggregateStats,
	SegmentVeProfile,
} from "../../modes/analysis/types";
import type { AppState } from "../../state/AppState";
import { calculateGpsLapStats } from "./gpsLapPlots";
import type { LapVEProfile } from "./types";

/**
 * The primitive's flat segments as `LapVEProfile`s — the shape the GPS-lap
 * stat helpers and plots consume.
 */
export function toGpsLapProfiles(
	appState: AppState,
	normalized: NormalizedActivityArrays,
	profiles: SegmentVeProfile[],
): LapVEProfile[] {
	return profiles.map((profile, i) => {
		const first = profile.indices[0];
		const last = profile.indices[profile.indices.length - 1];
		return {
			// NOT COMPUTED ON THIS PATH (WR-04). `range` exists for the
			// analyze-time seed of `currentFilteredData`
			// (`renderGpsLap.ts:327`) and has no reader here — the update
			// path's own seed comes from `summarize`, off the profiles
			// themselves.
			range: null,
			// The handler labels from the same lookup; relabelling here
			// keeps the summary table and the stored result agreeing.
			//
			// `i` is the PROFILE ordinal, and the profile list is thinned
			// (short segments, throwing calculators, trimmed-out
			// segments), so indexing `currentOverlayLapNumbers` by it
			// labelled every lap after the first drop with the previous
			// lap's number. The number resolved against the RANGE ordinal
			// rides on the segment instead.
			lapNumber: gpsLapNumberForProfile(appState, profile, i),
			distances: profile.distancesKm,
			virtualElevation: profile.virtualElevation,
			// Carried straight through from the primitive: non-null iff
			// the requested source is `compare` (D-07/D-20).
			virtualElevationCompare: profile.virtualElevationCompare,
			actualElevation: profile.actualElevation,
			referenceElevation: profile.referenceElevation,
			supplementarySeries: profile.supplementarySeries,
			duration:
				profile.indices.length > 0
					? normalized.timestamps[last] - normalized.timestamps[first]
					: 0,
			totalDistance: profile.distancesKm[profile.distancesKm.length - 1] ?? 0,
		};
	});
}

export function computeGpsLapAggregate(
	lapProfiles: LapVEProfile[],
	meanElevation: { distances: number[]; elevation: number[] },
): ModeAggregateStats {
	const stats = calculateGpsLapStats(lapProfiles, meanElevation);
	return {
		r2: stats.meanR2,
		rmse: stats.meanRMSE,
		veGain: stats.avgVeGain,
		actualGain: stats.avgActualGain,
		segmentCount: lapProfiles.length,
		extra: { closingError: stats.closingError },
		// GPS-lap's own second set of numbers, computed by the SAME helper
		// over the constant leg. The primitive never learns this shape
		// (D-02): it hands over profiles and takes back an aggregate.
		compare: stats.compare
			? {
					r2: stats.compare.meanR2,
					rmse: stats.compare.meanRMSE,
					veGain: stats.compare.avgVeGain,
					actualGain: stats.compare.avgActualGain,
					extra: { closingError: stats.compare.closingError },
				}
			: undefined,
	};
}
