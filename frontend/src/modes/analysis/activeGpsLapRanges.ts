/**
 * Resolve the lap index ranges for the GPS-lap overlay currently on screen.
 *
 * The overlay is reached two ways:
 *   - Genuine GPS detection: ranges come from the selected detected laps.
 *   - Stacked-from-standard toggle: ranges are stashed on
 *     `currentGpsLapIndexRanges` and there are no GPS-detected laps.
 *
 * `currentGpsLapIndexRanges` reflects exactly what is displayed in both cases,
 * so prefer it. Fall back to deriving from the selected detected laps only when
 * no active ranges are set (defensive — keeps older call paths working).
 *
 * Relocated from `shell/gpsLap/activeGpsLapRanges.ts` by plan 07-02 Task 1:
 * `gpsLapMode.getUpdateSegments` needs it, and `modes/analysis/` must not import
 * from `shell/` (D-03). The old path survives as a re-export so its existing
 * importer and co-located test are untouched.
 */
import type { AppState, LapIndexRange } from "../../state/AppState";

export function resolveActiveGpsLapRanges(appState: AppState): LapIndexRange[] {
	if (
		appState.currentGpsLapIndexRanges &&
		appState.currentGpsLapIndexRanges.length > 0
	) {
		return appState.currentGpsLapIndexRanges;
	}

	return appState.gpsDetectedLaps
		.filter((lap) => appState.gpsSelectedLaps.includes(lap.lapNumber))
		.map((lap) => ({ startIdx: lap.startIdx, endIdx: lap.endIdx }));
}
