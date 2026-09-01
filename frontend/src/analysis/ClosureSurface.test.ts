import { describe, expect, test } from "vitest";
import {
	COARSE_GRID_STEPS,
	COARSE_GRID_WINDOW_SAMPLES,
	DEFAULT_GRID_STEPS,
	DEFAULT_CLOSURE_BAND_TOLERANCE_M,
	chooseGridSteps,
	closureBand,
	gridAxis,
	poolClosureSurface,
	type ClosureSurfaceResult,
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
	test("defaults to 100 and drops to 41 above the measured window budget", () => {
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

// A paraboloid z = a*(cda - cda*)^2 + b*(crr - crr*)^2 has the level set
// z = t as an axis-aligned ellipse with semi-axes sqrt(t/a) and sqrt(t/b), so
// the band's extents have a closed form to check against.
const paraboloid = (
	cdaValues: number[],
	crrValues: number[],
	a: number,
	b: number,
	cdaStar: number,
	crrStar: number,
	floor = 0,
): ClosureSurfaceResult => {
	const z = crrValues.map((crr) =>
		cdaValues.map(
			(cda) => floor + a * (cda - cdaStar) ** 2 + b * (crr - crrStar) ** 2,
		),
	);
	return {
		z,
		ridgeCda: [...cdaValues],
		ridgeCrr: cdaValues.map(() => crrStar),
		best: { cda: cdaStar, crr: crrStar, error: floor },
		clipped: false,
		underdetermined: null,
	};
};

describe("closureBand", () => {
	// Fine grids so the linear crossing interpolation is close to exact.
	const CDA = gridAxis(0.2, 0.4, 201); // cell 0.001
	const CRR = gridAxis(0.003, 0.007, 201); // cell 0.00002

	test("cuts the level set at best.error + tolerance and reports its extents", () => {
		// Semi-axes: sqrt(0.05/500) = 0.01 in CdA, sqrt(0.05/50000) = 0.001 in Crr.
		const surface = paraboloid(CDA, CRR, 500, 50_000, 0.3, 0.005);
		const band = closureBand(surface, CDA, CRR, 0.05);
		expect(band).not.toBeNull();
		expect(band!.toleranceM).toBe(0.05);
		expect(band!.threshold).toBeCloseTo(0.05, 12);
		expect(band!.cdaLow).toBeCloseTo(0.29, 4);
		expect(band!.cdaHigh).toBeCloseTo(0.31, 4);
		expect(band!.crrLow).toBeCloseTo(0.004, 5);
		expect(band!.crrHigh).toBeCloseTo(0.006, 5);
		expect(band!.touchesEdge).toBe(false);
	});

	test("is relative to the minimum: a raised floor moves the threshold, not the band", () => {
		const raised = paraboloid(CDA, CRR, 500, 50_000, 0.3, 0.005, 0.8);
		const band = closureBand(raised, CDA, CRR, 0.05)!;
		expect(band.threshold).toBeCloseTo(0.85, 12);
		expect(band.cdaLow).toBeCloseTo(0.29, 4);
		expect(band.cdaHigh).toBeCloseTo(0.31, 4);
	});

	test("interpolates the crossing between cells rather than snapping to the lattice", () => {
		// Coarse grid: cell 0.01 in CdA, the semi-axis is 0.0075 — not a
		// lattice multiple. Nearest lattice would give 0.30 ± 0.01 or 0.
		const coarseCda = gridAxis(0.2, 0.4, 21);
		const coarseCrr = gridAxis(0.003, 0.007, 21);
		const surface = paraboloid(coarseCda, coarseCrr, 500, 50_000, 0.3, 0.005);
		const band = closureBand(surface, coarseCda, coarseCrr, 500 * 0.0075 ** 2)!;
		// Linear interpolation of a parabola across a whole cell overshoots by
		// about a fifth of a cell (0.002 here); snapping to the last in-band
		// lattice point would be 0.0075 off. Within a quarter cell is the claim.
		expect(Math.abs(band.cdaLow - (0.3 - 0.0075))).toBeLessThan(0.0025);
		expect(Math.abs(band.cdaHigh - (0.3 + 0.0075))).toBeLessThan(0.0025);
	});

	test("flags a band that runs into the grid edge and clamps to the bound", () => {
		// CdA semi-axis 0.05 from a centre 0.02 inside the low edge.
		const surface = paraboloid(CDA, CRR, 20, 50_000, 0.22, 0.005);
		const band = closureBand(surface, CDA, CRR, 0.05)!;
		expect(band.touchesEdge).toBe(true);
		expect(band.cdaLow).toBe(0.2);
		expect(band.cdaHigh).toBeCloseTo(0.27, 4);
	});

	test("always contains the refined optimum", () => {
		const surface = paraboloid(CDA, CRR, 500, 50_000, 0.3, 0.005);
		// A refined optimum a fraction of a cell off the lattice minimum.
		surface.best = { cda: 0.3004, crr: 0.005, error: 0 };
		const band = closureBand(surface, CDA, CRR, 1e-9)!;
		expect(band.cdaLow).toBeLessThanOrEqual(0.3004);
		expect(band.cdaHigh).toBeGreaterThanOrEqual(0.3004);
	});

	test("is null when the surface has no optimum", () => {
		const surface = poolClosureSurface(
			[plantedGains(CDA_AXIS, CRR_AXIS, 40, 2000, 0.3, 0.005)],
			CDA_AXIS,
			CRR_AXIS,
		);
		expect(surface.best).toBeNull();
		expect(closureBand(surface, CDA_AXIS, CRR_AXIS)).toBeNull();
	});

	test("defaults to the 5 cm tolerance and rejects a non-positive one", () => {
		const surface = paraboloid(CDA, CRR, 500, 50_000, 0.3, 0.005);
		expect(DEFAULT_CLOSURE_BAND_TOLERANCE_M).toBe(0.05);
		expect(closureBand(surface, CDA, CRR)!.toleranceM).toBe(0.05);
		expect(() => closureBand(surface, CDA, CRR, 0)).toThrow(/positive/);
	});

	test("on a pooled surface the band brackets the planted optimum", () => {
		const surface = poolClosureSurface(
			[
				plantedGains(CDA_AXIS, CRR_AXIS, 40, 2000, 0.3, 0.005),
				plantedGains(CDA_AXIS, CRR_AXIS, 40, 8000, 0.3, 0.005),
			],
			CDA_AXIS,
			CRR_AXIS,
		);
		const band = closureBand(surface, CDA_AXIS, CRR_AXIS, 0.05)!;
		expect(band.cdaLow).toBeLessThan(0.3);
		expect(band.cdaHigh).toBeGreaterThan(0.3);
		expect(band.crrLow).toBeLessThan(0.005);
		expect(band.crrHigh).toBeGreaterThan(0.005);
	});
});
