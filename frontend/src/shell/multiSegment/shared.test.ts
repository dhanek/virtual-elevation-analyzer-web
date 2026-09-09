/**
 * `interpolateAscending` is the only interpolator left. It began as the second
 * of two, added beside a linear scan because one caller
 * (`calculateOutAndBackMeanElevation`'s mirrored-inbound branch) passed a
 * DESCENDING array and depended on what the scan did with it. PR #21 corrected
 * that caller to re-sort; the scan then had one call site left, passing an
 * ascending array, and was folded in here.
 *
 * THE DESCENDING CASE STAYS, and is now the most valuable case in this file. It
 * was written to pin behaviour a real caller depended on. It survives for the
 * opposite reason: no caller may depend on it any more, and the guards are
 * order-agnostic, so a descending array is accepted and answered wrongly rather
 * than rejected. The trap is in the guard shape, which the surviving function
 * inherited unchanged — deleting the case would retire the only thing that
 * documents it.
 *
 * The equivalence cases that licensed the fold are gone with the function they
 * compared against. What they proved is recorded in the fold's commit and in
 * `interpolateAscending`'s docstring; the behavioural cases below outlive them.
 */
import { describe, expect, it } from "vitest";
import { interpolateAscending } from "./shared";

const distances = [0, 1, 2, 3, 4];
const elevations = [100, 110, 120, 130, 140];

describe("interpolateAscending", () => {
	it("returns an exact sample at a sampled distance", () => {
		expect(interpolateAscending(2, distances, elevations)).toBe(120);
	});

	it("interpolates linearly between two samples", () => {
		expect(interpolateAscending(2.5, distances, elevations)).toBe(125);
	});

	it("clamps below the first sample and above the last", () => {
		expect(interpolateAscending(-5, distances, elevations)).toBe(100);
		expect(interpolateAscending(99, distances, elevations)).toBe(140);
	});

	it("returns NaN for an empty reference", () => {
		expect(interpolateAscending(1, [], [])).toBeNaN();
	});

	it("lands on the exact sample at a bracket boundary", () => {
		// A binary search that settled on the wrong side of a boundary would
		// return an interpolated value a hair off the sample.
		for (let i = 0; i < distances.length; i++) {
			expect(interpolateAscending(distances[i], distances, elevations)).toBe(
				elevations[i],
			);
		}
	});

	it("handles a two-point reference, the smallest bracket there is", () => {
		expect(interpolateAscending(0.25, [0, 1], [10, 20])).toBe(12.5);
	});

	it("handles repeated distances without dividing by zero", () => {
		// A stalled ride can record two samples at one distance. The lower bound
		// takes the first bracket, as the linear scan it replaced did; this must
		// not produce Infinity.
		const withDuplicate = [0, 1, 1, 2];
		const elevs = [10, 20, 30, 40];
		expect(interpolateAscending(1, withDuplicate, elevs)).toBe(20);
	});

	it("interpolates correctly across a long realistic reference", () => {
		// The shape the production caller passes: a ~1200-point ramp. Checked
		// against the closed form rather than against a second implementation,
		// now that there is only one.
		const long = Array.from({ length: 1_200 }, (_, i) => (i / 1_199) * 4.2);
		const elev = long.map((d) => 100 + d * 3);
		for (const target of [0, 0.001, 1.7, 2.5, 4.1999]) {
			expect(interpolateAscending(target, long, elev)).toBeCloseTo(
				100 + target * 3,
				9,
			);
		}
	});

	it("returns the FIRST elevation for every target when given a descending array", () => {
		// NO CALLER MAY HIT THIS. The mirrored-inbound branch was the one that
		// did — it took a constant from that leg instead of a curve — and it was
		// corrected in PR #21 to re-sort before calling. The case stays so a
		// future caller cannot re-acquire the trap silently: the guards here are
		// order-agnostic, so a descending array is answered wrongly rather than
		// rejected, and `targetDist <= distances[0]` tests against the array's
		// MAXIMUM.
		const descending = [4, 3, 2, 1, 0];
		expect(interpolateAscending(0, descending, elevations)).toBe(100);
		expect(interpolateAscending(2, descending, elevations)).toBe(100);
		expect(interpolateAscending(4, descending, elevations)).toBe(100);
	});
});
