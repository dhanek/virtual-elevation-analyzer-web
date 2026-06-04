import { describe, expect, it } from "vitest";
import { AppState } from "../../state/AppState";
import {
	DEM_INTERPOLATED_SMOOTHING_WINDOW,
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
	it("interpolated profile smoothing uses a 5-point window", () => {
		expect(DEM_INTERPOLATED_SMOOTHING_WINDOW).toBe(5);
		const demInterpolated = [10, 10, 100, 10, 10];
		const smoothed = smoothDemMovingAverage(demInterpolated);
		expect(smoothed[2]).toBeLessThan(100);
		expect(demInterpolated[2]).toBe(100);
	});

	it("resolver returns interpolated+5pt profile when selected", () => {
		const appState = new AppState();
		appState.fitRawElevation = [10, 20, 30, 40];
		appState.demRawNearestElevation = [11, 21, 31, 41];
		appState.demInterpolatedSmoothed5ptElevation = [13, 23, 33, 43];
		appState.activeDisplayProfile = "dem-interpolated-smoothed-5pt";

		const resolved = resolveElevationProfile(
			appState,
			fitData,
			fitData.altitude,
		);
		expect(resolved.profile).toBe("dem-interpolated-smoothed-5pt");
		expect(resolved.altitude).toEqual([13, 23, 33, 43]);
	});

	it("resolver returns dem-raw-nearest when selected and available", () => {
		const appState = new AppState();
		appState.fitRawElevation = [10, 20, 30, 40];
		appState.demRawNearestElevation = [11, 21, 31, 41];
		appState.demInterpolatedSmoothed5ptElevation = [13, 23, 33, 43];
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
		appState.demInterpolatedSmoothed5ptElevation = null;
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
