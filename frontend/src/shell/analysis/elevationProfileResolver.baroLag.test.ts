import { describe, expect, test } from "vitest";
import { DEFAULT_PARAMETERS } from "../../components/AnalysisParameters";
import type { ActivityDataLike } from "../../state/AppState";
import { AppState } from "../../state/AppState";
import {
	resolveClosureBaroAltitude,
	resolveElevationProfile,
} from "./elevationProfileResolver";

const FIT_DATA = { altitude: [] } as unknown as ActivityDataLike;

function appStateWithLag(lagSeconds: number): AppState {
	const appState = new AppState();
	appState.currentParameters = {
		...DEFAULT_PARAMETERS,
		baro_lag_seconds: lagSeconds,
	};
	return appState;
}

describe("baro lag in resolveElevationProfile", () => {
	test("shifts the fit-raw profile by the lag, reading the future sample", () => {
		const appState = appStateWithLag(2);
		const normalized = [100, 101, 102, 103, 104];

		const resolved = resolveElevationProfile(appState, FIT_DATA, normalized);

		expect(resolved.profile).toBe("fit-raw");
		expect(resolved.altitude).toEqual([102, 103, 104, 104, 104]);
	});

	test("the cached fitRawElevation stays RAW - the lag is applied on the way out", () => {
		const appState = appStateWithLag(2);
		const normalized = [100, 101, 102, 103, 104];

		resolveElevationProfile(appState, FIT_DATA, normalized);

		// A later lag edit must correct from the original channel, not from an
		// already-shifted one - so the cache never absorbs the shift.
		expect(appState.fitRawElevation).toEqual(normalized);
	});

	test("returns an identity-stable array so downstream memos keep hitting", () => {
		const appState = appStateWithLag(2);
		const normalized = [100, 101, 102, 103, 104];

		const first = resolveElevationProfile(appState, FIT_DATA, normalized);
		const second = resolveElevationProfile(appState, FIT_DATA, normalized);

		expect(second.altitude).toBe(first.altitude);
	});

	test("zero lag returns the cached channel itself, byte-for-byte phase-1", () => {
		const appState = appStateWithLag(0);
		const normalized = [100, 101, 102, 103, 104];

		const resolved = resolveElevationProfile(appState, FIT_DATA, normalized);

		expect(resolved.altitude).toBe(appState.fitRawElevation);
	});

	test("DEM profiles are position-derived and never shifted", () => {
		const appState = appStateWithLag(2);
		const dem = [200, 201, 202, 203, 204];
		appState.demRawNearestElevation = dem;
		appState.activeDisplayProfile = "dem-raw-nearest";

		const resolved = resolveElevationProfile(appState, FIT_DATA, [
			100, 101, 102, 103, 104,
		]);

		expect(resolved.profile).toBe("dem-raw-nearest");
		expect(resolved.altitude).toBe(dem);
	});
});

describe("resolveClosureBaroAltitude", () => {
	test("reads the lag-corrected barometric channel even under a DEM display", () => {
		const appState = appStateWithLag(2);
		const normalized = [100, 101, 102, 103, 104];
		appState.fitRawElevation = [...normalized];
		appState.demRawNearestElevation = [200, 201, 202, 203, 204];
		appState.activeDisplayProfile = "dem-raw-nearest";

		expect(resolveClosureBaroAltitude(appState, normalized)).toEqual([
			102, 103, 104, 104, 104,
		]);
	});

	test("zero lag hands back the raw channel untouched", () => {
		const appState = appStateWithLag(0);
		const normalized = [100, 101, 102];
		appState.fitRawElevation = normalized;

		expect(resolveClosureBaroAltitude(appState, normalized)).toBe(normalized);
	});
});
