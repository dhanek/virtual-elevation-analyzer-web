import { getNormalizedActivityArrays } from "../../analysis/ActivityArrayCache";
import type { LapIndexRange } from "../../state/AppState";
import { collectSelectionIndices } from "./selectionIndices";
import {
	buildCombinedSegmentResult,
	buildFilteredDataFromProfiles,
	resolveRecordedWindSource,
} from "./segmentSummary";
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
	 * Concretely, one segment per CONTIGUOUS RUN of selected full-activity
	 * indices: adjacent selected laps share a boundary record and therefore
	 * form a single run, while a non-contiguous selection (laps 1 and 4) yields
	 * two runs and two independent runs of the integrator.
	 *
	 * `trim` is left undefined here. It lives in the DOM sliders, not in
	 * AppState, so the Standard binder supplies it through the primitive's
	 * `segments` override — and under Option B it must first be MAPPED from the
	 * stitched-output index space onto each segment. See
	 * `bindStandardSliders.ts` for that mapping.
	 */
	getUpdateSegments(appState): ModeSegment[] {
		const fitData = appState.currentFitData;
		if (!fitData) {
			return [];
		}

		const normalized = getNormalizedActivityArrays(fitData);
		const selection = this.prepareSelection(appState);
		const indices = collectSelectionIndices(selection, normalized.timestamps);
		const ranges = indicesToRanges(indices);
		const lapLabel = selection.selectedItems.length
			? `Laps ${selection.selectedItems.join(", ")}`
			: "Selection";

		return ranges.map((range, i) => ({
			key: `standard-${i}`,
			label: ranges.length === 1 ? lapLabel : `${lapLabel} (part ${i + 1})`,
			range,
		}));
	},

	/**
	 * Standard keeps writing the RAW calculator result, byte-identical to
	 * `bindStandardSliders.ts:305` — except that under Option B there are now N
	 * results rather than one, so the combined shape is used (D-09 entries f
	 * and g). `currentAnalyzedLaps` is deliberately left alone: the binder owns
	 * it today and changing that is plan 07-03's business.
	 */
	summarize(appState, profiles, aggregate, inputs) {
		if (profiles.length === 0) {
			return;
		}

		appState.currentVEResult =
			profiles.length === 1
				? profiles[0].result
				: buildCombinedSegmentResult(profiles, aggregate);
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
