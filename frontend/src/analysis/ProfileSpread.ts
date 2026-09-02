/**
 * Run-to-run VE profile spread — the objective of the profile-consistency
 * solve (`solveBothProfile` in `AutoConverge.ts`).
 *
 * THE IDEA. The endpoint solve compares one number per segment (net VE gain
 * vs the reference elevation difference), so it can only separate CdA from
 * Crr when whole runs differ in average speed. Runs over the SAME course
 * carry more: at the correct (CdA, Crr) their VE curves overlap along the
 * whole lap, and a wrong split makes them diverge wherever their speed
 * profiles differ — a surge, a gust, different pacing. This module measures
 * that divergence: each run's VE profile is resampled onto a common distance
 * grid and the RMS deviation from the cross-run mean profile is the spread,
 * in metres.
 *
 * WHY GROUPS. Profiles are only comparable between runs that covered the same
 * ground in the same direction — an out-and-back's two legs traverse the same
 * road but their VE curves are mirror images containing the REAL elevation
 * profile twice over, so comparing them to a shared mean would chase terrain,
 * not parameters. The caller assigns each segment a group (leg direction);
 * deviations are measured within groups only, and a group with a single
 * member contributes nothing.
 *
 * WHY THE Crr TERM CANCELS (and why this pairs with the closure ridge). Every
 * run's VE loses `crr · distance` — identical at each grid point across runs
 * — so the deviation-from-mean is almost blind to Crr and the spread measures
 * essentially CdA alone. The profile solve therefore keeps the closure
 * constraint (the ridge) to pin Crr and uses the spread only to pick the
 * point ALONG the ridge, which is exactly the axis the endpoint objective is
 * weakest on.
 */

/**
 * The common distance grid the profiles are compared on: `points` samples,
 * evenly spaced from 0 to the shortest segment's travelled distance, so every
 * grid point lies inside every profile. Null when any segment has no usable
 * span (empty, non-finite, or non-positive) — there is nothing to compare on.
 */
export function commonDistanceGrid(
	distances: readonly ArrayLike<number>[],
	points: number,
): Float64Array | null {
	if (distances.length === 0 || points < 2) {
		return null;
	}
	let span = Number.POSITIVE_INFINITY;
	for (const distance of distances) {
		if (distance.length < 2) {
			return null;
		}
		const last = distance[distance.length - 1];
		if (!Number.isFinite(last) || last <= 0) {
			return null;
		}
		span = Math.min(span, last);
	}
	const grid = new Float64Array(points);
	for (let i = 0; i < points; i++) {
		grid[i] = (i * span) / (points - 1);
	}
	return grid;
}

/**
 * Linear interpolation of `ve` (sampled at `distance`, rebased so
 * `distance[0] === 0`) onto `grid`. Distance can stall (zero speed produces
 * repeated values); a stalled pair interpolates as a step rather than
 * dividing by zero. Grid points beyond the profile's end clamp to its last
 * value — `commonDistanceGrid` keeps them inside, so the clamp only absorbs
 * float rounding at the far end.
 */
export function resampleProfile(
	distance: ArrayLike<number>,
	ve: ArrayLike<number>,
	grid: Float64Array,
): Float64Array {
	const out = new Float64Array(grid.length);
	let j = 0;
	const last = distance.length - 1;
	for (let i = 0; i < grid.length; i++) {
		const x = grid[i];
		while (j < last && distance[j + 1] <= x) {
			j++;
		}
		if (j >= last) {
			out[i] = ve[last];
			continue;
		}
		const d0 = distance[j];
		const d1 = distance[j + 1];
		const step = d1 - d0;
		out[i] =
			step > 0
				? ve[j] + ((ve[j + 1] - ve[j]) * (x - d0)) / step
				: ve[j];
	}
	return out;
}

/**
 * The pooled spread: RMS deviation of each profile from its group's mean,
 * over every grid point of every group with at least two members. NaN when no
 * group has two members (nothing to compare) or any contributing profile
 * carries a non-finite value — the caller treats a NaN column as off-ridge,
 * the same contract `ve_gain`'s NaN has in the endpoint solve.
 */
export function spreadRmse(
	groups: readonly (readonly Float64Array[])[],
): number {
	let sumOfSquares = 0;
	let count = 0;
	for (const group of groups) {
		if (group.length < 2) {
			continue;
		}
		const points = group[0].length;
		for (let i = 0; i < points; i++) {
			let mean = 0;
			for (const profile of group) {
				mean += profile[i];
			}
			mean /= group.length;
			for (const profile of group) {
				const deviation = profile[i] - mean;
				sumOfSquares += deviation * deviation;
			}
		}
		count += group.length * points;
	}
	if (count === 0) {
		return NaN;
	}
	return Math.sqrt(sumOfSquares / count);
}

/**
 * Below this change in profile-spread RMSE (metres) between the best and
 * worst on-ridge column, the spread is treated as flat and no optimum is
 * reported. The spread's noise floor — barometric drift and wind differences
 * between runs — moves slowly along the ridge; a minimum separated from the
 * rest by less than a decimetre of RMSE is that noise, not a CdA signal.
 * Shared by the solver (`solveBothProfile`) and the Convergence tab's
 * profile surface, the `RIDGE_FLATNESS_FLOOR_M` arrangement.
 */
export const PROFILE_FLATNESS_FLOOR_M = 0.1;

/** `judgeRidge`'s flat verdict, worded for the profile-spread metric. */
export const PROFILE_FLAT_REASON =
	"The runs' VE profiles agree equally well along the whole closure ridge " +
	"— mid-lap pacing differences are what separate CdA from Crr here. " +
	"Analyse runs with different pacing or speeds.";

/**
 * One segment of the ANCHORED spread surface: its VE profile linearised
 * around a probe point, resampled onto the common grid.
 *
 * The linearisation is what makes a full CdA × Crr surface affordable. Each
 * sample's VE increment is `step · sin(atan(base − cda·aero − crr))`
 * (`GainKernel`, virtual_elevation.rs) — affine in (CdA, Crr) up to the
 * sin∘atan flattening, which is under ~1% at riding slopes. So three exact
 * WASM profiles (the probe point and one step along each axis) give
 * `VE(d) ≈ p0(d) + ΔCdA·jc(d) + ΔCrr·jr(d)`, the whole spread surface
 * becomes one quadratic form, and any grid resolution evaluates in
 * microseconds. The SOLVER keeps exact profiles along its ridge; the map
 * accepts the ~1% secant error in exchange for showing the whole plane.
 */
export interface ProfileBasisSegment {
	/** Exact VE profile at the probe point, resampled onto the grid. */
	p0: Float64Array;
	/** Secant ∂VE/∂CdA per m² of CdA, resampled onto the grid. */
	jc: Float64Array;
	/** Secant ∂VE/∂Crr per unit of (slider) Crr, resampled onto the grid. */
	jr: Float64Array;
	/** The segment's reference elevation difference (m). */
	target: number;
	/** Compared only within a group (`ProfileSpread` header). */
	group: string;
}

/**
 * The anchored-spread surface: each run's RMS deviation from its group's
 * mean profile, with the mean TILTED so its endpoint gain equals the group's
 * closure target — the two steps of the profile solve folded into one number.
 *
 * The tilt term `(target − meanGain)·d/D` is what turns the spread — nearly
 * blind to Crr, whose `crr·d` loss is identical across runs and cancels in
 * the deviations — into a surface with a point optimum: off the closure
 * ridge the tilt penalty grows (that direction is Crr), and along the ridge
 * the spread picks the CdA. A single-member group has zero spread but still
 * contributes its tilt, i.e. its own closure misfit spread over the lap.
 *
 * Everything is affine in (ΔCdA, ΔCrr), so the sum of squares collapses to
 * six accumulated coefficients and the returned evaluator is O(1) per cell.
 */
export function anchoredSpreadEvaluator(
	segments: readonly ProfileBasisSegment[],
	grid: Float64Array,
	cda0: number,
	crr0: number,
): (cda: number, crr: number) => number {
	const points = grid.length;
	const last = points - 1;
	const span = grid[last];
	// d/D ramp the tilt rides on.
	const ramp = new Float64Array(points);
	for (let i = 0; i < points; i++) {
		ramp[i] = span > 0 ? grid[i] / span : 0;
	}

	const groups = new Map<string, ProfileBasisSegment[]>();
	for (const segment of segments) {
		const group = groups.get(segment.group);
		if (group) {
			group.push(segment);
		} else {
			groups.set(segment.group, [segment]);
		}
	}

	// Quadratic coefficients of the pooled sum of squares in (ΔCdA, ΔCrr).
	let sAA = 0;
	let sAB = 0;
	let sAC = 0;
	let sBB = 0;
	let sBC = 0;
	let sCC = 0;
	let count = 0;

	for (const group of groups.values()) {
		const m0 = new Float64Array(points);
		const mc = new Float64Array(points);
		const mr = new Float64Array(points);
		let meanTarget = 0;
		for (const segment of group) {
			for (let i = 0; i < points; i++) {
				m0[i] += segment.p0[i];
				mc[i] += segment.jc[i];
				mr[i] += segment.jr[i];
			}
			meanTarget += segment.target;
		}
		for (let i = 0; i < points; i++) {
			m0[i] /= group.length;
			mc[i] /= group.length;
			mr[i] /= group.length;
		}
		meanTarget /= group.length;
		// Mean gain over the grid window, per coefficient (profiles are
		// rebased to 0 at the window start, so the gain is the last value).
		const g0 = m0[last];
		const gc = mc[last];
		const gr = mr[last];

		for (const segment of group) {
			for (let i = 0; i < points; i++) {
				// dev = (VE_s − mean) − (target − meanGain)·ramp, split into
				// its constant / ΔCdA / ΔCrr parts.
				const a = segment.p0[i] - m0[i] - (meanTarget - g0) * ramp[i];
				const b = segment.jc[i] - mc[i] + gc * ramp[i];
				const c = segment.jr[i] - mr[i] + gr * ramp[i];
				sAA += a * a;
				sAB += a * b;
				sAC += a * c;
				sBB += b * b;
				sBC += b * c;
				sCC += c * c;
			}
			count += points;
		}
	}

	return (cda: number, crr: number): number => {
		if (count === 0) {
			return NaN;
		}
		const dc = cda - cda0;
		const dr = crr - crr0;
		const q =
			sAA +
			2 * dc * sAB +
			2 * dr * sAC +
			dc * dc * sBB +
			2 * dc * dr * sBC +
			dr * dr * sCC;
		return Math.sqrt(Math.max(0, q) / count);
	};
}
