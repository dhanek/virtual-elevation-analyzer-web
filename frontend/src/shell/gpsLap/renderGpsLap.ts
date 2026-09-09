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
import {
	displayCdaBounds,
	displayCrrBounds,
} from "../../analysis/sliderBounds";
import {
	resolveDisplayCda,
	resolveDisplayCrr,
} from "../../analysis/unsetParameterFallbacks";
import type { AppState } from "../../state/AppState";
import type { ParameterStorage } from "../../utils/ParameterStorage";
import type { ResultsStorage } from "../../utils/ResultsStorage";
import type { AnalysisParameters } from "../../components/AnalysisParameters";
import type { ShellServices } from "../analysis/types";
import type { LapVEProfile } from "./types";

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
import { resetTabRenderMapForNewPanel, setupTabSwitching } from "../dom/tabs";
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
	renderGpsLapWindPlot,
	renderGpsLapPowerPlot,
	renderGpsLapVdPlot,
} from "./gpsLapPlots";
import { createGpsLapUpdateCallbacks } from "./updateGpsLap";
import { resolveActiveGpsLapRanges } from "./activeGpsLapRanges";
import { requestModeUpdate } from "../analysis/requestModeUpdate";
import { applyVeStatus } from "../../state/veStatus";
import { saveGpsLapScreenshot } from "./gpsLapScreenshot";
import { bindLapViewToggle, lapViewToggleMarkup } from "../ve/lapViewToggle";
import { virtualDistanceHeaderMarkup } from "../ve/vdHeader";
import { airSpeedOffsetControlMarkup } from "../ve/airSpeedOffsetControl";
import { airSpeedCalibrationControlMarkup } from "../ve/airSpeedCalibrationControl";
import { fitWindVisibilityAttrs } from "../ve/windSourceVisibility";
import { crrTempControlsMarkup } from "../ve/crrTempControls";
import { windHeightControlsMarkup } from "../ve/windHeightControls";
import { resolveGpsLapNumber } from "../../modes/analysis/activeGpsLapRanges";

/**
 * Select the GPS-detected laps and put the stacked panel on screen.
 *
 * THIS LEG NO LONGER RUNS THE PHYSICS. It used to build one calculator per lap
 * and integrate a virtual elevation for each, so the panel could paint a first
 * result; the post-bind `requestModeUpdate("parameters")` in `showGpsLapVEPlot`
 * then recomputed the SAME segments through `updateModeVEPlots`, which is the
 * only writer of `currentVEResult` and its siblings. One Analyze therefore cost
 * `1 + 2N` calculator runs where `2N` would do, and — the structural half —
 * every analyze-derived value had two producers that WR-03 showed do not agree.
 *
 * So this function selects laps, builds the per-lap supplementary series the
 * Wind/Power/VD tabs draw, and renders panel STRUCTURE. Every physics-derived
 * quantity — virtual elevation, R², RMSE, closing error, the stored result —
 * arrives from the recompute a macrotask later, and `appState.veStatus` is what
 * says whether it has landed yet (Store Result is disabled until it has).
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
	services.showLoading("Preparing lap analysis...");

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
	const allDistance = normalizedArrays.distance;

	// NO ELEVATION AND NO AIR DENSITY ARE RESOLVED HERE ANY MORE.
	//
	// Both were resolved for the deleted per-lap calculators, and both existed
	// only because this leg was a SECOND producer that had to be talked into
	// agreeing with the first:
	//
	//   - WR-1: this leg read `normalizedArrays.altitude` straight through, so
	//     with a DEM applied the smoothing toggle rendered ON while the first
	//     paint was computed from the raw FIT channel, and the numbers moved on
	//     the first control nudge. Fixed by calling `resolveElevationProfile`
	//     here too.
	//   - WR-4 follow-up: this leg passed NO `rhoArray`, so on a ride carrying
	//     usable air density the two passes integrated different physics --
	//     mean RMSE 7.809 m at the analyze paint against 7.555 m one macrotask
	//     later, and the analyze number was the wrong one. Fixed by calling
	//     `resolveRhoArray` here too.
	//
	// `updateModeVEPlots` resolves both once per update, full length
	// (`updateModeVEPlots.ts:168,177`), and is now the only pass that does. With
	// one producer there is nothing left here to agree with.

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

	// Describe each lap. NO PHYSICS: what this loop builds is the per-lap
	// supplementary series the Wind/Power/VD tabs draw, plus the duration and
	// distance the summary table shows. `virtualElevation` is deliberately left
	// empty — the recompute is the only pass that integrates one.
	for (let lapIdx = 0; lapIdx < lapIndexRanges.length; lapIdx++) {
		const range = lapIndexRanges[lapIdx];
		const lapNumber = analyzedLapNumbers[lapIdx] ?? lapIdx + 1;

		// Extract data for this lap
		const lapTimestamps: number[] = [];
		const lapPower: number[] = [];
		const lapVelocity: number[] = [];
		const lapPositionLat: number[] = [];
		const lapPositionLong: number[] = [];
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
			lapDistance.push(allDistance[i]);
			lapWindSpeed.push(allWindSpeed[i]);
		}

		// KEPT, even though nothing here can throw on a short lap any more: the
		// laps this leg keeps are the laps whose series the tabs draw, and a
		// two-sample lap draws nothing useful. `updateModeVEPlots.ts:217` applies
		// the identical `MIN_SEGMENT_SAMPLES` rule to the segments it computes, so
		// on THIS rule the two passes agree without either filtering on the
		// other's behalf.
		//
		// THEY DO NOT AGREE ON EVERY RULE, and the header says so first. `Laps: N`
		// is rendered once, into `#gpsLapCountValue` from `lapProfiles.length`, and
		// no updater rewrites it. That N is the count of laps this leg SELECTED.
		// The producer applies one further rule this leg cannot: a lap whose fit
		// throws is dropped by the `catch` in its segment loop
		// (`updateModeVEPlots.ts`) and is on no plot, while it is
		// still counted here. Detecting that from this side would mean running the
		// calculator, which is exactly the pass this leg no longer has — only the
		// producer knows which laps survived. So in that rare case the header
		// over-counts the plotted laps by the number that threw. Accepted.
		//
		// The same asymmetry retires the "No valid laps to analyze" message for
		// throwing laps: the check below sees the laps this leg selected, so a ride
		// where every lap's fit throws puts the panel up and the producer then
		// leaves it empty at status `"error"`.
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

		lapVEProfiles.push({
			lapNumber,
			distances: relativeDistances,
			// EMPTY, NOT ZEROED AND NOT FAKED. There is no first paint of a
			// virtual elevation any more, and an array of the right length full
			// of zeros would render as a flat line the user could mistake for a
			// result. The recompute fills these in through `createGpsLapUpdateCallbacks`.
			virtualElevation: [],
			actualElevation: [],
			// Compare (D-07/D-20) is resolved by the primitive, which is now the
			// only pass that resolves anything.
			virtualElevationCompare: null,
			supplementarySeries,
			duration,
			totalDistance,
		});

		log.debug(
			`Lap ${lapNumber}: ${totalDistance.toFixed(2)} km, ${duration.toFixed(0)}s, ${relativeDistances.length} points`,
		);
	}

	services.hideLoading();

	if (lapVEProfiles.length === 0) {
		services.showError("No valid laps to analyze");
		return;
	}

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
		resolvedParams,
		hasAirSpeed || hasWindSpeed,
		hasConstantWind,
		defaultAirSpeedOffset,
		preservedWindSource,
	);
}

/**
 * Show the GPS lap VE stacked panel with full controls (matching normal mode).
 *
 * STRUCTURE ONLY. The profiles handed in carry no virtual elevation, so nothing
 * here scores or draws a VE figure; the post-bind kick at the foot of this
 * function is what computes and paints one.
 */
export async function showGpsLapVEPlot(
	services: ShellServices,
	parameterStorage: ParameterStorage,
	resultsStorage: ResultsStorage,
	waitForPlotly: () => Promise<any>,
	lapProfiles: LapVEProfile[],
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
	// currentVirtualDistances from an analyze-time fit, so Store Result had
	// something to read before the first recompute. WR-03 established that what
	// it wrote was NOT what the recompute reproduces, so it was a second answer
	// rather than a preview. `updateModeVEPlots` is now the only producer and
	// `veStatus` covers the window.

	const showWindTab = hasWindSpeed || hasConstantWind;
	// PRESENCE, not visibility. The VD tab used to be gated on the selected
	// source, so it was absent from the DOM under constant and only came back
	// because a source change rebuilt the whole sidebar. Removing that rebuild
	// is the point of the migration, so the tab is now rendered whenever a FIT
	// air-speed channel exists and HIDDEN under constant by
	// syncFitWindControlsVisibility. Nothing new becomes visible: under
	// constant the user saw no VD tab before and sees none now.
	const showVirtualDistanceTab = hasWindSpeed;
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

	const currentAirSpeedCalibrationValue = formatAirSpeedCalibrationPercent(
		appState.airSpeedCalibrationPercent,
	);

	// Build HTML template (values are numeric / from AnalysisParameters only; no user input).
	const veAnalysisTemplate = buildGpsLapVeAnalysisTemplate({
		params,
		hasWindSpeed,
		hasConstantWind,
		showWindTab,
		showVirtualDistanceTab,
		selectedWindSource,
		currentAirSpeedCalibrationValue,
		lapCount: lapProfiles.length,
		defaultAirSpeedOffset,
		elevationToggleMarkup: elevationSmoothingToggleMarkup(appState),
	});
	// WR-01. The outgoing panel's tab callbacks close over ITS profiles and draw
	// into element ids this new markup reuses, so they must not outlive it.
	// Without this, any first pass that does not reach `renderVe` leaves
	// Wind/Power/VD rendering the PREVIOUS selection into this panel.
	resetTabRenderMapForNewPanel();
	veAnalysisContent.innerHTML = veAnalysisTemplate;

	// THE BUTTON THE MARKUP ABOVE JUST CREATED IS ENABLED. DISABLE IT.
	//
	// `veAnalysisTemplate` ships `#storeResult` with no `disabled` attribute, so
	// the innerHTML assignment on the line above has just put a live, clickable
	// Store Result into the document — pointing at `currentVEResult` and its
	// three siblings, which until the first update pass lands still hold the
	// PREVIOUS analysis. `applyVeStatus` is the one writer that both sets the
	// status and reflects it onto whatever button is in the document, which is
	// why this runs AFTER the assignment and not before: before it, there is no
	// button here to disable.
	//
	// This does NOT open the window — `handleAnalyze` already invalidated the
	// status on entry, and has to, because everything between there and here
	// (storage I/O, the lap loop, `waitForPlotly`) runs with the previous panel
	// still mounted and its own `#storeResult` still enabled — including the
	// `lapVEProfiles.length === 0` return, which never reaches this function.
	// That line closes the window for the whole approach; this one re-closes the
	// DOM half of it for markup that did not exist when it ran.
	//
	// `updateModeVEPlots` sets `computing` again on entry and `ready` after
	// `summarize`. Also not a duplicate: the primitive covers ITS pass, which
	// runs once per control gesture, long after this panel was built.
	applyVeStatus(appState, "computing");

	// Bind the stitched/stacked toggle when this overlay was reached from an
	// ordinary 2+ lap selection (no-op otherwise).
	bindLapViewToggle();

	// Setup slider event handlers for CdA/Crr with recalculation
	setupGpsLapSliderHandlers(appState, parameterStorage, waitForPlotly, params);

	// Every VE control is bound by `setupGpsLapSliderHandlers` above, from
	// MODE_CONTROL_TABLE. What used to sit here -- the elevation-smoothing
	// toggle, the wind-source radios, the calibration slider, its number input
	// and Auto Adjust -- was six more hand-written listeners in a second file,
	// each independently responsible for remembering to recompute.
	//
	// The wind-source radios in particular no longer call `recalculateGpsLapVE`.
	// That rebuilt the entire sidebar behind a "Recalculating VE..." spinner and
	// redrew every plot, which is why the source change was the one interaction
	// in this mode that did not go through the funnel. It is now one scheduled
	// recompute like every other control, and the panel persists across it --
	// which is what the active-tab guard in windSourceVisibility.ts exists for.

	setupTabSwitching({
		wind: () => renderGpsLapWindPlot(lapProfiles),
		power: () => renderGpsLapPowerPlot(lapProfiles),
		vd: () => renderGpsLapVdPlot(lapProfiles),
	});

	// Setup action footer buttons
	bindActionFooter({
		onSaveScreenshot: () => {
			void saveGpsLapScreenshot(waitForPlotly);
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

	// NO VE PAINT HERE ANY MORE.
	//
	// `renderGpsLapVEPlots` took a REQUIRED `GpsLapHeaderStats` (D1), and the
	// only way to produce one is to score a virtual elevation this leg no longer
	// computes. So the VE and residual figures, the three stat spans and the lap
	// summary table are all painted by the kick below, through the same
	// `renderVe` callback every later control gesture uses. The spans ship with
	// the empty content the template gives them, which is what the panel already
	// showed before a value existed.

	// THE POST-BIND KICK (WR-4). Standard has had this since before the phase
	// -- `renderStandardVe.ts:562` -- which is the whole reason Standard never
	// carried this bug.
	//
	// It is now the ONLY producer, not a corrective second pass. The analyze
	// leg above kept `virtual_elevation` from a per-lap fit and discarded r2,
	// RMSE and the elevation gains, so without this line the only writer of
	// `appState.currentVEResult` on an analyze was the stitched fit
	// `prepareAnalysisPayload` runs over the concatenated selection, which this
	// panel never displays -- and the first control nudge replaced it.
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

	log.debug(`GPS Lap VE plot rendered with ${lapProfiles.length} laps`);
}

/**
 * Wire every GPS-lap VE control, from the one table, through the one funnel.
 *
 * This function used to hand-write four listeners for CdA and Crr and delegate
 * two more blocks, while the RENDER function next door hand-wrote another six
 * for elevation smoothing, the wind-source radios, the calibration slider, its
 * number input and Auto Adjust. Twelve bindings across two files, each of them
 * independently responsible for remembering to ask for a recompute — which is
 * the 2026-04-19 omission class with twelve places to reoccur. There is now
 * exactly ONE place per mode where a VE control is wired, and it is not this
 * file: it is `MODE_CONTROL_TABLE`.
 *
 * `bindActionFooter` stays in the render function: it saves, stores and exports
 * and never recomputes, so it is deliberately not in the table.
 *
 * RETURNS what `bindModeControls` bound, so "every row GPS-lap claims is bound in
 * GPS-lap" is a checkable property of the real wiring rather than an inference
 * from the table. `modeControlBindingCoverage.test.ts` drives exactly this
 * function over the real sidebar markup and asserts the bound set.
 */
export function setupGpsLapSliderHandlers(
	appState: AppState,
	parameterStorage: ParameterStorage,
	_waitForPlotly: () => Promise<any>,
	_params: AnalysisParameters,
): BindModeControlsResult {
	// The renderer half of the mode seam, registered from the render that owns
	// the activity arrays it closes over. Mirrors what Standard does in
	// `setupVESliders`, and must happen before the first `requestModeUpdate`.
	registerModeUpdateCallbacks("gpsLap", () =>
		createGpsLapUpdateCallbacks(appState),
	);

	/** The lap windows every per-segment readout is measured over. */
	const ranges = () => resolveActiveGpsLapRanges(appState);

	return bindModeControls({
		appState,
		modeId: "gpsLap",
		saveSettings: () => {
			void saveCurrentMultiSegmentSettings(appState, parameterStorage);
		},
		// N-3: one sync-error window per lap, where Standard supplies its single
		// trim window. The binder displays the NaN-skipping mean over them, so
		// Standard's displayed number is unchanged and the GPS modes gain one.
		getOffsetMetricWindows: () =>
			ranges().map((range: { startIdx: number; endIdx: number }) => ({
				start: range.startIdx,
				end: range.endIdx,
			})),
		getSyncErrorSeries: () => syncErrorSeries(appState),
		// Every mode keeps its own segment source for the auto calibration: the
		// difference between the three is DATA, not control flow, so it is an
		// option here rather than a mode `if` inside the binder (D-02).
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

/**
 * The ground- and air-speed series the offset metric is measured between.
 *
 * Resolved on demand rather than captured at render time, so the number follows
 * the CURRENTLY selected wind source. Both lookups are cached
 * (`getNormalizedActivityArrays`), so this is a map read per interaction.
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
	showVirtualDistanceTab: boolean;
	selectedWindSource: string;
	currentAirSpeedCalibrationValue: string;
	/**
	 * NO `initialStats`. This used to carry the three header numbers the analyze
	 * leg's own fit produced, so the template could paint them before the first
	 * recompute. There is no analyze-time fit any more, and the spans therefore
	 * ship EMPTY — exactly what the panel showed before a value existed — until
	 * `renderGpsLapVEPlots` fills them from the aggregate the one producer
	 * computed. `lapCount` stays: it is a property of the selection, not of the
	 * physics.
	 */
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
		showVirtualDistanceTab,
		selectedWindSource,
		currentAirSpeedCalibrationValue,
		lapCount,
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
                            ${lapViewToggleMarkup("stacked")}
                            <div class="ve-metrics-compact">
                                <!-- EMPTY until the one producer fills them:
                                     renderGpsLapVEPlots writes all three from
                                     the aggregate updateModeVEPlots computed,
                                     and the analyze leg no longer has a number
                                     of its own to disagree with it. -->
                                Mean R²:<span id="gpsLapR2Value"></span> |
                                Mean RMSE:<span id="gpsLapRmseValue"></span> |
                                Closing Error:<span id="gpsLapClosingErrorValue"></span> |
                                Laps:<span id="gpsLapCountValue">${lapCount}</span>
                                <!-- Filled in only under "Compare both methods",
                                     so the three spans above are read as a pair
                                     of numbers rather than one (07-04 ruling 2). -->
                                <span id="gpsLapCompareMarker"></span>
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
                            <div class="ve-plot-container"><div id="gpsLapWindPlot" class="ve-plot-container__plot ve-plot-container__plot--tall"></div></div>
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
                            <div class="ve-plot-container"><div id="gpsLapPowerPlot" class="ve-plot-container__plot ve-plot-container__plot--tall"></div></div>
                        </div>

                        ${
													showVirtualDistanceTab
														? `
                        <div class="ve-tab-content" id="vd-tab"${fitWindVisibilityAttrs(selectedWindSource)}>
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
                            <div class="ve-plot-container"><div id="gpsLapVdPlot" class="ve-plot-container__plot ve-plot-container__plot--tall"></div></div>
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
