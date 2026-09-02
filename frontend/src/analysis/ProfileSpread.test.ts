import { describe, expect, test } from "vitest";
import {
	anchoredSpreadEvaluator,
	commonDistanceGrid,
	resampleProfile,
	spreadRmse,
	type ProfileBasisSegment,
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

describe("anchoredSpreadEvaluator", () => {
	const GRID = Float64Array.from([0, 25, 50, 75, 100]);
	const CDA0 = 0.3;
	const CRR0 = 0.005;

	/** Brute-force reference: rebuild the profiles at (cda, crr), tilt the
	 * group mean onto its target, and pool the RMS deviation directly. */
	function reference(
		segments: readonly ProfileBasisSegment[],
		cda: number,
		crr: number,
	): number {
		const dc = cda - CDA0;
		const dr = crr - CRR0;
		const last = GRID.length - 1;
		const groups = new Map<string, ProfileBasisSegment[]>();
		for (const segment of segments) {
			groups.set(segment.group, [
				...(groups.get(segment.group) ?? []),
				segment,
			]);
		}
		let sumOfSquares = 0;
		let count = 0;
		for (const group of groups.values()) {
			const profiles = group.map((segment) =>
				GRID.map(
					(_, i) =>
						segment.p0[i] + dc * segment.jc[i] + dr * segment.jr[i],
				),
			);
			const meanTarget =
				group.reduce((sum, segment) => sum + segment.target, 0) /
				group.length;
			const mean = GRID.map(
				(_, i) =>
					profiles.reduce((sum, profile) => sum + profile[i], 0) /
					group.length,
			);
			const tilt = meanTarget - (mean[last] - mean[0]);
			for (const profile of profiles) {
				for (let i = 0; i < GRID.length; i++) {
					const deviation =
						profile[i] - mean[i] - tilt * (GRID[i] / GRID[last]);
					sumOfSquares += deviation * deviation;
					count++;
				}
			}
		}
		return Math.sqrt(sumOfSquares / count);
	}

	function segment(
		p0: number[],
		jc: number[],
		jr: number[],
		target = 0,
		group = "",
	): ProfileBasisSegment {
		return {
			p0: Float64Array.from(p0),
			jc: Float64Array.from(jc),
			jr: Float64Array.from(jr),
			target,
			group,
		};
	}

	test("matches the brute-force anchored spread at arbitrary points", () => {
		const segments = [
			segment([0, 1, 3, 2, 4], [0, -2, -5, -9, -12], [0, -25, -50, -75, -100], 3.5),
			segment([0, 2, 1, 3, 5], [0, -4, -7, -8, -11], [0, -25, -50, -75, -100], 4.1),
			segment([0, -1, 0, 1, 2], [0, -1, -3, -6, -9], [0, -25, -50, -75, -100], -2, "other"),
		];
		const evaluate = anchoredSpreadEvaluator(segments, GRID, CDA0, CRR0);
		for (const [cda, crr] of [
			[CDA0, CRR0],
			[0.2, 0.01],
			[0.45, 0.002],
			[0.31, 0.0052],
		]) {
			expect(evaluate(cda, crr)).toBeCloseTo(reference(segments, cda, crr), 10);
		}
	});

	test("perfect agreement on target closes to zero exactly at the probe", () => {
		// Two identical profiles whose gain equals the target: no spread, no
		// tilt — the surface bottoms out at 0.
		const p0 = [0, 1, 2, 3, 4];
		const segments = [
			segment(p0, [0, -1, -2, -3, -4], [0, -25, -50, -75, -100], 4),
			segment(p0, [0, -1, -2, -3, -4], [0, -25, -50, -75, -100], 4),
		];
		const evaluate = anchoredSpreadEvaluator(segments, GRID, CDA0, CRR0);
		expect(evaluate(CDA0, CRR0)).toBeCloseTo(0, 12);
		// And away from the probe the tilt penalty appears (identical jc/jr
		// keeps the spread at zero; only closure moves).
		expect(evaluate(CDA0, CRR0 + 0.001)).toBeGreaterThan(0);
	});

	test("a single run still contributes its closure tilt", () => {
		// p0 flat at 0 with target T: deviation is the pure tilt ramp,
		// RMSE = |T|·sqrt(mean(ramp²)).
		const T = 2;
		const segments = [
			segment([0, 0, 0, 0, 0], [0, 0, 0, 0, 0], [0, 0, 0, 0, 0], T),
		];
		const evaluate = anchoredSpreadEvaluator(segments, GRID, CDA0, CRR0);
		const ramp = [0, 0.25, 0.5, 0.75, 1];
		const expected =
			T * Math.sqrt(ramp.reduce((sum, r) => sum + r * r, 0) / ramp.length);
		expect(evaluate(CDA0, CRR0)).toBeCloseTo(expected, 12);
	});

	test("no segments evaluates to NaN", () => {
		const evaluate = anchoredSpreadEvaluator([], GRID, CDA0, CRR0);
		expect(evaluate(CDA0, CRR0)).toBeNaN();
	});
});
