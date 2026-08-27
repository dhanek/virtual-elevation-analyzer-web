import { resolveActiveGpsLapRanges, resolveGpsLapNumber } from './activeGpsLapRanges';
import { writeSegmentModeResultState } from './segmentSummary';
import type { AppState, LapIndexRange } from '../../state/AppState';
import type { AnalysisModeHandler, ModeRenderArgs, ModeSegment, PreparedAnalysisSelection, SegmentVeProfile } from './types';

const EMPTY_SELECTION_MESSAGE = 'Please select laps and set parameters first.';

/**
 * Overlay number, else the detected lap number for the range, else the ordinal.
 *
 * `index` MUST be the RANGE ordinal — the position in
 * `resolveActiveGpsLapRanges(appState)` — because that is the array
 * `currentOverlayLapNumbers` is aligned to (`AppState.ts:169`). Call this only
 * where that ordinal is in hand; everywhere downstream reads the resolved number
 * off `ModeSegment.itemNumber` instead.
 */
function gpsLapNumberAt(appState: AppState, range: LapIndexRange, index: number): number {
    return appState.currentOverlayLapNumbers?.[index]
        ?? resolveGpsLapNumber(appState, range, index + 1);
}

/**
 * The lap number of a SURVIVING profile.
 *
 * Reads the number `getUpdateSegments` resolved while the range ordinal was
 * still correct. The fallback matches the profile's range back against the
 * detected laps — never against `currentOverlayLapNumbers` by profile ordinal,
 * which is precisely the mismatch this exists to remove.
 */
export function gpsLapNumberForProfile(appState: AppState, profile: SegmentVeProfile, profileIndex: number): number {
    return profile.segment.itemNumber
        ?? resolveGpsLapNumber(appState, profile.segment.range, profileIndex + 1);
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
        return resolveActiveGpsLapRanges(appState).map((range, i) => {
            // `i` is the RANGE ordinal, which is the only ordinal
            // `currentOverlayLapNumbers` is aligned to. Resolve here, once, and
            // carry the answer on the segment — see `ModeSegment.itemNumber`.
            const itemNumber = gpsLapNumberAt(appState, range, i);
            return {
                key: `gpsLap-${i}`,
                label: `Lap ${itemNumber}`,
                itemNumber,
                range,
            };
        });
    },

    /** Reproduces the synthesis at `updateGpsLap.ts:205-250` exactly. */
    summarize(appState, profiles, aggregate, inputs) {
        writeSegmentModeResultState(
            appState,
            profiles,
            aggregate,
            inputs,
            // The REAL lap numbers of the SURVIVING profiles, matching
            // `updateGpsLap.ts:250`. Read off the segment, NOT re-derived from
            // the profile ordinal: the primitive and the trim mapping both drop
            // segments, so profile ordinal != range ordinal as soon as one lap
            // falls out, and `currentAnalyzedLaps` is the key Store Result and
            // the saved trim/CdA/Crr settings live under.
            profiles.map((profile, i) => gpsLapNumberForProfile(appState, profile, i)),
        );
    },
};
