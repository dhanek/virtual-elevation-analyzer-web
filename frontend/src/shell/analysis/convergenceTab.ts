/**
 * The Convergence tab's markup, shared by all three mode templates.
 *
 * The tab is mode-independent (see `convergenceView.ts`): one plot container
 * and one band readout, drawn by one renderer. Owning the block here means
 * a template cannot drift from the other two by missing an addition — the
 * ids the renderer looks up are defined once and interpolated, never typed.
 */
import { convergenceBandMarkup } from "./convergenceBandReadout";

/** The Plotly container `renderConvergenceView` draws into. */
export const CONVERGENCE_PLOT_ID = "convergencePlot";

export function convergenceTabMarkup(): string {
	return `<div class="ve-tab-content" id="convergence-tab">
    <div class="ve-plot-container"><div id="${CONVERGENCE_PLOT_ID}" class="ve-plot-container__plot ve-plot-container__plot--square"></div></div>
    ${convergenceBandMarkup()}
</div>`;
}
