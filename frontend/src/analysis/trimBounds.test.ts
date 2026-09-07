/**
 * The trim analogue of F17-01, which `sliderBounds.ts` records for Crr/CdA: a
 * `range` input SANITIZES a value outside its `min`/`max`, and a `number` input
 * does not. So a stored trim that does not fit the selection it is loaded
 * against paints the two faces of one window differently — the slider at its
 * clamped edge, the number box at the raw stored figure.
 *
 * Measured in the app 2026-09-07 on the reference ride, before this clamp
 * existed: `{trimEnd: 582}` planted under lap key `10` (274 samples) left
 * `#trimEndSlider.value` and `#mapTrimEndSlider.value` reading 273 while
 * `#trimEndValue` and `#mapTrimEndValue` read 582.
 */
import { describe, expect, it } from "vitest";
import { clampTrimWindow, MIN_TRIM_WINDOW_SAMPLES } from "./trimBounds";

describe("clampTrimWindow", () => {
	it("leaves a window that already fits the selection untouched", () => {
		expect(clampTrimWindow({ start: 40, end: 500 }, 583)).toEqual({
			start: 40,
			end: 500,
		});
	});

	it("pulls an end past the last sample back to the last sample", () => {
		// The reproduced case: a 583-sample selection's trim loaded against a
		// 274-sample one.
		expect(clampTrimWindow({ start: 0, end: 582 }, 274)).toEqual({
			start: 0,
			end: 273,
		});
	});

	it("lifts an end below the floor up to the floor", () => {
		// `saveCurrentMultiSegmentSettings` writes a hardcoded `{0, 0}` under the
		// SELECTION key, which Standard reads back. Zero is below the panel
		// slider's `min`, so it splits the pair in the other direction.
		expect(clampTrimWindow({ start: 0, end: 0 }, 274)).toEqual({
			start: 0,
			end: MIN_TRIM_WINDOW_SAMPLES,
		});
	});

	it("pulls a start that leaves less than the floor back off the end", () => {
		expect(clampTrimWindow({ start: 270, end: 273 }, 274)).toEqual({
			start: 273 - MIN_TRIM_WINDOW_SAMPLES,
			end: 273,
		});
	});

	it("never returns a start below zero, even when the selection is shorter than the floor", () => {
		// A selection this short cannot hold the floor at all. The window then
		// spans the whole selection rather than going negative, which is what the
		// sliders' own `min`/`max` would produce.
		expect(clampTrimWindow({ start: 0, end: 582 }, 10)).toEqual({
			start: 0,
			end: 9,
		});
	});

	it("treats a null end as the last sample of the selection", () => {
		expect(clampTrimWindow({ start: 0, end: null }, 274)).toEqual({
			start: 0,
			end: 273,
		});
	});

	it("floors a fractional stored value rather than propagating it", () => {
		// Nothing writes one today, but the sliders are integer-valued and a
		// stored record is data from disk, not a computed value.
		expect(clampTrimWindow({ start: 1.6, end: 100.4 }, 274)).toEqual({
			start: 1,
			end: 100,
		});
	});
});
