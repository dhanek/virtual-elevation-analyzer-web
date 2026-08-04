/**
 * The per-segment virtual distances a mode both SHOWS and STORES.
 *
 * ## Why this is one module rather than two
 *
 * Change-list entry (h) used to say multi-lap Standard stores zeros, justified
 * by there being no single well-defined virtual distance for a selection that
 * D-19 Option B fits and integrates one lap at a time. That justification died
 * the moment the VD header started showing the real per-lap figures: a user who
 * can read per-lap numbers on screen will reasonably expect Store Result and
 * Export CSV to agree with them. The maintainer ruled accordingly — store the
 * per-lap values.
 *
 * "Agree with them" is a strong claim, so the header and the stored record are
 * built by calling the SAME function here, not by two implementations that
 * happen to match today. The whole history of this area is numbers sourced from
 * somewhere other than the thing they claim to describe.
 *
 * ## What a segment's virtual distance is, per mode
 *
 * Each mode reads its own VD tab's curve, because that is the picture the
 * numbers label:
 *
 * - **Standard** integrates each lap over that lap's OWN trim window, exactly
 *   as the stitched VD plot does. A lap the trim window has dropped produces no
 *   entry, the same rule that keeps it out of the headline mean.
 * - **GPS-lap** (and the Standard "Stacked" view, which shares that sidebar)
 *   reads the endpoint of the per-lap cumulative series the stacked plot draws.
 * - **Out-and-back** reads those same endpoints, then combines a section's two
 *   legs into ONE section total — see `sectionVirtualDistances`.
 *
 * ## The representation, and why it is not one number
 *
 * A `SegmentVirtualDistance[]` — one entry per independently-integrated
 * segment, in analysis order, each labelled. N laps are never flattened into a
 * single figure: the concatenated integral spans the wall-clock gaps between
 * laps and is not a distance anyone rode.
 *
 * Every entry keeps its label HERE, including a lone one. Dropping the prefix
 * for a single-segment analysis is a presentation rule, and it belongs to the
 * two presenters that have always applied it — `renderVirtualDistanceHeader`
 * strips it from a lone row, `virtualDistanceCsvCells` leaves VDSegments empty
 * for a lone entry — so single-lap Standard reads exactly as it always has
 * without this layer having to know how many callers there are.
 */
import {
	addVirtualDistanceTotals,
	computeVirtualDistanceWindowTotals,
	virtualDistanceDifferencePercent,
	type SegmentVirtualDistance,
	type VirtualDistanceTotals,
} from "../../analysis/VirtualDistance";
import type { SegmentSupplementarySeries } from "../../analysis/SegmentSupplementarySeries";
import type { SegmentVeProfile } from "./types";

export type { SegmentVirtualDistance };

/** Timestamps and velocity over the FULL activity, indexed by `profile.indices`. */
export interface VirtualDistanceSourceArrays {
	timestamps: number[];
	velocity: number[];
}

/**
 * Standard: one entry per lap, integrated over that lap's own trim window.
 *
 * Identical arithmetic to the stitched VD plot's header, because it is the same
 * call.
 */
export function standardVirtualDistances(
	profiles: SegmentVeProfile[],
	source: VirtualDistanceSourceArrays,
): SegmentVirtualDistance[] {
	return profiles.map((profile, index) => {
		const timestamps = profile.indices.map((i) => source.timestamps[i]);
		const velocity = profile.indices.map((i) => source.velocity[i]);
		const lastIndex = Math.max(0, timestamps.length - 1);

		return {
			label: profile.segment.label ?? `Lap ${index + 1}`,
			...computeVirtualDistanceWindowTotals({
				timestamps,
				velocity,
				windSpeed: profile.supplementarySeries.apparentWindSpeedMps,
				trimStart: profile.segment.trim?.start ?? 0,
				trimEnd: profile.segment.trim?.end ?? lastIndex,
			}),
		};
	});
}

/** The endpoint of one segment's cumulative air/ground curves, in km. */
export function supplementaryTotals(
	metrics: SegmentSupplementarySeries,
): VirtualDistanceTotals {
	const airKm = lastOrZero(metrics.virtualDistanceAirKm);
	const groundKm = lastOrZero(metrics.virtualDistanceGroundKm);
	return {
		airKm,
		groundKm,
		differencePercent: virtualDistanceDifferencePercent(airKm, groundKm),
	};
}

/**
 * GPS-lap and the Standard "Stacked" view: one entry per lap, read off the same
 * cumulative series the stacked plot draws.
 */
export function stackedVirtualDistances(
	segments: { label: string; metrics: SegmentSupplementarySeries }[],
): SegmentVirtualDistance[] {
	return segments.map((segment) => ({
		label: segment.label,
		...supplementaryTotals(segment.metrics),
	}));
}

/** One section's two legs, either of which may be absent. */
export interface OutAndBackSectionLegs {
	label: string;
	outbound: SegmentSupplementarySeries | null;
	inbound: SegmentSupplementarySeries | null;
}

/**
 * Out-and-back: ONE entry per section, combining its outbound and inbound legs.
 *
 * Out-and-back has two segments per on-screen section, so per-segment would mean
 * 2N lines. The maintainer ruled per-section total: one line per section,
 * combining both legs, explicitly not per-leg.
 *
 * **Why that total is well defined here and the concatenated multi-lap integral
 * is not.** The multi-lap case was refused because integrating laps end to end
 * charges the wall-clock gap between them as distance, producing a number that
 * is not the length of anything the rider rode. Summing does not do that. A
 * section total is `outbound + inbound`, two distances each actually ridden; the
 * turnaround between them contributes zero rather than being counted. So the
 * objection that killed the concatenated integral does not reach this, and there
 * is no reason to refuse a number that is true. `addVirtualDistanceTotals` holds
 * that argument next to the arithmetic.
 *
 * The difference percentage is recomputed from the summed air and ground
 * distances rather than averaged from the legs' percentages: it is a ratio, and
 * the mean of two ratios is not the ratio of the sums unless the legs happen to
 * be the same length.
 *
 * A section whose legs both failed to produce a series is dropped rather than
 * shown as zero — the same rule that keeps a trimmed-out Standard lap off the
 * header, and the same rule `sectionsCoveredByProfiles` applies to
 * `currentAnalyzedLaps`.
 */
export function sectionVirtualDistances(
	sections: OutAndBackSectionLegs[],
): SegmentVirtualDistance[] {
	const covered = sections.filter(
		(section) => section.outbound !== null || section.inbound !== null,
	);

	return covered.map((section) => {
		const legs = [section.outbound, section.inbound]
			.filter((leg): leg is SegmentSupplementarySeries => leg !== null)
			.map(supplementaryTotals);

		return {
			label: section.label,
			...legs.reduce(addVirtualDistanceTotals),
		};
	});
}

function lastOrZero(values: number[]): number {
	return values.length > 0 ? values[values.length - 1] : 0;
}
