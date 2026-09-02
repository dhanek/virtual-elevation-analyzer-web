/**
 * The second reference line on the GPS-lap stacked figures ("both channels
 * shown; the import only picks the master"): the mean of each lap's
 * NON-master elevation channel, drawn beside the master mean and aligned to
 * it at the grid origin. No lap carrying a reference must reproduce the
 * existing figures exactly.
 */
import { describe, expect, it } from "vitest";
import type { LapVEProfile } from "./types";
import {
	buildStackedComparisonFigures,
	calculateMeanElevationProfile,
	calculateMeanReferenceProfile,
} from "./gpsLapPlots";

const SAMPLES = 30;

function makeLap(index: number, referenceSeries: number[] | null): LapVEProfile {
	const distances = Array.from(
		{ length: SAMPLES },
		(_, i) => (i / (SAMPLES - 1)) * 2,
	);
	return {
		range: null,
		lapNumber: index + 1,
		distances,
		virtualElevation: Array.from({ length: SAMPLES }, (_, i) => i * 0.5),
		virtualElevationCompare: Array.from(
			{ length: SAMPLES },
			(_, i) => -i * 0.25,
		),
		actualElevation: Array.from({ length: SAMPLES }, () => 100),
		referenceElevation: referenceSeries
			? { label: "Barometer", series: referenceSeries }
			: null,
		supplementarySeries: {} as LapVEProfile["supplementarySeries"],
		duration: 300,
		totalDistance: 2,
	};
}

describe("calculateMeanReferenceProfile", () => {
	it("is null when no lap carries a reference — single-channel rides", () => {
		expect(
			calculateMeanReferenceProfile([makeLap(0, null), makeLap(1, null)]),
		).toBeNull();
	});

	it("means the reference channel on the same grid as the master mean", () => {
		const laps = [
			makeLap(0, Array.from({ length: SAMPLES }, () => 50)),
			makeLap(1, Array.from({ length: SAMPLES }, () => 52)),
		];

		const master = calculateMeanElevationProfile(laps);
		const reference = calculateMeanReferenceProfile(laps);

		expect(reference).not.toBeNull();
		expect(reference!.label).toBe("Barometer");
		expect(reference!.distances).toEqual(master.distances);
		// Two flat laps at 50 and 52 m: the mean is 51 m everywhere.
		for (const value of reference!.elevation) {
			expect(value).toBeCloseTo(51, 9);
		}
	});
});

describe("the stacked figures with a reference", () => {
	it("draw the aligned reference mean right after the master mean", () => {
		const laps = [
			makeLap(0, Array.from({ length: SAMPLES }, () => 50)),
			makeLap(1, Array.from({ length: SAMPLES }, () => 50)),
		];
		const master = calculateMeanElevationProfile(laps);
		const reference = calculateMeanReferenceProfile(laps);

		const figures = buildStackedComparisonFigures(laps, master, reference);

		const names = figures.ve.data.map((trace: { name: string }) => trace.name);
		expect(names[0]).toBe("Mean Elevation");
		expect(names[1]).toBe("Mean Barometer (aligned)");
		// Aligned to the master mean at the origin: flat 100 m master, flat
		// 50 m reference => the drawn reference sits exactly on 100 m.
		const trace = figures.ve.data[1] as { y: number[] };
		expect(trace.y[0]).toBeCloseTo(master.elevation[0], 9);
	});

	it("draw exactly the figures they always drew when the reference is null", () => {
		const laps = [makeLap(0, null), makeLap(1, null)];
		const master = calculateMeanElevationProfile(laps);

		const bare = buildStackedComparisonFigures(laps, master);
		const explicit = buildStackedComparisonFigures(laps, master, null);

		expect(explicit.ve.data).toEqual(bare.ve.data);
		expect(
			bare.ve.data.map((trace: { name: string }) => trace.name)[0],
		).toBe("Mean Elevation");
		expect(bare.ve.data).toHaveLength(1 + 2 * laps.length);
	});
});
