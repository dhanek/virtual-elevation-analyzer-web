/**
 * Pools per-segment VE-gain grids into the closure-error surface the
 * Convergence tab draws, and finds its ridge and (when it exists) optimum.
 *
 * Pure: no DOM, no Plotly, no WASM. The gains arrive as the flat
 * `ve_gain_grid` output — row-major over CdA, `gains[cdaIndex * crrCount +
 * crrIndex]` — and the targets from `resolveClosureTarget`, so the pooled
 * error at a cell is the RSS of the per-segment closure misfits:
 *
 *   z[crrIndex][cdaIndex] = sqrt(Σ_s (gain_s - target_s)²)
 *
 * `z` is indexed [crr][cda] because that is Plotly's `z` orientation for
 * x=CdA, y=Crr — a transposed surface renders plausibly and lies, which is
 * why the tests use an asymmetric grid.
 *
 * WHY THE OPTIMUM CAN BE REFUSED. Closure error alone does not identify a
 * unique (CdA, Crr): raising CdA and lowering Crr trade off along a valley
 * (the ridge), and the pooled surface has a genuine minimum only when the
 * segments differ enough in speed and wind that their individual valleys
 * cross at a real angle. With one segment — or several near-identical laps —
 * the along-ridge error is flat and any argmin is numerical noise. Reporting
 * a confident optimum there would fabricate a CdA, so `best` is withheld and
 * `underdetermined` says why in words the plot can display.
 */

export interface SegmentGain {
	/** Flat `ve_gain_grid` result: `gains[cdaIndex * crrCount + crrIndex]`. */
	gains: ArrayLike<number>;
	/** This segment's reference elevation difference (`resolveClosureTarget`). */
	target: number;
}

export interface ClosureOptimum {
	cda: number;
	crr: number;
	/** Pooled closure error at the optimum, metres. */
	error: number;
}

export interface ClosureSurfaceResult {
	/** Pooled RSS closure error, indexed [crrIndex][cdaIndex]. */
	z: number[][];
	/** The ridge: for each CdA column, the Crr minimising pooled error. */
	ridgeCda: number[];
	ridgeCrr: number[];
	/** Sub-cell refined argmin, or null when the surface cannot support one. */
	best: ClosureOptimum | null;
	/**
	 * True when the raw argmin sits on a grid edge: the true minimum may lie
	 * outside the bounds, making the fit look sharper than it is (a `crr_min`
	 * floor clipping the valley is the measured case). Meaningful only when
	 * `best` is non-null.
	 */
	clipped: boolean;
	/** Non-null when `best` is null: the reason, in words fit for the plot. */
	underdetermined: string | null;
}

/**
 * Below this along-ridge error spread (metres) the valley floor is treated as
 * flat. Barometric closure noise is of order a metre per run; an optimum
 * separated from the rest of the ridge by less than half that is noise, not
 * signal.
 */
export const DEFAULT_RIDGE_FLATNESS_FLOOR_M = 0.5;

export interface PoolClosureSurfaceOptions {
	ridgeFlatnessFloorM?: number;
}

export function poolClosureSurface(
	segments: readonly SegmentGain[],
	cdaValues: readonly number[],
	crrValues: readonly number[],
	options?: PoolClosureSurfaceOptions,
): ClosureSurfaceResult {
	const cdaCount = cdaValues.length;
	const crrCount = crrValues.length;
	if (cdaCount < 2 || crrCount < 2) {
		throw new Error(
			`closure surface needs at least a 2x2 grid, got ${cdaCount}x${crrCount}`,
		);
	}
	for (const [index, segment] of segments.entries()) {
		if (segment.gains.length !== cdaCount * crrCount) {
			throw new Error(
				`segment ${index}: ${segment.gains.length} gains for a ` +
					`${cdaCount}x${crrCount} grid (expected ${cdaCount * crrCount})`,
			);
		}
	}

	// Pooled RSS per cell, in Plotly's [crr][cda] orientation.
	const z: number[][] = [];
	for (let j = 0; j < crrCount; j++) {
		const row = new Array<number>(cdaCount);
		for (let i = 0; i < cdaCount; i++) {
			let sumOfSquares = 0;
			for (const segment of segments) {
				const residual = segment.gains[i * crrCount + j] - segment.target;
				sumOfSquares += residual * residual;
			}
			row[i] = Math.sqrt(sumOfSquares);
		}
		z.push(row);
	}

	// The ridge: per CdA column, the Crr minimising pooled error.
	const ridgeCda: number[] = [];
	const ridgeCrr: number[] = [];
	const ridgeErrors: number[] = [];
	for (let i = 0; i < cdaCount; i++) {
		let bestJ = 0;
		for (let j = 1; j < crrCount; j++) {
			if (z[j][i] < z[bestJ][i]) {
				bestJ = j;
			}
		}
		ridgeCda.push(cdaValues[i]);
		ridgeCrr.push(crrValues[bestJ]);
		ridgeErrors.push(z[bestJ][i]);
	}

	const refused = (reason: string): ClosureSurfaceResult => ({
		z,
		ridgeCda,
		ridgeCrr,
		best: null,
		clipped: false,
		underdetermined: reason,
	});

	if (segments.length === 0) {
		return refused("No segments to pool — analyse a selection first.");
	}
	if (segments.length < 2) {
		return refused(
			"One run cannot separate CdA from Crr — closure error trades them " +
				"off along the ridge. Analyse two or more runs at different speeds.",
		);
	}

	const floor = options?.ridgeFlatnessFloorM ?? DEFAULT_RIDGE_FLATNESS_FLOOR_M;
	const spread = Math.max(...ridgeErrors) - Math.min(...ridgeErrors);
	if (!(spread >= floor)) {
		return refused(
			"The ridge is flat — closure error alone cannot separate CdA from " +
				"Crr for this selection. Analyse two or more runs at different speeds.",
		);
	}

	// Raw argmin over the whole surface.
	let minI = 0;
	let minJ = 0;
	for (let j = 0; j < crrCount; j++) {
		for (let i = 0; i < cdaCount; i++) {
			if (z[j][i] < z[minJ][minI]) {
				minI = i;
				minJ = j;
			}
		}
	}
	const clipped =
		minI === 0 || minI === cdaCount - 1 || minJ === 0 || minJ === crrCount - 1;

	// Sub-cell parabolic refinement in each axis, clamped to one cell — a
	// display nicety for the marker; the both-locked solver re-derives its
	// answer by bisection and never reads this.
	const cda = refineAxis(
		cdaValues,
		minI,
		(index) => z[minJ][index],
	);
	const crr = refineAxis(
		crrValues,
		minJ,
		(index) => z[index][minI],
	);

	return {
		z,
		ridgeCda,
		ridgeCrr,
		best: { cda, crr, error: z[minJ][minI] },
		clipped,
		underdetermined: null,
	};
}

/**
 * Vertex of the parabola through the argmin and its two axis neighbours,
 * clamped to half a cell; the lattice value where a neighbour is missing
 * (argmin on an edge) or the curvature is degenerate.
 */
function refineAxis(
	values: readonly number[],
	minIndex: number,
	errorAt: (index: number) => number,
): number {
	if (minIndex === 0 || minIndex === values.length - 1) {
		return values[minIndex];
	}
	const left = errorAt(minIndex - 1);
	const centre = errorAt(minIndex);
	const right = errorAt(minIndex + 1);
	const curvature = left - 2 * centre + right;
	if (!(curvature > 0)) {
		return values[minIndex];
	}
	const offset = Math.max(-0.5, Math.min(0.5, (left - right) / (2 * curvature)));
	const cell = values[minIndex + 1] - values[minIndex];
	return values[minIndex] + offset * cell;
}

/**
 * Grid resolution for a pooled surface, from measurement
 * (`npm run profile:convergence`, 2026-09-01): ~6.2 ns per cell-sample, so
 * 100x100 over a 6-segment GPS-lap pass (~6 600 window samples) is ~430 ms
 * and stays a one-off hitch — the surface is cached across CdA/Crr drags.
 * Above ~16 000 window samples 100x100 would pass ~1 s, so the grid drops
 * to 41x41 there; the resolution is shown in the plot title so the number
 * on screen is never unexplained.
 */
export const DEFAULT_GRID_STEPS = 100;
export const COARSE_GRID_STEPS = 41;
export const COARSE_GRID_WINDOW_SAMPLES = 16_000;

export function chooseGridSteps(totalWindowSamples: number): number {
	return totalWindowSamples > COARSE_GRID_WINDOW_SAMPLES
		? COARSE_GRID_STEPS
		: DEFAULT_GRID_STEPS;
}

/** The linearly spaced axis `ve_gain_grid` evaluates, endpoints inclusive. */
export function gridAxis(min: number, max: number, steps: number): number[] {
	const axis = new Array<number>(steps);
	for (let i = 0; i < steps; i++) {
		axis[i] = min + (i * (max - min)) / (steps - 1);
	}
	return axis;
}
