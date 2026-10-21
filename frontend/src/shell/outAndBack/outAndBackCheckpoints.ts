/**
 * Course checkpoints on the out-and-back view: one row per LEG, since each
 * leg passes a checkpoint once, outbound and inbound the opposite way — so no
 * direction test here.
 */
import type { CheckpointRowInput } from "../../analysis/Checkpoints";
import {
	applyCheckpointOverlay,
	tagTraceSamples,
} from "../checkpoints/checkpointOverlay";
import type { OutAndBackFigures } from "./outAndBackPlots";
import type { OutAndBackVEProfile } from "./types";

function outAndBackCheckpointRows(
	profiles: readonly OutAndBackVEProfile[],
	figures: OutAndBackFigures,
): CheckpointRowInput[] {
	const rows: CheckpointRowInput[] = [];
	for (const leg of figures.legs) {
		const profile = profiles.find((p) => p.sectionNumber === leg.sectionNumber);
		const indices =
			leg.direction === "outbound"
				? profile?.outboundIndices
				: profile?.inboundIndices;
		if (!indices || indices.length !== leg.veTrace.x.length) continue;
		tagTraceSamples(leg.veTrace, indices);
		rows.push({
			label: `S${leg.sectionNumber} ${leg.direction === "outbound" ? "A→B" : "B→A"}`,
			indices,
			x: leg.veTrace.x,
			residual: leg.residual,
			directional: false,
		});
	}
	return rows;
}

/** The `decorate` hook `renderOutAndBackPlots` runs before it draws. */
export function decorateOutAndBackWithCheckpoints(
	profiles: readonly OutAndBackVEProfile[],
): (figures: OutAndBackFigures, isCompare: boolean) => void {
	return (figures, isCompare) =>
		applyCheckpointOverlay({
			rows: outAndBackCheckpointRows(profiles, figures),
			markers: "median",
			veLayout: figures.ve.layout,
			residualLayout: figures.residuals.layout,
			tableId: "oabCheckpointTable",
			rowNoun: "Leg",
			notes: [
				`VE − reference as the residual plot draws it: each leg's VE (outbound anchored to the mean elevation at gate A, inbound continuing from where its outbound ended) minus the mean elevation at that distance from A${isCompare ? " (FIT-wind plots)" : ""}.`,
				"The marker sits at the median distance from A the legs pass the checkpoint; each leg's value is read where that leg passes it.",
			],
		});
}
