/**
 * The `ModeUpdateCallbacks` a headless run injects (Convergence plan, C7).
 *
 * THE AGGREGATE IS THE MODE'S OWN, NOT A CONVENIENT MEAN. `aggregate`'s
 * output becomes `appState.currentVEResult` through each mode's `summarize`,
 * and therefore the stored row and the CSV. The golden harness's per-segment
 * means happen to equal Standard's real aggregate — and quietly DISAGREE with
 * GPS-lap's (stats over a mean-elevation profile) and out-and-back's. So this
 * module delegates to the same extracted functions the three shell factories
 * call (`standardAggregate` / `gpsLapAggregate` / `outAndBackAggregate`, C4):
 * the API's headline numbers equal the UI's because they ARE the UI's.
 *
 * Renderers are no-ops; the primitive's tab gates are all closed headlessly
 * (`isTabActive: () => false`), so none would run anyway.
 */
import { getNormalizedActivityArrays } from "../analysis/ActivityArrayCache";
import type {
	AnalysisModeId,
	ModeUpdateCallbacks,
} from "../modes/analysis/types";
import {
	computeGpsLapAggregate,
	toGpsLapProfiles,
} from "../shell/gpsLap/gpsLapAggregate";
import { calculateMeanElevationProfile } from "../shell/gpsLap/gpsLapPlots";
import {
	computeOutAndBackAggregate,
	toOutAndBackProfiles,
} from "../shell/outAndBack/outAndBackAggregate";
import { calculateOutAndBackMeanElevation } from "../shell/outAndBack/outAndBackPlots";
import { computeStandardAggregate } from "../shell/ve/standardAggregate";
import type { AppState } from "../state/AppState";

export function createHeadlessCallbacks(
	appState: AppState,
	mode: AnalysisModeId,
): ModeUpdateCallbacks {
	const aggregate: ModeUpdateCallbacks["aggregate"] = (profiles) => {
		if (mode === "gpsLap") {
			const normalized = getNormalizedActivityArrays(
				appState.currentFitData!,
			);
			const lapProfiles = toGpsLapProfiles(appState, normalized, profiles);
			return computeGpsLapAggregate(
				lapProfiles,
				calculateMeanElevationProfile(lapProfiles),
			);
		}
		if (mode === "outAndBack") {
			const sectionProfiles = toOutAndBackProfiles(appState, profiles);
			return computeOutAndBackAggregate(
				profiles,
				sectionProfiles,
				calculateOutAndBackMeanElevation(sectionProfiles),
			);
		}
		return computeStandardAggregate(profiles);
	};

	return {
		aggregate,
		renderVe: () => {},
		renderWind: () => {},
		renderPower: () => {},
		renderVd: () => {},
		renderConvergence: () => {},
		renderMetrics: () => {},
	};
}
