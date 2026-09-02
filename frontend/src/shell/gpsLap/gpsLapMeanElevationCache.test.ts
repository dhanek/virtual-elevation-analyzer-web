/**
 * @vitest-environment jsdom
 *
 * THE CROSS-UPDATE MEAN-ELEVATION CACHE (D2), AND ITS INVALIDATION.
 *
 * `calculateMeanElevationProfile` reads only `distances` and `actualElevation`,
 * neither of which depends on CdA or Crr, so a drag recomputed the same answer
 * every frame (~3.7 ms of a ~22 ms update). The cache is module-level, because
 * `createGpsLapUpdateCallbacks` is rebuilt on every event and a closure memo dies
 * with it.
 *
 * A module-level cache is only as good as its key, and the failure it can
 * produce is the worst one this phase has shipped: D-06's elevation-smoothing
 * toggle that burned a recompute and returned identical numbers — a control that
 * lies. So the invalidation tests here are the point of the file, not the hit
 * test. Each was watched failing against a key with the relevant term removed.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AnalysisParameters } from "../../components/AnalysisParameters";
import type { AppState } from "../../state/AppState";

const spies = vi.hoisted(() => ({
	mean: vi.fn(),
	/** The meanElevation actually handed to the renderer, per update. */
	rendered: [] as Array<{ distances: number[]; elevation: number[] }>,
}));

vi.mock("./gpsLapPlots", async (importOriginal) => {
	const actual = await importOriginal<Record<string, unknown>>();
	const realMean = actual.calculateMeanElevationProfile as (
		laps: unknown,
	) => { distances: number[]; elevation: number[] };
	return {
		...actual,
		calculateMeanElevationProfile: (laps: unknown) => {
			spies.mean();
			return realMean(laps);
		},
		renderGpsLapVEPlots: (
			_laps: unknown,
			mean: { distances: number[]; elevation: number[] },
		) => {
			spies.rendered.push(mean);
		},
		renderGpsLapWindPlot: () => {},
		renderGpsLapPowerPlot: () => {},
		renderGpsLapVdPlot: () => {},
	};
});

vi.mock("../../analysis/VeCalculatorFactory", () => ({
	createVeCalculator: (input: { timestamps: number[] }) => {
		const n = input.timestamps.length;
		return {
			calculate_virtual_elevation: () => ({
				virtual_elevation: Float64Array.from({ length: n }, (_, i) => i * 0.01),
				r2: 0.5,
				rmse: 1,
				ve_elevation_diff: 2,
				actual_elevation_diff: 3,
				virtual_distance_air: 0,
				virtual_distance_ground: 0,
				vd_difference_percent: 0,
			}),
		};
	},
}));

import {
	createGpsLapUpdateCallbacks,
	resetGpsLapMeanElevationCache,
} from "./updateGpsLap";
import { updateModeVEPlots } from "../analysis/updateModeVEPlots";
import { getAnalysisModeHandlerById } from "../../modes/analysis/AnalysisModes";

const SAMPLE_COUNT = 200;
const HALF = SAMPLE_COUNT / 2;

/** A visibly different elevation profile, as a DEM selection would supply. */
const FIT_ALTITUDE = Array.from({ length: SAMPLE_COUNT }, (_, i) =>
	Math.sin(i / 20) * 3,
);
const DEM_ALTITUDE = Array.from({ length: SAMPLE_COUNT }, (_, i) =>
	Math.sin(i / 20) * 3 + 25,
);

function makeAppState(): AppState {
	const timestamps = Array.from({ length: SAMPLE_COUNT }, (_, i) => i);
	const zeros = () => new Array<number>(SAMPLE_COUNT).fill(0);
	return {
		currentFitData: {
			timestamps,
			power: zeros().map(() => 200),
			velocity: zeros().map(() => 10),
			position_lat: zeros(),
			position_long: zeros(),
			altitude: FIT_ALTITUDE,
			distance: timestamps.map((t) => t * 10),
			air_speed: zeros().map(() => 10),
			wind_speed: zeros(),
			wind_yaw: zeros(),
			air_density_data: zeros(),
			road_speed: zeros(),
			temperature: zeros().map(() => 20),
			cda_reference: null,
		},
		currentParameters: {
			cda: 0.25,
			crr: 0.004,
			air_speed_offset: 0,
			wind_speed: 3,
			wind_direction: 90,
			wind_height_factor: 1,
			velodrome: false,
			auto_calculate_rho: false,
		} as unknown as AnalysisParameters,
		currentGpsLapIndexRanges: [
			{ startIdx: 0, endIdx: HALF - 1 },
			{ startIdx: HALF, endIdx: SAMPLE_COUNT - 1 },
		],
		gpsDetectedLaps: [],
		gpsSelectedLaps: [],
		airSpeedCalibrationPercent: 0,
		activeDisplayProfile: "fit-raw",
	} as unknown as AppState;
}

async function update(appState: AppState, cda: number): Promise<void> {
	const outcome = await updateModeVEPlots({
		appState,
		handler: getAnalysisModeHandlerById("gpsLap"),
		makeCallbacks: () => createGpsLapUpdateCallbacks(appState),
		windSource: "fit",
		cda,
		crr: 0.004,
		resolveRho: () => null,
		isTabActive: () => false,
	});
	expect(outcome).not.toBeNull();
}

describe("the GPS-lap mean-elevation cache", () => {
	beforeEach(() => {
		resetGpsLapMeanElevationCache();
		spies.mean.mockClear();
		spies.rendered.length = 0;
		document.body.innerHTML = `
            <span id="gpsLapR2Value"></span>
            <span id="gpsLapRmseValue"></span>
            <span id="gpsLapClosingErrorValue"></span>
        `;
	});

	it("computes once across a drag that only moves CdA", async () => {
		const appState = makeAppState();

		await update(appState, 0.22);
		await update(appState, 0.26);
		await update(appState, 0.31);

		// Pre-D2 this was 3. The three updates are real and distinct — the
		// calculator saw three different CdA values — but the mean elevation
		// cannot have moved, so it is computed once.
		expect(spies.mean).toHaveBeenCalledTimes(1);
		expect(spies.rendered).toHaveLength(3);
		// Same object, not merely equal values: the later updates reused it.
		expect(spies.rendered[1]).toBe(spies.rendered[0]);
		expect(spies.rendered[2]).toBe(spies.rendered[0]);
	});

	it("recomputes, and returns DIFFERENT elevations, when the displayed profile changes", async () => {
		const appState = makeAppState();

		await update(appState, 0.25);
		expect(spies.mean).toHaveBeenCalledTimes(1);

		// What the elevation-smoothing / DEM toggle does: select another
		// resolved profile. This is D-06's defect site.
		(appState as unknown as { demRawNearestElevation: number[] }).
			demRawNearestElevation = DEM_ALTITUDE;
		appState.activeDisplayProfile = "dem-raw-nearest";

		await update(appState, 0.25);

		expect(spies.mean).toHaveBeenCalledTimes(2);
		// The recompute must also CHANGE something. Counting calls alone would
		// pass against a cache that recomputed and returned the old array —
		// which is precisely the shape of the bug this guards.
		const before = spies.rendered[0];
		const after = spies.rendered[1];
		expect(after).not.toBe(before);
		expect(after.elevation[0]).not.toBeCloseTo(before.elevation[0], 6);
		expect(after.elevation[0] - before.elevation[0]).toBeCloseTo(25, 3);
	});

	it("recomputes when the lap selection changes", async () => {
		const appState = makeAppState();

		await update(appState, 0.25);
		expect(spies.mean).toHaveBeenCalledTimes(1);

		appState.currentGpsLapIndexRanges = [{ startIdx: 0, endIdx: HALF - 1 }];
		await update(appState, 0.25);

		expect(spies.mean).toHaveBeenCalledTimes(2);
		expect(spies.rendered[1]).not.toBe(spies.rendered[0]);
	});

	it("recomputes when velodrome mode flattens the actual elevation", async () => {
		const appState = makeAppState();

		await update(appState, 0.25);
		expect(spies.mean).toHaveBeenCalledTimes(1);

		appState.currentParameters!.velodrome = true;
		await update(appState, 0.25);

		expect(spies.mean).toHaveBeenCalledTimes(2);
		// Velodrome zeroes the actual elevation, so the mean profile must go flat.
		const after = spies.rendered[1];
		expect(after.elevation.every((v) => v === 0)).toBe(true);
	});
});
