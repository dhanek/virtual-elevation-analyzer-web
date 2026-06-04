import type { AnalysisModeHandler, ModeRenderArgs, PreparedAnalysisSelection } from './types';

const EMPTY_SELECTION_MESSAGE = 'Please select sections and set parameters first.';

export const outAndBackMode: AnalysisModeHandler = {
    id: 'outAndBack',

    getSelectedItems(appState) {
        return appState.outAndBackSelectedSections;
    },

    validate(appState) {
        if (appState.outAndBackSections.length === 0) {
            return 'Please set both GPS gates to detect sections first.';
        }
        return null;
    },

    prepareSelection(appState): PreparedAnalysisSelection {
        const selectedItems = appState.outAndBackSelectedSections;
        const selectedEntries = appState.outAndBackSections.filter(section => selectedItems.includes(section.sectionNumber));
        const indexRanges = selectedEntries.flatMap(section => ([
            { startIdx: section.outboundStartIdx, endIdx: section.outboundEndIdx },
            { startIdx: section.inboundStartIdx, endIdx: section.inboundEndIdx },
        ]));

        return {
            mode: 'outAndBack',
            selectedItems,
            selectedEntries,
            indexRanges,
            timeRanges: null,
            outAndBackSections: selectedEntries,
            emptySelectionMessage: EMPTY_SELECTION_MESSAGE,
        };
    },

    syncState(appState) {
        appState.isGpsLapModeActive = false;
        appState.currentGpsLapIndexRanges = null;
        appState.currentOverlayLapNumbers = null;
    },

    render(args: ModeRenderArgs) {
        if (!args.selection.outAndBackSections) {
            throw new Error('Out-and-back mode requires selected sections');
        }

        return args.callbacks.outAndBack({
            sections: args.selection.outAndBackSections,
            fitData: args.fitData,
            params: args.params,
            defaultAirSpeedOffset: args.defaultAirSpeedOffset,
        });
    },
};
