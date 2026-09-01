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
