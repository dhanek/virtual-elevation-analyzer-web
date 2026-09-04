import { displayCdaBounds, displayCrrBounds } from "../../analysis/sliderBounds";
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
	buildWindSpeedFigure,
	buildSpeedPowerFigure,
	buildVirtualDistanceFigure,
} from "../../plots/StandardPlotBuilders";
import { setupVESliders } from "./bindStandardSliders";
import { crrTempControlsMarkup } from "./crrTempControls";
import { windHeightControlsMarkup } from "./windHeightControls";
import { airSpeedOffsetControlMarkup } from "./airSpeedOffsetControl";
import { airSpeedCalibrationControlMarkup } from "./airSpeedCalibrationControl";
import { fitWindVisibilityAttrs } from "./windSourceVisibility";
import { ParameterStorage } from "../../utils/ParameterStorage";
import { ShellServices } from "../analysis/types";
import { resolveSelectionWindSeries } from "./standardSegments";
import { applyVeStatus } from "../../state/veStatus";
import {
	selectedLapCount,
	updateCombinedVirtualDistanceHeader,
	virtualDistanceHeaderMarkup,
} from "./vdHeader";
import {
	resolveDisplayCda,
	resolveDisplayCrr,
} from "../../analysis/unsetParameterFallbacks";
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

	// NO VIRTUAL ELEVATION IS COMPUTED HERE ANY MORE — the third and last
	// analyze leg to stop.
	//
	// This function used to build its own calculator over the CONCATENATED
	// selection and integrate it once, then draw `#vePlot` / `#veResidualsPlot`
	// from that single fit and write `#r2Value` / `#rmseValue` / `#veGainValue` /
	// `#actualGainValue` from its scalars. `updateModeVEPlots` then ran a
	// macrotask later, fitted each selected lap SEPARATELY, and repainted the
	// same five targets from the MEAN of those per-lap fits (D-19 Option B, see
	// `bindStandardSliders.ts`'s `aggregate`). For a multi-lap selection those
	// are different quantities, so the header visibly jumped: one number replaced
	// by another with no user action in between. Deleting the fit is what retires
	// that — with no first quantity there is nothing left to disagree.
	//
	// Everything the fit needed went with it: `createVeCalculator`, the trimmed
	// `calculate_virtual_elevation` call, the elevation figure pair, the
	// per-selection `resolveSelectionRhoArray` slice (the primitive resolves rho
	// per segment and range-checks it, so this copy had nothing left to agree
	// with), `resolvePlaceholderWindSpeed`, and the `resolveDisplayCda` /
	// `resolveAppliedCrr` pair that supplied the calculator's CdA and Crr. The
	// SLIDER markup below still resolves its own display values through
	// `resolveDisplayCda` / `resolveDisplayCrr`; the computed half is now the
	// producer's, which is exactly the single-source-of-truth
	// `unsetParameterFallbacks.ts` documents.
	//
	// The three secondary figures below stay. None of them integrates anything —
	// wind, speed/power and virtual distance are properties of the recorded ride
	// — so drawing them here costs no physics and keeps the Wind / Power / VD
	// tabs populated from the first frame.

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

	// `react`, not `newPlot` (bundle D). Every one of these ids is redrawn on
	// every slider update -- `bindStandardSliders` reaches all of them through
	// `react` -- so `newPlot` here only bought a teardown and rebuild on the
	// FIRST draw, and left the pattern for the next plot to be copied from.
	// `react` on a div Plotly has never touched initialises it exactly as
	// `newPlot` would, so there is no first-draw special case.
	//
	// `#vePlot` and `#veResidualsPlot` are NOT among them any more: they need a
	// virtual elevation, this pass computes none, and the post-bind kick opens
	// both with `react` a macrotask later. Until it lands the two divs are empty
	// rather than carrying a fit nothing else agrees with.
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

	// THE R²/RMSE/VE/Actual SPANS ARE LEFT EMPTY, and that is the [S-M] header
	// jump being retired rather than an omission.
	//
	// Their history is three writers deep. The template first interpolated
	// `prepareAnalysisPayload`'s `initialResult` -- the concatenated selection,
	// untrimmed, wind forced to `"fit"` with the offset off -- while the plot
	// directly beneath came from this function's own trimmed fit on the selected
	// source. Two fits of one ride, stacked. That was closed by having this
	// function fill the spans from the fit it had just drawn, which made the
	// header and the curve agree with each other but not with what came next:
	// `updateModeVEPlots` fits each lap separately and `renderMetrics` writes the
	// MEAN of those fits into the same four spans. One fit over N laps and the
	// mean of N fits are different numbers, so on a multi-lap selection the
	// header changed by itself a macrotask after the panel appeared.
	//
	// Empty is the honest first frame. The spans ship empty in the markup below
	// and stay empty until the producer has something to put in them, which is
	// also when `#storeResult` becomes clickable -- the two say the same thing to
	// the user. `updateMetricsDisplay` in `bindStandardSliders.ts` is now their
	// only writer.

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

	// Slider TRAVEL is app configuration, not stored data (see sliderBounds.ts).
	// Declared BELOW the savedParams load because that block writes
	// `currentParameters.crr`, and the bounds must be widened by the same value
	// the markup below renders — not by the pre-load one.
	const crrBounds = displayCrrBounds(
		resolveDisplayCrr(appState.currentParameters.crr),
	);
	const cdaBounds = displayCdaBounds(
		resolveDisplayCda(appState.currentParameters.cda),
	);

	appState.currentAnalyzedLaps = analyzedLaps;
	// Coverage is unknown until the first `summarize` (WR-01); the previous
	// analysis's must not ride along into this one.
	appState.currentCoveredItems = null;
	// NO SEED OF `currentFilteredData` HERE ANY MORE, and this was the last one
	// in the codebase.
	//
	// A seed wrote the analysed sample arrays at ANALYZE time so that Analyze
	// followed straight by Store Result described this ride rather than the
	// previous one. It solved a real problem — the same one CR-01 named — but it
	// solved it by adding a second writer of a field the update pass also writes,
	// and two writers of one answer is what CR-02 was. The guarantee is now
	// carried by the status instead: `veStatus` leaves `"ready"` the moment a new
	// panel goes up (see the `applyVeStatus` call below), `handleStoreResult`
	// refuses anything that is not `"ready"`, and `#storeResult` is rendered
	// disabled to say so. Store Result therefore cannot reach a stale value at
	// all, rather than reaching a freshly-overwritten one.
	//
	// `summarize` is consequently the ONLY writer of `currentFilteredData`, for
	// all three modes. `segmentSummary.ts` is where it lives.
	//
	// The two assignments above stay: `currentAnalyzedLaps` is the settings key
	// (`saveLapSettings` / `loadLapSettings`) and has nothing to do with the
	// seed, and `currentCoveredItems` must be cleared so the previous analysis's
	// coverage does not ride along into this one (WR-01).
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
                                    <input type="range" id="cdaSlider" min="${cdaBounds.min}" max="${cdaBounds.max}" value="${resolveDisplayCda(appState.currentParameters!.cda)}" step="0.001" class="ve-slider">
                                    <input type="number" id="cdaValue" value="${resolveDisplayCda(appState.currentParameters!.cda).toFixed(3)}" min="${cdaBounds.min}" max="${cdaBounds.max}" step="0.001" class="ve-value-input">
                                </div>
                                <div class="ve-control-group">
                                    <label>Crr (Rolling Resistance):</label>
                                    <input type="range" id="crrSlider" min="${crrBounds.min}" max="${crrBounds.max}" value="${resolveDisplayCrr(appState.currentParameters!.crr)}" step="0.0001" class="ve-slider">
                                    <input type="number" id="crrValue" value="${resolveDisplayCrr(appState.currentParameters!.crr).toFixed(4)}" min="${crrBounds.min}" max="${crrBounds.max}" step="0.0001" class="ve-value-input">
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

	// THE BUTTON THE MARKUP ABOVE JUST CREATED IS ENABLED. DISABLE IT.
	//
	// The template ships `#storeResult` with no `disabled` attribute, so the
	// innerHTML assignment above has just put a live, clickable Store Result into
	// the document — pointing at `currentVEResult` and its three siblings, which
	// until the first update pass lands still hold the PREVIOUS analysis.
	// `applyVeStatus` is the one writer that both sets the status and reflects it
	// onto whatever button is in the document, which is why this runs AFTER the
	// assignment and not before: before it, there is no button here to disable.
	//
	// This does NOT open the window — `handleAnalyze` already invalidated the
	// status on entry, and has to, because everything between there and here
	// (storage I/O, `resolveMultiSegmentAnalysisParams`, `waitForPlotly`) runs
	// with the previous panel still mounted and its own `#storeResult` still
	// enabled. That line closes the window for the whole approach; this one
	// re-closes the DOM half of it for markup that did not exist when it ran.
	//
	// `updateModeVEPlots` sets `computing` again on entry and `ready` after
	// `summarize`. Also not a duplicate: the primitive covers ITS pass, which
	// runs once per control gesture, long after this panel was built.
	//
	// Mirrors `renderGpsLap.ts` and `renderOutAndBack.ts`, which need the
	// identical line for the identical reason.
	applyVeStatus(appState, "computing");

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
