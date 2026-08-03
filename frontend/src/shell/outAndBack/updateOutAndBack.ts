/**
 * Out-and-back VE update and recalculation.
 *
 * Verbatim lift from main.ts -- update logic for out-and-back mode.
 */
import type { AppState, WindSource } from "../../state/AppState";
import type { ParameterStorage } from "../../utils/ParameterStorage";
import type { ResultsStorage } from "../../utils/ResultsStorage";
import type { ShellServices } from "../analysis/types";
import type {
	ModeUpdateCallbacks,
	SegmentVeProfile,
} from "../../modes/analysis/types";
import type { OutAndBackVEProfile } from "./types";

import { getAnalysisModeHandler } from "../../modes/analysis/AnalysisModes";
import {
	matchesRange,
	resolveActiveOutAndBackSections,
} from "../../modes/analysis/activeOutAndBackSections";
import { updateModeVEPlots } from "../analysis/updateModeVEPlots";
import { getGpsAnalysisMode } from "../section3/section3Orchestration";
import { getSelectedWindSource } from "../dom/windSource";
import {
	calculateOutAndBackMeanElevation,
	calculateOutAndBackStats,
	renderOutAndBackPlots,
	renderOutAndBackWindPlot,
	renderOutAndBackPowerPlot,
	renderOutAndBackVdPlot,
} from "./outAndBackPlots";
import { showOutAndBackVEAnalysis } from "./renderOutAndBack";
import { log } from "../../utils/log";
import { scheduleRecompute } from "../analysis/recomputeRunner";

export function scheduleOutAndBackRecompute(
	run: () => Promise<void> | void,
): void {
	scheduleRecompute({
		mode: "out-and-back",
		run,
	});
}

/**
 * Reassemble the primitive's FLAT segment list into the per-section shape the
 * out-and-back plots and stat helpers expect.
 *
 * The primitive emits 2N segments (outbound, inbound, outbound, ...); an
 * `OutAndBackVEProfile` is one section carrying both legs. Pairing is done by
 * matching each profile's full-activity range against the section it came from,
 * NOT by position in the array — a leg under 10 samples is skipped by the
 * primitive, which would shift every subsequent index by one and silently
 * transplant an inbound leg onto the wrong section.
 *
 * A section whose legs were both skipped is dropped, reproducing the old
 * `outboundVE.length > 0 || inboundVE.length > 0` guard.
 */
function toOutAndBackProfiles(
	appState: AppState,
	profiles: SegmentVeProfile[],
): OutAndBackVEProfile[] {
	const result: OutAndBackVEProfile[] = [];

	for (const section of resolveActiveOutAndBackSections(appState)) {
		const outbound = profiles.find((profile) =>
			matchesRange(profile, section.outboundStartIdx, section.outboundEndIdx),
		);
		const inbound = profiles.find((profile) =>
			matchesRange(profile, section.inboundStartIdx, section.inboundEndIdx),
		);

		if (!outbound && !inbound) {
			continue;
		}

		result.push({
			sectionNumber: section.sectionNumber,
			outboundDistances: outbound?.distancesKm ?? [],
			outboundVE: outbound?.virtualElevation ?? [],
			outboundActualElevation: outbound ? [...outbound.actualElevation] : [],
			outboundSeries: outbound?.supplementarySeries ?? null,
			inboundDistances: inbound?.distancesKm ?? [],
			inboundVE: inbound?.virtualElevation ?? [],
			inboundActualElevation: inbound ? [...inbound.actualElevation] : [],
			inboundSeries: inbound?.supplementarySeries ?? null,
			outboundDuration: section.outboundDuration,
			inboundDuration: section.inboundDuration,
			totalDistance: section.totalDistance,
		});
	}

	return result;
}

/**
 * Build the out-and-back `ModeUpdateCallbacks`.
 *
 * As with GPS-lap, this is the only out-and-back-specific code left in the
 * update path. The mapped profiles and mean elevation are memoised on the
 * identity of the `profiles` array so `aggregate` and the render callbacks
 * share one computation regardless of call order.
 */
function createOutAndBackUpdateCallbacks(
	appState: AppState,
	Plotly: any,
): ModeUpdateCallbacks {
	let memoKey: SegmentVeProfile[] | null = null;
	let memoSections: OutAndBackVEProfile[] = [];
	let memoMean: { distances: number[]; elevation: number[] } = {
		distances: [],
		elevation: [],
	};

	function sections(profiles: SegmentVeProfile[]): OutAndBackVEProfile[] {
		if (profiles !== memoKey) {
			memoKey = profiles;
			memoSections = toOutAndBackProfiles(appState, profiles);
			memoMean = calculateOutAndBackMeanElevation(memoSections);
		}
		return memoSections;
	}

	function meanElevation(profiles: SegmentVeProfile[]) {
		sections(profiles);
		return memoMean;
	}

	return {
		aggregate(profiles) {
			const sectionProfiles = sections(profiles);
			const stats = calculateOutAndBackStats(
				sectionProfiles,
				meanElevation(profiles),
			);
			// `calculateOutAndBackStats` has no r2 at all, so the aggregate's r2
			// is the mean of the per-SEGMENT calculator r2. Deliberate: it is a
			// value the out-and-back screen never displayed, and it is now what
			// Store Result persists (see outAndBackMode.summarize).
			const meanR2 =
				profiles.length > 0
					? profiles.reduce((sum, profile) => sum + (profile.result.r2 ?? 0), 0) /
						profiles.length
					: 0;

			return {
				r2: meanR2,
				rmse: stats.rmse,
				veGain: stats.avgVeGain,
				actualGain: stats.avgActualGain,
				// Sections, not segments — this is what the header span counts.
				segmentCount: sectionProfiles.length,
				extra: { avgDiff: stats.avgDiff },
			};
		},

		renderVe(profiles) {
			renderOutAndBackPlots(Plotly, sections(profiles), meanElevation(profiles));
		},

		renderWind(profiles) {
			renderOutAndBackWindPlot(sections(profiles));
		},

		renderPower(profiles) {
			renderOutAndBackPowerPlot(sections(profiles));
		},

		renderVd(profiles) {
			renderOutAndBackVdPlot(sections(profiles));
		},

		renderMetrics(aggregate) {
			// The template renders ve-metrics-compact with these four spans; there
			// is no #oabVeMetrics element, so refresh all four values here.
			const rmseSpan = document.getElementById("oabRmseValue");
			const veGainValueSpan = document.getElementById("oabVeGainValue");
			const actualGainValueSpan = document.getElementById("oabActualGainValue");
			const sectionCountSpan = document.getElementById("oabSectionCountValue");
			if (rmseSpan) {
				rmseSpan.textContent = `${aggregate.rmse.toFixed(2)}m`;
			}
			if (veGainValueSpan) {
				veGainValueSpan.textContent = `${aggregate.veGain.toFixed(2)}m`;
			}
			if (actualGainValueSpan) {
				actualGainValueSpan.textContent = `${aggregate.actualGain.toFixed(2)}m`;
			}
			if (sectionCountSpan) {
				sectionCountSpan.textContent = aggregate.segmentCount.toString();
			}
		},
	};
}

/**
 * Update Out and Back VE plots with new CdA/Crr values
 */
export async function updateOutAndBackVEPlots(
	appState: AppState,
	waitForPlotly: () => Promise<any>,
	cda: number,
	crr: number,
) {
	if (
		!appState.currentFitData ||
		!appState.currentOutAndBackSections ||
		appState.currentOutAndBackSections.length === 0 ||
		!appState.currentParameters
	) {
		log.error("Missing data for Out and Back VE update");
		return;
	}

	const Plotly = await waitForPlotly();

	// The wind source was read from the DOM inside the old spine. It is now read
	// here, at the adapter boundary, and passed in as an argument — the primitive
	// reads no controls.
	await updateModeVEPlots({
		appState,
		handler: getAnalysisModeHandler(getGpsAnalysisMode()),
		callbacks: createOutAndBackUpdateCallbacks(appState, Plotly),
		windSource: getSelectedWindSource() as WindSource,
		cda,
		crr,
	});
}

/**
 * Recalculate Out and Back VE with updated parameters
 */
export async function recalculateOutAndBackVE(
	services: ShellServices,
	parameterStorage: ParameterStorage,
	resultsStorage: ResultsStorage,
	waitForPlotly: () => Promise<any>,
) {
	const { appState } = services;
	if (
		!appState.currentFitData ||
		!appState.currentParameters ||
		!appState.currentOutAndBackSections ||
		appState.currentOutAndBackSections.length === 0
	) {
		log.error(
			"Cannot recalculate Out and Back VE: missing data, parameters, or sections",
		);
		return;
	}

	const cda = parseFloat(
		(document.getElementById("cdaValue") as HTMLInputElement)?.value || "0.3",
	);
	const crr = parseFloat(
		(document.getElementById("crrValue") as HTMLInputElement)?.value || "0.008",
	);
	const updatedParams = { ...appState.currentParameters, cda, crr };

	services.showLoading("Recalculating VE with new parameters...");

	try {
		await showOutAndBackVEAnalysis(
			services,
			parameterStorage,
			resultsStorage,
			appState.currentOutAndBackSections,
			appState.currentFitData,
			updatedParams,
			appState.currentParameters.air_speed_offset ?? 2,
			waitForPlotly,
			true,
		);
	} catch (err) {
		log.error("Out and Back recalculation failed:", err);
		services.hideLoading();
	}
}
