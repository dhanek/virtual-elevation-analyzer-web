import { describe, expect, test } from "vitest";
import { DEFAULT_PARAMETERS } from "../../components/AnalysisParameters";
import { AppState } from "../../state/AppState";
import { resolveReferenceElevation } from "./elevationProfileResolver";

const BARO = [100, 101, 102, 103, 104];
const DEM = [200, 201, 202, 203, 204];
const DEM_SMOOTHED = [200.5, 201.5, 202.5, 203.5, 204.5];

function makeAppState(
	overrides: Partial<typeof DEFAULT_PARAMETERS> = {},
): AppState {
	const appState = new AppState();
	appState.currentParameters = { ...DEFAULT_PARAMETERS, ...overrides };
	appState.fitRawElevation = [...BARO];
	return appState;
}

describe("resolveReferenceElevation — both channels shown, import picks the master", () => {
	test("a DEM master gets the barometric channel back as the reference", () => {
		const appState = makeAppState();
		appState.demRawNearestElevation = DEM;

		const reference = resolveReferenceElevation(
			appState,
			"dem-raw-nearest",
			BARO.length,
		);

		expect(reference).not.toBeNull();
		expect(reference!.label).toBe("Barometer");
		// Zero lag: the identity of the cached raw channel itself, so the
		// downstream `===`-keyed mean cache treats it as unchanged.
		expect(reference!.series).toBe(appState.fitRawElevation);
	});

	test("the barometric reference is lag-corrected like the master path", () => {
		const appState = makeAppState({ baro_lag_seconds: 2 });
		appState.demRawNearestElevation = DEM;

		const reference = resolveReferenceElevation(
			appState,
			"dem-raw-nearest",
			BARO.length,
		);

		expect(reference!.series).toEqual([102, 103, 104, 104, 104]);
		// The cache stays RAW — the shift is applied on the way out.
		expect(appState.fitRawElevation).toEqual(BARO);
	});

	test("the lag-corrected reference is identity-stable across calls", () => {
		const appState = makeAppState({ baro_lag_seconds: 2 });
		appState.demInterpolatedSmoothed5ptElevation = DEM_SMOOTHED;

		const first = resolveReferenceElevation(
			appState,
			"dem-interpolated-smoothed-5pt",
			BARO.length,
		);
		const second = resolveReferenceElevation(
			appState,
			"dem-interpolated-smoothed-5pt",
			BARO.length,
		);

		expect(second!.series).toBe(first!.series);
	});

	test("a fit-raw master gets the best DEM channel, in fallback order", () => {
		const appState = makeAppState();
		appState.demRawNearestElevation = DEM;
		appState.demInterpolatedSmoothed5ptElevation = DEM_SMOOTHED;

		const reference = resolveReferenceElevation(appState, "fit-raw", BARO.length);

		expect(reference!.label).toBe("DEM");
		expect(reference!.series).toBe(DEM);
	});

	test("a fit-raw master with only the smoothed DEM present falls through", () => {
		const appState = makeAppState();
		appState.demInterpolatedSmoothed5ptElevation = DEM_SMOOTHED;

		const reference = resolveReferenceElevation(appState, "fit-raw", BARO.length);

		expect(reference!.label).toBe("DEM");
		expect(reference!.series).toBe(DEM_SMOOTHED);
	});

	test("a single-channel ride has no reference — the display is unchanged", () => {
		const appState = makeAppState();

		expect(resolveReferenceElevation(appState, "fit-raw", BARO.length)).toBeNull();
	});

	test("a counterpart of the wrong length is not a channel, it is a bug shield", () => {
		const appState = makeAppState();
		appState.demRawNearestElevation = [1, 2];

		expect(resolveReferenceElevation(appState, "fit-raw", BARO.length)).toBeNull();
	});

	test("velodrome suppresses the reference — actual is zeroed there", () => {
		const appState = makeAppState({ velodrome: true });
		appState.demRawNearestElevation = DEM;

		expect(
			resolveReferenceElevation(appState, "dem-raw-nearest", BARO.length),
		).toBeNull();
	});

	test("an all-zero FIT channel is no barometer — same rule as calculate_metrics", () => {
		const appState = makeAppState();
		appState.fitRawElevation = [0, 0, 0, 0, 0];
		appState.demRawNearestElevation = DEM;

		expect(
			resolveReferenceElevation(appState, "dem-raw-nearest", BARO.length),
		).toBeNull();
	});

	test("a DEM master whose FIT channel was never cached yields null, not DEM-as-baro", () => {
		const appState = makeAppState();
		appState.fitRawElevation = null;
		appState.demRawNearestElevation = DEM;

		expect(
			resolveReferenceElevation(appState, "dem-raw-nearest", BARO.length),
		).toBeNull();
	});
});
