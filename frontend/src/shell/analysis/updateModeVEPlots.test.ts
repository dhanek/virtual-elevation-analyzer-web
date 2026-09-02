/**
 * Type-B call-shape guards for the update primitive.
 *
 * These drive the REAL `updateModeVEPlots` and the REAL handlers through the
 * REAL registry. Only the WASM-backed calculator is mocked, because a node test
 * cannot instantiate it here — every other module in the path is genuine, so a
 * rewrite of the primitive to junk fails these tests.
 *
 * Deliberately NOT modelled on `parameterChangeHandler.test.ts`, which asserts
 * against its own mock and would stay green if the code under test were
 * replaced wholesale (07-VALIDATION.md "Guard Types (D-08)").
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const calculatorCalls: any[] = [];

vi.mock("../../analysis/VeCalculatorFactory", () => ({
	createVeCalculator: (input: any) => {
		calculatorCalls.push(input);
		const n = input.timestamps.length;
		return {
			calculate_virtual_elevation: (
				_cda: number,
				_crr: number,
				trimStart: number,
				trimEnd: number,
			) => ({
				virtual_elevation: new Float64Array(n).fill(1),
				r2: 0.5,
				rmse: 1,
				ve_elevation_diff: 2,
				actual_elevation_diff: 3,
				virtual_distance_air: 0,
				virtual_distance_ground: 0,
				vd_difference_percent: 0,
				_trim: [trimStart, trimEnd],
			}),
		};
	},
}));

import { AppState } from "../../state/AppState";
import { getAnalysisModeHandler } from "../../modes/analysis/AnalysisModes";
import type { ModeUpdateCallbacks } from "../../modes/analysis/types";
import * as WindSourceResolver from "../../analysis/WindSourceResolver";
import { updateModeVEPlots } from "./updateModeVEPlots";

const SAMPLE_COUNT = 60;

function makeFitData() {
	const timestamps = Array.from({ length: SAMPLE_COUNT }, (_, i) => i);
	return {
		timestamps,
		power: timestamps.map(() => 200),
		velocity: timestamps.map(() => 10),
		position_lat: timestamps.map((i) => 45 + i * 1e-5),
		position_long: timestamps.map((i) => -30 + i * 1e-5),
		altitude: timestamps.map(() => 100),
		distance: timestamps.map((i) => i * 10),
		air_speed: timestamps.map(() => 9),
		wind_speed: timestamps.map(() => 0),
		wind_yaw: timestamps.map(() => 0),
		air_density_data: timestamps.map(() => 0),
		road_speed: timestamps.map(() => 0),
		temperature: timestamps.map(() => 16),
		record_count: SAMPLE_COUNT,
	} as any;
}

function makeParams() {
	return {
		system_mass: 80,
		rho: 1.2,
		eta: 0.98,
		cda: 0.3,
		crr: 0.005,
		wind_speed: 0,
		wind_direction: 0,
		velodrome: false,
		air_speed_offset: 2,
	} as any;
}

function spyCallbacks() {
	const calls = {
		aggregate: 0,
		renderVe: 0,
		renderWind: 0,
		renderPower: 0,
		renderVd: 0,
		renderConvergence: 0,
		renderMetrics: 0,
	};
	const callbacks: ModeUpdateCallbacks = {
		aggregate: (profiles) => {
			calls.aggregate++;
			return {
				r2: profiles.reduce((s, p) => s + p.result.r2, 0) / profiles.length,
				rmse: 1,
				veGain: 2,
				actualGain: 3,
				segmentCount: profiles.length,
			};
		},
		renderVe: () => {
			calls.renderVe++;
		},
		renderWind: () => {
			calls.renderWind++;
		},
		renderPower: () => {
			calls.renderPower++;
		},
		renderVd: () => {
			calls.renderVd++;
		},
		renderConvergence: () => {
			calls.renderConvergence++;
		},
		renderMetrics: () => {
			calls.renderMetrics++;
		},
	};
	return { callbacks, calls };
}

/** AppState wired for each of the three modes, over the same activity. */
function stateFor(mode: "standard" | "gpsLap" | "outAndBack"): AppState {
	const appState = new AppState();
	appState.currentFitData = makeFitData();
	appState.currentParameters = makeParams();
	appState.airSpeedCalibrationPercent = 5;

	if (mode === "standard") {
		// Laps 1 and 3 selected, lap 2 skipped: a NON-CONTIGUOUS multi-lap
		// selection, which under D-19 Option B is two independently-integrated
		// segments. A contiguous pair would collapse to one run and would not
		// exercise the multi-segment path at all.
		appState.currentLaps = [
			{ start_time: 0, end_time: 19 },
			{ start_time: 20, end_time: 39 },
			{ start_time: 40, end_time: 59 },
		] as any;
		appState.selectedLaps = [1, 3];
	} else if (mode === "gpsLap") {
		appState.currentGpsLapIndexRanges = [
			{ startIdx: 0, endIdx: 29 },
			{ startIdx: 30, endIdx: 59 },
		];
		appState.currentOverlayLapNumbers = [1, 2];
	} else {
		appState.outAndBackSections = [
			{
				sectionNumber: 1,
				outboundStartIdx: 0,
				outboundEndIdx: 29,
				inboundStartIdx: 30,
				inboundEndIdx: 59,
			},
		] as any;
		appState.outAndBackSelectedSections = [1];
	}
	return appState;
}

const HANDLER_KEY = {
	standard: null,
	gpsLap: "GPS based lap splitting",
	outAndBack: "GPS based out and back",
} as const;

const MODES = ["standard", "gpsLap", "outAndBack"] as const;

beforeEach(() => {
	calculatorCalls.length = 0;
	vi.restoreAllMocks();
});

describe("updateModeVEPlots renders once per update, for every mode", () => {
	for (const mode of MODES) {
		it(`${mode}: renderVe is called exactly once`, async () => {
			const { callbacks, calls } = spyCallbacks();
			const outcome = await updateModeVEPlots({
				appState: stateFor(mode),
				handler: getAnalysisModeHandler(HANDLER_KEY[mode]),
				makeCallbacks: () => callbacks,
				windSource: "fit",
				cda: 0.3,
				crr: 0.005,
				isTabActive: () => false,
			});

			expect(outcome).not.toBeNull();
			expect(calls.renderVe).toBe(1);
			expect(calls.renderMetrics).toBe(1);
			expect(outcome!.profiles.length).toBeGreaterThan(0);
		});
	}
});

describe("the tab-active check is honoured, and lives only in the primitive (D-14)", () => {
	it("skips wind/power/vd entirely when no tab is active", async () => {
		const { callbacks, calls } = spyCallbacks();
		await updateModeVEPlots({
			appState: stateFor("gpsLap"),
			handler: getAnalysisModeHandler(HANDLER_KEY.gpsLap),
			makeCallbacks: () => callbacks,
			windSource: "fit",
			cda: 0.3,
			crr: 0.005,
			isTabActive: () => false,
		});

		expect(calls.renderWind).toBe(0);
		expect(calls.renderPower).toBe(0);
		expect(calls.renderVd).toBe(0);
		// The D-14 claim that matters most: the closure-error grid behind this
		// callback is the most expensive compute in the app, and it must not
		// run while its pane is closed.
		expect(calls.renderConvergence).toBe(0);
	});

	it("renders each of wind/power/vd exactly once when the tabs are active", async () => {
		const { callbacks, calls } = spyCallbacks();
		await updateModeVEPlots({
			appState: stateFor("gpsLap"),
			handler: getAnalysisModeHandler(HANDLER_KEY.gpsLap),
			makeCallbacks: () => callbacks,
			windSource: "fit",
			cda: 0.3,
			crr: 0.005,
			isTabActive: () => true,
		});

		expect(calls.renderWind).toBe(1);
		expect(calls.renderPower).toBe(1);
		expect(calls.renderVd).toBe(1);
		expect(calls.renderConvergence).toBe(1);
	});
});

describe("wind is resolved ONCE PER UPDATE, not once per segment (D-05)", () => {
	for (const mode of MODES) {
		it(`${mode}: resolveWindSeries is reached exactly once despite multiple segments`, async () => {
			const spy = vi.spyOn(WindSourceResolver, "resolveWindSeries");
			const { callbacks } = spyCallbacks();

			const outcome = await updateModeVEPlots({
				appState: stateFor(mode),
				handler: getAnalysisModeHandler(HANDLER_KEY[mode]),
				makeCallbacks: () => callbacks,
				windSource: "fit",
				cda: 0.3,
				crr: 0.005,
				isTabActive: () => false,
			});

			// More than one segment computed, but only one wind resolution.
			expect(outcome!.profiles.length).toBeGreaterThan(1);
			expect(spy).toHaveBeenCalledTimes(1);
		});
	}
});

/**
 * COMPARE IS A REAL SECOND SERIES, IN EVERY MODE (D-07/D-20, plan 07-04 Task 1).
 *
 * This block is the home of D-10 mutation row (b), which plan 03 recorded as
 * unfireable in `modeControls.callshape.test.ts` because that matrix mocks the
 * primitive. Here the primitive is REAL and only the WASM calculator is mocked —
 * and the mock records the wind series it was handed, which is the one input
 * that differs between the two legs. So "compare computed the same series twice"
 * is visible rather than inferred.
 */
describe("compare resolves twice and produces a second series (D-07/D-20)", () => {
	for (const mode of MODES) {
		it(`${mode}: every segment carries a compare leg of the same length`, async () => {
			const { callbacks } = spyCallbacks();
			const outcome = await updateModeVEPlots({
				appState: stateFor(mode),
				handler: getAnalysisModeHandler(HANDLER_KEY[mode]),
				makeCallbacks: () => callbacks,
				windSource: "compare",
				cda: 0.3,
				crr: 0.005,
				isTabActive: () => false,
			});

			expect(outcome).not.toBeNull();
			expect(outcome!.profiles.length).toBeGreaterThan(0);
			for (const profile of outcome!.profiles) {
				expect(profile.virtualElevationCompare).not.toBeNull();
				expect(profile.resultCompare).not.toBeNull();
				expect(profile.virtualElevationCompare!.length).toBe(
					profile.virtualElevation.length,
				);
			}
			expect(outcome!.inputs.compareWind).not.toBeNull();
			// NOT the collapsed source: the requested one, so `summarize` can write
			// what the user actually asked for.
			expect(outcome!.inputs.windSource).toBe("compare");
		});

		it(`${mode}: the two calculators differ in the WIND SERIES and nothing else`, async () => {
			const { callbacks } = spyCallbacks();
			const outcome = await updateModeVEPlots({
				appState: stateFor(mode),
				handler: getAnalysisModeHandler(HANDLER_KEY[mode]),
				makeCallbacks: () => callbacks,
				windSource: "compare",
				cda: 0.3,
				crr: 0.005,
				isTabActive: () => false,
			});

			const segments = outcome!.profiles.length;
			// Two calculators per segment, built through the one factory.
			expect(calculatorCalls).toHaveLength(segments * 2);

			for (let i = 0; i < segments; i++) {
				const primary = calculatorCalls[i * 2];
				const comparison = calculatorCalls[i * 2 + 1];

				// The constant leg is the all-NaN series; the primary is not. If the
				// primitive asked the resolver for 'compare' and let it collapse,
				// BOTH would be the fit series and this is where that shows.
				expect(
					Array.from(comparison.windSpeed as number[]).every((v) =>
						Number.isNaN(v),
					),
				).toBe(true);
				expect(
					Array.from(primary.windSpeed as number[]).some((v) => !Number.isNaN(v)),
				).toBe(true);

				// Everything else is shared, so any difference between the two legs
				// is physics rather than bookkeeping.
				expect(comparison.altitude).toEqual(primary.altitude);
				expect(comparison.rhoArray).toEqual(primary.rhoArray);
				expect(comparison.cda).toBe(primary.cda);
				expect(comparison.crr).toBe(primary.crr);
				expect(comparison.timestamps).toEqual(primary.timestamps);
			}
		});
	}

	/**
	 * D-10 mutation row (b)'s assertion. Populating `virtualElevationCompare`
	 * unconditionally makes every one of these fail.
	 */
	for (const mode of MODES) {
		for (const source of ["fit", "constant", "none"] as const) {
			it(`${mode}: leaves the compare leg null under \`${source}\``, async () => {
				const { callbacks } = spyCallbacks();
				const outcome = await updateModeVEPlots({
					appState: stateFor(mode),
					handler: getAnalysisModeHandler(HANDLER_KEY[mode]),
					makeCallbacks: () => callbacks,
					windSource: source,
					cda: 0.3,
					crr: 0.005,
					isTabActive: () => false,
				});

				expect(outcome!.inputs.compareWind).toBeNull();
				for (const profile of outcome!.profiles) {
					expect(profile.virtualElevationCompare).toBeNull();
					expect(profile.resultCompare).toBeNull();
				}
				// One calculator per segment, not two — the non-compare path pays
				// nothing for compare existing.
				expect(calculatorCalls).toHaveLength(outcome!.profiles.length);
			});
		}
	}

	it("asks the resolver for the two CONCRETE sources, never for `compare`", async () => {
		// Ruling 1: `WindSourceResolver.ts`'s `'compare' -> 'fit'` collapse is
		// deliberately untouched, because seven other callers depend on it. The
		// primitive therefore never hands it a source it would have to collapse.
		const spy = vi.spyOn(WindSourceResolver, "resolveWindSeries");
		const { callbacks } = spyCallbacks();

		await updateModeVEPlots({
			appState: stateFor("gpsLap"),
			handler: getAnalysisModeHandler(HANDLER_KEY.gpsLap),
			makeCallbacks: () => callbacks,
			windSource: "compare",
			cda: 0.3,
			crr: 0.005,
			isTabActive: () => false,
		});

		// Twice per UPDATE, not twice per segment.
		expect(spy).toHaveBeenCalledTimes(2);
		expect(spy.mock.calls.map((call) => call[0].windSource)).toEqual([
			"fit",
			"constant",
		]);
	});
});

describe("the summarize seam owns the AppState result writes (D-17a / N-1)", () => {
	for (const mode of MODES) {
		it(`${mode}: all three result fields are populated`, async () => {
			const appState = stateFor(mode);
			expect(appState.currentVEResult).toBeNull();
			expect(appState.currentFilteredData).toBeNull();

			const { callbacks } = spyCallbacks();
			await updateModeVEPlots({
				appState,
				handler: getAnalysisModeHandler(HANDLER_KEY[mode]),
				makeCallbacks: () => callbacks,
				windSource: "fit",
				cda: 0.3,
				crr: 0.005,
				isTabActive: () => false,
			});

			expect(appState.currentVEResult).not.toBeNull();
			expect(appState.currentFilteredData).not.toBeNull();
			expect(appState.currentWindSource).toBe("fit");
		});
	}
});

describe("rho reaches the calculator per segment (D-06)", () => {
	it("passes the SEGMENT SLICE of the injected full-activity rho array", async () => {
		const fullRho = Array.from({ length: SAMPLE_COUNT }, (_, i) => 1.0 + i / 1000);
		const appState = stateFor("gpsLap");
		const { callbacks } = spyCallbacks();

		await updateModeVEPlots({
			appState,
			handler: getAnalysisModeHandler(HANDLER_KEY.gpsLap),
			makeCallbacks: () => callbacks,
			windSource: "fit",
			cda: 0.3,
			crr: 0.005,
			isTabActive: () => false,
			resolveRho: () => fullRho,
		});

		expect(calculatorCalls).toHaveLength(2);
		// Segment 2 covers full-activity indices 30..59, so its rho slice must
		// start at fullRho[30] -- not at fullRho[0], which is what passing the
		// unsliced array would give.
		expect(calculatorCalls[0].rhoArray[0]).toBeCloseTo(fullRho[0], 12);
		expect(calculatorCalls[1].rhoArray[0]).toBeCloseTo(fullRho[30], 12);
		expect(calculatorCalls[1].rhoArray).toHaveLength(30);
	});

	it("passes null rho when none can be resolved, without crashing", async () => {
		const { callbacks } = spyCallbacks();
		const outcome = await updateModeVEPlots({
			appState: stateFor("gpsLap"),
			handler: getAnalysisModeHandler(HANDLER_KEY.gpsLap),
			makeCallbacks: () => callbacks,
			windSource: "fit",
			cda: 0.3,
			crr: 0.005,
			isTabActive: () => false,
			resolveRho: () => null,
		});

		expect(outcome).not.toBeNull();
		expect(calculatorCalls[0].rhoArray).toBeNull();
	});
});

describe("guards", () => {
	it("returns null when the activity or parameters are missing", async () => {
		const { callbacks, calls } = spyCallbacks();
		const appState = new AppState();

		const outcome = await updateModeVEPlots({
			appState,
			handler: getAnalysisModeHandler(null),
			makeCallbacks: () => callbacks,
			windSource: "fit",
			cda: 0.3,
			crr: 0.005,
			isTabActive: () => false,
		});

		expect(outcome).toBeNull();
		expect(calls.renderVe).toBe(0);
	});
});
