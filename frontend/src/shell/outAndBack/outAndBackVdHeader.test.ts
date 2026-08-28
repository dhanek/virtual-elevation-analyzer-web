/**
 * @vitest-environment jsdom
 *
 * Regression coverage for the missing VD header in the out-and-back sidebar.
 *
 * Out-and-back was the third mode with no VD header at all -- a bare
 * `#oabVdPlot` with nothing above it, so the label was missing outright, not
 * merely stale. It was deliberately left alone when the other two were fixed,
 * because its shape was a real ruling rather than a copy: each section has an
 * outbound and an inbound leg, so per-segment would mean 2N lines. The
 * maintainer ruled per-section total, explicitly not per-leg.
 *
 * Both halves are asserted, because either alone is vacuous: a renderer writing
 * into a container the template does not emit fails silently, and a template
 * emitting a container nothing writes to shows an empty box. That is exactly
 * how the GPS-lap version of this defect stayed hidden.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { outAndBackVdTabMarkup } from "./renderOutAndBack";
import { renderOutAndBackVdPlot } from "./outAndBackPlots";
import { VD_HEADER_ID, virtualDistanceHeaderMarkup } from "../ve/vdHeader";
import type { SegmentSupplementarySeries } from "../../analysis/SegmentSupplementarySeries";
import type { OutAndBackVEProfile } from "./types";

function leg(airKm: number, groundKm: number): SegmentSupplementarySeries {
	return {
		distancesKm: [0, groundKm],
		powerWatts: [200, 200],
		apparentWindSpeedMps: [9, 9],
		virtualDistanceAirKm: [0, airKm],
		virtualDistanceGroundKm: [0, groundKm],
	};
}

function section(
	sectionNumber: number,
	outbound: SegmentSupplementarySeries | null,
	inbound: SegmentSupplementarySeries | null,
): OutAndBackVEProfile {
	return {
		sectionNumber,
		outboundRange: { startIdx: 0, endIdx: 2 },
		inboundRange: { startIdx: 0, endIdx: 2 },
		outboundDistances: [],
		outboundVE: [],
		outboundVECompare: null,
		outboundActualElevation: [],
		outboundSeries: outbound,
		inboundDistances: [],
		inboundVE: [],
		inboundVECompare: null,
		inboundActualElevation: [],
		inboundSeries: inbound,
		outboundDuration: 60,
		inboundDuration: 60,
		totalDistance: 2,
	};
}

function renderedLines(): (string | null)[] {
	return Array.from(
		document.querySelectorAll<HTMLElement>(".ve-metrics-compact__line"),
	).map((line) => line.textContent);
}

describe("the out-and-back VD header", () => {
	beforeEach(() => {
		document.body.innerHTML = `
            ${virtualDistanceHeaderMarkup()}
            <div id="oabVdPlot"></div>
        `;
		(window as unknown as { Plotly: unknown }).Plotly = { newPlot: vi.fn() };
	});

	it("is emitted by the sidebar template, above the plot", () => {
		const html = outAndBackVdTabMarkup(true);

		expect(html).toContain(`id="${VD_HEADER_ID}"`);
		expect(html.indexOf(`id="${VD_HEADER_ID}"`)).toBeLessThan(
			html.indexOf(`id="oabVdPlot"`),
		);
	});

	it("is filled with ONE line per section, combining both legs", () => {
		renderOutAndBackVdPlot([
			// 1.0 + 1.5 = 2.5 air against 1.0 + 1.0 = 2.0 ground -> +25.00%.
			section(1, leg(1.0, 1.0), leg(1.5, 1.0)),
			// 2.0 + 2.0 = 4.0 air against 2.5 + 2.5 = 5.0 ground -> -20.00%.
			section(2, leg(2.0, 2.5), leg(2.0, 2.5)),
		]);

		// Two sections, four legs, TWO lines. Per-leg would give four.
		expect(renderedLines()).toEqual([
			"Section 1: VD (Air):2.500 km | VD (Ground):2.000 km | Difference:+25.00%",
			"Section 2: VD (Air):4.000 km | VD (Ground):5.000 km | Difference:-20.00%",
		]);
		expect(document.getElementById(VD_HEADER_ID)!.textContent).not.toContain(
			"n/a",
		);
	});

	it("is labelled by section, the way the other modes are labelled by lap", () => {
		renderOutAndBackVdPlot([section(3, leg(1, 1), leg(1, 1))]);

		// A lone section drops the prefix, exactly as a lone lap does, and keeps
		// the three span ids Standard has always exposed.
		expect(document.getElementById("vdAirValue")!.textContent).toBe("2.000 km");
		expect(document.getElementById("vdGroundValue")!.textContent).toBe("2.000 km");
		expect(document.getElementById("vdDiffValue")!.textContent).toBe("+0.00%");
	});

	it("recomputes the percentage from the summed legs, not from the legs' own", () => {
		// Leg percentages are +100% and 0%; their mean would be +50%. The
		// section total is 3.0 air against 2.0 ground, which is +50% only by
		// coincidence at equal lengths -- so the legs are given DIFFERENT
		// lengths to make the two answers differ.
		renderOutAndBackVdPlot([section(1, leg(2.0, 1.0), leg(1.0, 3.0))]);

		// air 3.0, ground 4.0 -> -25.00%. The mean of +100% and -66.67% is
		// +16.67%, which is not what a distance ratio means.
		expect(document.getElementById("vdAirValue")!.textContent).toBe("3.000 km");
		expect(document.getElementById("vdGroundValue")!.textContent).toBe("4.000 km");
		expect(document.getElementById("vdDiffValue")!.textContent).toBe("-25.00%");
	});

	it("carries a section whose inbound leg was skipped, on its outbound alone", () => {
		renderOutAndBackVdPlot([
			section(1, leg(1.0, 1.0), null),
			section(2, leg(2.0, 2.5), leg(2.0, 2.5)),
		]);

		expect(renderedLines()).toEqual([
			"Section 1: VD (Air):1.000 km | VD (Ground):1.000 km | Difference:+0.00%",
			"Section 2: VD (Air):4.000 km | VD (Ground):5.000 km | Difference:-20.00%",
		]);
	});

	it("drops a section that produced no legs at all rather than showing zeros", () => {
		renderOutAndBackVdPlot([
			section(1, null, null),
			section(2, leg(2.0, 2.5), leg(2.0, 2.5)),
		]);

		// One line, for section 2 — and because it is then the only row, it
		// renders unprefixed.
		expect(renderedLines()).toEqual([
			"VD (Air):4.000 km | VD (Ground):5.000 km | Difference:-20.00%",
		]);
	});
});
