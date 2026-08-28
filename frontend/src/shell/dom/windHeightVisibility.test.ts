// @vitest-environment jsdom
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { beforeEach, describe, expect, test, vi } from "vitest";
import { bindWindSourceRadios } from "./windSource";
import {
	windHeightAppliesTo,
	windHeightControlsMarkup,
} from "../ve/windHeightControls";
import { resolveWindHeightFactor } from "../../analysis/WindHeightTransfer";
import type { AnalysisParameters } from "../../components/AnalysisParameters";
import { DEFAULT_PARAMETERS } from "../../components/AnalysisParameters";

/**
 * The k slider must follow the selected wind source: it transfers a 10 m
 * reference wind down to the rider, so it has a job under "constant" and under
 * "compare" (which resolves a constant-wind branch alongside the FIT branch)
 * and no job at all under "fit", where the recorded air speed is already
 * measured at the rider (D-01).
 *
 * WHY ONE FILE COVERS ALL THREE MODES, and why that is not a vacuous guard:
 * the sync is inside `bindWindSourceRadios`, which is the single binder all
 * three sidebars call (bindStandardSliders.ts, renderGpsLap.ts,
 * renderOutAndBack.ts). It is literally the same function, so exercising it
 * once exercises every mode's real path. The last test in this file pins that
 * routing invariant rather than assuming it, because the moment a sidebar binds
 * its radios by hand the shared coverage stops being shared.
 */

function makeParams(
	overrides: Partial<AnalysisParameters> = {},
): AnalysisParameters {
	return { ...DEFAULT_PARAMETERS, ...overrides };
}

type Source = "constant" | "fit" | "compare";

/**
 * The relevant slice of a real sidebar: the control block followed by the
 * wind-source radio group, in that order, exactly as all three templates
 * interpolate them.
 */
function renderSidebar(
	selected: Source,
	params: AnalysisParameters,
	markupSource?: Source,
): void {
	document.body.innerHTML = `
		<div class="ve-controls">
			<div class="ve-control-grid">
				${windHeightControlsMarkup(params, markupSource)}
			</div>
			<div class="ve-wind-source">
				<label class="ve-radio-label"><input type="radio" name="windSource" value="constant" ${selected === "constant" ? "checked" : ""}><span>Use constant wind settings</span></label>
				<label class="ve-radio-label"><input type="radio" name="windSource" value="fit" ${selected === "fit" ? "checked" : ""}><span>Use FIT file wind data</span></label>
				<label class="ve-radio-label"><input type="radio" name="windSource" value="compare" ${selected === "compare" ? "checked" : ""}><span>Compare both methods</span></label>
			</div>
		</div>`;
}

/** Drive the radio the way a click does: check it, then fire `change`. */
function selectSource(value: Source): void {
	const radio = document.querySelector(
		`input[name="windSource"][value="${value}"]`,
	) as HTMLInputElement;
	radio.checked = true;
	radio.dispatchEvent(new Event("change", { bubbles: true }));
}

function controls(): HTMLElement {
	return document.getElementById("windHeightControls") as HTMLElement;
}

function slider(): HTMLInputElement {
	return document.getElementById("windHeightSlider") as HTMLInputElement;
}

function numberInput(): HTMLInputElement {
	return document.getElementById("windHeightValue") as HTMLInputElement;
}

describe("windHeightAppliesTo", () => {
	test("true for the two sources that model wind from a reference height", () => {
		expect(windHeightAppliesTo("constant")).toBe(true);
		// compare runs a constant-wind leg, so the factor stays live there.
		expect(windHeightAppliesTo("compare")).toBe(true);
	});

	test("false for FIT wind, which is already measured at the rider", () => {
		expect(windHeightAppliesTo("fit")).toBe(false);
	});

	test("false for an absent or unknown source", () => {
		expect(windHeightAppliesTo(null)).toBe(false);
		expect(windHeightAppliesTo(undefined)).toBe(false);
		expect(windHeightAppliesTo("")).toBe(false);
	});
});

describe("initial render", () => {
	test("the markup itself is hidden when the sidebar renders under FIT wind", () => {
		// Standard awaits initializeVEAnalysis between innerHTML and the bind, so
		// the template must not paint the control visible in the meantime.
		document.body.innerHTML = windHeightControlsMarkup(makeParams(), "fit");
		expect(controls().hidden).toBe(true);
	});

	test("the markup is visible under constant wind and under compare", () => {
		document.body.innerHTML = windHeightControlsMarkup(makeParams(), "constant");
		expect(controls().hidden).toBe(false);
		document.body.innerHTML = windHeightControlsMarkup(makeParams(), "compare");
		expect(controls().hidden).toBe(false);
	});
});

describe("bindWindSourceRadios drives the k control's visibility", () => {
	let onChange: ReturnType<typeof vi.fn>;

	beforeEach(() => {
		onChange = vi.fn();
	});

	test("hidden at bind time when FIT wind is already selected", () => {
		// The template is deliberately rendered WITHOUT a source here, i.e. the
		// pre-fix visible-always markup, so this asserts the bind-time sync and
		// not the template.
		renderSidebar("fit", makeParams());
		expect(controls().hidden).toBe(false);
		bindWindSourceRadios(onChange);
		expect(controls().hidden).toBe(true);
	});

	test("visible at bind time under constant wind", () => {
		renderSidebar("constant", makeParams());
		bindWindSourceRadios(onChange);
		expect(controls().hidden).toBe(false);
	});

	test("visible at bind time under compare", () => {
		renderSidebar("compare", makeParams());
		bindWindSourceRadios(onChange);
		expect(controls().hidden).toBe(false);
	});

	test("hidden at bind time when the sidebar renders no radios at all", () => {
		// Standard with neither FIT wind nor a constant wind omits the whole
		// wind-source block; getSelectedWindSource() then falls back to "fit".
		document.body.innerHTML = windHeightControlsMarkup(makeParams());
		bindWindSourceRadios(onChange);
		expect(controls().hidden).toBe(true);
	});

	test("visibility follows the source CHANGED while the panel is open", () => {
		renderSidebar("constant", makeParams(), "constant");
		bindWindSourceRadios(onChange);
		expect(controls().hidden).toBe(false);

		selectSource("fit");
		expect(controls().hidden).toBe(true);

		selectSource("compare");
		expect(controls().hidden).toBe(false);

		selectSource("constant");
		expect(controls().hidden).toBe(false);

		selectSource("fit");
		expect(controls().hidden).toBe(true);
	});

	test("the recompute the radios already triggered still fires every time", () => {
		renderSidebar("constant", makeParams(), "constant");
		bindWindSourceRadios(onChange);
		// Binding alone must not kick off a recompute.
		expect(onChange).not.toHaveBeenCalled();

		selectSource("fit");
		selectSource("constant");
		expect(onChange).toHaveBeenCalledTimes(2);
	});
});

describe("hiding the control is a visibility change only", () => {
	test("k, both inputs and the readout survive a round trip through FIT", () => {
		const params = makeParams({
			wind_speed: 3.5,
			wind_entry: "weather",
			wind_height_factor: 0.65,
		});
		renderSidebar("constant", params, "constant");
		bindWindSourceRadios(vi.fn());

		const factorBefore = resolveWindHeightFactor(params);
		const readoutBefore = (
			document.getElementById("windHeightReadout") as HTMLElement
		).textContent;
		expect(slider().value).toBe("0.65");

		selectSource("fit");
		// The element stays in the DOM carrying its value — removing it would make
		// the value unreadable to refreshWindHeightReadout on the way back.
		expect(controls()).not.toBeNull();
		expect(controls().hidden).toBe(true);
		expect(slider().value).toBe("0.65");
		expect(numberInput().value).toBe("0.65");

		selectSource("constant");
		expect(slider().value).toBe("0.65");
		expect(numberInput().value).toBe("0.65");
		expect(
			(document.getElementById("windHeightReadout") as HTMLElement).textContent,
		).toBe(readoutBefore);

		// The model is what the physics reads (resolveWindHeightFactor ->
		// resolveAppliedWindSpeed -> the single effectiveWindSpeed hoist in
		// createVeCalculator). Nothing in the visibility path may touch it.
		expect(params.wind_height_factor).toBe(0.65);
		expect(resolveWindHeightFactor(params)).toBe(factorBefore);
	});

	test("no consumer reads the slider element, so a hidden control cannot move a number", () => {
		// A DOM read would make absence/hiding change the resolved series. The
		// factor resolves from AnalysisParameters with no DOM present at all.
		const params = makeParams({ wind_speed: 3.5, wind_height_factor: 0.45 });
		document.body.innerHTML = "";
		expect(resolveWindHeightFactor(params)).toBe(0.45);
	});
});

describe("all three sidebars route through the shared binder", () => {
	test("standard, GPS lap and out-and-back all reach bindWindSourceRadios", () => {
		const sidebars = [
			"src/shell/ve/bindStandardSliders.ts",
			"src/shell/gpsLap/renderGpsLap.ts",
			"src/shell/outAndBack/renderOutAndBack.ts",
		];
		for (const relative of sidebars) {
			const source = readFileSync(resolve(process.cwd(), relative), "utf8");
			// If a sidebar ever binds input[name="windSource"] by hand instead, the
			// coverage above stops covering it and this fails loudly.
			//
			// Plan 07-03 (D-04) put ONE binder above the three sidebars, so a sidebar
			// may now reach the shared radio binder either directly or through
			// `bindModeControls`. Both are the shared path; a hand-rolled listener is
			// still what this guard exists to reject, and the assertion below pins
			// the delegate to the same shared binder so the indirection cannot become
			// an escape route.
			expect(source).toMatch(/bindWindSourceRadios\(|bindModeControls\(/);
			expect(source).not.toMatch(
				/addEventListener\([^)]*\)[\s\S]{0,80}name="windSource"/,
			);
		}

		const binder = readFileSync(
			resolve(process.cwd(), "src/shell/analysis/bindModeControls.ts"),
			"utf8",
		);
		expect(binder).toContain("bindWindSourceRadios(");
		expect(binder).not.toMatch(
			/addEventListener\([^)]*\)[\s\S]{0,80}name="windSource"/,
		);
	});
});
