/**
 * THE THIRD ANALYZE LEG'S AIR DENSITY.
 *
 * `renderGpsLap` and `renderOutAndBack` were given `resolveRhoArray` when the
 * analyze/update rho divergence was found; Standard was not, because it slices
 * a CONCATENATED SELECTION rather than a contiguous range and so could not
 * reuse the per-segment `indices.map(...)` line the other two copied. It kept
 * integrating a constant `params.rho` while `updateModeVEPlots` integrated the
 * real per-point series one macrotask later.
 *
 * Two things are pinned here, because the defect had two halves:
 *
 *   - the SLICE is correct and refuses to guess (this file's behavioural
 *     cases);
 *   - every analyze leg actually asks for one (the source case at the bottom).
 *     A unit test of the resolver cannot see a caller that never calls it,
 *     which is precisely how this leg was missed the first time.
 */
import { describe, expect, it } from "vitest";
import { resolveSelectionRhoArray } from "./rhoArrayResolver";
import type { ActivityDataLike } from "../../state/AppState";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

/**
 * A fresh object per call: `getNormalizedActivityArrays` caches on identity, so
 * a shared literal would carry one test's density series into the next.
 */
function activity(airDensity: number[] | undefined): ActivityDataLike {
	const length = 6;
	const filled = (value: number) => new Array<number>(length).fill(value);
	return {
		timestamps: Array.from({ length }, (_, i) => i),
		power: filled(200),
		velocity: filled(10),
		position_lat: filled(0),
		position_long: filled(0),
		altitude: filled(100),
		distance: Array.from({ length }, (_, i) => i * 10),
		air_density_data: airDensity,
	} as unknown as ActivityDataLike;
}

const density = [1.2, 1.21, 1.22, 1.23, 1.24, 1.25];

describe("resolveSelectionRhoArray", () => {
	it("slices the full-activity series onto the selected samples, in order", () => {
		// The selection is what `prepareAnalysisPayload` concatenated, so it can
		// skip records and it is NOT necessarily contiguous.
		const selected = [4, 5, 0, 1];

		expect(
			resolveSelectionRhoArray(activity(density), selected, selected.length),
		).toEqual([1.24, 1.25, 1.2, 1.21]);
	});

	it("treats an empty selection as the whole activity", () => {
		expect(resolveSelectionRhoArray(activity(density), [], 6)).toEqual(density);
	});

	it("returns null when the ride carries no usable air density", () => {
		// Zero-filled is what a FIT file without the channel decodes to, and it
		// is the case `resolveRhoArray` reads as "nothing here".
		expect(
			resolveSelectionRhoArray(activity(new Array(6).fill(0)), [0, 1], 2),
		).toBeNull();
		expect(resolveSelectionRhoArray(activity(undefined), [0, 1], 2)).toBeNull();
	});

	it("refuses a slice that is not the length the calculator's other series are", () => {
		// A short array under the calculator is a worse bug than a constant one:
		// the Rust side would read past the end of the density series for every
		// sample beyond it.
		expect(resolveSelectionRhoArray(activity(density), [0, 1, 2], 4)).toBeNull();
	});

	it("refuses a selection index the density series does not reach", () => {
		expect(resolveSelectionRhoArray(activity(density), [0, 99], 2)).toBeNull();
	});
});

describe("every analyze leg builds its calculator with a rho array", () => {
	/**
	 * Source-level, deliberately. The property is "no leg was forgotten", and
	 * the thing that makes a leg wrong is an omission — which no test of the
	 * leg's own module can observe, because the omitted argument simply is not
	 * there to assert on. Standard was the leg this case would have caught.
	 */
	const legs = [
		"../ve/renderStandardVe.ts",
		"../gpsLap/renderGpsLap.ts",
		"../outAndBack/renderOutAndBack.ts",
	];

	for (const leg of legs) {
		it(`${leg} passes rhoArray to createVeCalculator`, () => {
			const source = readFileSync(
				fileURLToPath(new URL(leg, import.meta.url)),
				"utf8",
			);

			const calculatorCalls = source.split("createVeCalculator({").length - 1;
			expect(calculatorCalls).toBeGreaterThan(0);
			expect(source.split(/\brhoArray:/).length - 1).toBe(calculatorCalls);
		});
	}
});
