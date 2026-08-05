/**
 * @vitest-environment jsdom
 *
 * Controls that only mean something under a FIT air-speed channel follow the
 * selected wind source (maintainer ruling, plan 07-03).
 *
 * Two separate things are being guarded here.
 *
 * INERT-BUT-LIVE. Under constant wind the air-speed time offset and the
 * air-speed calibration percent are applied nowhere: both live on the `fit`
 * branch of `resolveWindSeries`, and `calculateConstantApparentWindSeries` never
 * consults them. Measured on the golden fixture, offset 2 -> 30 under constant
 * leaves mean r² at 0.181694 and the VE checksum at 1254.10 — byte-identical,
 * not merely close — and calibration 0% -> 10% likewise. A bound, responsive
 * control that changes nothing and says so nowhere is the defect; hiding it is
 * the fix. (The mirror image already ships: k is inert under fit, and its block
 * is hidden there.)
 *
 * THE ACTIVE-TAB GUARD. This is the genuinely new behaviour and the reason the
 * suite exists. Today a source change REBUILDS the GPS sidebar, and the rebuild
 * resets to the VE tab, so the VD tab can never be active while it disappears.
 * After the migration the panel persists — so a user sitting on VD who switches
 * to constant would be left staring at a panel with no active content at all,
 * because `.ve-tab-content--active` and `[hidden]` are not the same axis. The
 * guard moves them to VE.
 */
import { beforeEach, describe, expect, it } from "vitest";
import { setupTabSwitching } from "../dom/tabs";
import { syncFitWindControlsVisibility } from "./windSourceVisibility";

function panel(): void {
	document.body.innerHTML = `
        <div class="ve-parameter" id="airSpeedCalibrationControls" data-wind-source="fit">
            <input type="range" id="airSpeedCalibrationSlider" />
            <button id="autoAdjustCalibration">Auto Adjust</button>
        </div>
        <div class="ve-tabs">
            <button class="ve-tab-button ve-tab-button--active" data-tab="ve">VE</button>
            <button class="ve-tab-button" data-tab="wind">Wind</button>
            <button class="ve-tab-button" data-tab="power">Power</button>
            <button class="ve-tab-button" data-tab="vd" data-wind-source="fit">VD</button>
        </div>
        <div class="ve-tab-content ve-tab-content--active" id="ve-tab"></div>
        <div class="ve-tab-content" id="wind-tab">
            <div class="ve-parameter" id="airSpeedOffsetControls" data-wind-source="fit">
                <input type="range" id="airSpeedOffsetSlider" />
            </div>
        </div>
        <div class="ve-tab-content" id="power-tab"></div>
        <div class="ve-tab-content" id="vd-tab" data-wind-source="fit"></div>
    `;
}

function hidden(id: string): boolean {
	const el = document.getElementById(id);
	if (!el) throw new Error(`#${id} is not in the DOM`);
	// `hidden` is `boolean | "until-found"` in the current DOM lib.
	return el.hidden === true;
}

function vdButton(): HTMLElement {
	return document.querySelector<HTMLElement>('.ve-tab-button[data-tab="vd"]')!;
}

function activeTabId(): string | null {
	return document.querySelector(".ve-tab-content--active")?.id ?? null;
}

function activeButtonTab(): string | null {
	return (
		document
			.querySelector(".ve-tab-button--active")
			?.getAttribute("data-tab") ?? null
	);
}

beforeEach(() => {
	panel();
});

describe("FIT-only controls under constant wind", () => {
	it("hides the offset block, the calibration block and the VD tab", () => {
		syncFitWindControlsVisibility("constant");

		expect(hidden("airSpeedOffsetControls")).toBe(true);
		expect(hidden("airSpeedCalibrationControls")).toBe(true);
		expect(hidden("vd-tab")).toBe(true);
		expect(vdButton().hidden === true).toBe(true);
	});

	it.each(["fit", "compare"])("shows all of them again under %s", (source) => {
		syncFitWindControlsVisibility("constant");
		syncFitWindControlsVisibility(source);

		expect(hidden("airSpeedOffsetControls")).toBe(false);
		expect(hidden("airSpeedCalibrationControls")).toBe(false);
		expect(hidden("vd-tab")).toBe(false);
		expect(vdButton().hidden === true).toBe(false);
	});

	it("leaves controls that carry no source attribute alone", () => {
		const power = document.getElementById("power-tab")!;
		syncFitWindControlsVisibility("constant");
		// Standard keeps its VD tab under constant — it is not tagged — so the
		// sync must touch only what the template opted in.
		expect(power.hidden === true).toBe(false);
	});
});

describe("the active-tab guard", () => {
	it("moves a user sitting on VD back to VE when VD is hidden", () => {
		setupTabSwitching({});
		document
			.querySelector<HTMLElement>('.ve-tab-button[data-tab="vd"]')!
			.click();
		expect(activeTabId()).toBe("vd-tab");

		syncFitWindControlsVisibility("constant");

		expect(activeTabId()).toBe("ve-tab");
		expect(activeButtonTab()).toBe("ve");
		// And the pane they were on is genuinely gone, not merely deactivated.
		expect(hidden("vd-tab")).toBe(true);
	});

	it("leaves a visible active tab where it is", () => {
		setupTabSwitching({});
		document
			.querySelector<HTMLElement>('.ve-tab-button[data-tab="power"]')!
			.click();

		syncFitWindControlsVisibility("constant");

		expect(activeTabId()).toBe("power-tab");
		expect(activeButtonTab()).toBe("power");
	});

	it("does not strand the user when VD is re-shown", () => {
		setupTabSwitching({});
		document
			.querySelector<HTMLElement>('.ve-tab-button[data-tab="vd"]')!
			.click();
		syncFitWindControlsVisibility("constant");
		syncFitWindControlsVisibility("fit");

		// It does not jump back to VD — that would be a surprise — but VD is
		// reachable again by clicking it.
		expect(activeTabId()).toBe("ve-tab");
		document
			.querySelector<HTMLElement>('.ve-tab-button[data-tab="vd"]')!
			.click();
		expect(activeTabId()).toBe("vd-tab");
	});
});
