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
	// FILTERED ONCE, HERE, so `selectedItems` and `selectedEntries` cannot
	// disagree about how many laps there are (WR-06).
	//
	// `selectedItems` used to be the raw lap-number list while `selectedEntries`
	// dropped the ones with no entry in `currentLaps`. `standardMode.render`
	// hands `selectedItems` straight to `currentAnalyzedLaps`
	// (`renderStandardVe.ts:264`), which is the key `saveLapSettings` /
	// `loadLapSettings` use and the `laps` field Store Result persists — so a
	// stale lap number, e.g. a selection left over from another file, keyed the
	// saved trim/CdA/Crr under a lap set that did not match the segments
	// actually analysed. `getUpdateSegments` re-filtered for its own labels,
	// which fixed the labels and left the stored key wrong.
	const entries = lapNumbers
		.map((lapNumber) => ({
			lapNumber,
			lap: appState.currentLaps[lapNumber - 1],
		}))
		.filter((entry) => Boolean(entry.lap));
	const selectedEntries = entries.map((entry) => entry.lap);

	return {
		mode: "standard",
		selectedItems: entries.map((entry) => entry.lapNumber),
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

		// No re-filter here any more. `selectionForLaps` drops lap numbers with
		// no entry in `currentLaps` at the source (WR-06), so `selectedItems` is
		// already aligned with `timeRanges` — both are built from the same
		// filtered list. This used to re-derive that alignment locally, which
		// fixed the segment labels while leaving the STORED key
		// (`currentAnalyzedLaps`, via `render`) built from the unfiltered list.
		const alignedLapNumbers = selection.selectedItems;

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
					// Set HERE, where the lap number is still known, so `summarize`
					// can report coverage without re-deriving it from the profile
					// ordinal — which is wrong the moment the primitive drops a
					// segment. A part-split lap puts the SAME number on each part;
					// `summarize` dedupes.
					itemNumber: lapNumber,
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
	 *
	 * WHICH LAPS THE NUMBERS COVER is reported on `currentCoveredItems`, the same
	 * field the two segment modes write (WR-01/WR-02). Standard used to narrow
	 * `currentVEResult`, `currentVirtualDistances` and `currentFilteredData` onto
	 * the surviving profiles while saying nothing about which laps those were, so
	 * a stored row could read `laps: [1,2,3]` with an `avgPower` over lap 3 alone
	 * and nothing in the row or the CSV to say so.
	 */
	summarize(appState, profiles, aggregate, inputs) {
		if (profiles.length === 0) {
			return;
		}

		// Deduped, because a lap split into parts by a non-monotonic file
		// contributes one profile per part under the SAME lap number.
		appState.currentCoveredItems = Array.from(
			new Set(
				profiles
					.map((profile) => profile.segment.itemNumber)
					.filter((itemNumber): itemNumber is number => itemNumber !== undefined),
			),
		);

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
