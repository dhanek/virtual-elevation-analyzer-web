/**
 * THE MEAN ELEVATION PROFILE, which out-and-back RMSE is measured against.
 *
 * `calculateOutAndBackMeanElevation` averages every leg's actual elevation onto
 * one reference grid of distance-from-gate-A. The outbound leg is recorded in
 * that frame already; the inbound leg runs B->A, so its distances are mirrored
 * (`maxInboundDist - d`) to put it in the same frame.
 *
 * Mirroring makes the distance array DESCENDING while the elevation array stays
 * in recording order. The pairing is still correct point for point — only the
 * sort order is reversed — but the interpolator's first guard is
 * `targetDist <= distances[0]`, and on a descending array `distances[0]` is the
 * MAXIMUM. So the guard fired for every target and the inbound leg contributed
 * `elevations[0]` — one constant — at every reference distance. That guard is
 * unchanged in `interpolateAscending`, the one interpolator left, so the trap is
 * still reachable by a future caller and `shared.test.ts` still pins it.
 *
 * The physical case that makes this visible is the one out-and-back is for: the
 * two legs cover the same ground, so the inbound elevation profile is the
 * outbound one reversed, and averaging them must return the outbound profile
 * unchanged. Before the fix it returned the average of that profile and a flat
 * line.
 */
import { describe, expect, it } from "vitest";
import { calculateOutAndBackMeanElevation } from "./outAndBackPlots";
import type { OutAndBackVEProfile } from "./types";

const SAMPLES = 200;
const LEG_KM = 4.2;

/** Distance-from-start for one leg, 0 -> LEG_KM. */
const legDistances = Array.from(
	{ length: SAMPLES },
	(_, i) => (i / (SAMPLES - 1)) * LEG_KM,
);

/** A profile with real shape — a flat one could not tell the two apart. */
const outboundElevation = legDistances.map(
	(d) => 100 + d * 9.5 + Math.sin(d * 2.1) * 3,
);

/**
 * One section whose inbound leg RETRACES the outbound ground. Recorded from
 * gate B, so its elevation series is the outbound one reversed: the first
 * inbound sample is taken at gate B, which is the outbound leg's LAST point.
 */
function retracingSection(): OutAndBackVEProfile {
	return {
		sectionNumber: 1,
		outboundDistances: legDistances,
		outboundVE: outboundElevation.slice(),
		outboundVECompare: null,
		outboundActualElevation: outboundElevation.slice(),
		outboundSeries: null,
		inboundDistances: legDistances.slice(),
		inboundVE: outboundElevation.slice().reverse(),
		inboundVECompare: null,
		inboundActualElevation: outboundElevation.slice().reverse(),
		inboundSeries: null,
		outboundDuration: 120,
		inboundDuration: 130,
		totalDistance: LEG_KM * 2,
	};
}

describe("calculateOutAndBackMeanElevation", () => {
	it("returns the shared profile when both legs retrace the same ground", () => {
		const { distances, elevation } = calculateOutAndBackMeanElevation([
			retracingSection(),
		]);

		expect(distances.length).toBeGreaterThan(100);
		expect(elevation.length).toBe(distances.length);

		// The mean of a profile and its own mirror is that profile. Interpolation
		// onto a ~10 m grid is the only source of error, hence the tolerance.
		for (let i = 0; i < distances.length; i++) {
			const expected =
				100 + distances[i] * 9.5 + Math.sin(distances[i] * 2.1) * 3;
			expect(elevation[i]).toBeCloseTo(expected, 1);
		}
	});

	it("does not collapse the inbound leg to a constant", () => {
		// The defect stated directly, so a regression names itself. With the
		// inbound leg contributing one value at every distance, the mean is
		// dragged halfway to a flat line and its span roughly halves.
		const { elevation } = calculateOutAndBackMeanElevation([
			retracingSection(),
		]);

		const span = Math.max(...elevation) - Math.min(...elevation);
		const legSpan =
			Math.max(...outboundElevation) - Math.min(...outboundElevation);

		expect(span).toBeCloseTo(legSpan, 0);
	});

	it("still averages two sections that disagree", () => {
		// Guards the fix against over-correcting into "just use the outbound leg":
		// a second section 10 m higher throughout must move the mean by 5 m.
		const raised = retracingSection();
		raised.sectionNumber = 2;
		raised.outboundActualElevation = outboundElevation.map((e) => e + 10);
		raised.inboundActualElevation = outboundElevation
			.map((e) => e + 10)
			.reverse();

		const { distances, elevation } = calculateOutAndBackMeanElevation([
			retracingSection(),
			raised,
		]);

		for (let i = 0; i < distances.length; i++) {
			const base = 100 + distances[i] * 9.5 + Math.sin(distances[i] * 2.1) * 3;
			expect(elevation[i]).toBeCloseTo(base + 5, 1);
		}
	});
});
