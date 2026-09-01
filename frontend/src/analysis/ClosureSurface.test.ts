import { describe, expect, test } from "vitest";
import {
	COARSE_GRID_STEPS,
	COARSE_GRID_WINDOW_SAMPLES,
	DEFAULT_GRID_STEPS,
	chooseGridSteps,
	gridAxis,
	poolClosureSurface,
	type SegmentGain,
} from "./ClosureSurface";

/** Flat row-major-over-CdA gains from a function of (cdaIndex, crrIndex). */
const gainsFrom = (
	cdaCount: number,
	crrCount: number,
	value: (i: number, j: number) => number,
): Float64Array => {
	const gains = new Float64Array(cdaCount * crrCount);
	for (let i = 0; i < cdaCount; i++) {
		for (let j = 0; j < crrCount; j++) {
			gains[i * crrCount + j] = value(i, j);
		}
	}
	return gains;
};

// Deliberately asymmetric: 3 CdA columns x 4 Crr rows, so a transposed `z`
// has the wrong shape AND wrong values.
const CDA_3 = [1, 2, 3];
const CRR_4 = [10, 20, 30, 40];

describe("poolClosureSurface pooling", () => {
	test("z is [crrIndex][cdaIndex] and decodes the row-major-over-CdA gains", () => {
		const surface = poolClosureSurface(
			[{ gains: gainsFrom(3, 4, (i, j) => 100 * i + j), target: 0 }],
			CDA_3,
			CRR_4,
		);
		expect(surface.z).toHaveLength(4);
		expect(surface.z[0]).toHaveLength(3);
		// cell (cdaIndex=1, crrIndex=2) holds gain 102; transposed it would be 201.
		expect(surface.z[2][1]).toBe(102);
		expect(surface.z[1][2]).toBe(201);
	});

	test("pools segments as the RSS of their target misfits", () => {
		const surface = poolClosureSurface(
			[
				{ gains: gainsFrom(3, 4, () => 5), target: 2 }, // residual 3 everywhere
				{ gains: gainsFrom(3, 4, () => 1), target: 5 }, // residual -4 everywhere
			],
			CDA_3,
			CRR_4,
		);
		expect(surface.z[0][0]).toBeCloseTo(5, 12);
		expect(surface.z[3][2]).toBeCloseTo(5, 12);
	});

	test("the ridge is the per-CdA-column argmin over Crr", () => {
		const surface = poolClosureSurface(
			[{ gains: gainsFrom(3, 4, (i, j) => 10 * (j - i) ** 2 + i), target: 0 }],
			CDA_3,
			CRR_4,
		);
		expect(surface.ridgeCda).toEqual([1, 2, 3]);
		expect(surface.ridgeCrr).toEqual([10, 20, 30]);
	});

	test("rejects a gains array that does not match the grid", () => {
		expect(() =>
			poolClosureSurface(
				[{ gains: new Float64Array(11), target: 0 }],
				CDA_3,
				CRR_4,
			),
		).toThrow(/11 gains/);
	});

	test("rejects a degenerate grid", () => {
		expect(() =>
			poolClosureSurface([], [0.3], [0.005]),
		).toThrow(/2x2/);
	});
});

// A linear gain model g_s = alpha_s*(cda - cda*) + beta_s*(crr - crr*) with
// target 0: each segment's zero set is a line through (cda*, crr*), so the
// pooled RSS vanishes exactly there and only there — when the lines differ.
const plantedGains = (
	cdaValues: number[],
	crrValues: number[],
	alpha: number,
	beta: number,
	cdaStar: number,
	crrStar: number,
): SegmentGain => ({
	gains: gainsFrom(cdaValues.length, crrValues.length, (i, j) =>
		alpha * (cdaValues[i] - cdaStar) + beta * (crrValues[j] - crrStar),
	),
	target: 0,
});

const CDA_AXIS = gridAxis(0.25, 0.35, 11); // 0.30 at index 5
const CRR_AXIS = gridAxis(0.003, 0.007, 11); // 0.005 at index 5

describe("poolClosureSurface optimum", () => {
	test("two segments with crossing ridges recover a planted optimum", () => {
		const surface = poolClosureSurface(
			[
				plantedGains(CDA_AXIS, CRR_AXIS, 40, 2000, 0.3, 0.005),
				plantedGains(CDA_AXIS, CRR_AXIS, 40, 8000, 0.3, 0.005),
			],
			CDA_AXIS,
			CRR_AXIS,
		);
		expect(surface.underdetermined).toBeNull();
		expect(surface.best).not.toBeNull();
		expect(surface.best!.cda).toBeCloseTo(0.3, 3);
		expect(surface.best!.crr).toBeCloseTo(0.005, 4);
		expect(surface.best!.error).toBeCloseTo(0, 9);
		expect(surface.clipped).toBe(false);
	});

	test("an optimum on the grid edge is flagged as clipped", () => {
		const surface = poolClosureSurface(
			[
				plantedGains(CDA_AXIS, CRR_AXIS, 40, 2000, 0.25, 0.005),
				plantedGains(CDA_AXIS, CRR_AXIS, 40, 8000, 0.25, 0.005),
			],
			CDA_AXIS,
			CRR_AXIS,
		);
		expect(surface.best).not.toBeNull();
		expect(surface.best!.cda).toBeCloseTo(0.25, 3);
		expect(surface.clipped).toBe(true);
	});
});

describe("poolClosureSurface refusals", () => {
	test("a single segment is underdetermined by construction", () => {
		const surface = poolClosureSurface(
			[plantedGains(CDA_AXIS, CRR_AXIS, 40, 2000, 0.3, 0.005)],
			CDA_AXIS,
			CRR_AXIS,
		);
		expect(surface.best).toBeNull();
		expect(surface.underdetermined).toMatch(/One run/);
		// The surface and ridge are still there for the plot to draw.
		expect(surface.z).toHaveLength(CRR_AXIS.length);
		expect(surface.ridgeCda).toHaveLength(CDA_AXIS.length);
	});

	test("no segments at all is refused with its own reason", () => {
		const surface = poolClosureSurface([], CDA_AXIS, CRR_AXIS);
		expect(surface.best).toBeNull();
		expect(surface.underdetermined).toMatch(/No segments/);
	});

	test("near-identical segments make a flat ridge, and no optimum is invented", () => {
		// Same (alpha, beta) for both: their zero lines coincide, every CdA
		// column can zero the residual, and the along-ridge spread is only
		// lattice quantisation — well under the flatness floor.
		const surface = poolClosureSurface(
			[
				plantedGains(CDA_AXIS, CRR_AXIS, 40, 1000, 0.3, 0.005),
				plantedGains(CDA_AXIS, CRR_AXIS, 40, 1000, 0.3, 0.005),
			],
			CDA_AXIS,
			CRR_AXIS,
		);
		expect(surface.best).toBeNull();
		expect(surface.underdetermined).toMatch(/ridge is flat/);
	});

	test("the flatness floor is adjustable", () => {
		const segments = [
			plantedGains(CDA_AXIS, CRR_AXIS, 40, 2000, 0.3, 0.005),
			plantedGains(CDA_AXIS, CRR_AXIS, 40, 8000, 0.3, 0.005),
		];
		const strict = poolClosureSurface(segments, CDA_AXIS, CRR_AXIS, {
			ridgeFlatnessFloorM: 1e9,
		});
		expect(strict.best).toBeNull();
		expect(strict.underdetermined).toMatch(/ridge is flat/);
	});
});

describe("grid sizing", () => {
	test("defaults to 41 and drops to 21 above the measured window budget", () => {
		expect(chooseGridSteps(6_600)).toBe(DEFAULT_GRID_STEPS);
		expect(chooseGridSteps(COARSE_GRID_WINDOW_SAMPLES)).toBe(DEFAULT_GRID_STEPS);
		expect(chooseGridSteps(COARSE_GRID_WINDOW_SAMPLES + 1)).toBe(COARSE_GRID_STEPS);
	});

	test("gridAxis is linear and endpoint-inclusive, matching ve_gain_grid", () => {
		const axis = gridAxis(0.15, 0.5, 41);
		expect(axis).toHaveLength(41);
		expect(axis[0]).toBe(0.15);
		expect(axis[40]).toBe(0.5);
		expect(axis[20]).toBeCloseTo(0.325, 12);
	});
});
