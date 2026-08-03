import type { AnalysisModeHandler, AnalysisModeId } from './types';
import { gpsLapMode } from './gpsLapMode';
import { outAndBackMode } from './outAndBackMode';
import { standardMode } from './standardMode';

// Re-exported from its own module so `standardMode` can import it without
// closing an import cycle through this file. See `selectionIndices.ts`.
export { collectSelectionIndices } from './selectionIndices';

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

