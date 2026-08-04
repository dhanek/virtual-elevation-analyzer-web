import { getNormalizedActivityArrays } from "../../analysis/ActivityArrayCache";
import type { LapIndexRange } from "../../state/AppState";
import { collectSelectionIndices } from "./selectionIndices";
import {
	buildCombinedSegmentResult,
	buildFilteredDataFromProfiles,
	resolveRecordedWindSource,
} from "./segmentSummary";
import { standardVirtualDistances } from "./segmentVirtualDistance";
import type {
	AnalysisModeHandler,
	ModeRenderArgs,
	ModeSegment,
	PreparedAnalysisSelection,
} from "./types";

const EMPTY_SELECTION_MESSAGE = "Please select laps and set parameters first.";

/**
 * Fold a sorted list of full-activity indices into contiguous runs.
 *
 * Exported for `modeSegments.test.ts`. A non-contiguous multi-lap selection
 * (e.g. laps 1 and 4) yields one range per run, which under D-19 Option B is
 * one independently-integrated segment per run.
 */
export function indicesToRanges(indices: number[]): LapIndexRange[] {
	if (indices.length === 0) {
		return [];
	}

	const ranges: LapIndexRange[] = [];
	let startIdx = indices[0];
	let previous = indices[0];

	for (let i = 1; i < indices.length; i++) {
		const current = indices[i];
		if (current !== previous + 1) {
			ranges.push({ startIdx, endIdx: previous });
			startIdx = current;
		}
		previous = current;
	}

	ranges.push({ startIdx, endIdx: previous });
	return ranges;
}

export const standardMode: AnalysisModeHandler = {
	id: "standard",

	getSelectedItems(appState) {
		return appState.selectedLaps;
	},

	validate() {
		return null;
	},

	prepareSelection(appState): PreparedAnalysisSelection {
		const selectedItems = appState.selectedLaps;
		const selectedEntries = selectedItems
			.map((lapNumber) => appState.currentLaps[lapNumber - 1])
			.filter(Boolean);

		return {
			mode: "standard",
			selectedItems,
			selectedEntries,
			indexRanges: null,
			timeRanges: selectedEntries.map((lap) => ({
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
		// Default to the stitched view; the "Stacked" toggle re-sets these when
		// the user overlays an ordinary multi-lap selection.
		appState.currentOverlayLapNumbers = null;
	},

	render(args: ModeRenderArgs) {
		return args.callbacks.standard({
			initialResult: args.initialResult,
			analyzedLaps: args.selection.selectedItems,
			selectedIndices: args.selectedIndices,
			...args.filteredData,
			defaultAirSpeedOffset: args.defaultAirSpeedOffset,
		});
	},

	/**
	 * D-19 Option B (maintainer ruling, 2026-08-03): ONE SEGMENT PER SELECTED
	 * LAP, each integrated independently by its own calculator run.
	 *
	 * Read the ruling literally, because the literal wording is what the
	 * maintainer reaffirmed after Option A was put to them and declined:
	 * segmentation is PER SELECTED LAP, not per contiguous run of selected
	 * indices. Two adjacent laps produce TWO segments and therefore two
	 * independent integrations, which is the accepted "VE discontinuity at each
	 * lap boundary" (D-09 entry f). Folding adjacent laps into one run would
	 * quietly suppress exactly the consequence that was accepted, and would make
	 * N in "the mean of N per-lap fits" (entry g) mean something else.
	 *
	 * A consequence worth naming: adjacent laps SHARE their boundary record
	 * (lap i's `end_time` equals lap i+1's `start_time`), so the segment lengths
	 * sum to MORE than the deduplicated selection length — the same convention
	 * the two GPS modes already follow. `standardSegments.ts` documents how the
	 * trim window is mapped across that difference without drifting.
	 *
	 * `trim` is left undefined here. It lives in the DOM sliders, not in
	 * AppState, so the Standard binder supplies it through the primitive's
	 * `segments` override, mapped by `mapTrimToSegments`.
	 */
	getUpdateSegments(appState): ModeSegment[] {
		const fitData = appState.currentFitData;
		if (!fitData) {
			return [];
		}

		const normalized = getNormalizedActivityArrays(fitData);
		const selection = this.prepareSelection(appState);
		const timeRanges = selection.timeRanges ?? [];

		const segments: ModeSegment[] = [];
		timeRanges.forEach((timeRange, lapSlot) => {
			const lapNumber = selection.selectedItems[lapSlot] ?? lapSlot + 1;
			const lapIndices = collectSelectionIndices(
				{ ...selection, indexRanges: null, timeRanges: [timeRange] },
				normalized.timestamps,
			);
			// Normally exactly one range: timestamps are monotonic, so the
			// indices inside a time window are contiguous. The fold is kept so a
			// pathological non-monotonic file yields several honest segments
			// rather than one range silently spanning the gap.
			const ranges = indicesToRanges(lapIndices);
			ranges.forEach((range, part) => {
				segments.push({
					key:
						ranges.length === 1
							? `standard-lap-${lapNumber}`
							: `standard-lap-${lapNumber}-part-${part + 1}`,
					label:
						ranges.length === 1
							? `Lap ${lapNumber}`
							: `Lap ${lapNumber} (part ${part + 1})`,
					range,
				});
			});
		});

		// The stitched output must run in the same order as the analyze-time
		// selection, which `collectSelectionIndices` produces in ascending
		// index order regardless of the order the checkboxes were ticked in.
		return segments.sort((a, b) => a.range.startIdx - b.range.startIdx);
	},

	/**
	 * Standard keeps writing the RAW calculator result, byte-identical to
	 * `bindStandardSliders.ts:305` — except that under Option B there are now N
	 * results rather than one, so the combined shape is used (D-09 entries f
	 * and g). `currentAnalyzedLaps` is deliberately left alone: the binder owns
	 * it today and changing that is plan 07-03's business.
	 *
	 * The per-lap virtual distances are written alongside (change-list entry
	 * (h)). They come from the same call the stitched VD header uses, so a
	 * stored or exported figure cannot disagree with the one on screen; and
	 * because each lap is integrated over its OWN trim window, a lap the trim
	 * window has dropped contributes no entry — the same rule that keeps it out
	 * of the headline mean.
	 */
	summarize(appState, profiles, aggregate, inputs) {
		if (profiles.length === 0) {
			return;
		}

		appState.currentVEResult =
			profiles.length === 1
				? profiles[0].result
				: buildCombinedSegmentResult(profiles, aggregate);
		appState.currentVirtualDistances = standardVirtualDistances(
			profiles,
			inputs.normalized,
		);
		appState.currentFilteredData = buildFilteredDataFromProfiles(
			appState,
			profiles,
		);
		appState.currentWindSource = resolveRecordedWindSource(
			inputs.windSource,
			inputs.wind.selectedWindSource,
		);
	},
};
