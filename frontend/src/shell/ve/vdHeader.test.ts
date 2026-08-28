/**
 * @vitest-environment jsdom
 *
 * Regression coverage for the two virtual-distance header defects.
 *
 * 1. The readouts were interpolated once into the renderStandardVe template from
 *    the analyze-time VE result and never written again, so the trim sliders
 *    moved the curve and left the numbers behind (deferred-items.md "maintainer
 *    defect 1").
 * 2. A multi-lap selection showed `n/a`, which the maintainer rejected: the
 *    per-lap figures are real and are what the computation produces. And in
 *    stacked mode and GPS lap splitting mode the header markup did not exist at
 *    all, so the label was missing outright.
 */
import { beforeEach, describe, expect, it } from "vitest";
import {
	lapVirtualDistanceRows,
	renderVirtualDistanceHeader,
	segmentVirtualDistanceRows,
	updateCombinedVirtualDistanceHeader,
	VD_HEADER_ID,
	VD_NOT_APPLICABLE,
	virtualDistanceHeaderMarkup,
} from "./vdHeader";
import {
	buildVirtualDistanceFigure,
	computeVirtualDistanceTotals,
	type VirtualDistancePlotInput,
} from "../../plots/StandardPlotBuilders";
import { createPlotContext } from "../../plots/PlotContext";
import type { SegmentVeProfile } from "../../modes/analysis/types";

const LENGTH = 30;
// 1 Hz, ground 10 m/s, apparent air 9 m/s -> a steady -10% air-vs-ground gap.
const timestamps = Array.from({ length: LENGTH }, (_, i) => i);
const velocity = new Array(LENGTH).fill(10);
const windSpeed = new Array(LENGTH).fill(9);

function inputFor(trimStart: number, trimEnd: number): VirtualDistancePlotInput {
	return {
		context: createPlotContext(LENGTH, trimStart, trimEnd),
		timestamps,
		velocity,
		windSpeed,
	};
}

function setupDom() {
	document.body.innerHTML = virtualDistanceHeaderMarkup();
}

function readHeader() {
	return {
		air: document.getElementById("vdAirValue")?.textContent,
		ground: document.getElementById("vdGroundValue")?.textContent,
		diff: document.getElementById("vdDiffValue")?.textContent,
	};
}

function readLines() {
	return Array.from(
		document.querySelectorAll<HTMLElement>(".ve-metrics-compact__line"),
	).map((line) => line.textContent ?? "");
}

describe("computeVirtualDistanceTotals", () => {
	it("integrates only up to the trim end, so a shorter window is a shorter distance", () => {
		const wide = computeVirtualDistanceTotals(inputFor(2, 27));
		const narrow = computeVirtualDistanceTotals(inputFor(2, 15));

		expect(wide.groundKm).toBeGreaterThan(narrow.groundKm);
		expect(wide.airKm).toBeGreaterThan(narrow.airKm);
		// 25 s at 10 m/s = 250 m; 13 s at 10 m/s = 130 m.
		expect(wide.groundKm).toBeCloseTo(0.25, 6);
		expect(narrow.groundKm).toBeCloseTo(0.13, 6);
	});

	it("moving the trim START also moves the totals", () => {
		const early = computeVirtualDistanceTotals(inputFor(2, 20));
		const late = computeVirtualDistanceTotals(inputFor(10, 20));

		expect(late.groundKm).toBeLessThan(early.groundKm);
	});

	it("reports the same endpoint the plotted curve reaches", () => {
		const input = inputFor(2, 20);
		const totals = computeVirtualDistanceTotals(input);
		const figure = buildVirtualDistanceFigure(input);

		const airTrace = figure.data.find(
			(trace) => trace.name === "VD from Air Speed",
		) as { y: number[] };
		const groundTrace = figure.data.find(
			(trace) => trace.name === "VD from Ground Speed",
		) as { y: number[] };

		expect(totals.airKm).toBeCloseTo(airTrace.y[airTrace.y.length - 1], 9);
		expect(totals.groundKm).toBeCloseTo(
			groundTrace.y[groundTrace.y.length - 1],
			9,
		);
	});

	it("uses the ((air - ground) / ground) * 100 definition", () => {
		const totals = computeVirtualDistanceTotals(inputFor(2, 27));
		expect(totals.differencePercent).toBeCloseTo(-10, 6);
	});

	it("reports a zero difference rather than dividing by a zero ground distance", () => {
		const totals = computeVirtualDistanceTotals({
			context: createPlotContext(LENGTH, 2, 20),
			timestamps,
			velocity: new Array(LENGTH).fill(0),
			windSpeed,
		});
		expect(totals.differencePercent).toBe(0);
	});
});

describe("the single-lap VD header", () => {
	beforeEach(setupDom);

	it("track the trim window instead of staying frozen at analyze time", () => {
		updateCombinedVirtualDistanceHeader(inputFor(2, 27), 1);
		const wide = readHeader();

		updateCombinedVirtualDistanceHeader(inputFor(2, 15), 1);
		const narrow = readHeader();

		expect(wide.air).toBe("0.225 km");
		expect(wide.ground).toBe("0.250 km");
		expect(narrow.air).toBe("0.117 km");
		expect(narrow.ground).toBe("0.130 km");
		expect(narrow.ground).not.toBe(wide.ground);
	});

	it("signs the difference and colours it accordingly", () => {
		updateCombinedVirtualDistanceHeader(inputFor(2, 27), 1);
		expect(document.getElementById("vdDiffValue")!.textContent).toBe("-10.00%");
		expect(
			document
				.getElementById("vdDiffValue")!
				.classList.contains("ve-metrics-compact__value--negative"),
		).toBe(true);

		renderVirtualDistanceHeader([
			{
				label: null,
				totals: { airKm: 1, groundKm: 0.5, differencePercent: 100 },
			},
		]);
		expect(document.getElementById("vdDiffValue")!.textContent).toBe("+100.00%");
		expect(
			document
				.getElementById("vdDiffValue")!
				.classList.contains("ve-metrics-compact__value--positive"),
		).toBe(true);
	});

	it("carries no lap prefix, because there is only one lap to name", () => {
		updateCombinedVirtualDistanceHeader(inputFor(2, 27), 1);
		expect(readLines()).toEqual([
			"VD (Air):0.225 km | VD (Ground):0.250 km | Difference:-10.00%",
		]);
		expect(
			document.querySelector(".ve-metrics-compact__segment"),
		).toBeNull();
	});

	it("says n/a only when there is nothing at all to integrate", () => {
		renderVirtualDistanceHeader([]);
		const text = document.getElementById(VD_HEADER_ID)!.textContent!;
		expect(text).toContain(VD_NOT_APPLICABLE);
		expect(text).not.toContain("km");
	});
});

describe("the multi-lap VD header", () => {
	beforeEach(setupDom);

	it("shows one labelled line per lap instead of n/a", () => {
		renderVirtualDistanceHeader([
			{
				label: "Lap 2",
				totals: { airKm: 2.476, groundKm: 2.702, differencePercent: -8.36 },
			},
			{
				label: "Lap 3",
				totals: { airKm: 2.481, groundKm: 2.699, differencePercent: -8.08 },
			},
		]);

		const lines = readLines();
		expect(lines).toHaveLength(2);
		expect(lines[0]).toBe(
			"Lap 2: VD (Air):2.476 km | VD (Ground):2.702 km | Difference:-8.36%",
		);
		expect(lines[1]).toBe(
			"Lap 3: VD (Air):2.481 km | VD (Ground):2.699 km | Difference:-8.08%",
		);

		// The rejected answer, and the two false numbers it was rejecting.
		const text = document.getElementById(VD_HEADER_ID)!.textContent!;
		expect(text).not.toContain(VD_NOT_APPLICABLE);
		expect(text).not.toContain("0.000 km");
	});

	it("integrates each lap over its OWN trim window, not the concatenation", () => {
		// Two laps of 30 samples with a ten-minute wall-clock gap between them.
		// The concatenated integral would charge that gap at the first sample's
		// speed and report a distance nobody rode.
		const gap = 600;
		const profiles = [
			profileFor("Lap 1", 0, LENGTH),
			profileFor("Lap 2", LENGTH, LENGTH),
		];
		const normalized = {
			timestamps: [
				...timestamps,
				...timestamps.map((t) => t + LENGTH + gap),
			],
			velocity: [...velocity, ...velocity],
		};

		const rows = segmentVirtualDistanceRows(profiles, normalized);

		expect(rows.map((row) => row.label)).toEqual(["Lap 1", "Lap 2"]);
		// 29 s at 10 m/s each, and neither row has absorbed the 600 s gap.
		expect(rows[0].totals.groundKm).toBeCloseTo(0.29, 6);
		expect(rows[1].totals.groundKm).toBeCloseTo(0.29, 6);

		// The concatenated reading over the same data, for contrast: the gap
		// alone adds 6 km of "distance" that was never ridden.
		const concatenated = computeVirtualDistanceTotals({
			context: createPlotContext(LENGTH * 2, 0, LENGTH * 2 - 1),
			timestamps: normalized.timestamps,
			velocity: normalized.velocity,
			windSpeed: [...windSpeed, ...windSpeed],
		});
		expect(concatenated.groundKm).toBeGreaterThan(6);
	});

	it("honours each lap's own trim window", () => {
		const untrimmed = segmentVirtualDistanceRows(
			[profileFor("Lap 1", 0, LENGTH)],
			{ timestamps, velocity },
		);
		const trimmed = segmentVirtualDistanceRows(
			[profileFor("Lap 1", 0, LENGTH, { start: 5, end: 15 })],
			{ timestamps, velocity },
		);

		expect(trimmed[0].totals.groundKm).toBeLessThan(
			untrimmed[0].totals.groundKm,
		);
		// 10 s at 10 m/s.
		expect(trimmed[0].totals.groundKm).toBeCloseTo(0.1, 6);
	});

	it("reads the stacked/GPS-lap rows off the same series that plot draws", () => {
		const rows = lapVirtualDistanceRows([
			{
				label: "Lap 4",
				metrics: {
					distancesKm: [],
					powerWatts: [],
					apparentWindSpeedMps: [],
					virtualDistanceAirKm: [0, 1, 2.25],
					virtualDistanceGroundKm: [0, 1, 2.5],
				},
			},
		]);

		expect(rows[0].label).toBe("Lap 4");
		expect(rows[0].totals.airKm).toBe(2.25);
		expect(rows[0].totals.groundKm).toBe(2.5);
		expect(rows[0].totals.differencePercent).toBeCloseTo(-10, 6);
	});

	it("labels the combined integral wherever per-lap figures do not exist", () => {
		// `compare` and the transient initial paint integrate the whole selection
		// in one pass. The number may still be shown -- the maintainer rejected
		// n/a -- but never as if it were a lap.
		updateCombinedVirtualDistanceHeader(inputFor(2, 27), 3);

		const text = document.getElementById(VD_HEADER_ID)!.textContent!;
		expect(text).toContain("All 3 laps combined");
		expect(text).toContain("including the gaps between them");
		expect(readHeader().ground).toBe("0.250 km");
	});
});

function profileFor(
	label: string,
	offset: number,
	length: number,
	trim?: { start: number; end: number },
): SegmentVeProfile {
	return {
		segment: {
			key: label,
			label,
			range: { startIdx: offset, endIdx: offset + length - 1 },
			trim,
		},
		indices: Array.from({ length }, (_, i) => offset + i),
		supplementarySeries: {
			distancesKm: [],
			powerWatts: [],
			apparentWindSpeedMps: [...windSpeed],
			virtualDistanceAirKm: [],
			virtualDistanceGroundKm: [],
		},
	} as unknown as SegmentVeProfile;
}
