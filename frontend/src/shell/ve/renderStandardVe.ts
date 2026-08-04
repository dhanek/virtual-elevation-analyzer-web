import { AppState } from "../../state/AppState";
import {
	AnalysisInput,
	createAnalysisInput,
} from "../../analysis/AnalysisInput";
import { log } from "../../utils/log";
import { MapVisualization } from "../../components/MapVisualization";
import {
	AnalysisParametersComponent,
	DEFAULT_PARAMETERS,
} from "../../components/AnalysisParameters";
import { setupTabSwitching } from "../dom/tabs";
import { bindActionFooter } from "../dom/actionFooter";
import { getSelectedWindSource } from "../dom/windSource";
import {
	AIR_SPEED_CALIBRATION_MAX_PERCENT,
	AIR_SPEED_CALIBRATION_MIN_PERCENT,
	AIR_SPEED_CALIBRATION_STEP_PERCENT,
} from "../../analysis/AirSpeedCalibration";
import { createPlotContext } from "../../plots/PlotContext";
import {
	buildVirtualElevationFigures,
	buildWindSpeedFigure,
	buildSpeedPowerFigure,
	buildVirtualDistanceFigure,
} from "../../plots/StandardPlotBuilders";
import { setupVESliders } from "./bindStandardSliders";
import { resolveAppliedCrr } from "../../analysis/CrrTemperatureCorrection";
import { crrTempControlsMarkup } from "./crrTempControls";
import { windHeightControlsMarkup } from "./windHeightControls";
import { ParameterStorage } from "../../utils/ParameterStorage";
import { ShellServices } from "../analysis/types";
import { createVeCalculator } from "../../analysis/VeCalculatorFactory";
import { resolveSelectionWindSeries } from "./standardSegments";
import {
	selectedLapCount,
	updateCombinedVirtualDistanceHeader,
	virtualDistanceHeaderMarkup,
} from "./vdHeader";
import { elevationSmoothingToggleMarkup } from "../analysis/elevationProfileCycle";
import { bindLapViewToggle, lapViewToggleMarkup } from "./lapViewToggle";

// Plotly.js type declaration
declare const Plotly: any;

const MIN_TRIM_WINDOW_SAMPLES = 30;

export interface StandardVeCallbacks {
	onSaveScreenshot: () => void;
	onStoreResult: () => void;
	onExportAll: () => void;
	saveCurrentLapSettings: () => void;
}

/**
 * Initialize the Virtual Elevation analysis plots.
 */
export async function initializeVEAnalysis(
	appState: AppState,
	analysisInput: AnalysisInput,
	selectedIndices: number[],
) {
	const trimStart = appState.presetTrimStart;
	const trimEnd = appState.presetTrimEnd ?? analysisInput.timestamps.length - 1;

	// Use initial CdA and Crr from parameters
	const initialCdA = appState.currentParameters?.cda ?? 0.3;
	const initialCrr = appState.currentParameters?.crr ?? 0.005;
	const appliedInitialCrr = appState.currentParameters
		? resolveAppliedCrr(appState.currentParameters, initialCrr)
		: initialCrr;
	const initialWindSource = getSelectedWindSource();

	const context = createPlotContext(
		analysisInput.timestamps.length,
		trimStart,
		trimEnd,
	);

	const calculator = createVeCalculator({
		timestamps: analysisInput.timestamps,
		power: analysisInput.power,
		velocity: analysisInput.velocity,
		positionLat: analysisInput.positionLat,
		positionLong: analysisInput.positionLong,
		altitude: analysisInput.altitude,
		distance: analysisInput.distance,
		windSpeed:
			initialWindSource === "fit"
				? analysisInput.windSpeed
				: new Array(analysisInput.windSpeed.length).fill(NaN),
		params: appState.currentParameters!,
		cda: initialCdA,
		crr: appliedInitialCrr,
	});

	const result = calculator.calculate_virtual_elevation(
		initialCdA,
		appliedInitialCrr,
		trimStart,
		trimEnd,
	);

	// Create plots
	const figures = buildVirtualElevationFigures({
		context,
		virtualElevation: Array.from(result.virtual_elevation),
		actualElevation: analysisInput.altitude,
		cdaLabel: initialCdA.toFixed(3),
		crrLabel: appliedInitialCrr.toFixed(4),
	});

	// D-05: the last of the five inline wind copies is gone from here too. This
	// one applied the offset but NOT the calibration, so the initial Standard
	// wind plot disagreed with the VE fit above it whenever the calibration
	// slider was non-zero -- and disagreed with `updateSecondaryPlots`, which
	// applied both. All three now read one resolved series.
	//
	// The series is resolved over the FULL activity and sliced afterwards, which
	// is the ordering that keeps the offset from crossing a lap boundary in a
	// multi-lap selection (D-09 change-list entry c).
	const resolvedWindSpeed = resolveSelectionWindSeries(
		appState,
		selectedIndices,
		initialWindSource === "fit" ? "fit" : "constant",
	);
	const hasWindSpeed = resolvedWindSpeed.some(
		(value) => !isNaN(value) && value !== 0,
	);
	const fitWindSpeedKmh = hasWindSpeed
		? resolvedWindSpeed.map((value) => (isNaN(value) ? null : value * 3.6))
		: new Array<number | null>(analysisInput.velocity.length).fill(null);

	const windSpeedFigure = buildWindSpeedFigure({
		context,
		velocity: analysisInput.velocity,
		fitWindSpeedKmh,
	});

	const speedPowerFigure = buildSpeedPowerFigure({
		context,
		velocity: analysisInput.velocity,
		power: analysisInput.power,
	});

	// D-21: the builder no longer takes (or applies) a calibration percentage.
	// It integrates exactly the series it is handed, which is already offset and
	// calibrated. A second application is now a compile error.
	const virtualDistanceInput = {
		context,
		timestamps: analysisInput.timestamps,
		velocity: analysisInput.velocity,
		windSpeed: resolvedWindSpeed,
	};
	const virtualDistanceFigure = buildVirtualDistanceFigure(
		virtualDistanceInput,
	);

	Plotly.newPlot(
		"vePlot",
		figures.elevation.data,
		figures.elevation.layout,
		figures.elevation.config,
	);
	Plotly.newPlot(
		"veResidualsPlot",
		figures.residuals.data,
		figures.residuals.layout,
		figures.residuals.config,
	);
	Plotly.newPlot(
		"windSpeedPlot",
		windSpeedFigure.data,
		windSpeedFigure.layout,
		windSpeedFigure.config,
	);
	Plotly.newPlot(
		"speedPowerPlot",
		speedPowerFigure.data,
		speedPowerFigure.layout,
		speedPowerFigure.config,
	);
	Plotly.newPlot(
		"vdPlot",
		virtualDistanceFigure.data,
		virtualDistanceFigure.layout,
		virtualDistanceFigure.config,
	);
	// The template leaves the header empty on purpose; fill it from the same
	// integration that just drew the curve, so the first paint and every later
	// slider-driven redraw agree.
	//
	// This placeholder paint has no per-segment decomposition -- it integrates
	// the concatenated selection in one pass -- so a multi-lap selection gets the
	// labelled combined figure here. The synthetic `input` dispatch on
	// #trimStartSlider (below) immediately routes through the primitive and
	// replaces it with the honest per-lap lines.
	updateCombinedVirtualDistanceHeader(
		virtualDistanceInput,
		selectedLapCount(appState),
	);

	appState.filteredVEData = {
		positionLat: analysisInput.positionLat,
		positionLong: analysisInput.positionLong,
	};
}

/**
 * Show the Virtual Elevation analysis interface inline.
 */
export async function showVirtualElevationAnalysisInline(
	appState: AppState,
	parameterStorage: ParameterStorage,
	parametersComponent: AnalysisParametersComponent | null,
	services: ShellServices,
	mapVisualization: MapVisualization | null,
	callbacks: StandardVeCallbacks,
	initialResult: any,
	analyzedLaps: number[],
	selectedIndices: number[],
	timestamps: number[],
	power: number[],
	velocity: number[],
	positionLat: number[],
	positionLong: number[],
	altitude: number[],
	distance: number[],
	windSpeed: number[],
	temperature: number[] = [],
	cdaReference: number[] | null = null,
	defaultAirSpeedOffset: number = 0,
) {
	if (!appState.currentParameters) {
		appState.currentParameters = { ...DEFAULT_PARAMETERS };
	}

	if (appState.currentFileHash && parameterStorage) {
		const savedParams = await parameterStorage.loadLapSettings(
			appState.currentFileHash,
			analyzedLaps,
		);
		if (savedParams) {
			if (savedParams.cda !== null)
				appState.currentParameters.cda = savedParams.cda;
			if (savedParams.crr !== null)
				appState.currentParameters.crr = savedParams.crr;
			if (savedParams.trimStart !== undefined)
				appState.presetTrimStart = savedParams.trimStart;
			if (savedParams.trimEnd !== undefined)
				appState.presetTrimEnd = savedParams.trimEnd;
			if (savedParams.airSpeedCalibration !== undefined) {
				appState.airSpeedCalibrationPercent = savedParams.airSpeedCalibration;
			}
			log.debug("Loaded saved analysis parameters");
		} else {
			// No saved settings for this file/lap combination — reset trim to
			// defaults so stale values from a previously analyzed lap don't leak
			// into the sliders or map markers.
			appState.presetTrimStart = 0;
			appState.presetTrimEnd = timestamps.length - 1;
			log.debug("No saved settings for lap selection, using default trim range");
		}
	}

	appState.currentAnalyzedLaps = analyzedLaps;
	appState.currentFilteredData = { power, velocity, temperature, timestamps };
	appState.currentCdaReference = cdaReference;

	const hasWindSpeed = windSpeed.some((val) => !isNaN(val) && val !== 0);
	const hasConstantWind =
		appState.currentParameters.wind_speed !== undefined &&
		appState.currentParameters.wind_speed !== 0 &&
		appState.currentParameters.wind_direction !== undefined;

	const veSection = document.getElementById("veAnalysisSection");
	if (veSection) {
		veSection.classList.remove("hidden", "workflow-section--inactive");
	}

	const veAnalysisContent = document.getElementById("veAnalysisContent");
	if (!veAnalysisContent) return;

	veAnalysisContent.innerHTML = `
        <div class="ve-inline-container">
            <div class="ve-layout">
                <div class="ve-controls-sidebar">
                    <div class="ve-controls-scrollable">
                        <div class="ve-controls">
                            <h4>Analysis Parameters</h4>
                            ${elevationSmoothingToggleMarkup(appState)}
                            <div class="ve-control-grid">
                                <div class="ve-control-group">
                                    <label>Trim Start (seconds):</label>
                                    <input type="range" id="trimStartSlider" min="0" max="${timestamps.length - MIN_TRIM_WINDOW_SAMPLES}" value="${appState.presetTrimStart}" class="ve-slider">
                                    <input type="number" id="trimStartValue" value="${appState.presetTrimStart}" min="0" max="${timestamps.length - MIN_TRIM_WINDOW_SAMPLES}" class="ve-value-input">
                                </div>
                                <div class="ve-control-group">
                                    <label>Trim End (seconds):</label>
                                    <input type="range" id="trimEndSlider" min="${MIN_TRIM_WINDOW_SAMPLES}" max="${timestamps.length - 1}" value="${appState.presetTrimEnd ?? timestamps.length - 1}" class="ve-slider">
                                    <input type="number" id="trimEndValue" value="${appState.presetTrimEnd ?? timestamps.length - 1}" min="${MIN_TRIM_WINDOW_SAMPLES}" max="${timestamps.length - 1}" class="ve-value-input">
                                </div>
                                <div class="ve-control-group">
                                    <label>CdA (Drag Coefficient × Area):</label>
                                    <input type="range" id="cdaSlider" min="${appState.currentParameters!.cda_min}" max="${appState.currentParameters!.cda_max}" value="${appState.currentParameters!.cda || 0.3}" step="0.001" class="ve-slider">
                                    <input type="number" id="cdaValue" value="${(appState.currentParameters!.cda || 0.3).toFixed(3)}" min="${appState.currentParameters!.cda_min}" max="${appState.currentParameters!.cda_max}" step="0.001" class="ve-value-input">
                                </div>
                                <div class="ve-control-group">
                                    <label>Crr (Rolling Resistance):</label>
                                    <input type="range" id="crrSlider" min="${appState.currentParameters!.crr_min}" max="${appState.currentParameters!.crr_max}" value="${appState.currentParameters!.crr || 0.008}" step="0.0001" class="ve-slider">
                                    <input type="number" id="crrValue" value="${(appState.currentParameters!.crr || 0.008).toFixed(4)}" min="${appState.currentParameters!.crr_min}" max="${appState.currentParameters!.crr_max}" step="0.0001" class="ve-value-input">
                                </div>
                                ${crrTempControlsMarkup(appState.currentParameters!)}
                                ${windHeightControlsMarkup(appState.currentParameters!)}
                            </div>

                            ${
															hasWindSpeed || hasConstantWind
																? `
                            <div class="ve-wind-source">
                                <h4>Wind Source</h4>
                                <div class="ve-radio-group">
                                    <label class="ve-radio-label">
                                        <input type="radio" name="windSource" value="constant" ${!hasWindSpeed ? "checked" : ""}>
                                        <span>Use constant wind settings</span>
                                    </label>
                                    ${
																			hasWindSpeed
																				? `
                                    <label class="ve-radio-label">
                                        <input type="radio" name="windSource" value="fit" ${hasWindSpeed ? "checked" : ""}>
                                        <span>Use FIT file wind data</span>
                                    </label>
                                    <label class="ve-radio-label">
                                        <input type="radio" name="windSource" value="compare">
                                        <span>Compare both methods</span>
                                    </label>
                                    `
																				: ""
																		}
                                </div>
                            </div>
                            `
																: ""
														}

                            ${
															hasWindSpeed
																? `
                            <div class="ve-parameter">
                                <div class="ve-param-header">
                                    <label for="airSpeedCalibration">Air Speed Calibration</label>
                                    <input type="number" id="airSpeedCalibrationValue" value="${appState.airSpeedCalibrationPercent.toFixed(1)}" step="${AIR_SPEED_CALIBRATION_STEP_PERCENT}" min="${AIR_SPEED_CALIBRATION_MIN_PERCENT.toFixed(1)}" max="${AIR_SPEED_CALIBRATION_MAX_PERCENT.toFixed(1)}"
                                           class="ve-param-header__value" />
                                    <span>%</span>
                                </div>
                                <input type="range" id="airSpeedCalibrationSlider" min="${AIR_SPEED_CALIBRATION_MIN_PERCENT.toFixed(1)}" max="${AIR_SPEED_CALIBRATION_MAX_PERCENT.toFixed(1)}" step="${AIR_SPEED_CALIBRATION_STEP_PERCENT}" value="${appState.airSpeedCalibrationPercent.toFixed(1)}" />
                                <button id="autoAdjustCalibration" class="secondary-btn ve-parameter__auto-btn">Auto Adjust</button>
                            </div>
                            `
																: ""
														}
                        </div>
                    </div>
                    <div class="ve-sidebar-footer">
                        <button id="saveScreenshot" class="primary-btn ve-sidebar-footer__btn ve-sidebar-footer__btn--spaced">Save Screenshot</button>
                        <button id="storeResult" class="primary-btn ve-sidebar-footer__btn ve-sidebar-footer__btn--spaced">Store Result</button>
                        <button id="exportAllResults" class="secondary-btn ve-sidebar-footer__btn ve-sidebar-footer__btn--compact">Export All Results to CSV</button>
                    </div>
                </div>
                <div class="ve-plots-main">
                    <div class="ve-plots">
                        <div class="ve-tabs">
                            <button class="ve-tab-button ve-tab-button--active" data-tab="ve">VE</button>
                            ${cdaReference ? `<button class="ve-tab-button" data-tab="cda-validation">CdA Validation</button>` : ""}
                            ${hasWindSpeed || hasConstantWind ? `<button class="ve-tab-button" data-tab="wind">Wind</button>` : ""}
                            <button class="ve-tab-button" data-tab="power">Power</button>
                            ${hasWindSpeed ? `<button class="ve-tab-button" data-tab="vd">VD</button>` : ""}
                        </div>
                        <div class="ve-tab-content ve-tab-content--active" id="ve-tab">
                            ${lapViewToggleMarkup("stitched")}
                            <div class="ve-metrics-compact">
                                R²:<span id="r2Value">${initialResult.r2.toFixed(4)}</span> |
                                RMSE:<span id="rmseValue">${initialResult.rmse.toFixed(2)}m</span> |
                                VE:<span id="veGainValue">${initialResult.ve_elevation_diff.toFixed(2)}m</span> |
                                Actual:<span id="actualGainValue">${initialResult.actual_elevation_diff.toFixed(2)}m</span>
                            </div>
                            <div id="vePlot" class="ve-plot-container"></div>
                            <div id="veResidualsPlot" class="ve-plot-container"></div>
                        </div>
                        ${
													cdaReference
														? `
                        <div class="ve-tab-content" id="cda-validation-tab">
                            <div id="cdaValidationPlot" class="ve-plot-container"></div>
                            <div id="cdaValidationResidualsPlot" class="ve-plot-container"></div>
                        </div>
                        `
														: ""
												}
                        <div class="ve-tab-content" id="wind-tab">
                            <div id="windSpeedPlot" class="ve-plot-container"></div>
                        </div>
                        <div class="ve-tab-content" id="power-tab">
                            <div id="speedPowerPlot" class="ve-plot-container"></div>
                        </div>
                        <div class="ve-tab-content" id="vd-tab">
                             <!--
                                Deliberately EMPTY, and owned by vdHeader.ts. The
                                numbers used to be interpolated here from the
                                analyze-time result and never written again, so
                                they stayed frozen while the trim sliders moved
                                the curve below them. They are now written from
                                the same integration that draws that curve, on
                                every VD draw including the first -- and, for a
                                multi-lap selection, one line per lap.
                             -->
                            ${virtualDistanceHeaderMarkup()}
                            <div id="vdPlot" class="ve-plot-container"></div>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    `;

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

	// Create empty placeholder plots first (so Plotly divs exist)
	// The actual VE calculation will happen after sliders are set up
	await initializeVEAnalysis(appState, analysisInput, selectedIndices);

	// Now set up sliders - this binds event handlers that read from sliders
	// and recalculate VE with the correct parameter values
	setupVESliders(
		appState,
		parametersComponent,
		services,
		mapVisualization,
		callbacks.saveCurrentLapSettings,
		selectedIndices,
		timestamps,
		power,
		velocity,
		positionLat,
		positionLong,
		altitude,
		distance,
		windSpeed,
		defaultAirSpeedOffset,
	);

	// After sliders are bound, trigger VE recalculation with saved parameter values
	// This ensures the calculation uses the loaded trim/cda/crr values from sliders
	const trimStartSlider = document.getElementById(
		"trimStartSlider",
	) as HTMLInputElement;
	if (trimStartSlider) {
		trimStartSlider.dispatchEvent(new Event("input", { bubbles: true }));
	}

	setupTabSwitching();
	bindLapViewToggle();

	bindActionFooter({
		onSaveScreenshot: callbacks.onSaveScreenshot,
		onStoreResult: callbacks.onStoreResult,
		onExportAll: callbacks.onExportAll,
	});

	setTimeout(() => {
		if (mapVisualization && appState.filteredVEData) {
			mapVisualization.fitBoundsToTrimRegion(
				appState.presetTrimStart,
				appState.presetTrimEnd ?? timestamps.length - 1,
				positionLat,
				positionLong,
			);
		}
	}, 500);

	if (veSection) {
		veSection.scrollIntoView({ behavior: "smooth", block: "start" });
	}

	log.debug("Standard VE analysis initialized");
}
