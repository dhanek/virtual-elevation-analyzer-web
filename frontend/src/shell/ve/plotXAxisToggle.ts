/**
 * Time ↔ Distance x-axis toggle for the Standard results panel.
 *
 * ONE SETTING, FOUR CONTROLS (maintainer ruling 2026-08-31). The control is
 * rendered under the x-axis of each tab's plot — "at the axis, not in the
 * sidebar", per the original request — but every copy reads and writes the same
 * module state, so flipping it on the Wind tab means VE, Power and VD are
 * already in distance by the time the user gets to them. Four independent
 * settings were the alternative and were rejected: the four plots share one
 * trim window and one selection, and an axis they can disagree about is an axis
 * the reader has to check.
 *
 * PRESENCE, NOT VISIBILITY, is why the markup is emitted unconditionally and
 * `syncPlotXAxisAvailability` hides it afterwards. Whether a distance axis is
 * meaningful is only knowable from the STITCHED series, which does not exist
 * when the template is written; gating the markup on it would leave the control
 * absent at bind time and unbound for the panel's life. That is the N-3 failure
 * mode, and the air-speed offset and wind-height controls took this same route
 * for the same reason.
 *
 * The redraw goes through `activateTab`, deliberately. Only the ACTIVE tab is
 * repainted here; the other three catch up when they are activated, because
 * that is already how the tab render map works (D-14, "the primitive skips
 * inactive tabs"). So this module needs to know nothing about profiles,
 * figures or the primitive — it owns a setting and asks the tab layer to
 * repaint.
 */
import { activateTab, getActiveTabName } from "../dom/tabs";
import type { PlotXAxis } from "../../plots/PlotContext";

/** The one setting. Every rendered copy of the control reflects this. */
let axis: PlotXAxis = "time";

/**
 * Whether a distance axis is meaningful for the loaded selection. Starts false:
 * the control is hidden until a draw has seen a series and said otherwise, so a
 * FIT file with no distance channel never shows a switch that cannot work.
 */
let distanceAvailable = false;

export const PLOT_X_AXIS_TOGGLE_CLASS = "plot-x-axis-toggle";

export function getPlotXAxis(): PlotXAxis {
	return axis;
}

/**
 * Return to time, because the panel this setting described is being replaced.
 *
 * CALL THIS WHERE THE PANEL MARKUP IS REBUILT, alongside
 * `resetTabRenderMapForNewPanel`. `initializeVEAnalysis` paints its first pass
 * from `createPlotContext` — the TIME context — because the cumulative distance
 * series is a property of the stitched profiles and those do not exist yet. A
 * setting carried over from the previous analysis would therefore light the
 * Distance button over a plot drawn against time.
 */
export function resetPlotXAxisForNewPanel(): void {
	axis = "time";
	distanceAvailable = false;
}

/**
 * Record whether the current selection has a usable distance channel, and show
 * or hide every rendered control accordingly.
 *
 * Called from the draw path, which is the first place the stitched series
 * exists. Falls back to time when distance stops being available, so the panel
 * can never be left showing a distance axis it cannot compute.
 */
export function syncPlotXAxisAvailability(available: boolean): void {
	distanceAvailable = available;
	if (!available && axis === "distance") {
		axis = "time";
	}
	syncPlotXAxisControls();
}

/**
 * Markup for one copy of the segmented control, to be interpolated under a
 * plot. Every copy is identical and carries no id, because there are four of
 * them in one document.
 */
export function plotXAxisToggleMarkup(): string {
	return `
        <div class="${PLOT_X_AXIS_TOGGLE_CLASS}" role="group" aria-label="Plot x-axis" hidden>
            <span class="${PLOT_X_AXIS_TOGGLE_CLASS}__label">x-axis:</span>
            <button type="button" class="${PLOT_X_AXIS_TOGGLE_CLASS}__btn" data-axis="time">Time</button>
            <button type="button" class="${PLOT_X_AXIS_TOGGLE_CLASS}__btn" data-axis="distance">Distance</button>
        </div>
    `;
}

/**
 * Bind every rendered copy. Safe to call when none is present (no-op), and
 * idempotent — a copy is bound exactly once, so calling this on every recompute
 * does not stack handlers on buttons the panel is reusing.
 */
const boundButtons = new WeakSet<Element>();

export function bindPlotXAxisToggle(): void {
	document
		.querySelectorAll<HTMLButtonElement>(`.${PLOT_X_AXIS_TOGGLE_CLASS}__btn`)
		.forEach((button) => {
			if (boundButtons.has(button)) return;
			boundButtons.add(button);
			button.addEventListener("click", () => {
				const target = button.dataset.axis as PlotXAxis | undefined;
				if (target && target !== axis) {
					setPlotXAxis(target);
				}
			});
		});
	syncPlotXAxisControls();
}

function setPlotXAxis(target: PlotXAxis): void {
	if (target === "distance" && !distanceAvailable) return;
	axis = target;
	syncPlotXAxisControls();

	// Repaint the tab the user is actually looking at. The other three redraw
	// when activated, which is what the tab render map is for.
	const active = getActiveTabName();
	if (active) {
		activateTab(active);
	}
}

/** Push the one setting onto every rendered copy. */
function syncPlotXAxisControls(): void {
	document
		.querySelectorAll<HTMLElement>(`.${PLOT_X_AXIS_TOGGLE_CLASS}`)
		.forEach((group) => {
			group.hidden = !distanceAvailable;
		});

	document
		.querySelectorAll<HTMLButtonElement>(`.${PLOT_X_AXIS_TOGGLE_CLASS}__btn`)
		.forEach((button) => {
			const isActive = button.dataset.axis === axis;
			button.classList.toggle(`${PLOT_X_AXIS_TOGGLE_CLASS}__btn--active`, isActive);
			button.setAttribute("aria-pressed", isActive ? "true" : "false");
		});
}
