/**
 * THE binder (D-04, ROADMAP SC#2).
 *
 * One hand-written binding layer above the primitive, for all three modes. It
 * walks `MODE_CONTROL_TABLE`, skips the rows this mode's template does not
 * render, and wires the rest with the shared DOM helpers that were written for
 * exactly this consolidation (`syncRangeAndNumber`, `bindWindSourceRadios`,
 * `bindElevationSmoothingToggle`, `bindCrrTempControls`, `bindWindHeightControls`).
 *
 * Every handler ends the same way, in the same order:
 *
 *   1. apply the row's `writes`
 *   2. `requestModeUpdate(spec.reason)`  — the only route to the primitive
 *   3. the row's declared side effects (map, auto-rho, offset metric, persistence)
 *
 * Step 2 is not optional and not per-control, which is the whole point: the
 * 2026-04-19 bug was a handler that performed step 1 and step 3 and silently
 * skipped step 2.
 *
 * PERSISTENCE. Out-of-form parameter writes go through `mergeAnalysisParameters`
 * and nothing else. Standard used to call `parametersComponent.setParameters`
 * directly in four places; the gateway already routes to exactly that when a
 * component exists and falls back to a local assign when it does not, so the
 * binder takes no `parametersComponent` argument at all and there is one
 * persistence gateway rather than two (07-RESEARCH.md §Priority 6).
 */
import {
	clampAirSpeedCalibrationPercent,
} from "../../analysis/AirSpeedCalibration";
import { calculateAirSpeedSyncError } from "../../analysis/WindSourceResolver";
import type { AnalysisModeId } from "../../modes/analysis/types";
import type { AppState } from "../../state/AppState";
import { log } from "../../utils/log";
import { syncRangeAndNumber } from "../dom/rangeNumberPair";
import { bindWindSourceRadios, getSelectedWindSource } from "../dom/windSource";
import { bindCrrTempControls } from "../ve/crrTempControls";
import { bindWindHeightControls } from "../ve/windHeightControls";
import { bindElevationSmoothingToggle } from "./elevationProfileCycle";
import {
	controlsForMode,
	type ModeControlSpec,
} from "./modeControlTable";
import { mergeAnalysisParameters } from "./parametersSync";
import { requestModeUpdate } from "./requestModeUpdate";

/**
 * The trim window may never close below this many samples.
 *
 * Carried over unchanged from `setupVESliders`, including the behaviour that
 * makes it visible: when the clamp fires the sliders are corrected and the
 * update is SKIPPED, so dragging one edge into the other parks it rather than
 * recomputing the same window repeatedly.
 */
const MIN_TRIM_WINDOW_SAMPLES = 30;

const AIR_SPEED_OFFSET_MIN_SECONDS = -10;
const AIR_SPEED_OFFSET_MAX_SECONDS = 10;

/** One window the air-speed sync error is measured over. */
export interface OffsetMetricWindow {
	start: number;
	end: number;
}

export interface BindModeControlsOptions {
	appState: AppState;
	modeId: AnalysisModeId;
	/** The mode's own settings saver — Standard and the GPS modes differ. */
	saveSettings: () => void;
	/** Repaint the map trim markers. Only called when `mapCanFollow` agrees. */
	onTrimMapUpdate?: (trimStart: number, trimEnd: number) => void;
	/**
	 * The stale-marker guard (`veViewMatchesSelection`). It outlives the synthetic
	 * dispatch N-4 removes, because auto-rho still fires asynchronously ~500 ms
	 * after a selection change and runs these handlers with the previous lap's
	 * values. See 07-RESEARCH.md §Priority 6, behaviour 1.
	 */
	mapCanFollow?: () => boolean;
	triggerAutoRho?: () => void;
	/**
	 * N-3: the windows the air-speed sync error is measured over, one per
	 * `ModeSegment`. Standard supplies its single trim window — so its displayed
	 * number is unchanged — and the GPS modes supply one per lap or per section.
	 */
	getOffsetMetricWindows?: () => OffsetMetricWindow[];
	getSyncErrorSeries?: () => { groundSpeed: number[]; airSpeed: number[] };
	/**
	 * Compute this mode's auto air-speed calibration. The segments it is derived
	 * from are mode-specific (Standard: the trim window; GPS: the lap or section
	 * ranges), so the row stays declarative and the arithmetic stays with the
	 * mode. Returning null means "no usable answer" and the control does nothing.
	 */
	getAutoCalibrationPercent?: () => number | null;
	/**
	 * Escape hatch for a wind source a mode still handles itself. Returning true
	 * means the mode took over and the funnel must not also be asked.
	 *
	 * Exactly one caller: Standard's `compare`. Plan 07-04 (D-07/D-20) deletes it.
	 */
	onWindSourceSelected?: (windSource: string) => boolean;
}

function element(id: string | undefined): HTMLElement | null {
	if (!id || typeof document === "undefined") return null;
	return document.getElementById(id);
}

function input(id: string | undefined): HTMLInputElement | null {
	return element(id) as HTMLInputElement | null;
}

/** Does this mode's template actually render the row's elements? */
function isRendered(spec: ModeControlSpec): boolean {
	const { rangeId, numberId, buttonId } = spec.elements;
	if (rangeId || numberId) {
		return !!input(rangeId) && !!input(numberId);
	}
	if (buttonId) {
		return !!element(buttonId);
	}
	// Radio groups, toggles and delegated blocks do their own presence checks.
	return true;
}

function clamp(value: number, min: number, max: number): number {
	return Math.max(min, Math.min(value, max));
}

export function bindModeControls(options: BindModeControlsOptions): void {
	const { appState, modeId, saveSettings } = options;

	/**
	 * Steps 2 and 3 of every handler. `trimWindow` is supplied only by the rows
	 * that declare `movesMap`, which are the only ones that have one.
	 */
	function finish(
		spec: ModeControlSpec,
		trimWindow?: { start: number; end: number },
	): void {
		requestModeUpdate(spec.reason);

		if (spec.movesMap && trimWindow && options.mapCanFollow?.()) {
			options.onTrimMapUpdate?.(trimWindow.start, trimWindow.end);
		}
		if (spec.triggersAutoRho) {
			options.triggerAutoRho?.();
		}
		if (spec.refreshesOffsetMetric) {
			refreshOffsetMetric(spec);
		}
		if (spec.persistsSettings) {
			saveSettings();
		}
	}

	/**
	 * N-3, generalised: one sync error per segment window, displayed as the
	 * NaN-skipping mean. Standard has exactly one window (its trim), so this is a
	 * pure extension of what it already showed, not a redefinition.
	 */
	function refreshOffsetMetric(spec: ModeControlSpec): void {
		const metric = element(spec.elements.metricId);
		if (!metric) return;

		const windows = options.getOffsetMetricWindows?.();
		const series = options.getSyncErrorSeries?.();
		if (!windows || !series || windows.length === 0) return;

		const offsetInput = input("airSpeedOffsetSlider");
		const offset = offsetInput ? parseInt(offsetInput.value) : NaN;
		if (Number.isNaN(offset)) return;

		const errors: number[] = [];
		for (const window of windows) {
			const error = calculateAirSpeedSyncError(
				series.groundSpeed,
				series.airSpeed,
				offset,
				window.start,
				window.end,
			);
			if (!Number.isNaN(error)) {
				errors.push(error);
			}
		}
		if (errors.length === 0) return;

		const mean = errors.reduce((sum, value) => sum + value, 0) / errors.length;
		metric.textContent = mean.toFixed(2);
	}

	function trimWindowNow(): { start: number; end: number } | null {
		const startSlider = input("trimStartSlider");
		const endSlider = input("trimEndSlider");
		if (!startSlider || !endSlider) return null;
		const start = parseInt(startSlider.value);
		const end = parseInt(endSlider.value);
		if (Number.isNaN(start) || Number.isNaN(end)) return null;
		return { start, end };
	}

	function writeTrim(role: "start" | "end", value: number): void {
		const slider = input(role === "start" ? "trimStartSlider" : "trimEndSlider");
		const number = input(role === "start" ? "trimStartValue" : "trimEndValue");
		if (slider) slider.value = value.toString();
		if (number) number.value = value.toString();

		// The map's twin sliders mirror the main ones. They used to do this with
		// four extra listeners on the main controls; mirroring from the one place
		// that already knows the new value is the same behaviour with no second
		// wiring surface.
		const mapSlider = input(
			role === "start" ? "mapTrimStartSlider" : "mapTrimEndSlider",
		);
		const mapNumber = input(
			role === "start" ? "mapTrimStartValue" : "mapTrimEndValue",
		);
		if (mapSlider) mapSlider.value = value.toString();
		if (mapNumber) mapNumber.value = value.toString();
	}

	/**
	 * Shared by the `trim` rows and their `mapTrim` twins — the map sliders were
	 * always a second face of the same control and delegated to these handlers.
	 */
	function handleTrim(spec: ModeControlSpec, rawValue: number): void {
		const role = spec.elements.role === "end" ? "end" : "start";
		const window = trimWindowNow();
		if (!window || Number.isNaN(rawValue)) return;

		if (role === "start") {
			const limit = window.end - MIN_TRIM_WINDOW_SAMPLES;
			const value = clamp(rawValue, 0, Number.POSITIVE_INFINITY);
			if (value >= limit) {
				// Clamped: park the slider and skip the update, as before.
				writeTrim("start", limit);
				return;
			}
			writeTrim("start", value);
			finish(spec, { start: value, end: window.end });
			return;
		}

		const endSlider = input("trimEndSlider");
		const maxIndex = endSlider ? parseInt(endSlider.max) : NaN;
		const limit = window.start + MIN_TRIM_WINDOW_SAMPLES;
		const value = Number.isNaN(maxIndex)
			? rawValue
			: Math.min(rawValue, maxIndex);
		if (value <= limit) {
			writeTrim("end", limit);
			return;
		}
		writeTrim("end", value);
		finish(spec, { start: window.start, end: value });
	}

	function handleRangeNumber(spec: ModeControlSpec, rawValue: number): void {
		if (Number.isNaN(rawValue)) return;

		const params = appState.currentParameters;

		switch (spec.reason) {
			case "trim":
			case "mapTrim":
				handleTrim(spec, rawValue);
				return;

			case "cda": {
				const value = params
					? clamp(rawValue, params.cda_min, params.cda_max)
					: rawValue;
				writeBoth(spec, value, 3);
				finish(spec);
				return;
			}

			case "crr": {
				const value = params
					? clamp(rawValue, params.crr_min, params.crr_max)
					: rawValue;
				writeBoth(spec, value, 4);
				finish(spec);
				return;
			}

			case "calibration": {
				const value = clampAirSpeedCalibrationPercent(rawValue);
				writeBoth(spec, value, 1);
				// Lives in AppState, deliberately not a persisted parameter: it is a
				// runtime adjustment, not something the file carries.
				appState.airSpeedCalibrationPercent = value;
				finish(spec);
				return;
			}

			case "airSpeedOffset": {
				const value = clamp(
					Math.round(rawValue),
					AIR_SPEED_OFFSET_MIN_SECONDS,
					AIR_SPEED_OFFSET_MAX_SECONDS,
				);
				writeBoth(spec, value, 0);
				mergeAnalysisParameters({ air_speed_offset: value });
				finish(spec);
				return;
			}

			default:
				finish(spec);
		}
	}

	function writeBoth(
		spec: ModeControlSpec,
		value: number,
		decimals: number,
	): void {
		const range = input(spec.elements.rangeId);
		const number = input(spec.elements.numberId);
		if (range) range.value = value.toString();
		if (number) number.value = value.toFixed(decimals);
	}

	for (const spec of controlsForMode(modeId)) {
		if (!isRendered(spec)) {
			log.debug(
				`bindModeControls(${modeId}): ${spec.reason} not rendered, skipping`,
			);
			continue;
		}

		switch (spec.kind) {
			case "rangeNumber":
				syncRangeAndNumber(
					{
						rangeId: spec.elements.rangeId!,
						numberId: spec.elements.numberId!,
						decimals: spec.decimals ?? 1,
					},
					(value) => handleRangeNumber(spec, value),
				);
				break;

			case "button":
				element(spec.elements.buttonId)?.addEventListener("click", () => {
					const percent = options.getAutoCalibrationPercent?.();
					if (percent === null || percent === undefined) return;
					const value = clampAirSpeedCalibrationPercent(percent);
					const slider = input("airSpeedCalibrationSlider");
					const number = input("airSpeedCalibrationValue");
					if (slider) slider.value = value.toFixed(1);
					if (number) number.value = value.toFixed(1);
					appState.airSpeedCalibrationPercent = value;
					finish(spec);
				});
				break;

			case "radioGroup":
				bindWindSourceRadios(() => {
					const windSource = getSelectedWindSource();
					if (options.onWindSourceSelected?.(windSource)) {
						// The mode handled it (Standard's compare branch).
						return;
					}
					finish(spec);
				});
				break;

			case "toggle":
				bindElevationSmoothingToggle(appState, () => finish(spec));
				break;

			case "delegated": {
				const binding = {
					getParams: () => appState.currentParameters,
					setParams: (fields: Parameters<typeof mergeAnalysisParameters>[0]) => {
						mergeAnalysisParameters(fields);
					},
					onChange: () => finish(spec),
				};
				if (spec.reason === "crrTemp") {
					bindCrrTempControls(binding);
				} else {
					bindWindHeightControls(binding);
				}
				break;
			}
		}

		// The offset readout must be right before the first interaction, not only
		// after one. When the span is absent this is a no-op, which is what keeps
		// the binder safe against template drift.
		if (spec.refreshesOffsetMetric) {
			refreshOffsetMetric(spec);
		}
	}
}
