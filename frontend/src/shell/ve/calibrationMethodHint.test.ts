/**
 * @vitest-environment jsdom
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
	CALIBRATION_METHOD_HINT_ID,
	calibrationHintText,
	renderCalibrationMethodHint,
} from "./calibrationMethodHint";

describe("calibrationHintText", () => {
	it("says the heading fit is available, never that it will run", () => {
		const text = calibrationHintText({ method: "sinusoid", circuits: 4 });
		expect(text).toBe("Heading fit available — 4 complete circuits");
		expect(text).not.toContain("will run");
	});

	it("uses the singular for one circuit", () => {
		expect(calibrationHintText({ method: "sinusoid", circuits: 1 })).toBe(
			"Heading fit available — 1 complete circuit",
		);
	});

	it("names the refusal in the report's own words", () => {
		expect(
			calibrationHintText({ method: "vdRatio", reason: "noWholeCircuit" }),
		).toBe("Distance ratio only — the selection holds no complete circuit");
	});
});

describe("renderCalibrationMethodHint", () => {
	const hint = () => document.getElementById(CALIBRATION_METHOD_HINT_ID);

	beforeEach(() => {
		document.body.innerHTML = `<div id="${CALIBRATION_METHOD_HINT_ID}" hidden></div>`;
	});
	afterEach(() => {
		document.body.innerHTML = "";
	});

	it("writes the text and shows the element", () => {
		renderCalibrationMethodHint({ method: "sinusoid", circuits: 2 });
		expect(hint()?.textContent).toBe(
			"Heading fit available — 2 complete circuits",
		);
		expect(hint()?.hidden).toBe(false);
	});

	it("updates rather than clears when the selection changes", () => {
		renderCalibrationMethodHint({ method: "sinusoid", circuits: 2 });
		renderCalibrationMethodHint({
			method: "vdRatio",
			reason: "noWholeCircuit",
		});
		expect(hint()?.textContent).toContain("Distance ratio only");
	});

	it("hides the element for null and tolerates a missing element", () => {
		renderCalibrationMethodHint({ method: "sinusoid", circuits: 2 });
		renderCalibrationMethodHint(null);
		expect(hint()?.hidden).toBe(true);
		expect(hint()?.textContent).toBe("");
		document.body.innerHTML = "";
		expect(() => renderCalibrationMethodHint(null)).not.toThrow();
	});
});
