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
import { displayCdaBounds, displayCrrBounds } from "../../analysis/sliderBounds";
import {
	resolveDisplayCda,
	resolveDisplayCrr,
} from "../../analysis/unsetParameterFallbacks";
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
import { buildSegmentSupplementarySeries } from "../../analysis/SegmentSupplementarySeries";
import { extractSegmentData } from "../../analysis/SegmentExtractor";
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
import { getSelectedWindSource } from "../dom/windSource";
import { bindActionFooter } from "../dom/actionFooter";
import {
	handleStoreResult,
	handleExportAllResults,
	handleShowAllResults,
} from "../analysis/storageHandlers";
import { log } from "../../utils/log";
import { elevationSmoothingToggleMarkup } from "../analysis/elevationProfileCycle";
import {
	renderOutAndBackWindPlot,
	renderOutAndBackPowerPlot,
	renderOutAndBackVdPlot,
} from "./outAndBackPlots";
import { createOutAndBackUpdateCallbacks } from "./updateOutAndBack";
import { saveOutAndBackScreenshot } from "./outAndBackScreenshot";
import { crrTempControlsMarkup } from "../ve/crrTempControls";
import { virtualDistanceHeaderMarkup } from "../ve/vdHeader";
import { airSpeedOffsetControlMarkup } from "../ve/airSpeedOffsetControl";
import { airSpeedCalibrationControlMarkup } from "../ve/airSpeedCalibrationControl";
import { fitWindVisibilityAttrs } from "../ve/windSourceVisibility";
import { windHeightControlsMarkup } from "../ve/windHeightControls";
import { requestModeUpdate } from "../analysis/requestModeUpdate";
import { applyVeStatus } from "../../state/veStatus";

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
	// STRUCTURE, NOT PHYSICS. This leg no longer integrates anything, so the old
	// "Calculating VE for out-and-back sections..." would have described work it
	// does not do.
	services.showLoading("Preparing out-and-back analysis...");

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

	/**
	 * Describe ONE leg. NO PHYSICS.
	 *
	 * What this builds is the supplementary series the Wind/Power/VD tabs draw
	 * plus the leg's full-activity range; `virtual_elevation` is the recompute's
	 * to produce and nothing here integrates one. `null` means the leg is too
	 * short to be worth drawing.
	 *
	 * It slices by hand rather than through `extractSegmentData` because the one
	 * series that helper adds over these seven is ALTITUDE, and altitude was
	 * only ever here to feed the calculator and the `actualElevation` copy that
	 * went with it. Resolving an elevation profile and slicing it for nobody
	 * would be work with no reader.
	 */
	const describeLeg = (
		startIdx: number,
		endIdx: number,
	): {
		range: { startIdx: number; endIdx: number };
		series: ReturnType<typeof buildSegmentSupplementarySeries>;
	} | null => {
		const timestamps: number[] = [];
		const power: number[] = [];
		const velocity: number[] = [];
		const positionLat: number[] = [];
		const positionLong: number[] = [];
		const distance: number[] = [];
		const windSpeed: number[] = [];

		for (let i = startIdx; i <= endIdx && i < allTimestamps.length; i++) {
			timestamps.push(allTimestamps[i]);
			power.push(allPower[i]);
			velocity.push(allVelocity[i]);
			positionLat.push(allPositionLat[i]);
			positionLong.push(allPositionLong[i]);
			distance.push(allDistance[i]);
			windSpeed.push(allWindSpeed[i]);
		}

		// KEPT, even though nothing here can throw on a short leg any more: the
		// legs this loop keeps are the legs whose series the tabs draw, and a
		// two-sample leg draws nothing useful. `updateModeVEPlots.ts` applies the
		// identical `MIN_SEGMENT_SAMPLES` rule to the segments it computes, so on
		// THIS rule the two passes agree without either filtering on the other's
		// behalf.
		if (timestamps.length < 10) {
			return null;
		}

		return {
			range: { startIdx, endIdx },
			series: buildSegmentSupplementarySeries({
				timestamps,
				power,
				velocity,
				positionLat,
				positionLong,
				distance,
				windSpeed,
				params: resolvedParams,
				selectedWindSource: outAndBackWindResolution.selectedWindSource,
			}),
		};
	};

	// Describe each section's two legs. THE TWO PASSES DO NOT AGREE ON EVERY
	// RULE, and this is where out-and-back's version of that asymmetry lives.
	//
	// A section survives here when at least one of its legs cleared the sample
	// floor. The producer applies one further rule this loop cannot: a leg whose
	// fit THROWS is dropped by the `catch` in `updateModeVEPlots`' segment loop
	// and appears on no plot, while it is still counted here. Detecting that from
	// this side would mean running the calculator, which is exactly the pass this
	// leg no longer has — only the producer knows which legs survived.
	//
	// Consequences, stated rather than smoothed over:
	//
	//   - `Sections: N` is rendered once from `profiles.length`, so between the
	//     panel going up and the first recompute landing it can over-count. It
	//     SELF-CORRECTS WHEN AT LEAST ONE LEG SURVIVES:
	//     `createOutAndBackUpdateCallbacks`' `renderMetrics` rewrites
	//     `#oabSectionCountValue` from `aggregate.segmentCount`, which is the
	//     producer's surviving-section count. GPS-lap has no such rewriter,
	//     which is why its equivalent divergence is permanent and this one is a
	//     first-frame artefact.
	//   - EXCEPT when every leg's fit throws: `updateModeVEPlots` hits
	//     `profiles.length === 0`, calls `applyVeStatus(appState, "error")` and
	//     returns before `renderMetrics` ever runs (`updateModeVEPlots.ts:360-363`
	//     vs. `:380`). On that ride the over-counted `Sections: N` from this loop
	//     is never corrected and sits next to the empty panel at status `"error"`.
	//   - "No valid out-and-back sections to analyze" no longer fires for legs
	//     whose fit throws: the check below sees the legs this loop selected, so
	//     a ride where every fit throws puts the panel up and the producer then
	//     leaves it empty at status `"error"` by the path above, rather than
	//     this leg's own showError.
	for (const section of sections) {
		const outbound = describeLeg(
			section.outboundStartIdx,
			section.outboundEndIdx,
		);
		const inbound = describeLeg(section.inboundStartIdx, section.inboundEndIdx);

		if (!outbound && !inbound) {
			log.warn(
				`Section ${section.sectionNumber} has no leg with enough data points, skipping`,
			);
			continue;
		}

		profiles.push({
			sectionNumber: section.sectionNumber,
			outboundRange: outbound?.range ?? null,
			outboundDistances: outbound?.series.distancesKm ?? [],
			// EMPTY, NOT ZEROED AND NOT FAKED. There is no first paint of a
			// virtual elevation any more, and an array of the right length full of
			// zeros would render as a flat line the user could mistake for a
			// result. `createOutAndBackUpdateCallbacks` fills these in.
			outboundVE: [],
			// Compare (D-07/D-20) is resolved by the primitive, which is now the
			// only pass that resolves anything.
			outboundVECompare: null,
			outboundActualElevation: [],
			outboundSeries: outbound?.series ?? null,
			inboundRange: inbound?.range ?? null,
			inboundDistances: inbound?.series.distancesKm ?? [],
			inboundVE: [],
			inboundVECompare: null,
			inboundActualElevation: [],
			inboundSeries: inbound?.series ?? null,
			outboundDuration: section.outboundDuration,
			inboundDuration: section.inboundDuration,
			totalDistance: section.totalDistance,
		});
	}

	services.hideLoading();

	if (profiles.length === 0) {
		services.showError("No valid out-and-back sections to analyze");
		return;
	}

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

/**
 * NO `initialStats` FIELD HERE. This used to carry the three header numbers the
 * analyze leg's own two fits produced, so the template could paint them before
 * the first recompute. There is no analyze-time fit any more, and the spans
 * therefore ship EMPTY — exactly what the panel showed before a value existed —
 * until `renderMetrics` fills them from the aggregate the one producer
 * computed. `sectionCount` below stays: it is a property of the selection, not
 * of the physics.
 */
export interface OutAndBackVeTemplateOptions {
	params: AnalysisParameters;
	hasWindSpeed: boolean;
	hasConstantWind: boolean;
	showWindTab: boolean;
	showVirtualDistanceTab: boolean;
	selectedWindSource: string;
	currentAirSpeedCalibrationValue: string;
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
		sectionCount,
		defaultAirSpeedOffset,
		elevationToggleMarkup,
	} = opts;
	// Slider TRAVEL is app configuration, not stored data (see sliderBounds.ts).
	const crrBounds = displayCrrBounds(resolveDisplayCrr(params.crr));
	const cdaBounds = displayCdaBounds(resolveDisplayCda(params.cda));

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
                                    <input type="range" id="cdaSlider" min="${cdaBounds.min}" max="${cdaBounds.max}" value="${resolveDisplayCda(params.cda)}" step="0.001" class="ve-slider">
                                    <input type="number" id="cdaValue" value="${resolveDisplayCda(params.cda).toFixed(3)}" min="${cdaBounds.min}" max="${cdaBounds.max}" step="0.001" class="ve-value-input">
                                </div>
                                <div class="ve-control-group">
                                    <label>Crr (Rolling Resistance):</label>
                                    <input type="range" id="crrSlider" min="${crrBounds.min}" max="${crrBounds.max}" value="${resolveDisplayCrr(params.crr)}" step="0.0001" class="ve-slider">
                                    <input type="number" id="crrValue" value="${resolveDisplayCrr(params.crr).toFixed(4)}" min="${crrBounds.min}" max="${crrBounds.max}" step="0.0001" class="ve-value-input">
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
                        </div>

                        <div class="ve-tab-content ve-tab-content--active" id="ve-tab">
                            <div class="ve-metrics-compact">
                                <!-- EMPTY until the one producer fills them:
                                     renderMetrics writes all three from the
                                     aggregate updateModeVEPlots computed, and
                                     the analyze leg no longer has a number of
                                     its own to disagree with it. -->
                                RMSE:<span id="oabRmseValue"></span> |
                                VE Gain:<span id="oabVeGainValue"></span> |
                                Actual:<span id="oabActualGainValue"></span> |
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
                    </div>
                </div>
            </div>
        </div>
    `;
}

/**
 * Show the out-and-back VE panel with full controls.
 *
 * STRUCTURE ONLY. The profiles handed in carry no virtual elevation, so nothing
 * here scores or draws a VE figure; the post-bind kick at the foot of this
 * function is what computes and paints one.
 */
export async function showOutAndBackVEPlot(
	services: ShellServices,
	parameterStorage: ParameterStorage,
	resultsStorage: ResultsStorage,
	waitForPlotly: () => Promise<any>,
	profiles: OutAndBackVEProfile[],
	params: AnalysisParameters,
	hasWindSpeed: boolean,
	hasConstantWind: boolean,
	defaultAirSpeedOffset: number,
	preservedWindSource: string | null = null,
) {
	const { appState } = services;

	// The wind source the panel below renders from, and the one the recompute
	// will read back off the radios.
	const selectedWindSource =
		preservedWindSource || (hasWindSpeed ? "fit" : "constant");

	// NO SEED HERE ANY MORE.
	//
	// This used to write currentFilteredData, currentWindSource and
	// currentVirtualDistances from the analyze-time fits, so Store Result had
	// something to read before the first recompute. WR-03 established that what
	// it wrote was NOT what the recompute reproduces, so it was a second answer
	// rather than a preview. `updateModeVEPlots` is now the only producer and
	// `veStatus` covers the window.
	//
	// The seam it called had out-and-back as its last caller and is deleted with
	// it. `sectionVirtualDistances` — the one-entry-per-SECTION stacking that
	// call passed in, rather than the one-per-leg default — is unaffected:
	// `outAndBackMode.summarize` has always been its other caller, and that is
	// now its only one.

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
		sectionCount: profiles.length,
		defaultAirSpeedOffset,
		elevationToggleMarkup: elevationSmoothingToggleMarkup(appState),
	});

	// THE BUTTON THE MARKUP ABOVE JUST CREATED IS ENABLED. DISABLE IT.
	//
	// The template ships `#storeResult` with no `disabled` attribute, so the
	// innerHTML assignment on the line above has just put a live, clickable Store
	// Result into the document — pointing at `currentVEResult` and its three
	// siblings, which until the first update pass lands still hold the PREVIOUS
	// analysis. `applyVeStatus` is the one writer that both sets the status and
	// reflects it onto whatever button is in the document, which is why this runs
	// AFTER the assignment and not before: before it, there is no button here to
	// disable.
	//
	// This does NOT open the window — `handleAnalyze` already invalidated the
	// status on entry, and has to, because everything between there and here
	// (storage I/O, the section loop, `waitForPlotly`) runs with the previous
	// panel still mounted and its own `#storeResult` still enabled — including
	// the `profiles.length === 0` return, which never reaches this function.
	// That line closes the window for the whole approach; this one re-closes the
	// DOM half of it for markup that did not exist when it ran.
	//
	// `updateModeVEPlots` sets `computing` again on entry and `ready` after
	// `summarize`. Also not a duplicate: the primitive covers ITS pass, which
	// runs once per control gesture, long after this panel was built.
	//
	// Mirrors `renderGpsLap.ts`, which needs the identical line for the identical
	// reason.
	applyVeStatus(appState, "computing");

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
	});

	// NO INITIAL PLOT RENDER. The profiles above carry no virtual elevation, so
	// there is nothing to draw until the post-bind kick below lands and
	// `createOutAndBackUpdateCallbacks.renderVe` paints the producer's numbers.
	// Drawing here would have plotted empty series into `#oabVePlot` and
	// `#oabVeResidualsPlot` a macrotask before the real ones arrived.

	// THE POST-BIND KICK (WR-4). Standard has had this since before the phase
	// -- `renderStandardVe.ts:562` -- which is the whole reason Standard never
	// carried this bug.
	//
	// It is now the ONLY producer, not a corrective second pass. The analyze
	// leg above computes no virtual elevation at all -- it slices each leg's
	// samples and leaves the fit to this kick. So without this line the only
	// writer of `appState.currentVEResult` on an analyze was the stitched fit
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
