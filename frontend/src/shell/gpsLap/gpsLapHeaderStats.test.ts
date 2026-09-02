/**
 * @vitest-environment jsdom
 *
 * THE GPS-LAP HEADER AND THE PLOT ARE ONE COMPUTATION (D1).
 *
 * `renderGpsLapVEPlots` used to call `calculateGpsLapStats` itself, so a slider
 * update ran that helper twice: once for the aggregate the primitive stores in
 * the result state, and again inside the renderer for the three header spans.
 * The second run was ~6 ms of a ~22 ms update and it was also a second place the
 * displayed numbers could be computed from — two implementations that happened
 * to agree.
 *
 * Two tests, because either one alone is vacuous:
 *
 *   1. THE COST claim: the renderer paints the stats it is GIVEN. Asserted with
 *      values that deliberately DISAGREE with what `calculateGpsLapStats` would
 *      return for the same laps, so a renderer that recomputes shows the other
 *      numbers and fails. A test that passed matching values could not tell the
 *      two apart — which is the whole failure mode this file exists to avoid.
 *
 *   2. THE DRIFT claim: driving the REAL primitive with the REAL GPS-lap
 *      callbacks leaves the header spans showing exactly the aggregate the
 *      primitive returned — the same object it handed `handler.summarize` for
 *      the stored result. Test 1 alone would pass against a renderer wired to a
 *      stats object nobody else ever sees.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
	calculateGpsLapStats,
	calculateMeanElevationProfile,
	renderGpsLapVEPlots,
} from "./gpsLapPlots";
import { createGpsLapUpdateCallbacks } from "./updateGpsLap";
import { updateModeVEPlots } from "../analysis/updateModeVEPlots";
import { getAnalysisModeHandlerById } from "../../modes/analysis/AnalysisModes";
import type { AnalysisParameters } from "../../components/AnalysisParameters";
import type { AppState } from "../../state/AppState";
import type { LapVEProfile } from "./types";

vi.mock("../../analysis/VeCalculatorFactory", () => ({
	createVeCalculator: (input: { timestamps: number[] }) => {
		const n = input.timestamps.length;
		return {
			calculate_virtual_elevation: () => ({
				// A ramp, not a constant: a flat VE would make r2 and rmse
				// degenerate and the header numbers indistinguishable from each
				// other, which would weaken test 2.
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

const SAMPLE_COUNT = 200;
const HALF = SAMPLE_COUNT / 2;

function headerSpans(): {
	r2: string | null;
	rmse: string | null;
	closingError: string | null;
} {
	return {
		r2: document.getElementById("gpsLapR2Value")?.textContent ?? null,
		rmse: document.getElementById("gpsLapRmseValue")?.textContent ?? null,
		closingError:
			document.getElementById("gpsLapClosingErrorValue")?.textContent ?? null,
	};
}

function renderHost(): void {
	document.body.innerHTML = `
        <div id="gpsLapVePlot"></div>
        <div id="gpsLapResidualPlot"></div>
        <span id="gpsLapR2Value"></span>
        <span id="gpsLapRmseValue"></span>
        <span id="gpsLapClosingErrorValue"></span>
        <div id="gpsLapSummaryTable"></div>
    `;
	(window as unknown as { Plotly: unknown }).Plotly = {
		react: vi.fn(),
		newPlot: vi.fn(),
	};
}

describe("the GPS-lap header numbers come from the caller's one computation", () => {
	beforeEach(() => {
		renderHost();
	});

	it("paints the stats it is given, not a second computation of its own", () => {
		const laps: LapVEProfile[] = [
			{
				lapNumber: 1,
				distances: [0, 0.5, 1],
				virtualElevation: [0, 3, 9],
				actualElevation: [0, 1, 2],
				supplementarySeries: null,
				duration: 60,
				totalDistance: 1,
			} as unknown as LapVEProfile,
			{
				lapNumber: 2,
				distances: [0, 0.5, 1],
				virtualElevation: [0, -4, -7],
				actualElevation: [0, 2, 1],
				supplementarySeries: null,
				duration: 60,
				totalDistance: 1,
			} as unknown as LapVEProfile,
		];
		const meanElevation = calculateMeanElevationProfile(laps);

		// What a renderer that recomputed would show. Asserted to be DIFFERENT
		// from the sentinels below, so the test cannot silently pass by them
		// coinciding.
		const own = calculateGpsLapStats(laps, meanElevation);
		const given = { meanR2: 0.1234, meanRMSE: 77.77, closingError: 55.55 };
		expect(own.meanR2.toFixed(4)).not.toBe(given.meanR2.toFixed(4));
		expect(own.meanRMSE.toFixed(2)).not.toBe(given.meanRMSE.toFixed(2));
		expect(own.closingError.toFixed(2)).not.toBe(given.closingError.toFixed(2));

		renderGpsLapVEPlots(laps, meanElevation, given);

		expect(headerSpans()).toEqual({
			r2: "0.1234",
			rmse: "77.77m",
			closingError: "55.55m",
		});
	});

	it("shows the aggregate the primitive stored, through the real chain", async () => {
		const timestamps = Array.from({ length: SAMPLE_COUNT }, (_, i) => i);
		const zeros = () => new Array<number>(SAMPLE_COUNT).fill(0);
		const appState = {
			currentFitData: {
				timestamps,
				power: zeros().map(() => 200),
				velocity: zeros().map(() => 10),
				position_lat: zeros(),
				position_long: zeros(),
				altitude: timestamps.map((t) => Math.sin(t / 20) * 3),
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

		const outcome = await updateModeVEPlots({
			appState,
			handler: getAnalysisModeHandlerById("gpsLap"),
			makeCallbacks: () => createGpsLapUpdateCallbacks(appState),
			windSource: "fit",
			cda: 0.25,
			crr: 0.004,
			resolveRho: () => null,
			isTabActive: () => false,
		});

		expect(outcome).not.toBeNull();
		const aggregate = outcome!.aggregate;

		// Not "some number is there" — the exact aggregate, formatted the way the
		// spans format it. If the renderer ever computes its own stats again and
		// they differ by so much as the fourth decimal, this fails.
		expect(headerSpans()).toEqual({
			r2: aggregate.r2.toFixed(4),
			rmse: `${aggregate.rmse.toFixed(2)}m`,
			closingError: `${aggregate.extra!.closingError.toFixed(2)}m`,
		});

		// And the aggregate is not a degenerate all-zero object that any
		// implementation would reproduce.
		expect(aggregate.extra!.closingError).not.toBe(0);
	});
});
