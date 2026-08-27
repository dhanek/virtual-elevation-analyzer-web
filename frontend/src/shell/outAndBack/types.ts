import type { SegmentSupplementarySeries } from '../../analysis/SegmentSupplementarySeries';

export interface OutAndBackVEProfile {
    sectionNumber: number;
    /**
     * The full-activity ranges each leg was computed over, null when that leg
     * produced nothing (under 10 samples, or its calculator threw).
     *
     * Per LEG rather than per section because the two fail independently, and
     * the seed of `currentFilteredData` must cover exactly the legs that made
     * it onto the plot (WR-03).
     */
    outboundRange: { startIdx: number; endIdx: number } | null;
    inboundRange: { startIdx: number; endIdx: number } | null;
    outboundDistances: number[];      // km, relative to gate A
    outboundVE: number[];
    /**
     * The SECOND wind model's outbound VE, non-null iff the update ran under
     * `compare` (D-07/D-20). Carried per LEG because out-and-back emits two
     * `ModeSegment`s per section, so each leg's comparison series comes from its
     * own segment -- there is no single per-section compare array to hold.
     */
    outboundVECompare: number[] | null;
    outboundActualElevation: number[];
    outboundSeries: SegmentSupplementarySeries | null;
    inboundDistances: number[];       // km, relative to gate B (will be mirrored)
    inboundVE: number[];
    /** The second wind model's inbound VE. Same condition as `outboundVECompare`. */
    inboundVECompare: number[] | null;
    inboundActualElevation: number[];
    inboundSeries: SegmentSupplementarySeries | null;
    outboundDuration: number;
    inboundDuration: number;
    totalDistance: number;
}
