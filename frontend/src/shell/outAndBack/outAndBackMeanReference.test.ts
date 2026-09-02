/**
 * The second reference line on the out-and-back figures — the mean of the
 * NON-master elevation channel over the same mirrored grid as the master
 * mean, aligned to it at the origin, identical in both VE figures under
 * compare. Sections without a reference must reproduce the existing figures
 * exactly.
 */
import { describe, expect, it } from "vitest";
import type { OutAndBackVEProfile } from "./types";
import {
	buildOutAndBackComparisonFigures,
	calculateOutAndBackMeanElevation,
	calculateOutAndBackMeanReference,
} from "./outAndBackPlots";

const SAMPLES = 30;

function makeSection(
	index: number,
	referenceMetres: number | null,
): OutAndBackVEProfile {
	const distances = Array.from(
		{ length: SAMPLES },
		(_, i) => (i / (SAMPLES - 1)) * 2,
	);
	const actual = Array.from({ length: SAMPLES }, () => 100);
	const reference = referenceMetres === null
		? null
		: {
				label: "DEM" as const,
				series: Array.from({ length: SAMPLES }, () => referenceMetres),
			};
	return {
		outboundRange: null,
		inboundRange: null,
		sectionNumber: index + 1,
		outboundDistances: distances,
		outboundVE: Array.from({ length: SAMPLES }, (_, i) => i * 0.5),
		outboundVECompare: Array.from({ length: SAMPLES }, (_, i) => -i * 0.25),
		outboundActualElevation: actual,
		outboundReferenceElevation: reference,
		outboundSeries: null,
		inboundDistances: distances.slice(),
		inboundVE: Array.from({ length: SAMPLES }, (_, i) => 40 - i * 0.3),
		inboundVECompare: Array.from({ length: SAMPLES }, (_, i) => 7 + i * 0.4),
		inboundActualElevation: actual.slice(),
		inboundReferenceElevation: reference,
		inboundSeries: null,
		outboundDuration: 120,
		inboundDuration: 130,
		totalDistance: 4,
	};
}

describe("calculateOutAndBackMeanReference", () => {
	it("is null when no leg carries a reference — single-channel rides", () => {
		expect(
			calculateOutAndBackMeanReference([makeSection(0, null)]),
		).toBeNull();
	});

	it("means the reference legs on the master mean's own grid", () => {
		const sections = [makeSection(0, 50), makeSection(1, 52)];

		const master = calculateOutAndBackMeanElevation(sections);
		const reference = calculateOutAndBackMeanReference(sections);

		expect(reference).not.toBeNull();
		expect(reference!.label).toBe("DEM");
		expect(reference!.distances).toEqual(master.distances);
		for (const value of reference!.elevation) {
			expect(value).toBeCloseTo(51, 9);
		}
	});
});

describe("the comparison figures with a reference", () => {
	it("draw the aligned reference mean in BOTH VE figures", () => {
		const sections = [makeSection(0, 50)];
		const master = calculateOutAndBackMeanElevation(sections);
		const reference = calculateOutAndBackMeanReference(sections);

		const figures = buildOutAndBackComparisonFigures(
			sections,
			master,
			reference,
		);

		for (const data of [figures.ve.data, figures.compareVe!.data]) {
			const names = data.map((trace: { name: string }) => trace.name);
			expect(names[0]).toBe("Mean Actual Elevation");
			expect(names[1]).toBe("Mean DEM (aligned)");
			const trace = data[1] as { y: number[] };
			expect(trace.y[0]).toBeCloseTo(master.elevation[0], 9);
		}
	});

	it("draw exactly the figures they always drew when the reference is null", () => {
		const sections = [makeSection(0, null)];
		const master = calculateOutAndBackMeanElevation(sections);

		const bare = buildOutAndBackComparisonFigures(sections, master);
		const explicit = buildOutAndBackComparisonFigures(sections, master, null);

		expect(explicit.ve.data).toEqual(bare.ve.data);
		expect(
			bare.ve.data.map((trace: { name: string }) => trace.name)[0],
		).toBe("Mean Actual Elevation");
	});
});
