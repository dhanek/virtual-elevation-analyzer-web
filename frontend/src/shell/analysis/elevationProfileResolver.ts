import type { ActivityDataLike, AppState } from "../../state/AppState";
import {
	DEM_PROFILE_FALLBACK_ORDER,
	type ElevationDisplayProfile,
} from "../../analysis/elevationProfiles";

export interface ResolvedElevationProfile {
	profile: ElevationDisplayProfile;
	altitude: number[];
}

function hasValidProfile(
	profile: number[] | null,
	expectedLength: number,
): boolean {
	return !!profile && profile.length === expectedLength;
}

export function resolveElevationProfile(
	appState: AppState,
	fitData: ActivityDataLike,
	normalizedAltitude: number[],
): ResolvedElevationProfile {
	const expectedLength = normalizedAltitude.length;

	const fitRaw = appState.fitRawElevation;
	if (hasValidProfile(fitRaw, expectedLength)) {
		// keep valid cached fit raw
	} else {
		appState.fitRawElevation = [...normalizedAltitude];
	}

	const current = appState.activeDisplayProfile;
	if (current === "fit-raw") {
		return {
			profile: "fit-raw",
			altitude: appState.fitRawElevation ?? [...normalizedAltitude],
		};
	}

	const byProfile: Record<ElevationDisplayProfile, number[] | null> = {
		"fit-raw": appState.fitRawElevation,
		"dem-raw-nearest": appState.demRawNearestElevation,
		"dem-interpolated-smoothed-5pt":
			appState.demInterpolatedSmoothed5ptElevation,
	};

	if (hasValidProfile(byProfile[current], expectedLength)) {
		return { profile: current, altitude: byProfile[current]! };
	}

	// fallback order: dem-raw-nearest -> dem-interpolated-smoothed-5pt
	for (const profile of DEM_PROFILE_FALLBACK_ORDER) {
		const candidate = byProfile[profile];
		if (hasValidProfile(candidate, expectedLength)) {
			return { profile, altitude: candidate! };
		}
	}

	return {
		profile: "fit-raw",
		altitude: appState.fitRawElevation ?? Array.from(fitData.altitude),
	};
}
