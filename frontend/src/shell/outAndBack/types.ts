import type { SegmentSupplementarySeries } from '../../analysis/SegmentSupplementarySeries';

export interface OutAndBackVEProfile {
    sectionNumber: number;
    outboundDistances: number[];      // km, relative to gate A
    outboundVE: number[];
    outboundActualElevation: number[];
    outboundSeries: SegmentSupplementarySeries | null;
    inboundDistances: number[];       // km, relative to gate B (will be mirrored)
    inboundVE: number[];
    inboundActualElevation: number[];
    inboundSeries: SegmentSupplementarySeries | null;
    outboundDuration: number;
    inboundDuration: number;
    totalDistance: number;
}
