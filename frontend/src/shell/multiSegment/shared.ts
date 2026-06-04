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
