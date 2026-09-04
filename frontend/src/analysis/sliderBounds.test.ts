// @vitest-environment jsdom
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
import {
	resolveDisplayCda,
	resolveDisplayCrr,
} from "./unsetParameterFallbacks";
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

	/**
	 * F17-01. A range input SANITIZES its value to `max`, and the save paths
	 * persist `parseFloat(crrSlider.value)` — so a display range that excludes
	 * the value it is displaying does not merely mis-paint it, it overwrites it
	 * on the next Store Result. The range therefore widens to admit the current
	 * value, and does nothing at all when the value already fits.
	 */
	it("never excludes the value it is being asked to display", () => {
		const inside = { min: 0.0015, max: 0.03 };
		expect(displayCrrBounds()).toEqual(inside);
		expect(displayCrrBounds(null)).toEqual(inside);
		expect(displayCrrBounds(0.008)).toEqual(inside);

		expect(displayCrrBounds(0.04)).toEqual({ min: 0.0015, max: 0.04 });
		expect(displayCrrBounds(0.001)).toEqual({ min: 0.001, max: 0.03 });
	});

	/** F17-05. The CdA twin, same rule and same reason. */
	it("never excludes the CdA value it is being asked to display", () => {
		const inside = { min: 0.15, max: 0.5 };
		expect(displayCdaBounds()).toEqual(inside);
		expect(displayCdaBounds(null)).toEqual(inside);
		expect(displayCdaBounds(0.3)).toEqual(inside);

		expect(displayCdaBounds(0.6)).toEqual({ min: 0.15, max: 0.6 });
		expect(displayCdaBounds(0.1)).toEqual({ min: 0.1, max: 0.5 });
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

	/** F17-05. The CdA twin: wiring the slider must not reach the optimizer. */
	it("is what VeCalculatorFactory passes for CdA too", () => {
		const factory = readFileSync(
			join(__dirname, "VeCalculatorFactory.ts"),
			"utf8",
		);
		expect(factory).toContain("input.params.cda_min");
		expect(factory).toContain("input.params.cda_max");
		expect(factory).not.toContain("displayCdaBounds");
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
	 * F17-05. The CdA twin. Ten inline literals used to sit here reading the
	 * stored pair, harmless only because the defaults happened to equal them —
	 * the next widening of the CdA bounds walks into bundle E's bug again.
	 *
	 * Mutation: point any of the three back at `params.cda_min` and this fails
	 * naming the file.
	 */
	it("is not what the cda slider markup reads", () => {
		const offenders: string[] = [];
		for (const f of [
			"../shell/ve/renderStandardVe.ts",
			"../shell/gpsLap/renderGpsLap.ts",
			"../shell/outAndBack/renderOutAndBack.ts",
		]) {
			const text = readFileSync(join(__dirname, f), "utf8");
			for (const line of text.split("\n")) {
				if (/id="cda(Slider|Value)"/.test(line) && /cda_min|cda_max/.test(line)) {
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
		expect(binder).toContain("displayCrrBounds(");
	});

	/** F17-05. The CdA twin of the clamp scan. */
	it("is not what the cda control clamps against", () => {
		const binder = readFileSync(
			join(__dirname, "../shell/analysis/bindModeControls.ts"),
			"utf8",
		);
		expect(binder).not.toMatch(/clamp\(rawValue,\s*params\.cda_min/);
		expect(binder).toContain("displayCdaBounds(");
	});

	/**
	 * F17-01. Every caller must pass the value it is about to render or clamp,
	 * or the ceiling returns and a stored 0.04 paints — and re-saves — as 0.03.
	 * A bare `displayCrrBounds()` is exactly that regression, and it is invisible
	 * to every runtime assertion on this module.
	 *
	 * The BINDER is in this list and not only in the clamp scan above: a widened
	 * markup with a default-clamped control loses the value on the first
	 * keystroke instead of on the first Store Result, which is the same defect.
	 *
	 * Mutation: drop the argument in any of the four and this fails naming it.
	 */
	it("is widened by the value each call site is about to use", () => {
		const offenders: string[] = [];
		for (const f of [
			"../shell/ve/renderStandardVe.ts",
			"../shell/gpsLap/renderGpsLap.ts",
			"../shell/outAndBack/renderOutAndBack.ts",
			"../shell/analysis/bindModeControls.ts",
		]) {
			const text = readFileSync(join(__dirname, f), "utf8");
			// `[^\s)]` and not `\S`: `\S` matches the closing paren of a bare
			// `displayCrrBounds()`, which is the exact regression being scanned for.
			for (const fn of ["displayCrrBounds", "displayCdaBounds"]) {
				if (!new RegExp(`${fn}\\(\\s*[^\\s)]`).test(text)) {
					offenders.push(`${f}: ${fn} called with no argument`);
				}
			}
		}
		expect(offenders).toEqual([]);
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

/**
 * THE ASSERTION THAT ACTUALLY OBSERVES THE DEFECT.
 *
 * Everything above is a source scan or a pure-function check; neither can see
 * what a browser does with the markup. The bug is in the HTML value-sanitization
 * algorithm: a range input whose `value` exceeds its `max` silently reports the
 * `max`, and `saveLapSettings`/`handleStoreResult` persist `crrSlider.value`.
 * So the stored 0.04 is not just displayed as 0.03 — it BECOMES 0.03.
 *
 * Built from the real helpers, never from inlined numbers: a test that repeats
 * the constants stays green when the helper it is meant to guard is deleted.
 */
describe("a stored Crr above the default ceiling", () => {
	function buildCrrRange(stored: number): HTMLInputElement {
		const bounds = displayCrrBounds(resolveDisplayCrr(stored));
		const host = document.createElement("div");
		host.innerHTML = `<input type="range" id="crrSlider" min="${bounds.min}" max="${bounds.max}" value="${resolveDisplayCrr(stored)}" step="0.0001">`;
		return host.querySelector("input") as HTMLInputElement;
	}

	it("survives the range input instead of being sanitized down to 0.03", () => {
		expect(buildCrrRange(0.04).value).toBe("0.04");
	});

	/** And the widening is not unconditional — a normal value keeps the app range. */
	it("leaves the default ceiling alone for a value inside it", () => {
		const range = buildCrrRange(0.008);
		expect(range.value).toBe("0.008");
		expect(range.max).toBe("0.03");
	});

	/** F17-05. The CdA twin, built from the real helpers the same way. */
	it("does the same for a stored CdA above the CdA ceiling", () => {
		const bounds = displayCdaBounds(resolveDisplayCda(0.6));
		const host = document.createElement("div");
		host.innerHTML = `<input type="range" id="cdaSlider" min="${bounds.min}" max="${bounds.max}" value="${resolveDisplayCda(0.6)}" step="0.001">`;
		const range = host.querySelector("input") as HTMLInputElement;
		expect(range.value).toBe("0.6");
	});
});
