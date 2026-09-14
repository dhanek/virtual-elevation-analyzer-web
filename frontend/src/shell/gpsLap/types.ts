import type { SegmentSupplementarySeries } from "../../analysis/SegmentSupplementarySeries";
import type { ReferenceElevationSeries } from "../../analysis/elevationProfiles";

export interface LapVEProfile {
	lapNumber: number;
	distances: number[]; // km, relative to gate crossing (starting at 0)
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
	duration: number; // seconds
	totalDistance: number; // km
}
