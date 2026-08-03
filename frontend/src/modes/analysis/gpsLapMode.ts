import { resolveActiveGpsLapRanges, resolveGpsLapNumber } from './activeGpsLapRanges';
import { writeSegmentModeResultState } from './segmentSummary';
import type { AppState, LapIndexRange } from '../../state/AppState';
import type { AnalysisModeHandler, ModeRenderArgs, ModeSegment, PreparedAnalysisSelection } from './types';

const EMPTY_SELECTION_MESSAGE = 'Please select laps and set parameters first.';

/** Overlay number, else the detected lap number for the range, else the ordinal. */
function gpsLapNumberAt(appState: AppState, range: LapIndexRange, index: number): number {
    return appState.currentOverlayLapNumbers?.[index]
        ?? resolveGpsLapNumber(appState, range, index + 1);
}

export const gpsLapMode: AnalysisModeHandler = {
    id: 'gpsLap',

    getSelectedItems(appState) {
        return appState.gpsSelectedLaps;
    },

    validate(appState) {
        if (appState.gpsDetectedLaps.length === 0) {
            return 'Please set a GPS gate to detect laps first.';
        }
        return null;
    },

    prepareSelection(appState): PreparedAnalysisSelection {
        const selectedItems = appState.gpsSelectedLaps;
        const selectedEntries = appState.gpsDetectedLaps.filter(lap => selectedItems.includes(lap.lapNumber));
        const indexRanges = selectedEntries.map(lap => ({
            startIdx: lap.startIdx,
            endIdx: lap.endIdx,
        }));

        return {
            mode: 'gpsLap',
            selectedItems,
            selectedEntries,
            indexRanges,
            timeRanges: null,
            outAndBackSections: null,
            emptySelectionMessage: EMPTY_SELECTION_MESSAGE,
        };
    },

    syncState(appState, selection) {
        appState.isGpsLapModeActive = true;
        appState.currentGpsLapIndexRanges = selection.indexRanges;
        // Labels come from GPS-detected lap numbers; clear any stale overlay
        // numbers left by a prior standard "Stacked" toggle.
        appState.currentOverlayLapNumbers = null;
    },

    render(args: ModeRenderArgs) {
        if (!args.selection.indexRanges) {
            throw new Error('GPS lap mode requires index ranges');
        }

        return args.callbacks.gpsLap({
            lapIndexRanges: args.selection.indexRanges,
            fitData: args.fitData,
            params: args.params,
            defaultAirSpeedOffset: args.defaultAirSpeedOffset,
        });
    },

    /**
     * Uses the ranges of the overlay currently on screen, NOT `gpsDetectedLaps`.
     * The stacked-from-standard overlay leaves the detected-lap arrays empty and
     * stashes its ranges on `currentGpsLapIndexRanges`; reading the detected laps
     * here would silently break it (07-RESEARCH.md Priority 5, item 5).
     *
     * Labels come from the stacked-from-standard overlay numbers when present,
     * otherwise from the DETECTED lap number for that range (`resolveGpsLapNumber`),
     * with the ordinal only as a last resort. That ordering reproduces
     * `updateGpsLap.ts:85-87` exactly; using the ordinal directly would mislabel
     * any selection that is not laps 1..N and would corrupt `currentAnalyzedLaps`.
     */
    getUpdateSegments(appState): ModeSegment[] {
        return resolveActiveGpsLapRanges(appState).map((range, i) => ({
            key: `gpsLap-${i}`,
            label: `Lap ${gpsLapNumberAt(appState, range, i)}`,
            range,
        }));
    },

    /** Reproduces the synthesis at `updateGpsLap.ts:205-250` exactly. */
    summarize(appState, profiles, aggregate, inputs) {
        writeSegmentModeResultState(
            appState,
            profiles,
            aggregate,
            inputs,
            // The REAL lap numbers of the SURVIVING profiles, matching
            // `updateGpsLap.ts:250`.
            profiles.map((profile, i) => gpsLapNumberAt(appState, profile.segment.range, i)),
        );
    },
};
