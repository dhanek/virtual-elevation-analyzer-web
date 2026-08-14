/**
 * @vitest-environment jsdom
 *
 * THE END-TO-END CHAIN IN STANDARD (`None`) MODE — render -> bind -> event ->
 * primitive -> draw — for the VD TAB, in BOTH panels standard mode can put on
 * screen.
 *
 * WHY THIS FILE EXISTS. `gpsModeRealChain.test.ts` drives the two GPS modes and
 * found an entire mode dead while 574 tests were green. Standard had no
 * equivalent: the only thing driving it was the 66-test call-shape matrix, which
 * mocks the primitive at module level and never renders Standard's own template.
 * The maintainer then reported "VD tab strip works in GPS lap mode, not in
 * standard (none) mode", which no existing suite could have seen either way.
 *
 * Standard mode renders TWO different panels, and that is the whole point here:
 *
 *   - STITCHED (the default) — `showVirtualElevationAnalysisInline`, whose plot
 *     ids are `vePlot` / `vdPlot` and whose VD tab is deliberately NOT tagged
 *     `data-wind-source="fit"`, so it stays visible under constant wind. That
 *     asymmetry is the maintainer's ruling (plan 07-03): the tab does not lie
 *     there, because it integrates `apparentWindSpeedMps` computed from the
 *     configured wind.
 *   - STACKED — the "Stacked" lap view of a multi-lap standard selection, which
 *     renders the GPS-LAP overlay (`showGpsLapVEPlot`, ids `gpsLapVePlot` /
 *     `gpsLapVdPlot`, VD tab tagged and therefore hidden under constant) while
 *     `getGpsAnalysisMode()` is still `"None"`.
 *
 * WHAT IS REAL: both render entry points, their templates, `bindModeControls`,
 * `MODE_CONTROL_TABLE`, `requestModeUpdate`, `scheduleRecompute`, the mode
 * handlers, `updateModeVEPlots`, `setupTabSwitching` and the active-tab guard.
 *
 * WHAT IS FAKED, and only what jsdom cannot run: the WASM calculator, the
 * Plotly-backed overlay draw calls (the observation point), the Plotly global,
 * and `getGpsAnalysisMode` so the suite can say which mode is live without
 * driving the whole Section 3 UI.
 *
 * THE PLOTLY FAKE THROWS WHEN ITS TARGET ID IS ABSENT, exactly as Plotly does
 * ("No DOM element with id '...' exists on the page"). Without that, a draw
 * aimed at a div this panel does not contain is indistinguishable from a
 * successful one — which is precisely the defect below, and precisely the shape
 * of vacuous guard this phase has now hit five times.
 *
 * NOTHING IN THIS FILE MAY CALL `configureModeUpdateRequests`. If a future
 * change makes these tests need it, production needs it too.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../analysis/VeCalculatorFactory", () => ({
	createVeCalculator: (input: any) => {
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

/** The overlay's far end: the functions that actually paint its figures. */
const overlay = vi.hoisted(() => ({ ve: vi.fn(), vd: vi.fn() }));

vi.mock("../gpsLap/gpsLapPlots", async (importOriginal) => ({
	...(await importOriginal<Record<string, unknown>>()),
	renderGpsLapVEPlots: (...args: unknown[]) => overlay.ve(...args),
	renderGpsLapWindPlot: () => {},
	renderGpsLapPowerPlot: () => {},
	renderGpsLapVdPlot: (...args: unknown[]) => overlay.vd(...args),
}));

const modeState = vi.hoisted(() => ({ gps: "None" as string }));

vi.mock("../section3/section3Orchestration", async (importOriginal) => ({
	...(await importOriginal<Record<string, unknown>>()),
	getGpsAnalysisMode: () => modeState.gps,
}));

import type { AnalysisParameters } from "../../components/AnalysisParameters";
import type { AppState } from "../../state/AppState";
import type { ParameterStorage } from "../../utils/ParameterStorage";
import type { ResultsStorage } from "../../utils/ResultsStorage";
import type { ShellServices } from "./types";
import { showGpsLapVEPlot } from "../gpsLap/renderGpsLap";
import { showVirtualElevationAnalysisInline } from "../ve/renderStandardVe";
import { clearModeUpdateCallbacks } from "./modeUpdateCallbacks";
import { resetModeUpdateRequests } from "./requestModeUpdate";

const SAMPLE_COUNT = 400;
const HALF = SAMPLE_COUNT / 2;
const DRAGGED_CDA = 0.42;

/** Every id a draw was aimed at, whether or not the element existed. */
const drawTargets: string[] = [];
/** Draws aimed at an id this panel does not contain — always a defect. */
const missingTargets: string[] = [];

function fakePlotly(name: "newPlot" | "react") {
	return (id: string, ...rest: unknown[]) => {
		void rest;
		void name;
		drawTargets.push(id);
		if (!document.getElementById(id)) {
			missingTargets.push(id);
			// Exactly what Plotly does, so a draw into thin air cannot pass for one
			// that reached the screen.
			throw new Error(`No DOM element with id '${id}' exists on the page.`);
		}
	};
}

const params = {
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

function makeFitData() {
	const timestamps = Array.from({ length: SAMPLE_COUNT }, (_, i) => i);
	const zeros = () => new Array<number>(SAMPLE_COUNT).fill(0);
	return {
		timestamps,
		power: zeros().map(() => 200),
		velocity: zeros().map(() => 10),
		position_lat: timestamps.map((t) => 47 + t * 1e-5),
		position_long: timestamps.map((t) => 8 + t * 1e-5),
		altitude: zeros(),
		distance: timestamps.map((t) => t * 10),
		air_speed: zeros().map(() => 10),
		wind_speed: zeros(),
		wind_yaw: zeros(),
		air_density_data: zeros(),
		road_speed: zeros(),
		temperature: zeros().map(() => 20),
		cda_reference: null,
	};
}

function makeAppState(): AppState {
	return {
		currentFitData: makeFitData(),
		currentParameters: { ...params },
		currentLaps: [
			{ start_time: 0, end_time: HALF - 1 },
			{ start_time: HALF, end_time: SAMPLE_COUNT - 1 },
		],
		selectedLaps: [1, 2],
		currentAnalyzedLaps: [1, 2],
		gpsDetectedLaps: [],
		gpsSelectedLaps: [],
		airSpeedCalibrationPercent: 0,
		activeDisplayProfile: "fit-raw",
		presetTrimStart: 0,
		presetTrimEnd: SAMPLE_COUNT - 1,
		isGpsLapModeActive: false,
		isCalculatingAutoRho: false,
		demProfilesAvailable: true,
	} as unknown as AppState;
}

function makeServices(appState: AppState): ShellServices {
	return {
		appState,
		showLoading: () => {},
		hideLoading: () => {},
		showError: () => {},
	} as unknown as ShellServices;
}

/**
 * The host page the analyze path leaves behind. `#veAnalysisSection` must not be
 * hidden — `requestModeUpdate` refuses to schedule while the panel is off
 * screen, and a fixture that got that wrong would pass for the wrong reason.
 */
function renderHostPage(): void {
	document.body.innerHTML = `
		<div id="veAnalysisSection">
			<div id="veAnalysisContent"></div>
		</div>
	`;
}

let appState: AppState;

/** The STITCHED standard panel, through its real production entry point. */
async function renderStitched(): Promise<void> {
	const fit = makeFitData();
	appState.isGpsLapModeActive = false;
	appState.currentGpsLapIndexRanges = null;
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
		{ r2: 0.5, rmse: 1, ve_elevation_diff: 2, actual_elevation_diff: 3 },
		[1, 2],
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

const lapProfile = (lapNumber: number) => ({
	lapNumber,
	distances: [0, 1, 2],
	virtualElevation: [0, 1, 2],
	actualElevation: [0, 1, 2],
	supplementarySeries: null,
	duration: HALF,
	totalDistance: 2,
});

/**
 * The STACKED lap view, exactly as `analyzeOrchestrator`'s `renderStacked`
 * builds it: the GPS-LAP overlay panel, with the GPS analysis mode still
 * `"None"` because the user never left standard mode.
 */
async function renderStacked(): Promise<void> {
	appState.isGpsLapModeActive = true;
	appState.currentGpsLapIndexRanges = [
		{ startIdx: 0, endIdx: HALF - 1 },
		{ startIdx: HALF, endIdx: SAMPLE_COUNT - 1 },
	];
	appState.currentOverlayLapNumbers = [1, 2];
	await showGpsLapVEPlot(
		makeServices(appState),
		{} as unknown as ParameterStorage,
		{} as unknown as ResultsStorage,
		async () => ({}),
		[lapProfile(1), lapProfile(2)] as any,
		{ distances: [0, 1, 2], elevation: [0, 1, 2] },
		appState.currentParameters!,
		true,
		true,
		0,
		"fit",
	);
}

async function settle(): Promise<void> {
	await vi.advanceTimersByTimeAsync(500);
}

function clickTab(tab: string): void {
	document
		.querySelector<HTMLElement>(`.ve-tab-button[data-tab="${tab}"]`)
		?.click();
}

function tabStrip(): string[] {
	return Array.from(document.querySelectorAll(".ve-tab-button"))
		.filter((b) => (b as HTMLElement).hidden !== true)
		.map((b) => b.getAttribute("data-tab")!);
}

function activeTabId(): string | null {
	return document.querySelector(".ve-tab-content--active")?.id ?? null;
}

function vdButtonHidden(): boolean {
	const button = document.querySelector<HTMLElement>(
		'.ve-tab-button[data-tab="vd"]',
	);
	if (!button) throw new Error("the VD tab button is not in the strip");
	return button.hidden === true;
}

async function selectWindSource(value: string): Promise<void> {
	const radio = document.querySelector<HTMLInputElement>(
		`input[name="windSource"][value="${value}"]`,
	);
	if (!radio) throw new Error(`no wind-source radio for "${value}"`);
	document
		.querySelectorAll<HTMLInputElement>('input[name="windSource"]')
		.forEach((other) => (other.checked = false));
	radio.checked = true;
	radio.dispatchEvent(new Event("change", { bubbles: true }));
	await settle();
}

async function dragCda(value: number): Promise<void> {
	const slider = document.getElementById("cdaSlider") as HTMLInputElement;
	slider.value = value.toString();
	slider.dispatchEvent(new Event("input", { bubbles: true }));
	await settle();
}

beforeEach(() => {
	vi.useFakeTimers();
	// jsdom has no layout, so the renders' closing scroll would throw.
	Element.prototype.scrollIntoView = () => {};
	(globalThis as any).Plotly = {
		newPlot: fakePlotly("newPlot"),
		react: fakePlotly("react"),
	};
	drawTargets.length = 0;
	missingTargets.length = 0;
	overlay.ve.mockClear();
	overlay.vd.mockClear();
	clearModeUpdateCallbacks();
	resetModeUpdateRequests();
	modeState.gps = "None";
	renderHostPage();
	appState = makeAppState();
});

afterEach(() => {
	vi.useRealTimers();
	clearModeUpdateCallbacks();
	resetModeUpdateRequests();
});

describe("standard (None): the STITCHED panel's VD tab", () => {
	beforeEach(async () => {
		await renderStitched();
		await settle();
		drawTargets.length = 0;
		missingTargets.length = 0;
	});

	it("puts VD in the strip and draws it on click", async () => {
		expect(tabStrip()).toEqual(["ve", "wind", "power", "vd"]);

		clickTab("vd");
		await settle();

		expect(activeTabId()).toBe("vd-tab");
		expect(drawTargets).toContain("vdPlot");
		expect(missingTargets).toEqual([]);
	});

	it.each(["constant", "fit", "compare"])(
		"keeps VD visible, active and redrawn under %s (the ruled asymmetry)",
		async (source) => {
			clickTab("vd");
			await settle();
			drawTargets.length = 0;

			await selectWindSource(source);

			// THE RULING, plan 07-03: Standard keeps its VD tab under constant
			// wind. It does not lie there — it integrates `apparentWindSpeedMps`
			// computed from the configured wind — so it is not tagged
			// `data-wind-source="fit"` and the active-tab guard has nothing to do.
			// The GPS sidebars ARE tagged and DO hide; that difference is opted
			// into at the template seam, not branched on `modeId` (D-02).
			expect(vdButtonHidden()).toBe(false);
			expect(tabStrip()).toEqual(["ve", "wind", "power", "vd"]);
			expect(activeTabId()).toBe("vd-tab");
			// And it is REDRAWN for the new source, not left showing the old one.
			expect(drawTargets).toContain("vdPlot");
			expect(missingTargets).toEqual([]);
		},
	);
});

/**
 * The stacked lap view was DEAD in standard mode, and this is the only place
 * "works in GPS-lap, not in standard (none)" is literally true.
 *
 * `f810cb9` moved the overlay's controls onto `requestModeUpdate`, which
 * resolves its handler — and therefore its RENDER CALLBACKS — from
 * `getGpsAnalysisMode()`. In genuine GPS-lap mode that reads
 * "GPS based lap splitting" and everything lines up. In the stacked view of
 * standard mode it reads `"None"`, so the funnel handed every update to
 * STANDARD's callbacks while the GPS-LAP panel was on screen: each redraw was
 * aimed at `vePlot` / `vdPlot` / `windSpeedPlot`, ids that panel does not
 * contain, and Plotly threw. The overlay's own plots were never touched again
 * after its first paint.
 *
 * Before the migration the overlay's controls called `updateGpsLapVEPlots`
 * directly, so the stacked view worked; this is a regression of that plan, in
 * exactly the shape the maintainer reported.
 *
 * `resolveActiveGpsLapRanges` already treats both routes to this panel as one —
 * "genuine GPS detection" and "stacked-from-standard" — keyed on the same
 * `currentGpsLapIndexRanges` / `isGpsLapModeActive` state the orchestrator sets.
 * The funnel now asks the same question.
 */
describe("standard (None): the STACKED overlay's VD tab", () => {
	beforeEach(async () => {
		// The stitched panel renders first in production and registers
		// Standard's render callbacks; the stacked toggle then replaces the
		// panel. Reproducing that order matters — the stale registration is what
		// the funnel used to reach.
		await renderStitched();
		await settle();
		await renderStacked();
		await settle();
		drawTargets.length = 0;
		missingTargets.length = 0;
		overlay.ve.mockClear();
		overlay.vd.mockClear();
	});

	it("redraws the overlay's own plots when CdA is dragged", async () => {
		await dragCda(DRAGGED_CDA);

		expect(overlay.ve).toHaveBeenCalled();
		expect(missingTargets).toEqual([]);
	});

	it("still draws VD after a control has been touched", async () => {
		// The tab render map is re-registered by whichever mode's `renderVe` ran
		// last, so a control interaction is what used to swap the overlay's VD
		// closure for Standard's — pointed at `#vdPlot`, which is not here.
		await dragCda(DRAGGED_CDA);
		overlay.vd.mockClear();
		drawTargets.length = 0;
		missingTargets.length = 0;

		clickTab("vd");
		await settle();

		expect(activeTabId()).toBe("vd-tab");
		expect(overlay.vd).toHaveBeenCalled();
		expect(missingTargets).toEqual([]);
	});

	it("lands on a DRAWN VE tab when VD is hidden by a switch to constant", async () => {
		// Browser check 7, run in standard (None) mode. The overlay tags its VD
		// tab, so unlike the stitched panel it does hide, the guard does fire,
		// and the tab it moves the user to has to be actually painted.
		clickTab("vd");
		await settle();
		expect(activeTabId()).toBe("vd-tab");
		overlay.ve.mockClear();
		drawTargets.length = 0;
		missingTargets.length = 0;

		await selectWindSource("constant");

		expect(vdButtonHidden()).toBe(true);
		expect(tabStrip()).toEqual(["ve", "wind", "power"]);
		expect(activeTabId()).toBe("ve-tab");
		expect(overlay.ve).toHaveBeenCalled();
		expect(missingTargets).toEqual([]);
	});
});
