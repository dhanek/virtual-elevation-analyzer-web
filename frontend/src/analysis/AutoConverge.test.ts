import { describe, expect, test } from "vitest";
import {
	PROFILE_NO_DISTANCE_REASON,
	PROFILE_NO_PAIR_REASON,
	pooledResidual,
	resolveAutoConvergedControls,
	solveBoth,
	solveBothProfile,
	solveCdaForCrr,
	solveCrrForCda,
	usableSegments,
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

/**
 * A segment whose trim window has nothing in it: `ve_gain` reports NaN for
 * every (CdA, Crr), the same window for which `ve_gain_grid` returns an empty
 * grid and the Convergence tab drops the segment. The solver must drop it
 * too — the pair disagreeing is what let a degenerate segment steer a solve
 * the plot knew nothing about.
 */
const DEGENERATE: AutoConvergeSegment = {
	veGain: () => Number.NaN,
	target: 0,
	weight: 1000,
};

describe("degenerate segments", () => {
	test("usableSegments drops a segment whose gain is not a number", () => {
		expect(usableSegments([...CROSSING, DEGENERATE], BOUNDS)).toEqual(CROSSING);
	});

	test("a degenerate segment does not reach the solve", () => {
		const withIt = resolveAutoConvergedControls({
			state: { enabled: true, cdaLocked: false, crrLocked: true },
			cda: CDA_STAR,
			crr: 0.02,
			segments: [...CROSSING, DEGENERATE],
			bounds: BOUNDS,
		});
		const withoutIt = resolveAutoConvergedControls({
			state: { enabled: true, cdaLocked: false, crrLocked: true },
			cda: CDA_STAR,
			crr: 0.02,
			segments: CROSSING,
			bounds: BOUNDS,
		});
		expect(withIt.status).toBe("ok");
		expect(withIt.crr).toBe(withoutIt.crr);
	});

	test("nothing measurable leaves the sliders exactly where they were", () => {
		const resolved = resolveAutoConvergedControls({
			state: { enabled: true, cdaLocked: true, crrLocked: true },
			cda: 0.271,
			crr: 0.0071,
			segments: [DEGENERATE, DEGENERATE],
			bounds: BOUNDS,
		});
		expect(resolved.status).toBe("idle");
		expect(resolved.cda).toBe(0.271);
		expect(resolved.crr).toBe(0.0071);
	});
});

/**
 * A per-sample linear VE model planted at (CDA_STAR, CRR_STAR): each step of
 * `ds` metres adds `(-ΔCdA·aero[i] - ΔCrr)·ds` of VE, so at the planted
 * point every profile is identically zero and every gain closes exactly.
 * `aero` plays the ρ·va²/(2mg) coefficient — vary it along the lap to give
 * runs different pacing.
 */
function profileSegment(
	aero: readonly number[],
	ds: number,
	group?: string,
): AutoConvergeSegment {
	const n = aero.length;
	const distance = new Float64Array(n);
	for (let i = 0; i < n; i++) {
		distance[i] = i * ds;
	}
	const increment = (cda: number, crr: number, i: number) =>
		(-(cda - CDA_STAR) * aero[i] - (crr - CRR_STAR)) * ds;
	return {
		veGain: (cda, crr) => {
			let sum = 0;
			for (let i = 1; i < n; i++) {
				sum += increment(cda, crr, i);
			}
			return sum;
		},
		target: 0,
		weight: (n - 1) * ds,
		veProfile: (cda, crr) => {
			const profile = new Float64Array(n);
			for (let i = 1; i < n; i++) {
				profile[i] = profile[i - 1] + increment(cda, crr, i);
			}
			return profile;
		},
		profileDistance: distance,
		profileGroup: group,
	};
}

/** 1 km at 10 m steps: fast-then-slow, and its mirror. Same MEAN aero, so
 * the endpoint objective cannot tell them apart — only the profiles can. */
function mirroredRuns(): AutoConvergeSegment[] {
	const n = 101;
	const fastSlow: number[] = [];
	const slowFast: number[] = [];
	for (let i = 0; i < n; i++) {
		fastSlow.push(i <= 50 ? 0.11 : 0.04);
		slowFast.push(i <= 50 ? 0.04 : 0.11);
	}
	return [profileSegment(fastSlow, 10), profileSegment(slowFast, 10)];
}

describe("solveBothProfile", () => {
	test("recovers the planted point from mirrored pacing the endpoint solve refuses", () => {
		const runs = mirroredRuns();
		// Equal mean aero ⇒ equal gains everywhere ⇒ the endpoint ridge is
		// perfectly flat and solveBoth refuses…
		expect(solveBoth(runs, BOUNDS).status).toBe("underdetermined");
		// …while the profiles diverge mid-lap away from the planted point.
		const solved = solveBothProfile(runs, BOUNDS);
		expect(solved.status).toBe("ok");
		expect(solved.cda).toBeCloseTo(CDA_STAR, 2);
		expect(solved.crr).toBeCloseTo(CRR_STAR, 4);
	});

	test("identically paced runs are flat and refused", () => {
		const aero = Array.from({ length: 101 }, () => 0.075);
		const solved = solveBothProfile(
			[profileSegment(aero, 10), profileSegment(aero, 10)],
			BOUNDS,
		);
		expect(solved.status).toBe("underdetermined");
		expect(solved.cda).toBeNaN();
	});

	test("refuses without a comparable pair", () => {
		const [a, b] = mirroredRuns();
		// One profiled run plus one endpoint-only run: no pair.
		const noProfile: AutoConvergeSegment = {
			veGain: b.veGain,
			target: 0,
			weight: b.weight,
		};
		expect(solveBothProfile([a, noProfile], BOUNDS).reason).toBe(
			PROFILE_NO_PAIR_REASON,
		);
		// Two runs in different groups (out-and-back legs) never pool.
		const [c, d] = mirroredRuns();
		c.profileGroup = "outbound";
		d.profileGroup = "inbound";
		expect(solveBothProfile([c, d], BOUNDS).reason).toBe(
			PROFILE_NO_PAIR_REASON,
		);
	});

	test("refuses when a profiled run lacks a distance axis", () => {
		const [a, b] = mirroredRuns();
		delete b.profileDistance;
		expect(solveBothProfile([a, b], BOUNDS).reason).toBe(
			PROFILE_NO_DISTANCE_REASON,
		);
	});
});

describe("resolveAutoConvergedControls profile routing", () => {
	const bothLocked = { enabled: true, cdaLocked: true, crrLocked: true };

	test("profileSolve routes the both-locked solve through the profiles", () => {
		const runs = mirroredRuns();
		const endpoint = resolveAutoConvergedControls({
			state: { ...bothLocked, profileSolve: false },
			cda: 0.2,
			crr: 0.01,
			segments: runs,
			bounds: BOUNDS,
		});
		expect(endpoint.status).toBe("underdetermined");

		const profiled = resolveAutoConvergedControls({
			state: { ...bothLocked, profileSolve: true },
			cda: 0.2,
			crr: 0.01,
			segments: runs,
			bounds: BOUNDS,
		});
		expect(profiled.status).toBe("ok");
		expect(profiled.drivenCda).toBe(true);
		expect(profiled.drivenCrr).toBe(true);
		expect(profiled.cda).toBeCloseTo(CDA_STAR, 2);
		expect(profiled.crr).toBeCloseTo(CRR_STAR, 4);
	});

	test("profileSolve leaves the single-lock ridge follows unchanged", () => {
		const resolved = resolveAutoConvergedControls({
			state: {
				enabled: true,
				cdaLocked: false,
				crrLocked: true,
				profileSolve: true,
			},
			cda: CDA_STAR,
			crr: 0.01,
			segments: CROSSING,
			bounds: BOUNDS,
		});
		expect(resolved.status).toBe("ok");
		expect(resolved.crr).toBeCloseTo(CRR_STAR, 9);
	});
});
