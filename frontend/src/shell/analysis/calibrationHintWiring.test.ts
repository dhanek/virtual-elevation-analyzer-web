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
}));

vi.mock("./autoCalibration", () => ({
	headingCalibrationInput: () => ({
		measuredAirSpeed: true,
		headingSegments: input.segments,
	}),
}));

import type { AppState } from "../../state/AppState";
import { CALIBRATION_METHOD_HINT_ID } from "../ve/calibrationMethodHint";
import {
	configureModeUpdateRequests,
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
});
