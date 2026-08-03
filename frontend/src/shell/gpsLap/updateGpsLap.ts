/**
 * GPS-lap VE update and recalculation.
 *
 * Verbatim lift from main.ts -- update logic for GPS-lap mode.
 */
import type { AppState, WindSource } from "../../state/AppState";
import type { ParameterStorage } from "../../utils/ParameterStorage";
import type { ResultsStorage } from "../../utils/ResultsStorage";
import type { ShellServices } from "../analysis/types";
import type {
	ModeUpdateCallbacks,
	SegmentVeProfile,
} from "../../modes/analysis/types";
import type { LapVEProfile } from "./types";
import { getNormalizedActivityArrays } from "../../analysis/ActivityArrayCache";
import { getAnalysisModeHandler } from "../../modes/analysis/AnalysisModes";
import { resolveGpsLapNumber } from "../../modes/analysis/activeGpsLapRanges";
import { updateModeVEPlots } from "../analysis/updateModeVEPlots";
import { getGpsAnalysisMode } from "../section3/section3Orchestration";
import {
	renderGpsLapVEPlots,
	renderGpsLapWindPlot,
	renderGpsLapPowerPlot,
	renderGpsLapVdPlot,
	calculateMeanElevationProfile,
	calculateGpsLapStats,
} from "./gpsLapPlots";
import { showGpsLapVEAnalysis } from "./renderGpsLap";
import { resolveActiveGpsLapRanges } from "./activeGpsLapRanges";
import { setupTabSwitching } from "../dom/tabs";
import { log } from "../../utils/log";
import { scheduleRecompute } from "../analysis/recomputeRunner";

export function scheduleGpsLapRecompute(run: () => Promise<void> | void): void {
	scheduleRecompute({
		mode: "gps-lap",
		run,
	});
}

/**
 * Build the GPS-lap `ModeUpdateCallbacks`.
 *
 * This is the ONLY GPS-lap-specific code left in the update path: the shape of
 * a `LapVEProfile`, which stat helpers compute the aggregate, and which four
 * render functions draw it. The spine — wind, elevation, rho, the segment loop,
 * the tab-active check and the result-state writes — is the primitive's.
 *
 * The mapped profiles and the mean elevation are memoised on the identity of
 * the `profiles` array so `aggregate` and the render callbacks share one
 * computation without depending on the order the primitive calls them in.
 */
function createGpsLapUpdateCallbacks(appState: AppState): ModeUpdateCallbacks {
	const normalized = getNormalizedActivityArrays(appState.currentFitData!);

	let memoKey: SegmentVeProfile[] | null = null;
	let memoLaps: LapVEProfile[] = [];
	let memoMean: { distances: number[]; elevation: number[] } = {
		distances: [],
		elevation: [],
	};

	function laps(profiles: SegmentVeProfile[]): LapVEProfile[] {
		if (profiles !== memoKey) {
			memoKey = profiles;
			memoLaps = profiles.map((profile, i) => {
				const first = profile.indices[0];
				const last = profile.indices[profile.indices.length - 1];
				return {
					// The handler labels from the same lookup; relabelling here
					// keeps the summary table and the stored result agreeing.
					lapNumber:
						appState.currentOverlayLapNumbers?.[i] ??
						resolveGpsLapNumber(appState, profile.segment.range, i + 1),
					distances: profile.distancesKm,
					virtualElevation: profile.virtualElevation,
					actualElevation: profile.actualElevation,
					supplementarySeries: profile.supplementarySeries,
					duration:
						profile.indices.length > 0
							? normalized.timestamps[last] - normalized.timestamps[first]
							: 0,
					totalDistance: profile.distancesKm[profile.distancesKm.length - 1] ?? 0,
				};
			});
			memoMean = calculateMeanElevationProfile(memoLaps);
		}
		return memoLaps;
	}

	function meanElevation(profiles: SegmentVeProfile[]) {
		laps(profiles);
		return memoMean;
	}

	return {
		aggregate(profiles) {
			const lapProfiles = laps(profiles);
			const stats = calculateGpsLapStats(lapProfiles, meanElevation(profiles));
			return {
				r2: stats.meanR2,
				rmse: stats.meanRMSE,
				veGain: stats.avgVeGain,
				actualGain: stats.avgActualGain,
				segmentCount: lapProfiles.length,
				extra: { closingError: stats.closingError },
			};
		},

		renderVe(profiles) {
			const lapProfiles = laps(profiles);
			renderGpsLapVEPlots(lapProfiles, meanElevation(profiles));
			setupTabSwitching({
				wind: () => renderGpsLapWindPlot(lapProfiles),
				power: () => renderGpsLapPowerPlot(lapProfiles),
				vd: () => renderGpsLapVdPlot(lapProfiles),
			});
		},

		renderWind(profiles) {
			renderGpsLapWindPlot(laps(profiles));
		},

		renderPower(profiles) {
			renderGpsLapPowerPlot(laps(profiles));
		},

		renderVd(profiles) {
			renderGpsLapVdPlot(laps(profiles));
		},

		renderMetrics() {
			// GPS-lap's metric spans and summary table are painted inside
			// `renderGpsLapVEPlots` (gpsLapPlots.ts:352-375), which recomputes the
			// stats itself. Nothing to do here, and duplicating the write would
			// be a second place for the header to drift from the plot.
		},
	};
}

/**
 * Update VE plots for GPS lap mode - calculates VE for each lap and shows stacked plot
 */
export async function updateGpsLapVEPlots(
	appState: AppState,
	_parameterStorage: ParameterStorage,
	waitForPlotly: () => Promise<any>,
	cda: number,
	crr: number,
	windSource: string,
) {
	if (
		!appState.currentFitData ||
		!appState.currentGpsLapIndexRanges ||
		!appState.currentParameters
	) {
		log.error("Missing data for GPS lap VE update");
		return;
	}

	await waitForPlotly();

	// `getAnalysisModeHandler` is total — it indexes ANALYSIS_MODES by
	// `getAnalysisModeId(...)` and always returns a handler, so there is no null
	// case to guard. `getGpsAnalysisMode()` is the accessor plan 03's
	// `requestModeUpdate` also uses; the two must agree on one source.
	await updateModeVEPlots({
		appState,
		handler: getAnalysisModeHandler(getGpsAnalysisMode()),
		callbacks: createGpsLapUpdateCallbacks(appState),
		windSource: windSource as WindSource,
		cda,
		crr,
	});
}

/**
 * Recalculate GPS lap VE with updated CdA/Crr values
 */
export async function recalculateGpsLapVE(
	appState: AppState,
	services: ShellServices,
	parameterStorage: ParameterStorage,
	resultsStorage: ResultsStorage,
	waitForPlotly: () => Promise<any>,
) {
	if (!appState.currentFitData || !appState.currentParameters) {
		log.error("Cannot recalculate: missing data or parameters");
		return;
	}

	const cdaValueEl = document.getElementById("cdaValue") as HTMLInputElement;
	const crrValueEl = document.getElementById("crrValue") as HTMLInputElement;

	if (!cdaValueEl || !crrValueEl) return;

	const newCda = parseFloat(cdaValueEl.value);
	const newCrr = parseFloat(crrValueEl.value);

	// Use the ranges of the overlay currently on screen. For genuine GPS this is
	// the selected detected laps; for the stacked-from-standard view the detected
	// lap arrays are empty and the ranges live on currentGpsLapIndexRanges.
	const selectedLapIndexRanges = resolveActiveGpsLapRanges(appState);

	if (selectedLapIndexRanges.length === 0) {
		log.error("No GPS laps selected for recalculation");
		return;
	}

	// Update parameters with new values
	const updatedParams = {
		...appState.currentParameters,
		cda: newCda,
		crr: newCrr,
	};

	// Recalculate
	services.showLoading("Recalculating VE with new parameters...");

	try {
		await showGpsLapVEAnalysis(
			services,
			parameterStorage,
			resultsStorage,
			waitForPlotly,
			selectedLapIndexRanges,
			appState.currentFitData,
			updatedParams,
			appState.currentParameters.air_speed_offset ?? 2,
			true,
		);
	} catch (err) {
		log.error("Recalculation failed:", err);
		services.hideLoading();
	}
}
