/**
 * Shared multi-segment color palette and interpolation helpers.
 *
 * Used by both GPS-lap and out-and-back shell modules.
 */

export const MULTI_SEGMENT_COLORS = [
	"#4363d8",
	"#e6194b",
	"#3cb44b",
	"#f58231",
	"#911eb4",
	"#46f0f0",
	"#f032e6",
	"#bcf60c",
];

export function getMultiSegmentColor(index: number): string {
	return MULTI_SEGMENT_COLORS[index % MULTI_SEGMENT_COLORS.length];
}

/**
 * The same interpolation as `interpolateElevation`, for an ASCENDING reference,
 * in O(log n) instead of O(n).
 *
 * WHY A SECOND FUNCTION STILL EXISTS. The original reason is GONE: the
 * DESCENDING caller it named — `calculateOutAndBackMeanElevation`'s
 * mirrored-inbound branch, which fired `interpolateElevation`'s
 * `targetDist <= distances[0]` guard against the array's MAXIMUM and got
 * `elevations[0]` for every target — was corrected, and that branch now calls
 * this function on a re-sorted array (`outAndBackPlots.ts:119-134`). What is
 * left is only that `interpolateElevation` remains, order-agnostic in its
 * guards, with a caller of its own. Folding the two together is `TODO.md`'s
 * *Consolidate `interpolateElevation` into `interpolateAscending`* item, not a
 * thing to do here.
 *
 * PRECONDITION: `distances` is sorted ascending. Unchanged, and still
 * unvalidated — an O(n) check per call would give back exactly what the binary
 * search buys. Two shapes of caller meet it now: `meanElevation.distances`,
 * which `calculateOutAndBackMeanElevation` builds as a uniform ramp, and the
 * mirrored-inbound branch's reversed mirror of the RECORDED FIT distance
 * channel, whose ascendingness is inherited from the mirroring rather than
 * constructed here.
 *
 * The search is a LOWER BOUND, and that is what makes it equivalent rather than
 * merely close: the linear scan returns the FIRST bracket whose ends straddle
 * the target, so on repeated distances it takes the earliest one. Picking the
 * last `j` with `distances[j] <= target` instead would differ there.
 */
export function interpolateAscending(
	targetDist: number,
	distances: number[],
	elevations: number[],
): number {
	const n = distances.length;
	if (n === 0) return NaN;
	if (targetDist <= distances[0]) return elevations[0];
	if (targetDist >= distances[n - 1]) return elevations[n - 1];

	// Smallest k in [1, n-1] with distances[k] >= targetDist. The guards above
	// guarantee one exists, so this cannot fall through.
	let lo = 1;
	let hi = n - 1;
	while (lo < hi) {
		const mid = (lo + hi) >> 1;
		if (distances[mid] >= targetDist) hi = mid;
		else lo = mid + 1;
	}

	const j = lo - 1;
	const span = distances[j + 1] - distances[j];
	if (span === 0) return elevations[j];
	const t = (targetDist - distances[j]) / span;
	return elevations[j] + t * (elevations[j + 1] - elevations[j]);
}

/**
 * Linear interpolation helper for elevation lookup at a target distance.
 */
export function interpolateElevation(
	targetDist: number,
	distances: number[],
	elevations: number[],
): number {
	if (distances.length === 0) return NaN;
	if (targetDist <= distances[0]) return elevations[0];
	if (targetDist >= distances[distances.length - 1])
		return elevations[elevations.length - 1];

	for (let j = 0; j < distances.length - 1; j++) {
		if (distances[j] <= targetDist && distances[j + 1] >= targetDist) {
			const t = (targetDist - distances[j]) / (distances[j + 1] - distances[j]);
			return elevations[j] + t * (elevations[j + 1] - elevations[j]);
		}
	}
	return NaN;
}
