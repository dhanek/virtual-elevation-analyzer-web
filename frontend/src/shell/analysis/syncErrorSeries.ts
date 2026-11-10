/**
 * The ground- and air-speed series the GPS modes' sync-error readout is
 * measured between (`refreshOffsetMetric`, `bindModeControls.ts`).
 *
 * The air speed is UNSHIFTED: `calculateAirSpeedSyncError` applies the
 * slider's offset itself, so a series that already carried
 * `params.air_speed_offset` was measured at twice the offset. Standard hands
 * the readout the analyze payload's series, which is unshifted for the same
 * reason (`prepareAnalysisPayload`, `applyOffset: false`).
 *
 * Resolved on demand rather than captured at render time, so the number
 * follows the CURRENTLY selected wind source. Both lookups are cached
 * (`getNormalizedActivityArrays`), so this is a map read per interaction.
 */
import { getNormalizedActivityArrays } from "../../analysis/ActivityArrayCache";
import { resolveWindSeries } from "../../analysis/WindSourceResolver";
import type { AppState } from "../../state/AppState";

export interface SyncErrorSeries {
	groundSpeed: number[];
	airSpeed: number[];
	timestamps: number[];
}

export function resolveSyncErrorSeries(
	appState: AppState,
	windSource: string,
): SyncErrorSeries {
	const fitData = appState.currentFitData;
	const params = appState.currentParameters;
	if (!fitData || !params) {
		return { groundSpeed: [], airSpeed: [], timestamps: [] };
	}
	const normalized = getNormalizedActivityArrays(fitData);
	const resolution = resolveWindSeries({
		fitData,
		windSource,
		params,
		airSpeedCalibrationPercent: appState.airSpeedCalibrationPercent,
		applyOffset: false,
	});
	return {
		groundSpeed: normalized.velocity,
		airSpeed: resolution.windSpeed,
		timestamps: normalized.timestamps,
	};
}
