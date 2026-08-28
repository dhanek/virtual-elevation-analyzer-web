/**
 * The virtual-distance readouts above the VD plot, for every mode that has one.
 *
 * Two defects live in this file's history and both are worth stating, because
 * the shape of the module follows from them.
 *
 * 1. The three spans used to be written in exactly one place ever -- the
 *    `renderStandardVe` template, interpolating the analyze-time VE result -- so
 *    they were frozen from the moment the tab was built. Moving a trim slider
 *    redrew the curve underneath them and left the numbers untouched. They are
 *    now written from the SAME integration that draws the curve, on every draw.
 *
 * 2. Only Standard ever had the markup at all. The GPS-lap sidebar -- which the
 *    Standard "Stacked" view also reuses -- rendered a bare `#gpsLapVdPlot` with
 *    no header above it, so in stacked mode and in GPS lap splitting mode the
 *    label was missing outright, not merely stale. The markup is therefore owned
 *    here (`virtualDistanceHeaderMarkup`) rather than copied into each template.
 *
 * ## The multi-lap answer: per lap, not one number
 *
 * Under D-19 Option B each selected lap is fitted and integrated INDEPENDENTLY,
 * so a multi-lap selection has N virtual distances and no single one:
 *
 * - the stitched VD plot draws ONE curve over the laps concatenated end to end,
 *   so its endpoint accumulates across the wall-clock gap between lap N's end
 *   and lap N+1's start, and across the parts of intermediate laps the trim
 *   window excludes. It is not the distance of anything the rider rode;
 * - `virtual_distance_air` / `virtual_distance_ground` on the STORED result are
 *   ZEROS for multi-lap Standard for the same reason (plan 07-02 change-list
 *   entry (h)), so reading those would print `0.000 km`.
 *
 * An earlier pass showed `n/a` rather than either falsehood. The maintainer
 * rejected that: the per-lap figures are real, they are what the computation
 * actually produces, and they are what the header now shows -- one row per lap.
 *
 * The concatenated integral survives ONLY as a fallback for the one path that
 * genuinely has no per-segment decomposition: the transient initial paint.
 * `compare` used to be the second such path, but plan 07-04 routed it through
 * the primitive, so it now has per-lap profiles like every other source and gets
 * per-lap rows. The fallback is never shown unlabelled: the row says how many
 * laps it spans and that it includes the gaps between them.
 */
import {
	computeVirtualDistanceWindowTotals,
	type VirtualDistanceTotals,
	type VirtualDistancePlotInput,
} from "../../plots/StandardPlotBuilders";
import type { SegmentSupplementarySeries } from "../../analysis/SegmentSupplementarySeries";
import type { SegmentVirtualDistance } from "../../analysis/VirtualDistance";
import {
	sectionVirtualDistances,
	stackedVirtualDistances,
	standardVirtualDistances,
	type OutAndBackSectionLegs,
} from "../../modes/analysis/segmentVirtualDistance";
import type { SegmentVeProfile } from "../../modes/analysis/types";
import type { AppState } from "../../state/AppState";

/** Container the header owns outright. Empty in the templates on purpose. */
export const VD_HEADER_ID = "vdHeader";

/** Shown when there is nothing at all to integrate (an empty selection). */
export const VD_NOT_APPLICABLE = "n/a";

const POSITIVE_CLASS = "ve-metrics-compact__value--positive";
const NEGATIVE_CLASS = "ve-metrics-compact__value--negative";

/** One independently-integrated segment's virtual distance. */
export interface VirtualDistanceRow {
	/** e.g. "Lap 3". Null for a single-segment selection, which needs no label. */
	label: string | null;
	totals: VirtualDistanceTotals;
}

/**
 * The header container, for interpolation into a mode's VD tab.
 *
 * Deliberately empty: its content is data, written by
 * `renderVirtualDistanceHeader` from the same integration that draws the curve.
 * Baking numbers into the template is defect 1 above.
 */
export function virtualDistanceHeaderMarkup(): string {
	return `<div class="ve-metrics-compact ve-metrics-compact--spaced ve-vd-header" id="${VD_HEADER_ID}"></div>`;
}

function span(id: string | null, text: string, className?: string): HTMLElement {
	const element = document.createElement("span");
	if (id) element.id = id;
	if (className) element.className = className;
	element.textContent = text;
	return element;
}

function formatKm(km: number): string {
	return `${km.toFixed(3)} km`;
}

function formatPercent(value: number): string {
	return `${value >= 0 ? "+" : ""}${value.toFixed(2)}%`;
}

/**
 * One `Air | Ground | Difference` line.
 *
 * `ids` is set only for the single-segment line, which keeps the three span ids
 * the Standard single-lap case has always exposed. Per-lap lines carry a
 * `data-vd-segment` attribute instead -- N elements cannot share one id.
 */
function buildRow(row: VirtualDistanceRow, withIds: boolean): HTMLElement {
	const line = document.createElement("div");
	line.className = "ve-metrics-compact__line";
	if (row.label !== null) {
		line.dataset.vdSegment = row.label;
		line.append(span(null, `${row.label}: `, "ve-metrics-compact__segment"));
	}

	line.append(
		document.createTextNode("VD (Air):"),
		span(withIds ? "vdAirValue" : null, formatKm(row.totals.airKm)),
		document.createTextNode(" | VD (Ground):"),
		span(withIds ? "vdGroundValue" : null, formatKm(row.totals.groundKm)),
		document.createTextNode(" | Difference:"),
	);

	const positive = row.totals.differencePercent >= 0;
	const diff = span(
		withIds ? "vdDiffValue" : null,
		formatPercent(row.totals.differencePercent),
		`ve-metrics-compact__value ${positive ? POSITIVE_CLASS : NEGATIVE_CLASS}`,
	);
	line.append(diff);
	return line;
}

function fillHeader(children: Node[]): void {
	const container = document.getElementById(VD_HEADER_ID);
	if (!container) return;
	container.replaceChildren(...children);
}

/**
 * Write one line per independently-integrated segment.
 *
 * A single segment renders exactly the line Standard has always shown, with the
 * same three span ids and no lap prefix.
 */
export function renderVirtualDistanceHeader(rows: VirtualDistanceRow[]): void {
	if (rows.length === 0) {
		fillHeader([
			document.createTextNode(`VD (Air):${VD_NOT_APPLICABLE} | `),
			document.createTextNode(`VD (Ground):${VD_NOT_APPLICABLE} | `),
			document.createTextNode(`Difference:${VD_NOT_APPLICABLE}`),
		]);
		return;
	}

	if (rows.length === 1) {
		fillHeader([buildRow({ ...rows[0], label: null }, true)]);
		return;
	}

	fillHeader(rows.map((row) => buildRow(row, false)));
}

/**
 * Fallback for the paths with no per-segment decomposition.
 *
 * A single-lap selection is well defined, so it renders as the ordinary line.
 * Anything wider is the concatenated integral, and is labelled as exactly that
 * -- it is not the distance of anything the rider rode (see the module note), so
 * it must never appear as if it were a per-lap figure.
 */
export function renderCombinedVirtualDistanceHeader(
	totals: VirtualDistanceTotals,
	segmentCount: number,
): void {
	if (segmentCount === 1) {
		renderVirtualDistanceHeader([{ label: null, totals }]);
		return;
	}
	if (segmentCount < 1) {
		renderVirtualDistanceHeader([]);
		return;
	}

	const caveat = document.createElement("div");
	caveat.className = "ve-metrics-compact__caveat";
	caveat.textContent = `All ${segmentCount} laps combined, including the gaps between them — not a per-lap distance`;

	fillHeader([caveat, buildRow({ label: null, totals }, true)]);
}

/**
 * Adapt the stored/exported shape to a header row.
 *
 * `renderVirtualDistanceHeader` strips the label from a lone row itself, so a
 * single-segment analysis renders exactly as before whichever side the null
 * comes from.
 */
function toRows(distances: SegmentVirtualDistance[]): VirtualDistanceRow[] {
	return distances.map(({ label, ...totals }) => ({ label, totals }));
}

/**
 * Per-segment rows for the primitive-driven paths, integrated one segment at a
 * time and each over its OWN trim window.
 *
 * Delegates to the function `summarize` uses to build what Store Result and
 * Export CSV persist (change-list entry (h)). Sharing the call, rather than
 * matching two implementations, is what makes "the export agrees with the
 * screen" a property of the code instead of a coincidence.
 */
export function segmentVirtualDistanceRows(
	profiles: SegmentVeProfile[],
	normalized: { timestamps: number[]; velocity: number[] },
): VirtualDistanceRow[] {
	return toRows(standardVirtualDistances(profiles, normalized));
}

/**
 * Per-lap rows for the stacked / GPS-lap plot, read off the SAME cumulative
 * series that plot draws (`SegmentSupplementarySeries.virtualDistance*Km`)
 * rather than re-integrated here.
 *
 * That is the same principle as the Standard path, applied to a different curve:
 * the header must come from whatever produced the picture it sits above, or the
 * two drift the moment either changes.
 */
export function lapVirtualDistanceRows(
	laps: { label: string; metrics: SegmentSupplementarySeries }[],
): VirtualDistanceRow[] {
	return toRows(stackedVirtualDistances(laps));
}

/**
 * Per-SECTION rows for out-and-back: one line per section, combining its
 * outbound and inbound legs.
 *
 * Out-and-back was the third mode with no VD header at all. It was left alone
 * when the other two were fixed because its shape was a genuine question rather
 * than a copy — two legs per section means per-leg would be 2N lines — and the
 * maintainer has now ruled: per-section total, explicitly not per-leg.
 *
 * Same presentation as the other two modes, one labelled line per unit, so the
 * three read consistently; the unit here is the section rather than the lap.
 * See `sectionVirtualDistances` for why combining the legs is well defined where
 * the concatenated multi-lap integral was not.
 */
export function sectionVirtualDistanceRows(
	sections: OutAndBackSectionLegs[],
): VirtualDistanceRow[] {
	return toRows(sectionVirtualDistances(sections));
}

/**
 * Recompute and write the header from the input a whole-selection VD figure was
 * built from. Used by the two paths that integrate in one pass.
 */
export function updateCombinedVirtualDistanceHeader(
	input: VirtualDistancePlotInput,
	segmentCount: number,
): void {
	renderCombinedVirtualDistanceHeader(
		computeVirtualDistanceWindowTotals({
			timestamps: input.timestamps,
			velocity: input.velocity,
			windSpeed: input.windSpeed,
			trimStart: input.context.trimStart,
			trimEnd: input.context.trimEnd,
		}),
		segmentCount,
	);
}

/**
 * Segment count for the two Standard paths that integrate the whole
 * concatenated selection in one pass and so have no per-segment profiles to
 * count: the initial render, and the `compare` branch (D-20, until plan 07-04).
 */
export function selectedLapCount(appState: AppState): number {
	return appState.selectedLaps.length;
}
