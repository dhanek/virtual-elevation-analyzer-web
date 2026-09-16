import { getNormalizedActivityArrays } from "../../analysis/ActivityArrayCache";
import type { AutoCalibrationInput } from "../../analysis/AirSpeedCalibration";
import { buildHeadingCalibrationSegments } from "../../analysis/headingCalibrationSegments";
import { resolveWindSeries } from "../../analysis/WindSourceResolver";
import type { AppState } from "../../state/AppState";
import { activeUpdateSegments } from "./requestModeUpdate";

/**
 * The heading-fit half of Auto Adjust's input, identical for all three modes.
 * Air speed is resolved over the FULL activity with the user's
 * `air_speed_offset` and calibration percent 0 (D6; offset measured
 * 2026-09-15, see the plan), then cut per update segment.
 */
export function headingCalibrationInput(
	appState: AppState,
): Pick<AutoCalibrationInput, "measuredAirSpeed" | "headingSegments"> {
	const fitData = appState.currentFitData;
	if (!fitData) return { measuredAirSpeed: false, headingSegments: [] };
	const normalized = getNormalizedActivityArrays(fitData);
	const aligned = resolveWindSeries({
		fitData,
		// Always the MEASURED channel, independent of the UI's wind-source radio
		// (fit | constant | compare). Auto Adjust calibrates the measured
		// air-speed sensor itself, so the heading fit must read that channel even
		// when the user has the display set to a synthesized source.
		windSource: "fit",
		params: appState.currentParameters,
		airSpeedCalibrationPercent: 0,
	});
	return {
		measuredAirSpeed: aligned.dataSource === "air_speed",
		headingSegments: buildHeadingCalibrationSegments(
			activeUpdateSegments(appState),
			normalized,
			aligned.windSpeed,
		),
	};
}
