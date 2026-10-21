/**
 * Course checkpoints on Standard's stitched VE plot: one row per selected FIT
 * lap, cut to the trim window, read off the residual trace drawn over that
 * window. Every lap has its own stretch of the axis, so each passing gets its
 * own marker.
 */
import type { CheckpointRowInput } from "../../analysis/Checkpoints";
import type { PlotContext } from "../../plots/PlotContext";
import type { ActivityLapLike } from "../../state/AppState";
import {
	applyCheckpointOverlay,
	tagTraceSamples,
} from "../checkpoints/checkpointOverlay";
import type { StitchedStandardSeries } from "./standardSegments";

interface Figure {
	data: Record<string, unknown>[];
	layout: Record<string, unknown>;
}

export function standardCheckpointRows(
	series: Pick<StitchedStandardSeries, "indices" | "timestamps">,
	context: Pick<PlotContext, "trimStart" | "xPointsMain">,
	figures: { elevation: Figure; residuals: Figure },
	laps: readonly { lapNumber: number; lap: ActivityLapLike }[],
): CheckpointRowInput[] {
	const main = context.xPointsMain;
	const mainIndices = main.map((_, i) => series.indices[context.trimStart + i]);
	for (const trace of figures.elevation.data) {
		if (trace.x === main) tagTraceSamples(trace, mainIndices);
	}
	// The first residual trace over the main window: "VE - Actual", or the FIT
	// leg under compare.
	const residual = figures.residuals.data.find((trace) => trace.x === main)
		?.y as number[] | undefined;
	if (!residual) return [];

	// A lap the trim window leaves no sample of is not a row at all, as it
	// contributes no fit to the headline mean.
	return laps.flatMap(({ lapNumber, lap }) => {
		const row: CheckpointRowInput = {
			label: `Lap ${lapNumber}`,
			indices: [],
			x: [],
			residual: [],
			directional: true,
		};
		for (let i = 0; i < main.length; i++) {
			const t = series.timestamps[context.trimStart + i];
			if (t < lap.start_time || t > lap.end_time) continue;
			row.indices.push(mainIndices[i]);
			row.x.push(main[i]);
			row.residual.push(residual[i]);
		}
		return row.indices.length > 0 ? [row] : [];
	});
}

export function applyStandardCheckpoints(
	series: StitchedStandardSeries,
	context: PlotContext,
	figures: { elevation: Figure; residuals: Figure },
	laps: readonly { lapNumber: number; lap: ActivityLapLike }[],
	isCompare: boolean,
): void {
	applyCheckpointOverlay({
		rows: standardCheckpointRows(series, context, figures, laps),
		markers: "each",
		veLayout: figures.elevation.layout,
		residualLayout: figures.residuals.layout,
		tableId: "veCheckpointTable",
		rowNoun: "Lap",
		reference: `VE anchored to the actual elevation at the trim start, minus the actual elevation (the residual plot)${isCompare ? ", FIT-wind leg" : ""}.`,
	});
}
