/**
 * @vitest-environment jsdom
 *
 * ONE SETTING, FOUR CONTROLS (maintainer ruling 2026-08-31).
 *
 * The switch is rendered under the x-axis of each of Standard's four tab panes,
 * which is what "at the axis, not in the sidebar" means when there are four
 * plots. What makes those four copies one control rather than four is this
 * module: they all read and write the same state, and clicking any of them
 * repaints the tab the user is looking at while the other three catch up on
 * activation.
 */
import { beforeEach, describe, expect, it } from "vitest";
import {
	bindPlotXAxisToggle,
	getPlotXAxis,
	plotXAxisToggleMarkup,
	resetPlotXAxisForNewPanel,
	syncPlotXAxisAvailability,
} from "./plotXAxisToggle";
import { setTabRenderMap } from "../dom/tabs";

const rendered: string[] = [];

function paintPanel(): void {
	document.body.innerHTML = `
        <button class="ve-tab-button ve-tab-button--active" data-tab="ve"></button>
        <button class="ve-tab-button" data-tab="wind"></button>
        <div class="ve-tab-content ve-tab-content--active" id="ve-tab">
            <div id="vePlot"></div>
            ${plotXAxisToggleMarkup()}
        </div>
        <div class="ve-tab-content" id="wind-tab">
            <div id="windSpeedPlot"></div>
            ${plotXAxisToggleMarkup()}
        </div>
    `;
	bindPlotXAxisToggle();
}

function groups(): HTMLElement[] {
	return Array.from(document.querySelectorAll<HTMLElement>(".plot-x-axis-toggle"));
}

function buttons(axis: "time" | "distance"): HTMLButtonElement[] {
	return Array.from(
		document.querySelectorAll<HTMLButtonElement>(
			`.plot-x-axis-toggle__btn[data-axis="${axis}"]`,
		),
	);
}

function activeAxes(): string[] {
	return Array.from(
		document.querySelectorAll<HTMLButtonElement>(
			".plot-x-axis-toggle__btn--active",
		),
	).map(button => button.dataset.axis!);
}

describe("the Standard time/distance x-axis toggle", () => {
	beforeEach(() => {
		rendered.length = 0;
		resetPlotXAxisForNewPanel();
		setTabRenderMap({
			ve: () => rendered.push("ve"),
			wind: () => rendered.push("wind"),
		});
		paintPanel();
	});

	it("starts on time", () => {
		expect(getPlotXAxis()).toBe("time");
	});

	it("stays hidden until a draw reports a usable distance channel", () => {
		// PRESENCE, NOT VISIBILITY: the markup is emitted before any series
		// exists, so it must be in the DOM at bind time and merely hidden --
		// gating the markup itself would leave it unbound for the panel's life.
		expect(groups()).toHaveLength(2);
		expect(groups().every(group => group.hidden)).toBe(true);

		syncPlotXAxisAvailability(true);

		expect(groups().every(group => group.hidden)).toBe(false);
	});

	it("refuses to switch to distance while distance is unavailable", () => {
		buttons("distance")[0].click();

		expect(getPlotXAxis()).toBe("time");
		expect(rendered).toEqual([]);
	});

	it("switches every copy from one click, not just the one clicked", () => {
		syncPlotXAxisAvailability(true);

		// Clicked on the WIND tab's copy.
		buttons("distance")[1].click();

		expect(getPlotXAxis()).toBe("distance");
		// Both copies light Distance -- this is the "one setting" half.
		expect(activeAxes()).toEqual(["distance", "distance"]);
	});

	it("repaints the ACTIVE tab, and leaves the others to the render map", () => {
		syncPlotXAxisAvailability(true);
		rendered.length = 0;

		// VE is the active pane; the click lands on the wind pane's copy.
		buttons("distance")[1].click();

		// Only VE is repainted. Wind redraws when it is activated, which is
		// already how the tab render map works (D-14).
		expect(rendered).toEqual(["ve"]);
	});

	it("does nothing when the axis clicked is the one already set", () => {
		syncPlotXAxisAvailability(true);
		rendered.length = 0;

		buttons("time")[0].click();

		expect(rendered).toEqual([]);
	});

	it("falls back to time when distance stops being available", () => {
		syncPlotXAxisAvailability(true);
		buttons("distance")[0].click();
		expect(getPlotXAxis()).toBe("distance");

		// A new selection with no distance channel. The panel must not be left
		// showing a distance axis it cannot compute.
		syncPlotXAxisAvailability(false);

		expect(getPlotXAxis()).toBe("time");
		expect(groups().every(group => group.hidden)).toBe(true);
	});

	it("returns to time when the panel is rebuilt", () => {
		// `initializeVEAnalysis` paints its first pass from the TIME context --
		// the cumulative distance series is a property of the stitched profiles,
		// which do not exist yet -- so a setting carried over would light the
		// Distance button over a plot drawn against time.
		syncPlotXAxisAvailability(true);
		buttons("distance")[0].click();

		resetPlotXAxisForNewPanel();

		expect(getPlotXAxis()).toBe("time");
	});

	it("does not stack handlers when bound again on a reused panel", () => {
		syncPlotXAxisAvailability(true);
		bindPlotXAxisToggle();
		bindPlotXAxisToggle();
		rendered.length = 0;

		buttons("distance")[0].click();

		expect(rendered).toEqual(["ve"]);
	});

	it("marks the setting for assistive tech, not just visually", () => {
		syncPlotXAxisAvailability(true);

		expect(buttons("time")[0].getAttribute("aria-pressed")).toBe("true");
		expect(buttons("distance")[0].getAttribute("aria-pressed")).toBe("false");

		buttons("distance")[0].click();

		expect(buttons("time")[0].getAttribute("aria-pressed")).toBe("false");
		expect(buttons("distance")[0].getAttribute("aria-pressed")).toBe("true");
	});
});
