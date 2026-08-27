import type { SegmentSupplementarySeries } from '../../analysis/SegmentSupplementarySeries';

export interface LapVEProfile {
    lapNumber: number;
    /**
     * The full-activity range this lap was computed over.
     *
     * Carried so the profile is self-describing about WHICH samples it
     * represents. The analyze pass drops laps under 10 samples and laps whose
     * calculator throws, so the surviving profiles — not the active range list
     * — are the truth about what is on screen (WR-03).
     */
    range: { startIdx: number; endIdx: number };
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
