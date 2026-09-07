/**
 * Shared multi-segment color palette and interpolation helpers.
 *
 * Used by both GPS-lap and out-and-back shell modules.
 */

export const MULTI_SEGMENT_COLORS = [
    '#4363d8',
    '#e6194b',
    '#3cb44b',
    '#f58231',
    '#911eb4',
    '#46f0f0',
    '#f032e6',
    '#bcf60c',
];

export function getMultiSegmentColor(index: number): string {
    return MULTI_SEGMENT_COLORS[index % MULTI_SEGMENT_COLORS.length];
}

/**
 * The same interpolation as `interpolateElevation`, for an ASCENDING reference,
 * in O(log n) instead of O(n).
 *
 * WHY A SECOND FUNCTION RATHER THAN A FASTER FIRST ONE. `interpolateElevation`
 * is handed a DESCENDING array by `calculateOutAndBackMeanElevation`'s
 * mirrored-inbound branch, where its `targetDist <= distances[0]` guard fires
 * against the array's MAXIMUM and it returns `elevations[0]` for every target.
 * That is pinned by a test and is a numbers question of its own; making the
 * shared function order-aware would change the mean-elevation profile RMSE is
 * measured against, inside a change that set out to make it faster. So the fast
 * path takes the precondition it can actually meet, and the old function keeps
 * every one of its callers and every one of its quirks.
 *
 * PRECONDITION: `distances` is sorted ascending. Callers pass
 * `meanElevation.distances`, which `calculateOutAndBackMeanElevation` builds as
 * a uniform ramp. Nothing here validates it — an O(n) check per call would give
 * back exactly what the binary search buys.
 *
 * The search is a LOWER BOUND, and that is what makes it equivalent rather than
 * merely close: the linear scan returns the FIRST bracket whose ends straddle
 * the target, so on repeated distances it takes the earliest one. Picking the
 * last `j` with `distances[j] <= target` instead would differ there.
 */
export function interpolateAscending(targetDist: number, distances: number[], elevations: number[]): number {
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
export function interpolateElevation(targetDist: number, distances: number[], elevations: number[]): number {
    if (distances.length === 0) return NaN;
    if (targetDist <= distances[0]) return elevations[0];
    if (targetDist >= distances[distances.length - 1]) return elevations[elevations.length - 1];

    for (let j = 0; j < distances.length - 1; j++) {
        if (distances[j] <= targetDist && distances[j + 1] >= targetDist) {
            const t = (targetDist - distances[j]) / (distances[j + 1] - distances[j]);
            return elevations[j] + t * (elevations[j + 1] - elevations[j]);
        }
    }
    return NaN;
}
