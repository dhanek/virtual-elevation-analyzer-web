/**
 * The ground/air-speed sync error is measured at the slider's offset ONCE.
 *
 * `calculateAirSpeedSyncError` shifts the air speed by the offset it is given,
 * so the series handed to it must be the UNSHIFTED one. Standard has always
 * passed that (`prepareAnalysisPayload`, `applyOffset: false`); the two GPS
 * modes passed `resolveWindSeries`'s default, which already carries
 * `params.air_speed_offset`, so their readout was measured at twice the offset.
 *
 * The ride below has an air-speed sensor exactly LAG seconds late, so the
 * readout at offset LAG must be zero in every mode.
 */
import { describe, expect, it } from "vitest";
import type { AnalysisParameters } from "../../components/AnalysisParameters";
import { calculateAirSpeedSyncError } from "../../analysis/WindSourceResolver";
import type { ActivityDataLike, AppState } from "../../state/AppState";
import { prepareAnalysisPayload } from "./prepareAnalysisPayload";
import { getNormalizedActivityArrays } from "../../analysis/ActivityArrayCache";
import { resolveSyncErrorSeries } from "./syncErrorSeries";

const LAG = 2;
const N = 60;

function laggedRide(): ActivityDataLike {
	const timestamps = Array.from({ length: N }, (_, i) => 1000 + i);
	// A ground speed that changes every second, so a wrong shift is never free.
	const velocity = timestamps.map((_, i) => 8 + 2 * Math.sin(i / 3));
	// The sensor reports LAG seconds late: sample i holds what happened at i-LAG.
	const air_speed = velocity.map((_, i) => velocity[Math.max(0, i - LAG)]);
	return {
		timestamps,
		velocity,
		air_speed,
		power: new Array(N).fill(200),
		altitude: new Array(N).fill(0),
		distance: velocity.map((_, i) => i * 8),
		position_lat: new Array(N).fill(0),
		position_long: new Array(N).fill(0),
	} as unknown as ActivityDataLike;
}

function appStateFor(fitData: ActivityDataLike): AppState {
	return {
		currentFitData: fitData,
		currentParameters: {
			air_speed_offset: LAG,
		} as unknown as AnalysisParameters,
		airSpeedCalibrationPercent: 0,
	} as unknown as AppState;
}

function readout(series: {
	groundSpeed: number[];
	airSpeed: number[];
	timestamps: number[];
}): number {
	return calculateAirSpeedSyncError(
		series.groundSpeed,
		series.airSpeed,
		series.timestamps,
		LAG,
		5,
		N - 5,
	);
}

describe("the sync-error readout is measured at the slider's offset once", () => {
	it("standard: the analyze payload's air speed is unshifted", () => {
		const fitData = laggedRide();
		const appState = appStateFor(fitData);
		const { filteredData } = prepareAnalysisPayload({
			appState,
			fitData,
			selection: {
				indexRanges: [{ startIdx: 0, endIdx: N - 1 }],
				timeRanges: null,
			} as never,
			params: appState.currentParameters as AnalysisParameters,
			getNormalizedActivityArrays,
		});
		expect(
			readout({
				groundSpeed: filteredData.velocity,
				airSpeed: filteredData.windSpeed,
				timestamps: filteredData.timestamps,
			}),
		).toBeCloseTo(0, 9);
	});

	for (const mode of ["gpsLap", "outAndBack"] as const) {
		it(`${mode}: the series it hands the readout is unshifted`, () => {
			const appState = appStateFor(laggedRide());
			expect(readout(resolveSyncErrorSeries(appState, "fit"))).toBeCloseTo(
				0,
				9,
			);
		});
	}

	it("is empty without a ride or parameters", () => {
		expect(resolveSyncErrorSeries({} as unknown as AppState, "fit")).toEqual({
			groundSpeed: [],
			airSpeed: [],
			timestamps: [],
		});
	});
});
