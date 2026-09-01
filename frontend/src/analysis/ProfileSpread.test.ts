import { describe, expect, test } from "vitest";
import {
	commonDistanceGrid,
	resampleProfile,
	spreadRmse,
} from "./ProfileSpread";

describe("commonDistanceGrid", () => {
	test("spans 0 to the shortest segment, inclusive", () => {
		const grid = commonDistanceGrid(
			[Float64Array.from([0, 500, 1000]), Float64Array.from([0, 400, 800])],
			5,
		);
		expect(grid).not.toBeNull();
		expect([...grid!]).toEqual([0, 200, 400, 600, 800]);
	});

	test("refuses empty, non-finite and non-positive spans", () => {
		expect(commonDistanceGrid([], 5)).toBeNull();
		expect(commonDistanceGrid([Float64Array.from([0])], 5)).toBeNull();
		expect(commonDistanceGrid([Float64Array.from([0, NaN])], 5)).toBeNull();
		expect(commonDistanceGrid([Float64Array.from([0, 0])], 5)).toBeNull();
		expect(
			commonDistanceGrid(
				[Float64Array.from([0, 100]), Float64Array.from([0, -5])],
				5,
			),
		).toBeNull();
	});
});

describe("resampleProfile", () => {
	test("linear interpolation lands between samples", () => {
		const distance = Float64Array.from([0, 10, 20]);
		const ve = Float64Array.from([0, 1, 3]);
		const out = resampleProfile(distance, ve, Float64Array.from([0, 5, 15, 20]));
		expect([...out]).toEqual([0, 0.5, 2, 3]);
	});

	test("a stalled distance pair steps instead of dividing by zero", () => {
		const distance = Float64Array.from([0, 10, 10, 20]);
		const ve = Float64Array.from([0, 1, 2, 3]);
		const out = resampleProfile(distance, ve, Float64Array.from([10, 15]));
		expect(out[0]).toBe(2);
		expect(out[1]).toBe(2.5);
	});

	test("clamps past the profile end", () => {
		const distance = Float64Array.from([0, 10]);
		const ve = Float64Array.from([0, 4]);
		const out = resampleProfile(distance, ve, Float64Array.from([12]));
		expect(out[0]).toBe(4);
	});
});

describe("spreadRmse", () => {
	test("identical profiles spread 0; a constant offset spreads by half of it", () => {
		const a = Float64Array.from([0, 1, 2]);
		expect(spreadRmse([[a, Float64Array.from(a)]])).toBe(0);
		const b = Float64Array.from([1, 2, 3]);
		// deviations are ±0.5 everywhere → RMS 0.5
		expect(spreadRmse([[a, b]])).toBeCloseTo(0.5, 12);
	});

	test("single-member groups contribute nothing; none comparable is NaN", () => {
		const a = Float64Array.from([0, 1]);
		expect(spreadRmse([[a]])).toBeNaN();
		expect(spreadRmse([])).toBeNaN();
		const b = Float64Array.from([2, 3]);
		// the lone group is ignored, the pair decides the value
		expect(spreadRmse([[a], [a, b]])).toBeCloseTo(Math.sqrt(1), 12);
	});

	test("a non-finite value in a compared profile poisons to NaN", () => {
		const a = Float64Array.from([0, NaN]);
		const b = Float64Array.from([0, 1]);
		expect(spreadRmse([[a, b]])).toBeNaN();
	});
});
