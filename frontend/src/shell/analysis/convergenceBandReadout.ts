/**
 * The CdA / Crr band readout under the Convergence plot: how far each
 * parameter can move from the best fit before the pooled closure error
 * worsens by the band tolerance (5 cm by default).
 *
 * Owned here, on the vdHeader pattern: the markup is an EMPTY container
 * interpolated into all three mode templates (via `convergenceTabMarkup`),
 * and its content is written by `renderConvergenceBandReadout` from the same
 * pooled surface the plot is drawn from, on every draw. Baking numbers into
 * a template freezes them (see `shell/ve/vdHeader.ts`, defect 1).
 *
 * The offsets are shown separately below and above the optimum rather than
 * as one symmetric ±: the valley is a tilted trough, and the band is wider
 * on one side than the other. When the band runs into the grid edge the
 * line says so — the numbers are then a lower bound on the band's width,
 * not the width.
 */
import { formatBandLabel, type ClosureBand } from "../../analysis/ClosureSurface";
import { VD_NOT_APPLICABLE, span } from "../ve/vdHeader";

/** Container the readout owns outright. Empty in the templates on purpose. */
export const CONVERGENCE_BAND_ID = "convergenceBand";

export function convergenceBandMarkup(): string {
	return `<div class="ve-metrics-compact ve-convergence-band" id="${CONVERGENCE_BAND_ID}"></div>`;
}

export interface ConvergenceBandReadoutInput {
	/** Null when the surface has no optimum to cut a band around. */
	band: ClosureBand | null;
	/** The tolerance the band was (or would have been) cut at, metres. */
	toleranceM: number;
	/** What the surface measures; names the metric honestly. */
	metric?: "closure" | "profileSpread";
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

	const { band } = input;
	const cdaText = band
		? `${formatBandValue(band.best.cda, band.cdaLow, band.cdaHigh, 3)} m²`
		: VD_NOT_APPLICABLE;
	const crrText = band
		? formatBandValue(band.best.crr, band.crrLow, band.crrHigh, 4)
		: VD_NOT_APPLICABLE;

	const line = document.createElement("div");
	line.className = "ve-metrics-compact__line";
	const metricNoun =
		input.metric === "profileSpread" ? "best profile agreement" : "best closure";
	line.append(
		`Within ${formatBandLabel(input.toleranceM)} of ${metricNoun}: `,
		"CdA ",
		span("convergenceBandCda", cdaText),
		"Crr ",
		span("convergenceBandCrr", crrText),
	);
	container.append(line);

	if (band?.touchesEdge) {
		const caveat = document.createElement("div");
		caveat.className = "ve-metrics-compact__line ve-metrics-compact__caveat";
		caveat.textContent =
			"The band reaches the grid edge — these offsets are a lower bound on its width.";
		container.append(caveat);
	}
}
