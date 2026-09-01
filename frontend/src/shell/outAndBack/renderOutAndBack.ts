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
import type { AppState } from "../../state/AppState";
import type { OutAndBackSection } from "../../utils/GpsLapDetection";
import type { OutAndBackVEProfile } from "./types";

import {
	calculateAutoAirSpeedCalibrationPercent,
	formatAirSpeedCalibrationPercent,
} from "../../analysis/AirSpeedCalibration";
import { getNormalizedActivityArrays } from "../../analysis/ActivityArrayCache";
import {
	resolveElevationProfile,
	resolveReferenceElevation,
} from "../analysis/elevationProfileResolver";
import { resolveRhoArray } from "../analysis/rhoArrayResolver";
import { buildSegmentSupplementarySeries } from "../../analysis/SegmentSupplementarySeries";
import { extractSegmentData } from "../../analysis/SegmentExtractor";
import { createVeCalculator } from "../../analysis/VeCalculatorFactory";
import { resolveWindSeries } from "../../analysis/WindSourceResolver";
import {
	resolveMultiSegmentAnalysisParams,
	saveCurrentMultiSegmentSettings,
	buildAutoCalibrationSegmentsFromRanges,
} from "../../analysis/MultiSegmentSettings";
import {
	resetTabRenderMapForNewPanel,
	setupTabSwitching,
} from "../dom/tabs";
import {
	bindModeControls,
	type BindModeControlsResult,
} from "../analysis/bindModeControls";
import { registerModeUpdateCallbacks } from "../analysis/modeUpdateCallbacks";
import {
	getCheckedWindSource,
	getSelectedWindSource,
} from "../dom/windSource";
import { bindActionFooter } from "../dom/actionFooter";
import {
	handleExportBundle,
	handleExportSettings,
} from "../analysis/settingsExportHandlers";
import {
	handleStoreResult,
	handleExportAllResults,
	handleShowAllResults,
} from "../analysis/storageHandlers";
import { log } from "../../utils/log";
import { elevationSmoothingToggleMarkup } from "../analysis/elevationProfileCycle";
import {
	calculateOutAndBackMeanElevation,
	calculateOutAndBackMeanReference,
	calculateOutAndBackStats,
	renderOutAndBackPlots,
	renderOutAndBackWindPlot,
	renderOutAndBackPowerPlot,
	renderOutAndBackVdPlot,
} from "./outAndBackPlots";
import { createOutAndBackUpdateCallbacks } from "./updateOutAndBack";
import { saveOutAndBackScreenshot } from "./outAndBackScreenshot";
import { resolveAppliedCrr } from "../../analysis/CrrTemperatureCorrection";
import { autoConvergeLockControlsMarkup } from "../ve/autoConvergeLocks";
import { crrTempControlsMarkup } from "../ve/crrTempControls";
import { elevationDiffControlsMarkup } from "../ve/elevationDiffControls";
import { virtualDistanceHeaderMarkup } from "../ve/vdHeader";
import { convergenceBandMarkup } from "../analysis/convergenceBandReadout";
import { airSpeedOffsetControlMarkup } from "../ve/airSpeedOffsetControl";
import { airSpeedCalibrationControlMarkup } from "../ve/airSpeedCalibrationControl";
import { fitWindVisibilityAttrs } from "../ve/windSourceVisibility";
import { windHeightControlsMarkup } from "../ve/windHeightControls";
import { seedSegmentModeAnalyzeState } from "../../modes/analysis/segmentSummary";
import { requestModeUpdate } from "../analysis/requestModeUpdate";
import { sectionVirtualDistances } from "../../modes/analysis/segmentVirtualDistance";
import { requestConvergenceRedraw } from "../analysis/convergenceView";

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
	// WR-1: the analyze leg resolves the elevation profile exactly as the update
	// path does (`updateGpsLap.ts`, `updateModeVEPlots.ts`). Reading
	// `normalizedArrays.altitude` straight through meant that, with a DEM
	// applied, the smoothing toggle rendered ON while this first paint was
	// computed from the raw FIT channel -- and the numbers then moved on the
	// first control nudge, when the primitive took over.
	const resolvedProfile = resolveElevationProfile(
		appState,
		fitData,
		normalizedArrays.altitude,
	);
	const allAltitude = resolvedProfile.altitude;
	// The NON-master channel, resolved once like the primitive does — sliced
	// per leg below so the first paint already shows both channels.
	const allReferenceElevation = resolveReferenceElevation(
		appState,
		resolvedProfile.profile,
		normalizedArrays.altitude.length,
	);
	const allDistance = normalizedArrays.distance;

	// RHO, RESOLVED EXACTLY AS THE PRIMITIVE RESOLVES IT (WR-4 follow-up).
	//
	// This calculator used to be built with NO `rhoArray` at all, while
	// `updateModeVEPlots` passes a per-segment slice (`:251`). On any ride
	// carrying usable air density the two passes therefore integrated different
	// physics -- constant `params.rho` here, the real per-point series there --
	// and the panel visibly changed by itself when the post-bind kick landed.
	// Measured on the golden ride: mean RMSE 7.809 m at the analyze paint
	// against 7.555 m one macrotask later, and the analyze number was the wrong
	// one.
	//
	// `resolveRhoArray` is the one resolver both paths share (D-06), so this is
	// the same call the primitive makes, not a second opinion.
	const allRho = resolveRhoArray(fitData, normalizedArrays);

	/**
	 * The rho slice for one leg, on `extractSegmentData`'s own bounds
	 * (`SegmentExtractor.ts:26`) so the series cannot end up a different length
	 * from the ones beside it.
	 *
	 * BOUNDED BY THE DENSITY SERIES AS WELL. `hasAirDensityData` is a
	 * `.some(...)`, so a channel the device stopped emitting mid-ride is still
	 * accepted, and indexing on `allTimestamps` alone put `undefined` into a
	 * `number[]` — NaN rho across the WASM boundary for that leg. Same rule as
	 * `resolveSelectionRhoArray` (`rhoArrayResolver.ts:86`): a leg the series
	 * does not span falls back to the constant `params.rho` rather than to a
	 * hole-punched array.
	 */
	const legRho = (startIdx: number, endIdx: number): number[] | null => {
		if (!allRho) return null;
		const slice: number[] = [];
		for (let i = startIdx; i <= endIdx && i < allTimestamps.length; i++) {
			if (i >= allRho.length) {
				log.warn(
					`Air density series (${allRho.length}) does not span leg ${startIdx}-${endIdx}; using constant rho`,
				);
				return null;
			}
			slice.push(allRho[i]);
		}
		return slice;
	};

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
			outboundVECompare: null,
			outboundActualElevation: [],
			outboundReferenceElevation: null,
			outboundSeries: null,
			outboundRange: null,
			inboundDistances: [],
			inboundVE: [],
			inboundVECompare: null,
			inboundActualElevation: [],
			inboundReferenceElevation: null,
			inboundSeries: null,
			inboundRange: null,
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
					rhoArray: legRho(section.outboundStartIdx, section.outboundEndIdx),
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

				profile.outboundRange = {
					startIdx: section.outboundStartIdx,
					endIdx: section.outboundEndIdx,
				};
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
				profile.outboundReferenceElevation = allReferenceElevation
					? {
							label: allReferenceElevation.label,
							series: allReferenceElevation.series.slice(
								section.outboundStartIdx,
								section.outboundEndIdx + 1,
							),
						}
					: null;
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
					rhoArray: legRho(section.inboundStartIdx, section.inboundEndIdx),
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

				profile.inboundRange = {
					startIdx: section.inboundStartIdx,
					endIdx: section.inboundEndIdx,
				};
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
				profile.inboundReferenceElevation = allReferenceElevation
					? {
							label: allReferenceElevation.label,
							series: allReferenceElevation.series.slice(
								section.inboundStartIdx,
								section.inboundEndIdx + 1,
							),
						}
					: null;
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

	// Preserve the CHECKED wind source across the re-render — null when no
	// radio is checked (first render, or a sensor-less ride), so the
	// `preservedWindSource || (hasWindSpeed ? "fit" : "constant")` default below
	// actually fires. `getSelectedWindSource`'s 'fit' fallback here made that
	// default dead code: a ride with no wind channel opened stuck on 'fit',
	// its lone constant radio unchecked and the wind-height control hidden.
	const preservedWindSource = getCheckedWindSource();

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
export function outAndBackVdTabMarkup(
	show: boolean,
	windSource?: string | null,
): string {
	if (!show) return "";
	return `
                        <div class="ve-tab-content" id="vd-tab"${fitWindVisibilityAttrs(windSource)}>
                            ${virtualDistanceHeaderMarkup()}
                            <div class="ve-plot-container"><div id="oabVdPlot" class="ve-plot-container__plot ve-plot-container__plot--tall"></div></div>
                        </div>
                        `;
}

export interface OutAndBackVeTemplateOptions {
	params: AnalysisParameters;
	hasWindSpeed: boolean;
	hasConstantWind: boolean;
	showWindTab: boolean;
	showVirtualDistanceTab: boolean;
	selectedWindSource: string;
	currentAirSpeedCalibrationValue: string;
	initialStats: {
		rmse: number;
		avgVeGain: number;
		avgActualGain: number;
	};
	sectionCount: number;
	defaultAirSpeedOffset: number;
	elevationToggleMarkup: string;
}

/**
 * The out-and-back sidebar, as a PURE function of its flags.
 *
 * It used to be interpolated inline inside `showOutAndBackVEPlot`, which is
 * `async` and awaits Plotly before it touches the DOM — so no test could reach
 * it and every claim about which controls out-and-back renders under which wind
 * source was a READ of the template rather than an observation of its output.
 * Plan 07-03 depends on those claims (it makes presence static and moves the
 * source dependence into visibility), and this phase has already had one static
 * claim refuted by running the code. Extracting the template is what turns the
 * out-and-back column of the sidebar table from a hypothesis into a test —
 * `outAndBackSidebar.presence.test.ts` renders this and queries it, exactly as
 * `gpsLapSidebar.presence.test.ts` does for the parallel GPS-lap template.
 *
 * T-08-02: every interpolated value is a number produced by toFixed or one of
 * the exported numeric constants, plus markup from the shared control helpers.
 * No user-controlled string reaches the template. Behaviour is a verbatim lift.
 */
export function buildOutAndBackVeAnalysisTemplate(
	opts: OutAndBackVeTemplateOptions,
): string {
	const {
		params,
		hasWindSpeed,
		hasConstantWind,
		showWindTab,
		showVirtualDistanceTab,
		selectedWindSource,
		currentAirSpeedCalibrationValue,
		initialStats,
		sectionCount,
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
                                ${autoConvergeLockControlsMarkup()}
                                ${elevationDiffControlsMarkup(params, "outAndBack")}
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
																? airSpeedCalibrationControlMarkup(
																		currentAirSpeedCalibrationValue,
																		selectedWindSource,
																	)
																: ""
														}
                        </div>
                    </div>

                    <div class="ve-sidebar-footer">
                        <button id="saveScreenshot" class="primary-btn ve-sidebar-footer__btn ve-sidebar-footer__btn--spaced">Save Screenshot</button>
                        <button id="storeResult" class="primary-btn ve-sidebar-footer__btn ve-sidebar-footer__btn--spaced">Store Result</button>
                        <button id="showAllResults" class="secondary-btn ve-sidebar-footer__btn ve-sidebar-footer__btn--compact">Show All Results</button>
                        <button id="exportAllResults" class="secondary-btn ve-sidebar-footer__btn ve-sidebar-footer__btn--compact">Export All Results to CSV</button>
                        <button id="exportSettingsJson" class="secondary-btn ve-sidebar-footer__btn ve-sidebar-footer__btn--compact">Export Settings (JSON)</button>
                        <button id="exportBundleZip" class="secondary-btn ve-sidebar-footer__btn ve-sidebar-footer__btn--compact">Export Zip (FIT + Settings)</button>
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
                            <button class="ve-tab-button" data-tab="vd"${fitWindVisibilityAttrs(selectedWindSource)}>VD</button>
                            `
																: ""
														}
                            <button class="ve-tab-button" data-tab="convergence">Convergence</button>
                        </div>

                        <div class="ve-tab-content ve-tab-content--active" id="ve-tab">
                            <div class="ve-metrics-compact">
                                RMSE:<span id="oabRmseValue">${initialStats.rmse.toFixed(2)}m</span> |
                                VE Gain:<span id="oabVeGainValue">${initialStats.avgVeGain.toFixed(2)}m</span> |
                                Actual:<span id="oabActualGainValue">${initialStats.avgActualGain.toFixed(2)}m</span> |
                                Sections:<span id="oabSectionCountValue">${sectionCount}</span>
                                <!-- Filled in only under "Compare both methods",
                                     so the paired spans above are read as two
                                     numbers rather than one (07-04 ruling 2). -->
                                <span id="oabCompareMarker"></span>
                            </div>
                            <div class="ve-plot-container">
                                <div id="oabVePlot" class="ve-plot-container__plot ve-plot-container__plot--ve"></div>
                            </div>
                            <div class="ve-plot-container">
                                <div id="oabVeResidualsPlot" class="ve-plot-container__plot ve-plot-container__plot--residuals"></div>
                            </div>
                            <!-- The constant-wind view, BELOW the FIT view (D-20
                                 option-b). Present unconditionally so the render
                                 path only has to unhide it; hidden until an
                                 update actually carries a comparison series. -->
                            <div id="oabCompareView" class="hidden">
                                <div class="ve-plot-container">
                                    <div id="oabVeComparePlot" class="ve-plot-container__plot ve-plot-container__plot--ve"></div>
                                </div>
                                <div class="ve-plot-container">
                                    <div id="oabVeCompareResidualsPlot" class="ve-plot-container__plot ve-plot-container__plot--residuals"></div>
                                </div>
                            </div>
                            <div id="oabClosingError" class="ve-closing-error hidden"></div>
                        </div>

                        ${
													showWindTab
														? `
                        <div class="ve-tab-content" id="wind-tab">
                            <div class="ve-plot-container"><div id="oabWindPlot" class="ve-plot-container__plot ve-plot-container__plot--tall"></div></div>
                            ${
															// PRESENCE on hasWindSpeed, VISIBILITY on the source.
															// Gated on showFitWindControls this block was absent
															// from the DOM under constant, so bindModeControls --
															// which binds ONCE, from the render -- skipped its row
															// and the slider would stay unbound for the panel's
															// life once the source-driven sidebar rebuild is
															// removed. The shared helper carries
															// data-wind-source="fit", so under constant the block
															// is present-and-hidden: the user sees exactly what
															// they see today, because it was not rendered there.
															hasWindSpeed
																? airSpeedOffsetControlMarkup(
																		params?.air_speed_offset,
																		defaultAirSpeedOffset,
																		selectedWindSource,
																	)
																: ""
														}
                        </div>
                        `
														: ""
												}

                        <div class="ve-tab-content" id="power-tab">
                            <div class="ve-plot-container"><div id="oabPowerPlot" class="ve-plot-container__plot ve-plot-container__plot--tall"></div></div>
                        </div>

                        ${outAndBackVdTabMarkup(showVirtualDistanceTab, selectedWindSource)}
                        <div class="ve-tab-content" id="convergence-tab">
                            <div class="ve-plot-container"><div id="convergencePlot" class="ve-plot-container__plot ve-plot-container__plot--square"></div></div>
                            ${convergenceBandMarkup()}
                        </div>
                    </div>
                </div>
            </div>
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

	// CR-01. THE PANEL AND THE ANALYSED SAMPLES GO ON SCREEN TOGETHER.
	//
	// `currentFilteredData` had no analyze-time writer for this mode: the only
	// other one is `summarize`, which first runs when the user touches a
	// control. So Analyze -> Store Result with nothing in between either
	// refused ("no analysed samples"), or — if a Standard analysis had run
	// earlier in the session — averaged THAT selection's power, speed and
	// recording date while persisting this ride's result and sections.
	//
	// Seeded here rather than in `showOutAndBackVEAnalysis` because this is the
	// entry point every path to a rendered out-and-back panel passes through,
	// including a re-render from preserved profiles. Goes through
	// `seedSegmentModeFilteredData` so the arrays are built by the same
	// concatenation `summarize` uses — a second assembly would be one more
	// writer of a field whose writers disagreeing was CR-02.
	//
	// The seed covers the LEGS THAT PRODUCED OUTPUT, not the selected sections
	// (WR-03/WR-06). Either leg of a section can come back null — its calculator
	// threw (`:223`, `:289`) — and a section keeps its place in the profile list
	// as long as ONE leg survived. Ranging over the sections would therefore seed
	// samples no plotted leg describes, which is why the filter below is on the
	// per-leg ranges rather than on `resolveActiveOutAndBackSections`.
	// Computed BEFORE the seed: WR-3 records it, and the panel below renders from
	// the same value, so the two cannot describe different sources.
	const selectedWindSource =
		preservedWindSource || (hasWindSpeed ? "fit" : "constant");

	seedSegmentModeAnalyzeState(appState, {
		ranges: profiles.flatMap((profile) =>
			[profile.outboundRange, profile.inboundRange].filter(
				(range): range is { startIdx: number; endIdx: number } =>
					range !== null,
			),
		),
		// Both arguments, as in renderGpsLap: `selectedWindSource` is already the
		// resolved panel source, and `resolveRecordedWindSource` preserves
		// "compare" while passing the other two straight through.
		requestedWindSource: selectedWindSource as never,
		resolvedWindSource: selectedWindSource as never,
		// ONE entry per SECTION, not per leg — the maintainer's ruling that
		// `outAndBackMode.summarize` already follows. Reusing the same builder is
		// what keeps an analyze-time export identical to a post-update one, 2N
		// lines being exactly what it exists to prevent.
		virtualDistances: sectionVirtualDistances(
			profiles.map((profile) => ({
				label: `Section ${profile.sectionNumber}`,
				outbound: profile.outboundSeries ?? null,
				inbound: profile.inboundSeries ?? null,
			})),
		),
	});
	const showWindTab = hasWindSpeed || hasConstantWind;
	// PRESENCE, not visibility — see the identical note in renderGpsLap.ts.
	const showVirtualDistanceTab = hasWindSpeed;

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
	// WR-01. The outgoing panel's tab callbacks close over ITS profiles and draw
	// into element ids this new markup reuses, so they must not outlive it.
	// Without this, any first pass that does not reach `renderVe` leaves
	// Wind/Power/VD rendering the PREVIOUS selection into this panel.
	resetTabRenderMapForNewPanel();
	veAnalysisContent.innerHTML = buildOutAndBackVeAnalysisTemplate({
		params,
		hasWindSpeed,
		hasConstantWind,
		showWindTab,
		showVirtualDistanceTab,
		selectedWindSource,
		currentAirSpeedCalibrationValue,
		initialStats,
		sectionCount: profiles.length,
		defaultAirSpeedOffset,
		elevationToggleMarkup: elevationSmoothingToggleMarkup(appState),
	});

	// Setup slider sync with recalculation
	// The renderer half of the mode seam, registered from the render that owns
	// the Plotly handle and the activity arrays it closes over. Must happen
	// before the first `requestModeUpdate`.
	registerModeUpdateCallbacks("outAndBack", () =>
		createOutAndBackUpdateCallbacks(appState, Plotly),
	);

	setupOutAndBackSliderSync(services, parameterStorage, waitForPlotly);

	// Every VE control is bound by `setupOutAndBackSliderSync` above, from
	// MODE_CONTROL_TABLE. What used to sit here -- the elevation-smoothing
	// toggle, the wind-source radios, the calibration slider, its number input
	// and Auto Adjust -- was six more hand-written listeners in a second file.
	//
	// The wind-source radios no longer call `recalculateOutAndBackVE`, which
	// rebuilt the whole sidebar behind a spinner and redrew every plot. A source
	// change is now one scheduled recompute like every other control, and the
	// panel persists across it.

	setupTabSwitching({
		wind: () => renderOutAndBackWindPlot(profiles),
		power: () => renderOutAndBackPowerPlot(profiles),
		vd: () => renderOutAndBackVdPlot(profiles),
		convergence: requestConvergenceRedraw,
	});

	// Setup action footer buttons
	bindActionFooter({
		onSaveScreenshot: () => {
			void saveOutAndBackScreenshot(waitForPlotly);
		},
		onStoreResult: () => {
			void handleStoreResult(appState, resultsStorage);
		},
		onShowAllResults: () => {
			void handleShowAllResults(resultsStorage);
		},
		onExportAll: () => {
			void handleExportAllResults(resultsStorage);
		},
		onExportSettings: () => {
			void handleExportSettings(appState, parameterStorage);
		},
		onExportBundle: () => {
			void handleExportBundle(appState, parameterStorage);
		},
	});

	// Initial plot render. The non-master channel's mean rides on the section
	// profiles themselves, so it is derived here rather than threaded through
	// the long signature above.
	renderOutAndBackPlots(
		Plotly,
		profiles,
		meanElevation,
		calculateOutAndBackMeanReference(profiles),
	);

	// THE POST-BIND KICK (WR-4). Standard has had this since before the phase
	// -- `renderStandardVe.ts:562` -- which is the whole reason Standard never
	// carried this bug.
	//
	// Everything the analyze leg above computed is a FIRST PAINT, not a
	// RESULT: it keeps `virtual_elevation` from each per-lap fit and discards
	// r2, RMSE and the elevation gains. So without this line the only writer
	// of `appState.currentVEResult` on an analyze was the stitched fit
	// `prepareAnalysisPayload` runs over the concatenated selection, which
	// this panel never displays -- and the first control nudge replaced it.
	//
	// Scheduled, not called: `requestModeUpdate` funnels into
	// `scheduleRecompute`, so the pass lands on the next macrotask and the
	// value it writes is produced by the SAME code path a control gesture
	// uses. That identity is the point. Hand-rolling the aggregation here
	// would give the field a second writer with its own idea of trim, wind
	// source and segmentation, which is the CR-02 shape.
	//
	// AFTER the binder, never before: `bindModeControls` is what calls
	// `configureModeUpdateRequests` (`bindModeControls.ts:154`), and
	// `requestModeUpdate` no-ops while that is unset.
	requestModeUpdate("parameters");

	// Scroll to the VE analysis section
	veSection?.scrollIntoView({ behavior: "smooth", block: "start" });
}

/**
 * Wire every out-and-back VE control, from the one table, through the one funnel.
 *
 * Same replacement as GPS-lap, for the same reason: this function hand-wrote
 * four listeners for CdA and Crr and delegated two more blocks, while the RENDER
 * function next door hand-wrote six more for elevation smoothing, the
 * wind-source radios, the calibration slider, its number input and Auto Adjust.
 * There is now exactly one place per mode where a VE control is wired, and it is
 * `MODE_CONTROL_TABLE`.
 *
 * `bindActionFooter` stays in the render function: it never recomputes, so it is
 * deliberately not in the table.
 *
 * RETURNS what `bindModeControls` bound, so "every row out-and-back claims is
 * bound in out-and-back" is a checkable property of the real wiring — see
 * `modeControlBindingCoverage.test.ts`.
 */
export function setupOutAndBackSliderSync(
	services: ShellServices,
	parameterStorage: ParameterStorage,
	_waitForPlotly: () => Promise<any>,
): BindModeControlsResult {
	const { appState } = services;

	/** The section windows every per-segment readout is measured over. */
	const ranges = () => outAndBackRanges(appState);

	return bindModeControls({
		appState,
		modeId: "outAndBack",
		saveSettings: () => {
			void saveCurrentMultiSegmentSettings(appState, parameterStorage);
		},
		// N-3: one sync-error window per section leg — outbound and inbound are
		// separate windows, as they are everywhere else in this mode.
		getOffsetMetricWindows: () =>
			ranges().map((range) => ({ start: range.startIdx, end: range.endIdx })),
		getSyncErrorSeries: () => syncErrorSeries(appState),
		getAutoCalibrationPercent: () =>
			calculateAutoAirSpeedCalibrationPercent(
				buildAutoCalibrationSegmentsFromRanges(
					appState,
					ranges(),
					getNormalizedActivityArrays,
					resolveWindSeries,
					extractSegmentData,
				),
			),
	});
}

/** Outbound and inbound legs of every section, as flat index ranges. */
function outAndBackRanges(
	appState: AppState,
): Array<{ startIdx: number; endIdx: number }> {
	return appState.currentOutAndBackSections.flatMap((section) => [
		{ startIdx: section.outboundStartIdx, endIdx: section.outboundEndIdx },
		{ startIdx: section.inboundStartIdx, endIdx: section.inboundEndIdx },
	]);
}

/**
 * The ground- and air-speed series the offset metric is measured between.
 *
 * Resolved on demand rather than captured at render time, so the number follows
 * the CURRENTLY selected wind source. Both lookups are cached, so this is a map
 * read per interaction.
 */
function syncErrorSeries(appState: AppState): {
	groundSpeed: number[];
	airSpeed: number[];
} {
	const fitData = appState.currentFitData;
	const params = appState.currentParameters;
	if (!fitData || !params) {
		return { groundSpeed: [], airSpeed: [] };
	}
	const normalized = getNormalizedActivityArrays(fitData);
	const resolution = resolveWindSeries({
		fitData,
		windSource: getSelectedWindSource(),
		params,
		airSpeedCalibrationPercent: appState.airSpeedCalibrationPercent,
	});
	return {
		groundSpeed: normalized.velocity,
		airSpeed: resolution.windSpeed,
	};
}
