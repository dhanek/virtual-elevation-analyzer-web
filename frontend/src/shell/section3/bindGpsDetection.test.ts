/**
 * @vitest-environment jsdom
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { bindGpsDetection } from "./bindGpsDetection";
import { AppState } from "../../state/AppState";

function setupDom() {
	document.body.innerHTML = `
        <div id="gpsGateSliderControls" style="display:none"></div>
        <input id="gpsGateSlider" type="range" />
        <input id="gpsGateValue" type="number" />
        <div id="gpsGatePositionInfo"></div>
    `;
}

function makeAppState(selectedLaps: number[]): AppState {
	const appState = new AppState();
	appState.currentFileHash = null; // skip saved-marker load/save
	appState.currentFitData = {
		timestamps: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10],
		position_lat: new Array(11).fill(52.5),
		position_long: new Array(11).fill(13.4),
	} as any;
	appState.selectedLaps = selectedLaps;
	return appState;
}

function makeCallbacks(runGpsLapDetection: ReturnType<typeof vi.fn>) {
	return {
		getSelectedDataTimeRange: () => ({
			startTime: 0,
			endTime: 10,
			duration: 10,
		}),
		findDataIndexAtTimeOffset: () => 0,
		runGpsLapDetection,
	};
}

const mapVisualization = {
	setGpsMarker: vi.fn(),
} as any;

describe("bindGpsDetection initial detection guard", () => {
	beforeEach(() => {
		setupDom();
		vi.clearAllMocks();
	});

	it("does NOT run detection on entry when no FIT laps are selected", async () => {
		const runGpsLapDetection = vi.fn();
		const appState = makeAppState([]);

		await bindGpsDetection(
			appState,
			{} as any,
			mapVisualization,
			makeCallbacks(runGpsLapDetection),
		);
		await Promise.resolve();

		expect(runGpsLapDetection).not.toHaveBeenCalled();
	});

	it("runs the initial detection when FIT laps are selected", async () => {
		const runGpsLapDetection = vi.fn();
		const appState = makeAppState([1]);

		await bindGpsDetection(
			appState,
			{} as any,
			mapVisualization,
			makeCallbacks(runGpsLapDetection),
		);
		await Promise.resolve();

		expect(runGpsLapDetection).toHaveBeenCalledOnce();
	});
});
