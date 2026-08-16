/**
 * THE FOUR INTERPOLATION WALKS, PINNED (the D3 guard the golden ride cannot be).
 *
 * `calculateMeanElevationProfile` and `calculateGpsLapStats` contain four
 * bracket searches that D3 rewrites from "rescan the whole reference array from
 * index 0 for every point" to a forward two-pointer walk. Three things make the
 * golden literals insufficient on their own:
 *
 *  1. R² IS CLAMPED. `totalR2 += Math.max(0, r2)` — and on the golden fixture
 *     every lap's raw R² is negative, so `meanR2` is 0 in all four golden rows.
 *     The `sumSquaredTotal` loop's ONLY output is R². On that fixture the loop
 *     could return anything at all and no literal would move. The laps here are
 *     built so R² is comfortably positive and the loop is observable.
 *
 *  2. THE FALLBACKS ARE REAL BEHAVIOUR, not dead branches. When no bracket is
 *     found the stats loops leave `interpMeanElev` at 0 — a 1000 m residual on
 *     real elevations, not a small error — and the mean-profile loop falls back
 *     to `lowIdx = 0`, extrapolating from the first two points. A two-pointer
 *     walk that "tidies" either one changes numbers on inputs the golden ride
 *     happens not to contain.
 *
 *  3. LAPS ARE NOT ALL THE SAME LENGTH. A short lap must contribute to only the
 *     part of the reference grid it covers (`continue` past its end), which is
 *     what makes the sample counts per grid point uneven.
 *
 * Every literal below was captured from the linear-rescan implementation before
 * the rewrite, in the same commit as the golden aggregation block.
 */
import { describe, expect, it } from "vitest";
import {
	calculateGpsLapStats,
	calculateMeanElevationProfile,
} from "./gpsLapPlots";
import type { LapVEProfile } from "./types";

const PRECISION = 12;

function lap(
	lapNumber: number,
	distances: number[],
	actualElevation: number[],
	virtualElevation: number[],
): LapVEProfile {
	return {
		lapNumber,
		distances,
		actualElevation,
		virtualElevation,
		supplementarySeries: null,
		duration: 60,
		totalDistance: distances[distances.length - 1],
	} as unknown as LapVEProfile;
}

/**
 * Three laps of DIFFERENT lengths and DIFFERENT sample spacing, with elevations
 * that vary enough for R² to be positive. Lap 3 stops at 0.6 km, so the top
 * 40% of the reference grid is averaged over two laps and not three.
 */
function unevenLaps(): LapVEProfile[] {
	return [
		lap(
			1,
			[0, 0.25, 0.5, 0.75, 1.0],
			[100, 108, 121, 112, 103],
			[100.4, 107.6, 121.9, 111.5, 103.8],
		),
		lap(
			2,
			[0, 0.1, 0.35, 0.62, 0.9, 1.0],
			[100, 104, 115, 118, 106, 102],
			[99.6, 104.7, 114.2, 118.8, 105.4, 102.6],
		),
		lap(3, [0, 0.3, 0.6], [100, 112, 116], [100.9, 111.3, 116.7]),
	];
}

describe("the GPS-lap interpolation walks", () => {
	it("builds the mean elevation profile over unevenly sampled laps", () => {
		const mean = calculateMeanElevationProfile(unevenLaps());

		expect(mean.distances).toHaveLength(101);
		expect(mean.elevation).toHaveLength(101);

		// Grid endpoints and spacing.
		expect(mean.distances[0]).toBeCloseTo(0, PRECISION);
		expect(mean.distances[100]).toBeCloseTo(1, PRECISION);

		// Captured from the linear-rescan implementation.
		expect(mean.elevation[0]).toBeCloseTo(100, PRECISION);
		expect(mean.elevation[25]).toBeCloseTo(109.53333333333335, PRECISION);
		// Past lap 3's end (0.6 km): the average is over two laps, not three.
		expect(mean.elevation[61]).toBeCloseTo(117.46444444444444, PRECISION);
		expect(mean.elevation[100]).toBeCloseTo(102.5, PRECISION);
		// Every interpolated sample, so moving any one of them is visible.
		expect(mean.elevation.reduce((s, v) => s + v, 0)).toBeCloseTo(
			11151.44814814815,
			PRECISION,
		);
	});

	it("computes stats with a POSITIVE R2, so the sumSquaredTotal walk is visible", () => {
		const laps = unevenLaps();
		const mean = calculateMeanElevationProfile(laps);
		const stats = calculateGpsLapStats(laps, mean);

		// The point of this file: unclamped, so the second walk is observable.
		// On the golden ride this number is 0 and pins nothing.
		expect(stats.meanR2).toBeGreaterThan(0.5);

		expect(stats.meanR2).toBeCloseTo(0.9431412544827812, PRECISION);
		expect(stats.meanRMSE).toBeCloseTo(1.4462518117695797, PRECISION);
		expect(stats.avgVeGain).toBeCloseTo(7.399999999999996, PRECISION);
		expect(stats.avgActualGain).toBeCloseTo(2.5, PRECISION);
		expect(stats.closingError).toBeCloseTo(22.19999999999999, PRECISION);
		expect(stats.lapClosingErrors).toHaveLength(3);
	});

	it("keeps the no-bracket fallback: an out-of-range point interpolates to 0", () => {
		// A lap whose distances run PAST the mean profile's last reference
		// distance. The stats loops find no bracket and leave interpMeanElev at
		// 0, producing a residual of the full calibrated VE. That is the shipped
		// behaviour; a two-pointer walk that clamps to the last segment instead
		// would silently change these numbers.
		const laps = [lap(1, [0, 0.5, 1.0], [100, 110, 105], [100, 110, 105])];
		const mean = { distances: [0, 0.25, 0.5], elevation: [100, 105, 110] };

		const stats = calculateGpsLapStats(laps, mean);

		// ~60 m of RMSE, entirely produced by the interpolate-to-zero fallback.
		expect(stats.meanRMSE).toBeCloseTo(60.6217782649107, PRECISION);
		expect(stats.meanR2).toBeCloseTo(0, PRECISION);
	});

	it("keeps the lowIdx=0 extrapolation when a target sits below a lap's first sample", () => {
		// Lap 2 starts at 0.2 km, so reference distances below that find no
		// bracket and fall back to lowIdx = 0 — extrapolating backwards from the
		// first two samples rather than skipping.
		const laps = [
			lap(1, [0, 0.5, 1.0], [100, 110, 105], [100, 110, 105]),
			lap(2, [0.2, 0.6, 1.0], [120, 128, 124], [120, 128, 124]),
		];

		const mean = calculateMeanElevationProfile(laps);

		// 108 = mean of lap 1's 100 and lap 2's BACKWARD extrapolation to 116
		// (120 + -0.5 x 8). Not a skip, not a clamp to 120 — extrapolation.
		expect(mean.elevation[0]).toBeCloseTo(108, PRECISION);
		expect(mean.elevation[10]).toBeCloseTo(110, PRECISION);
	});

	it("handles a non-monotonic distance series the way a fresh rescan does", () => {
		// Bad GPS can make cumulative distance step backwards. A forward-only
		// pointer would sail past the bracket a later, smaller target needs; the
		// original rescans from 0 every time and does not.
		const laps = [
			lap(
				1,
				[0, 0.4, 0.3, 0.7, 1.0],
				[100, 112, 108, 118, 104],
				[100, 112, 108, 118, 104],
			),
		];

		const mean = calculateMeanElevationProfile(laps);
		const stats = calculateGpsLapStats(laps, mean);

		expect(mean.elevation.reduce((s, v) => s + v, 0)).toBeCloseTo(
			11100.25,
			PRECISION,
		);
		expect(stats.meanRMSE).toBeCloseTo(0.4472135954999579, PRECISION);
	});
});
