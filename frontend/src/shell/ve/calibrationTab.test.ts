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
vi.mock("../analysis/plotlyLoader", () => ({
	waitForPlotly: () =>
		Promise.resolve({
			react: (host: unknown) => {
				plotted.push(host);
				return Promise.resolve();
			},
		}),
}));

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

/** A small circular ride: constant speed, heading sweeping the compass. */
function circleSegment(label: string): HeadingCalibrationSegment {
	const n = 120;
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

	it("is dropped when the panel is rebuilt", () => {
		setCalibrationTabState(fitted());
		resetTabRenderMapForNewPanel();
		renderCalibrationTab();
		expect(pane()?.textContent).toContain("Run Auto Adjust");
	});
});
