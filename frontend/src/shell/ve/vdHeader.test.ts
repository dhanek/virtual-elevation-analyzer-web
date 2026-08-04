/**
 * @vitest-environment jsdom
 *
 * Regression coverage for the frozen VD header.
 *
 * `#vdAirValue` / `#vdGroundValue` / `#vdDiffValue` were interpolated once into
 * the renderStandardVe template from the analyze-time VE result and never
 * written again, so the trim sliders moved the curve and left the numbers
 * behind. See deferred-items.md "maintainer defect 1".
 */
import { beforeEach, describe, expect, it } from "vitest";
import {
	renderVirtualDistanceHeader,
	updateVirtualDistanceHeader,
	VD_NOT_APPLICABLE,
} from "./vdHeader";
import {
	buildVirtualDistanceFigure,
	computeVirtualDistanceTotals,
	type VirtualDistancePlotInput,
} from "../../plots/StandardPlotBuilders";
import { createPlotContext } from "../../plots/PlotContext";

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
	document.body.innerHTML = `
        <div class="ve-metrics-compact">
            <span id="vdAirValue"></span>
            <span id="vdGroundValue"></span>
            <span id="vdDiffValue" class="ve-metrics-compact__value"></span>
        </div>
    `;
}

function readHeader() {
	return {
		air: document.getElementById("vdAirValue")?.textContent,
		ground: document.getElementById("vdGroundValue")?.textContent,
		diff: document.getElementById("vdDiffValue")?.textContent,
	};
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

describe("the VD header spans", () => {
	beforeEach(setupDom);

	it("track the trim window instead of staying frozen at analyze time", () => {
		updateVirtualDistanceHeader(inputFor(2, 27), 1);
		const wide = readHeader();

		updateVirtualDistanceHeader(inputFor(2, 15), 1);
		const narrow = readHeader();

		expect(wide.air).toBe("0.225 km");
		expect(wide.ground).toBe("0.250 km");
		expect(narrow.air).toBe("0.117 km");
		expect(narrow.ground).toBe("0.130 km");
		expect(narrow.ground).not.toBe(wide.ground);
	});

	it("signs the difference and colours it accordingly", () => {
		updateVirtualDistanceHeader(inputFor(2, 27), 1);
		const diffSpan = document.getElementById("vdDiffValue")!;

		expect(diffSpan.textContent).toBe("-10.00%");
		expect(diffSpan.classList.contains("ve-metrics-compact__value--negative")).toBe(
			true,
		);
		expect(diffSpan.classList.contains("ve-metrics-compact__value--positive")).toBe(
			false,
		);

		renderVirtualDistanceHeader({
			airKm: 1,
			groundKm: 0.5,
			differencePercent: 100,
		});
		expect(diffSpan.textContent).toBe("+100.00%");
		expect(diffSpan.classList.contains("ve-metrics-compact__value--positive")).toBe(
			true,
		);
	});

	it("says n/a for a multi-lap selection rather than showing a false number", () => {
		updateVirtualDistanceHeader(inputFor(2, 27), 3);
		const header = readHeader();

		expect(header.air).toBe(VD_NOT_APPLICABLE);
		expect(header.ground).toBe(VD_NOT_APPLICABLE);
		// Specifically NOT the stored zeros, and specifically not the
		// concatenated integral.
		expect(header.air).not.toContain("0.000");
		expect(header.ground).not.toContain("0.000");
		expect(header.diff).not.toContain("%");
		expect(
			document
				.getElementById("vdDiffValue")!
				.classList.contains("ve-metrics-compact__value--negative"),
		).toBe(false);
	});
});
