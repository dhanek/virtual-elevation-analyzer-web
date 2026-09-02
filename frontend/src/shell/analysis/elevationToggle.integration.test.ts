/**
 * UNIT tests for the elevation toggle and the profile RESOLVER. Nothing here
 * drives a mode, and nothing here should claim to.
 *
 * This file used to carry three cases named "standard mode", "gps-lap mode" and
 * "out-and-back mode". All three called `resolveElevationProfile` directly with
 * the same fixture and imported no mode module whatsoever, so the three names
 * described one assertion repeated — and the suite stayed green while BOTH GPS
 * analyze legs read the raw FIT channel instead of the resolved profile (WR-1).
 * A test that names a mode it never loads is worse than no test: it answers the
 * coverage question wrongly.
 *
 * The mode-level guards now live where the modes actually are:
 *   - Standard          -> prepareAnalysisPayload.test.ts,
 *                          "slices the ACTIVE elevation profile"
 *   - GPS-lap           -> gpsModeRealChain.test.ts,
 *   - out-and-back         "the analyze leg honours the active elevation profile"
 *
 * Each of those asserts the series that reached the physics, through the real
 * entry point. Add mode coverage there, not here.
 */
import { describe, expect, it } from "vitest";
import { AppState } from "../../state/AppState";
import {
	profileSwitchStateText,
	showProfileSwitchControl,
	toggleDemDisplayProfile,
} from "./elevationProfileCycle";
import { resolveElevationProfile } from "./elevationProfileResolver";

const fitData = {
	timestamps: [0, 1, 2, 3],
	power: [100, 100, 100, 100],
	velocity: [10, 10, 10, 10],
	position_lat: [1, 1, 1, 1],
	position_long: [1, 1, 1, 1],
	altitude: [10, 20, 30, 40],
	distance: [0, 1, 2, 3],
	air_speed: [0, 0, 0, 0],
	wind_speed: [0, 0, 0, 0],
	wind_yaw: [0, 0, 0, 0],
	air_density_data: [0, 0, 0, 0],
	road_speed: [0, 0, 0, 0],
	temperature: [20, 20, 20, 20],
	battery_soc: [0, 0, 0, 0],
	heart_rate: [0, 0, 0, 0],
	cadence: [0, 0, 0, 0],
	record_count: 4,
} as any;

function withDemProfiles() {
	const appState = new AppState();
	appState.fitRawElevation = [10, 20, 30, 40];
	appState.demRawNearestElevation = [11, 21, 31, 41];
	appState.demInterpolatedSmoothed5ptElevation = [13, 23, 33, 43];
	appState.demProfilesAvailable = true;
	appState.activeDisplayProfile = "dem-raw-nearest";
	return appState;
}

describe("elevation toggle integration", () => {
	it("toggle order switches between raw and interpolated+5pt", () => {
		const appState = withDemProfiles();
		expect(profileSwitchStateText(appState.activeDisplayProfile)).toBe("OFF");
		expect(profileSwitchStateText(toggleDemDisplayProfile(appState))).toBe(
			"ON",
		);
		expect(profileSwitchStateText(toggleDemDisplayProfile(appState))).toBe(
			"OFF",
		);
	});

	it("toggling ON selects the interpolated+5pt profile", () => {
		const appState = withDemProfiles();
		toggleDemDisplayProfile(appState);

		const resolved = resolveElevationProfile(
			appState,
			fitData,
			fitData.altitude,
		);

		expect(resolved.profile).toBe("dem-interpolated-smoothed-5pt");
		expect(resolved.altitude).toEqual([13, 23, 33, 43]);
	});

	it.each([
		["dem-raw-nearest", [11, 21, 31, 41]],
		["dem-interpolated-smoothed-5pt", [13, 23, 33, 43]],
		["fit-raw", [10, 20, 30, 40]],
	] as const)("resolves %s to its own series", (profile, expected) => {
		// The ARRAY matters, not just the label: a resolver that named the right
		// profile while handing back another one's samples would satisfy a
		// label-only assertion and still feed the physics the wrong elevation.
		const appState = withDemProfiles();
		appState.activeDisplayProfile = profile;

		const resolved = resolveElevationProfile(
			appState,
			fitData,
			fitData.altitude,
		);

		expect(resolved.profile).toBe(profile);
		expect(resolved.altitude).toEqual(expected);
	});

	it("switch control is hidden when DEM profiles are unavailable", () => {
		const appState = new AppState();
		appState.demProfilesAvailable = false;
		expect(showProfileSwitchControl(appState)).toBe(false);
	});
});
