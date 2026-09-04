/**
 * A FILE ANALYSED BEFORE A RANGE WIDENING STILL GETS THE WIDE SLIDER.
 *
 * Reported 2026-09-03: bundle E widened Crr to 0.0015–0.030, but only fresh
 * files saw it. An existing file kept 0.002–0.015 because its stored record
 * carried that pair and `normalizeLoadedParameters` returns a post-feature
 * record by identity.
 *
 * The maintainer's objection is the design fix: *"what I would like to store is
 * my Crr selection of previous analysis, the slider range has nothing to do
 * with it"*. The stored pair is the OPTIMIZER's search range — a real setting,
 * editable in the Section 2 "Crr Bounds" form and passed to the calculator by
 * `VeCalculatorFactory`. The slider's travel is app configuration. One pair was
 * doing both jobs.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { DEFAULT_PARAMETERS } from "../components/AnalysisParameters";
import { displayCdaBounds, displayCrrBounds } from "./sliderBounds";

describe("the slider's travel", () => {
	/**
	 * Kills a helper that reads the bounds from a passed-in params object — the
	 * shape that let a stored pair shadow the app's range.
	 */
	it("comes from the app defaults, so a widening reaches every file", () => {
		expect(displayCrrBounds()).toEqual({
			min: DEFAULT_PARAMETERS.crr_min,
			max: DEFAULT_PARAMETERS.crr_max,
		});
		expect(displayCdaBounds()).toEqual({
			min: DEFAULT_PARAMETERS.cda_min,
			max: DEFAULT_PARAMETERS.cda_max,
		});
	});

	/**
	 * Pins the widened pair itself. The reported defect was that a file kept the
	 * OLD 0.002–0.015; a regression of the default would reinstate it for
	 * everyone at once.
	 */
	it("is the widened bundle E range, not the pre-widening one", () => {
		const { min, max } = displayCrrBounds();
		expect(min).toBe(0.0015);
		expect(max).toBe(0.03);
		expect(min).toBeLessThan(0.002);
		expect(max).toBeGreaterThan(0.015);
	});
});

describe("the optimizer's search bounds stay the user's own", () => {
	/**
	 * The other half of the split, and the one a careless fix would break: the
	 * calculator must keep receiving the STORED bounds, not the display ones, or
	 * the Section 2 "Crr Bounds" form silently stops doing anything.
	 *
	 * Source-level because the argument is positional inside a WASM constructor
	 * call — no runtime assertion on this module can observe which pair was
	 * passed. Mutation: point either line at the display bounds and this fails.
	 */
	it("is what VeCalculatorFactory passes to the calculator", () => {
		const factory = readFileSync(
			join(__dirname, "VeCalculatorFactory.ts"),
			"utf8",
		);
		expect(factory).toContain("input.params.crr_min");
		expect(factory).toContain("input.params.crr_max");
		expect(factory).not.toContain("displayCrrBounds");
	});

	/**
	 * The slider markup in all three modes must read the DISPLAY bounds. Reading
	 * `params.crr_min` there is precisely what let a stored pair narrow the
	 * control. Source-level because the markup is a template string.
	 *
	 * Mutation: point any of the three back at `params.crr_min` and this fails
	 * naming the file.
	 */
	it("is not what the crr slider markup reads", () => {
		const offenders: string[] = [];
		for (const f of [
			"../shell/ve/renderStandardVe.ts",
			"../shell/gpsLap/renderGpsLap.ts",
			"../shell/outAndBack/renderOutAndBack.ts",
		]) {
			const text = readFileSync(join(__dirname, f), "utf8");
			for (const line of text.split("\n")) {
				if (/id="crr(Slider|Value)"/.test(line) && /crr_min|crr_max/.test(line)) {
					offenders.push(`${f}: ${line.trim().slice(0, 80)}`);
				}
			}
		}
		expect(offenders).toEqual([]);
	});

	/**
	 * And the CLAMP has to move with the markup. A widened slider that snaps back
	 * to the stored pair on input is the same defect wearing a different hat —
	 * the control offers 0.0015 and refuses to keep it.
	 *
	 * Mutation: restore `clamp(rawValue, params.crr_min, params.crr_max)` and
	 * this fails.
	 */
	it("is not what the crr control clamps against", () => {
		const binder = readFileSync(
			join(__dirname, "../shell/analysis/bindModeControls.ts"),
			"utf8",
		);
		expect(binder).not.toMatch(/clamp\(rawValue,\s*params\.crr_min/);
		expect(binder).toContain("displayCrrBounds()");
	});

	/**
	 * The three migration literals hardcoded the pre-widening pair, so any
	 * record they touched was born stale. Kills their reintroduction.
	 */
	it("has no hardcoded pre-widening pair left in ParameterStorage", () => {
		const storage = readFileSync(
			join(__dirname, "../utils/ParameterStorage.ts"),
			"utf8",
		);
		expect(storage).not.toMatch(/crr_min:\s*0\.002\b/);
		expect(storage).not.toMatch(/crr_max:\s*0\.015\b/);
	});
});
