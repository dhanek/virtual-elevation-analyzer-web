export type ElevationDisplayProfile =
	| "fit-raw"
	| "dem-raw-nearest"
	| "dem-smoothed-moving-average"
	| "dem-interpolated";

export interface ElevationProfilesState {
	fitRawElevation: number[] | null;
	demRawNearestElevation: number[] | null;
	demSmoothedMovingAverageElevation: number[] | null;
	demInterpolatedElevation: number[] | null;
	activeDisplayProfile: ElevationDisplayProfile;
	demProfilesAvailable: boolean;
}

export const DEM_PROFILE_FALLBACK_ORDER: ElevationDisplayProfile[] = [
	"dem-raw-nearest",
	"dem-smoothed-moving-average",
	"dem-interpolated",
];

export function nextDemDisplayProfile(
	current: ElevationDisplayProfile,
): ElevationDisplayProfile {
	switch (current) {
		case "dem-raw-nearest":
			return "dem-smoothed-moving-average";
		case "dem-smoothed-moving-average":
			return "dem-interpolated";
		case "dem-interpolated":
			return "dem-raw-nearest";
		default:
			return "dem-raw-nearest";
	}
}
