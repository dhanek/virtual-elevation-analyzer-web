/**
 * Derive per-lap index ranges from ordinary (non-GPS-detected) lap selections.
 *
 * The "stacked" overlay view reuses the GPS-lap renderer, which consumes
 * `{ startIdx, endIdx }` ranges. Ordinary laps only carry `start_time` /
 * `end_time`, so we resolve each lap's contiguous index span against the
 * normalized timestamp array. This mirrors the time-range resolution in
 * `collectSelectionIndices` (AnalysisModes.ts) and works for both FIT and CSV
 * sources, since it does not depend on the optional `start_index` /
 * `end_index` fields (only populated on the CSV path).
 */
import type { ActivityLapLike, LapIndexRange } from "../../state/AppState";

export interface SelectedLapInput {
	lapNumber: number;
	lap: ActivityLapLike;
}

export interface DerivedOverlayLaps {
	ranges: LapIndexRange[];
	/** Lap numbers aligned 1:1 with `ranges` (laps without data are dropped). */
	lapNumbers: number[];
}

/**
 * For each selected lap, find the first and last sample index whose timestamp
 * falls within the lap's `[start_time, end_time]` span. Laps that resolve to no
 * samples are skipped (and their lap number omitted) so the returned ranges and
 * lapNumbers stay aligned.
 */
export function deriveOverlayLaps(
	timestamps: ArrayLike<number>,
	selectedLaps: SelectedLapInput[],
): DerivedOverlayLaps {
	const ranges: LapIndexRange[] = [];
	const lapNumbers: number[] = [];

	for (const { lapNumber, lap } of selectedLaps) {
		let startIdx = -1;
		let endIdx = -1;

		for (let i = 0; i < timestamps.length; i++) {
			const t = timestamps[i];
			if (t >= lap.start_time && t <= lap.end_time) {
				if (startIdx === -1) {
					startIdx = i;
				}
				endIdx = i;
			}
		}

		if (startIdx !== -1) {
			ranges.push({ startIdx, endIdx });
			lapNumbers.push(lapNumber);
		}
	}

	return { ranges, lapNumbers };
}
