import type { SegmentSupplementarySeries } from '../../analysis/SegmentSupplementarySeries';
import type { ReferenceElevationSeries } from '../../analysis/elevationProfiles';

export interface LapVEProfile {
    lapNumber: number;
    /**
     * The full-activity range this lap was computed over, or NULL when this
     * profile was not built by the analyze pass.
     *
     * Carried so the profile is self-describing about WHICH samples it
     * represents. The analyze pass drops laps under 10 samples and laps whose
     * calculator throws, so the surviving profiles — not the active range list
     * — are the truth about what is on screen (WR-03).
     *
     * NULLABLE, matching `outAndBack/types.ts` (WR-04). The single reader is the
     * analyze-time seed in `renderGpsLap.ts`; the UPDATE producer has no reader
     * at all and does not compute one. It was declared non-optional and derived
     * unguarded from `profile.indices[0]` / `[length - 1]`, so an empty-indices
     * profile yielded `{ startIdx: undefined, endIdx: undefined }` typed as
     * `number` — while the very next field, `duration`, guarded for exactly that.
     * The null makes the reader's guard enforced rather than hoped for.
     */
    range: { startIdx: number; endIdx: number } | null;
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
    /**
     * The NON-master elevation channel over the same samples as
     * `actualElevation` (see `SegmentVeProfile.referenceElevation`). Carried on
     * the profile for the same reason the compare leg is: the update path drops
     * the index range (`range: null`), so a renderer cannot slice it later.
     */
    referenceElevation: ReferenceElevationSeries | null;
    supplementarySeries: SegmentSupplementarySeries;
    duration: number;         // seconds
    totalDistance: number;    // km
}
