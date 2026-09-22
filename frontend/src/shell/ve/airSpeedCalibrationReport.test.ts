/**
 * @vitest-environment jsdom
 */
import { describe, expect, it } from "vitest";
import type { AutoCalibrationOutcome } from "../../analysis/AirSpeedCalibration";
import {
	clearCalibrationReport,
	describeCalibration,
	renderCalibrationReport,
} from "./airSpeedCalibrationReport";

const pooled: AutoCalibrationOutcome = {
	method: "sinusoid",
	percent: 8.04,
	scale: 1.0804,
	circuits: 12,
	perSegment: [
		{
			label: "Lap 2",
			percent: 6.2,
			circuits: 6,
			windSpeed: 1.26,
			windDirDeg: 196.4,
		},
		{ label: "Lap 3", percent: null, circuits: 0, refusal: "notClosed" },
	],
	warnings: [
		{ kind: "gusty", label: "Lap 2", gustIndex: 0.052 },
		{ kind: "gustUnavailable", label: "Lap 2" },
		{ kind: "windChanged", label: "Lap 2", vectorChange: 1.23 },
		{ kind: "stationarityUnavailable", label: "Lap 2" },
		{ kind: "fewCircuits", circuits: 4 },
		{ kind: "segmentSpread", spreadPercent: 2.94 },
		{ kind: "clamped", unclampedPercent: 27.3 },
	],
};

describe("describeCalibration", () => {
	it("leads with the applied percent and complete circuits", () => {
		expect(describeCalibration(pooled).headline).toBe(
			"Heading fit: +8.0 % from 12 complete circuits",
		);
	});

	it("lists every segment with its estimated wind, or why it was not fitted", () => {
		expect(describeCalibration(pooled).details).toEqual([
			"Lap 2: +6.2 % over 6 circuits; estimated wind 1.3 m/s from 196°",
			"Lap 3: not fitted, the circuits do not return to their start",
		]);
	});

	it("words every warning without an accuracy claim", () => {
		expect(describeCalibration(pooled).warnings).toEqual([
			"Lap 2: gusty conditions (gust index 0.052); the calibration may be unreliable.",
			"Lap 2: gustiness could not be assessed (irregular timestamps).",
			"Lap 2: the wind changed during the lap (by 1.2 m/s); the calibration may be unreliable.",
			"Lap 2: wind stability could not be checked.",
			"Short selection (4 complete circuits); more complete circuits generally improve repeatability.",
			"Laps differ by 2.9 pp. Calibration depends on riding position; select laps ridden in one position.",
			"The fitted +27.3 % is outside the ±20 % control and was clamped.",
		]);
	});

	it("uses the singular for a one-circuit selection, warning included", () => {
		const one: AutoCalibrationOutcome = {
			...pooled,
			circuits: 1,
			perSegment: [{ ...pooled.perSegment[0], circuits: 1 }],
			warnings: [{ kind: "fewCircuits", circuits: 1 }],
		};
		const text = describeCalibration(one);
		expect(text.headline).toBe("Heading fit: +8.0 % from 1 complete circuit");
		expect(text.details[0]).toContain("over 1 circuit;");
		expect(text.warnings[0]).toBe(
			"Short selection (1 complete circuit); more complete circuits generally improve repeatability.",
		);
	});

	it("names the distance ratio's assumption and why the heading fit was not used", () => {
		expect(
			describeCalibration({
				method: "vdRatio",
				percent: -3.46,
				fallback: "reversal",
			}),
		).toEqual({
			headline: "Distance ratio: -3.5 %",
			details: [
				"Heading fit not used: the track doubles back (figure-eight or reversal).",
				"The distance ratio assumes a closed loop ridden at steady pace.",
			],
			warnings: [],
		});
	});

	it("explains a none outcome", () => {
		expect(
			describeCalibration({ method: "none", reason: "noMeasuredAirSpeed" }),
		).toEqual({
			headline: "No calibration available",
			details: ["This ride carries no measured wind channel."],
			warnings: [],
		});
	});
});

describe("renderCalibrationReport", () => {
	it("renders text only and reveals the container", () => {
		const container = document.createElement("div");
		container.hidden = true;
		renderCalibrationReport(container, {
			...pooled,
			perSegment: [
				{
					label: "<b>x</b>",
					percent: 1,
					circuits: 6,
					windSpeed: 1,
					windDirDeg: 1,
				},
			],
		});
		expect(container.hidden).toBe(false);
		expect(container.querySelector("b")).toBeNull();
		expect(
			container.querySelectorAll(".ve-parameter__report-warning"),
		).toHaveLength(7);
	});

	it("clears and hides; tolerates a missing container", () => {
		const container = document.createElement("div");
		renderCalibrationReport(container, pooled);
		clearCalibrationReport(container);
		expect(container.hidden).toBe(true);
		expect(container.childElementCount).toBe(0);
		expect(() => renderCalibrationReport(null, pooled)).not.toThrow();
		expect(() => clearCalibrationReport(null)).not.toThrow();
	});
});
