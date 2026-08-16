/**
 * @vitest-environment jsdom
 *
 * EVERY GPS-LAP PLOT REDRAWS WITH `Plotly.react` (D4).
 *
 * The VE and residual plots already did. The wind, power and VD plots called
 * `Plotly.newPlot`, which destroys the graph and rebuilds it from scratch --
 * paid on every slider update while that tab is open, which is exactly when the
 * user is dragging and watching.
 *
 * WHAT THIS TEST CAN AND CANNOT SEE. It cannot see the saving: Plotly is loaded
 * from a CDN at runtime, is not an npm dependency, and jsdom supplies neither
 * the SVG text metrics nor the layout boxes it needs, so there is no honest
 * headless number for the redraw cost. What it CAN see, and pins, is the choice
 * of call -- the thing that silently regresses when someone adds a fourth plot
 * by copying the old pattern. The cost itself is the maintainer's browser
 * observation and the D-16 trace.
 *
 * A stub that provided only `react` would make this vacuous: any renderer would
 * be forced onto it. Both methods are stubbed, so choosing `newPlot` is
 * available and simply not taken.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
	renderGpsLapPowerPlot,
	renderGpsLapVdPlot,
	renderGpsLapVEPlots,
	renderGpsLapWindPlot,
} from "./gpsLapPlots";
import { virtualDistanceHeaderMarkup } from "../ve/vdHeader";
import type { LapVEProfile } from "./types";

const calls = { react: [] as string[], newPlot: [] as string[] };

function lap(lapNumber: number): LapVEProfile {
	return {
		lapNumber,
		distances: [0, 0.5, 1],
		virtualElevation: [0, 1, 2],
		actualElevation: [0, 1, 2],
		supplementarySeries: {
			distancesKm: [0, 0.5, 1],
			powerWatts: [200, 210, 220],
			apparentWindSpeedMps: [9, 9, 9],
			virtualDistanceAirKm: [0, 0.4, 0.9],
			virtualDistanceGroundKm: [0, 0.5, 1],
		},
		duration: 60,
		totalDistance: 1,
	} as LapVEProfile;
}

describe("GPS-lap plots redraw by diffing, not by teardown", () => {
	beforeEach(() => {
		calls.react.length = 0;
		calls.newPlot.length = 0;
		document.body.innerHTML = `
            <div id="gpsLapVePlot"></div>
            <div id="gpsLapResidualPlot"></div>
            <div id="gpsLapWindPlot"></div>
            <div id="gpsLapPowerPlot"></div>
            <div id="gpsLapVdPlot"></div>
            <span id="gpsLapR2Value"></span>
            <span id="gpsLapRmseValue"></span>
            <span id="gpsLapClosingErrorValue"></span>
            <div id="gpsLapSummaryTable"></div>
            ${virtualDistanceHeaderMarkup()}
        `;
		// BOTH methods available, so the renderers have a real choice.
		(window as unknown as { Plotly: unknown }).Plotly = {
			react: vi.fn((id: string) => calls.react.push(id)),
			newPlot: vi.fn((id: string) => calls.newPlot.push(id)),
		};
	});

	it("uses react for all five plots and newPlot for none", () => {
		const laps = [lap(1), lap(2)];
		const mean = { distances: [0, 0.5, 1], elevation: [0, 1, 2] };

		renderGpsLapVEPlots(laps, mean, {
			meanR2: 0.9,
			meanRMSE: 1,
			closingError: 2,
		});
		renderGpsLapWindPlot(laps);
		renderGpsLapPowerPlot(laps);
		renderGpsLapVdPlot(laps);

		expect(calls.newPlot).toEqual([]);
		expect(calls.react).toEqual([
			"gpsLapVePlot",
			"gpsLapResidualPlot",
			"gpsLapWindPlot",
			"gpsLapPowerPlot",
			"gpsLapVdPlot",
		]);
	});

	it("still fills the VD header, which is drawn alongside the VD plot", () => {
		// The VD renderer writes a header as well as a figure. Switching its draw
		// call must not disturb that -- the header was missing outright once
		// already (gpsLapVdHeader.test.ts).
		renderGpsLapVdPlot([lap(3), lap(4)]);

		const lines = document.querySelectorAll(".ve-metrics-compact__line");
		expect(lines).toHaveLength(2);
	});
});
