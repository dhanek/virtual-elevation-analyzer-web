import { describe, expect, test } from "vitest";
import {
	applyCrrTempCorrection,
	crrTempFactor,
	resolveAppliedCrr,
	TIRE_SENSITIVITY_PRESETS,
} from "./CrrTemperatureCorrection";

describe("crrTempFactor", () => {
	test("is anchored at 22 °C (factor = 1 for every preset)", () => {
		expect(crrTempFactor(22, 0.5)).toBeCloseTo(1, 10);
		expect(crrTempFactor(22, 0.8)).toBeCloseTo(1, 10);
		expect(crrTempFactor(22, 1.0)).toBeCloseTo(1, 10);
	});

	// Factor table from the source spec (anchored 22 °C), values to 3 decimals.
	const specTable: Array<[number, number, number, number]> = [
		// T, s=0.5, s=0.8, s=1.0
		[0, 1.365, 1.644, 1.862],
		[5, 1.24, 1.411, 1.538],
		[10, 1.144, 1.241, 1.31],
		[15, 1.072, 1.117, 1.149],
		[20, 1.018, 1.028, 1.035],
		[25, 0.977, 0.964, 0.955],
		[30, 0.948, 0.918, 0.899],
		[35, 0.927, 0.886, 0.859],
		[40, 0.912, 0.863, 0.831],
	];

	test.each(specTable)(
		"matches the spec factor table at %d °C",
		(temp, stiff, typical, supple) => {
			expect(crrTempFactor(temp, 0.5)).toBeCloseTo(stiff, 3);
			expect(crrTempFactor(temp, 0.8)).toBeCloseTo(typical, 3);
			expect(crrTempFactor(temp, 1.0)).toBeCloseTo(supple, 3);
		},
	);
});

describe("applyCrrTempCorrection", () => {
	test("scales a 22 °C-referenced Crr by the temperature factor", () => {
		// Spec example direction: cold weather raises Crr.
		expect(applyCrrTempCorrection(0.003, 10, 1.0)).toBeCloseTo(
			0.003 * 1.31,
			5,
		);
	});
});

describe("TIRE_SENSITIVITY_PRESETS", () => {
	test("exposes the three spec presets", () => {
		expect(TIRE_SENSITIVITY_PRESETS.stiff).toBe(0.5);
		expect(TIRE_SENSITIVITY_PRESETS.typical).toBe(0.8);
		expect(TIRE_SENSITIVITY_PRESETS.supple).toBe(1.0);
	});
});

describe("resolveAppliedCrr", () => {
	test("returns crr unchanged when correction is disabled", () => {
		expect(
			resolveAppliedCrr(
				{ crr_temp_correction: false, ambient_temp_c: 10 },
				0.005,
			),
		).toBe(0.005);
	});

	test("returns crr unchanged when fields are absent (old stored params)", () => {
		expect(resolveAppliedCrr({}, 0.005)).toBe(0.005);
	});

	test("returns crr unchanged when enabled but no ambient temperature set", () => {
		expect(
			resolveAppliedCrr(
				{ crr_temp_correction: true, ambient_temp_c: null },
				0.005,
			),
		).toBe(0.005);
	});

	test("applies the typical preset by default when enabled", () => {
		expect(
			resolveAppliedCrr(
				{ crr_temp_correction: true, ambient_temp_c: 10 },
				0.005,
			),
		).toBeCloseTo(0.005 * 1.241, 5);
	});

	test("applies the selected sensitivity preset", () => {
		expect(
			resolveAppliedCrr(
				{
					crr_temp_correction: true,
					ambient_temp_c: 30,
					tire_sensitivity: "stiff",
				},
				0.005,
			),
		).toBeCloseTo(0.005 * 0.948, 5);
	});
});
