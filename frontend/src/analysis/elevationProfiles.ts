export type ElevationDisplayProfile =
	| "fit-raw"
	| "dem-raw-nearest"
	| "dem-interpolated-smoothed-5pt";

export interface ElevationProfilesState {
	fitRawElevation: number[] | null;
	demRawNearestElevation: number[] | null;
	demInterpolatedSmoothed5ptElevation: number[] | null;
	activeDisplayProfile: ElevationDisplayProfile;
	demProfilesAvailable: boolean;
}

/**
 * The NON-master elevation channel, displayed alongside the resolved profile.
 *
 * Both channels are shown by default; the import (and the smoothing toggle)
 * only decide which one is the MASTER — the channel `actualElevation`, the
 * r²/RMSE metrics and the closure targets are measured against. The reference
 * is display-only: it never feeds metrics, closure targets or the physics.
 */
export interface ReferenceElevationSeries {
	label: "Barometer" | "DEM";
	series: number[];
}

/**
 * A mean profile of the non-master channel over a common distance grid — the
 * GPS modes' equivalent of `ReferenceElevationSeries`, shared so the two mean
 * builders cannot grow different shapes for the same idea.
 */
export interface MeanReferenceProfile {
	label: "Barometer" | "DEM";
	distances: number[];
	elevation: number[];
}

export const DEM_PROFILE_FALLBACK_ORDER: ElevationDisplayProfile[] = [
	"dem-raw-nearest",
	"dem-interpolated-smoothed-5pt",
];

export function nextDemDisplayProfile(
	current: ElevationDisplayProfile,
): ElevationDisplayProfile {
	switch (current) {
		case "dem-interpolated-smoothed-5pt":
			return "dem-raw-nearest";
		case "dem-raw-nearest":
		default:
			return "dem-interpolated-smoothed-5pt";
	}
}
