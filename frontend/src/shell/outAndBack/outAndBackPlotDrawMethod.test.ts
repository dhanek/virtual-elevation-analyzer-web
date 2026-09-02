/**
 * @vitest-environment jsdom
 *
 * EVERY OUT-AND-BACK PLOT REDRAWS WITH `Plotly.react` (bundle D).
 *
 * GPS-lap made this move already and is pinned by `gpsLapPlotDrawMethod.test.ts`;
 * out-and-back kept `newPlot` on all seven of its draw calls. `newPlot` destroys
 * the graph and rebuilds it from scratch, and these are the plots redrawn on
 * every slider update — out-and-back computes 2N segments per update, so it is
 * the mode where the teardown costs most.
 *
 * WHAT THIS TEST CAN AND CANNOT SEE. It cannot see the saving: jsdom supplies
 * neither the SVG text metrics nor the layout boxes Plotly needs, so there is no
 * honest headless number for the redraw cost. What it CAN see, and pins, is the
 * choice of call — the thing that silently regresses when someone adds an
 * eighth plot by copying the old pattern.
 *
 * A stub that provided only `react` would make this vacuous: any renderer would
 * be forced onto it. Both methods are stubbed, so choosing `newPlot` is
 * available and simply not taken.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
	renderOutAndBackPlots,
	renderOutAndBackPowerPlot,
	renderOutAndBackVdPlot,
	renderOutAndBackWindPlot,
} from "./outAndBackPlots";
import { virtualDistanceHeaderMarkup } from "../ve/vdHeader";
import type { SegmentSupplementarySeries } from "../../analysis/SegmentSupplementarySeries";
import type { OutAndBackVEProfile } from "./types";

const calls = { react: [] as string[], newPlot: [] as string[] };
const resized: string[] = [];

function leg(): SegmentSupplementarySeries {
	return {
		distancesKm: [0, 0.5, 1],
		powerWatts: [200, 210, 220],
		apparentWindSpeedMps: [9, 9, 9],
		virtualDistanceAirKm: [0, 0.4, 0.9],
		virtualDistanceGroundKm: [0, 0.5, 1],
	};
}

/** `compare` decides which figure pair `renderOutAndBackPlots` builds. */
function section(
	sectionNumber: number,
	compare: boolean,
): OutAndBackVEProfile {
	return {
		sectionNumber,
		outboundRange: { startIdx: 0, endIdx: 2 },
		inboundRange: { startIdx: 0, endIdx: 2 },
		outboundDistances: [0, 0.5, 1],
		outboundVE: [0, 1, 2],
		outboundVECompare: compare ? [0, 1.1, 2.1] : null,
		outboundActualElevation: [0, 1, 2],
		outboundSeries: leg(),
		inboundDistances: [0, 0.5, 1],
		inboundVE: [0, 1, 2],
		inboundVECompare: compare ? [0, 0.9, 1.9] : null,
		inboundActualElevation: [0, 1, 2],
		inboundSeries: leg(),
		outboundDuration: 60,
		inboundDuration: 60,
		totalDistance: 2,
	};
}

const meanElevation = { distances: [0, 0.5, 1], elevation: [0, 1, 2] };

function plotlyStub() {
	return {
		// BOTH methods available, so the renderers have a real choice.
		react: vi.fn((id: string) => calls.react.push(id)),
		newPlot: vi.fn((id: string) => calls.newPlot.push(id)),
		Plots: {
			resize: vi.fn((gd: Element) => {
				resized.push((gd as HTMLElement).id);
				return Promise.resolve();
			}),
		},
	};
}

describe("out-and-back plots redraw by diffing, not by teardown", () => {
	beforeEach(() => {
		calls.react.length = 0;
		calls.newPlot.length = 0;
		resized.length = 0;
		document.body.innerHTML = `
            <div id="oabVePlot"></div>
            <div id="oabVeResidualsPlot"></div>
            <div id="oabCompareView" class="hidden">
                <div id="oabVeComparePlot" class="js-plotly-plot"></div>
                <div id="oabVeCompareResidualsPlot" class="js-plotly-plot"></div>
            </div>
            <div id="oabWindPlot"></div>
            <div id="oabPowerPlot"></div>
            <div id="oabVdPlot"></div>
            <div id="oabClosingErrors"></div>
            ${virtualDistanceHeaderMarkup()}
        `;
		(window as unknown as { Plotly: unknown }).Plotly = plotlyStub();
	});

	it("uses react for the wind, power and VD tab plots and newPlot for none", () => {
		const profiles = [section(1, false), section(2, false)];

		renderOutAndBackWindPlot(profiles);
		renderOutAndBackPowerPlot(profiles);
		renderOutAndBackVdPlot(profiles);

		expect(calls.newPlot).toEqual([]);
		expect(calls.react).toEqual(["oabWindPlot", "oabPowerPlot", "oabVdPlot"]);
	});

	it("uses react for the VE and residual plots and newPlot for none", () => {
		const Plotly = (window as unknown as { Plotly: unknown }).Plotly;
		renderOutAndBackPlots(Plotly, [section(1, false), section(2, false)], meanElevation);

		expect(calls.newPlot).toEqual([]);
		expect(calls.react).toEqual(["oabVePlot", "oabVeResidualsPlot"]);
	});

	it("uses react for the two compare plots and newPlot for none", () => {
		const Plotly = (window as unknown as { Plotly: unknown }).Plotly;
		renderOutAndBackPlots(Plotly, [section(1, true), section(2, true)], meanElevation);

		expect(calls.newPlot).toEqual([]);
		expect(calls.react).toEqual([
			"oabVePlot",
			"oabVeResidualsPlot",
			"oabVeComparePlot",
			"oabVeCompareResidualsPlot",
		]);
	});

	it("re-measures the compare view it just unhid, which react does not do itself", () => {
		// `newPlot` measured the container on every call, so unhiding first was
		// the whole fix. `react` reuses the width the graph already carries, and
		// the compare view is hidden whenever the selection is not a comparison
		// -- so the unhide has to be followed by an explicit resize.
		const Plotly = (window as unknown as { Plotly: unknown }).Plotly;
		renderOutAndBackPlots(Plotly, [section(1, true)], meanElevation);

		expect(document.getElementById("oabCompareView")!.classList.contains("hidden")).toBe(false);
		expect(resized).toEqual(["oabVeComparePlot", "oabVeCompareResidualsPlot"]);
	});

	it("does not resize anything when the compare view stays hidden", () => {
		// Resizing a `display: none` container is what pins a zero width in the
		// first place, so the single-source path must leave it alone.
		const Plotly = (window as unknown as { Plotly: unknown }).Plotly;
		renderOutAndBackPlots(Plotly, [section(1, false)], meanElevation);

		expect(document.getElementById("oabCompareView")!.classList.contains("hidden")).toBe(true);
		expect(resized).toEqual([]);
	});

	it("still fills the VD header, which is drawn alongside the VD plot", () => {
		// The VD renderer writes a header as well as a figure. Switching its draw
		// call must not disturb that -- the header was missing outright once
		// already (outAndBackVdHeader.test.ts).
		renderOutAndBackVdPlot([section(3, false), section(4, false)]);

		expect(document.querySelectorAll(".ve-metrics-compact__line")).toHaveLength(2);
	});
});
