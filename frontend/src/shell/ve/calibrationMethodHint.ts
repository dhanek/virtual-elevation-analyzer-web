/**
 * The line under Auto Adjust saying which method THIS selection can use.
 *
 * "available", never "will run": `calibrationEligibility` checks the geometry
 * only, and the fit can still refuse on heading coverage or a degenerate solve.
 * A line that promised the fit would run would be wrong exactly on the rides
 * whose geometry is marginal — the ones the user is looking at it for.
 *
 * Refusal wording comes from the report's own table, so the hint and the
 * report cannot describe the same refusal in two different ways.
 */
import {
	type CalibrationEligibility,
	calibrationEligibility,
} from "../../analysis/AirSpeedCalibration";
import type { AppState } from "../../state/AppState";
import { log } from "../../utils/log";
import { headingCalibrationInput } from "../analysis/autoCalibration";
import { REFUSAL_TEXT } from "./airSpeedCalibrationReport";

export const CALIBRATION_METHOD_HINT_ID = "airSpeedCalibrationMethodHint";

export function calibrationHintText(
	eligibility: CalibrationEligibility,
): string {
	if (eligibility.method === "sinusoid") {
		const n = eligibility.circuits;
		return `Heading fit available — ${n} complete circuit${n === 1 ? "" : "s"}`;
	}
	return `Distance ratio only — ${REFUSAL_TEXT[eligibility.reason]}`;
}

/** Writes the hint, or hides it for `null` (no activity to describe). */
export function renderCalibrationMethodHint(
	eligibility: CalibrationEligibility | null,
): void {
	const element = document.getElementById(CALIBRATION_METHOD_HINT_ID);
	if (!element) return;
	const text = eligibility ? calibrationHintText(eligibility) : "";
	// Every selection change lands here; rewriting an unchanged line would
	// have a live region announce it again.
	if (element.textContent !== text) element.textContent = text;
	element.hidden = eligibility === null;
}

/**
 * Re-derives the hint from the CURRENT selection. The estimator's heading
 * input is identical for all three modes, so one build serves them all; the
 * distance-ratio segments play no part in the geometry probe.
 */
export function refreshCalibrationMethodHint(appState: AppState): void {
	if (!appState.currentFitData) {
		renderCalibrationMethodHint(null);
		return;
	}
	try {
		renderCalibrationMethodHint(
			calibrationEligibility({
				...headingCalibrationInput(appState),
				vdSegments: [],
			}),
		);
	} catch (err) {
		// A hint is never worth breaking a selection change over.
		log.error(
			"refreshCalibrationMethodHint: could not probe the selection",
			err,
		);
		renderCalibrationMethodHint(null);
	}
}
