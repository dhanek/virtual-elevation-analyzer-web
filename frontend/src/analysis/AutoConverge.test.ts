import { describe, expect, test } from "vitest";
import {
	pooledResidual,
	resolveAutoConvergedControls,
	solveBoth,
	solveCdaForCrr,
	solveCrrForCda,
	type AutoConvergeSegment,
} from "./AutoConverge";

const BOUNDS = { cdaMin: 0.15, cdaMax: 0.5, crrMin: 0.0015, crrMax: 0.03 };
const CDA_STAR = 0.3;
const CRR_STAR = 0.005;

/**
 * A linear gain model planted at (CDA_STAR, CRR_STAR): the residual is
 * -a·ΔCdA - b·ΔCrr, zero along a line through the planted point whose slope
 * is a/b. Two segments with different a/b have crossing lines — the
 * identifiable case; proportional (a, b) pairs have coincident lines — the
 * degenerate one.
 */
function linearSegment(a: number, b: number, weight = 1000): AutoConvergeSegment {
	return {
		veGain: (cda, crr) => -a * (cda - CDA_STAR) - b * (crr - CRR_STAR),
		target: 0,
		weight,
	};
}

const CROSSING = [linearSegment(76, 1000), linearSegment(150, 1000)];
const PROPORTIONAL = [linearSegment(76, 1000), linearSegment(152, 2000)];

describe("pooledResidual", () => {
	test("is strictly decreasing in Crr and in CdA", () => {
		let previous = Number.POSITIVE_INFINITY;
		for (let k = 0; k < 10; k++) {
			const value = pooledResidual(CROSSING, 0.3, 0.002 + k * 0.002);
			expect(value).toBeLessThan(previous);
			previous = value;
		}
		previous = Number.POSITIVE_INFINITY;
		for (let k = 0; k < 10; k++) {
			const value = pooledResidual(CROSSING, 0.16 + k * 0.03, 0.005);
			expect(value).toBeLessThan(previous);
			previous = value;
		}
	});
});

describe("single-axis solves", () => {
	test("solveCrrForCda recovers the planted Crr at the planted CdA", () => {
		const solved = solveCrrForCda(CROSSING, CDA_STAR, BOUNDS.crrMin, BOUNDS.crrMax);
		expect(solved.status).toBe("ok");
		expect(solved.value).toBeCloseTo(CRR_STAR, 9);
	});

	test("solveCdaForCrr recovers the planted CdA at the planted Crr", () => {
		const solved = solveCdaForCrr(CROSSING, CRR_STAR, BOUNDS.cdaMin, BOUNDS.cdaMax);
		expect(solved.status).toBe("ok");
		expect(solved.value).toBeCloseTo(CDA_STAR, 9);
	});

	test("away from the planted point the solve lands on the pooled zero line", () => {
		const solved = solveCrrForCda(CROSSING, 0.32, BOUNDS.crrMin, BOUNDS.crrMax);
		expect(solved.status).toBe("ok");
		// The residual is weight-scaled (w ~ 1000 m), so ~1e-6 here is a gain
		// error of ~1e-9 m — bisection precision, not solver error.
		expect(pooledResidual(CROSSING, 0.32, solved.value)).toBeCloseTo(0, 5);
	});

	test("an unbracketed root clamps to the nearer bound and says so", () => {
		// The zero line at CdA = 0.3 sits at Crr = 0.005 — outside [0.01, 0.03].
		const low = solveCrrForCda(CROSSING, CDA_STAR, 0.01, 0.03);
		expect(low.status).toBe("clamped-low");
		expect(low.value).toBe(0.01);

		// And outside [0.0005, 0.003] on the other side.
		const high = solveCrrForCda(CROSSING, CDA_STAR, 0.0005, 0.003);
		expect(high.status).toBe("clamped-high");
		expect(high.value).toBe(0.003);
	});
});

describe("solveBoth", () => {
	test("a single segment is refused as underdetermined by construction", () => {
		const solved = solveBoth([CROSSING[0]], BOUNDS);
		expect(solved.status).toBe("underdetermined");
		expect(solved.reason).toMatch(/One run/);
	});

	test("proportional segments make a flat ridge, and no optimum is invented", () => {
		const solved = solveBoth(PROPORTIONAL, BOUNDS);
		expect(solved.status).toBe("underdetermined");
		expect(solved.reason).toMatch(/ridge is flat/);
	});

	test("segments with crossing ridges recover the planted optimum", () => {
		const solved = solveBoth(CROSSING, BOUNDS);
		expect(solved.status).toBe("ok");
		// CdA to within a ridge-lattice cell (the along-ridge error is
		// V-shaped, so the parabolic vertex only tightens, never exact).
		expect(Math.abs(solved.cda - CDA_STAR)).toBeLessThan(0.01);
		// Crr is re-solved on the ridge at the returned CdA, so its error is
		// the CdA error scaled by the ridge slope — much tighter.
		expect(Math.abs(solved.crr - CRR_STAR)).toBeLessThan(5e-4);
	});
});

describe("resolveAutoConvergedControls — the lock table", () => {
	const base = {
		cda: 0.27,
		crr: 0.006,
		segments: CROSSING,
		bounds: BOUNDS,
	};

	test("disabled, or enabled with nothing locked, passes through untouched", () => {
		for (const state of [
			{ enabled: false, cdaLocked: true, crrLocked: true },
			{ enabled: true, cdaLocked: false, crrLocked: false },
		]) {
			const resolved = resolveAutoConvergedControls({ ...base, state });
			expect(resolved).toEqual({
				cda: 0.27,
				crr: 0.006,
				drivenCda: false,
				drivenCrr: false,
				status: "idle",
				reason: null,
			});
		}
	});

	test("CdA locked: the user's Crr is honoured and CdA follows the ridge", () => {
		const resolved = resolveAutoConvergedControls({
			...base,
			state: { enabled: true, cdaLocked: true, crrLocked: false },
		});
		expect(resolved.status).toBe("ok");
		expect(resolved.crr).toBe(0.006);
		expect(resolved.drivenCda).toBe(true);
		expect(resolved.drivenCrr).toBe(false);
		expect(pooledResidual(CROSSING, resolved.cda, 0.006)).toBeCloseTo(0, 5);
	});

	test("Crr locked: the user's CdA is honoured and Crr follows the ridge", () => {
		const resolved = resolveAutoConvergedControls({
			...base,
			state: { enabled: true, cdaLocked: false, crrLocked: true },
		});
		expect(resolved.status).toBe("ok");
		expect(resolved.cda).toBe(0.27);
		expect(resolved.drivenCrr).toBe(true);
		expect(pooledResidual(CROSSING, 0.27, resolved.crr)).toBeCloseTo(0, 5);
	});

	test("both locked on a good selection sits at the optimum", () => {
		const resolved = resolveAutoConvergedControls({
			...base,
			state: { enabled: true, cdaLocked: true, crrLocked: true },
		});
		expect(resolved.status).toBe("ok");
		expect(resolved.drivenCda).toBe(true);
		expect(resolved.drivenCrr).toBe(true);
		expect(Math.abs(resolved.cda - CDA_STAR)).toBeLessThan(0.01);
		expect(Math.abs(resolved.crr - CRR_STAR)).toBeLessThan(5e-4);
	});

	test("both locked on one segment refuses and leaves the sliders alone", () => {
		const resolved = resolveAutoConvergedControls({
			...base,
			segments: [CROSSING[0]],
			state: { enabled: true, cdaLocked: true, crrLocked: true },
		});
		expect(resolved.status).toBe("underdetermined");
		expect(resolved.cda).toBe(0.27);
		expect(resolved.crr).toBe(0.006);
		expect(resolved.drivenCda).toBe(false);
		expect(resolved.drivenCrr).toBe(false);
		expect(resolved.reason).toMatch(/One run/);
	});

	test("a clamped single-axis solve reports it", () => {
		const resolved = resolveAutoConvergedControls({
			...base,
			bounds: { ...BOUNDS, crrMin: 0.02 },
			state: { enabled: true, cdaLocked: false, crrLocked: true },
		});
		expect(resolved.status).toBe("clamped");
		expect(resolved.crr).toBe(0.02);
	});

	test("no segments means nothing to solve — idle passthrough", () => {
		const resolved = resolveAutoConvergedControls({
			...base,
			segments: [],
			state: { enabled: true, cdaLocked: true, crrLocked: false },
		});
		expect(resolved.status).toBe("idle");
	});
});
