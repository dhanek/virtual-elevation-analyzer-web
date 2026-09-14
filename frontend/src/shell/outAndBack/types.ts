import type { SegmentSupplementarySeries } from "../../analysis/SegmentSupplementarySeries";
import type { ReferenceElevationSeries } from "../../analysis/elevationProfiles";

export interface OutAndBackVEProfile {
	sectionNumber: number;
	outboundDistances: number[]; // km, relative to gate A
	outboundVE: number[];
	/**
	 * The SECOND wind model's outbound VE, non-null iff the update ran under
	 * `compare` (D-07/D-20). Carried per LEG because out-and-back emits two
	 * `ModeSegment`s per section, so each leg's comparison series comes from its
	 * own segment -- there is no single per-section compare array to hold.
	 */
	outboundVECompare: number[] | null;
	outboundActualElevation: number[];
	/**
	 * The NON-master elevation channel over this leg's samples (see
	 * `SegmentVeProfile.referenceElevation`). Null on single-channel rides and
	 * under velodrome. Per LEG for the same reason the compare series is.
	 */
	outboundReferenceElevation: ReferenceElevationSeries | null;
	outboundSeries: SegmentSupplementarySeries | null;
	inboundDistances: number[]; // km, relative to gate B (will be mirrored)
	inboundVE: number[];
	/** The second wind model's inbound VE. Same condition as `outboundVECompare`. */
	inboundVECompare: number[] | null;
	inboundActualElevation: number[];
	/** The non-master channel over the inbound leg. Same condition as outbound. */
	inboundReferenceElevation: ReferenceElevationSeries | null;
	inboundSeries: SegmentSupplementarySeries | null;
	outboundDuration: number;
	inboundDuration: number;
	totalDistance: number;
}
