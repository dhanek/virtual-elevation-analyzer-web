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
import { bindActionFooter } from "../dom/actionFooter";
import { getSelectedWindSource } from "../dom/windSource";
import { createPlotContext } from "../../plots/PlotContext";
import {
	bindPlotXAxisToggle,
	plotXAxisToggleMarkup,
	resetPlotXAxisForNewPanel,
} from "./plotXAxisToggle";
import {
	buildVirtualElevationFigures,
	buildWindSpeedFigure,
	buildSpeedPowerFigure,
	buildVirtualDistanceFigure,
} from "../../plots/StandardPlotBuilders";
import {
	setupVESliders,
	updateMetricsDisplay,
} from "./bindStandardSliders";
import { resolveAppliedCrr } from "../../analysis/CrrTemperatureCorrection";
import { crrTempControlsMarkup } from "./crrTempControls";
import { windHeightControlsMarkup } from "./windHeightControls";
import { airSpeedOffsetControlMarkup } from "./airSpeedOffsetControl";
import { airSpeedCalibrationControlMarkup } from "./airSpeedCalibrationControl";
import { fitWindVisibilityAttrs } from "./windSourceVisibility";
import { ParameterStorage } from "../../utils/ParameterStorage";
import { ShellServices } from "../analysis/types";
import { createVeCalculator } from "../../analysis/VeCalculatorFactory";
import { resolveSelectionRhoArray } from "../analysis/rhoArrayResolver";
import {
	resolvePlaceholderWindSpeed,
	resolveSelectionWindSeries,
} from "./standardSegments";
import { seedSegmentModeFilteredData } from "../../modes/analysis/segmentSummary";
import { standardMode } from "../../modes/analysis/standardMode";
import {
	selectedLapCount,
	updateCombinedVirtualDistanceHeader,
	virtualDistanceHeaderMarkup,
} from "./vdHeader";
import { elevationSmoothingToggleMarkup } from "../analysis/elevationProfileCycle";
import { bindLapViewToggle, lapViewToggleMarkup } from "./lapViewToggle";
import {
	bindTabButtons,
	resetTabRenderMapForNewPanel,
} from "../dom/tabs";

// Plotly.js type declaration
declare const Plotly: any;

const MIN_TRIM_WINDOW_SAMPLES = 30;

export interface StandardVeCallbacks {
	onSaveScreenshot: () => void;
	onStoreResult: () => void;
	onExportAll: () => void;
	onShowAllResults: () => void;
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

	// D-05: resolved ONCE, above the calculator, and shared with the plots
	// below. It used to be resolved after the fit, which left the calculator
	// reading the raw FIT channel while the wind plotted beneath it read the
	// offset-and-calibrated one.
	//
	// The series is resolved over the FULL activity and sliced afterwards, which
	// is the ordering that keeps the offset from crossing a lap boundary in a
	// multi-lap selection (D-09 change-list entry c).
	const resolvedWindSpeed = resolveSelectionWindSeries(
		appState,
		selectedIndices,
		initialWindSource === "fit" ? "fit" : "constant",
	);

	// RHO, RESOLVED EXACTLY AS THE PRIMITIVE RESOLVES IT — the third and last
	// analyze leg. `renderGpsLap` and `renderOutAndBack` were corrected first;
	// this one was left building its calculator with no `rhoArray` while
	// `updateModeVEPlots:251` passes a per-segment slice, so on any ride with
	// usable air density the two passes integrated different physics. That was
	// filed as unobservable while this paint only drew plots. It is observable
	// now: `updateMetricsDisplay` below writes R²/RMSE/VE/Actual from THIS fit,
	// so the header showed the constant-rho numbers until the post-bind kick
	// landed — and kept showing them on any path where the scheduled pass never
	// reaches `renderVe` (every segment under the trim floor, a calculator
	// throwing, a saved trim already at its clamp).
	const selectionRho = appState.currentFitData
		? resolveSelectionRhoArray(
				appState.currentFitData,
				selectedIndices,
				analysisInput.timestamps.length,
			)
		: null;

	const calculator = createVeCalculator({
		timestamps: analysisInput.timestamps,
		power: analysisInput.power,
		velocity: analysisInput.velocity,
		positionLat: analysisInput.positionLat,
		positionLong: analysisInput.positionLong,
		altitude: analysisInput.altitude,
		distance: analysisInput.distance,
		windSpeed: resolvePlaceholderWindSpeed(
			initialWindSource === "fit" ? "fit" : "constant",
			analysisInput.windSpeed,
			resolvedWindSpeed,
		),
		rhoArray: selectionRho,
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
	// applied both. All four now read the one series resolved above.
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

	// `react`, not `newPlot`, for all five (bundle D). Every one of these ids is
	// redrawn on every slider update -- `bindStandardSliders` already reaches
	// four of them through `react` -- so `newPlot` here only bought a teardown
	// and rebuild on the FIRST draw, and left the pattern for the next plot to
	// be copied from. `react` on a div Plotly has never touched initialises it
	// exactly as `newPlot` would, so there is no first-draw special case.
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
	Plotly.react(
		"windSpeedPlot",
		windSpeedFigure.data,
		windSpeedFigure.layout,
		windSpeedFigure.config,
	);
	Plotly.react(
		"speedPowerPlot",
		speedPowerFigure.data,
		speedPowerFigure.layout,
		speedPowerFigure.config,
	);
	Plotly.react(
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

	// The R2/RMSE/VE/Actual spans, on the same rule as the VD header above and
	// for the same reason: fill them from the integration that just drew the
	// curve, never from a fit computed somewhere else.
	//
	// The template used to interpolate `prepareAnalysisPayload`'s
	// `initialResult`, which integrates the CONCATENATED selection with NO trim
	// and the wind source forced to `"fit"` with the offset off. The plot
	// directly below the header came from `result` above -- trimmed, and on the
	// selected source. Two fits of one ride, side by side, until the kick
	// overwrote both a macrotask later.
	//
	// `null` for the lap count: the template already wrote it from
	// `analyzedLaps.length`, and this pass has no per-segment decomposition to
	// improve on it with.
	updateMetricsDisplay(
		result.r2,
		result.rmse,
		result.ve_elevation_diff,
		result.actual_elevation_diff,
		null,
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
	/**
	 * UNREAD since CR-01, and kept only to hold its place in this positional
	 * signature: `standardMode.render` spreads the whole payload
	 * (`...args.filteredData`) and `analyzeOrchestrator` forwards it field by
	 * field, so dropping the parameter would silently shift `cdaReference` and
	 * `defaultAirSpeedOffset` up by one at every call site.
	 *
	 * The seed below reads temperature from `fitData` through
	 * `buildFilteredDataFromIndexGroups` instead — the same source, but with the
	 * NaN "no reading" marker rather than a fabricated 0 °C.
	 */
	_temperature: number[] = [],
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
	// Coverage is unknown until the first `summarize` (WR-01); the previous
	// analysis's must not ride along into this one.
	appState.currentCoveredItems = null;
	// THE FOURTH WRITER, CONVERTED (CR-01).
	//
	// This used to be `{ power, velocity, temperature, timestamps }` — the raw
	// analyze payload — which made `segmentSummary.ts`'s "THE ONE PLACE the
	// analysed sample arrays are concatenated" false for Standard, and carried
	// both defects that header's fixes closed downstream:
	//
	//   - UNTRIMMED. The payload is the whole deduplicated selection, so a lap the
	//     user had narrowed to a 30-sample window still stored averages over the
	//     acceleration and the roll-out.
	//   - 0 °C FABRICATED. `prepareAnalysisPayload` pushed `… || 0` for a missing
	//     reading, so a ride with no temperature channel produced an all-zero
	//     array that `handleStoreResult` reported as `avgTemperature: 0`,
	//     indistinguishable from a genuine 0 °C ride.
	//
	// It was reachable: `handleTrim` declines to run the pipeline when a saved
	// trim already sits at its clamp, so `summarize` had never run and this was
	// the value Store Result read. Seeding through the shared concatenation gives
	// Standard the NaN "no reading" marker for free, and `getUpdateSegments`
	// supplies exactly the per-lap ranges the first recompute will use.
	//
	// `getUpdateSegments` reads `currentAnalyzedLaps`, which is why it is assigned
	// above this and not below it.
	seedSegmentModeFilteredData(
		appState,
		standardMode.getUpdateSegments(appState).map((segment) => segment.range),
	);
	appState.currentCdaReference = cdaReference;

	const hasWindSpeed = windSpeed.some((val) => !isNaN(val) && val !== 0);
	const hasConstantWind =
		appState.currentParameters.wind_speed !== undefined &&
		appState.currentParameters.wind_speed !== 0 &&
		appState.currentParameters.wind_direction !== undefined;

	// The source the wind-source radios below open on. It decides only the
	// INITIAL hidden state of the source-dependent blocks — the bind-time sync in
	// `bindWindSourceRadios` settles them either way — so it is the difference
	// between no flash and a flash, never between right and wrong.
	const initialWindSource = hasWindSpeed
		? "fit"
		: hasConstantWind
			? "constant"
			: "fit";

	const veSection = document.getElementById("veAnalysisSection");
	if (veSection) {
		veSection.classList.remove("hidden", "workflow-section--inactive");
	}

	const veAnalysisContent = document.getElementById("veAnalysisContent");
	if (!veAnalysisContent) return;

	// WR-01. The outgoing panel's tab callbacks close over ITS profiles and draw
	// into element ids this new markup reuses, so they must not outlive it.
	// Without this, any first pass that does not reach `renderVe` leaves
	// Wind/Power/VD rendering the PREVIOUS selection into this panel.
	resetTabRenderMapForNewPanel();
	// Same lifecycle boundary, same reason: the first paint below builds a TIME
	// context (the cumulative distance series is a property of the stitched
	// profiles, which do not exist yet), so a distance setting carried over from
	// the previous analysis would light the wrong button over a time axis.
	resetPlotXAxisForNewPanel();
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
                                ${windHeightControlsMarkup(appState.currentParameters!, initialWindSource)}
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
																? airSpeedCalibrationControlMarkup(
																		appState.airSpeedCalibrationPercent.toFixed(1),
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
                    </div>
                </div>
                <div class="ve-plots-main">
                    <div class="ve-plots">
                        <div class="ve-tabs">
                            <button class="ve-tab-button ve-tab-button--active" data-tab="ve">VE</button>
                            ${cdaReference ? `<button class="ve-tab-button" data-tab="cda-validation">CdA Validation</button>` : ""}
                            ${hasWindSpeed || hasConstantWind ? `<button class="ve-tab-button" data-tab="wind">Wind</button>` : ""}
                            <button class="ve-tab-button" data-tab="power">Power</button>
                            ${
															/*
															 * The VD tab follows the wind source, exactly as both
															 * GPS sidebars already do (maintainer ruling
															 * 2026-08-14, REVERSING the 2026-08-05 one that had
															 * Standard keep it).
															 *
															 * The computation is untouched and is still correct
															 * under constant: VD integrates `apparentWindSpeedMps`,
															 * which the constant path computes from the configured
															 * wind. What was wrong was the POLICY. Standard's
															 * STACKED lap view is the GPS-lap overlay, whose
															 * template tags this tab, so within one mode the tab
															 * appeared under Stitched and vanished under Stacked as
															 * the user toggled views. Tagging here makes the two
															 * views agree, and makes all three modes agree.
															 */
															hasWindSpeed
																? `<button class="ve-tab-button" data-tab="vd"${fitWindVisibilityAttrs(initialWindSource)}>VD</button>`
																: ""
														}
                        </div>
                        <div class="ve-tab-content ve-tab-content--active" id="ve-tab">
                            ${lapViewToggleMarkup("stitched")}
                            <div class="ve-metrics-compact">
                                R²:<span id="r2Value"></span> |
                                RMSE:<span id="rmseValue"></span> |
                                VE:<span id="veGainValue"></span> |
                                Actual:<span id="actualGainValue"></span> |
                                Laps:<span id="lapsCoveredValue">${analyzedLaps.length}</span>
                            </div>
                            <div class="ve-plot-container"><div id="vePlot" class="ve-plot-container__plot ve-plot-container__plot--ve"></div></div>
                            <div class="ve-plot-container"><div id="veResidualsPlot" class="ve-plot-container__plot ve-plot-container__plot--residuals"></div></div>
                            <!--
                                Under the RESIDUALS plot, not the VE plot: the VE
                                plot hides its own tick labels and the residuals
                                plot below it carries the shared x-axis title, so
                                this is the control's own axis.
                            -->
                            ${plotXAxisToggleMarkup()}
                        </div>
                        ${
													cdaReference
														? `
                        <div class="ve-tab-content" id="cda-validation-tab">
                            <div class="ve-plot-container"><div id="cdaValidationPlot" class="ve-plot-container__plot ve-plot-container__plot--ve"></div></div>
                            <div class="ve-plot-container"><div id="cdaValidationResidualsPlot" class="ve-plot-container__plot ve-plot-container__plot--residuals"></div></div>
                        </div>
                        `
														: ""
												}
                        <div class="ve-tab-content" id="wind-tab">
                            <div class="ve-plot-container"><div id="windSpeedPlot" class="ve-plot-container__plot ve-plot-container__plot--tall"></div></div>
                            ${plotXAxisToggleMarkup()}
                            ${
															/*
															 * N-3 (maintainer ruling, plan 07-03): Standard gains
															 * the offset control the two GPS sidebars already had,
															 * from the one shared markup helper so it reads as the
															 * same control. Gated on hasWindSpeed only -- the offset
															 * shifts the FIT air-speed channel, so with no such
															 * channel there is nothing to shift -- and deliberately
															 * NOT on the selected wind source: this template is not
															 * rebuilt when the source changes, so a source-gated
															 * control would be absent at bind time and stay unbound.
															 */
															hasWindSpeed
																? airSpeedOffsetControlMarkup(
																		appState.currentParameters?.air_speed_offset,
																		defaultAirSpeedOffset,
																	)
																: ""
														}
                        </div>
                        <div class="ve-tab-content" id="power-tab">
                            <div class="ve-plot-container"><div id="speedPowerPlot" class="ve-plot-container__plot ve-plot-container__plot--tall"></div></div>
                            ${plotXAxisToggleMarkup()}
                        </div>
                        <div class="ve-tab-content" id="vd-tab"${fitWindVisibilityAttrs(initialWindSource)}>
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
                            <div class="ve-plot-container"><div id="vdPlot" class="ve-plot-container__plot ve-plot-container__plot--tall"></div></div>
                            ${plotXAxisToggleMarkup()}
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
		timestamps,
		velocity,
		positionLat,
		positionLong,
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

	// BIND THE BUTTONS, DO NOT TOUCH THE MAP.
	//
	// This was a bare `setupTabSwitching()`, which assigned
	// `currentRenderMap = renderMap` unconditionally and so WIPED the real map
	// that `createStandardUpdateCallbacks.renderVe` installs
	// (`bindStandardSliders.ts:241`). It only appeared to work because
	// `scheduleRecompute` defers to `setTimeout(..., 0)`, so the dispatch above
	// lands `renderVe` on the NEXT macrotask, after this line.
	//
	// Deleting the call outright fixed the wipe but took the button binding with
	// it, which left the tabs UNBOUND on exactly the paths that motivated the
	// fix — every segment under MIN_SEGMENT_SAMPLES, every calculator throwing,
	// a trim window at its clamp — where the scheduled pass never reaches
	// `renderVe` to bind them. `bindTabButtons` is the half that is always safe
	// to run: idempotent (WeakSet-guarded) and map-preserving, so the tabs
	// respond even when the first pass produces nothing to draw.
	bindTabButtons();

	bindLapViewToggle();

	// Bound here, next to the other panel controls, for exactly the reason the
	// comment above `bindTabButtons` gives: this is the half that is always safe
	// to run, so the control responds even on the paths where the first
	// scheduled pass never reaches `renderVe`. It stays hidden until a draw
	// reports a usable distance channel.
	bindPlotXAxisToggle();

	bindActionFooter({
		onSaveScreenshot: callbacks.onSaveScreenshot,
		onStoreResult: callbacks.onStoreResult,
		onExportAll: callbacks.onExportAll,
		onShowAllResults: callbacks.onShowAllResults,
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
