import { describe, expect, it } from "vitest";
import { AppState } from "../../state/AppState";
import {
	cycleDemDisplayProfile,
	profileCycleStateText,
	showProfileCycleControl,
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
	appState.demSmoothedMovingAverageElevation = [12, 22, 32, 42];
	appState.demInterpolatedElevation = [13, 23, 33, 43];
	appState.demProfilesAvailable = true;
	appState.activeDisplayProfile = "dem-raw-nearest";
	return appState;
}

describe("elevation toggle integration", () => {
	it("cycle order is raw to smoothing to interpolated and wraps back to raw", () => {
		const appState = withDemProfiles();
		expect(profileCycleStateText(appState.activeDisplayProfile)).toBe("raw");
		expect(profileCycleStateText(cycleDemDisplayProfile(appState))).toBe(
			"smoothing",
		);
		expect(profileCycleStateText(cycleDemDisplayProfile(appState))).toBe(
			"interpolated",
		);
		expect(profileCycleStateText(cycleDemDisplayProfile(appState))).toBe("raw");
	});

	it("standard mode updates plot source when cycle advances", () => {
		const appState = withDemProfiles();
		cycleDemDisplayProfile(appState);
		const resolved = resolveElevationProfile(
			appState,
			fitData,
			fitData.altitude,
		);
		expect(resolved.profile).toBe("dem-smoothed-moving-average");
	});

	it("gps-lap mode uses dem-smoothed-moving-average when cycle state is smoothing", () => {
		const appState = withDemProfiles();
		appState.activeDisplayProfile = "dem-smoothed-moving-average";
		const resolved = resolveElevationProfile(
			appState,
			fitData,
			fitData.altitude,
		);
		expect(resolved.profile).toBe("dem-smoothed-moving-average");
	});

	it("out-and-back mode uses dem-interpolated when cycle state is interpolated", () => {
		const appState = withDemProfiles();
		appState.activeDisplayProfile = "dem-interpolated";
		const resolved = resolveElevationProfile(
			appState,
			fitData,
			fitData.altitude,
		);
		expect(resolved.profile).toBe("dem-interpolated");
	});

	it("cycle control is hidden when DEM profiles are unavailable", () => {
		const appState = new AppState();
		appState.demProfilesAvailable = false;
		expect(showProfileCycleControl(appState)).toBe(false);
	});
});
