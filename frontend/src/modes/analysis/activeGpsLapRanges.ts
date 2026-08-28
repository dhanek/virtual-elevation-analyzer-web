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

/**
 * The lap NUMBER to label a range with — the detected lap whose bounds match,
 * falling back to the ordinal.
 *
 * This is a pure lookup over `gpsDetectedLaps`; it lived in
 * `shell/gpsLap/renderGpsLap.ts` as `getGpsLapNumberForRange` only by accident
 * of history. Plan 07-02 Task 3 needs it in this layer because
 * `gpsLapMode.summarize` writes `currentAnalyzedLaps`, and before the primitive
 * that array held the REAL lap numbers (`updateGpsLap.ts:250`). Labelling by
 * ordinal instead would silently change what Store Result persists for any
 * selection that is not laps 1..N — a stored-output regression with no D-09
 * entry. The shell function now delegates here so there is one lookup.
 */
export function resolveGpsLapNumber(
	appState: AppState,
	range: LapIndexRange,
	fallbackLapNumber: number,
): number {
	const matchingLap = appState.gpsDetectedLaps.find(
		(lap) => lap.startIdx === range.startIdx && lap.endIdx === range.endIdx,
	);
	return matchingLap?.lapNumber ?? fallbackLapNumber;
}

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
