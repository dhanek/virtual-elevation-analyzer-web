/**
 * The three readouts above the Virtual Distance plot.
 *
 * These spans used to be written in exactly one place ever -- the
 * `renderStandardVe` template, interpolating the analyze-time VE result -- so
 * they were frozen from the moment the tab was built. Moving a trim slider
 * redrew the curve underneath them and left the numbers untouched.
 *
 * They are now written from `computeVirtualDistanceTotals`, i.e. from the same
 * integration that draws the curve, on every VD draw.
 *
 * ## Why a multi-lap selection shows no number
 *
 * Under D-19 Option B each selected lap is fitted and integrated INDEPENDENTLY.
 * There is no single virtual distance for a multi-lap selection:
 *
 * - the VD plot draws ONE curve over the laps concatenated end to end, so it
 *   accumulates across the wall-clock gap between lap N's end and lap N+1's
 *   start, and across the parts of intermediate laps the trim window excludes;
 * - `virtual_distance_air` / `virtual_distance_ground` on the stored result are
 *   ZEROS for multi-lap Standard, precisely because the figure is not defined
 *   (plan 07-02 change-list entry (h)).
 *
 * Displaying the concatenated integral would put a number on screen that is not
 * the distance of anything the rider actually rode, and displaying the stored
 * zeros would show `0.000 km`. Both are false. So for more than one segment the
 * header says so in words instead.
 */
import {
	computeVirtualDistanceTotals,
	type VirtualDistancePlotInput,
	type VirtualDistanceTotals,
} from "../../plots/StandardPlotBuilders";
import type { AppState } from "../../state/AppState";

/** Shown instead of a number when virtual distance is not well defined. */
export const VD_NOT_APPLICABLE = "n/a";

/** Shown in place of the percentage difference for the same reason. */
export const VD_MULTI_SEGMENT_NOTE = "n/a (per-lap, see plot)";

const POSITIVE_CLASS = "ve-metrics-compact__value--positive";
const NEGATIVE_CLASS = "ve-metrics-compact__value--negative";

function setText(id: string, text: string): void {
	const span = document.getElementById(id);
	if (span) span.textContent = text;
}

/**
 * Write the three spans from already-computed totals, or blank them out with an
 * explicit "n/a" when `totals` is null.
 */
export function renderVirtualDistanceHeader(
	totals: VirtualDistanceTotals | null,
): void {
	const diffSpan = document.getElementById("vdDiffValue");

	if (!totals) {
		setText("vdAirValue", VD_NOT_APPLICABLE);
		setText("vdGroundValue", VD_NOT_APPLICABLE);
		setText("vdDiffValue", VD_MULTI_SEGMENT_NOTE);
		diffSpan?.classList.remove(POSITIVE_CLASS, NEGATIVE_CLASS);
		return;
	}

	setText("vdAirValue", `${totals.airKm.toFixed(3)} km`);
	setText("vdGroundValue", `${totals.groundKm.toFixed(3)} km`);

	const positive = totals.differencePercent >= 0;
	setText(
		"vdDiffValue",
		`${positive ? "+" : ""}${totals.differencePercent.toFixed(2)}%`,
	);
	if (diffSpan) {
		diffSpan.classList.toggle(POSITIVE_CLASS, positive);
		diffSpan.classList.toggle(NEGATIVE_CLASS, !positive);
	}
}

/**
 * Recompute the header from the same input the VD figure was built from.
 *
 * `segmentCount` is the number of independently-integrated segments the figure
 * covers: 1 for a single lap, more for a multi-lap selection. Only the
 * single-segment case yields a defined virtual distance -- see the module note.
 */
export function updateVirtualDistanceHeader(
	input: VirtualDistancePlotInput,
	segmentCount: number,
): void {
	renderVirtualDistanceHeader(
		segmentCount === 1 ? computeVirtualDistanceTotals(input) : null,
	);
}

/**
 * Segment count for the two Standard paths that integrate the whole
 * concatenated selection in one pass and so have no per-segment profiles to
 * count: the initial render, and the `compare` branch (D-20, until plan 07-04).
 *
 * An empty selection yields 0, which is correctly NOT 1 and so shows n/a.
 */
export function selectedLapCount(appState: AppState): number {
	return appState.selectedLaps.length;
}
