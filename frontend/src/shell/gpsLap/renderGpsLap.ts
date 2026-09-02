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
	calculateGpsLapStats,
	calculateMeanElevationProfile,
	calculateMeanReferenceProfile,
	renderGpsLapVEPlots,
	renderGpsLapWindPlot,
	renderGpsLapPowerPlot,
	renderGpsLapVdPlot,
} from "./gpsLapPlots";
import type { GpsLapHeaderStats } from "./gpsLapPlots";
import { createGpsLapUpdateCallbacks } from "./updateGpsLap";
import { resolveActiveGpsLapRanges } from "./activeGpsLapRanges";
import { seedSegmentModeAnalyzeState } from "../../modes/analysis/segmentSummary";
import { requestModeUpdate } from "../analysis/requestModeUpdate";
import { stackedVirtualDistances } from "../../modes/analysis/segmentVirtualDistance";
import { saveGpsLapScreenshot } from "./gpsLapScreenshot";
import { bindLapViewToggle, lapViewToggleMarkup } from "../ve/lapViewToggle";
import { virtualDistanceHeaderMarkup } from "../ve/vdHeader";
import { convergenceTabMarkup } from "../analysis/convergenceTab";
import { airSpeedOffsetControlMarkup } from "../ve/airSpeedOffsetControl";
import { airSpeedCalibrationControlMarkup } from "../ve/airSpeedCalibrationControl";
import { fitWindVisibilityAttrs } from "../ve/windSourceVisibility";
import { resolveAppliedCrr } from "../../analysis/CrrTemperatureCorrection";
import { autoConvergeLockControlsMarkup } from "../ve/autoConvergeLocks";
import { crrTempControlsMarkup } from "../ve/crrTempControls";
import { elevationDiffControlsMarkup } from "../ve/elevationDiffControls";
import { windHeightControlsMarkup } from "../ve/windHeightControls";
import { resolveGpsLapNumber } from "../../modes/analysis/activeGpsLapRanges";
import { requestConvergenceRedraw } from "../analysis/convergenceView";

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
	// per lap below so the first paint already shows both channels.
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
		const lapRho: number[] = [];

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
			// BOUNDED BY THE DENSITY SERIES, not by `allTimestamps`.
			// `hasAirDensityData` is a `.some(...)`, so a channel the device
			// stopped emitting mid-ride is still accepted, and the tail indices
			// here pushed `undefined` into a `number[]` — NaN rho across the
			// WASM boundary for the whole lap. Same rule as
			// `resolveSelectionRhoArray` (`rhoArrayResolver.ts:86`): a short
			// array under the calculator is a worse bug than a constant one, so
			// a lap the series does not span falls back to the constant
			// `params.rho` instead.
			//
			// A LENGTH CHECK, AND ONLY THAT. An interior NaN in an
			// otherwise-full-length channel still reaches the calculator —
			// `hasAirDensityData` accepts the series on a `.some(...)`. That is
			// pre-existing and out of this fix's scope; do not read the guard
			// below as covering it.
			if (allRho && i < allRho.length) lapRho.push(allRho[i]);
		}

		if (lapTimestamps.length < 10) {
			log.warn(
				`Lap ${lapNumber} has too few data points (${lapTimestamps.length}), skipping`,
			);
			continue;
		}

		// After the skip above, so a lap that contributes nothing does not also
		// warn about its rho.
		const lapRhoUsable = !!allRho && lapRho.length === lapTimestamps.length;
		if (allRho && !lapRhoUsable) {
			log.warn(
				`Air density series (${allRho.length}) does not span lap ${lapNumber}; using constant rho`,
			);
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
				rhoArray: lapRhoUsable ? lapRho : null,
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
				range,
				distances: relativeDistances,
				virtualElevation: veArray,
				referenceElevation: allReferenceElevation
					? {
							label: allReferenceElevation.label,
							series: allReferenceElevation.series.slice(
								range.startIdx,
								Math.min(range.endIdx + 1, allTimestamps.length),
							),
						}
					: null,
				// The ANALYZE leg computes one wind source, so the initial paint
				// is always single-source. The first `requestModeUpdate` after
				// this panel binds repaints it through the primitive, which is
				// where compare (D-07/D-20) is resolved.
				virtualElevationCompare: null,
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

	// Preserve the CHECKED wind source across the re-render — null when no
	// radio is checked (first render, or a sensor-less ride), so the
	// `preservedWindSource || (hasWindSpeed ? "fit" : "constant")` default below
	// actually fires. `getSelectedWindSource`'s 'fit' fallback here made that
	// default dead code: a ride with no wind channel opened stuck on 'fit',
	// its lone constant radio unchecked and the wind-height control hidden.
	const preservedWindSource = getCheckedWindSource();

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

	// CR-01. THE PANEL AND THE ANALYSED SAMPLES GO ON SCREEN TOGETHER.
	//
	// Identical to the seed in `showOutAndBackVEPlot`, and for the identical
	// reason: this mode had no analyze-time writer of `currentFilteredData`, so
	// the field was first written by `summarize` when the user touched a
	// control. Analyze -> Store Result with nothing in between therefore either
	// refused, or averaged a previous Standard analysis's samples while
	// persisting this ride's laps.
	//
	// Seeded from the SURVIVING profiles, NOT from `resolveActiveGpsLapRanges`
	// (WR-03). The analyze pass above skips a lap under 10 samples (`:181-186`)
	// and one whose calculator threw (`:255-257`), so the active-range list is a
	// SUPERSET of what is on any plot — seeding from it put samples into
	// `currentFilteredData` that no rendered profile describes. `profile.range`
	// is what this lap was actually computed over.
	//
	// (This comment used to name `resolveActiveGpsLapRanges` and assert that the
	// seed matches what the first recompute reproduces. That claim is what WR-03
	// refuted, and it outlived the code it justified. `gpsModeRealChain.test.ts`
	// and `outAndBackFixtureChain.test.ts` now hold the corrected property.)
	// Computed BEFORE the seed: WR-3 records it, and the panel below renders
	// from the same value, so the two cannot describe different sources.
	const selectedWindSource =
		preservedWindSource || (hasWindSpeed ? "fit" : "constant");

	seedSegmentModeAnalyzeState(appState, {
		ranges: lapProfiles
			.map((profile) => profile.range)
			.filter(
				(range): range is { startIdx: number; endIdx: number } =>
					range !== null,
			),
		// `selectedWindSource` is already the resolved panel source, so it is
		// both arguments: `resolveRecordedWindSource` then preserves "compare"
		// and passes the other two straight through.
		requestedWindSource: selectedWindSource as never,
		resolvedWindSource: selectedWindSource as never,
		// One entry per lap, labelled as `gpsLapMode` labels its segments, so an
		// analyze-time export reads identically to a post-update one.
		// A lap whose series is absent contributes NO entry, rather than a zero
		// -- the same rule `sectionVirtualDistances` applies to a section whose
		// legs both failed. The analyze leg builds a series for every lap it
		// keeps, so in production this filter removes nothing.
		virtualDistances: stackedVirtualDistances(
			lapProfiles
				.filter((profile) => profile.supplementarySeries !== null)
				.map((profile) => ({
					label: `Lap ${profile.lapNumber}`,
					metrics: profile.supplementarySeries!,
				})),
		),
	});
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
		showVirtualDistanceTab,
		selectedWindSource,
		currentAirSpeedCalibrationValue,
		initialStats,
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
		convergence: requestConvergenceRedraw,
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
		onExportSettings: () => {
			void handleExportSettings(appState, parameterStorage);
		},
		onExportBundle: () => {
			void handleExportBundle(appState, parameterStorage);
		},
	});

	// Render the plots using the shared function. `initialStats` is the SAME
	// object the template above painted the header spans from, so the first
	// paint and the plot cannot disagree either (D1).
	// The non-master channel's mean rides on the lap profiles themselves, so
	// it is derived here rather than threaded through the long signature above.
	renderGpsLapVEPlots(
		lapProfiles,
		meanElevation,
		initialStats,
		calculateMeanReferenceProfile(lapProfiles),
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
	 * The same three numbers `renderGpsLapVEPlots` writes into the header spans
	 * on every later update. One named type, so the initial paint and the update
	 * paint cannot fall out of step with each other.
	 */
	initialStats: GpsLapHeaderStats;
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
                                ${autoConvergeLockControlsMarkup()}
                                ${elevationDiffControlsMarkup(params, "gpsLap")}
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
                            ${lapViewToggleMarkup("stacked")}
                            <div class="ve-metrics-compact">
                                Mean R²:<span id="gpsLapR2Value">${initialStats.meanR2.toFixed(4)}</span> |
                                Mean RMSE:<span id="gpsLapRmseValue">${initialStats.meanRMSE.toFixed(2)}m</span> |
                                Closing Error:<span id="gpsLapClosingErrorValue">${initialStats.closingError.toFixed(2)}m</span> |
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
                        ${convergenceTabMarkup()}
                    </div>
                </div>
            </div>
        </div>
    `;
}
