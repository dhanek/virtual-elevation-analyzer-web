import { resolveActiveGpsLapRanges } from './activeGpsLapRanges';
import { writeSegmentModeResultState } from './segmentSummary';
import type { AnalysisModeHandler, ModeRenderArgs, ModeSegment, PreparedAnalysisSelection } from './types';

const EMPTY_SELECTION_MESSAGE = 'Please select laps and set parameters first.';

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
     * Labels: `getGpsLapNumberForRange` lives in `shell/gpsLap/renderGpsLap.ts`
     * and cannot be imported from this DOM-free layer, so the fallback label is
     * the ordinal and the shell adapter relabels from the real lap number.
     */
    getUpdateSegments(appState): ModeSegment[] {
        return resolveActiveGpsLapRanges(appState).map((range, i) => {
            const lapNumber = appState.currentOverlayLapNumbers?.[i] ?? i + 1;
            return {
                key: `gpsLap-${i}`,
                label: `Lap ${lapNumber}`,
                range,
            };
        });
    },

    /** Reproduces the synthesis at `updateGpsLap.ts:205-247` exactly. */
    summarize(appState, profiles, aggregate, inputs) {
        writeSegmentModeResultState(
            appState,
            profiles,
            aggregate,
            inputs,
            profiles.map((_profile, i) => appState.currentOverlayLapNumbers?.[i] ?? i + 1),
        );
    },
};
