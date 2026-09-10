/**
 * Shared multi-segment color palette and interpolation helpers.
 *
 * Used by both GPS-lap and out-and-back shell modules.
 */

const MULTI_SEGMENT_COLORS = [
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
 * Linear interpolation of an elevation series onto a target distance, in
 * O(log n).
 *
 * PRECONDITION: `distances` is sorted ascending. NOTHING HERE VALIDATES IT, and
 * an O(n) check per call would give back exactly what the binary search buys —
 * so the precondition is the caller's, and `shared.test.ts` pins what happens
 * when a caller breaks it: the `targetDist <= distances[0]` guard fires against
 * the array's MAXIMUM and every target gets `elevations[0]`. That is not
 * hypothetical. `calculateOutAndBackMeanElevation`'s mirrored-inbound branch did
 * exactly that for the life of the out-and-back mode, contributing one constant
 * where a curve belonged, until PR #21 corrected it to re-sort before calling.
 *
 * THIS WAS TWO FUNCTIONS until that caller was fixed. The other was a linear
 * scan kept solely because the descending caller depended on its behaviour;
 * with the caller corrected it had one call site left, passing an ascending
 * array, and folding it in here made the last O(n) scan in the out-and-back
 * aggregation O(log n).
 *
 * The search is a LOWER BOUND, and that is what made the fold behaviour-
 * preserving rather than merely close: the linear scan returned the FIRST
 * bracket whose ends straddled the target, so on repeated distances — a stalled
 * ride records two samples at one distance — it took the earliest one. Picking
 * the last `j` with `distances[j] <= target` would differ there.
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
