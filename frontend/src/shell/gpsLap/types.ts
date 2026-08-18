import type { SegmentSupplementarySeries } from '../../analysis/SegmentSupplementarySeries';

export interface LapVEProfile {
    lapNumber: number;
    distances: number[];      // km, relative to gate crossing (starting at 0)
    virtualElevation: number[];
    /**
     * The constant-wind leg, non-null iff the update ran under `compare`
     * (D-07/D-20, plan 07-04). Same samples as `virtualElevation`.
     *
     * Carried on the profile rather than passed alongside it because every
     * consumer that draws or scores a lap needs both legs together, and a
     * parallel array would let the two get out of step.
     */
    virtualElevationCompare: number[] | null;
    actualElevation: number[];
    supplementarySeries: SegmentSupplementarySeries;
    duration: number;         // seconds
    totalDistance: number;    // km
}
