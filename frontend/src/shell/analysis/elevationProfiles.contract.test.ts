import { describe, expect, it } from "vitest";
import { AppState } from "../../state/AppState";
import {
	DEM_MOVING_AVERAGE_WINDOW,
	smoothDemMovingAverage,
} from "../../analysis/demSmoothing";
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

describe("elevation profile contract", () => {
	it("moving average profile is derived from demRawNearest only", () => {
		expect(DEM_MOVING_AVERAGE_WINDOW).toBe(9);
		const demRawNearest = [10, 10, 100, 10, 10];
		const smoothed = smoothDemMovingAverage(demRawNearest);
		expect(smoothed[2]).toBeLessThan(100);
		expect(demRawNearest[2]).toBe(100);
	});

	it("interpolated profile is computed independently of moving average profile", () => {
		const appState = new AppState();
		appState.fitRawElevation = [10, 20, 30, 40];
		appState.demRawNearestElevation = [11, 21, 31, 41];
		appState.demSmoothedMovingAverageElevation = [12, 22, 32, 42];
		appState.demInterpolatedElevation = [13, 23, 33, 43];
		appState.activeDisplayProfile = "dem-interpolated";

		const resolved = resolveElevationProfile(
			appState,
			fitData,
			fitData.altitude,
		);
		expect(resolved.profile).toBe("dem-interpolated");
		expect(resolved.altitude).toEqual([13, 23, 33, 43]);
	});

	it("resolver returns dem-raw-nearest by default when DEM profiles are available", () => {
		const appState = new AppState();
		appState.fitRawElevation = [10, 20, 30, 40];
		appState.demRawNearestElevation = [11, 21, 31, 41];
		appState.demSmoothedMovingAverageElevation = [12, 22, 32, 42];
		appState.demInterpolatedElevation = [13, 23, 33, 43];
		appState.activeDisplayProfile = "dem-raw-nearest";

		const resolved = resolveElevationProfile(
			appState,
			fitData,
			fitData.altitude,
		);
		expect(resolved.profile).toBe("dem-raw-nearest");
		expect(resolved.altitude).toEqual([11, 21, 31, 41]);
	});

	it("resolver falls back to fit-raw when selected profile length mismatches", () => {
		const appState = new AppState();
		appState.fitRawElevation = [10, 20, 30, 40];
		appState.demRawNearestElevation = [11, 21, 31];
		appState.demSmoothedMovingAverageElevation = null;
		appState.demInterpolatedElevation = null;
		appState.activeDisplayProfile = "dem-raw-nearest";

		const resolved = resolveElevationProfile(
			appState,
			fitData,
			fitData.altitude,
		);
		expect(resolved.profile).toBe("fit-raw");
		expect(resolved.altitude).toEqual([10, 20, 30, 40]);
	});
});
