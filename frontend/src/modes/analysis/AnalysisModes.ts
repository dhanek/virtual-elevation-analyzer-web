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

/**
 * The handler for an id that is already known, without a round trip through the
 * Section 3 mode STRING.
 *
 * The GPS-lap overlay panel is reached two ways — genuine GPS lap splitting, and
 * the "Stacked" lap view of a multi-lap STANDARD selection — and only the first
 * of them is visible in `getGpsAnalysisMode()`. The funnel needs to name the
 * handler for the panel actually on screen; mapping "gpsLap" back onto the
 * string "GPS based lap splitting" just to look it up again would put a second
 * copy of that string in the shell.
 */
export function getAnalysisModeHandlerById(id: AnalysisModeId): AnalysisModeHandler {
    return ANALYSIS_MODES[id];
}

