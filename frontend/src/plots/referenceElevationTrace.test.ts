/**
 * The second elevation channel on the Standard VE figures ("both channels
 * shown; the import only picks the master"). What is pinned here:
 *
 *  - absent reference => the exact trace lists the figures have always had,
 *    so single-channel rides are byte-identical to phase 1;
 *  - present reference => ONE extra named trace per window region, dashed
 *    grey, ALIGNED to the master at the first finite trimmed pair — the
 *    barometer's datum is calibration-dependent and tens of metres off the
 *    DEM's, and an unaligned overlay would double the y-range.
 */
import { describe, expect, it } from "vitest";
import { createPlotContext } from "./PlotContext";
import {
	buildVirtualElevationComparisonFigures,
	buildVirtualElevationFigures,
} from "./StandardPlotBuilders";

const N = 6;
const CONTEXT = createPlotContext(N, 0, N - 1);
const VE = [100, 101, 102, 103, 104, 105];
const ACTUAL = [100, 101.5, 102, 103.5, 104, 105.5];
const REFERENCE = [50, 51, 52, 53, 54, 55]; // datum 50 m below the master

function names(data: Array<Record<string, unknown>>): unknown[] {
	return data.map((trace) => trace.name);
}

describe("buildVirtualElevationFigures", () => {
	it("draws no reference trace when none is given — phase-1 exactly", () => {
		const figures = buildVirtualElevationFigures({
			context: CONTEXT,
			virtualElevation: VE,
			actualElevation: ACTUAL,
			cdaLabel: "0.300",
			crrLabel: "0.0050",
		});

		expect(names(figures.elevation.data)).toEqual([
			"Virtual Elevation",
			"Actual Elevation",
		]);
	});

	it("draws the reference dashed, named by channel, after the actual trace", () => {
		const figures = buildVirtualElevationFigures({
			context: CONTEXT,
			virtualElevation: VE,
			actualElevation: ACTUAL,
			referenceElevation: { label: "Barometer", series: REFERENCE },
			cdaLabel: "0.300",
			crrLabel: "0.0050",
		});

		expect(names(figures.elevation.data)).toEqual([
			"Virtual Elevation",
			"Actual Elevation",
			"Barometer (aligned)",
		]);
		const reference = figures.elevation.data[2] as {
			y: number[];
			line: { dash: string };
		};
		expect(reference.line.dash).toBe("dash");
		// Aligned at the first trimmed sample: the 50 m datum gap is gone and
		// only the shape difference remains.
		expect(reference.y).toEqual([100, 101, 102, 103, 104, 105]);
	});

	it("keeps the residuals figure reference-free — residuals are master-only", () => {
		const bare = buildVirtualElevationFigures({
			context: CONTEXT,
			virtualElevation: VE,
			actualElevation: ACTUAL,
			cdaLabel: "0.300",
			crrLabel: "0.0050",
		});
		const withReference = buildVirtualElevationFigures({
			context: CONTEXT,
			virtualElevation: VE,
			actualElevation: ACTUAL,
			referenceElevation: { label: "Barometer", series: REFERENCE },
			cdaLabel: "0.300",
			crrLabel: "0.0050",
		});

		expect(withReference.residuals.data).toEqual(bare.residuals.data);
	});

	it("adds a low-opacity reference slice per trimmed-context region", () => {
		const trimmed = createPlotContext(N, 2, 3);
		const figures = buildVirtualElevationFigures({
			context: trimmed,
			virtualElevation: VE,
			actualElevation: ACTUAL,
			referenceElevation: { label: "DEM", series: REFERENCE },
			cdaLabel: "0.300",
			crrLabel: "0.0050",
		});

		const referenceTraces = figures.elevation.data.filter((trace) =>
			String(trace.name).startsWith("DEM"),
		) as Array<{ name: string; opacity?: number; showlegend?: boolean }>;
		expect(referenceTraces.map((trace) => trace.name)).toEqual([
			"DEM (trimmed)",
			"DEM (aligned)",
			"DEM (trimmed)",
		]);
		for (const trace of referenceTraces) {
			if (trace.name === "DEM (trimmed)") {
				expect(trace.opacity).toBe(0.2);
				expect(trace.showlegend).toBe(false);
			}
		}
	});

	it("anchors on the first FINITE pair when the window opens on a NaN", () => {
		const holed = [Number.NaN, 51, 52, 53, 54, 55];
		const figures = buildVirtualElevationFigures({
			context: CONTEXT,
			virtualElevation: VE,
			actualElevation: ACTUAL,
			referenceElevation: { label: "Barometer", series: holed },
			cdaLabel: "0.300",
			crrLabel: "0.0050",
		});

		const reference = figures.elevation.data[2] as { y: number[] };
		// Offset from the i=1 pair: 101.5 - 51 = 50.5.
		expect(reference.y[1]).toBeCloseTo(101.5, 12);
		expect(Number.isNaN(reference.y[0])).toBe(true);
	});
});

describe("buildVirtualElevationComparisonFigures", () => {
	const BASE = {
		context: CONTEXT,
		virtualElevationFit: VE,
		virtualElevationConstant: VE.map((value) => value + 1),
		actualElevation: ACTUAL,
	};

	it("keeps the six pinned traces at their indices when no reference exists", () => {
		const figures = buildVirtualElevationComparisonFigures(BASE);

		expect(names(figures.elevation.data)).toEqual([
			"VE (FIT Air Speed)",
			"Actual Elevation",
			"VE (Constant Wind)",
		]);
	});

	it("appends the aligned reference as a fourth elevation trace", () => {
		const figures = buildVirtualElevationComparisonFigures({
			...BASE,
			referenceElevation: { label: "DEM", series: REFERENCE },
		});

		expect(names(figures.elevation.data)).toEqual([
			"VE (FIT Air Speed)",
			"Actual Elevation",
			"VE (Constant Wind)",
			"DEM (aligned)",
		]);
		const reference = figures.elevation.data[3] as { y: number[] };
		expect(reference.y[0]).toBeCloseTo(ACTUAL[0], 12);
	});
});
