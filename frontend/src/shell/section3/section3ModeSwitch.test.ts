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
	// Counted, not ignored: the new-activity reset is supposed to clear all
	// three, and a no-op stub cannot tell whether it did.
	public cleared = { detectedLaps: 0, gpsMarker: 0, outAndBackMarkers: 0 };
	clearDetectedLaps(): void {
		this.cleared.detectedLaps++;
	}
	clearGpsMarker(): void {
		this.cleared.gpsMarker++;
	}
	clearOutAndBackMarkers(): void {
		this.cleared.outAndBackMarkers++;
	}
	showDetectedLaps(): void {}
	showOutAndBackSections(): void {}
	fitBoundsToTrimRegion(): void {}
	setGpsMarker(): void {}
	// Out-and-back's gate markers. Absent until the new-activity block exercised
	// that mode, where the miss surfaced as an UNHANDLED rejection rather than a
	// failing assertion -- noise that hides real failures in this file's output.
	// COUNTED, and these two specifically: `bindOutAndBackDetection` paints its
	// A/B gates through `setGpsMarkerA`/`setGpsMarkerB` (`:131-132`), while
	// `bindGpsDetection` uses the singular `setGpsMarker` (`:107`). So a count on
	// the pair is a clean signal for "the OUT-AND-BACK closure ran", with no
	// contribution from the GPS-lap binder.
	//
	// It has to be the markers rather than the detection itself: the real
	// detector finds nothing on this file's constant coordinates, so "the
	// detection came back" is indistinguishable from "it stayed cleared".
	public oabMarkerPaints = 0;
	setGpsMarkerA(): void {
		this.oabMarkerPaints++;
	}
	setGpsMarkerB(): void {
		this.oabMarkerPaints++;
	}
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
	getGpsAnalysisMode,
	handleOutAndBackSectionSelectionChange,
	initializeSection3,
	resetAnalysisForNewActivity,
	setGpsAnalysisMode,
	updateSelectedLaps,
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
			onShowAllResults: () => {},
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

/** Ids `Plotly.purge` was called on, in order. */
const purged: string[] = [];

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
		purged.length = 0;
		(globalThis as unknown as { Plotly: unknown }).Plotly = {
			newPlot: () => Promise.resolve(),
			react: () => Promise.resolve(),
			relayout: () => Promise.resolve(),
			// Records rather than ignores (NEW-2): the teardown is supposed to
			// reach this, and a no-op stub cannot tell whether it did.
			purge: (gd: Element) => {
				purged.push((gd as HTMLElement).id);
			},
			Plots: { resize: () => Promise.resolve() },
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

	/**
	 * NEW-2, from the round-2 milestone audit.
	 *
	 * The teardown hides the panel and deliberately keeps its markup — the next
	 * render replaces it wholesale. What it did NOT do was tell Plotly, so the
	 * figure data, layout, drag handlers and `responsive` window listener behind
	 * every graph in that panel stayed reachable until the next analyze.
	 * `Plotly.purge` had zero callers anywhere in `src`.
	 *
	 * Bounded at one panel's worth — one panel is live at a time — so this is
	 * memory and a stray listener rather than correctness. It is closed because
	 * the release point is knowable and `purge` is the call that knows how.
	 */
	it("releases the panel's Plotly graphs on the way out (NEW-2)", async () => {
		const appState = makeAppState();
		await startInMode(appState, "GPS based lap splitting");
		await analyzeGpsLap(appState);
		await settle();

		// The graphs the render left behind. Every plot in every mode is a
		// `.ve-plot-container__plot` nested inside its bordered box, so that is
		// the set of graph divs. `js-plotly-plot` is the class Plotly stamps on a
		// div it has plotted into, and the fake does not, so they are marked here
		// — this case is about the teardown reaching them, not about what the
		// fake stamps.
		const content = document.getElementById("veAnalysisContent")!;
		content.querySelectorAll(".ve-plot-container__plot").forEach(node => {
			node.classList.add("js-plotly-plot");
		});
		const plotted = content.querySelectorAll(".js-plotly-plot").length;
		expect(plotted).toBeGreaterThan(0);
		purged.length = 0;

		setGpsAnalysisMode("None");
		await settle();

		expect(veSectionHidden()).toBe(true);
		expect(purged).toHaveLength(plotted);
	});

	it("purges nothing when the panel holds no graphs, and does not throw", async () => {
		// A mode change before any analyze. `Plots.purge` throws on a div it never
		// plotted, so the marker class is the guard and this is the case that
		// shows it holds.
		const appState = makeAppState();
		await startInMode(appState, "GPS based lap splitting");
		await settle();
		purged.length = 0;

		expect(() => setGpsAnalysisMode("None")).not.toThrow();
		await settle();

		expect(purged).toEqual([]);
	});

	/**
	 * The other half of NEW-2: a 250 ms status flash that outlives the panel.
	 *
	 * `resetRecomputeThrottle` clears the THROTTLE timer; the "Updated" flash is
	 * a separate one it never touched. It fired after the teardown and asked for
	 * status "idle" — and going idle used to run through `ensureStatusNode`,
	 * which BUILDS a pill wherever it fails to find one. So hiding the pill
	 * created one, inside the panel the teardown had just hidden.
	 */
	it("does not mint a status pill into the panel it just tore down (NEW-2)", async () => {
		const appState = makeAppState();
		await startInMode(appState, "GPS based lap splitting");
		await analyzeGpsLap(appState);
		await settle();

		// Arm the flash and STOP SHORT of it firing. `settle()` advances 500 ms,
		// which would run the 250 ms timer before the teardown and make this
		// case vacuous -- so the drag is hand-rolled and the clock is advanced
		// by less than the flash interval.
		const slider = document.getElementById("cdaSlider") as HTMLInputElement;
		slider.value = "0.42";
		slider.dispatchEvent(new Event("input", { bubbles: true }));
		await vi.advanceTimersByTimeAsync(100);

		// Precondition: the recompute finished and armed the flash, so there is
		// a live timer for the teardown to have to deal with.
		expect(document.getElementById("veRecomputeStatus")).not.toBeNull();
		document.getElementById("veRecomputeStatus")!.remove();

		setGpsAnalysisMode("None");

		// Past the 250 ms flash interval: if the timer survived the teardown it
		// fires here, and going idle would rebuild the pill it meant to hide.
		await vi.advanceTimersByTimeAsync(500);

		expect(document.getElementById("veRecomputeStatus")).toBeNull();
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

/**
 * The VE panel after a Section-3 SELECTION change.
 *
 * Same argument as GPS-02 above, one step down. `tearDownVeAnalysisPanel`'s own
 * comment gives the rule -- "the basis is gone, so the results computed from it
 * go too. The user re-Analyzes." -- and a mode change is not the only way the
 * basis goes. Changing the lap checkboxes, the out-and-back section checkboxes,
 * or re-running gate detection all replace the input the panel was computed
 * from, and none of them touched the panel: the plot kept the old selection's
 * curve while the sidebar controls that read `selectedLaps` directly moved to
 * the new one. Reported from the running app, 2026-08-31.
 *
 * THE GUARD IS THE INTERESTING HALF. `updateSelectedLaps()` is not only an event
 * handler -- Section 3's post-render hook calls it to reconcile re-rendered
 * markup with the retained selection (the first describe block in this file is
 * about exactly that), and `rerenderSection3` runs on every mode change. So an
 * unconditional teardown here would destroy a valid panel on ordinary
 * re-renders, and the tests below pin both directions: it goes when the basis
 * moved, and it STAYS when the call is a reconciliation that changed nothing.
 */
describe("the VE panel after a Section 3 selection change", () => {
	beforeEach(() => {
		vi.useFakeTimers();
		setupDom();
		mapInstances.length = 0;
		mapInitializeBehaviour = () => Promise.resolve();
		Element.prototype.scrollIntoView = () => {};
		purged.length = 0;
		(globalThis as unknown as { Plotly: unknown }).Plotly = {
			newPlot: () => Promise.resolve(),
			react: () => Promise.resolve(),
			relayout: () => Promise.resolve(),
			purge: (gd: Element) => {
				purged.push((gd as HTMLElement).id);
			},
			Plots: { resize: () => Promise.resolve() },
		};
		window.alert = vi.fn();
		calculatorCalls.length = 0;
		clearModeUpdateCallbacks();
		resetModeUpdateRequests();
	});

	afterEach(() => {
		resetRecomputeThrottle();
		vi.useRealTimers();
		clearModeUpdateCallbacks();
		resetModeUpdateRequests();
	});

	/**
	 * The lap list Section 3 renders, reduced to the two attributes
	 * `updateSelectedLaps` actually reads: `.lap-checkbox:checked` and the
	 * enclosing `.lap-checkbox-item[data-lap]`.
	 *
	 * `#mapTrimControls` is deliberately absent, so the trim-control branch --
	 * which would pull in Leaflet and auto-rho -- stays out of these tests.
	 */
	function renderLapCheckboxes(laps: number[], checked: number[]): void {
		const results = document.getElementById("results");
		if (!results) throw new Error("#results is not on the page");
		results.innerHTML = laps
			.map(
				(lap) => `
        <div class="lap-checkbox-item" data-lap="${lap}">
            <input type="checkbox" class="lap-checkbox"${checked.includes(lap) ? " checked" : ""}>
        </div>`,
			)
			.join("");
	}

	/** The same, for the out-and-back section list. */
	function renderSectionCheckboxes(
		sections: number[],
		checked: number[],
	): void {
		const results = document.getElementById("results");
		if (!results) throw new Error("#results is not on the page");
		results.innerHTML = sections
			.map(
				(section) => `
        <div class="lap-checkbox-item" data-oab-section="${section}">
            <input type="checkbox" class="oab-section-checkbox"${checked.includes(section) ? " checked" : ""}>
        </div>`,
			)
			.join("");
	}

	async function analyzedStandardPanel(): Promise<AppState> {
		const appState = makeAppState();
		configure(appState, makeUpdateAnalyzeButton(appState), vi.fn());
		setGpsAnalysisMode("None");
		await settle();
		await analyzeStandard(appState);
		await settle();
		return appState;
	}

	it("tears the panel down when the lap selection moves off the analyzed laps", async () => {
		const appState = await analyzedStandardPanel();

		expect(veSectionHidden()).toBe(false);
		expect(appState.currentVEResult).not.toBeNull();
		expect(appState.currentAnalyzedLaps).toEqual([1]);

		renderLapCheckboxes([1, 2, 3], [2]);
		updateSelectedLaps();
		await settle();

		expect(veSectionHidden()).toBe(true);
		expect(appState.currentVEResult).toBeNull();
		expect(appState.currentAnalyzedLaps).toEqual([]);
	});

	it("leaves the panel alone when the call is a re-render that changed nothing", async () => {
		const appState = await analyzedStandardPanel();

		// What Section 3's post-render hook does: re-derive the SAME selection
		// from freshly rendered markup. Tearing down here is the regression the
		// first describe block in this file was written against.
		renderLapCheckboxes([1, 2, 3], [1]);
		updateSelectedLaps();
		await settle();

		expect(veSectionHidden()).toBe(false);
		expect(appState.currentVEResult).not.toBeNull();
	});

	it("stays torn down when the selection returns to the analyzed set", async () => {
		const appState = await analyzedStandardPanel();

		renderLapCheckboxes([1, 2, 3], [1, 2]);
		updateSelectedLaps();
		await settle();
		expect(veSectionHidden()).toBe(true);

		// Ending where you started does NOT resurrect the panel. The teardown
		// cleared `currentAnalyzedLaps` on the way out, so the guard now reads
		// "nothing analyzed" and does nothing -- which is right: the results are
		// gone and only a re-Analyze can produce them. The user-visible contract
		// is that the panel stays away until Analyze is pressed.
		renderLapCheckboxes([1, 2, 3], [1]);
		updateSelectedLaps();
		await settle();

		expect(veSectionHidden()).toBe(true);
		expect(appState.currentVEResult).toBeNull();
		expect(appState.selectedLaps).toEqual([1]);
	});

	it("does not tear down when nothing has been analyzed yet", async () => {
		const appState = makeAppState();
		configure(appState, makeUpdateAnalyzeButton(appState), vi.fn());
		setGpsAnalysisMode("None");
		await settle();

		// Selecting laps for the FIRST analyze must not be treated as
		// invalidating: there is no panel, and `currentAnalyzedLaps` is empty.
		renderLapCheckboxes([1, 2, 3], [1, 2]);
		expect(() => updateSelectedLaps()).not.toThrow();
		expect(appState.selectedLaps).toEqual([1, 2]);
	});

	/**
	 * A section checkbox NARROWS THE QUESTION; it does not re-cut the ride.
	 *
	 * These two cases used to assert a teardown, which was more destructive than
	 * the change warranted (maintainer, 2026-09-01): the detection underneath is
	 * untouched, so the panel can simply recompute over the ticked subset. A gate
	 * move or a wider FIT window is the other case and still tears down — see
	 * `gateRedetectInvalidation.test.ts`.
	 *
	 * `requestModeUpdate` is deliberately unconfigured in this file, so what is
	 * observable here is the panel SURVIVING and the on-screen section list
	 * having moved to the new subset — which is the state the recompute reads
	 * (`activeOutAndBackSections.ts`). That the funnel then draws it is
	 * `outAndBackFixtureChain.test.ts`' subject, not this file's.
	 */
	function analyzedOutAndBackPanel(appState: AppState, sections: number[]): void {
		const section = (n: number) => ({
			sectionNumber: n,
			outboundStartIdx: (n - 1) * 40,
			outboundEndIdx: (n - 1) * 40 + 19,
			inboundStartIdx: (n - 1) * 40 + 20,
			inboundEndIdx: (n - 1) * 40 + 39,
		});
		appState.outAndBackSections = sections.map(section) as never;
		appState.currentOutAndBackSections = sections.map(section) as never;
		appState.currentCoveredItems = [...sections];
	}

	it("narrows the panel to the ticked sections instead of tearing it down", async () => {
		const appState = await analyzedStandardPanel();
		analyzedOutAndBackPanel(appState, [1, 2, 3]);

		renderSectionCheckboxes([1, 2, 3], [1, 3]);
		handleOutAndBackSectionSelectionChange();
		await settle();

		expect(veSectionHidden()).toBe(false);
		expect(appState.currentVEResult).not.toBeNull();
		expect(
			appState.currentOutAndBackSections.map((s) => s.sectionNumber),
		).toEqual([1, 3]);
	});

	it("leaves the on-screen sections alone when the selection still matches", async () => {
		const appState = await analyzedStandardPanel();
		analyzedOutAndBackPanel(appState, [1, 2]);

		renderSectionCheckboxes([1, 2, 3], [2, 1]);
		handleOutAndBackSectionSelectionChange();
		await settle();

		expect(veSectionHidden()).toBe(false);
		expect(
			appState.currentOutAndBackSections.map((s) => s.sectionNumber),
		).toEqual([1, 2]);
	});

	it("tears the panel down when every section is unticked", async () => {
		const appState = await analyzedStandardPanel();
		analyzedOutAndBackPanel(appState, [1, 2]);

		// Not a narrower question — no question. There is nothing to compute.
		renderSectionCheckboxes([1, 2, 3], []);
		handleOutAndBackSectionSelectionChange();
		await settle();

		expect(veSectionHidden()).toBe(true);
		expect(appState.currentVEResult).toBeNull();
	});

	/**
	 * THE FIT-LAP LIST AND THE GPS-LAP LIST ARE DIFFERENT NAMESPACES THAT LOOK
	 * ALIKE.
	 *
	 * `resolveMultiSegmentAnalysisParams` (`MultiSegmentSettings.ts:84`) writes
	 * `currentAnalyzedLaps` in all three modes, but the numbers mean different
	 * things: FIT lap numbers under Standard, GPS VIRTUAL lap numbers under GPS
	 * lap splitting (`renderGpsLap.ts:103`), section numbers under out-and-back
	 * (`renderOutAndBack.ts:94`). All three count 1..N, so they collide
	 * numerically with the FIT lap list in `selectedLaps` and the guard compared
	 * them as if they were the same list — in BOTH directions. Ticking FIT lap 3
	 * with three GPS laps analysed made `[1,2,3]` match `[1,2,3]` and skipped an
	 * invalidation that was due; the case below is the mirror, where a FIT
	 * selection that merely happens to differ threw away a perfectly good GPS
	 * panel. Only the mirror is observable from here — the missed teardown looks
	 * exactly like a correct no-op — so that is what is pinned.
	 */
	it("does not tear a GPS-lap panel down over the FIT lap checkboxes", async () => {
		const appState = makeAppState();
		configure(appState, makeUpdateAnalyzeButton(appState), vi.fn());
		setGpsAnalysisMode("GPS based lap splitting");
		await settle();
		await analyzeStandard(appState);
		await settle();

		// What a GPS-lap analyze records: three VIRTUAL laps, nothing to do with
		// the FIT lap list the checkboxes below drive.
		appState.currentAnalyzedLaps = [1, 2, 3];
		expect(veSectionHidden()).toBe(false);

		renderLapCheckboxes([1, 2, 3], [1]);
		updateSelectedLaps();
		await settle();

		expect(veSectionHidden()).toBe(false);
		expect(appState.currentVEResult).not.toBeNull();
		expect(appState.currentAnalyzedLaps).toEqual([1, 2, 3]);
	});

	/**
	 * THE FIT SELECTION IS THE DETECTION WINDOW IN THE GPS MODES, so changing it
	 * has to re-detect — and nothing did.
	 *
	 * `runGpsLapDetection` and `runOutAndBackDetection` both derive their
	 * `trimStart`/`trimEnd` from `appState.selectedLaps`, but no path re-ran them
	 * when that selection moved. Reported from the running app (2026-09-01): with
	 * FIT lap 8 selected the gate found 5 laps; ticking lap 10 as well left the
	 * counter at 5 and the plot untouched, and only nudging a gate by one second
	 * revealed the 14 laps the wider window actually contains.
	 *
	 * END TO END ON PURPOSE, through the real `rerenderSection3` and the real
	 * `bindGpsDetection` it runs — the gate offsets live in that binder's
	 * closure, and the wiring under test is that the binder PUBLISHES a re-detect
	 * closure and `updateSelectedLaps` calls it. A test that registered its own
	 * closure would pass against a binder that never publishes one, which is
	 * exactly the defect.
	 *
	 * The observation is `gpsDetectedLaps` being REPLACED. The real detector runs
	 * against this fixture's constant coordinates and finds nothing, so a
	 * hand-seeded list becoming empty is proof the whole chain ran; what the
	 * detector concluded is not the point and is covered on controlled ranges in
	 * `gateRedetectInvalidation.test.ts`.
	 */
	it("re-runs GPS detection when the FIT lap selection changes", async () => {
		const appState = makeAppState();
		configure(appState, makeUpdateAnalyzeButton(appState), vi.fn());
		setGpsAnalysisMode("GPS based lap splitting");
		await settle();

		// Stands in for a detection the user has already seen. Anything at all,
		// as long as a re-detection would have to replace it.
		appState.gpsDetectedLaps = [{ lapNumber: 1, startIdx: 0, endIdx: 99 }] as never;
		// `runGpsLapDetection` bails without a FIT lap list to scope itself to
		// (`section3Orchestration.ts:701`); `currentFitResult.laps` is a
		// different field and does not populate it.
		appState.currentLaps = [
			{ start_time: 0, end_time: HALF - 1 },
			{ start_time: HALF, end_time: SAMPLE_COUNT - 1 },
		] as never;

		// The REAL template is on the page after the mode switch, so this ticks a
		// real checkbox rather than markup the test invented. The SECOND one, to
		// widen the selection: unticking the only checked lap would empty it and
		// take the separate no-selection branch instead.
		const boxes = document.querySelectorAll<HTMLInputElement>(".lap-checkbox");
		if (boxes.length < 2) throw new Error("the rendered template has too few lap checkboxes");
		boxes[1].checked = true;
		updateSelectedLaps();
		await settle();

		expect(appState.gpsDetectedLaps).toEqual([]);
	});

	/**
	 * LEAVING A MODE MUST NOT RE-DETECT INTO IT.
	 *
	 * The redetect closure is module-level state holding a closure over the
	 * binder's own gate sliders, and `restoreSection3Controls` ENDS IN
	 * `updateSelectedLaps()` — which fires that closure. Cleared one line too
	 * late, a mode switch ran the PREVIOUS mode's closure against detached
	 * sliders: it re-ran detection, repopulated the arrays `setGpsAnalysisMode`
	 * had just cleared, redrew markers on a map about to be destroyed, and
	 * persisted gate offsets for a mode the user had left.
	 *
	 * BETWEEN THE TWO GPS MODES, deliberately. Switching to `None` cannot show
	 * this: `updateSelectedLaps` only reaches the closure in a GPS mode, so the
	 * obvious "switch away and check" test passes against the defect.
	 */
	it("does not re-detect into a GPS mode that has just been left", async () => {
		const appState = makeAppState();
		configure(appState, makeUpdateAnalyzeButton(appState), vi.fn());
		// The same shape `currentFitResult.laps` carries: `renderSection3Template`
		// formats distance and duration off these, and detection is scoped to a
		// non-empty FIT selection.
		appState.currentLaps = [
			{
				total_elapsed_time: 60,
				total_distance: 1000,
				avg_power: 200,
				start_time: 0,
				end_time: HALF - 1,
			},
			{
				total_elapsed_time: 60,
				total_distance: 1000,
				avg_power: 200,
				start_time: HALF,
				end_time: SAMPLE_COUNT - 1,
			},
		] as never;

		setGpsAnalysisMode("GPS based out and back");
		await settle();

		const map = mapInstances.find((m) => !m.destroyed);
		if (!map) throw new Error("no live map after the out-and-back render");
		const paintsBeforeSwitch = map.oabMarkerPaints;

		setGpsAnalysisMode("GPS based lap splitting");
		await settle();

		// Nothing may paint an out-and-back gate from here on: that mode is gone,
		// its sliders are detached, and its closure has no business running.
		expect(
			mapInstances.reduce((total, m) => total + m.oabMarkerPaints, 0),
		).toBe(paintsBeforeSwitch);
	});

	/**
	 * The one case the detectors cannot answer: both bail before detecting when
	 * no FIT lap is selected (`section3Orchestration.ts:701`), so the re-detection
	 * route cannot reach the panel and `updateSelectedLaps` applies the rule
	 * itself. No basis, no panel.
	 */
	it("tears a GPS panel down when the FIT selection is emptied", async () => {
		const appState = makeAppState();
		configure(appState, makeUpdateAnalyzeButton(appState), vi.fn());
		setGpsAnalysisMode("GPS based lap splitting");
		await settle();
		await analyzeStandard(appState);
		await settle();

		appState.currentGpsLapIndexRanges = [{ startIdx: 0, endIdx: 99 }];
		expect(veSectionHidden()).toBe(false);

		renderLapCheckboxes([1, 2], []);
		updateSelectedLaps();
		await settle();

		expect(veSectionHidden()).toBe(true);
		expect(appState.currentVEResult).toBeNull();
	});

	/**
	 * AND THE DETECTION GOES WITH THE PANEL.
	 *
	 * Tearing the panel down was only half of "no basis". `updateAnalyzeButton`
	 * does not read the panel — it reads
	 * `outAndBackSelectedSections`/`outAndBackSections` in out-and-back mode and
	 * `gpsSelectedLaps`/`gpsDetectedLaps` in GPS-lap mode
	 * (`analyzeOrchestrator.ts:245-251`) — so with those left standing the
	 * button stayed enabled over the PREVIOUS window's detection while the panel
	 * said there was nothing to analyse. One gesture cannot mean both.
	 *
	 * THE ASSERTION IS ON THE APPSTATE FIELDS, deliberately, and it is a
	 * STRUCTURAL guard: importing the real `analyzeOrchestrator` here would drag
	 * in Plotly, Leaflet and the WASM glue (see this file's header at the
	 * `makeUpdateAnalyzeButton` stub), and asserting against that stub would
	 * prove the stub. The four fields named above are exactly what the real
	 * `updateAnalyzeButton` reads, so emptying all of them is what disables the
	 * button.
	 *
	 * The A/B gate markers are NOT asserted gone: the gates are the user's
	 * placement and survive a window change by design (03de804/40bbc64).
	 */
	it("clears the out-and-back detection when the FIT selection is emptied", async () => {
		const appState = makeAppState();
		configure(appState, makeUpdateAnalyzeButton(appState), vi.fn());
		setGpsAnalysisMode("GPS based out and back");
		await settle();
		await analyzeStandard(appState);
		await settle();

		analyzedOutAndBackPanel(appState, [1, 2]);
		appState.outAndBackSelectedSections = [1, 2];
		appState.outAndBackResult = { detectedSections: [] } as never;
		expect(veSectionHidden()).toBe(false);

		renderLapCheckboxes([1, 2], []);
		updateSelectedLaps();
		await settle();

		expect(appState.outAndBackSections).toEqual([]);
		expect(appState.outAndBackSelectedSections).toEqual([]);
		expect(appState.outAndBackResult).toBeNull();
	});

	it("clears the GPS-lap detection when the FIT selection is emptied", async () => {
		const appState = makeAppState();
		configure(appState, makeUpdateAnalyzeButton(appState), vi.fn());
		setGpsAnalysisMode("GPS based lap splitting");
		await settle();
		await analyzeStandard(appState);
		await settle();

		appState.gpsDetectedLaps = [
			{ lapNumber: 1, startIdx: 0, endIdx: 99 },
			{ lapNumber: 2, startIdx: 100, endIdx: 199 },
		] as never;
		appState.gpsSelectedLaps = [1, 2];
		appState.gpsLapDetectionResult = { detectedLaps: [] } as never;
		expect(veSectionHidden()).toBe(false);

		renderLapCheckboxes([1, 2], []);
		updateSelectedLaps();
		await settle();

		expect(appState.gpsDetectedLaps).toEqual([]);
		expect(appState.gpsSelectedLaps).toEqual([]);
		expect(appState.gpsLapDetectionResult).toBeNull();
	});

	it("leaves an auto-rho recompute scheduled before the teardown unable to write", async () => {
		const appState = await analyzedStandardPanel();

		renderLapCheckboxes([1, 2, 3], [3]);
		updateSelectedLaps();
		await settle();
		expect(appState.currentVEResult).toBeNull();

		// `updateSelectedLaps` schedules auto-rho on a 500 ms timer, and auto-rho
		// writes parameters, which reaches `requestModeUpdate("parameters")`.
		// After the teardown the panel is hidden, so the primitive must bail at
		// its visibility gate rather than repopulate the fields just cleared --
		// the shape `resetRecomputeStatus` was added for.
		await vi.advanceTimersByTimeAsync(2000);

		expect(appState.currentVEResult).toBeNull();
		expect(veSectionHidden()).toBe(true);
	});
});

/**
 * Loading a DIFFERENT activity.
 *
 * The last and bluntest way the basis goes. `setLoadedActivity`
 * (`AppState.ts:314`) swaps `currentFitData`, `currentFitResult` and
 * `currentLaps` and stops there, so `selectedLaps` survived the swap --
 * and `renderSection3Template` ticks `selectedLaps.includes(index + 1)`, so
 * laps 2, 4 and 6 came back checked against a completely different ride and
 * Analyze ran on them with no further gesture. Reported from the running app,
 * 2026-08-31.
 *
 * `currentAnalyzedLaps` survived too, which is the half that does not show up
 * as a wrong tick: the selection-change guard above compares the carried-over
 * selection against the carried-over analyzed set, finds them equal, and leaves
 * the PREVIOUS file's VE panel on screen over the new file's data.
 *
 * THE MODE RESET DOES NOT GO THROUGH `setGpsAnalysisMode`. That function is a
 * deliberate no-op when the mode is already the one asked for
 * (`previousMode !== mode` gates every branch), and "already None" is the most
 * common case there is -- plain Standard mode, which is exactly what was
 * reported. Routing the reset through it would do nothing on the reported path.
 */
describe("loading a new activity resets the analysis", () => {
	beforeEach(() => {
		vi.useFakeTimers();
		setupDom();
		mapInstances.length = 0;
		mapInitializeBehaviour = () => Promise.resolve();
		Element.prototype.scrollIntoView = () => {};
		purged.length = 0;
		(globalThis as unknown as { Plotly: unknown }).Plotly = {
			newPlot: () => Promise.resolve(),
			react: () => Promise.resolve(),
			relayout: () => Promise.resolve(),
			purge: (gd: Element) => {
				purged.push((gd as HTMLElement).id);
			},
			Plots: { resize: () => Promise.resolve() },
		};
		window.alert = vi.fn();
		calculatorCalls.length = 0;
		clearModeUpdateCallbacks();
		resetModeUpdateRequests();
	});

	afterEach(() => {
		resetRecomputeThrottle();
		vi.useRealTimers();
		clearModeUpdateCallbacks();
		resetModeUpdateRequests();
	});

	/** The mode `<select>` the reset has to put back in step with the module. */
	function renderModeSelect(value: string): HTMLSelectElement {
		const host = document.getElementById("analysisSection");
		if (!host) throw new Error("#analysisSection is not on the page");
		host.insertAdjacentHTML(
			"afterbegin",
			`<select id="gpsAnalysisMode">
                <option value="None">None</option>
                <option value="GPS based lap splitting">GPS based lap splitting</option>
                <option value="GPS based out and back">GPS based out and back</option>
            </select>`,
		);
		const select = document.getElementById(
			"gpsAnalysisMode",
		) as HTMLSelectElement;
		select.value = value;
		return select;
	}

	async function analyzedStandardPanel(): Promise<AppState> {
		const appState = makeAppState();
		configure(appState, makeUpdateAnalyzeButton(appState), vi.fn());
		setGpsAnalysisMode("None");
		await settle();
		await analyzeStandard(appState);
		await settle();
		return appState;
	}

	it("leaves the selection empty on a multi-lap file", async () => {
		const appState = await analyzedStandardPanel();
		appState.selectedLaps = [2, 4, 6];

		resetAnalysisForNewActivity();

		// Explicitly pinned so the direction below cannot go vacuous if this
		// file's fixture ever drops to a single lap — at which point the
		// single-lap default would make an empty selection the wrong answer.
		expect(appState.currentLaps).toHaveLength(2);
		expect(appState.selectedLaps).toEqual([]);
	});

	/**
	 * A FILE WITH EXACTLY ONE LAP HAS NO CHOICE TO MAKE.
	 *
	 * Charging the user a click for the only lap there is made the empty
	 * selection an attractive state to sit in — which is what made the GPS
	 * modes' "no selection" fallbacks reachable in ordinary use. Removed at the
	 * source: exactly one lap ticks itself, every other count still starts
	 * empty.
	 */
	function makeSingleLapAppState(): AppState {
		const appState = makeAppState();
		const [firstLap] = appState.currentLaps;
		// Through the `currentFitResult` setter, which is what a file load uses
		// (`AppState.ts:362`), so `currentLaps` is re-derived rather than
		// written past its own source.
		appState.currentFitResult = {
			...appState.currentFitResult,
			laps: [firstLap],
		} as never;
		return appState;
	}

	it("ticks the only lap on a single-lap file", async () => {
		const appState = makeSingleLapAppState();
		configure(appState, makeUpdateAnalyzeButton(appState), vi.fn());
		expect(appState.currentLaps).toHaveLength(1);

		resetAnalysisForNewActivity();

		expect(appState.selectedLaps).toEqual([1]);
	});

	/**
	 * THE STATE IS NOT THE BEHAVIOUR. `renderSection3Template` ticks the boxes
	 * from `selectedLaps`, and `restoreSection3Controls` ends in
	 * `updateSelectedLaps()`, which re-derives the selection FROM THE DOM. A
	 * default that the render path did not carry through would be silently
	 * reverted to `[]` by that reconciliation, with the unit assertion above
	 * still green. So this drives the real render and asserts both ends.
	 */
	it("comes back from the render with lap 1 ticked and re-derived", async () => {
		const appState = makeSingleLapAppState();
		configure(appState, makeUpdateAnalyzeButton(appState), vi.fn());

		resetAnalysisForNewActivity();
		initializeSection3();
		await settle();

		const box = document.getElementById("lap-1") as HTMLInputElement | null;
		if (!box) throw new Error("the rendered template has no #lap-1 checkbox");
		expect(box.checked).toBe(true);

		// And the reconciliation agrees with the markup rather than undoing it.
		updateSelectedLaps();
		expect(appState.selectedLaps).toEqual([1]);
	});

	it("tears the panel down even though the mode is already None", async () => {
		const appState = await analyzedStandardPanel();
		appState.selectedLaps = [2, 4, 6];

		expect(veSectionHidden()).toBe(false);
		expect(appState.currentVEResult).not.toBeNull();

		resetAnalysisForNewActivity();

		// The reported path. A reset routed through `setGpsAnalysisMode("None")`
		// would leave every one of these untouched.
		expect(veSectionHidden()).toBe(true);
		expect(appState.currentVEResult).toBeNull();
		expect(appState.currentAnalyzedLaps).toEqual([]);
	});

	it("leaves nothing for the selection guard to treat as analyzed", async () => {
		const appState = await analyzedStandardPanel();
		appState.selectedLaps = [2, 4, 6];

		resetAnalysisForNewActivity();

		// With both lists empty the guard reads "nothing analyzed" and stands
		// down, which is what lets the NEW file's first selection through
		// without the panel flickering.
		expect(appState.currentAnalyzedLaps).toEqual([]);
		expect(appState.currentCoveredItems).toBeNull();
	});

	it("returns the mode to None and puts the select back in step", async () => {
		const appState = makeAppState();
		configure(appState, makeUpdateAnalyzeButton(appState), vi.fn());
		const select = renderModeSelect("GPS based out and back");
		setGpsAnalysisMode("GPS based out and back");
		await settle();

		resetAnalysisForNewActivity();

		expect(getGpsAnalysisMode()).toBe("None");
		expect(select.value).toBe("None");
	});

	it("clears GPS detections and out-and-back sections", async () => {
		const appState = makeAppState();
		configure(appState, makeUpdateAnalyzeButton(appState), vi.fn());
		setGpsAnalysisMode("None");
		await settle();

		appState.gpsDetectedLaps = [{ lapNumber: 1 }] as never;
		appState.gpsSelectedLaps = [1];
		appState.gpsLapDetectionResult = {} as never;
		appState.outAndBackSections = [{ sectionNumber: 1 }] as never;
		appState.outAndBackSelectedSections = [1, 2];
		appState.outAndBackResult = {} as never;

		resetAnalysisForNewActivity();

		expect(appState.gpsDetectedLaps).toEqual([]);
		expect(appState.gpsSelectedLaps).toEqual([]);
		expect(appState.gpsLapDetectionResult).toBeNull();
		expect(appState.outAndBackSections).toEqual([]);
		expect(appState.outAndBackSelectedSections).toEqual([]);
		expect(appState.outAndBackResult).toBeNull();
	});

	it("clears the previous file's map markers", async () => {
		const appState = makeAppState();
		configure(appState, makeUpdateAnalyzeButton(appState), vi.fn());
		setGpsAnalysisMode("None");
		await settle();

		// The map the previous activity drew on. Taken back OUT of the shared
		// registry the way `configure`'s `getMapVisualization` resolves it --
		// first non-destroyed instance -- rather than assuming this one is it,
		// because a `rerenderSection3` earlier in the test can have made its own.
		new FakeMap("analysisSection");
		const map = mapInstances.find((m) => !m.destroyed);
		if (!map) throw new Error("no live FakeMap for the reset to clear");
		map.cleared = { detectedLaps: 0, gpsMarker: 0, outAndBackMarkers: 0 };

		resetAnalysisForNewActivity();

		expect(map.cleared.detectedLaps).toBeGreaterThan(0);
		expect(map.cleared.gpsMarker).toBeGreaterThan(0);
		expect(map.cleared.outAndBackMarkers).toBeGreaterThan(0);
	});

	it("does not throw when no activity was ever analyzed", async () => {
		const appState = makeAppState();
		configure(appState, makeUpdateAnalyzeButton(appState), vi.fn());
		setGpsAnalysisMode("None");
		await settle();

		// The very first file load of a session.
		expect(() => resetAnalysisForNewActivity()).not.toThrow();
		expect(appState.selectedLaps).toEqual([]);
	});
});

/**
 * THE WHOLE OF `SelectionState`, not a hand-listed subset.
 *
 * `resetAnalysisForNewActivity` shipped clearing the three SELECTIONS and
 * leaving the state DERIVED from them behind, and the gap was not theoretical:
 * `filteredLapData` still held the previous file's samples, so the load-path
 * auto-rho (`fileLoadOrchestration.ts:398`) sailed past its `!filteredLapData`
 * guard and read trim sliders that had just been re-rendered for the NEW file.
 * With start === end `calculateTrimRegionMetadata` throws, surfacing as
 * "Auto-rho calculation failed. Using manual value." on every file switch --
 * and never on a session's first load, where `filteredLapData` is still null
 * and the guard returns early. Reported from the running app, 2026-08-31.
 *
 * Asserting against a FRESH `AppState`'s selection block rather than naming
 * fields is the point: the reset's contract is "this activity's selection state
 * goes back to as-loaded", and a field added to `SelectionState` later is
 * exactly the thing that would otherwise be forgotten here.
 */
describe("the new-activity reset returns every selection-derived field", () => {
	beforeEach(() => {
		vi.useFakeTimers();
		setupDom();
		mapInstances.length = 0;
		mapInitializeBehaviour = () => Promise.resolve();
		Element.prototype.scrollIntoView = () => {};
		(globalThis as unknown as { Plotly: unknown }).Plotly = {
			newPlot: () => Promise.resolve(),
			react: () => Promise.resolve(),
			relayout: () => Promise.resolve(),
			purge: () => {},
			Plots: { resize: () => Promise.resolve() },
		};
		clearModeUpdateCallbacks();
		resetModeUpdateRequests();
	});

	afterEach(() => {
		resetRecomputeThrottle();
		vi.useRealTimers();
		clearModeUpdateCallbacks();
		resetModeUpdateRequests();
	});

	it("leaves the selection block identical to a freshly constructed one", async () => {
		const appState = makeAppState();
		configure(appState, makeUpdateAnalyzeButton(appState), vi.fn());
		setGpsAnalysisMode("None");
		await settle();

		// Dirty every field a real session would have written by the time a
		// second file is picked.
		appState.selectedLaps = [2, 4, 6];
		appState.gpsSelectedLaps = [1];
		appState.outAndBackSelectedSections = [1, 2];
		appState.currentAnalyzedLaps = [2, 4, 6];
		appState.currentCoveredItems = [2, 4];
		appState.filteredLapData = {
			timestamps: [1, 2, 3],
		} as never;
		appState.filteredVEData = { timestamps: [1, 2, 3] } as never;
		appState.currentFilteredData = { timestamps: [1, 2, 3] } as never;
		appState.presetTrimStart = 40;
		appState.presetTrimEnd = 90;
		appState.currentGpsLapIndexRanges = [{ startIdx: 0, endIdx: 9 }] as never;
		appState.currentOverlayLapNumbers = [2, 4, 6];
		appState.currentOutAndBackSections = [{ sectionNumber: 1 }] as never;

		resetAnalysisForNewActivity();

		expect(appState.selection).toEqual(new AppState().selection);
	});

	it("clears the filtered lap data the load-path auto-rho guards on", async () => {
		const appState = makeAppState();
		configure(appState, makeUpdateAnalyzeButton(appState), vi.fn());
		setGpsAnalysisMode("None");
		await settle();

		appState.selectedLaps = [10, 12];
		appState.filteredLapData = { timestamps: [1, 2, 3] } as never;

		resetAnalysisForNewActivity();

		// The specific field whose survival produced the toast: with it null the
		// guard returns early and quietly, exactly as on a first load.
		expect(appState.filteredLapData).toBeNull();
	});

	it("clears the trim window, which indexes into the previous selection", async () => {
		const appState = makeAppState();
		configure(appState, makeUpdateAnalyzeButton(appState), vi.fn());
		setGpsAnalysisMode("None");
		await settle();

		appState.presetTrimStart = 40;
		appState.presetTrimEnd = 90;

		resetAnalysisForNewActivity();

		expect(appState.presetTrimStart).toBe(0);
		expect(appState.presetTrimEnd).toBeNull();
	});
});
