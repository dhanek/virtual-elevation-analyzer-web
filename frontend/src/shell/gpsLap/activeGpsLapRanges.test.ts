import { describe, expect, it } from "vitest";
import { AppState } from "../../state/AppState";
import { resolveActiveGpsLapRanges } from "./activeGpsLapRanges";
import type { DetectedLap } from "../../utils/GpsLapDetection";

function detectedLap(lapNumber: number, startIdx: number, endIdx: number): DetectedLap {
	return { lapNumber, startIdx, endIdx } as DetectedLap;
}

describe("resolveActiveGpsLapRanges", () => {
	it("uses currentGpsLapIndexRanges for the stacked-from-standard case (no GPS detection)", () => {
		const appState = new AppState();
		appState.currentGpsLapIndexRanges = [
			{ startIdx: 0, endIdx: 5 },
			{ startIdx: 6, endIdx: 10 },
		];
		// No GPS detection happened — these are empty in standard-stack mode.
		appState.gpsDetectedLaps = [];
		appState.gpsSelectedLaps = [];

		expect(resolveActiveGpsLapRanges(appState)).toEqual([
			{ startIdx: 0, endIdx: 5 },
			{ startIdx: 6, endIdx: 10 },
		]);
	});

	it("falls back to selected detected laps when no active ranges are set", () => {
		const appState = new AppState();
		appState.currentGpsLapIndexRanges = null;
		appState.gpsDetectedLaps = [
			detectedLap(1, 0, 5),
			detectedLap(2, 6, 10),
			detectedLap(3, 11, 15),
		];
		appState.gpsSelectedLaps = [1, 3];

		expect(resolveActiveGpsLapRanges(appState)).toEqual([
			{ startIdx: 0, endIdx: 5 },
			{ startIdx: 11, endIdx: 15 },
		]);
	});

	it("returns an empty array when nothing is active or selected", () => {
		const appState = new AppState();
		appState.currentGpsLapIndexRanges = null;
		appState.gpsDetectedLaps = [];
		appState.gpsSelectedLaps = [];

		expect(resolveActiveGpsLapRanges(appState)).toEqual([]);
	});
});
