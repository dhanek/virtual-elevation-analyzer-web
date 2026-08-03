/**
 * Resolve a prepared selection to full-activity indices.
 *
 * Relocated out of `AnalysisModes.ts` by plan 07-02 Task 1. `standardMode`
 * needs it for `getUpdateSegments`, and importing it from `AnalysisModes.ts`
 * would close a cycle (`AnalysisModes` -> `standardMode` -> `AnalysisModes`).
 * `AnalysisModes.ts` re-exports it, so every existing importer — including the
 * `vi.mock` in `prepareAnalysisPayload.test.ts` — is untouched.
 */
import type { PreparedAnalysisSelection } from './types';

export function collectSelectionIndices(selection: PreparedAnalysisSelection, allTimestamps: ArrayLike<number>): number[] {
    if (selection.indexRanges) {
        const indices: number[] = [];
        for (const range of selection.indexRanges) {
            for (let i = range.startIdx; i <= range.endIdx && i < allTimestamps.length; i++) {
                indices.push(i);
            }
        }
        return indices;
    }

    if (selection.timeRanges) {
        const indices: number[] = [];
        for (let i = 0; i < allTimestamps.length; i++) {
            const timestamp = allTimestamps[i];
            if (selection.timeRanges.some(range => timestamp >= range.start && timestamp <= range.end)) {
                indices.push(i);
            }
        }
        return indices;
    }

    return [];
}
