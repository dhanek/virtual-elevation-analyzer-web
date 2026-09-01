/**
 * The CdA / Crr band readout under the Convergence plot: how far each
 * parameter can move from the best fit before the pooled closure error
 * worsens by the band tolerance (5 cm by default).
 *
 * Owned here, on the vdHeader pattern: the markup is an EMPTY container
 * interpolated into all three mode templates, and its content is written by
 * `renderConvergenceBandReadout` from the same pooled surface the plot is
 * drawn from, on every draw. Baking numbers into a template freezes them
 * (see `shell/ve/vdHeader.ts`, defect 1).
 *
 * The offsets are shown separately below and above the optimum rather than
 * as one symmetric ±: the valley is a tilted trough, and the band is wider
 * on one side than the other. When the band runs into the grid edge the
 * line says so — the numbers are then a lower bound on the band's width,
 * not the width.
 */
import type { ClosureBand, ClosureOptimum } from "../../analysis/ClosureSurface";
import { formatBandLabel } from "../../plots/ConvergencePlotBuilders";

/** Container the readout owns outright. Empty in the templates on purpose. */
export const CONVERGENCE_BAND_ID = "convergenceBand";

/** Shown when the surface has no optimum to cut a band around. */
export const CONVERGENCE_BAND_NOT_APPLICABLE = "n/a";

export function convergenceBandMarkup(): string {
	return `<div class="ve-metrics-compact ve-convergence-band" id="${CONVERGENCE_BAND_ID}"></div>`;
}

export interface ConvergenceBandReadoutInput {
	best: ClosureOptimum | null;
	band: ClosureBand | null;
	/** The tolerance to name when there is no band to read it from. */
	toleranceM: number;
}

/** "0.312 (−0.008 / +0.011)" — value, then the offsets below and above it. */
export function formatBandValue(
	value: number,
	low: number,
	high: number,
	digits: number,
): string {
	const below = (value - low).toFixed(digits);
	const above = (high - value).toFixed(digits);
	return `${value.toFixed(digits)} (−${below} / +${above})`;
}

export function renderConvergenceBandReadout(
	input: ConvergenceBandReadoutInput,
): void {
	if (typeof document === "undefined") {
		return;
	}
	const container = document.getElementById(CONVERGENCE_BAND_ID);
	if (!container) {
		return;
	}
	container.replaceChildren();

	const { best, band } = input;
	const label = formatBandLabel(band?.toleranceM ?? input.toleranceM);
	const line = document.createElement("div");
	line.className = "ve-metrics-compact__line";
	line.append(`Within ${label} of best closure: `);

	if (!best || !band) {
		line.append(
			"CdA ",
			span("convergenceBandCda", CONVERGENCE_BAND_NOT_APPLICABLE),
			"Crr ",
			span("convergenceBandCrr", CONVERGENCE_BAND_NOT_APPLICABLE),
		);
		container.append(line);
		return;
	}

	line.append(
		"CdA ",
		span(
			"convergenceBandCda",
			`${formatBandValue(best.cda, band.cdaLow, band.cdaHigh, 3)} m²`,
		),
		"Crr ",
		span(
			"convergenceBandCrr",
			formatBandValue(best.crr, band.crrLow, band.crrHigh, 4),
		),
	);
	container.append(line);

	if (band.touchesEdge) {
		const caveat = document.createElement("div");
		caveat.className = "ve-metrics-compact__line ve-metrics-compact__caveat";
		caveat.textContent =
			"The band reaches the grid edge — these offsets are a lower bound on its width.";
		container.append(caveat);
	}
}

function span(id: string, text: string): HTMLElement {
	const element = document.createElement("span");
	element.id = id;
	element.textContent = text;
	return element;
}
