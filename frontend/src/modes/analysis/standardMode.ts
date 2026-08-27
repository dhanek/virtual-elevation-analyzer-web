import { getNormalizedActivityArrays } from "../../analysis/ActivityArrayCache";
import type { AppState, LapIndexRange } from "../../state/AppState";
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

/**
 * The shared body of `prepareSelection` and `prepareUpdateSelection`. The two
 * differ ONLY in which lap list they resolve, so keeping one builder is what
 * stops the analyze and update paths drifting into different shapes.
 */
function selectionForLaps(
	appState: AppState,
	lapNumbers: number[],
): PreparedAnalysisSelection {
	const selectedEntries = lapNumbers
		.map((lapNumber) => appState.currentLaps[lapNumber - 1])
		.filter(Boolean);

	return {
		mode: "standard",
		selectedItems: lapNumbers,
		selectedEntries,
		indexRanges: null,
		timeRanges: selectedEntries.map((lap) => ({
			start: lap.start_time,
			end: lap.end_time,
		})),
		outAndBackSections: null,
		emptySelectionMessage: EMPTY_SELECTION_MESSAGE,
	};
}

/**
 * Which lap list the UPDATE path belongs to. Falls back to `selectedLaps`
 * before the first analyze, when `currentAnalyzedLaps` is still empty and there
 * is no rendered panel for it to contradict.
 */
function updateLaps(appState: AppState): number[] {
	const analyzed = appState.currentAnalyzedLaps;
	return analyzed.length > 0 ? analyzed : appState.selectedLaps;
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
		// THE LIVE CHECKBOXES, and correctly so: this is the analyze path, where
		// `selectedLaps` is precisely what the user just asked to analyze and
		// `currentAnalyzedLaps` still holds the PREVIOUS run. The update path
		// wants the opposite and uses `prepareUpdateSelection` below.
		return selectionForLaps(appState, appState.selectedLaps);
	},

	/**
	 * THE ANALYZED SELECTION — what the panel on screen actually belongs to.
	 *
	 * The update path used to go through `prepareSelection` too, and so resolved
	 * segments from the LIVE checkbox state while the trim sliders,
	 * `currentAnalyzedLaps` and the whole rendered panel still belonged to the
	 * previously analyzed selection. Tick a different lap without pressing
	 * Analyze, nudge CdA, and the primitive computed segments for the NEW laps,
	 * mapped a trim window sized for the OLD selection onto them, and let
	 * `summarize` overwrite `currentVEResult` / `currentFilteredData` for a
	 * selection the user never analyzed (WR-06).
	 *
	 * `veSelectionGuard.veViewMatchesSelection` exists because these two
	 * diverge, but gating the funnel on it would have silently no-opped the
	 * user's slider drag. Resolving from the analyzed laps instead keeps the
	 * controls live and makes the panel self-consistent: a checkbox change now
	 * does nothing until Analyze is pressed, which is the honest model.
	 *
	 * Falls back to `selectedLaps` before the first analyze, when
	 * `currentAnalyzedLaps` is still empty and there is no panel to contradict.
	 */
	prepareUpdateSelection(appState): PreparedAnalysisSelection {
		return selectionForLaps(appState, updateLaps(appState));
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
		// The UPDATE path: the analyzed laps, not the live checkboxes (WR-06).
		const selection = selectionForLaps(appState, updateLaps(appState));
		const timeRanges = selection.timeRanges ?? [];

		// ALIGNED with `timeRanges`, which is derived from the FILTERED entries.
		// `selection.selectedItems` is the RAW `appState.selectedLaps`, so a
		// selected lap number with no entry in `currentLaps` (a stale selection
		// after a file reload, or an off-by-one lap number) makes the two lists
		// different lengths and shifts every later lap's number by one — into the
		// segment `key`, the `label`, the VD header rows and the stored virtual
		// distances. Apply the same filter here rather than indexing the
		// unfiltered list by a filtered slot.
		const alignedLapNumbers = selection.selectedItems.filter((lapNumber) =>
			Boolean(appState.currentLaps[lapNumber - 1]),
		);

		const segments: ModeSegment[] = [];
		timeRanges.forEach((timeRange, lapSlot) => {
			const lapNumber = alignedLapNumbers[lapSlot] ?? lapSlot + 1;
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
