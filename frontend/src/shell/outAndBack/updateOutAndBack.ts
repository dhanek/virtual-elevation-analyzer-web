/**
 * Out-and-back VE update and recalculation.
 *
 * Verbatim lift from main.ts -- update logic for out-and-back mode.
 */
import type { AppState } from "../../state/AppState";
import type {
	ModeUpdateCallbacks,
	SegmentVeProfile,
} from "../../modes/analysis/types";
import type { OutAndBackVEProfile } from "./types";

import {
	computeOutAndBackAggregate,
	toOutAndBackProfiles,
} from "./outAndBackAggregate";
import {
	calculateOutAndBackMeanElevation,
	calculateOutAndBackMeanReference,
	renderOutAndBackPlots,
	renderOutAndBackWindPlot,
	renderOutAndBackPowerPlot,
	renderOutAndBackVdPlot,
} from "./outAndBackPlots";
import { setupTabSwitching } from "../dom/tabs";
import {
	renderConvergenceView,
	requestConvergenceRedraw,
} from "../analysis/convergenceView";


// `toOutAndBackProfiles` moved to `outAndBackAggregate.ts` (C4) so the
// headless API pairs legs into sections through the same function.
/**
 * Build the out-and-back `ModeUpdateCallbacks`.
 *
 * As with GPS-lap, this is the only out-and-back-specific code left in the
 * update path. The mapped profiles and mean elevation are memoised on the
 * identity of the `profiles` array so `aggregate` and the render callbacks
 * share one computation regardless of call order.
 */
export function createOutAndBackUpdateCallbacks(
	appState: AppState,
	Plotly: any,
): ModeUpdateCallbacks {
	let memoKey: SegmentVeProfile[] | null = null;
	let memoSections: OutAndBackVEProfile[] = [];
	let memoMean: { distances: number[]; elevation: number[] } = {
		distances: [],
		elevation: [],
	};
	let memoMeanReference: ReturnType<typeof calculateOutAndBackMeanReference> =
		null;

	function sections(profiles: SegmentVeProfile[]): OutAndBackVEProfile[] {
		if (profiles !== memoKey) {
			memoKey = profiles;
			memoSections = toOutAndBackProfiles(appState, profiles);
			memoMean = calculateOutAndBackMeanElevation(memoSections);
			memoMeanReference = calculateOutAndBackMeanReference(memoSections);
		}
		return memoSections;
	}

	function meanElevation(profiles: SegmentVeProfile[]) {
		sections(profiles);
		return memoMean;
	}

	return {
		aggregate(profiles) {
			// Extracted to `outAndBackAggregate.ts` (C4) so the headless API
			// and this screen compute the aggregate through one function.
			return computeOutAndBackAggregate(
				profiles,
				sections(profiles),
				meanElevation(profiles),
			);
		},

		renderVe(profiles) {
			const sectionProfiles = sections(profiles);
			renderOutAndBackPlots(
				Plotly,
				sectionProfiles,
				meanElevation(profiles),
				memoMeanReference,
			);
			// Re-register the tab map against THIS pass's sections. renderOutAndBack
			// registers once at analyze time, and updateModeVEPlots deliberately
			// skips inactive tabs (D-14) — so without this, activating Wind/Power/VD
			// after any slider move replays the analyze-time closures and paints
			// stale series (and stale VD header numbers). GPS-lap and Standard both
			// re-register from renderVe for exactly this reason.
			setupTabSwitching({
				wind: () => renderOutAndBackWindPlot(sectionProfiles),
				power: () => renderOutAndBackPowerPlot(sectionProfiles),
				vd: () => renderOutAndBackVdPlot(sectionProfiles),
				convergence: requestConvergenceRedraw,
			});
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

		renderConvergence: renderConvergenceView,

		renderMetrics(aggregate) {
			// The template renders ve-metrics-compact with these four spans; there
			// is no #oabVeMetrics element, so refresh all four values here.
			const rmseSpan = document.getElementById("oabRmseValue");
			const veGainValueSpan = document.getElementById("oabVeGainValue");
			const actualGainValueSpan = document.getElementById("oabActualGainValue");
			const sectionCountSpan = document.getElementById("oabSectionCountValue");
			const compareMarker = document.getElementById("oabCompareMarker");
			// Under compare the two spans that HAVE a second number carry both as
			// `fit / constant` (ruling 2). Averaging them would describe neither
			// model. "Actual" is excluded on purpose: out-and-back's actual gain is
			// 0 by construction for both models, so a pair there would be noise.
			const compare = aggregate.compare ?? null;
			const pair = (fit: string, constant: string | null) =>
				constant === null ? fit : `${fit} / ${constant}`;
			if (rmseSpan) {
				rmseSpan.textContent = pair(
					`${aggregate.rmse.toFixed(2)}m`,
					compare ? `${compare.rmse.toFixed(2)}m` : null,
				);
			}
			if (veGainValueSpan) {
				veGainValueSpan.textContent = pair(
					`${aggregate.veGain.toFixed(2)}m`,
					compare ? `${compare.veGain.toFixed(2)}m` : null,
				);
			}
			if (actualGainValueSpan) {
				actualGainValueSpan.textContent = `${aggregate.actualGain.toFixed(2)}m`;
			}
			if (sectionCountSpan) {
				sectionCountSpan.textContent = aggregate.segmentCount.toString();
			}
			if (compareMarker) {
				compareMarker.textContent = compare ? " (FIT / Constant)" : "";
			}
		},
	};
}
