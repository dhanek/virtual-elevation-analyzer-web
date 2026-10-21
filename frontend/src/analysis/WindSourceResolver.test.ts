import { describe, expect, it } from "vitest";
import type { AnalysisParameters } from "../components/AnalysisParameters";
import {
	applyAirSpeedOffset,
	calculateAirSpeedSyncError,
	resolveWindSeries,
} from "./WindSourceResolver";

function createParams(
	overrides: Partial<AnalysisParameters> = {},
): AnalysisParameters {
	return {
		system_mass: 75,
		rho: 1.225,
		eta: 0.97,
		cda: null,
		crr: null,
		cda_min: 0.15,
		cda_max: 0.5,
		crr_min: 0.002,
		crr_max: 0.015,
		wind_speed: null,
		wind_direction: null,
		wind_speed_unit: "m/s",
		air_speed_offset: 2,
		velodrome: false,
		auto_calculate_rho: false,
		rho_source: "manual",
		...overrides,
	};
}

describe("resolveWindSeries", () => {
	it("returns a constant-source NaN series when constant wind is selected", () => {
		const result = resolveWindSeries({
			fitData: {
				timestamps: [0, 1, 2],
				air_speed: [10, 11, 12],
				wind_speed: [0, 0, 0],
				wind_yaw: [0, 0, 0],
			},
			windSource: "constant",
			params: createParams(),
		});

		expect(result.selectedWindSource).toBe("constant");
		expect(result.dataSource).toBe("constant");
		expect(result.windSpeed).toHaveLength(3);
		expect(result.windSpeed.every((value) => Number.isNaN(value))).toBe(true);
	});

	it("uses air-speed data with yaw projection and calibration", () => {
		const result = resolveWindSeries({
			fitData: {
				timestamps: [0, 1],
				air_speed: [10, 20],
				wind_speed: [0, 0],
				wind_yaw: [0, 60],
			},
			windSource: "fit",
			params: createParams({ air_speed_offset: 0 }),
			airSpeedCalibrationPercent: 10,
		});

		expect(result.selectedWindSource).toBe("fit");
		expect(result.dataSource).toBe("air_speed");
		expect(result.windSpeed[0]).toBeCloseTo(11);
		expect(result.windSpeed[1]).toBeCloseTo(11);
	});

	it("falls back to FIT wind-speed data when air-speed data is unavailable", () => {
		const result = resolveWindSeries({
			fitData: {
				timestamps: [0, 1],
				air_speed: [0, 0],
				wind_speed: [5, 6],
				wind_yaw: [0, 0],
			},
			windSource: "fit",
			params: createParams({ air_speed_offset: 0 }),
		});

		expect(result.dataSource).toBe("wind_speed");
		expect(result.windSpeed).toEqual([5, 6]);
	});
});

describe("air-speed helpers", () => {
	it("shifts the apparent-speed series by the configured offset", () => {
		const t = [0, 1, 2];
		expect(applyAirSpeedOffset([10, 20, 30], t, 1)).toEqual([
			20,
			30,
			Number.NaN,
		]);
		expect(applyAirSpeedOffset([10, 20, 30], t, -1)).toEqual([
			Number.NaN,
			10,
			20,
		]);
	});

	it("shifts by seconds on irregular recording, and not across a gap", () => {
		// Smart recording, 2–4 s apart: a 4 s offset reads the sample nearest
		// to 4 s later, not the fourth sample on. 2 → 6 s and 8 → 12 s sit
		// half way between two samples; ties go to the earlier one.
		const t = [0, 2, 4, 8, 10, 14];
		const air = [1, 2, 3, 4, 5, 6];
		expect(applyAirSpeedOffset(air, t, 4)).toEqual([3, 3, 4, 5, 6, Number.NaN]);
		// A 60 s pause: nothing from one side is read on the other.
		expect(applyAirSpeedOffset([1, 2, 3, 4], [0, 1, 61, 62], 1)).toEqual([
			2,
			Number.NaN,
			4,
			Number.NaN,
		]);
	});

	it("computes a trim-region sync error for overlapping ground and air speed", () => {
		const error = calculateAirSpeedSyncError(
			[10, 12, 14],
			[11, 13, 15],
			[0, 1, 2],
			0,
			0,
			2,
		);
		expect(error).toBeCloseTo(1);
	});

	it("recovers an air-speed lag in seconds on a ride recorded every 2–5 s", () => {
		// Ground speed v(t); the air-speed sensor reports v LAG seconds late.
		const LAG = 4;
		const speed = (t: number) => 10 + 3 * Math.sin(t / 9);
		const CYCLE = [2, 5, 3, 4, 2, 5, 3];
		const t = [0];
		while (t.length < 400) {
			t.push(t[t.length - 1] + CYCLE[t.length % CYCLE.length]);
		}
		const ground = t.map(speed);
		const air = t.map((s) => speed(s - LAG));
		const bestOffset = (times: number[]) => {
			const errorAt = (offset: number) =>
				calculateAirSpeedSyncError(ground, air, times, offset, 0, t.length - 1);
			return [0, 1, 2, 3, 4, 5, 6, 7, 8].reduce((a, b) =>
				errorAt(b) < errorAt(a) ? b : a,
			);
		};
		// Samples ~3.4 s apart resolve a lag to about a second, not finer:
		// here 3 s and 4 s read the same samples as often as each other.
		expect(Math.abs(bestOffset(t) - LAG)).toBeLessThanOrEqual(1);
		// Counted in samples, as before, the same ride read a 1 s lag.
		const asSamples = t.map((_, i) => i);
		expect(Math.abs(bestOffset(asSamples) - LAG)).toBeGreaterThanOrEqual(2);
	});
});
