// @vitest-environment jsdom
/**
 * N-3 (maintainer ruling, plan 07-03) and the covered-lap count.
 *
 * These assert the two things a binder-level test structurally CANNOT: that a
 * template actually emits the markup, and that the readout says something
 * different when the numbers cover fewer laps than are ticked.
 *
 * The distinction matters here specifically. `modeControls.callshape.test.ts`
 * builds its own panel containing #airSpeedOffsetSlider and
 * #airSpeedOffsetErrorMetric, so it proves the BINDER wires them — and it passed
 * happily for a release in which no template emitted either element in any mode
 * and the control was therefore dead everywhere. A guard over a fixture that
 * supplies the very markup whose absence is the bug is the vacuous-guard trap
 * this phase has already hit three times.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import {
	airSpeedOffsetControlMarkup,
	resolveInitialAirSpeedOffset,
} from "./airSpeedOffsetControl";
import { formatCoveredLapCount } from "./bindStandardSliders";

function sourceOf(relativePath: string): string {
	return readFileSync(fileURLToPath(new URL(relativePath, import.meta.url)), "utf8");
}

function parse(markup: string): HTMLElement {
	const host = document.createElement("div");
	host.innerHTML = markup;
	return host;
}

describe("airSpeedOffsetControlMarkup", () => {
	it("emits the slider, the number input AND the error-metric span", () => {
		const host = parse(airSpeedOffsetControlMarkup(3, 2));

		// bindModeControls' isRendered() requires BOTH inputs before it binds the
		// row at all, so a template missing either one skips silently.
		expect(host.querySelector("#airSpeedOffsetSlider")).not.toBeNull();
		expect(host.querySelector("#airSpeedOffsetValue")).not.toBeNull();
		// Never rendered by any template before this plan, which is why the metric
		// was dead code in all three modes.
		expect(host.querySelector("#airSpeedOffsetErrorMetric")).not.toBeNull();
	});

	it("opens on the stored offset, not the mode default", () => {
		const host = parse(airSpeedOffsetControlMarkup(-4, 2));
		const slider = host.querySelector("#airSpeedOffsetSlider") as HTMLInputElement;
		const number = host.querySelector("#airSpeedOffsetValue") as HTMLInputElement;

		expect(slider.value).toBe("-4");
		expect(number.value).toBe("-4");
	});

	it("honours a STORED offset of zero rather than falling back", () => {
		// `??` not `||`. A stored 0 is a real user choice ("no shift"), and `||`
		// would silently replace it with the mode default on every re-render.
		expect(resolveInitialAirSpeedOffset(0, 2)).toBe(0);
		expect(resolveInitialAirSpeedOffset(null, 2)).toBe(2);
		expect(resolveInitialAirSpeedOffset(undefined, 2)).toBe(2);
	});

	it("carries the range the handler clamps to", () => {
		const host = parse(airSpeedOffsetControlMarkup(0, 0));
		const slider = host.querySelector("#airSpeedOffsetSlider") as HTMLInputElement;

		expect(slider.min).toBe("-10");
		expect(slider.max).toBe("10");
	});
});

/**
 * The markup helper being correct is worth nothing if no template calls it —
 * which was precisely the state of Standard's offset handler before this plan.
 * Asserted against the SOURCE because Standard has no extractable template
 * builder (unlike `buildGpsLapVeAnalysisTemplate`), and building the whole panel
 * would need the full analyze pipeline.
 */
describe("the mode templates emit the offset control", () => {
	it("Standard's sidebar renders it from the shared helper", () => {
		const source = sourceOf("./renderStandardVe.ts");

		expect(source).toContain("airSpeedOffsetControlMarkup(");
		// Not a hand-rolled second copy of the same block.
		expect(source).not.toContain('id="airSpeedOffsetSlider"');
	});

	it("Standard's metrics header carries the covered-lap span", () => {
		expect(sourceOf("./renderStandardVe.ts")).toContain(
			'id="lapsCoveredValue"',
		);
	});
});

describe("formatCoveredLapCount", () => {
	it("shows a bare count when every ticked lap is covered", () => {
		expect(formatCoveredLapCount(3, 3)).toBe("3");
	});

	it("says 'of' when the mean covers FEWER laps than are ticked", () => {
		// The whole point of the ruling: laps trimmed under the primitive's
		// minimum are excluded from the headline mean, and that exclusion must
		// not be silent.
		expect(formatCoveredLapCount(2, 3)).toBe("2 of 3");
		expect(formatCoveredLapCount(0, 4)).toBe("0 of 4");
	});
});
