import { resolveActiveOutAndBackSections, sectionsCoveredByProfiles } from './activeOutAndBackSections';
import { writeSegmentModeResultState } from './segmentSummary';
import type { AnalysisModeHandler, ModeRenderArgs, ModeSegment, PreparedAnalysisSelection } from './types';

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

    /**
     * Two segments per ON-SCREEN section, OUTBOUND THEN INBOUND, from the same
     * {startIdx, endIdx} pairs `prepareSelection` already builds. The order is
     * load-bearing: D-10 mutation (b) swaps them and a section VE assertion
     * must fail.
     *
     * Sections come from `resolveActiveOutAndBackSections`, NOT from the
     * detection list filtered by the checkbox state. The pre-primitive update
     * path looped `currentOutAndBackSections` (`updateOutAndBack.ts:100`); see
     * that resolver for why reading the detection list would be a silent
     * behaviour change.
     */
    getUpdateSegments(appState): ModeSegment[] {
        return resolveActiveOutAndBackSections(appState)
            .flatMap(section => ([
                {
                    key: `s${section.sectionNumber}-out`,
                    label: `Section ${section.sectionNumber} outbound`,
                    range: { startIdx: section.outboundStartIdx, endIdx: section.outboundEndIdx },
                },
                {
                    key: `s${section.sectionNumber}-in`,
                    label: `Section ${section.sectionNumber} inbound`,
                    range: { startIdx: section.inboundStartIdx, endIdx: section.inboundEndIdx },
                },
            ]));
    },

    /**
     * N-1 / D-17a: out-and-back wrote NONE of `currentVEResult`,
     * `currentFilteredData` or `currentWindSource` after the initial analyze,
     * so Store Result and Export CSV persisted analyze-time numbers instead of
     * what was on screen. It now writes the same combined shape as GPS-lap.
     *
     * Note on `r2`: `calculateOutAndBackStats` has no r2 at all, so the
     * aggregate's r2 is the mean of the per-segment `result.r2`. That is a
     * deliberate choice — it is a value the OAB screen never displayed before,
     * and it is now what Store Result persists.
     */
    summarize(appState, profiles, aggregate, inputs) {
        writeSegmentModeResultState(
            appState,
            profiles,
            aggregate,
            inputs,
            // Only sections that actually produced a segment, matching
            // GPS-lap's surviving-profiles semantics.
            sectionsCoveredByProfiles(resolveActiveOutAndBackSections(appState), profiles)
                .map(section => section.sectionNumber),
        );
    },
};
