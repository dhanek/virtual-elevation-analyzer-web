/**
 * @vitest-environment jsdom
 *
 * Regression coverage for the mode-switch defect: after switching GPS analysis
 * mode (e.g. GPS lap splitting -> None), Section 3 came back inert -- no trim
 * sliders and no usable Analyze button -- until the user deselected and
 * reselected the same lap.
 *
 * `rerenderSection3` replaces `#results` with `renderSection3Template`, which
 * emits the Analyze button hard-coded `disabled` and `#mapTrimControls`
 * hard-coded `hidden`, while re-rendering the lap checkboxes *checked*. The one
 * function that reconciles that markup with the retained selection is
 * `updateSelectedLaps()` -- exactly what deselect/reselect invoked by hand.
 *
 * Two independent failure modes are covered, because the first fix addressed
 * only half of the first one:
 *
 *  1. the post-render hook never called `updateSelectedLaps()`, so the trim
 *     controls stayed hidden even when everything else went right;
 *  2. the control re-binding sat at the tail of a single `try` that began by
 *     tearing down and re-awaiting a Leaflet map against DOM that had just been
 *     replaced underneath it. Any throw there aborted the hook before the
 *     controls were touched at all. The original regression test avoided this by
 *     using `has_gps_data: false`, which skips the map branch entirely -- so it
 *     passed while the bug was still live in every GPS-mode switch.
 *
 * See deferred-items.md "maintainer defect 4".
 *
 * ---------------------------------------------------------------------------
 * GPS-02 / milestone-audit finding BL-1 (second describe block at the foot of
 * this file): the same dropdown, a different consequence. Switching modes tore
 * down GPS detections and map markers but left the VE PANEL on screen, wired to
 * a mode that can no longer serve it. See the block's own header for the two
 * directions.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mapInstances: FakeMap[] = [];
let mapInitializeBehaviour: () => Promise<void> = () => Promise.resolve();

class FakeMap {
	public destroyed = false;
	public selectedLaps: number[] = [];

	constructor(containerId: string) {
		if (!document.getElementById(containerId)) {
			throw new Error(`Container with id '${containerId}' not found`);
		}
		mapInstances.push(this);
	}

	async initialize(): Promise<void> {
		return mapInitializeBehaviour();
	}
	setData(): void {}
	setSelectedLaps(laps: number[]): void {
		this.selectedLaps = laps;
	}
	destroy(): void {
		this.destroyed = true;
	}
	clearDetectedLaps(): void {}
	clearGpsMarker(): void {}
	clearOutAndBackMarkers(): void {}
	showDetectedLaps(): void {}
	showOutAndBackSections(): void {}
	fitBoundsToTrimRegion(): void {}
	setGpsMarker(): void {}
	setOutAndBackMarkerA(): void {}
	setOutAndBackMarkerB(): void {}
	showWindIndicator(): void {}
	hideWindIndicator(): void {}
	getRoutePoints(): [number, number][] {
		return [];
	}
}

vi.mock("../../components/MapVisualization", () => ({
	MapVisualization: class {
		constructor(containerId: string) {
			return new FakeMap(containerId) as unknown as never;
		}
	},
}));

/**
 * GPS-02. The two things a jsdom process genuinely cannot run, and only those.
 *
 * `getGpsAnalysisMode` is DELIBERATELY NOT MOCKED here, unlike
 * `standardModeRealChain.test.ts:100-103` and `gpsModeRealChain.test.ts:67-70`.
 * That mock pins the dropdown to the mode under test, and it is precisely why
 * BL-1 was never caught: the real module-level `currentGpsAnalysisMode`, moved
 * by the real `setGpsAnalysisMode`, is the thing under test.
 */
const calculatorCalls = vi.hoisted(
	() => [] as Array<{ cda: number; crr: number }>,
);

vi.mock("../../analysis/VeCalculatorFactory", () => ({
	createVeCalculator: (input: { cda: number; crr: number; timestamps: number[] }) => {
		calculatorCalls.push({ cda: input.cda, crr: input.crr });
		const n = input.timestamps.length;
		return {
			calculate_virtual_elevation: () => ({
				virtual_elevation: new Float64Array(n).fill(1),
				r2: 0.5,
				rmse: 1,
				ve_elevation_diff: 2,
				actual_elevation_diff: 3,
				virtual_distance_air: 0,
				virtual_distance_ground: 0,
				vd_difference_percent: 0,
			}),
		};
	},
}));

/** The GPS-lap overlay's far end: the functions that actually paint a figure. */
const gpsLapDraw = vi.hoisted(() => ({
	ve: vi.fn(),
	wind: vi.fn(),
	power: vi.fn(),
	vd: vi.fn(),
}));

vi.mock("../gpsLap/gpsLapPlots", async (importOriginal) => ({
	...(await importOriginal<Record<string, unknown>>()),
	renderGpsLapVEPlots: (...args: unknown[]) => gpsLapDraw.ve(...args),
	renderGpsLapWindPlot: (...args: unknown[]) => gpsLapDraw.wind(...args),
	renderGpsLapPowerPlot: (...args: unknown[]) => gpsLapDraw.power(...args),
	renderGpsLapVdPlot: (...args: unknown[]) => gpsLapDraw.vd(...args),
}));

import {
	configureSection3Orchestration,
	setGpsAnalysisMode,
} from "./section3Orchestration";
import { AppState } from "../../state/AppState";
import type { AnalysisParameters } from "../../components/AnalysisParameters";
import type { PreparedAnalysisSelection } from "../../modes/analysis/types";
import type { ParameterStorage } from "../../utils/ParameterStorage";
import type { ResultsStorage } from "../../utils/ResultsStorage";
import type { ShellServices } from "../analysis/types";
import { gpsLapMode } from "../../modes/analysis/gpsLapMode";
import { standardMode } from "../../modes/analysis/standardMode";
import {
	clearModeUpdateCallbacks,
	getModeUpdateCallbacks,
	registerModeUpdateCallbacks,
	type ModeUpdateContext,
} from "../analysis/modeUpdateCallbacks";
import { resetRecomputeThrottle } from "../analysis/recomputeRunner";
import { resetModeUpdateRequests } from "../analysis/requestModeUpdate";
import { handleStoreResult } from "../analysis/storageHandlers";
import { showGpsLapVEPlot } from "../gpsLap/renderGpsLap";
import { showVirtualElevationAnalysisInline } from "../ve/renderStandardVe";

const SAMPLE_COUNT = 200;
const HALF = SAMPLE_COUNT / 2;

/**
 * BOTH subtrees, because a Section-3 mode change touches both and they must not
 * wipe each other:
 *
 *   - `#analysisSection > #results` is what `rerenderSection3` REPLACES, and
 *     where `renderSection3Template` emits the `#mapView` the FakeMap needs;
 *   - `#veAnalysisSection > #veAnalysisContent` is what the VE render entry
 *     points fill, and what the GPS-02 teardown has to hide.
 *
 * `#veAnalysisSection` starts WITHOUT `hidden`: `requestModeUpdate` refuses to
 * schedule while the panel is off screen (`isVeSectionVisible`), so a fixture
 * that got that wrong would pass for the wrong reason.
 */
function setupDom() {
	document.body.innerHTML = `
        <div id="analysisSection">
            <div id="results"></div>
        </div>
        <div id="veAnalysisSection">
            <div id="veAnalysisContent"></div>
        </div>
    `;
}

const PARAMS = {
	cda: 0.25,
	cda_min: 0.1,
	cda_max: 0.5,
	crr: 0.0042,
	crr_min: 0.001,
	crr_max: 0.02,
	air_speed_offset: 0,
	wind_speed: 3,
	wind_direction: 90,
	wind_height_factor: 1,
	velodrome: false,
	auto_calculate_rho: false,
} as unknown as AnalysisParameters;

function makeAppState(): AppState {
	const appState = new AppState();
	appState.currentFileHash = null;
	const timestamps = Array.from({ length: SAMPLE_COUNT }, (_, i) => i);
	const zeros = () => new Array<number>(SAMPLE_COUNT).fill(0);
	// GPS data present -- the maintainer's scenario. This is what routes the
	// post-render hook through the map branch the previous test skipped.
	//
	// The non-GPS channels below are for the GPS-02 block: the VE render entry
	// points and the update primitive read them. The three original tests never
	// look at them.
	appState.currentFitResult = {
		parsing_statistics: { has_gps_data: true },
		fit_data: {
			timestamps,
			position_lat: timestamps.map(() => 52.52),
			position_long: timestamps.map(() => 13.405),
			distance: timestamps.map((t) => t * 10),
			power: zeros().map(() => 200),
			velocity: zeros().map(() => 10),
			altitude: zeros(),
			air_speed: zeros().map(() => 10),
			wind_speed: zeros(),
			wind_yaw: zeros(),
			air_density_data: zeros(),
			road_speed: zeros(),
			temperature: zeros().map(() => 20),
			cda_reference: null,
		},
		laps: [
			{
				total_elapsed_time: 60,
				total_distance: 1000,
				avg_power: 200,
				start_time: 0,
				end_time: SAMPLE_COUNT - 1,
			},
			{
				total_elapsed_time: 60,
				total_distance: 1000,
				avg_power: 200,
				start_time: SAMPLE_COUNT,
				end_time: SAMPLE_COUNT * 2,
			},
		],
	} as never;
	appState.selectedLaps = [1];
	appState.currentParameters = { ...PARAMS };
	appState.activeDisplayProfile = "fit-raw";
	appState.demProfilesAvailable = true;
	return appState;
}

/**
 * Stand-in for the real `updateAnalyzeButton`: importing the analyze
 * orchestrator would drag in Plotly, Leaflet and the WASM glue. It reproduces
 * the only part this defect is about -- reflecting the current selection onto
 * the button the template rendered `disabled`.
 */
function makeUpdateAnalyzeButton(appState: AppState) {
	return vi.fn(() => {
		const btn = document.getElementById("analyzeBtn") as HTMLButtonElement | null;
		if (!btn) return;
		btn.disabled = appState.selectedLaps.length === 0;
	});
}

function configure(
	appState: AppState,
	updateAnalyzeButton: () => void,
	setupAnalyzeButton: () => void,
) {
	configureSection3Orchestration({
		appState,
		parameterStorage: {
			loadLapSettings: () => Promise.resolve(null),
			saveLapSettings: () => Promise.resolve(),
		} as never,
		getMapVisualization: () =>
			(mapInstances.find((m) => !m.destroyed) ?? null) as never,
		setMapVisualization: () => {},
		getParametersComponent: () => null,
		updateAnalyzeButton,
		setupAnalyzeButton,
		showLoading: () => {},
		hideLoading: () => {},
		showError: () => {},
	});
}

/**
 * Drive the maintainer's sequence: pick a FIT lap, run an analysis in GPS lap
 * splitting mode, then switch the mode selector back to None -- with no
 * deselect/reselect anywhere.
 */
async function selectLapAnalyseThenSwitchToNone(appState: AppState) {
	vi.useFakeTimers();
	try {
		setGpsAnalysisMode("GPS based lap splitting");
		await vi.advanceTimersByTimeAsync(500);

		// An analysis has been run: GPS laps were detected and selected, which is
		// the state the mode switch has to unwind.
		appState.gpsDetectedLaps = [{ lapNumber: 1 }] as never;
		appState.gpsSelectedLaps = [1];

		setGpsAnalysisMode("None");
		await vi.advanceTimersByTimeAsync(500);
	} finally {
		vi.useRealTimers();
	}
}

describe("Section 3 re-render after a GPS analysis mode switch", () => {
	beforeEach(() => {
		setupDom();
		mapInstances.length = 0;
		mapInitializeBehaviour = () => Promise.resolve();
		vi.clearAllMocks();
	});

	it("restores the trim sliders and the Analyze button without a deselect/reselect", async () => {
		const appState = makeAppState();
		const updateAnalyzeButton = makeUpdateAnalyzeButton(appState);
		const setupAnalyzeButton = vi.fn();
		configure(appState, updateAnalyzeButton, setupAnalyzeButton);

		await selectLapAnalyseThenSwitchToNone(appState);

		// The lap survives the re-render, so the user sees a valid selection...
		const lapCheckbox = document.querySelector<HTMLInputElement>(
			'.lap-checkbox-item[data-lap="1"] input.lap-checkbox',
		);
		expect(lapCheckbox?.checked).toBe(true);

		// ...and both things that selection gates must be back with it.
		const mapTrimControls = document.getElementById("mapTrimControls");
		expect(mapTrimControls).not.toBeNull();
		expect(mapTrimControls?.classList.contains("hidden")).toBe(false);

		const analyzeBtn = document.getElementById(
			"analyzeBtn",
		) as HTMLButtonElement | null;
		expect(setupAnalyzeButton).toHaveBeenCalled();
		expect(analyzeBtn?.disabled).toBe(false);
	});

	it("restores them even when the map teardown/re-init fails", async () => {
		const appState = makeAppState();
		const updateAnalyzeButton = makeUpdateAnalyzeButton(appState);
		const setupAnalyzeButton = vi.fn();
		configure(appState, updateAnalyzeButton, setupAnalyzeButton);

		// Section 3's controls have no dependency on the map, so a map failure
		// must not be able to take them down. Before the fix they were sequenced
		// behind the awaited map work inside the same try, and this rejection
		// swallowed the entire re-binding.
		mapInitializeBehaviour = () =>
			Promise.reject(new Error("Map container is being reused by another instance"));

		await selectLapAnalyseThenSwitchToNone(appState);

		const mapTrimControls = document.getElementById("mapTrimControls");
		expect(mapTrimControls?.classList.contains("hidden")).toBe(false);

		const analyzeBtn = document.getElementById(
			"analyzeBtn",
		) as HTMLButtonElement | null;
		expect(setupAnalyzeButton).toHaveBeenCalled();
		expect(updateAnalyzeButton).toHaveBeenCalled();
		expect(analyzeBtn?.disabled).toBe(false);
	});

	it("keeps the FIT trim sliders hidden in GPS lap splitting mode", async () => {
		// The restoration must not become a blanket "always show": GPS splitting
		// modes have their own selection model and the template does not even
		// emit #mapTrimControls for them.
		const appState = makeAppState();
		const updateAnalyzeButton = makeUpdateAnalyzeButton(appState);
		configure(appState, updateAnalyzeButton, vi.fn());

		vi.useFakeTimers();
		try {
			setGpsAnalysisMode("GPS based lap splitting");
			await vi.advanceTimersByTimeAsync(500);
		} finally {
			vi.useRealTimers();
		}

		expect(document.getElementById("mapTrimControls")).toBeNull();
	});
});

/**
 * GPS-02 / milestone-audit finding BL-1: the VE PANEL after a Section-3 mode
 * change.
 *
 * `setGpsAnalysisMode` cleared GPS detections and map markers but never touched
 * the VE panel, `isGpsLapModeActive`, the analysis-result state, or the
 * registered mode-update callbacks. Two independent failure directions:
 *
 * DIRECTION 1 — Standard analyzed, dropdown moved to a GPS mode.
 *   `isGpsLapModeActive` is false, so `resolveActiveModeHandler` consults the
 *   dropdown and the funnel points at a mode with no renderers. Sliders move and
 *   nothing updates. With a stale `gpsLap` factory left in `FACTORIES` by an
 *   earlier GPS analyze in the same session -- which is production's real
 *   condition, since nothing ever cleared it -- the funnel instead reaches that
 *   stale factory. Dead either way.
 *
 * DIRECTION 2 — GPS-lap analyzed, dropdown moved to None.
 *   `isGpsLapModeActive` is STILL true, so the flag branch short-circuits the
 *   dropdown entirely and the funnel keeps recomputing on an analysis whose
 *   detections `setGpsAnalysisMode` just cleared. Silently wrong, not visibly
 *   dead.
 *
 * THE BAR. This area has passed regression tests three times while the bug was
 * live, so:
 *   - nothing here mocks `getGpsAnalysisMode` or `section3Orchestration`; the
 *     real module-level mode moved by the real `setGpsAnalysisMode` is the thing
 *     under test;
 *   - nothing here calls `configureModeUpdateRequests`. The analyze goes through
 *     a real render entry point, which calls `bindModeControls`, which is the
 *     only caller of it (`bindModeControls.ts:154`). A test that supplies wiring
 *     production is missing cannot observe it missing;
 *   - direction 1 is driven in the STALE-FACTORY configuration, because without
 *     it "the funnel did nothing" is true of the pre-fix code too and the
 *     assertion would be vacuous.
 */

const GPS_RANGES = [
	{ startIdx: 0, endIdx: HALF - 1 },
	{ startIdx: HALF, endIdx: SAMPLE_COUNT - 1 },
];

const INITIAL_RESULT = {
	r2: 0.5,
	rmse: 1,
	ve_elevation_diff: 2,
	actual_elevation_diff: 3,
};

/** A probe context for `getModeUpdateCallbacks`; only the lookup matters. */
const PROBE_CONTEXT: ModeUpdateContext = {
	windSource: "fit",
	cda: 0.25,
	crr: 0.0042,
	appliedCrr: 0.0042,
};

const NOOP_CALLBACKS = {
	aggregate: () => ({}) as never,
	renderVe: () => {},
	renderWind: () => {},
	renderPower: () => {},
	renderVd: () => {},
	renderMetrics: () => {},
};

function makeServices(appState: AppState): ShellServices {
	return {
		appState,
		showLoading: () => {},
		hideLoading: () => {},
		showError: () => {},
	} as unknown as ShellServices;
}

const lapProfile = (lapNumber: number) => ({
	lapNumber,
	range: GPS_RANGES[lapNumber - 1],
	distances: [0, 1, 2],
	virtualElevation: [0, 1, 2],
	actualElevation: [0, 1, 2],
	supplementarySeries: null,
	duration: HALF,
	totalDistance: 2,
});

/** Drain `rerenderSection3`'s 100 ms hook and the recompute throttle. */
async function settle(): Promise<void> {
	await vi.advanceTimersByTimeAsync(500);
}

/**
 * A STANDARD analyze, in `analyzeOrchestrator`'s own order (`syncState`, then
 * its `renderStitched` closure) and through the real `standardMode.syncState`
 * rather than hand-set flags.
 *
 * The `currentVEResult` assignment below STANDS IN for the write production
 * makes at the end of an analyze, and it is no longer a copy of an orchestrator
 * line: WR-4 deleted `analyzeOrchestrator`'s own assignment of the stitched
 * `initialResult`, leaving `handler.summarize` -- reached through the update
 * primitive by every mode's post-bind kick -- as the one writer. What these
 * tests need from it is unchanged: a non-null result standing for "an analyze
 * happened", so the teardown assertions have something to observe being cleared.
 */
async function analyzeStandard(appState: AppState): Promise<void> {
	appState.currentVEResult = INITIAL_RESULT as never;
	standardMode.syncState(appState, standardMode.prepareSelection(appState));

	const fit = appState.currentFitData as unknown as Record<string, number[]>;
	await showVirtualElevationAnalysisInline(
		appState,
		{} as unknown as ParameterStorage,
		null,
		makeServices(appState),
		null,
		{
			onSaveScreenshot: () => {},
			onStoreResult: () => {},
			onExportAll: () => {},
			saveCurrentLapSettings: () => {},
		},
		[1],
		fit.timestamps.map((_, i) => i),
		fit.timestamps,
		fit.power,
		fit.velocity,
		fit.position_lat,
		fit.position_long,
		fit.altitude,
		fit.distance,
		fit.air_speed,
		fit.temperature,
		null,
		0,
	);
}

/**
 * A GPS-LAP analyze, same order, through the real `gpsLapMode.syncState` --
 * which is what sets `isGpsLapModeActive` and `currentGpsLapIndexRanges`.
 *
 * `showGpsLapVEPlot` does NOT call `syncState` itself; only the orchestrator
 * does, for every mode. Driving it here is what makes direction 2's starting
 * state the one production actually produces.
 */
async function analyzeGpsLap(appState: AppState): Promise<void> {
	appState.currentVEResult = INITIAL_RESULT as never;
	gpsLapMode.syncState(appState, {
		mode: "gpsLap",
		selectedItems: [1, 2],
		selectedEntries: [],
		indexRanges: GPS_RANGES,
		timeRanges: null,
		outAndBackSections: null,
		emptySelectionMessage: "",
	} as unknown as PreparedAnalysisSelection);

	await showGpsLapVEPlot(
		makeServices(appState),
		{} as unknown as ParameterStorage,
		{} as unknown as ResultsStorage,
		async () => ({}),
		[lapProfile(1), lapProfile(2)] as never,
		{ distances: [0, 1, 2], elevation: [0, 1, 2] },
		appState.currentParameters!,
		true,
		true,
		0,
		"fit",
	);
}

/** A real user gesture on the real slider the panel rendered. */
async function dragCda(value: number): Promise<void> {
	const slider = document.getElementById("cdaSlider") as HTMLInputElement | null;
	if (!slider) throw new Error("#cdaSlider is not in the rendered panel");
	slider.value = value.toString();
	slider.dispatchEvent(new Event("input", { bubbles: true }));
	await settle();
}

function veSectionHidden(): boolean {
	const section = document.getElementById("veAnalysisSection");
	if (!section) throw new Error("#veAnalysisSection is not on the page");
	return section.classList.contains("hidden");
}

/**
 * Drive the real `handleStoreResult` end to end and report whether it persisted.
 *
 * The OK click matters: pre-fix the guards pass and the notes dialog goes up, so
 * a promise left unanswered would never settle and "saveResult was never called"
 * would be true for the wrong reason -- exactly the vacuity this file guards
 * against. `showNotesDialog` appends its markup synchronously, so the dialog is
 * already in the DOM by the time `handleStoreResult` first suspends.
 */
async function attemptStoreResult(appState: AppState) {
	const saveResult = vi.fn(async () => {});
	const pending = handleStoreResult(appState, {
		saveResult,
	} as unknown as ResultsStorage);
	await Promise.resolve();
	document
		.querySelector<HTMLButtonElement>(".notes-dialog #notesOkBtn")
		?.click();
	await pending;
	return saveResult;
}

describe("GPS-02: the VE panel after a Section 3 mode change", () => {
	beforeEach(() => {
		vi.useFakeTimers();
		setupDom();
		mapInstances.length = 0;
		mapInitializeBehaviour = () => Promise.resolve();
		// jsdom has no layout, so the renders' closing scroll would throw.
		Element.prototype.scrollIntoView = () => {};
		// `waitForPlotly` resolves immediately once `window.Plotly` is set
		// (`plotlyLoader.ts:39-42`), so no loader mock is needed.
		(globalThis as unknown as { Plotly: unknown }).Plotly = {
			newPlot: () => Promise.resolve(),
			react: () => Promise.resolve(),
			relayout: () => Promise.resolve(),
			purge: () => {},
		};
		window.alert = vi.fn();
		calculatorCalls.length = 0;
		gpsLapDraw.ve.mockClear();
		gpsLapDraw.wind.mockClear();
		gpsLapDraw.power.mockClear();
		gpsLapDraw.vd.mockClear();
		clearModeUpdateCallbacks();
		resetModeUpdateRequests();
	});

	afterEach(() => {
		// FIRST, and before `useRealTimers` -- `scheduleRecompute` guards on a
		// MODULE-LEVEL handle, so a recompute left armed on a fake timer that
		// `useRealTimers` then discards makes the NEXT test unable to arm its own.
		// The landmine closed in `8aa9329`.
		resetRecomputeThrottle();
		vi.useRealTimers();
		clearModeUpdateCallbacks();
		resetModeUpdateRequests();
	});

	/**
	 * `currentGpsAnalysisMode` is module-level and leaks between tests in this
	 * file, so every test states its starting mode. Setting the mode it is
	 * already on is a no-op by design (`previousMode !== mode`), which is what
	 * makes this safe as a normalisation step.
	 */
	async function startInMode(
		appState: AppState,
		mode: Parameters<typeof setGpsAnalysisMode>[0],
	): Promise<void> {
		configure(appState, makeUpdateAnalyzeButton(appState), vi.fn());
		setGpsAnalysisMode(mode);
		await settle();
	}

	it("direction 1: tears the panel down when Standard is analyzed and the dropdown moves to a GPS mode", async () => {
		const appState = makeAppState();
		await startInMode(appState, "None");
		await analyzeStandard(appState);
		await settle();

		// PRODUCTION'S REAL CONDITION. `FACTORIES` was never cleared, so a
		// `gpsLap` factory registered by an earlier GPS analyze in the same
		// session is still reachable. Without this the pre-fix funnel bails at the
		// missing-callbacks lookup and "nothing happened" proves nothing.
		const staleGpsLapFactory = vi.fn(() => NOOP_CALLBACKS as never);
		registerModeUpdateCallbacks("gpsLap", staleGpsLapFactory);

		expect(veSectionHidden()).toBe(false);
		expect(appState.currentVEResult).not.toBeNull();

		calculatorCalls.length = 0;
		staleGpsLapFactory.mockClear();

		setGpsAnalysisMode("GPS based lap splitting");
		await settle();
		await dragCda(0.42);

		// The user-visible half of the defect.
		expect(veSectionHidden()).toBe(true);

		// THE NON-VACUOUS DRAG ASSERTION. Pre-fix the funnel resolves the gpsLap
		// handler off the dropdown and INVOKES this stale factory. Post-fix it
		// bails at the visibility gate, and `FACTORIES` no longer holds it anyway
		// -- two independent guards.
		expect(staleGpsLapFactory).not.toHaveBeenCalled();
		// Corroborating, not load-bearing: with no GPS ranges the primitive would
		// return null before reaching the calculator even pre-fix.
		expect(calculatorCalls).toEqual([]);

		// The observable form of "FACTORIES was cleared".
		expect(getModeUpdateCallbacks("gpsLap", PROBE_CONTEXT)).toBeNull();
		expect(getModeUpdateCallbacks("standard", PROBE_CONTEXT)).toBeNull();

		expect(appState.currentVEResult).toBeNull();
		expect(appState.currentFilteredData).toBeNull();
	});

	it("direction 2: tears the panel down when GPS-lap is analyzed and the dropdown moves to None", async () => {
		const appState = makeAppState();
		await startInMode(appState, "GPS based lap splitting");
		await analyzeGpsLap(appState);
		await settle();

		expect(appState.isGpsLapModeActive).toBe(true);
		expect(veSectionHidden()).toBe(false);

		calculatorCalls.length = 0;
		gpsLapDraw.ve.mockClear();

		setGpsAnalysisMode("None");
		await settle();
		await dragCda(0.42);

		// The single assertion that most directly names direction 2: while this is
		// true, `resolveActiveModeHandler` never consults the dropdown at all.
		expect(appState.isGpsLapModeActive).toBe(false);

		// Pre-fix the funnel recomputes here, because the flag short-circuits the
		// dropdown and the gpsLap callbacks are still registered.
		expect(calculatorCalls).toEqual([]);
		expect(gpsLapDraw.ve).not.toHaveBeenCalled();

		expect(veSectionHidden()).toBe(true);
		expect(appState.currentGpsLapIndexRanges).toBeNull();
	});

	/**
	 * NEW-1, from the round-2 milestone audit.
	 *
	 * The teardown resets state SYNCHRONOUSLY, but `requestModeUpdate` resolves
	 * `handler`/`callbacks`/`segments` BEFORE it schedules and captures them in a
	 * closure. Neither `clearModeUpdateCallbacks()` nor the `hidden` class can
	 * reach a pass that is already armed: the callbacks object is resolved, and
	 * the visibility gate lives in `requestModeUpdate`, not in the scheduled run.
	 *
	 * So a drag landing inside the throttle's armed window, followed by a mode
	 * change before it fires, used to let the pass complete and REPOPULATE six of
	 * the nine fields the teardown had just cleared — falsifying the guarantee
	 * `tearDownVeAnalysisPanel`'s own comment asserts.
	 *
	 * The window is narrow (~20ms of armed throttle) and Store Result lives inside
	 * the hidden panel, so this was a warning rather than a blocker. It is closed
	 * anyway, because "usually holds" is not what the comment claims.
	 */
	it("an already-armed recompute cannot repopulate the reset state (NEW-1)", async () => {
		const appState = makeAppState();
		await startInMode(appState, "GPS based lap splitting");
		await analyzeGpsLap(appState);
		await settle();

		// Precondition: there is real state to lose.
		expect(appState.currentVEResult).not.toBeNull();
		expect(appState.currentFilteredData).not.toBeNull();

		calculatorCalls.length = 0;
		gpsLapDraw.ve.mockClear();

		// ARM the recompute but do NOT let it fire — no settle here. This is the
		// whole point: the pass is scheduled and its closure already holds the
		// resolved callbacks.
		const slider = document.getElementById("cdaSlider") as HTMLInputElement;
		slider.value = "0.42";
		slider.dispatchEvent(new Event("input", { bubbles: true }));

		// The mode change lands INSIDE that armed window.
		setGpsAnalysisMode("None");

		// Now let every timer run to completion.
		await settle();

		// The teardown's guarantee must survive the pass that was already armed.
		expect(appState.currentVEResult).toBeNull();
		expect(appState.currentFilteredData).toBeNull();
		expect(appState.currentWindSource).toBe("none");
		expect(appState.currentCoveredItems).toBeNull();
		expect(gpsLapDraw.ve).not.toHaveBeenCalled();
	});

	it("direction 1: Store Result cannot persist a record after the mode change", async () => {
		const appState = makeAppState();
		appState.selectedFile = { name: "ride.fit" } as unknown as File;
		await startInMode(appState, "None");
		await analyzeStandard(appState);
		await settle();

		// The control: before the mode change this same call DOES store, so the
		// refusal below is the mode change's doing and not a broken fixture.
		expect(await attemptStoreResult(appState)).toHaveBeenCalledTimes(1);

		setGpsAnalysisMode("GPS based lap splitting");
		await settle();

		expect(await attemptStoreResult(appState)).not.toHaveBeenCalled();
	});

	it("direction 2: Store Result cannot persist a record after the mode change", async () => {
		const appState = makeAppState();
		appState.selectedFile = { name: "ride.fit" } as unknown as File;
		await startInMode(appState, "GPS based lap splitting");
		await analyzeGpsLap(appState);
		await settle();

		expect(await attemptStoreResult(appState)).toHaveBeenCalledTimes(1);

		setGpsAnalysisMode("None");
		await settle();

		expect(await attemptStoreResult(appState)).not.toHaveBeenCalled();
	});

	it("a no-op mode set tears nothing down", async () => {
		// Pins the teardown to `previousMode !== mode`. A blanket "tear down on
		// every call" would break the Analyze path itself, which sets the mode it
		// is already on all the time.
		const appState = makeAppState();
		await startInMode(appState, "None");
		await analyzeStandard(appState);
		await settle();

		calculatorCalls.length = 0;

		setGpsAnalysisMode("None");
		await settle();

		expect(veSectionHidden()).toBe(false);
		expect(appState.currentVEResult).not.toBeNull();
		expect(getModeUpdateCallbacks("standard", PROBE_CONTEXT)).not.toBeNull();

		await dragCda(0.42);

		expect(calculatorCalls.length).toBeGreaterThan(0);
		for (const call of calculatorCalls) {
			expect(call.cda).toBeCloseTo(0.42, 6);
		}
	});
});
