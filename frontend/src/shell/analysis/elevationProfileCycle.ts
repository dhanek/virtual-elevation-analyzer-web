import type { AppState } from "../../state/AppState";
import {
	nextDemDisplayProfile,
	type ElevationDisplayProfile,
} from "../../analysis/elevationProfiles";

export function cycleDemDisplayProfile(
	appState: AppState,
): ElevationDisplayProfile {
	const next = nextDemDisplayProfile(appState.activeDisplayProfile);
	appState.activeDisplayProfile = next;
	return next;
}

export function profileCycleStateText(
	profile: ElevationDisplayProfile,
): "raw" | "smoothing" | "interpolated" {
	switch (profile) {
		case "dem-smoothed-moving-average":
			return "smoothing";
		case "dem-interpolated":
			return "interpolated";
		case "dem-raw-nearest":
		default:
			return "raw";
	}
}

export function showProfileCycleControl(appState: AppState): boolean {
	return appState.demProfilesAvailable;
}
