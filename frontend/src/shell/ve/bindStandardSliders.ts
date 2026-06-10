import { AppState, WindSource } from "../../state/AppState";
import {
	AnalysisInput,
	createAnalysisInput,
} from "../../analysis/AnalysisInput";
import { log } from "../../utils/log";
import { MapVisualization } from "../../components/MapVisualization";
import { AnalysisParametersComponent } from "../../components/AnalysisParameters";
import { getSelectedWindSource, bindWindSourceRadios } from "../dom/windSource";
import {
	clampAirSpeedCalibrationPercent,
	calculateAutoAirSpeedCalibrationPercent,
} from "../../analysis/AirSpeedCalibration";
import {
	calculateAirSpeedSyncError,
	applyAirSpeedOffset,
} from "../../analysis/WindSourceResolver";
import { createPlotContext } from "../../plots/PlotContext";
import {
	buildVirtualElevationFigures,
	buildVirtualElevationComparisonFigures,
	buildWindSpeedFigure,
	buildSpeedPowerFigure,
	buildVirtualDistanceFigure,
} from "../../plots/StandardPlotBuilders";
import { calculateAutoRho } from "./autoRho";
import { ShellServices } from "../analysis/types";
import { createVeCalculator } from "../../analysis/VeCalculatorFactory";
import { resolveAppliedCrr } from "../../analysis/CrrTemperatureCorrection";
import { bindCrrTempControls } from "./crrTempControls";
import { scheduleRecompute } from "../analysis/recomputeRunner";
import { bindElevationSmoothingToggle } from "../analysis/elevationProfileCycle";
import {
	DEM_PROFILE_FALLBACK_ORDER,
	type ElevationDisplayProfile,
} from "../../analysis/elevationProfiles";

const MIN_TRIM_WINDOW_SAMPLES = 30;

// Plotly.js type declaration
declare const Plotly: any;

function updateMetricsDisplay(
	r2: number,
	rmse: number,
	veGain: number,
	actualGain: number,
): void {
	const r2ValueSpan = document.getElementById("r2Value");
	if (r2ValueSpan) r2ValueSpan.textContent = r2.toFixed(4);

	const rmseValueSpan = document.getElementById("rmseValue");
	if (rmseValueSpan) rmseValueSpan.textContent = rmse.toFixed(2) + "m";

	const veGainValueSpan = document.getElementById("veGainValue");
	if (veGainValueSpan) veGainValueSpan.textContent = veGain.toFixed(2) + "m";

	const actualGainValueSpan = document.getElementById("actualGainValue");
	if (actualGainValueSpan)
		actualGainValueSpan.textContent = actualGain.toFixed(2) + "m";
}

function isValidSelectionProfile(
	profile: number[] | null,
	selectedIndices: number[],
): profile is number[] {
	if (!profile) return false;
	if (selectedIndices.length === 0) return false;
	return selectedIndices.every((index) => index >= 0 && index < profile.length);
}

function filterProfileBySelection(
	profile: number[],
	selectedIndices: number[],
): number[] {
	return selectedIndices.map((index) => profile[index]);
}

function resolveActiveAltitudeForSelection(
	appState: AppState,
	selectedIndices: number[],
	fallbackAltitude: number[],
): number[] {
	if (selectedIndices.length !== fallbackAltitude.length) {
		return fallbackAltitude;
	}

	const byProfile: Record<ElevationDisplayProfile, number[] | null> = {
		"fit-raw": appState.fitRawElevation,
		"dem-raw-nearest": appState.demRawNearestElevation,
		"dem-interpolated-smoothed-5pt":
			appState.demInterpolatedSmoothed5ptElevation,
	};

	const activeProfile = byProfile[appState.activeDisplayProfile];
	if (isValidSelectionProfile(activeProfile, selectedIndices)) {
		return filterProfileBySelection(activeProfile, selectedIndices);
	}

	for (const profileKey of DEM_PROFILE_FALLBACK_ORDER) {
		const candidate = byProfile[profileKey];
		if (isValidSelectionProfile(candidate, selectedIndices)) {
			return filterProfileBySelection(candidate, selectedIndices);
		}
	}

	const fitRaw = byProfile["fit-raw"];
	if (isValidSelectionProfile(fitRaw, selectedIndices)) {
		return filterProfileBySelection(fitRaw, selectedIndices);
	}

	return fallbackAltitude;
}

/**
 * Update Virtual Elevation plots based on current slider values.
 */
export function updateVEPlots(
	appState: AppState,
	analysisInput: AnalysisInput,
	selectedIndices: number[],
	trimStart: number,
	trimEnd: number,
) {
	scheduleRecompute({
		mode: "standard",
		run: async () => {
			const windSource = getSelectedWindSource() as WindSource;
			await updateVEPlotsWithWindSource(
				appState,
				analysisInput,
				selectedIndices,
				trimStart,
				trimEnd,
				windSource,
			);
		},
	});
}

/**
 * Update Virtual Elevation plots with a specific wind source.
 */
export async function updateVEPlotsWithWindSource(
	appState: AppState,
	analysisInput: AnalysisInput,
	selectedIndices: number[],
	trimStart: number,
	trimEnd: number,
	windSource: WindSource,
) {
	if (!appState.currentParameters) return;

	const cdaSlider = document.getElementById("cdaSlider") as HTMLInputElement;
	const crrSlider = document.getElementById("crrSlider") as HTMLInputElement;

	if (!cdaSlider || !crrSlider) return;

	const cda = parseFloat(cdaSlider.value);
	// The slider value is the 22 °C-referenced Crr; the physics uses the
	// temperature-corrected value when the correction is enabled.
	const crr = resolveAppliedCrr(
		appState.currentParameters,
		parseFloat(crrSlider.value),
	);

	const context = createPlotContext(
		analysisInput.timestamps.length,
		trimStart,
		trimEnd,
	);
	const activeAltitude = resolveActiveAltitudeForSelection(
		appState,
		selectedIndices,
		analysisInput.altitude,
	);

	if (windSource === "compare") {
		const constantWindSpeed = new Array(analysisInput.windSpeed.length).fill(
			NaN,
		);
		const calculator1 = createVeCalculator({
			timestamps: analysisInput.timestamps,
			power: analysisInput.power,
			velocity: analysisInput.velocity,
			positionLat: analysisInput.positionLat,
			positionLong: analysisInput.positionLong,
			altitude: activeAltitude,
			distance: analysisInput.distance,
			windSpeed: constantWindSpeed,
			params: appState.currentParameters,
			cda,
			crr,
		});

		const windSpeedOffset = appState.currentParameters.air_speed_offset || 0;
		const offsetWindSpeed = applyAirSpeedOffset(
			analysisInput.windSpeed,
			windSpeedOffset,
		);
		const calibratedWindSpeed =
			appState.airSpeedCalibrationPercent !== 0
				? offsetWindSpeed.map(
						(speed) =>
							speed * (1.0 + appState.airSpeedCalibrationPercent / 100.0),
					)
				: offsetWindSpeed;

		const calculator2 = createVeCalculator({
			timestamps: analysisInput.timestamps,
			power: analysisInput.power,
			velocity: analysisInput.velocity,
			positionLat: analysisInput.positionLat,
			positionLong: analysisInput.positionLong,
			altitude: activeAltitude,
			distance: analysisInput.distance,
			windSpeed: calibratedWindSpeed,
			params: appState.currentParameters,
			cda,
			crr,
		});

		const result1 = calculator1.calculate_virtual_elevation(
			cda,
			crr,
			trimStart,
			trimEnd,
		);
		const result2 = calculator2.calculate_virtual_elevation(
			cda,
			crr,
			trimStart,
			trimEnd,
		);

		appState.currentVEResult = result1;
		appState.currentWindSource = "compare";

		const figures = buildVirtualElevationComparisonFigures({
			context,
			virtualElevationConstant: Array.from(result1.virtual_elevation),
			virtualElevationFit: Array.from(result2.virtual_elevation),
			actualElevation: activeAltitude,
		});
		Plotly.react(
			"vePlot",
			figures.elevation.data,
			figures.elevation.layout,
			figures.elevation.config,
		);
		Plotly.react(
			"veResidualsPlot",
			figures.residuals.data,
			figures.residuals.layout,
			figures.residuals.config,
		);

		updateMetricsDisplay(
			(result1.r2 + result2.r2) / 2,
			(result1.rmse + result2.rmse) / 2,
			(result1.ve_elevation_diff + result2.ve_elevation_diff) / 2,
			(result1.actual_elevation_diff + result2.actual_elevation_diff) / 2,
		);
	} else {
		let fitWindSpeed: number[];
		if (windSource === "fit") {
			const windSpeedOffset = appState.currentParameters.air_speed_offset || 0;
			const offsetWindSpeed = applyAirSpeedOffset(
				analysisInput.windSpeed,
				windSpeedOffset,
			);
			fitWindSpeed =
				appState.airSpeedCalibrationPercent !== 0
					? offsetWindSpeed.map(
							(speed) =>
								speed * (1.0 + appState.airSpeedCalibrationPercent / 100.0),
						)
					: offsetWindSpeed;
		} else {
			fitWindSpeed = new Array(analysisInput.windSpeed.length).fill(NaN);
		}

		const calculator = createVeCalculator({
			timestamps: analysisInput.timestamps,
			power: analysisInput.power,
			velocity: analysisInput.velocity,
			positionLat: analysisInput.positionLat,
			positionLong: analysisInput.positionLong,
			altitude: activeAltitude,
			distance: analysisInput.distance,
			windSpeed: fitWindSpeed,
			params: appState.currentParameters,
			cda,
			crr,
		});

		const result = calculator.calculate_virtual_elevation(
			cda,
			crr,
			trimStart,
			trimEnd,
		);
		appState.currentVEResult = result;
		appState.currentWindSource = windSource;

		const figures = buildVirtualElevationFigures({
			context,
			virtualElevation: Array.from(result.virtual_elevation),
			actualElevation: activeAltitude,
			cdaLabel: cda.toFixed(3),
			crrLabel: crr.toFixed(4),
		});
		Plotly.react(
			"vePlot",
			figures.elevation.data,
			figures.elevation.layout,
			figures.elevation.config,
		);
		Plotly.react(
			"veResidualsPlot",
			figures.residuals.data,
			figures.residuals.layout,
			figures.residuals.config,
		);

		updateMetricsDisplay(
			result.r2,
			result.rmse,
			result.ve_elevation_diff,
			result.actual_elevation_diff,
		);
	}
}

/**
 * Setup Standard VE panel sliders and their synchronization logic.
 */
export function setupVESliders(
	appState: AppState,
	parametersComponent: AnalysisParametersComponent | null,
	services: ShellServices,
	mapVisualization: MapVisualization | null,
	saveCurrentLapSettings: () => void,
	selectedIndices: number[],
	timestamps: number[],
	power: number[],
	velocity: number[],
	positionLat: number[],
	positionLong: number[],
	altitude: number[],
	distance: number[],
	windSpeed: number[],
	defaultAirSpeedOffset: number,
) {
	const analysisInput = createAnalysisInput({
		timestamps,
		power,
		velocity,
		positionLat,
		positionLong,
		altitude,
		distance,
		windSpeed,
	});

	if (!appState.currentParameters) {
		log.error("setupVESliders: appState.currentParameters is null");
		return;
	}
	const params = appState.currentParameters;

	const trimStartSlider = document.getElementById(
		"trimStartSlider",
	) as HTMLInputElement;
	const trimEndSlider = document.getElementById(
		"trimEndSlider",
	) as HTMLInputElement;
	const cdaSlider = document.getElementById("cdaSlider") as HTMLInputElement;
	const crrSlider = document.getElementById("crrSlider") as HTMLInputElement;

	const trimStartValue = document.getElementById(
		"trimStartValue",
	) as HTMLInputElement;
	const trimEndValue = document.getElementById(
		"trimEndValue",
	) as HTMLInputElement;
	const cdaValue = document.getElementById("cdaValue") as HTMLInputElement;
	const crrValue = document.getElementById("crrValue") as HTMLInputElement;

	if (
		!trimStartSlider ||
		!trimEndSlider ||
		!cdaSlider ||
		!crrSlider ||
		!trimStartValue ||
		!trimEndValue ||
		!cdaValue ||
		!crrValue
	) {
		log.warn("Standard VE sliders or values not found in DOM");
		return;
	}

	const updateSecondaryPlots = (start: number, end: number) => {
		const context = createPlotContext(timestamps.length, start, end);

		const windTab = document.getElementById("wind-tab");
		if (windTab && windTab.classList.contains("active")) {
			const hasWindSpeed = windSpeed.some(
				(value) => !isNaN(value) && value !== 0,
			);
			const windSpeedOffset =
				appState.currentParameters?.air_speed_offset ?? defaultAirSpeedOffset;
			const calibrationPercent = appState.airSpeedCalibrationPercent;
			const calibrationMultiplier = 1 + calibrationPercent / 100;
			const fitWindSpeedKmh = hasWindSpeed
				? applyAirSpeedOffset(windSpeed, windSpeedOffset).map((value) => {
						if (isNaN(value)) return null;
						const calibrated =
							calibrationPercent !== 0 ? value * calibrationMultiplier : value;
						return calibrated * 3.6;
					})
				: new Array<number | null>(velocity.length).fill(null);

			const fig = buildWindSpeedFigure({
				context,
				velocity,
				fitWindSpeedKmh,
			});
			Plotly.react("windSpeedPlot", fig.data, fig.layout, fig.config);
		}
		const powerTab = document.getElementById("power-tab");
		if (powerTab && powerTab.classList.contains("active")) {
			const fig = buildSpeedPowerFigure({
				context,
				velocity,
				power,
			});
			Plotly.react("speedPowerPlot", fig.data, fig.layout, fig.config);
		}
		const vdTab = document.getElementById("vd-tab");
		if (vdTab && vdTab.classList.contains("active")) {
			const fig = buildVirtualDistanceFigure({
				context,
				timestamps,
				velocity,
				windSpeed,
				airSpeedCalibrationPercent: appState.airSpeedCalibrationPercent,
			});
			Plotly.react("vdPlot", fig.data, fig.layout, fig.config);
		}
	};

	const updateTrimStart = () => {
		const value = parseInt(trimStartSlider.value);
		trimStartValue.value = value.toString();
		const trimEnd = parseInt(trimEndSlider.value);
		if (value >= trimEnd - MIN_TRIM_WINDOW_SAMPLES) {
			const corrected = trimEnd - MIN_TRIM_WINDOW_SAMPLES;
			trimStartSlider.value = corrected.toString();
			trimStartValue.value = corrected.toString();
			return;
		}
		updateVEPlots(appState, analysisInput, selectedIndices, value, trimEnd);
		updateSecondaryPlots(value, trimEnd);
		if (mapVisualization) {
			mapVisualization.fitBoundsToTrimRegion(
				value,
				trimEnd,
				positionLat,
				positionLong,
			);
		}
		triggerAutoRhoOnTrimChange();
		saveCurrentLapSettings();
	};

	const updateTrimEnd = () => {
		const value = parseInt(trimEndSlider.value);
		trimEndValue.value = value.toString();
		const trimStart = parseInt(trimStartSlider.value);
		if (value <= trimStart + MIN_TRIM_WINDOW_SAMPLES) {
			const corrected = trimStart + MIN_TRIM_WINDOW_SAMPLES;
			trimEndSlider.value = corrected.toString();
			trimEndValue.value = corrected.toString();
			return;
		}
		updateVEPlots(appState, analysisInput, selectedIndices, trimStart, value);
		updateSecondaryPlots(trimStart, value);
		if (mapVisualization) {
			mapVisualization.fitBoundsToTrimRegion(
				trimStart,
				value,
				positionLat,
				positionLong,
			);
		}
		triggerAutoRhoOnTrimChange();
		saveCurrentLapSettings();
	};

	const updateCdA = () => {
		const value = parseFloat(cdaSlider.value);
		cdaValue.value = value.toFixed(3);
		const trimStart = parseInt(trimStartSlider.value);
		const trimEnd = parseInt(trimEndSlider.value);
		updateVEPlots(appState, analysisInput, selectedIndices, trimStart, trimEnd);
		saveCurrentLapSettings();
	};

	const updateCrr = () => {
		const value = parseFloat(crrSlider.value);
		crrValue.value = value.toFixed(4);
		const trimStart = parseInt(trimStartSlider.value);
		const trimEnd = parseInt(trimEndSlider.value);
		updateVEPlots(appState, analysisInput, selectedIndices, trimStart, trimEnd);
		saveCurrentLapSettings();
	};

	const updateTrimStartFromInput = () => {
		const value = parseInt(trimStartValue.value);
		if (isNaN(value)) return;
		const trimEnd = parseInt(trimEndSlider.value);
		const clamped = Math.max(
			0,
			Math.min(value, trimEnd - MIN_TRIM_WINDOW_SAMPLES),
		);
		trimStartSlider.value = clamped.toString();
		trimStartValue.value = clamped.toString();
		updateVEPlots(appState, analysisInput, selectedIndices, clamped, trimEnd);
		updateSecondaryPlots(clamped, trimEnd);
		if (mapVisualization) {
			mapVisualization.fitBoundsToTrimRegion(
				clamped,
				trimEnd,
				positionLat,
				positionLong,
			);
		}
		triggerAutoRhoOnTrimChange();
		saveCurrentLapSettings();
	};

	const updateTrimEndFromInput = () => {
		const value = parseInt(trimEndValue.value);
		if (isNaN(value)) return;
		const trimStart = parseInt(trimStartSlider.value);
		const clamped = Math.max(
			trimStart + MIN_TRIM_WINDOW_SAMPLES,
			Math.min(value, timestamps.length - 1),
		);
		trimEndSlider.value = clamped.toString();
		trimEndValue.value = clamped.toString();
		updateVEPlots(appState, analysisInput, selectedIndices, trimStart, clamped);
		updateSecondaryPlots(trimStart, clamped);
		if (mapVisualization) {
			mapVisualization.fitBoundsToTrimRegion(
				trimStart,
				clamped,
				positionLat,
				positionLong,
			);
		}
		triggerAutoRhoOnTrimChange();
		saveCurrentLapSettings();
	};

	const updateCdAFromInput = () => {
		const value = parseFloat(cdaValue.value);
		if (isNaN(value)) return;
		const clamped = Math.max(params.cda_min, Math.min(value, params.cda_max));
		cdaSlider.value = clamped.toString();
		cdaValue.value = clamped.toFixed(3);
		const trimStart = parseInt(trimStartSlider.value);
		const trimEnd = parseInt(trimEndSlider.value);
		updateVEPlots(appState, analysisInput, selectedIndices, trimStart, trimEnd);
		saveCurrentLapSettings();
	};

	const updateCrrFromInput = () => {
		const value = parseFloat(crrValue.value);
		if (isNaN(value)) return;
		const clamped = Math.max(params.crr_min, Math.min(value, params.crr_max));
		crrSlider.value = clamped.toString();
		crrValue.value = clamped.toFixed(4);
		const trimStart = parseInt(trimStartSlider.value);
		const trimEnd = parseInt(trimEndSlider.value);
		updateVEPlots(appState, analysisInput, selectedIndices, trimStart, trimEnd);
		saveCurrentLapSettings();
	};

	trimStartSlider.oninput = updateTrimStart;
	trimEndSlider.oninput = updateTrimEnd;
	cdaSlider.oninput = updateCdA;
	crrSlider.oninput = updateCrr;

	let autoRhoDebounceTimer: ReturnType<typeof setTimeout> | null = null;
	const triggerAutoRhoOnTrimChange = () => {
		if (autoRhoDebounceTimer) clearTimeout(autoRhoDebounceTimer);
		autoRhoDebounceTimer = setTimeout(() => {
			if (
				appState.currentParameters?.auto_calculate_rho &&
				!appState.isCalculatingAutoRho
			) {
				calculateAutoRho(appState, parametersComponent, services).catch(
					(err) => {
						log.error("Auto-rho calculation error on trim change:", err);
					},
				);
			}
		}, 500);
	};

	if (
		appState.currentParameters?.auto_calculate_rho &&
		!appState.isCalculatingAutoRho
	) {
		setTimeout(() => {
			calculateAutoRho(appState, parametersComponent, services).catch((err) => {
				log.error("Auto-rho initial calculation error:", err);
			});
		}, 1000);
	}

	trimStartValue.onchange = updateTrimStartFromInput;
	trimEndValue.onchange = updateTrimEndFromInput;
	cdaValue.onchange = updateCdAFromInput;
	crrValue.onchange = updateCrrFromInput;

	bindWindSourceRadios(() => {
		const trimStart = parseInt(trimStartSlider.value);
		const trimEnd = parseInt(trimEndSlider.value);
		updateVEPlots(appState, analysisInput, selectedIndices, trimStart, trimEnd);
	});

	const airSpeedCalibrationSlider = document.getElementById(
		"airSpeedCalibrationSlider",
	) as HTMLInputElement;
	const airSpeedCalibrationValue = document.getElementById(
		"airSpeedCalibrationValue",
	) as HTMLInputElement;

	if (airSpeedCalibrationSlider && airSpeedCalibrationValue) {
		// airSpeedCalibrationPercent lives in AppState (not persisted per-file)
		// so it bypasses the parameter storage layer and uses local update.
		// This is intentional - it's a runtime adjustment, not a saved parameter.
		// See analyzeOrchestrator.handleParametersChange for parameters that trigger orchestrator updates.
		const updateAirSpeedCalibration = () => {
			const value = parseFloat(airSpeedCalibrationSlider.value);
			airSpeedCalibrationValue.value = value.toFixed(1);
			appState.airSpeedCalibrationPercent = value;
			const trimStart = parseInt(trimStartSlider.value);
			const trimEnd = parseInt(trimEndSlider.value);
			updateVEPlots(
				appState,
				analysisInput,
				selectedIndices,
				trimStart,
				trimEnd,
			);
			updateSecondaryPlots(trimStart, trimEnd);
			saveCurrentLapSettings();
		};

		const updateAirSpeedCalibrationFromInput = () => {
			const value = parseFloat(airSpeedCalibrationValue.value);
			if (isNaN(value)) return;
			const clamped = clampAirSpeedCalibrationPercent(value);
			airSpeedCalibrationSlider.value = clamped.toString();
			airSpeedCalibrationValue.value = clamped.toFixed(1);
			appState.airSpeedCalibrationPercent = clamped;
			const trimStart = parseInt(trimStartSlider.value);
			const trimEnd = parseInt(trimEndSlider.value);
			updateVEPlots(
				appState,
				analysisInput,
				selectedIndices,
				trimStart,
				trimEnd,
			);
			updateSecondaryPlots(trimStart, trimEnd);
			saveCurrentLapSettings();
		};

		airSpeedCalibrationSlider.oninput = updateAirSpeedCalibration;
		airSpeedCalibrationValue.onchange = updateAirSpeedCalibrationFromInput;

		const autoAdjustButton = document.getElementById(
			"autoAdjustCalibration",
		) as HTMLButtonElement;
		if (autoAdjustButton) {
			autoAdjustButton.onclick = () => {
				const trimStart = parseInt(trimStartSlider.value);
				const trimEnd = parseInt(trimEndSlider.value);
				const calibrationPercent = calculateAutoAirSpeedCalibrationPercent([
					{
						timestamps,
						groundSpeed: velocity,
						apparentSpeed: windSpeed,
						startIndex: trimStart,
						endIndex: trimEnd,
					},
				]);
				if (calibrationPercent === null) return;
				airSpeedCalibrationSlider.value = calibrationPercent.toFixed(1);
				airSpeedCalibrationValue.value = calibrationPercent.toFixed(1);
				appState.airSpeedCalibrationPercent = calibrationPercent;
				updateVEPlots(
					appState,
					analysisInput,
					selectedIndices,
					trimStart,
					trimEnd,
				);
				updateSecondaryPlots(trimStart, trimEnd);
				saveCurrentLapSettings();
			};
		}
	}

	const airSpeedOffsetSlider = document.getElementById(
		"airSpeedOffsetSlider",
	) as HTMLInputElement;
	const airSpeedOffsetValue = document.getElementById(
		"airSpeedOffsetValue",
	) as HTMLInputElement;
	const airSpeedOffsetErrorMetric = document.getElementById(
		"airSpeedOffsetErrorMetric",
	) as HTMLSpanElement;

	if (airSpeedOffsetSlider && airSpeedOffsetValue) {
		const updateAirSpeedOffset = () => {
			const value = parseInt(airSpeedOffsetSlider.value);
			airSpeedOffsetValue.value = value.toString();
			if (parametersComponent && appState.currentParameters) {
				parametersComponent.setParameters({ air_speed_offset: value });
			}
			const trimStart = parseInt(trimStartSlider.value);
			const trimEnd = parseInt(trimEndSlider.value);
			const errorMetric = calculateAirSpeedSyncError(
				velocity,
				windSpeed,
				value,
				trimStart,
				trimEnd,
			);
			if (airSpeedOffsetErrorMetric && !isNaN(errorMetric)) {
				airSpeedOffsetErrorMetric.textContent = errorMetric.toFixed(2);
			}
			// Note: updateVEPlots is now triggered via orchestrator through handleParametersChange
			// when setParameters is called above. This avoids double updates.
			saveCurrentLapSettings();
		};

		const updateAirSpeedOffsetFromInput = () => {
			const value = parseInt(airSpeedOffsetValue.value);
			if (isNaN(value)) return;
			const clamped = Math.max(-10, Math.min(value, 10));
			airSpeedOffsetSlider.value = clamped.toString();
			airSpeedOffsetValue.value = clamped.toString();
			if (parametersComponent && appState.currentParameters) {
				parametersComponent.setParameters({ air_speed_offset: clamped });
			}
			const trimStart = parseInt(trimStartSlider.value);
			const trimEnd = parseInt(trimEndSlider.value);
			const errorMetric = calculateAirSpeedSyncError(
				velocity,
				windSpeed,
				clamped,
				trimStart,
				trimEnd,
			);
			if (airSpeedOffsetErrorMetric && !isNaN(errorMetric)) {
				airSpeedOffsetErrorMetric.textContent = errorMetric.toFixed(2);
			}
			// Note: updateVEPlots is now triggered via orchestrator through handleParametersChange
			// when setParameters is called above. This avoids double updates.
			saveCurrentLapSettings();
		};

		airSpeedOffsetSlider.oninput = updateAirSpeedOffset;
		airSpeedOffsetValue.onchange = updateAirSpeedOffsetFromInput;

		const trimStart = parseInt(trimStartSlider.value);
		const trimEnd = parseInt(trimEndSlider.value);
		const initialOffset =
			appState.currentParameters?.air_speed_offset ?? defaultAirSpeedOffset;
		const initialError = calculateAirSpeedSyncError(
			velocity,
			windSpeed,
			initialOffset,
			trimStart,
			trimEnd,
		);
		if (airSpeedOffsetErrorMetric && !isNaN(initialError)) {
			airSpeedOffsetErrorMetric.textContent = initialError.toFixed(2);
		}
	}

	bindElevationSmoothingToggle(appState, () => {
		const trimStart = parseInt(trimStartSlider.value);
		const trimEnd = parseInt(trimEndSlider.value);
		updateVEPlots(appState, analysisInput, selectedIndices, trimStart, trimEnd);
		updateSecondaryPlots(trimStart, trimEnd);
		saveCurrentLapSettings();
	});

	bindCrrTempControls({
		getParams: () => appState.currentParameters,
		setParams: (fields) => {
			if (parametersComponent) {
				// Persists per-file via the orchestrator's parameter storage path.
				parametersComponent.setParameters(fields);
			} else if (appState.currentParameters) {
				Object.assign(appState.currentParameters, fields);
			}
		},
		onChange: () => {
			const trimStart = parseInt(trimStartSlider.value);
			const trimEnd = parseInt(trimEndSlider.value);
			updateVEPlots(appState, analysisInput, selectedIndices, trimStart, trimEnd);
		},
	});

	const mapTrimControls = document.getElementById("mapTrimControls");
	const mapTrimStartSlider = document.getElementById(
		"mapTrimStartSlider",
	) as HTMLInputElement;
	const mapTrimEndSlider = document.getElementById(
		"mapTrimEndSlider",
	) as HTMLInputElement;
	const mapTrimStartValue = document.getElementById(
		"mapTrimStartValue",
	) as HTMLInputElement;
	const mapTrimEndValue = document.getElementById(
		"mapTrimEndValue",
	) as HTMLInputElement;

	if (
		mapTrimControls &&
		mapTrimStartSlider &&
		mapTrimEndSlider &&
		mapTrimStartValue &&
		mapTrimEndValue
	) {
		mapTrimControls.style.display = "flex";
		mapTrimStartSlider.min = "0";
		mapTrimStartSlider.max = (
			timestamps.length - MIN_TRIM_WINDOW_SAMPLES
		).toString();
		mapTrimStartSlider.value = appState.presetTrimStart.toString();
		mapTrimStartValue.value = appState.presetTrimStart.toString();
		mapTrimStartValue.min = "0";
		mapTrimStartValue.max = (
			timestamps.length - MIN_TRIM_WINDOW_SAMPLES
		).toString();

		const initialTrimEnd = appState.presetTrimEnd ?? timestamps.length - 1;
		mapTrimEndSlider.min = MIN_TRIM_WINDOW_SAMPLES.toString();
		mapTrimEndSlider.max = (timestamps.length - 1).toString();
		mapTrimEndSlider.value = initialTrimEnd.toString();
		mapTrimEndValue.value = initialTrimEnd.toString();
		mapTrimEndValue.min = MIN_TRIM_WINDOW_SAMPLES.toString();
		mapTrimEndValue.max = (timestamps.length - 1).toString();

		const syncMapToMain = () => {
			mapTrimStartSlider.value = trimStartSlider.value;
			mapTrimStartValue.value = trimStartValue.value;
			mapTrimEndSlider.value = trimEndSlider.value;
			mapTrimEndValue.value = trimEndValue.value;
		};

		trimStartSlider.addEventListener("input", syncMapToMain);
		trimEndSlider.addEventListener("input", syncMapToMain);
		trimStartValue.addEventListener("change", syncMapToMain);
		trimEndValue.addEventListener("change", syncMapToMain);

		mapTrimStartSlider.oninput = () => {
			mapTrimStartValue.value = mapTrimStartSlider.value;
			trimStartSlider.value = mapTrimStartSlider.value;
			trimStartValue.value = mapTrimStartSlider.value;
			updateTrimStart();
		};
		mapTrimEndSlider.oninput = () => {
			mapTrimEndValue.value = mapTrimEndSlider.value;
			trimEndSlider.value = mapTrimEndSlider.value;
			updateTrimEnd();
		};
		mapTrimStartValue.onchange = () => {
			const value = parseInt(mapTrimStartValue.value);
			if (!isNaN(value)) {
				const trimEnd = parseInt(trimEndSlider.value);
				const clamped = Math.max(
					0,
					Math.min(value, trimEnd - MIN_TRIM_WINDOW_SAMPLES),
				);
				mapTrimStartSlider.value = clamped.toString();
				mapTrimStartValue.value = clamped.toString();
				trimStartSlider.value = clamped.toString();
				trimStartValue.value = clamped.toString();
				updateTrimStart();
			}
		};
		mapTrimEndValue.onchange = () => {
			const value = parseInt(mapTrimEndValue.value);
			if (!isNaN(value)) {
				const trimStart = parseInt(trimStartSlider.value);
				const clamped = Math.max(
					trimStart + MIN_TRIM_WINDOW_SAMPLES,
					Math.min(value, timestamps.length - 1),
				);
				mapTrimEndSlider.value = clamped.toString();
				mapTrimEndValue.value = clamped.toString();
				trimEndSlider.value = clamped.toString();
				trimEndValue.value = clamped.toString();
				updateTrimEnd();
			}
		};
	}
}
