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

	it("standard mode updates plot source when toggle turns ON", () => {
		const appState = withDemProfiles();
		toggleDemDisplayProfile(appState);
		const resolved = resolveElevationProfile(
			appState,
			fitData,
			fitData.altitude,
		);
		expect(resolved.profile).toBe("dem-interpolated-smoothed-5pt");
	});

	it("gps-lap mode uses interpolated+5pt profile when toggle is ON", () => {
		const appState = withDemProfiles();
		appState.activeDisplayProfile = "dem-interpolated-smoothed-5pt";
		const resolved = resolveElevationProfile(
			appState,
			fitData,
			fitData.altitude,
		);
		expect(resolved.profile).toBe("dem-interpolated-smoothed-5pt");
	});

	it("out-and-back mode uses raw profile when toggle is OFF", () => {
		const appState = withDemProfiles();
		appState.activeDisplayProfile = "dem-raw-nearest";
		const resolved = resolveElevationProfile(
			appState,
			fitData,
			fitData.altitude,
		);
		expect(resolved.profile).toBe("dem-raw-nearest");
	});

	it("switch control is hidden when DEM profiles are unavailable", () => {
		const appState = new AppState();
		appState.demProfilesAvailable = false;
		expect(showProfileSwitchControl(appState)).toBe(false);
	});
});
