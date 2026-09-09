/**
 * `interpolateElevation` had FIVE call sites and no test at all. These pin it
 * before `interpolateAscending` is introduced beside it, so the equivalence
 * claim below rests on executed behaviour rather than on reading.
 *
 * THE TWO ARE NOT INTERCHANGEABLE, and that is deliberate. `interpolateElevation`
 * WAS given a DESCENDING array by one caller
 * (`calculateOutAndBackMeanElevation`'s mirrored-inbound branch), where its
 * `targetDist <= distances[0]` guard fired against the array's MAXIMUM and it
 * returned `elevations[0]` for every target. That was a numbers change and so
 * became its own item; the item was taken, and the caller was corrected — it
 * now re-sorts and calls `interpolateAscending`. The descending behaviour is
 * still pinned below, but for a different reason than when these cases were
 * written: it is a real trap in an order-agnostic guard, not a thing any caller
 * depends on. `interpolateAscending` documents an ascending PRECONDITION rather
 * than trying to serve both.
 */
import { describe, expect, it } from "vitest";
import { interpolateAscending, interpolateElevation } from "./shared";

const distances = [0, 1, 2, 3, 4];
const elevations = [100, 110, 120, 130, 140];

describe("interpolateElevation", () => {
	it("returns an exact sample at a sampled distance", () => {
		expect(interpolateElevation(2, distances, elevations)).toBe(120);
	});

	it("interpolates linearly between two samples", () => {
		expect(interpolateElevation(2.5, distances, elevations)).toBe(125);
	});

	it("clamps below the first sample and above the last", () => {
		expect(interpolateElevation(-5, distances, elevations)).toBe(100);
		expect(interpolateElevation(99, distances, elevations)).toBe(140);
	});

	it("returns NaN for an empty reference", () => {
		expect(interpolateElevation(1, [], [])).toBeNaN();
	});

	it("returns the FIRST elevation for every target when given a descending array", () => {
		// NO CALLER HITS THIS ANY MORE. The mirrored-inbound branch was the one
		// that did — it took a constant from that leg instead of a curve — and
		// it was fixed on this branch by re-sorting and calling
		// `interpolateAscending`. The case stays so a future caller cannot
		// re-acquire the trap silently: the guards here are order-agnostic, so
		// a descending array is accepted and answered wrongly rather than
		// rejected.
		const descending = [4, 3, 2, 1, 0];
		expect(interpolateElevation(0, descending, elevations)).toBe(100);
		expect(interpolateElevation(2, descending, elevations)).toBe(100);
		expect(interpolateElevation(4, descending, elevations)).toBe(100);
	});
});

describe("interpolateAscending", () => {
	it("agrees with interpolateElevation at every kind of ascending input", () => {
		// The equivalence that lets the hot call sites switch. Sub-sample steps
		// so bracket boundaries are crossed rather than only landed on.
		for (let target = -1; target <= 5; target += 0.125) {
			expect(interpolateAscending(target, distances, elevations)).toBe(
				interpolateElevation(target, distances, elevations),
			);
		}
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
		// A stalled ride can record two samples at one distance. The linear scan
		// takes the first bracket it finds; this must not produce Infinity.
		const withDuplicate = [0, 1, 1, 2];
		const elevs = [10, 20, 30, 40];
		expect(Number.isFinite(interpolateAscending(1, withDuplicate, elevs))).toBe(
			true,
		);
	});

	it("agrees with interpolateElevation over a long realistic ramp", () => {
		// The shape the hot call sites actually pass: a ~1200-point reference.
		const long = Array.from({ length: 1_200 }, (_, i) => (i / 1_199) * 4.2);
		const elev = long.map((d) => 100 + Math.sin(d * 3) * 5);
		for (const target of [0, 0.001, 1.7, 2.5, 4.1999, 4.2, 5]) {
			expect(interpolateAscending(target, long, elev)).toBe(
				interpolateElevation(target, long, elev),
			);
		}
	});
});
