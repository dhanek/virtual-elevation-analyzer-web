/**
 * Course checkpoints on the stacked lap view (GPS laps, one-way segments and
 * Standard's stacked view all draw it).
 */
import type { CheckpointRowInput } from "../../analysis/Checkpoints";
import {
	applyCheckpointOverlay,
	tagTraceSamples,
} from "../checkpoints/checkpointOverlay";
import type { StackedFigures } from "./gpsLapPlots";
import type { LapVEProfile } from "./types";

/**
 * One row per lap, read off the lap's residual trace — the FIRST residual
 * trace drawn on the lap's own distance array, which is the FIT leg under
 * compare. The lap's VE traces are tagged with its samples so a click on them
 * places a checkpoint there.
 */
function stackedCheckpointRows(
	lapProfiles: readonly LapVEProfile[],
	figures: StackedFigures,
): CheckpointRowInput[] {
	const rows: CheckpointRowInput[] = [];
	for (const lap of lapProfiles) {
		if (!lap.indices) continue;
		for (const trace of figures.ve.data) {
			if (trace.x === lap.distances) tagTraceSamples(trace, lap.indices);
		}
		const residual = figures.residuals.data.find(
			(trace) => trace.x === lap.distances,
		);
		if (!residual) continue;
		rows.push({
			label: `Lap ${lap.lapNumber}`,
			indices: lap.indices,
			x: lap.distances,
			residual: residual.y,
			directional: true,
		});
	}
	return rows;
}

/** The `decorate` hook `renderGpsLapVEPlots` runs before it draws. */
export function decorateStackedWithCheckpoints(
	lapProfiles: readonly LapVEProfile[],
): (figures: StackedFigures, isCompare: boolean) => void {
	return (figures, isCompare) =>
		applyCheckpointOverlay({
			rows: stackedCheckpointRows(lapProfiles, figures),
			markers: "median",
			veLayout: figures.ve.layout,
			residualLayout: figures.residuals.layout,
			tableId: "gpsLapCheckpointTable",
			rowNoun: "Lap",
			reference: `Each lap's VE, anchored to the mean elevation at the gate, minus the mean elevation (the residual plot)${isCompare ? ", FIT-wind legs" : ""}.`,
		});
}
