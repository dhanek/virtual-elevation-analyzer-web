/**
 * @vitest-environment jsdom
 *
 * The hint under Auto Adjust follows the selection: a selection change reaches
 * it through the one funnel (`requestModeUpdate`), and it UPDATES rather than
 * clears.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { HeadingCalibrationSegment } from "../../analysis/AirSpeedCalibration";

const input = vi.hoisted(() => ({
	segments: [] as HeadingCalibrationSegment[],
	throws: false,
}));

const logError = vi.hoisted(() => vi.fn());
vi.mock("../../utils/log", async (importOriginal) => {
	const original = await importOriginal<typeof import("../../utils/log")>();
	return { ...original, log: { ...original.log, error: logError } };
});

vi.mock("./autoCalibration", () => ({
	headingCalibrationInput: () => {
		if (input.throws) throw new Error("boom");
		return {
			measuredAirSpeed: true,
			headingSegments: input.segments,
		};
	},
}));

import type { AppState } from "../../state/AppState";
import { CALIBRATION_METHOD_HINT_ID } from "../ve/calibrationMethodHint";
import {
	calibrationTabMarkup,
	CALIBRATION_TAB_CONTENT_ID,
	renderCalibrationTab,
	setCalibrationTabState,
} from "../ve/calibrationTab";
import {
	configureModeUpdateRequests,
	REPORT_INVALIDATING_REASONS,
	requestModeUpdate,
	resetModeUpdateRequests,
} from "./requestModeUpdate";

const hint = () => document.getElementById(CALIBRATION_METHOD_HINT_ID);

describe("calibration method hint wiring", () => {
	beforeEach(() => {
		document.body.innerHTML = `<div id="${CALIBRATION_METHOD_HINT_ID}" hidden></div>`;
		configureModeUpdateRequests({
			appState: { currentFitData: {} } as unknown as AppState,
		});
	});
	afterEach(() => {
		input.throws = false;
		logError.mockClear();
		resetModeUpdateRequests();
		document.body.innerHTML = "";
	});

	it("refreshes from the new selection when the selection changes", () => {
		input.segments = [];
		requestModeUpdate("segmentSelection");
		expect(hint()?.textContent).toBe(
			"Distance ratio only — the selection holds no complete circuit",
		);
		expect(hint()?.hidden).toBe(false);
	});

	it("also refreshes on a trim change", () => {
		input.segments = [];
		requestModeUpdate("mapTrim");
		expect(hint()?.textContent).toContain("Distance ratio only");
	});

	it("hides the hint and logs an error when the probe throws", () => {
		input.throws = true;
		requestModeUpdate("segmentSelection");
		expect(hint()?.hidden).toBe(true);
		expect(logError).toHaveBeenCalledWith(
			expect.stringContaining("refreshCalibrationMethodHint"),
			expect.any(Error),
		);
	});
});

/**
 * The Calibration tab describes the run the report describes, so every reason
 * that clears the report must clear the tab with it.
 */
describe("calibration tab clears with the report", () => {
	const pane = () => document.getElementById(CALIBRATION_TAB_CONTENT_ID);

	beforeEach(() => {
		document.body.innerHTML = `<div id="${CALIBRATION_METHOD_HINT_ID}" hidden></div>${calibrationTabMarkup()}`;
		configureModeUpdateRequests({
			appState: { currentFitData: {} } as unknown as AppState,
		});
	});
	afterEach(() => {
		setCalibrationTabState(null);
		resetModeUpdateRequests();
		document.body.innerHTML = "";
	});

	it.each([...REPORT_INVALIDATING_REASONS])("on %s", (reason) => {
		setCalibrationTabState({
			outcome: { method: "vdRatio", percent: 4.9, fallback: "noWholeCircuit" },
			segments: [],
		});
		renderCalibrationTab();
		expect(pane()?.textContent).not.toContain("Run Auto Adjust");

		requestModeUpdate(reason);
		renderCalibrationTab();

		expect(pane()?.textContent).toContain("Run Auto Adjust");
	});
});
