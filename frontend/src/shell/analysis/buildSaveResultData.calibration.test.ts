/**
 * A stored result records the calibration and where it came from (D6): the
 * ride value or this selection's own override. Absent at a ride-value 0, like
 * the percent; a 0 override is recorded.
 */
import { describe, expect, it } from "vitest";
import type { CalibrationSource } from "../../analysis/RideCalibration";
import type { AppState } from "../../state/AppState";
import { buildSaveResultData } from "./buildSaveResultData";

function appStateWith(percent: number, source: CalibrationSource): AppState {
	return {
		currentParameters: { wind_speed: 0, wind_direction: 0 },
		currentVEResult: { r2: 0.9, rmse: 1 },
		currentFilteredData: {
			power: [200, 210],
			velocity: [10, 10],
			temperature: [20, 20],
			timestamps: [0, 1],
		},
		currentAnalyzedLaps: [1],
		currentCoveredItems: [1],
		airSpeedCalibrationPercent: percent,
		airSpeedCalibrationSource: source,
		currentWindSource: "fit",
	} as unknown as AppState;
}

const build = (appState: AppState) =>
	buildSaveResultData({
		appState,
		fileName: "ride.fit",
		notes: "",
		cda: 0.3,
		crr: 0.004,
		trimStart: 0,
		trimEnd: 1,
		now: new Date("2026-11-14T00:00:00Z"),
	});

describe("a stored result's calibration source", () => {
	it("records an override as the selection's", () => {
		const outcome = build(appStateWith(5, "selection"));
		if (!outcome.ok) throw new Error(outcome.alertMessage);
		expect(outcome.data.airSpeedCalibration).toBe(5);
		expect(outcome.data.airSpeedCalibrationSource).toBe("selection");
	});

	it("records the ride value as the ride's", () => {
		const outcome = build(appStateWith(7.7, "ride"));
		if (!outcome.ok) throw new Error(outcome.alertMessage);
		expect(outcome.data.airSpeedCalibrationSource).toBe("ride");
	});

	it("records a 0 override as the selection's", () => {
		const outcome = build(appStateWith(0, "selection"));
		if (!outcome.ok) throw new Error(outcome.alertMessage);
		expect(outcome.data.airSpeedCalibration).toBe(0);
		expect(outcome.data.airSpeedCalibrationSource).toBe("selection");
	});

	it("records neither at a ride-value 0", () => {
		const outcome = build(appStateWith(0, "ride"));
		if (!outcome.ok) throw new Error(outcome.alertMessage);
		expect(outcome.data.airSpeedCalibration).toBeUndefined();
		expect(outcome.data.airSpeedCalibrationSource).toBeUndefined();
	});
});
