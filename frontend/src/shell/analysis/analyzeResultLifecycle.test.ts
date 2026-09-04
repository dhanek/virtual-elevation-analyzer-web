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
import { applyVeStatus } from "../../state/veStatus";

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

/**
 * `veStatus` sampled at each `showLoading`, which is the analyze path's own
 * first visible act. Reading the status THERE, rather than after `handleAnalyze`
 * resolves, is what makes the case below about the window and not its end.
 */
const loadingStatuses: Array<unknown> = [];

function configure(appState: AppState): void {
	configureAnalyzeOrchestrator({
		appState,
		parameterStorage: {} as unknown as ParameterStorage,
		resultsStorage: {} as unknown as ResultsStorage,
		getMapVisualization: () => null,
		getParametersComponent: () => null,
		setParametersComponent: () => {},
		initializeSection3: () => {},
		showLoading: () => {
			loadingStatuses.push(appState.veStatus);
		},
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
		loadingStatuses.length = 0;
		document.body.innerHTML = `<div id="veAnalysisSection"><div id="veAnalysisContent"></div></div>`;
		appState = makeAppState();
		configure(appState);
	});

	afterEach(() => {
		vi.restoreAllMocks();
	});

	/**
	 * `currentFitResult` absent is the orchestrator's own "No data available for
	 * analysis" throw, which its `catch` turns into a `showError`. No panel is
	 * rendered, so `summarize` never runs.
	 *
	 * Before this, the `currentVEResult = payload.initialResult` assignment that
	 * used to sit further down `handleAnalyze` would not have been reached
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

/**
 * THE STATUS AT ANALYZE ENTRY — the other half of the same claim.
 *
 * Nulling `currentVEResult` above withdraws one of the four analyze-derived
 * fields. `currentFilteredData`, `currentWindSource` and
 * `currentVirtualDistances` are not nulled, and cannot be: the panel that is
 * still on screen is drawn from them until the new one replaces it. What has to
 * be withdrawn instead is the CLAIM that they describe the current selection,
 * and that claim is `veStatus === "ready"`.
 *
 * The window is not instantaneous. Between here and the first update pass sit
 * `resolveMultiSegmentAnalysisParams`' storage I/O, each mode's per-segment
 * description loop, `waitForPlotly`, and the recompute throttle — with the
 * PREVIOUS panel still mounted, its `#storeResult` still enabled (the loading
 * indicator is a non-modal inline element that blocks no clicks), and the four
 * fields still holding the previous analysis. One click in that window used to
 * store the previous ride's numbers under this one's name.
 *
 * The orchestrator is where this is closed because it is the one place all three
 * modes pass through before any of that starts.
 */
describe("veStatus at analyze entry", () => {
	let appState: AppState;

	beforeEach(() => {
		modeState.gps = "None";
		errors.length = 0;
		loadingStatuses.length = 0;
		document.body.innerHTML = `<div id="veAnalysisSection"><div id="veAnalysisContent"></div></div>`;
		appState = makeAppState();
		configure(appState);
	});

	afterEach(() => {
		vi.restoreAllMocks();
	});

	/**
	 * The precondition is the whole point and is what no other test in the repo
	 * sets up: a status that is genuinely `ready`, left by a first, successful
	 * analysis. Against a fresh AppState `veStatus` is `undefined`, so "not
	 * ready" is true before anything runs and asserting it proves nothing.
	 *
	 * The analyze then fails (`currentFitResult` absent), so nothing downstream
	 * can move the status on this path — no panel renders and no update pass
	 * runs. Whatever the status is at the end, the orchestrator put it there.
	 */
	it("stops claiming ready before the analyze does any work", async () => {
		applyVeStatus(appState, "computing");
		applyVeStatus(appState, "ready");
		expect(appState.veStatus).toBe("ready");

		appState.currentFitResult = null as never;

		await handleAnalyze();

		// Sampled at the analyze path's first visible act, so this is the window
		// itself: by the time the user sees "Preparing data...", the previous
		// analysis is no longer claimed to be current.
		expect(loadingStatuses.length).toBeGreaterThan(0);
		expect(loadingStatuses[0]).toBe("computing");
		expect(appState.veStatus).not.toBe("ready");
	});
});
