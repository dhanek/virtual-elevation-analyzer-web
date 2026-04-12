import type { AnalysisModeHandler, ModeRenderArgs, PreparedAnalysisSelection } from './types';

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
};
