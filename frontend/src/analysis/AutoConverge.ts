/**
 * The auto-converge solver: drives a LOCKED CdA/Crr slider along the ridge of
 * the closure-error surface, and both onto its optimum when both are locked.
 *
 * Pure and node-testable: segments arrive as closures over the WASM
 * calculators (`veGain(cda, crr)` in SLIDER space — the caller folds the
 * temperature-correction scaling in), plus a closure target and a distance
 * weight.
 *
 * THE OBJECTIVE, and why it is the signed weighted sum. The natural fit
 * objective is the RSS of per-segment closure misfits, but bisection needs a
 * monotone function with a sign change, and d(RSS)/dCrr is not guaranteed
 * monotone. The Chung slope loses `crr` uniformly at every sample, so
 * `dgain_s/dcrr ≈ −(segment distance)` — which makes the distance-weighted
 * signed sum
 *
 *     pooledResidual = Σ_s  w_s · (gain_s − target_s),   w_s = distance_s
 *
 * exactly the first-order stationarity condition of the RSS in the Crr
 * direction, AND strictly decreasing in both Crr and CdA (raising either
 * lowers every sample's slope). One function, both properties.
 *
 * WHY `solveBoth` CAN REFUSE. Closure error alone does not identify a unique
 * (CdA, Crr): the two trade off along the ridge, and the pooled error has a
 * real minimum only when the segments' individual ridges cross at an angle —
 * runs at different speeds or winds. With one segment it is provably
 * underdetermined (any CdA has a Crr zeroing the residual); with
 * near-identical laps the along-ridge error is flat and an argmin is noise.
 * Refusing (`status: 'underdetermined'`) and leaving the sliders alone is the
 * feature that stops this tool from confidently fabricating a CdA.
 */

import {
	judgeRidge,
	RIDGE_FLATNESS_FLOOR_M,
	type RidgeColumn,
} from "./ClosureRidge";
import {
	commonDistanceGrid,
	PROFILE_FLAT_REASON,
	PROFILE_FLATNESS_FLOOR_M,
	resampleProfile,
	spreadRmse,
} from "./ProfileSpread";

/** Re-exported like `RIDGE_FLATNESS_FLOOR_M`: solver and surface share it. */
export { PROFILE_FLATNESS_FLOOR_M };

/** Re-exported so the solver's own floor stays one constant with the surface's. */
export { RIDGE_FLATNESS_FLOOR_M };

export interface AutoConvergeSegment {
	/** Pooled closure gain at one (CdA, Crr), in SLIDER-value space. */
	veGain(cda: number, crr: number): number;
	/** The segment's reference elevation difference (m). */
	target: number;
	/** Distance weight (m); the stationarity weight above. */
	weight: number;
	/**
	 * The window's VE profile at one (CdA, Crr), rebased to 0 at the window
	 * start, in SLIDER-value space like `veGain`. Optional: only the
	 * profile-consistency solve reads it, and a segment without one simply
	 * cannot be compared (`solveBothProfile`).
	 */
	veProfile?(cda: number, crr: number): Float64Array;
	/**
	 * The window's travelled distance per sample (m), rebased to 0 at the
	 * window start; same length as a `veProfile` result. Absent when the
	 * activity has no usable distance channel.
	 */
	profileDistance?: Float64Array;
	/**
	 * Profiles are compared only within a group (`ProfileSpread` header) —
	 * out-and-back legs group by direction. Absent means one shared group.
	 */
	profileGroup?: string;
}

export interface AutoConvergeBounds {
	cdaMin: number;
	cdaMax: number;
	crrMin: number;
	crrMax: number;
}

export type SolveStatus = "ok" | "clamped-low" | "clamped-high";

export interface SolveResult {
	value: number;
	status: SolveStatus;
}

const BISECTION_ITERATIONS = 60;

/**
 * The segments this solver is entitled to use.
 *
 * `ve_gain` reports NaN for a window it cannot measure — one `metrics_window`
 * rejects, or one spanning no samples — exactly as `ve_gain_grid` reports an
 * empty grid for the same window and the Convergence tab drops that segment.
 * Both consumers now drop it. Left in, such a segment contributes
 * `w_s · (NaN − target_s)` and poisons every bisection it touches; before the
 * gain said NaN it contributed `w_s · (0 − target_s)` and quietly moved the
 * answer, which is the bug this pair of changes closes.
 *
 * One probe at the centre of the bounds is enough: a window either has samples
 * or it does not, and that does not depend on (CdA, Crr).
 */
export function usableSegments(
	segments: readonly AutoConvergeSegment[],
	bounds: AutoConvergeBounds,
): AutoConvergeSegment[] {
	const cda = 0.5 * (bounds.cdaMin + bounds.cdaMax);
	const crr = 0.5 * (bounds.crrMin + bounds.crrMax);
	return segments.filter(
		(segment) =>
			Number.isFinite(segment.veGain(cda, crr)) &&
			Number.isFinite(segment.target) &&
			Number.isFinite(segment.weight),
	);
}

/** Σ w_s · (gain_s(cda, crr) − target_s) — strictly decreasing in both axes. */
export function pooledResidual(
	segments: readonly AutoConvergeSegment[],
	cda: number,
	crr: number,
): number {
	let sum = 0;
	for (const segment of segments) {
		sum += segment.weight * (segment.veGain(cda, crr) - segment.target);
	}
	return sum;
}

function bisect(
	residualAt: (value: number) => number,
	lo: number,
	hi: number,
): SolveResult {
	const residualLo = residualAt(lo);
	const residualHi = residualAt(hi);

	// Decreasing: bracketed iff residual(lo) >= 0 >= residual(hi). When the
	// root lies outside the bounds, clamp to the bound nearer the root — the
	// one with the smaller |residual| — and say so.
	if (!(residualLo >= 0)) {
		return { value: lo, status: "clamped-low" };
	}
	if (!(residualHi <= 0)) {
		return { value: hi, status: "clamped-high" };
	}

	let low = lo;
	let high = hi;
	for (let i = 0; i < BISECTION_ITERATIONS; i++) {
		const mid = 0.5 * (low + high);
		if (mid <= low || mid >= high) {
			break;
		}
		if (residualAt(mid) > 0) {
			low = mid;
		} else {
			high = mid;
		}
		if (high - low <= 1e-12) {
			break;
		}
	}
	return { value: 0.5 * (low + high), status: "ok" };
}

/** The Crr at which the pooled residual crosses zero, at fixed CdA. */
export function solveCrrForCda(
	segments: readonly AutoConvergeSegment[],
	cda: number,
	crrLo: number,
	crrHi: number,
): SolveResult {
	return bisect((crr) => pooledResidual(segments, cda, crr), crrLo, crrHi);
}

/** The CdA at which the pooled residual crosses zero, at fixed Crr. */
export function solveCdaForCrr(
	segments: readonly AutoConvergeSegment[],
	crr: number,
	cdaLo: number,
	cdaHi: number,
): SolveResult {
	return bisect((cda) => pooledResidual(segments, cda, crr), cdaLo, cdaHi);
}


/** CdA columns sampled when tracing the ridge for `solveBoth`. */
const RIDGE_SAMPLES = 41;

export interface SolveBothResult {
	cda: number;
	crr: number;
	status: "ok" | "underdetermined";
	/** Set when refused: the reason, in words fit for the sidebar. */
	reason: string | null;
}

/**
 * Both sliders locked: trace the ridge (best Crr per CdA), check that the
 * along-ridge error actually has curvature, and only then report its minimum
 * (parabolic refinement over the CdA lattice, Crr re-solved at the result).
 */
export function solveBoth(
	segments: readonly AutoConvergeSegment[],
	bounds: AutoConvergeBounds,
	options?: { ridgeFlatnessFloorM?: number },
): SolveBothResult {
	if (segments.length < 2) {
		return {
			cda: NaN,
			crr: NaN,
			status: "underdetermined",
			reason:
				"One run cannot separate CdA from Crr — closure error trades them " +
				"off along the ridge. Analyse two or more runs at different speeds.",
		};
	}

	const cdaValues: number[] = [];
	const ridgeCrr: number[] = [];
	const ridge: RidgeColumn[] = [];
	for (let i = 0; i < RIDGE_SAMPLES; i++) {
		const cda =
			bounds.cdaMin +
			(i * (bounds.cdaMax - bounds.cdaMin)) / (RIDGE_SAMPLES - 1);
		const crr = solveCrrForCda(segments, cda, bounds.crrMin, bounds.crrMax);
		let sumOfSquares = 0;
		for (const segment of segments) {
			const residual = segment.veGain(cda, crr.value) - segment.target;
			sumOfSquares += residual * residual;
		}
		cdaValues.push(cda);
		ridgeCrr.push(crr.value);
		// A clamped bisection means this column's Crr sits on a bound: off the
		// ridge, and excluded by `judgeRidge` from both tests it applies.
		ridge.push({ error: Math.sqrt(sumOfSquares), onRidge: crr.status === "ok" });
	}

	// The flatness and outside-the-bounds verdicts are `judgeRidge`'s, shared
	// with the Convergence tab's surface so the plot and this solver cannot
	// disagree about whether a selection is determined.
	const verdict = judgeRidge(ridge, {
		ridgeFlatnessFloorM: options?.ridgeFlatnessFloorM,
	});
	if (verdict.status === "underdetermined") {
		return {
			cda: NaN,
			crr: NaN,
			status: "underdetermined",
			reason: verdict.reason,
		};
	}
	const cda = refineRidgeArgmin(cdaValues, ridge, verdict.bestIndex);
	const crr = solveCrrForCda(segments, cda, bounds.crrMin, bounds.crrMax);

	return { cda, crr: crr.value, status: "ok", reason: null };
}

/**
 * Parabolic vertex through the argmin column and its neighbours, clamped to
 * half a lattice cell; the lattice value where a neighbour is missing or
 * off-ridge, or under degenerate curvature.
 */
function refineRidgeArgmin(
	cdaValues: readonly number[],
	ridge: readonly RidgeColumn[],
	minIndex: number,
): number {
	let cda = cdaValues[minIndex];
	if (
		minIndex > 0 &&
		minIndex < ridge.length - 1 &&
		ridge[minIndex - 1].onRidge &&
		ridge[minIndex + 1].onRidge
	) {
		const left = ridge[minIndex - 1].error;
		const centre = ridge[minIndex].error;
		const right = ridge[minIndex + 1].error;
		const curvature = left - 2 * centre + right;
		if (curvature > 0) {
			const offset = Math.max(
				-0.5,
				Math.min(0.5, (left - right) / (2 * curvature)),
			);
			cda += offset * (cdaValues[1] - cdaValues[0]);
		}
	}
	return cda;
}

/** Distance-grid resolution the profiles are compared on. */
const PROFILE_GRID_POINTS = 200;

export const PROFILE_NO_PAIR_REASON =
	"Profile consistency needs two or more runs over the same course in the " +
	"same direction — the selection has no comparable pair.";
export const PROFILE_NO_DISTANCE_REASON =
	"Profile consistency needs a usable distance channel on every compared " +
	"run — this selection has none to compare.";

/**
 * The profile-consistency variant of `solveBoth` (the sidebar checkbox).
 *
 * Same two ingredients as the endpoint solve, different along-ridge
 * objective: the CLOSURE CONSTRAINT is kept exactly — each column's Crr is
 * the zero of the pooled residual over ALL segments, so the mean closure
 * matches the applied elevation everywhere the solver looks — but the point
 * along the ridge is chosen by run-to-run VE profile spread (`ProfileSpread`)
 * instead of pooled endpoint error. Profiles react to CdA wherever the runs'
 * speed profiles differ mid-lap, so this can determine selections the
 * endpoint objective refuses as flat; identically paced runs are still flat
 * and still refused, through the same `judgeRidge` verdict with the spread's
 * own flatness floor.
 */
export function solveBothProfile(
	segments: readonly AutoConvergeSegment[],
	bounds: AutoConvergeBounds,
	options?: { profileFlatnessFloorM?: number },
): SolveBothResult {
	const refused = (reason: string): SolveBothResult => ({
		cda: NaN,
		crr: NaN,
		status: "underdetermined",
		reason,
	});

	// Comparable = carries both a profile and a distance axis; compared only
	// within its group (out-and-back legs must not be pooled across
	// directions — `ProfileSpread` header).
	let missingDistance = false;
	const groups = new Map<string, AutoConvergeSegment[]>();
	for (const segment of segments) {
		if (!segment.veProfile) {
			continue;
		}
		if (!segment.profileDistance) {
			missingDistance = true;
			continue;
		}
		const key = segment.profileGroup ?? "";
		const group = groups.get(key);
		if (group) {
			group.push(segment);
		} else {
			groups.set(key, [segment]);
		}
	}
	const compared = [...groups.values()].filter((group) => group.length >= 2);
	if (compared.length === 0) {
		return refused(
			missingDistance ? PROFILE_NO_DISTANCE_REASON : PROFILE_NO_PAIR_REASON,
		);
	}

	const grid = commonDistanceGrid(
		compared.flat().map((segment) => segment.profileDistance as Float64Array),
		PROFILE_GRID_POINTS,
	);
	if (!grid) {
		return refused(PROFILE_NO_DISTANCE_REASON);
	}

	const cdaValues: number[] = [];
	const ridge: RidgeColumn[] = [];
	for (let i = 0; i < RIDGE_SAMPLES; i++) {
		const cda =
			bounds.cdaMin +
			(i * (bounds.cdaMax - bounds.cdaMin)) / (RIDGE_SAMPLES - 1);
		// The closure constraint runs over ALL segments — a run with no
		// profile still anchors the mean closure.
		const crr = solveCrrForCda(segments, cda, bounds.crrMin, bounds.crrMax);
		const error = spreadRmse(
			compared.map((group) =>
				group.map((segment) =>
					resampleProfile(
						segment.profileDistance as Float64Array,
						(segment.veProfile as (c: number, r: number) => Float64Array)(
							cda,
							crr.value,
						),
						grid,
					),
				),
			),
		);
		cdaValues.push(cda);
		ridge.push({
			error,
			onRidge: crr.status === "ok" && Number.isFinite(error),
		});
	}

	const verdict = judgeRidge(ridge, {
		ridgeFlatnessFloorM:
			options?.profileFlatnessFloorM ?? PROFILE_FLATNESS_FLOOR_M,
		flatReason: PROFILE_FLAT_REASON,
	});
	if (verdict.status === "underdetermined") {
		return refused(verdict.reason);
	}
	const cda = refineRidgeArgmin(cdaValues, ridge, verdict.bestIndex);
	const crr = solveCrrForCda(segments, cda, bounds.crrMin, bounds.crrMax);

	return { cda, crr: crr.value, status: "ok", reason: null };
}

// ---------------------------------------------------------------------------
// The lock table
// ---------------------------------------------------------------------------

export interface AutoConvergeState {
	enabled: boolean;
	cdaLocked: boolean;
	crrLocked: boolean;
	/**
	 * Both-locked solves use `solveBothProfile` (run-to-run VE profile
	 * overlap along the closure ridge) instead of `solveBoth` (pooled
	 * endpoint closure error). Optional so pre-existing state objects mean
	 * "off"; irrelevant unless both locks are on.
	 */
	profileSolve?: boolean;
}

export const AUTO_CONVERGE_DEFAULT: AutoConvergeState = {
	enabled: false,
	cdaLocked: false,
	crrLocked: false,
	profileSolve: false,
};

export interface AutoConvergeResolution {
	cda: number;
	crr: number;
	drivenCda: boolean;
	drivenCrr: boolean;
	/**
	 * 'idle': auto-converge off or nothing locked — the inputs pass through
	 * byte for byte. 'ok': the driven value(s) were solved. 'clamped': a root
	 * lay outside the parameter bounds and the nearer bound was used.
	 * 'underdetermined': both locked and the surface refused (see solveBoth);
	 * the sliders stay where they are.
	 */
	status: "idle" | "ok" | "clamped" | "underdetermined";
	reason: string | null;
}

/**
 * The confirmed lock semantics — a locked slider is DRIVEN by the solver, not
 * frozen:
 *
 * | CdA    | Crr    | behaviour                                          |
 * |--------|--------|----------------------------------------------------|
 * | free   | free   | today's path, both hand-tuned (idle)               |
 * | locked | free   | user drags Crr; CdA follows the ridge              |
 * | free   | locked | user drags CdA; Crr follows the ridge              |
 * | locked | locked | both driven; sits at the surface optimum, or       |
 * |        |        | refuses when the surface cannot support one        |
 */
export function resolveAutoConvergedControls(args: {
	state: AutoConvergeState;
	cda: number;
	crr: number;
	segments: readonly AutoConvergeSegment[];
	bounds: AutoConvergeBounds;
	ridgeFlatnessFloorM?: number;
	profileFlatnessFloorM?: number;
}): AutoConvergeResolution {
	const { state, cda, crr, bounds } = args;
	const idle: AutoConvergeResolution = {
		cda,
		crr,
		drivenCda: false,
		drivenCrr: false,
		status: "idle",
		reason: null,
	};

	if (!state.enabled || (!state.cdaLocked && !state.crrLocked)) {
		return idle;
	}
	// Degenerate segments are dropped HERE, once, rather than inside each
	// solve: `pooledResidual` stays a plain sum over what it is given, and
	// what it is given is only ever measurable.
	const segments = usableSegments(args.segments, bounds);
	if (segments.length === 0) {
		return idle;
	}

	if (state.cdaLocked && state.crrLocked) {
		const solved = state.profileSolve
			? solveBothProfile(segments, bounds, {
					profileFlatnessFloorM: args.profileFlatnessFloorM,
				})
			: solveBoth(segments, bounds, {
					ridgeFlatnessFloorM: args.ridgeFlatnessFloorM,
				});
		if (solved.status === "underdetermined") {
			return {
				...idle,
				status: "underdetermined",
				reason: solved.reason,
			};
		}
		return {
			cda: solved.cda,
			crr: solved.crr,
			drivenCda: true,
			drivenCrr: true,
			status: "ok",
			reason: null,
		};
	}

	if (state.cdaLocked) {
		// The user drags Crr; CdA follows the ridge.
		const solved = solveCdaForCrr(segments, crr, bounds.cdaMin, bounds.cdaMax);
		return {
			cda: solved.value,
			crr,
			drivenCda: true,
			drivenCrr: false,
			status: solved.status === "ok" ? "ok" : "clamped",
			reason: null,
		};
	}

	// crrLocked: the user drags CdA; Crr follows the ridge.
	const solved = solveCrrForCda(segments, cda, bounds.crrMin, bounds.crrMax);
	return {
		cda,
		crr: solved.value,
		drivenCda: false,
		drivenCrr: true,
		status: solved.status === "ok" ? "ok" : "clamped",
		reason: null,
	};
}
