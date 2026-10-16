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
		// EITHER measured wind channel qualifies, not just a native `air_speed`
		// field. Safe because the estimator never sees a raw FIT field: it reads
		// `aligned.windSpeed`, which `resolveWindSeries` has already reduced to
		// the longitudinal component (magnitude x cos(yaw)) and offset-aligned,
		// and it does that identically for both channels
		// (`WindSourceResolver.ts:78-86`). The old gate excluded `wind_speed`
		// rides by field name, not by anything the fit requires.
		//
		// The +2 s offset does NOT come with it: that lag is measured for the
		// ELEMNT ACE `air_speed` channel only, and the `wind_speed` path keeps
		// its 0 s default on both routes that can set it
		// (`WindSourceResolver.ts:44` and `:81`).
		measuredAirSpeed:
			aligned.dataSource === "air_speed" || aligned.dataSource === "wind_speed",
		headingSegments: buildHeadingCalibrationSegments(
			activeUpdateSegments(appState),
			normalized,
			aligned.windSpeed,
		),
	};
}
