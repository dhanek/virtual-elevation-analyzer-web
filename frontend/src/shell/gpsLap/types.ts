import type { SegmentSupplementarySeries } from '../../analysis/SegmentSupplementarySeries';

export interface LapVEProfile {
    lapNumber: number;
    distances: number[];      // km, relative to gate crossing (starting at 0)
    virtualElevation: number[];
    actualElevation: number[];
    supplementarySeries: SegmentSupplementarySeries;
    duration: number;         // seconds
    totalDistance: number;    // km
}
