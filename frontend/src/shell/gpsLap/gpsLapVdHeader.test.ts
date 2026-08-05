/**
 * @vitest-environment jsdom
 *
 * Regression coverage for the missing VD header in the GPS-lap sidebar.
 *
 * That sidebar serves BOTH genuine GPS lap splitting and the Standard "Stacked"
 * view, and its VD tab rendered a bare `#gpsLapVdPlot` with nothing above it. So
 * in both modes the maintainer saw no label at all -- not a stale number, not
 * `n/a`, nothing. The Standard-only `vdHeader.ts` work never reached here.
 *
 * Two assertions, because either alone is vacuous: a renderer writing into a
 * container the template does not emit fails silently, and a template that emits
 * a container nothing writes to shows an empty box.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { buildGpsLapVeAnalysisTemplate } from "./renderGpsLap";
import { renderGpsLapVdPlot } from "./gpsLapPlots";
import { VD_HEADER_ID, virtualDistanceHeaderMarkup } from "../ve/vdHeader";
import type { LapVEProfile } from "./types";

function lap(
	lapNumber: number,
	airKm: number,
	groundKm: number,
): LapVEProfile {
	return {
		lapNumber,
		distances: [0, 1],
		virtualElevation: [0, 1],
		actualElevation: [0, 1],
		supplementarySeries: {
			distancesKm: [0, groundKm],
			powerWatts: [200, 200],
			apparentWindSpeedMps: [9, 9],
			virtualDistanceAirKm: [0, airKm],
			virtualDistanceGroundKm: [0, groundKm],
		},
		duration: 60,
		totalDistance: groundKm,
	} as LapVEProfile;
}

describe("the GPS-lap / stacked VD header", () => {
	beforeEach(() => {
		document.body.innerHTML = `
            ${virtualDistanceHeaderMarkup()}
            <div id="gpsLapVdPlot"></div>
        `;
		(window as unknown as { Plotly: unknown }).Plotly = { newPlot: vi.fn() };
	});

	it("is emitted by the sidebar template, above the plot", () => {
		const html = buildGpsLapVeAnalysisTemplate({
			params: {} as never,
			hasWindSpeed: false,
			hasConstantWind: false,
			showWindTab: false,
			showVirtualDistanceTab: true,
			selectedWindSource: "none",
			currentAirSpeedCalibrationValue: "0",
			initialStats: { meanR2: 0, meanRMSE: 0, closingError: 0 },
			lapCount: 2,
			defaultAirSpeedOffset: 0,
			elevationToggleMarkup: "",
		});

		expect(html).toContain(`id="${VD_HEADER_ID}"`);
		expect(html.indexOf(`id="${VD_HEADER_ID}"`)).toBeLessThan(
			html.indexOf(`id="gpsLapVdPlot"`),
		);
	});

	it("is filled with one line per lap whenever the plot is drawn", () => {
		renderGpsLapVdPlot([lap(3, 2.25, 2.5), lap(4, 4.5, 5)]);

		const lines = Array.from(
			document.querySelectorAll<HTMLElement>(".ve-metrics-compact__line"),
		).map((line) => line.textContent);

		expect(lines).toEqual([
			"Lap 3: VD (Air):2.250 km | VD (Ground):2.500 km | Difference:-10.00%",
			"Lap 4: VD (Air):4.500 km | VD (Ground):5.000 km | Difference:-10.00%",
		]);
		expect(document.getElementById(VD_HEADER_ID)!.textContent).not.toContain(
			"n/a",
		);
	});
});
