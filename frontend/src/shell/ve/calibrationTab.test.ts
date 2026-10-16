/**
 * @vitest-environment jsdom
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { HeadingCalibrationSegment } from "../../analysis/AirSpeedCalibration";
import { resetTabRenderMapForNewPanel } from "../dom/tabs";
import {
	CALIBRATION_TAB_CONTENT_ID,
	calibrationTabMarkup,
	renderCalibrationTab,
	setCalibrationTabState,
} from "./calibrationTab";

const plotted: unknown[] = [];
/** The traces and layout of each figure drawn, in the same order as `plotted`. */
const drawnData: Array<Array<{ x?: unknown[] }>> = [];
const drawnLayouts: Array<{ shapes?: Array<{ x0: number }> }> = [];
vi.mock("../analysis/plotlyLoader", () => ({
	waitForPlotly: () =>
		Promise.resolve({
			react: (
				host: unknown,
				data: Array<{ x?: unknown[] }>,
				layout: { shapes?: Array<{ x0: number }> },
			) => {
				plotted.push(host);
				drawnData.push(data);
				drawnLayouts.push(layout);
				return Promise.resolve();
			},
		}),
}));

/** Each purge call, with what its container still held when it was made. */
const purged: Array<{ root: HTMLElement; held: Element[] }> = [];
vi.mock("../dom/plotlyPurge", () => ({
	purgePlotlyGraphsIn: (root: HTMLElement) => {
		purged.push({ root, held: [...root.children] });
	},
}));

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

/** A small circular ride: constant speed, heading sweeping the compass. */
function circleSegment(label: string, n = 120): HeadingCalibrationSegment {
	const timestamps = Array.from({ length: n + 1 }, (_, i) => i);
	const lat: number[] = [];
	const lon: number[] = [];
	for (let i = 0; i <= n; i++) {
		const t = (2 * Math.PI * i) / n;
		lat.push(50 + 0.0005 * Math.sin(t));
		lon.push(8 + 0.0008 * (1 - Math.cos(t)));
	}
	return {
		label,
		timestamps,
		velocity: timestamps.map(() => 8),
		airSpeed: timestamps.map(() => 8),
		positionLat: lat,
		positionLong: lon,
	};
}

const row = (label: string, percent: number) => ({
	label,
	percent,
	circuits: 1,
	windSpeed: 2,
	windDirDeg: 90,
	coefficients: { a: 0.5, b: 0.5 },
});

describe("calibrationTab", () => {
	const pane = () => document.getElementById(CALIBRATION_TAB_CONTENT_ID);

	beforeEach(() => {
		plotted.length = 0;
		drawnData.length = 0;
		drawnLayouts.length = 0;
		purged.length = 0;
		document.body.innerHTML = calibrationTabMarkup();
		setCalibrationTabState(null);
	});

	it("explains itself when no fit has run", () => {
		renderCalibrationTab();
		expect(pane()?.textContent).toContain("Run Auto Adjust");
		expect(plotted).toHaveLength(0);
	});

	it("names the refusal when the heading fit was not used", () => {
		setCalibrationTabState({
			outcome: { method: "vdRatio", percent: 4.9, fallback: "noWholeCircuit" },
			segments: [],
		});
		renderCalibrationTab();
		expect(pane()?.textContent).toContain(
			"the selection holds no complete circuit",
		);
		expect(plotted).toHaveLength(0);
	});

	it("draws a figure per fitted lap, the agreement and the wind", async () => {
		setCalibrationTabState({
			outcome: {
				method: "sinusoid",
				percent: 3,
				scale: 1.03,
				circuits: 2,
				perSegment: [row("Lap 1", 2.5), row("Lap 2", 3.5)],
				warnings: [],
			},
			segments: [circleSegment("Lap 1"), circleSegment("Lap 2")],
		});
		renderCalibrationTab();
		await flush();
		// two laps + agreement + wind
		expect(plotted).toHaveLength(4);
	});

	it("titles an unfitted lap with its refusal and skips the agreement for one lap", async () => {
		setCalibrationTabState({
			outcome: {
				method: "sinusoid",
				percent: 3,
				scale: 1.03,
				circuits: 1,
				perSegment: [
					row("Lap 1", 3),
					{
						label: "Lap 2",
						percent: null,
						circuits: 0,
						refusal: "notClosed",
					},
				],
				warnings: [],
			},
			segments: [circleSegment("Lap 1"), circleSegment("Lap 2")],
		});
		renderCalibrationTab();
		await flush();
		expect(pane()?.textContent).toContain(
			"Lap 2: not fitted, the circuits do not return to their start",
		);
		// one lap figure + wind, no agreement
		expect(plotted).toHaveLength(2);
	});
});

describe("calibrationTab repaint and reset", () => {
	const pane = () => document.getElementById(CALIBRATION_TAB_CONTENT_ID);
	const fitted = () => ({
		outcome: {
			method: "sinusoid" as const,
			percent: 3,
			scale: 1.03,
			circuits: 1,
			perSegment: [row("Lap 1", 3)],
			warnings: [],
		},
		segments: [circleSegment("Lap 1")],
	});

	beforeEach(() => {
		plotted.length = 0;
		drawnData.length = 0;
		drawnLayouts.length = 0;
		purged.length = 0;
		document.body.innerHTML = calibrationTabMarkup();
		setCalibrationTabState(null);
	});

	it("redraws when the state changes under an active pane", async () => {
		pane()?.classList.add("ve-tab-content--active");
		setCalibrationTabState(fitted());
		await flush();
		expect(plotted).toHaveLength(2);
		setCalibrationTabState(null);
		expect(pane()?.textContent).toContain("Run Auto Adjust");
		expect(document.getElementById("calibrationLaps")?.children).toHaveLength(
			0,
		);
	});

	it("draws nothing while the pane is inactive", async () => {
		setCalibrationTabState(fitted());
		await flush();
		expect(plotted).toHaveLength(0);
		expect(pane()?.textContent).not.toContain("Run Auto Adjust");
	});

	it("purges the previous render's graphs before replacing them", async () => {
		setCalibrationTabState(fitted());
		renderCalibrationTab();
		await flush();
		const firstHosts = [...plotted];
		expect(firstHosts).toHaveLength(2);
		purged.length = 0;

		renderCalibrationTab();

		const purgedHosts = purged.flatMap((call) => call.held);
		for (const host of firstHosts) expect(purgedHosts).toContain(host);
	});

	it("pairs rows with segments by position, not by label", async () => {
		setCalibrationTabState({
			outcome: {
				method: "sinusoid",
				percent: 3,
				scale: 1.03,
				circuits: 2,
				perSegment: [row("Lap", 2.5), row("Lap", 3.5)],
				warnings: [],
			},
			// Same label, different rides: a label lookup draws the first twice.
			segments: [circleSegment("Lap", 120), circleSegment("Lap", 60)],
		});
		renderCalibrationTab();
		await flush();
		// two laps + agreement + wind, and no lap is reported unfitted
		expect(plotted).toHaveLength(4);
		expect(pane()?.textContent).not.toContain("not fitted");
		const samples = (figure: number) => drawnData[figure]?.[0]?.x?.length;
		expect(samples(0)).not.toBe(samples(1));
	});

	it("draws the pooled line at the fit's own value when the percent was clamped", async () => {
		setCalibrationTabState({
			outcome: {
				method: "sinusoid",
				percent: 20,
				scale: 1.3,
				circuits: 2,
				perSegment: [row("Lap 1", 29), row("Lap 2", 31)],
				warnings: [],
			},
			segments: [circleSegment("Lap 1"), circleSegment("Lap 2")],
		});
		renderCalibrationTab();
		await flush();
		// laps first, then the agreement
		expect(drawnLayouts[2]?.shapes?.[0]?.x0).toBeCloseTo(30, 9);
	});

	it("is dropped when the panel is rebuilt", () => {
		setCalibrationTabState(fitted());
		resetTabRenderMapForNewPanel();
		renderCalibrationTab();
		expect(pane()?.textContent).toContain("Run Auto Adjust");
	});
});
