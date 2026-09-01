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

export interface AutoConvergeSegment {
	/** Pooled closure gain at one (CdA, Crr), in SLIDER-value space. */
	veGain(cda: number, crr: number): number;
	/** The segment's reference elevation difference (m). */
	target: number;
	/** Distance weight (m); the stationarity weight above. */
	weight: number;
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

/**
 * Below this along-ridge RSS spread (metres) the valley floor is flat and no
 * optimum is reported. Matches `ClosureSurface.DEFAULT_RIDGE_FLATNESS_FLOOR_M`
 * in spirit: barometric closure noise is of order a metre per run.
 */
export const RIDGE_FLATNESS_FLOOR_M = 0.5;

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
	const ridgeError: number[] = [];
	const ridgeOnRidge: boolean[] = [];
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
		ridgeError.push(Math.sqrt(sumOfSquares));
		ridgeOnRidge.push(crr.status === "ok");
	}

	// FLATNESS IS MEASURED OVER THE UNCLAMPED COLUMNS ONLY. Where the valley
	// exits the Crr bounds the solve clamps and the error rises steeply — an
	// artefact of the box, not curvature of the valley. Including those
	// columns would let a perfectly degenerate selection (identical laps)
	// masquerade as determined whenever its ridge leaves the box, which for
	// realistic bounds is always. That artefact is exactly what this check
	// exists to refuse.
	const unclamped = ridgeError.filter((_, i) => ridgeOnRidge[i]);
	if (unclamped.length < 5) {
		return {
			cda: NaN,
			crr: NaN,
			status: "underdetermined",
			reason:
				"The closure valley lies almost entirely outside the CdA/Crr " +
				"bounds — widen them, or analyse a different selection.",
		};
	}

	const floor = options?.ridgeFlatnessFloorM ?? RIDGE_FLATNESS_FLOOR_M;
	const spread = Math.max(...unclamped) - Math.min(...unclamped);
	if (!(spread >= floor)) {
		return {
			cda: NaN,
			crr: NaN,
			status: "underdetermined",
			reason:
				"The ridge is flat — closure error alone cannot separate CdA from " +
				"Crr for this selection. Analyse two or more runs at different speeds.",
		};
	}

	let minIndex = -1;
	for (let i = 0; i < RIDGE_SAMPLES; i++) {
		if (ridgeOnRidge[i] && (minIndex < 0 || ridgeError[i] < ridgeError[minIndex])) {
			minIndex = i;
		}
	}

	// Parabolic vertex through the argmin and its neighbours, clamped to half
	// a lattice cell; the lattice value where a neighbour is missing or
	// clamped, or under degenerate curvature.
	let cda = cdaValues[minIndex];
	if (
		minIndex > 0 &&
		minIndex < RIDGE_SAMPLES - 1 &&
		ridgeOnRidge[minIndex - 1] &&
		ridgeOnRidge[minIndex + 1]
	) {
		const left = ridgeError[minIndex - 1];
		const centre = ridgeError[minIndex];
		const right = ridgeError[minIndex + 1];
		const curvature = left - 2 * centre + right;
		if (curvature > 0) {
			const offset = Math.max(
				-0.5,
				Math.min(0.5, (left - right) / (2 * curvature)),
			);
			cda += offset * (cdaValues[1] - cdaValues[0]);
		}
	}
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
}

export const AUTO_CONVERGE_DEFAULT: AutoConvergeState = {
	enabled: false,
	cdaLocked: false,
	crrLocked: false,
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
}): AutoConvergeResolution {
	const { state, cda, crr, segments, bounds } = args;
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
	if (segments.length === 0) {
		return idle;
	}

	if (state.cdaLocked && state.crrLocked) {
		const solved = solveBoth(segments, bounds, {
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
