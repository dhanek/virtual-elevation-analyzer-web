/**
 * Out-and-back VE analysis rendering entry points.
 *
 * Verbatim lift from main.ts. Replaces closure captures with explicit
 * ShellServices / ParameterStorage / ResultsStorage parameters.
 *
 * Note: innerHTML is used below with only compile-time literal values from
 * AnalysisParameters and computed numeric stats (no user-provided strings).
 * This matches the prior main.ts behavior; no new XSS surface is introduced.
 */
import type { ParameterStorage } from "../../utils/ParameterStorage";
import type { ResultsStorage } from "../../utils/ResultsStorage";
import type { AnalysisParameters } from "../../components/AnalysisParameters";
import type { ShellServices } from "../analysis/types";
import type { OutAndBackSection } from "../../utils/GpsLapDetection";
import type { OutAndBackVEProfile } from "./types";

import {
	AIR_SPEED_CALIBRATION_MAX_PERCENT,
	AIR_SPEED_CALIBRATION_MIN_PERCENT,
	AIR_SPEED_CALIBRATION_STEP_PERCENT,
	calculateAutoAirSpeedCalibrationPercent,
	clampAirSpeedCalibrationPercent,
	formatAirSpeedCalibrationPercent,
} from "../../analysis/AirSpeedCalibration";
import { getNormalizedActivityArrays } from "../../analysis/ActivityArrayCache";
import { buildSegmentSupplementarySeries } from "../../analysis/SegmentSupplementarySeries";
import { extractSegmentData } from "../../analysis/SegmentExtractor";
import { createVeCalculator } from "../../analysis/VeCalculatorFactory";
import { resolveWindSeries } from "../../analysis/WindSourceResolver";
import {
	resolveMultiSegmentAnalysisParams,
	saveCurrentMultiSegmentSettings,
	buildAutoCalibrationSegmentsFromRanges,
} from "../../analysis/MultiSegmentSettings";
import { setupTabSwitching } from "../dom/tabs";
import { bindWindSourceRadios, getSelectedWindSource } from "../dom/windSource";
import { bindActionFooter } from "../dom/actionFooter";
import {
	handleStoreResult,
	handleExportAllResults,
} from "../analysis/storageHandlers";
import { log } from "../../utils/log";
import {
	bindElevationSmoothingToggle,
	elevationSmoothingToggleMarkup,
} from "../analysis/elevationProfileCycle";
import {
	calculateOutAndBackMeanElevation,
	calculateOutAndBackStats,
	renderOutAndBackPlots,
	renderOutAndBackWindPlot,
	renderOutAndBackPowerPlot,
	renderOutAndBackVdPlot,
} from "./outAndBackPlots";
import {
	updateOutAndBackVEPlots,
	recalculateOutAndBackVE,
	scheduleOutAndBackRecompute,
} from "./updateOutAndBack";
import { saveOutAndBackScreenshot } from "./outAndBackScreenshot";
import { resolveAppliedCrr } from "../../analysis/CrrTemperatureCorrection";
import { bindCrrTempControls, crrTempControlsMarkup } from "../ve/crrTempControls";
import { virtualDistanceHeaderMarkup } from "../ve/vdHeader";
import {
	bindWindHeightControls,
	windHeightControlsMarkup,
} from "../ve/windHeightControls";
import { mergeAnalysisParameters } from "../analysis/parametersSync";

/**
 * Calculate VE for Out and Back sections and show stacked plot
 */
export async function showOutAndBackVEAnalysis(
	services: ShellServices,
	parameterStorage: ParameterStorage,
	resultsStorage: ResultsStorage,
	sections: OutAndBackSection[],
	fitData: any,
	params: AnalysisParameters,
	defaultAirSpeedOffset: number,
	waitForPlotly: () => Promise<any>,
	reuseCurrentSettings: boolean = false,
) {
	const { appState } = services;
	services.showLoading("Calculating VE for out-and-back sections...");

	const analyzedSectionNumbers = sections.map(
		(section) => section.sectionNumber,
	);
	const resolvedParams = await resolveMultiSegmentAnalysisParams(
		appState,
		parameterStorage,
		analyzedSectionNumbers,
		params,
		reuseCurrentSettings,
	);
	appState.currentOutAndBackSections = sections;
	const profiles: OutAndBackVEProfile[] = [];

	const normalizedArrays = getNormalizedActivityArrays(fitData);
	const allTimestamps = normalizedArrays.timestamps;
	const allPower = normalizedArrays.power;
	const allVelocity = normalizedArrays.velocity;
	const allPositionLat = normalizedArrays.positionLat;
	const allPositionLong = normalizedArrays.positionLong;
	const allAltitude = normalizedArrays.altitude;
	const allDistance = normalizedArrays.distance;

	// Handle wind/air speed via typed locals.
	const outAndBackWindResolution = resolveWindSeries({
		fitData,
		windSource: getSelectedWindSource(),
		params: resolvedParams,
		airSpeedCalibrationPercent: appState.airSpeedCalibrationPercent,
	});
	const {
		hasAirSpeed,
		hasWindSpeed,
		windSpeed: allWindSpeed,
	} = outAndBackWindResolution;
	const windSpeedOffset =
		resolvedParams.air_speed_offset ?? defaultAirSpeedOffset;

	if (outAndBackWindResolution.selectedWindSource === "constant") {
		log.debug("Out and Back VE: Using constant wind settings");
	} else if (outAndBackWindResolution.dataSource === "air_speed") {
		log.debug(
			`Out and Back VE: Using FIT air speed data (offset: ${windSpeedOffset}s, calibration: ${appState.airSpeedCalibrationPercent}%)`,
		);
	} else if (outAndBackWindResolution.dataSource === "wind_speed") {
		log.debug(
			`Out and Back VE: Using FIT wind speed data (offset: ${windSpeedOffset}s, calibration: ${appState.airSpeedCalibrationPercent}%)`,
		);
	} else {
		log.debug("Out and Back VE: No wind data available");
	}

	// The stored Crr is 22 °C-referenced; the physics uses the
	// temperature-corrected value when the correction is enabled.
	const cda = resolvedParams.cda ?? 0.3;
	const crr = resolvedParams.crr ?? 0.008;
	const appliedCrr = resolveAppliedCrr(resolvedParams, crr);

	// Calculate VE for each section (outbound and inbound separately)
	for (const section of sections) {
		const profile: OutAndBackVEProfile = {
			sectionNumber: section.sectionNumber,
			outboundDistances: [],
			outboundVE: [],
			outboundActualElevation: [],
			outboundSeries: null,
			inboundDistances: [],
			inboundVE: [],
			inboundActualElevation: [],
			inboundSeries: null,
			outboundDuration: section.outboundDuration,
			inboundDuration: section.inboundDuration,
			totalDistance: section.totalDistance,
		};

		// Process outbound segment (A → B)
		try {
			const outboundData = extractSegmentData({
				startIdx: section.outboundStartIdx,
				endIdx: section.outboundEndIdx,
				allTimestamps,
				allPower,
				allVelocity,
				allPositionLat,
				allPositionLong,
				allAltitude,
				allDistance,
				allWindSpeed,
			});

			if (outboundData.timestamps.length >= 10) {
				const calculator = createVeCalculator({
					timestamps: outboundData.timestamps,
					power: outboundData.power,
					velocity: outboundData.velocity,
					positionLat: outboundData.positionLat,
					positionLong: outboundData.positionLong,
					altitude: outboundData.altitude,
					distance: outboundData.distance,
					windSpeed: outboundData.windSpeed,
					params: resolvedParams,
					cda,
					crr: appliedCrr,
				});

				const result = calculator.calculate_virtual_elevation(
					cda,
					appliedCrr,
					0,
					outboundData.timestamps.length - 1,
				);
				const veArray = Array.from(result.virtual_elevation as Float64Array);

				profile.outboundSeries = buildSegmentSupplementarySeries({
					timestamps: outboundData.timestamps,
					power: outboundData.power,
					velocity: outboundData.velocity,
					positionLat: outboundData.positionLat,
					positionLong: outboundData.positionLong,
					distance: outboundData.distance,
					windSpeed: outboundData.windSpeed,
					params: resolvedParams,
					selectedWindSource: outAndBackWindResolution.selectedWindSource,
				});
				profile.outboundDistances = profile.outboundSeries.distancesKm;
				profile.outboundVE = veArray;
				profile.outboundActualElevation = resolvedParams.velodrome
					? new Array(outboundData.altitude.length).fill(0)
					: [...outboundData.altitude];
			}
		} catch (err) {
			log.error(
				`Failed to calculate outbound VE for section ${section.sectionNumber}:`,
				err,
			);
		}

		// Process inbound segment (B → A)
		try {
			const inboundData = extractSegmentData({
				startIdx: section.inboundStartIdx,
				endIdx: section.inboundEndIdx,
				allTimestamps,
				allPower,
				allVelocity,
				allPositionLat,
				allPositionLong,
				allAltitude,
				allDistance,
				allWindSpeed,
			});

			if (inboundData.timestamps.length >= 10) {
				const calculator = createVeCalculator({
					timestamps: inboundData.timestamps,
					power: inboundData.power,
					velocity: inboundData.velocity,
					positionLat: inboundData.positionLat,
					positionLong: inboundData.positionLong,
					altitude: inboundData.altitude,
					distance: inboundData.distance,
					windSpeed: inboundData.windSpeed,
					params: resolvedParams,
					cda,
					crr: appliedCrr,
				});

				const result = calculator.calculate_virtual_elevation(
					cda,
					appliedCrr,
					0,
					inboundData.timestamps.length - 1,
				);
				const veArray = Array.from(result.virtual_elevation as Float64Array);

				profile.inboundSeries = buildSegmentSupplementarySeries({
					timestamps: inboundData.timestamps,
					power: inboundData.power,
					velocity: inboundData.velocity,
					positionLat: inboundData.positionLat,
					positionLong: inboundData.positionLong,
					distance: inboundData.distance,
					windSpeed: inboundData.windSpeed,
					params: resolvedParams,
					selectedWindSource: outAndBackWindResolution.selectedWindSource,
				});
				profile.inboundDistances = profile.inboundSeries.distancesKm;
				profile.inboundVE = veArray;
				profile.inboundActualElevation = resolvedParams.velodrome
					? new Array(inboundData.altitude.length).fill(0)
					: [...inboundData.altitude];
			}
		} catch (err) {
			log.error(
				`Failed to calculate inbound VE for section ${section.sectionNumber}:`,
				err,
			);
		}

		if (profile.outboundVE.length > 0 || profile.inboundVE.length > 0) {
			profiles.push(profile);
		}
	}

	services.hideLoading();

	if (profiles.length === 0) {
		services.showError("No valid out-and-back sections to analyze");
		return;
	}

	// Calculate mean actual elevation profile (mirroring inbound)
	const meanElevation = calculateOutAndBackMeanElevation(profiles);

	// Check for constant wind settings
	const hasConstantWind =
		resolvedParams.wind_speed !== undefined &&
		resolvedParams.wind_speed !== 0 &&
		resolvedParams.wind_direction !== undefined;

	// Preserve current wind source selection if UI exists (for recalculations)
	const preservedWindSource = getSelectedWindSource();

	// Show the Out and Back VE analysis interface with wind data info
	await showOutAndBackVEPlot(
		services,
		parameterStorage,
		resultsStorage,
		waitForPlotly,
		profiles,
		meanElevation,
		resolvedParams,
		hasAirSpeed || hasWindSpeed,
		hasConstantWind,
		defaultAirSpeedOffset,
		preservedWindSource,
	);
}

/**
 * Show the Out and Back VE stacked plot with full controls (matching normal mode)
 */
/**
 * The VD tab, container and plot.
 *
 * Exported, and separate from the surrounding template, so a test can assert
 * that the header CONTAINER is actually emitted. Out-and-back rendered a bare
 * `#oabVdPlot` with nothing above it, so the label was missing outright rather
 * than stale — and a renderer writing into a container that does not exist
 * fails silently, which makes an assertion on the renderer alone vacuous. Both
 * halves are guarded, the same way `gpsLapVdHeader.test.ts` guards the sidebar
 * this one was modelled on.
 */
export function outAndBackVdTabMarkup(show: boolean): string {
	if (!show) return "";
	return `
                        <div class="ve-tab-content" id="vd-tab">
                            ${virtualDistanceHeaderMarkup()}
                            <div id="oabVdPlot" class="ve-plot ve-plot--tall"></div>
                        </div>
                        `;
}

export async function showOutAndBackVEPlot(
	services: ShellServices,
	parameterStorage: ParameterStorage,
	resultsStorage: ResultsStorage,
	waitForPlotly: () => Promise<any>,
	profiles: OutAndBackVEProfile[],
	meanElevation: { distances: number[]; elevation: number[] },
	params: AnalysisParameters,
	hasWindSpeed: boolean,
	hasConstantWind: boolean,
	defaultAirSpeedOffset: number,
	preservedWindSource: string | null = null,
) {
	const { appState } = services;
	const selectedWindSource =
		preservedWindSource || (hasWindSpeed ? "fit" : "constant");
	const effectiveWindSource =
		selectedWindSource === "compare" ? "fit" : selectedWindSource;
	const showWindTab = hasWindSpeed || hasConstantWind;
	const showFitWindControls = hasWindSpeed && effectiveWindSource === "fit";
	const showVirtualDistanceTab = showFitWindControls;

	const Plotly = await waitForPlotly();

	// Show the VE analysis section
	const veSection = document.getElementById("veAnalysisSection") as HTMLElement;
	if (veSection) {
		veSection.classList.remove("hidden", "workflow-section--inactive");
	}

	const veAnalysisContent = document.getElementById(
		"veAnalysisContent",
	) as HTMLElement;
	if (!veAnalysisContent) {
		log.error("VE analysis content container not found");
		return;
	}

	// Calculate initial statistics
	const initialStats = calculateOutAndBackStats(profiles, meanElevation);
	const currentAirSpeedCalibrationValue = formatAirSpeedCalibrationPercent(
		appState.airSpeedCalibrationPercent,
	);

	// Create full interface with controls sidebar (matching normal mode)
	veAnalysisContent.innerHTML = `
        <div class="ve-inline-container">
            <div class="ve-layout">
                <!-- Controls Sidebar -->
                <div class="ve-controls-sidebar">
                    <div class="ve-controls-scrollable">
                        <div class="ve-controls">
                            <h4>Analysis Parameters</h4>
                            ${elevationSmoothingToggleMarkup(appState)}
                            <div class="ve-control-grid">
                                <div class="ve-control-group">
                                    <label>CdA (Drag Coefficient × Area):</label>
                                    <input type="range" id="cdaSlider" min="${params.cda_min}" max="${params.cda_max}" value="${params.cda || 0.3}" step="0.001" class="ve-slider">
                                    <input type="number" id="cdaValue" value="${(params.cda || 0.3).toFixed(3)}" min="${params.cda_min}" max="${params.cda_max}" step="0.001" class="ve-value-input">
                                </div>
                                <div class="ve-control-group">
                                    <label>Crr (Rolling Resistance):</label>
                                    <input type="range" id="crrSlider" min="${params.crr_min}" max="${params.crr_max}" value="${params.crr || 0.008}" step="0.0001" class="ve-slider">
                                    <input type="number" id="crrValue" value="${(params.crr || 0.008).toFixed(4)}" min="${params.crr_min}" max="${params.crr_max}" step="0.0001" class="ve-value-input">
                                </div>
                                ${crrTempControlsMarkup(params)}
                                ${windHeightControlsMarkup(params, selectedWindSource)}
                            </div>

                            ${
															hasWindSpeed || hasConstantWind
																? `
                            <div class="ve-wind-source">
                                <h4>Wind Source</h4>
                                <div class="ve-radio-group">
                                    <label class="ve-radio-label">
                                        <input type="radio" name="windSource" value="constant" ${selectedWindSource === "constant" ? "checked" : ""}>
                                        <span>Use constant wind settings</span>
                                    </label>
                                    ${
																			hasWindSpeed
																				? `
                                    <label class="ve-radio-label">
                                        <input type="radio" name="windSource" value="fit" ${selectedWindSource === "fit" ? "checked" : ""}>
                                        <span>Use FIT file wind data</span>
                                    </label>
                                    <label class="ve-radio-label">
                                        <input type="radio" name="windSource" value="compare" ${selectedWindSource === "compare" ? "checked" : ""}>
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
                                    <input type="number" id="airSpeedCalibrationValue" value="${currentAirSpeedCalibrationValue}" step="${AIR_SPEED_CALIBRATION_STEP_PERCENT}" min="${AIR_SPEED_CALIBRATION_MIN_PERCENT.toFixed(1)}" max="${AIR_SPEED_CALIBRATION_MAX_PERCENT.toFixed(1)}"
                                           class="ve-param-header__value" />
                                    <span>%</span>
                                </div>
                                <input type="range" id="airSpeedCalibrationSlider" min="${AIR_SPEED_CALIBRATION_MIN_PERCENT.toFixed(1)}" max="${AIR_SPEED_CALIBRATION_MAX_PERCENT.toFixed(1)}" step="${AIR_SPEED_CALIBRATION_STEP_PERCENT}" value="${currentAirSpeedCalibrationValue}" />
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

                <!-- Plots Main Area -->
                <div class="ve-plots-main">
                    <div class="ve-plots">
                        <div class="ve-tabs">
                            <button class="ve-tab-button ve-tab-button--active" data-tab="ve">VE</button>
                            ${
															showWindTab
																? `
                            <button class="ve-tab-button" data-tab="wind">Wind</button>
                            `
																: ""
														}
                            <button class="ve-tab-button" data-tab="power">Power</button>
                            ${
															showVirtualDistanceTab
																? `
                            <button class="ve-tab-button" data-tab="vd">VD</button>
                            `
																: ""
														}
                        </div>

                        <div class="ve-tab-content ve-tab-content--active" id="ve-tab">
                            <div class="ve-metrics-compact">
                                RMSE:<span id="oabRmseValue">${initialStats.rmse.toFixed(2)}m</span> |
                                VE Gain:<span id="oabVeGainValue">${initialStats.avgVeGain.toFixed(2)}m</span> |
                                Actual:<span id="oabActualGainValue">${initialStats.avgActualGain.toFixed(2)}m</span> |
                                Sections:<span id="oabSectionCountValue">${profiles.length}</span>
                            </div>
                            <div class="ve-plot-container">
                                <div id="oabVePlot" class="ve-plot-container__plot ve-plot-container__plot--ve"></div>
                            </div>
                            <div class="ve-plot-container">
                                <div id="oabVeResidualsPlot" class="ve-plot-container__plot ve-plot-container__plot--residuals"></div>
                            </div>
                            <div id="oabClosingError" class="ve-closing-error hidden"></div>
                        </div>

                        ${
													showWindTab
														? `
                        <div class="ve-tab-content" id="wind-tab">
                            <div id="oabWindPlot" class="ve-plot ve-plot--tall"></div>
                            ${
															showFitWindControls
																? `
                            <div class="ve-parameter ve-parameter--panel">
                                <h4 class="ve-parameter__title">Air Speed Time Offset</h4>
                                <div class="ve-parameter__grid">
                                    <input type="range" id="airSpeedOffsetSlider" min="-10" max="10" step="1" value="${params?.air_speed_offset ?? defaultAirSpeedOffset}"
                                           class="ve-parameter__slider" />
                                    <input type="number" id="airSpeedOffsetValue" value="${params?.air_speed_offset ?? defaultAirSpeedOffset}" step="1" min="-10" max="10"
                                           class="ve-parameter__value" />
                                    <span class="ve-parameter__unit">seconds</span>
                                </div>
                            </div>
                            `
																: ""
														}
                        </div>
                        `
														: ""
												}

                        <div class="ve-tab-content" id="power-tab">
                            <div id="oabPowerPlot" class="ve-plot ve-plot--tall"></div>
                        </div>

                        ${outAndBackVdTabMarkup(showVirtualDistanceTab)}
                    </div>
                </div>
            </div>
        </div>
    `;

	// Setup slider sync with recalculation
	setupOutAndBackSliderSync(services, parameterStorage, waitForPlotly);

	bindElevationSmoothingToggle(appState, () => {
		const cda = parseFloat(
			(document.getElementById("cdaValue") as HTMLInputElement)?.value || "0.3",
		);
		const crr = parseFloat(
			(document.getElementById("crrValue") as HTMLInputElement)?.value ||
				"0.008",
		);
		scheduleOutAndBackRecompute(() =>
			updateOutAndBackVEPlots(appState, waitForPlotly, cda, crr),
		);
	});

	// Setup tab switching
	setupTabSwitching({
		wind: () => renderOutAndBackWindPlot(profiles),
		power: () => renderOutAndBackPowerPlot(profiles),
		vd: () => renderOutAndBackVdPlot(profiles),
	});

	// Setup wind source radio button listeners
	bindWindSourceRadios(() => {
		log.debug("Wind source changed - triggering Out and Back VE recalculation");
		void recalculateOutAndBackVE(
			services,
			parameterStorage,
			resultsStorage,
			waitForPlotly,
		);
	});

	// Setup air speed calibration listeners
	const airSpeedCalibrationSlider = document.getElementById(
		"airSpeedCalibrationSlider",
	) as HTMLInputElement;
	const airSpeedCalibrationValueEl = document.getElementById(
		"airSpeedCalibrationValue",
	) as HTMLInputElement;

	if (airSpeedCalibrationSlider && airSpeedCalibrationValueEl) {
		const updateAirSpeedCalibration = () => {
			const value = parseFloat(airSpeedCalibrationSlider.value);
			airSpeedCalibrationValueEl.value = value.toFixed(1);
			appState.airSpeedCalibrationPercent = value;
			void saveCurrentMultiSegmentSettings(appState, parameterStorage);
			log.debug(
				"Air speed calibration changed - triggering Out and Back VE recalculation",
			);
			const cda = parseFloat(
				(document.getElementById("cdaValue") as HTMLInputElement)?.value ||
					"0.3",
			);
			const crr = parseFloat(
				(document.getElementById("crrValue") as HTMLInputElement)?.value ||
					"0.008",
			);
			scheduleOutAndBackRecompute(() =>
				updateOutAndBackVEPlots(appState, waitForPlotly, cda, crr),
			);
		};

		const updateAirSpeedCalibrationFromInput = () => {
			const value = parseFloat(airSpeedCalibrationValueEl.value);
			if (isNaN(value)) return;
			const clamped = clampAirSpeedCalibrationPercent(value);
			airSpeedCalibrationSlider.value = clamped.toString();
			airSpeedCalibrationValueEl.value = clamped.toFixed(1);
			appState.airSpeedCalibrationPercent = clamped;
			void saveCurrentMultiSegmentSettings(appState, parameterStorage);
			log.debug(
				"Air speed calibration changed - triggering Out and Back VE recalculation",
			);
			const cda = parseFloat(
				(document.getElementById("cdaValue") as HTMLInputElement)?.value ||
					"0.3",
			);
			const crr = parseFloat(
				(document.getElementById("crrValue") as HTMLInputElement)?.value ||
					"0.008",
			);
			scheduleOutAndBackRecompute(() =>
				updateOutAndBackVEPlots(appState, waitForPlotly, cda, crr),
			);
		};

		airSpeedCalibrationSlider.addEventListener(
			"input",
			updateAirSpeedCalibration,
		);
		airSpeedCalibrationValueEl.addEventListener(
			"change",
			updateAirSpeedCalibrationFromInput,
		);

		const autoAdjustButton = document.getElementById(
			"autoAdjustCalibration",
		) as HTMLButtonElement;
		if (autoAdjustButton) {
			autoAdjustButton.addEventListener("click", () => {
				const calibrationRanges = appState.currentOutAndBackSections.flatMap(
					(section) => [
						{
							startIdx: section.outboundStartIdx,
							endIdx: section.outboundEndIdx,
						},
						{
							startIdx: section.inboundStartIdx,
							endIdx: section.inboundEndIdx,
						},
					],
				);
				const calibrationPercent = calculateAutoAirSpeedCalibrationPercent(
					buildAutoCalibrationSegmentsFromRanges(
						appState,
						calibrationRanges,
						getNormalizedActivityArrays,
						resolveWindSeries,
						extractSegmentData,
					),
				);

				if (calibrationPercent === null) {
					log.warn(
						"Cannot auto-adjust out-and-back calibration: no usable FIT air speed data available",
					);
					return;
				}

				airSpeedCalibrationSlider.value = calibrationPercent.toFixed(1);
				airSpeedCalibrationValueEl.value = calibrationPercent.toFixed(1);
				appState.airSpeedCalibrationPercent = calibrationPercent;
				void saveCurrentMultiSegmentSettings(appState, parameterStorage);
				log.debug(
					`Auto-adjusted out-and-back air speed calibration to ${calibrationPercent.toFixed(1)}%`,
				);
				const cda = parseFloat(
					(document.getElementById("cdaValue") as HTMLInputElement)?.value ||
						"0.3",
				);
				const crr = parseFloat(
					(document.getElementById("crrValue") as HTMLInputElement)?.value ||
						"0.008",
				);
				scheduleOutAndBackRecompute(() =>
					updateOutAndBackVEPlots(appState, waitForPlotly, cda, crr),
				);
			});
		}
	}

	// Setup action footer buttons
	bindActionFooter({
		onSaveScreenshot: () => {
			void saveOutAndBackScreenshot(waitForPlotly);
		},
		onStoreResult: () => {
			void handleStoreResult(appState, resultsStorage);
		},
		onExportAll: () => {
			void handleExportAllResults(resultsStorage);
		},
	});

	// Initial plot render
	renderOutAndBackPlots(Plotly, profiles, meanElevation);

	// Scroll to the VE analysis section
	veSection?.scrollIntoView({ behavior: "smooth", block: "start" });
}

/**
 * Setup slider-input sync for Out and Back controls with dynamic recalculation (uses standard slider IDs)
 */
export function setupOutAndBackSliderSync(
	services: ShellServices,
	parameterStorage: ParameterStorage,
	waitForPlotly: () => Promise<any>,
) {
	const { appState } = services;
	const cdaSlider = document.getElementById("cdaSlider") as HTMLInputElement;
	const cdaValueEl = document.getElementById("cdaValue") as HTMLInputElement;
	const crrSlider = document.getElementById("crrSlider") as HTMLInputElement;
	const crrValueEl = document.getElementById("crrValue") as HTMLInputElement;

	// Helper to trigger recalculation
	const triggerRecalculation = () => {
		const cda = parseFloat(cdaValueEl?.value || "0.3");
		const crr = parseFloat(crrValueEl?.value || "0.008");
		scheduleOutAndBackRecompute(() =>
			updateOutAndBackVEPlots(appState, waitForPlotly, cda, crr),
		);
	};

	if (cdaSlider && cdaValueEl) {
		cdaSlider.addEventListener("input", () => {
			cdaValueEl.value = parseFloat(cdaSlider.value).toFixed(3);
			void saveCurrentMultiSegmentSettings(appState, parameterStorage);
			triggerRecalculation();
		});
		cdaValueEl.addEventListener("change", () => {
			cdaSlider.value = cdaValueEl.value;
			void saveCurrentMultiSegmentSettings(appState, parameterStorage);
			triggerRecalculation();
		});
	}

	if (crrSlider && crrValueEl) {
		crrSlider.addEventListener("input", () => {
			crrValueEl.value = parseFloat(crrSlider.value).toFixed(4);
			void saveCurrentMultiSegmentSettings(appState, parameterStorage);
			triggerRecalculation();
		});
		crrValueEl.addEventListener("change", () => {
			crrSlider.value = crrValueEl.value;
			void saveCurrentMultiSegmentSettings(appState, parameterStorage);
			triggerRecalculation();
		});
	}

	bindCrrTempControls({
		getParams: () => appState.currentParameters,
		setParams: (fields) => {
			// Prefer the parameters-component gateway so its private copy stays
			// in sync (a later form edit would otherwise revert these fields).
			if (mergeAnalysisParameters(fields)) return;
			if (!appState.currentParameters) return;
			Object.assign(appState.currentParameters, fields);
			if (appState.currentFileHash && appState.selectedFile) {
				void parameterStorage.saveParameters(
					appState.currentFileHash,
					appState.currentParameters,
					appState.selectedFile.name,
				);
			}
		},
		onChange: triggerRecalculation,
	});

	// Same persistence and recompute needs as the Crr temperature controls above,
	// so the binding shape is deliberately identical: the k write must go through
	// the parametersSync gateway or the component's private copy reverts it on the
	// next form edit (see shell/analysis/parametersSync.ts).
	bindWindHeightControls({
		getParams: () => appState.currentParameters,
		setParams: (fields) => {
			// Prefer the parameters-component gateway so its private copy stays
			// in sync (a later form edit would otherwise revert these fields).
			if (mergeAnalysisParameters(fields)) return;
			if (!appState.currentParameters) return;
			Object.assign(appState.currentParameters, fields);
			if (appState.currentFileHash && appState.selectedFile) {
				void parameterStorage.saveParameters(
					appState.currentFileHash,
					appState.currentParameters,
					appState.selectedFile.name,
				);
			}
		},
		onChange: triggerRecalculation,
	});
}
