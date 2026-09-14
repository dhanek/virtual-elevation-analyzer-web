// @vitest-environment jsdom
import { beforeEach, describe, expect, test } from "vitest";
import { getCheckedWindSource, getSelectedWindSource } from "./windSource";

/**
 * The two readers differ in exactly one case — no checked radio — and that
 * difference is load-bearing. `getSelectedWindSource` answers "what source is
 * the rendered panel on" and falls back to 'fit' for its thirteen in-panel
 * query sites. `getCheckedWindSource` answers "what has the user actually
 * selected" for the re-render preservation path, where the 'fit' fallback made
 * `preservedWindSource || (hasWindSpeed ? "fit" : "constant")` dead code in
 * renderGpsLap/renderOutAndBack: a ride with no wind channel opened stuck on
 * 'fit', its lone constant radio unchecked and the wind-height control hidden.
 */
describe("getCheckedWindSource vs getSelectedWindSource", () => {
	beforeEach(() => {
		document.body.innerHTML = "";
	});

	test("no radios rendered: checked reader says null, selected falls back to fit", () => {
		expect(getCheckedWindSource()).toBeNull();
		expect(getSelectedWindSource()).toBe("fit");
	});

	test("a rendered but UNCHECKED radio still reads as null", () => {
		document.body.innerHTML = `
			<label><input type="radio" name="windSource" value="constant"></label>
		`;
		expect(getCheckedWindSource()).toBeNull();
		expect(getSelectedWindSource()).toBe("fit");
	});

	test("a checked radio reads identically through both", () => {
		document.body.innerHTML = `
			<label><input type="radio" name="windSource" value="constant" checked></label>
			<label><input type="radio" name="windSource" value="fit"></label>
		`;
		expect(getCheckedWindSource()).toBe("constant");
		expect(getSelectedWindSource()).toBe("constant");
	});

	test("the sensor-less default composition the renderers rely on", () => {
		// The exact expression at renderGpsLap/renderOutAndBack: with nothing
		// checked, a ride without a FIT wind channel must open on 'constant'.
		const hasWindSpeed = false;
		const selected =
			getCheckedWindSource() || (hasWindSpeed ? "fit" : "constant");
		expect(selected).toBe("constant");
	});
});
