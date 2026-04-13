import type { AnalysisModeHandler, AnalysisModeId, PreparedAnalysisSelection } from './types';
import { gpsLapMode } from './gpsLapMode';
import { outAndBackMode } from './outAndBackMode';
import { standardMode } from './standardMode';

const ANALYSIS_MODES: Record<AnalysisModeId, AnalysisModeHandler> = {
    standard: standardMode,
    gpsLap: gpsLapMode,
    outAndBack: outAndBackMode,
};

export function getAnalysisModeId(lapDetectionMode: string | null | undefined): AnalysisModeId {
    switch (lapDetectionMode) {
        case 'GPS based lap splitting':
        case 'GPS gate one way':
            return 'gpsLap';
        case 'GPS based out and back':
            return 'outAndBack';
        default:
            return 'standard';
    }
}

export function getAnalysisModeHandler(lapDetectionMode: string | null | undefined): AnalysisModeHandler {
    return ANALYSIS_MODES[getAnalysisModeId(lapDetectionMode)];
}

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
