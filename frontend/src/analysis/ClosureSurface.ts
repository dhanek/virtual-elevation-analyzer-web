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

/**
 * The "5 cm band": the level set of the pooled surface at `best.error +
 * toleranceM`, and its CdA / Crr extents.
 *
 * WHY RELATIVE TO THE MINIMUM, NOT AN ABSOLUTE 5 cm. The pooled RSS at the
 * optimum is rarely near zero — barometric closure noise alone is of order a
 * metre per run — so an absolute `z <= 0.05 m` contour would usually be
 * empty and say nothing. What the band answers is the identifiability
 * question: how far can the sliders move from the best fit before the
 * closure worsens by 5 cm? On a perfectly closing selection (best error 0,
 * the two-segment case) the two readings coincide.
 *
 * The extents are the axis-aligned bounding box of the level set, with the
 * crossing interpolated linearly between the last in-band cell and its
 * out-of-band neighbour so a coarse (41x41) grid does not quantise a
 * millimetre-scale answer to a whole cell. The box is deliberately NOT an
 * ellipse fit: the valley is a tilted trough, and a fitted ellipse would
 * report a symmetric ± that the surface does not have. `low`/`high` are
 * therefore reported separately, as offsets from `best`.
 *
 * `touchesEdge` is true when the level set reaches a grid boundary; the
 * extents on that side are then the grid bound, and the true band is at
 * least that wide.
 */
export interface ClosureBand {
	/** The tolerance the band was cut at, metres. */
	toleranceM: number;
	/** Absolute pooled error of the iso-line: `best.error + toleranceM`. */
	threshold: number;
	/** Extents of the level set, in slider units. */
	cdaLow: number;
	cdaHigh: number;
	crrLow: number;
	crrHigh: number;
	touchesEdge: boolean;
}

/** The band tolerance the Convergence tab draws and reads out. */
export const DEFAULT_CLOSURE_BAND_TOLERANCE_M = 0.05;

export function closureBand(
	surface: ClosureSurfaceResult,
	cdaValues: readonly number[],
	crrValues: readonly number[],
	toleranceM: number = DEFAULT_CLOSURE_BAND_TOLERANCE_M,
): ClosureBand | null {
	if (!surface.best) {
		return null;
	}
	if (!(toleranceM > 0)) {
		throw new Error(`closure band tolerance must be positive, got ${toleranceM}`);
	}
	const threshold = surface.best.error + toleranceM;
	const { z } = surface;
	const cdaCount = cdaValues.length;
	const crrCount = crrValues.length;

	let cdaLow = Number.POSITIVE_INFINITY;
	let cdaHigh = Number.NEGATIVE_INFINITY;
	let crrLow = Number.POSITIVE_INFINITY;
	let crrHigh = Number.NEGATIVE_INFINITY;
	let touchesEdge = false;

	// Where the threshold is crossed between an in-band cell and its
	// out-of-band neighbour, in axis units.
	const crossing = (
		axis: readonly number[],
		inside: number,
		outside: number,
		zInside: number,
		zOutside: number,
	): number =>
		axis[inside] +
		(axis[outside] - axis[inside]) *
			((threshold - zInside) / (zOutside - zInside));

	for (let j = 0; j < crrCount; j++) {
		const row = z[j];
		for (let i = 0; i < cdaCount; i++) {
			if (!(row[i] <= threshold)) {
				continue;
			}
			// CdA extent along this row.
			if (i === 0) {
				touchesEdge = true;
				cdaLow = Math.min(cdaLow, cdaValues[0]);
			} else if (!(row[i - 1] <= threshold)) {
				cdaLow = Math.min(cdaLow, crossing(cdaValues, i, i - 1, row[i], row[i - 1]));
			}
			if (i === cdaCount - 1) {
				touchesEdge = true;
				cdaHigh = Math.max(cdaHigh, cdaValues[i]);
			} else if (!(row[i + 1] <= threshold)) {
				cdaHigh = Math.max(cdaHigh, crossing(cdaValues, i, i + 1, row[i], row[i + 1]));
			}
			// Crr extent along this column.
			if (j === 0) {
				touchesEdge = true;
				crrLow = Math.min(crrLow, crrValues[0]);
			} else if (!(z[j - 1][i] <= threshold)) {
				crrLow = Math.min(crrLow, crossing(crrValues, j, j - 1, row[i], z[j - 1][i]));
			}
			if (j === crrCount - 1) {
				touchesEdge = true;
				crrHigh = Math.max(crrHigh, crrValues[j]);
			} else if (!(z[j + 1][i] <= threshold)) {
				crrHigh = Math.max(crrHigh, crossing(crrValues, j, j + 1, row[i], z[j + 1][i]));
			}
		}
	}

	if (!Number.isFinite(cdaLow)) {
		// `best` came from this surface, so its cell is in band by
		// construction; an empty level set means the surface was mutated.
		return null;
	}

	// The refined optimum can sit a fraction of a cell outside the lattice
	// level set; the band must always contain the point it is reported around.
	const { cda, crr } = surface.best;
	return {
		toleranceM,
		threshold,
		cdaLow: Math.min(cdaLow, cda),
		cdaHigh: Math.max(cdaHigh, cda),
		crrLow: Math.min(crrLow, crr),
		crrHigh: Math.max(crrHigh, crr),
		touchesEdge,
	};
}
