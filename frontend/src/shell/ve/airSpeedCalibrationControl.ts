/**
 * The shared "Air Speed Calibration" control block — the percent slider, its
 * number input, and the Auto Adjust button.
 *
 * All three sidebars carried a byte-identical copy of this markup, differing
 * only in where the current value came from. One helper rather than three
 * copies is what lets the visibility rule below be stated once instead of
 * three times, which is the whole reason the defect it fixes survived: a rule
 * that has to be repeated per mode is a rule a mode can be missed from.
 *
 * WHY IT HIDES UNDER CONSTANT WIND (maintainer ruling, plan 07-03). The
 * calibration percent scales the recorded FIT air-speed channel. It is applied
 * only on the `fit` branch of `resolveWindSeries`;
 * `calculateConstantApparentWindSeries` never consults it. Driven through the
 * real production path on the golden fixture, calibration 0% -> 10% under
 * constant leaves mean r² at 0.181694, the VE checksum at 1254.10 and the
 * apparent-wind checksum at 2722.01 — identical to every digit computed, where
 * the same change under `fit` moves r² from 0.313257 to 0.255302. So under
 * constant this was a bound, responsive control with no effect on anything and
 * no indication of that, in all three modes. It predates the mode-pipeline
 * migration entirely; the maintainer chose to fix it alongside rather than
 * defer it, because it is the same one-call fix and the same lying-control
 * class as the offset block next to it.
 *
 * T-08-02: every interpolated value is a number produced by toFixed or one of
 * the exported numeric constants. No user-controlled string reaches the
 * template.
 */
import {
	AIR_SPEED_CALIBRATION_MAX_PERCENT,
	AIR_SPEED_CALIBRATION_MIN_PERCENT,
	AIR_SPEED_CALIBRATION_STEP_PERCENT,
} from "../../analysis/AirSpeedCalibration";
import {
	fitWindControlsApplyTo,
	WIND_SOURCE_VISIBILITY_ATTR,
} from "./windSourceVisibility";

/** The block's own id, so the visibility sync and tests can name it. */
export const AIR_SPEED_CALIBRATION_CONTROLS_ID = "airSpeedCalibrationControls";

/**
 * `currentValue` is the already-formatted percent string the three modes each
 * derive their own way (Standard reads `appState` directly, the GPS modes go
 * through `formatAirSpeedCalibrationPercent`). It is passed in rather than
 * computed here so this helper stays a pure markup function.
 *
 * `windSource` is optional and decides only the INITIAL hidden state; the
 * bind-time sync settles it either way. Passing it is the difference between no
 * flash and a flash, never between right and wrong.
 */
export function airSpeedCalibrationControlMarkup(
	currentValue: string,
	windSource?: string | null,
): string {
	const hidden =
		windSource !== undefined && windSource !== null
			? !fitWindControlsApplyTo(windSource)
			: false;

	return `
        <div class="ve-parameter" id="${AIR_SPEED_CALIBRATION_CONTROLS_ID}" ${WIND_SOURCE_VISIBILITY_ATTR}="fit"${hidden ? " hidden" : ""}>
            <div class="ve-param-header">
                <label for="airSpeedCalibration">Air Speed Calibration</label>
                <input type="number" id="airSpeedCalibrationValue" value="${currentValue}" step="${AIR_SPEED_CALIBRATION_STEP_PERCENT}" min="${AIR_SPEED_CALIBRATION_MIN_PERCENT.toFixed(1)}" max="${AIR_SPEED_CALIBRATION_MAX_PERCENT.toFixed(1)}"
                       class="ve-param-header__value" />
                <span>%</span>
            </div>
            <input type="range" id="airSpeedCalibrationSlider" min="${AIR_SPEED_CALIBRATION_MIN_PERCENT.toFixed(1)}" max="${AIR_SPEED_CALIBRATION_MAX_PERCENT.toFixed(1)}" step="${AIR_SPEED_CALIBRATION_STEP_PERCENT}" value="${currentValue}" />
            <button id="autoAdjustCalibration" class="secondary-btn ve-parameter__auto-btn">Auto Adjust</button>
        </div>
    `;
}
