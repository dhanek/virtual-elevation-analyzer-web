/**
 * GPS-lap VE analysis rendering entry points.
 *
 * Verbatim lift from main.ts. Replaces closure captures with explicit
 * ShellServices / ParameterStorage / ResultsStorage parameters per D-08, D-10.
 *
 * Note: innerHTML is used below with only compile-time literal values from
 * AnalysisParameters and computed numeric stats (no user-provided strings).
 * This matches the prior main.ts behavior; no new XSS surface is introduced.
 */
import type { AppState } from "../../state/AppState";
import type { ParameterStorage } from "../../utils/ParameterStorage";
import type { ResultsStorage } from "../../utils/ResultsStorage";
import type { AnalysisParameters } from "../../components/AnalysisParameters";
import type { ShellServices } from "../analysis/types";
import type { LapVEProfile } from "./types";

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
	calculateGpsLapStats,
	calculateMeanElevationProfile,
	renderGpsLapVEPlots,
	renderGpsLapWindPlot,
	renderGpsLapPowerPlot,
	renderGpsLapVdPlot,
} from "./gpsLapPlots";
import {
	updateGpsLapVEPlots,
	recalculateGpsLapVE,
	scheduleGpsLapRecompute,
} from "./updateGpsLap";
import { saveGpsLapScreenshot } from "./gpsLapScreenshot";
import { bindLapViewToggle, lapViewToggleMarkup } from "../ve/lapViewToggle";
import { virtualDistanceHeaderMarkup } from "../ve/vdHeader";
import { resolveAppliedCrr } from "../../analysis/CrrTemperatureCorrection";
import { bindCrrTempControls, crrTempControlsMarkup } from "../ve/crrTempControls";
import {
	bindWindHeightControls,
	windHeightControlsMarkup,
} from "../ve/windHeightControls";
import { mergeAnalysisParameters } from "../analysis/parametersSync";
import { resolveGpsLapNumber } from "../../modes/analysis/activeGpsLapRanges";

/**
 * Calculate VE for each GPS-detected lap and show stacked plot.
 */
export async function showGpsLapVEAnalysis(
	services: ShellServices,
	parameterStorage: ParameterStorage,
	resultsStorage: ResultsStorage,
	waitForPlotly: () => Promise<any>,
	lapIndexRanges: Array<{ startIdx: number; endIdx: number }>,
	fitData: any,
	params: AnalysisParameters,
	defaultAirSpeedOffset: number,
	reuseCurrentSettings: boolean = false,
) {
	const { appState } = services;
	services.showLoading("Calculating VE for each lap...");

	// When the overlay was reached by stacking ordinary lap selections, real lap
	// numbers are carried on appState so the legend matches the user's choice;
	// otherwise fall back to GPS-detected lap lookup.
	const overlayLapNumbers = appState.currentOverlayLapNumbers;
	const analyzedLapNumbers = lapIndexRanges.map(
		(range, index) =>
			overlayLapNumbers?.[index] ??
			getGpsLapNumberForRange(appState, range, index + 1),
	);
	const resolvedParams = await resolveMultiSegmentAnalysisParams(
		appState,
		parameterStorage,
		analyzedLapNumbers,
		params,
		reuseCurrentSettings,
	);
	const lapVEProfiles: LapVEProfile[] = [];

	const normalizedArrays = getNormalizedActivityArrays(fitData);
	const allTimestamps = normalizedArrays.timestamps;
	const allPower = normalizedArrays.power;
	const allVelocity = normalizedArrays.velocity;
	const allPositionLat = normalizedArrays.positionLat;
	const allPositionLong = normalizedArrays.positionLong;
	const allAltitude = normalizedArrays.altitude;
	const allDistance = normalizedArrays.distance;

	// Handle wind/air speed
	const gpsLapWindResolution = resolveWindSeries({
		fitData,
		windSource: getSelectedWindSource(),
		params: resolvedParams,
		airSpeedCalibrationPercent: appState.airSpeedCalibrationPercent,
	});
	const {
		hasAirSpeed,
		hasWindSpeed,
		defaultAirSpeedOffset: defaultOffset,
		windSpeed: allWindSpeed,
	} = gpsLapWindResolution;
	const windSpeedOffset = resolvedParams.air_speed_offset ?? defaultOffset;

	if (gpsLapWindResolution.selectedWindSource === "constant") {
		log.debug("GPS Lap VE: Using constant wind settings");
	} else if (gpsLapWindResolution.dataSource === "air_speed") {
		log.debug(
			`GPS Lap VE: Using FIT air speed data (offset: ${windSpeedOffset}s, calibration: ${appState.airSpeedCalibrationPercent}%)`,
		);
	} else if (gpsLapWindResolution.dataSource === "wind_speed") {
		log.debug(
			`GPS Lap VE: Using FIT wind speed data (offset: ${windSpeedOffset}s, calibration: ${appState.airSpeedCalibrationPercent}%)`,
		);
	} else {
		log.debug("GPS Lap VE: No wind data available");
	}

	// Get CdA and Crr values. The stored Crr is 22 °C-referenced; the physics
	// uses the temperature-corrected value when the correction is enabled.
	const cda = resolvedParams.cda ?? 0.3;
	const crr = resolvedParams.crr ?? 0.008;
	const appliedCrr = resolveAppliedCrr(resolvedParams, crr);

	// Calculate VE for each lap
	for (let lapIdx = 0; lapIdx < lapIndexRanges.length; lapIdx++) {
		const range = lapIndexRanges[lapIdx];
		const lapNumber = analyzedLapNumbers[lapIdx] ?? lapIdx + 1;

		// Extract data for this lap
		const lapTimestamps: number[] = [];
		const lapPower: number[] = [];
		const lapVelocity: number[] = [];
		const lapPositionLat: number[] = [];
		const lapPositionLong: number[] = [];
		const lapAltitude: number[] = [];
		const lapDistance: number[] = [];
		const lapWindSpeed: number[] = [];

		for (
			let i = range.startIdx;
			i <= range.endIdx && i < allTimestamps.length;
			i++
		) {
			lapTimestamps.push(allTimestamps[i]);
			lapPower.push(allPower[i]);
			lapVelocity.push(allVelocity[i]);
			lapPositionLat.push(allPositionLat[i]);
			lapPositionLong.push(allPositionLong[i]);
			lapAltitude.push(allAltitude[i]);
			lapDistance.push(allDistance[i]);
			lapWindSpeed.push(allWindSpeed[i]);
		}

		if (lapTimestamps.length < 10) {
			log.warn(
				`Lap ${lapNumber} has too few data points (${lapTimestamps.length}), skipping`,
			);
			continue;
		}

		const supplementarySeries = buildSegmentSupplementarySeries({
			timestamps: lapTimestamps,
			power: lapPower,
			velocity: lapVelocity,
			positionLat: lapPositionLat,
			positionLong: lapPositionLong,
			distance: lapDistance,
			windSpeed: lapWindSpeed,
			params: resolvedParams,
			selectedWindSource: gpsLapWindResolution.selectedWindSource,
		});
		const relativeDistances = supplementarySeries.distancesKm;

		// Calculate duration
		const duration = lapTimestamps[lapTimestamps.length - 1] - lapTimestamps[0];
		const totalDistance = relativeDistances[relativeDistances.length - 1] ?? 0;

		try {
			const calculator = createVeCalculator({
				timestamps: lapTimestamps,
				power: lapPower,
				velocity: lapVelocity,
				positionLat: lapPositionLat,
				positionLong: lapPositionLong,
				altitude: lapAltitude,
				distance: lapDistance,
				windSpeed: lapWindSpeed,
				params: resolvedParams,
				cda,
				crr: appliedCrr,
			});

			// Calculate VE for full lap
			const result = calculator.calculate_virtual_elevation(
				cda,
				appliedCrr,
				0,
				lapTimestamps.length - 1,
			);

			// Extract VE values
			const veArray = Array.from(result.virtual_elevation as Float64Array);

			// Get actual elevation (use zeros for velodrome mode)
			const actualElevation = resolvedParams.velodrome
				? new Array(lapAltitude.length).fill(0)
				: lapAltitude;

			lapVEProfiles.push({
				lapNumber,
				distances: relativeDistances,
				virtualElevation: veArray,
				actualElevation: actualElevation,
				supplementarySeries,
				duration,
				totalDistance,
			});

			log.debug(
				`Lap ${lapNumber}: ${totalDistance.toFixed(2)} km, ${duration.toFixed(0)}s, ${veArray.length} points`,
			);
		} catch (err) {
			log.error(`Failed to calculate VE for lap ${lapNumber}:`, err);
		}
	}

	services.hideLoading();

	if (lapVEProfiles.length === 0) {
		services.showError("No valid laps to analyze");
		return;
	}

	// Calculate mean actual elevation profile
	const meanElevationProfile = calculateMeanElevationProfile(lapVEProfiles);

	// Check for constant wind settings
	const hasConstantWind =
		resolvedParams.wind_speed !== undefined &&
		resolvedParams.wind_speed !== 0 &&
		resolvedParams.wind_direction !== undefined;

	// Preserve current wind source selection if UI exists (for recalculations)
	const preservedWindSource = getSelectedWindSource();

	// Show the GPS lap VE analysis interface with wind data info
	await showGpsLapVEPlot(
		services,
		parameterStorage,
		resultsStorage,
		waitForPlotly,
		lapVEProfiles,
		meanElevationProfile,
		resolvedParams,
		hasAirSpeed || hasWindSpeed,
		hasConstantWind,
		defaultAirSpeedOffset,
		preservedWindSource,
	);
}

/**
 * Show the GPS lap VE stacked plot with full controls (matching normal mode).
 */
export async function showGpsLapVEPlot(
	services: ShellServices,
	parameterStorage: ParameterStorage,
	resultsStorage: ResultsStorage,
	waitForPlotly: () => Promise<any>,
	lapProfiles: LapVEProfile[],
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
	// Ensure Plotly is loaded (side effect only; Plotly is accessed via the
	// global in downstream helpers).
	await waitForPlotly();

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
	const initialStats = calculateGpsLapStats(lapProfiles, meanElevation);
	const currentAirSpeedCalibrationValue = formatAirSpeedCalibrationPercent(
		appState.airSpeedCalibrationPercent,
	);

	// Build HTML template (values are numeric / from AnalysisParameters only; no user input).
	const veAnalysisTemplate = buildGpsLapVeAnalysisTemplate({
		params,
		hasWindSpeed,
		hasConstantWind,
		showWindTab,
		showFitWindControls,
		showVirtualDistanceTab,
		selectedWindSource,
		currentAirSpeedCalibrationValue,
		initialStats,
		lapCount: lapProfiles.length,
		defaultAirSpeedOffset,
		elevationToggleMarkup: elevationSmoothingToggleMarkup(appState),
	});
	veAnalysisContent.innerHTML = veAnalysisTemplate;

	// Bind the stitched/stacked toggle when this overlay was reached from an
	// ordinary 2+ lap selection (no-op otherwise).
	bindLapViewToggle();

	// Setup slider event handlers for CdA/Crr with recalculation
	setupGpsLapSliderHandlers(appState, parameterStorage, waitForPlotly, params);

	bindElevationSmoothingToggle(appState, () => {
		const windSource = getSelectedWindSource();
		const cda = parseFloat(
			(document.getElementById("cdaValue") as HTMLInputElement)?.value || "0.3",
		);
		const crr = parseFloat(
			(document.getElementById("crrValue") as HTMLInputElement)?.value ||
				"0.008",
		);
		scheduleGpsLapRecompute(() =>
			updateGpsLapVEPlots(
				appState,
				parameterStorage,
				waitForPlotly,
				cda,
				crr,
				windSource,
			),
		);
	});

	// Setup tab switching
	setupTabSwitching({
		wind: () => renderGpsLapWindPlot(lapProfiles),
		power: () => renderGpsLapPowerPlot(lapProfiles),
		vd: () => renderGpsLapVdPlot(lapProfiles),
	});

	// Setup wind source radio button listeners
	bindWindSourceRadios(() => {
		log.debug("Wind source changed - triggering GPS lap VE recalculation");
		void recalculateGpsLapVE(
			appState,
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
	const airSpeedCalibrationValue = document.getElementById(
		"airSpeedCalibrationValue",
	) as HTMLInputElement;

	if (airSpeedCalibrationSlider && airSpeedCalibrationValue) {
		const updateAirSpeedCalibration = () => {
			const value = parseFloat(airSpeedCalibrationSlider.value);
			airSpeedCalibrationValue.value = value.toFixed(1);
			appState.airSpeedCalibrationPercent = value;
			void saveCurrentMultiSegmentSettings(appState, parameterStorage);
			log.debug("Air speed calibration changed - updating GPS lap VE plots");
			const windSource = getSelectedWindSource();
			const cda = parseFloat(
				(document.getElementById("cdaValue") as HTMLInputElement)?.value ||
					"0.3",
			);
			const crr = parseFloat(
				(document.getElementById("crrValue") as HTMLInputElement)?.value ||
					"0.008",
			);
			scheduleGpsLapRecompute(() =>
				updateGpsLapVEPlots(
					appState,
					parameterStorage,
					waitForPlotly,
					cda,
					crr,
					windSource,
				),
			);
		};

		const updateAirSpeedCalibrationFromInput = () => {
			const value = parseFloat(airSpeedCalibrationValue.value);
			if (isNaN(value)) return;
			const clamped = clampAirSpeedCalibrationPercent(value);
			airSpeedCalibrationSlider.value = clamped.toString();
			airSpeedCalibrationValue.value = clamped.toFixed(1);
			appState.airSpeedCalibrationPercent = clamped;
			void saveCurrentMultiSegmentSettings(appState, parameterStorage);
			log.debug("Air speed calibration changed - updating GPS lap VE plots");
			const windSource = getSelectedWindSource();
			const cda = parseFloat(
				(document.getElementById("cdaValue") as HTMLInputElement)?.value ||
					"0.3",
			);
			const crr = parseFloat(
				(document.getElementById("crrValue") as HTMLInputElement)?.value ||
					"0.008",
			);
			scheduleGpsLapRecompute(() =>
				updateGpsLapVEPlots(
					appState,
					parameterStorage,
					waitForPlotly,
					cda,
					crr,
					windSource,
				),
			);
		};

		airSpeedCalibrationSlider.addEventListener(
			"input",
			updateAirSpeedCalibration,
		);
		airSpeedCalibrationValue.addEventListener(
			"change",
			updateAirSpeedCalibrationFromInput,
		);

		const autoAdjustButton = document.getElementById(
			"autoAdjustCalibration",
		) as HTMLButtonElement;
		if (autoAdjustButton) {
			autoAdjustButton.addEventListener("click", () => {
				const calibrationPercent = calculateAutoAirSpeedCalibrationPercent(
					buildAutoCalibrationSegmentsFromRanges(
						appState,
						appState.currentGpsLapIndexRanges ?? [],
						getNormalizedActivityArrays,
						resolveWindSeries,
						extractSegmentData,
					),
				);

				if (calibrationPercent === null) {
					log.warn(
						"Cannot auto-adjust GPS lap calibration: no usable FIT air speed data available",
					);
					return;
				}

				airSpeedCalibrationSlider.value = calibrationPercent.toFixed(1);
				airSpeedCalibrationValue.value = calibrationPercent.toFixed(1);
				appState.airSpeedCalibrationPercent = calibrationPercent;
				void saveCurrentMultiSegmentSettings(appState, parameterStorage);
				log.debug(
					`Auto-adjusted GPS lap air speed calibration to ${calibrationPercent.toFixed(1)}%`,
				);
				const windSource = getSelectedWindSource();
				const cda = parseFloat(
					(document.getElementById("cdaValue") as HTMLInputElement)?.value ||
						"0.3",
				);
				const crr = parseFloat(
					(document.getElementById("crrValue") as HTMLInputElement)?.value ||
						"0.008",
				);
				scheduleGpsLapRecompute(() =>
					updateGpsLapVEPlots(
						appState,
						parameterStorage,
						waitForPlotly,
						cda,
						crr,
						windSource,
					),
				);
			});
		}
	}

	// Setup action footer buttons
	bindActionFooter({
		onSaveScreenshot: () => {
			void saveGpsLapScreenshot(waitForPlotly);
		},
		onStoreResult: () => {
			void handleStoreResult(appState, resultsStorage);
		},
		onExportAll: () => {
			void handleExportAllResults(resultsStorage);
		},
	});

	// Render the plots using the shared function
	renderGpsLapVEPlots(lapProfiles, meanElevation);

	// Scroll to the VE analysis section
	veSection?.scrollIntoView({ behavior: "smooth", block: "start" });

	log.debug(`GPS Lap VE plot rendered with ${lapProfiles.length} laps`);
}

/**
 * Setup slider event handlers for GPS lap mode (uses standard slider IDs).
 */
export function setupGpsLapSliderHandlers(
	appState: AppState,
	parameterStorage: ParameterStorage,
	waitForPlotly: () => Promise<any>,
	_params: AnalysisParameters,
) {
	const cdaSlider = document.getElementById("cdaSlider") as HTMLInputElement;
	const cdaValue = document.getElementById("cdaValue") as HTMLInputElement;
	const crrSlider = document.getElementById("crrSlider") as HTMLInputElement;
	const crrValue = document.getElementById("crrValue") as HTMLInputElement;

	const triggerRecalculation = () => {
		const windSource = getSelectedWindSource();
		const cda = parseFloat(cdaValue?.value || "0.3");
		const crr = parseFloat(crrValue?.value || "0.008");
		scheduleGpsLapRecompute(() =>
			updateGpsLapVEPlots(
				appState,
				parameterStorage,
				waitForPlotly,
				cda,
				crr,
				windSource,
			),
		);
	};

	if (cdaSlider && cdaValue) {
		cdaSlider.addEventListener("input", () => {
			cdaValue.value = parseFloat(cdaSlider.value).toFixed(3);
			void saveCurrentMultiSegmentSettings(appState, parameterStorage);
			triggerRecalculation();
		});
		cdaValue.addEventListener("change", () => {
			cdaSlider.value = cdaValue.value;
			void saveCurrentMultiSegmentSettings(appState, parameterStorage);
			triggerRecalculation();
		});
	}

	if (crrSlider && crrValue) {
		crrSlider.addEventListener("input", () => {
			crrValue.value = parseFloat(crrSlider.value).toFixed(4);
			void saveCurrentMultiSegmentSettings(appState, parameterStorage);
			triggerRecalculation();
		});
		crrValue.addEventListener("change", () => {
			crrSlider.value = crrValue.value;
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

/**
 * Look up the GPS lap number for a given index range, falling back to the
 * provided lap number when no matching detected lap is found.
 *
 * The lookup itself moved to `modes/analysis/activeGpsLapRanges.ts` in plan
 * 07-02 Task 3, because `gpsLapMode` labels its segments and writes
 * `currentAnalyzedLaps` with it and cannot import from the shell (D-03). This
 * export survives as the shell's name for it so existing callers are untouched
 * — but there is only ONE implementation.
 */
export function getGpsLapNumberForRange(
	appState: AppState,
	range: { startIdx: number; endIdx: number },
	fallbackLapNumber: number,
): number {
	return resolveGpsLapNumber(appState, range, fallbackLapNumber);
}

export interface GpsLapVeTemplateOptions {
	params: AnalysisParameters;
	hasWindSpeed: boolean;
	hasConstantWind: boolean;
	showWindTab: boolean;
	showFitWindControls: boolean;
	showVirtualDistanceTab: boolean;
	selectedWindSource: string;
	currentAirSpeedCalibrationValue: string;
	initialStats: { meanR2: number; meanRMSE: number; closingError: number };
	lapCount: number;
	defaultAirSpeedOffset: number;
	elevationToggleMarkup: string;
}

/**
 * Exported for `gpsLapVdHeader.test.ts`, which guards that the VD tab actually
 * carries a header container. It had none, which is why stacked mode and GPS lap
 * splitting mode showed no label at all -- a gap only a markup assertion catches,
 * since a renderer writing into a container that does not exist fails silently.
 */
export function buildGpsLapVeAnalysisTemplate(
	opts: GpsLapVeTemplateOptions,
): string {
	const {
		params,
		hasWindSpeed,
		hasConstantWind,
		showWindTab,
		showFitWindControls,
		showVirtualDistanceTab,
		selectedWindSource,
		currentAirSpeedCalibrationValue,
		initialStats,
		lapCount,
		defaultAirSpeedOffset,
		elevationToggleMarkup,
	} = opts;

	return `
        <div class="ve-inline-container">
            <div class="ve-layout">
                <!-- Controls Sidebar -->
                <div class="ve-controls-sidebar">
                    <div class="ve-controls-scrollable">
                        <div class="ve-controls">
                            <h4>Analysis Parameters</h4>
                            ${elevationToggleMarkup}
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
                            ${lapViewToggleMarkup("stacked")}
                            <div class="ve-metrics-compact">
                                Mean R²:<span id="gpsLapR2Value">${initialStats.meanR2.toFixed(4)}</span> |
                                Mean RMSE:<span id="gpsLapRmseValue">${initialStats.meanRMSE.toFixed(2)}m</span> |
                                Closing Error:<span id="gpsLapClosingErrorValue">${initialStats.closingError.toFixed(2)}m</span> |
                                Laps:<span id="gpsLapCountValue">${lapCount}</span>
                            </div>
                            <div class="ve-plot-container">
                                <div id="gpsLapVePlot" class="ve-plot-container__plot ve-plot-container__plot--ve"></div>
                            </div>
                            <div class="ve-plot-container">
                                <div id="gpsLapResidualPlot" class="ve-plot-container__plot ve-plot-container__plot--residuals"></div>
                            </div>
                            <div class="ve-lap-summary">
                                <h4 class="ve-lap-summary__title">Detected Laps Summary</h4>
                                <div id="gpsLapSummaryTable"></div>
                            </div>
                        </div>

                        ${
													showWindTab
														? `
                        <div class="ve-tab-content" id="wind-tab">
                            <div id="gpsLapWindPlot" class="ve-plot ve-plot--tall"></div>
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
                            <div id="gpsLapPowerPlot" class="ve-plot ve-plot--tall"></div>
                        </div>

                        ${
													showVirtualDistanceTab
														? `
                        <div class="ve-tab-content" id="vd-tab">
                            <!--
                                This sidebar -- which the Standard "Stacked" view
                                also reuses -- had no VD header at all, so both
                                stacked mode and GPS lap splitting mode showed a
                                bare plot with the label missing outright. The
                                container is owned by vdHeader.ts and filled per
                                lap from the same cumulative series the plot
                                below draws.
                            -->
                            ${virtualDistanceHeaderMarkup()}
                            <div id="gpsLapVdPlot" class="ve-plot ve-plot--tall"></div>
                        </div>
                        `
														: ""
												}
                    </div>
                </div>
            </div>
        </div>
    `;
}
