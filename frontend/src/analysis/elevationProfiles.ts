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
