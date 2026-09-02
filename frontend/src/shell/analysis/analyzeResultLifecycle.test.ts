/**
 * @vitest-environment jsdom
 *
 * WHO OWNS `appState.currentVEResult`.
 *
 * The field has exactly two readers, both in `storageHandlers.ts`: the guard at
 * `:105` that decides whether Store Result may run at all, and `:314`, the value
 * it persists. So every write to it is a claim about what the user is looking
 * at, and a wrong one is stored under the ride's name.
 *
 * Until WR-4 there were two analyze-time writers with different answers.
 * `analyzeOrchestrator` assigned `payload.initialResult` -- ONE stitched fit over
 * the concatenated selection -- for every mode, while the GPS panels display N
 * per-lap fits and out-and-back 2N leg fits. `gpsLapMode.render` and
 * `outAndBackMode.render` never forward `initialResult` to anything, so in those
 * modes the value was computed, stored, and displayed nowhere.
 *
 * The seam is now `handler.summarize`, reached through the update primitive, for
 * every mode -- which `gpsModeRealChain.test.ts` holds. This file holds the other
 * half: that an analyze which never reaches that seam leaves NO result behind,
 * rather than a previous ride's.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const modeState = vi.hoisted(() => ({ gps: "None" as string }));

vi.mock("../section3/section3Orchestration", async (importOriginal) => ({
	...(await importOriginal<Record<string, unknown>>()),
	getGpsAnalysisMode: () => modeState.gps,
}));

import type { AnalysisParameters } from "../../components/AnalysisParameters";
import type { AppState } from "../../state/AppState";
import type { ParameterStorage } from "../../utils/ParameterStorage";
import type { ResultsStorage } from "../../utils/ResultsStorage";
import type { VEAnalysisResult } from "../../utils/ResultsStorage";
import { configureAnalyzeOrchestrator, handleAnalyze } from "./analyzeOrchestrator";

const SAMPLE_COUNT = 120;

/** A result from a PREVIOUS, successful analysis of a DIFFERENT ride. */
const STALE_RESULT = {
	r2: 0.99,
	rmse: 0.01,
	ve_elevation_diff: 111,
	actual_elevation_diff: 222,
	virtual_elevation: new Float64Array(4),
} as unknown as VEAnalysisResult;

function makeFitData() {
	const zeros = () => new Array<number>(SAMPLE_COUNT).fill(0);
	return {
		timestamps: Array.from({ length: SAMPLE_COUNT }, (_, i) => i),
		power: zeros().map(() => 200),
		velocity: zeros().map(() => 10),
		position_lat: zeros(),
		position_long: zeros(),
		altitude: zeros(),
		distance: zeros().map((_, i) => i * 10),
		air_speed: zeros(),
		wind_speed: zeros(),
		wind_yaw: zeros(),
		air_density_data: zeros(),
		road_speed: zeros(),
		temperature: zeros().map(() => 20),
		cda_reference: null,
	};
}

const params = {
	cda: 0.3,
	crr: 0.005,
	wind_speed: 0,
	wind_direction: 0,
	velodrome: false,
	auto_calculate_rho: false,
} as unknown as AnalysisParameters;

function makeAppState(): AppState {
	return {
		currentFitData: makeFitData(),
		currentParameters: { ...params },
		currentLaps: [{ start_time: 0, end_time: SAMPLE_COUNT - 1 }],
		selectedLaps: [1],
		currentVEResult: STALE_RESULT,
		gpsDetectedLaps: [],
		gpsSelectedLaps: [],
	} as unknown as AppState;
}

const errors: string[] = [];

function configure(appState: AppState): void {
	configureAnalyzeOrchestrator({
		appState,
		parameterStorage: {} as unknown as ParameterStorage,
		resultsStorage: {} as unknown as ResultsStorage,
		getMapVisualization: () => null,
		getParametersComponent: () => null,
		setParametersComponent: () => {},
		initializeSection3: () => {},
		showLoading: () => {},
		hideLoading: () => {},
		showError: (message: string) => {
			errors.push(message);
		},
	});
}

describe("currentVEResult across a failed analyze", () => {
	let appState: AppState;

	beforeEach(() => {
		modeState.gps = "None";
		errors.length = 0;
		document.body.innerHTML = `<div id="veAnalysisSection"><div id="veAnalysisContent"></div></div>`;
		appState = makeAppState();
		configure(appState);
	});

	afterEach(() => {
		vi.restoreAllMocks();
	});

	/**
	 * `currentFitResult` absent is the orchestrator's own "No data available for
	 * analysis" throw (`analyzeOrchestrator.ts:348`), which its `catch` turns
	 * into a `showError`. No panel is rendered, so `summarize` never runs.
	 *
	 * Before this, `analyzeOrchestrator.ts:428` would not have been reached
	 * either -- so the field kept the PREVIOUS ride's result while
	 * `appState.selectedFile` had already moved on to this one, and the Store
	 * Result guard at `storageHandlers.ts:105` saw a result it was happy to
	 * persist under the wrong ride.
	 */
	it("leaves no result behind when the analyze fails", async () => {
		appState.currentFitResult = null as never;

		await handleAnalyze();

		expect(errors.length).toBeGreaterThan(0);
		expect(appState.currentVEResult).toBeNull();
	});
});
