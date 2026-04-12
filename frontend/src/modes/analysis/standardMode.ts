import type { AnalysisModeHandler, ModeRenderArgs, PreparedAnalysisSelection } from './types';

const EMPTY_SELECTION_MESSAGE = 'Please select laps and set parameters first.';

export const standardMode: AnalysisModeHandler = {
    id: 'standard',

    getSelectedItems(appState) {
        return appState.selectedLaps;
    },

    validate() {
        return null;
    },

    prepareSelection(appState): PreparedAnalysisSelection {
        const selectedItems = appState.selectedLaps;
        const selectedEntries = selectedItems
            .map(lapNumber => appState.currentLaps[lapNumber - 1])
            .filter(Boolean);

        return {
            mode: 'standard',
            selectedItems,
            selectedEntries,
            indexRanges: null,
            timeRanges: selectedEntries.map(lap => ({
                start: lap.start_time,
                end: lap.end_time,
            })),
            outAndBackSections: null,
            emptySelectionMessage: EMPTY_SELECTION_MESSAGE,
        };
    },

    syncState(appState) {
        appState.isGpsLapModeActive = false;
        appState.currentGpsLapIndexRanges = null;
    },

    render(args: ModeRenderArgs) {
        return args.callbacks.standard({
            initialResult: args.initialResult,
            analyzedLaps: args.selection.selectedItems,
            ...args.filteredData,
            defaultAirSpeedOffset: args.defaultAirSpeedOffset,
        });
    },
};
