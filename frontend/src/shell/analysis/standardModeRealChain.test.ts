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
 *     ids are `vePlot` / `vdPlot`.
 *   - STACKED — the "Stacked" lap view of a multi-lap standard selection, which
 *     renders the GPS-LAP overlay (`showGpsLapVEPlot`, ids `gpsLapVePlot` /
 *     `gpsLapVdPlot`) while `getGpsAnalysisMode()` is still `"None"`.
 *
 * BOTH PANELS NOW HIDE THE VD TAB UNDER CONSTANT WIND, and getting there was a
 * REVERSAL worth recording rather than quietly restating. On 2026-08-05 the
 * maintainer ruled that Standard KEEPS its VD tab under constant, because the tab
 * does not lie there: it integrates `apparentWindSpeedMps`, which the constant
 * path computes properly. That reasoning still holds — the computation is
 * untouched by this change, and the tab is still correct wherever it is shown.
 * On 2026-08-14 the ruling was reversed on an axis neither side had considered:
 * the STACKED view is the GPS-lap overlay, which tags its VD tab, so within one
 * mode the tab appeared under Stitched and vanished under Stacked as the user
 * toggled views. View-dependent tab visibility is surprising; all three modes now
 * hide it under constant, in every view. The reversal buys uniformity, not
 * correctness.
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

/**
 * The fake encodes WHICH wind series it was handed, so a redraw can be told
 * apart from a stale one: `resolveWindSeries` returns an all-NaN series for
 * `constant`, so the constant leg ramps UP by 1 per sample and the FIT leg ramps
 * DOWN by 1. The slope of the redrawn 'Virtual Elevation' trace therefore says
 * which SOURCE the plot was computed for — which is what turns "the guard lands
 * the user on VE" into "…on a VE drawn for the wind source they just chose".
 */
vi.mock("../../analysis/VeCalculatorFactory", () => ({
	createVeCalculator: (input: any) => {
		const n = input.timestamps.length;
		const isConstantLeg = Array.from(input.windSpeed as number[]).every(
			(value) => Number.isNaN(value),
		);
		const ve = new Float64Array(n);
		for (let i = 0; i < n; i++) ve[i] = isConstantLeg ? i : -i;
		return {
			calculate_virtual_elevation: () => ({
				virtual_elevation: ve,
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
import { resetRecomputeThrottle } from "./recomputeRunner";
import { resetModeUpdateRequests } from "./requestModeUpdate";

const SAMPLE_COUNT = 400;
const HALF = SAMPLE_COUNT / 2;
const DRAGGED_CDA = 0.42;

/** Every id a draw was aimed at, whether or not the element existed. */
const drawTargets: string[] = [];
/** Draws aimed at an id this panel does not contain — always a defect. */
const missingTargets: string[] = [];
/** Every draw's trace list, in order, so a redraw's CONTENT can be read. */
const draws: Array<{ id: string; data: any[]; layout: any }> = [];
/**
 * Which Plotly call each draw went through (bundle D). Recorded because the
 * choice is a property worth pinning end to end: `newPlot` tears the graph down
 * and rebuilds it, and every id below is redrawn on every slider update. The
 * fake used to `void name`, so both methods were indistinguishable here and the
 * five `newPlot` calls in `initializeVEAnalysis` were invisible to this chain.
 */
const drawMethods: Array<{ id: string; method: "newPlot" | "react" }> = [];

function fakePlotly(name: "newPlot" | "react") {
	return (id: string, ...rest: unknown[]) => {
		drawMethods.push({ id, method: name });
		drawTargets.push(id);
		draws.push({ id, data: (rest[0] as any[]) ?? [], layout: rest[1] });
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
			onExportSettings: () => {},
			onExportBundle: () => {},
			onShowAllResults: () => {},
			saveCurrentLapSettings: () => {},
		},
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
	range:
		lapNumber === 1
			? { startIdx: 0, endIdx: HALF - 1 }
			: { startIdx: HALF, endIdx: SAMPLE_COUNT - 1 },
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

/**
 * The slope of the last VE redraw's 'Virtual Elevation' trace: +1 when it was
 * computed from the constant-wind (all-NaN) series, -1 from the FIT one. The
 * builder offsets the whole trace to the actual elevation at the first sample,
 * so a DIFFERENCE is what survives that and an absolute value would not.
 */
function lastVeSlope(): number {
	for (let i = draws.length - 1; i >= 0; i--) {
		if (draws[i].id !== "vePlot") continue;
		const trace = draws[i].data.find((t) => t.name === "Virtual Elevation");
		if (!trace) throw new Error("the VE plot carries no 'Virtual Elevation' trace");
		return trace.y[1] - trace.y[0];
	}
	throw new Error("the VE plot was never drawn");
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
	draws.length = 0;
	drawMethods.length = 0;
	overlay.ve.mockClear();
	overlay.vd.mockClear();
	clearModeUpdateCallbacks();
	resetModeUpdateRequests();
	modeState.gps = "None";
	renderHostPage();
	appState = makeAppState();
});

afterEach(() => {
	// FIRST, and before `useRealTimers` — this is cross-test state, not
	// per-test cleanup.
	//
	// `scheduleRecompute` guards with `if (throttleTimer !== null) return` on a
	// MODULE-LEVEL handle. A test that ends with a recompute still armed leaves
	// that handle set, and `useRealTimers` then discards the fake timer it was
	// scheduled on — so the callback that would have nulled it never runs. The
	// NEXT test is then silently unable to arm its own recompute: it observes no
	// recompute at all and its assertion fails for a reason that has nothing to
	// do with what it tests. That is why several tests below drain with
	// `settle()`; this hook makes the leak impossible rather than each test
	// remembering to avoid it.
	//
	// Ordering matters: `resetRecomputeThrottle` clears the timeout, so it has
	// to run while the fake timers it was scheduled on are still installed.
	resetRecomputeThrottle();
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
		expect(tabStrip()).toEqual(["ve", "wind", "power", "vd", "convergence"]);

		clickTab("vd");
		await settle();

		expect(activeTabId()).toBe("vd-tab");
		expect(drawTargets).toContain("vdPlot");
		expect(missingTargets).toEqual([]);
	});

	it.each(["fit", "compare"])(
		"keeps VD visible, active and redrawn under %s",
		async (source) => {
			// The FIT air-speed channel is what the physics uses under both, so the
			// tab means something and stays.
			clickTab("vd");
			await settle();
			drawTargets.length = 0;

			await selectWindSource(source);

			expect(vdButtonHidden()).toBe(false);
			expect(tabStrip()).toEqual(["ve", "wind", "power", "vd", "convergence"]);
			expect(activeTabId()).toBe("vd-tab");
			// And it is REDRAWN for the new source, not left showing the old one.
			expect(drawTargets).toContain("vdPlot");
			expect(missingTargets).toEqual([]);
		},
	);

	it("hides VD under constant and lands the user on a VE drawn for constant", async () => {
		// Browser check 7, in the STITCHED panel. Standard used to be the exception
		// here (2026-08-05 ruling); the 2026-08-14 reversal makes it behave like
		// the stacked view and both GPS modes, so the tab no longer appears and
		// disappears as the lap-view toggle is flipped.
		clickTab("vd");
		await settle();
		expect(activeTabId()).toBe("vd-tab");
		drawTargets.length = 0;
		draws.length = 0;

		await selectWindSource("constant");

		// The tab is gone from BOTH axes — the strip reads VE | Wind | Power with
		// no gap, and the pane is `hidden`, not merely deactivated. `[hidden]` and
		// `.ve-tab-content--active` are different axes and neither implies the
		// other, which is exactly how a blank panel happens.
		expect(vdButtonHidden()).toBe(true);
		expect(tabStrip()).toEqual(["ve", "wind", "power", "convergence"]);
		expect((document.getElementById("vd-tab") as HTMLElement).hidden).toBe(true);

		// The guard moved them, and it moved them to something PAINTED.
		expect(activeTabId()).toBe("ve-tab");
		expect(drawTargets).toContain("vePlot");
		expect(missingTargets).toEqual([]);

		// THE POINT: the VE they land on is computed for the source they just
		// chose. A stale FIT redraw would slope the other way.
		expect(lastVeSlope()).toBeCloseTo(1, 10);
	});
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
		// tab, so it hides, the guard fires, and the tab it moves the user to has
		// to be actually painted. Since the 2026-08-14 reversal the stitched panel
		// above does the same thing — the pair of tests is what says the two views
		// of one mode agree, which is the whole reason for the reversal.
		clickTab("vd");
		await settle();
		expect(activeTabId()).toBe("vd-tab");
		overlay.ve.mockClear();
		drawTargets.length = 0;
		missingTargets.length = 0;

		await selectWindSource("constant");

		expect(vdButtonHidden()).toBe(true);
		expect(tabStrip()).toEqual(["ve", "wind", "power", "convergence"]);
		expect(activeTabId()).toBe("ve-tab");
		expect(overlay.ve).toHaveBeenCalled();
		expect(missingTargets).toEqual([]);
	});
});

/**
 * CR-01: what `appState.currentFilteredData` holds after Standard's ANALYZE
 * render, which is the value Store Result reads when nothing has been touched
 * yet — and, in the clamped-trim state below, the value it reads for the whole
 * life of the panel.
 *
 * These drive the real `showVirtualElevationAnalysisInline`, so unlike
 * `storageHandlers.test.ts` (which hand-builds the field) they actually execute
 * the writer.
 */
describe("standard: currentFilteredData after the analyze render (CR-01)", () => {
	/**
	 * The seed, captured BEFORE the first recompute can overwrite it.
	 *
	 * `summarize` ASSIGNS a fresh object to `appState.currentFilteredData`, so
	 * holding the reference is enough — the returned value is not mutated by the
	 * pass that follows.
	 *
	 * `showVirtualElevationAnalysisInline` leaves a recompute armed on a fake
	 * timer, which used to have to be drained here: `scheduleRecompute`'s
	 * `if (throttleTimer !== null) return` guard reads a MODULE-LEVEL handle, so
	 * a test that ends with one still armed left the NEXT test unable to arm its
	 * own — and that test then silently observed no recompute at all. The
	 * `afterEach` `resetRecomputeThrottle()` now clears the handle for every
	 * test in the file, so no drain is needed here. Verified by removing the
	 * hook: the clamp test below fails `expected 400 to be less than 400`.
	 */
	async function seedFromRender(): Promise<
		NonNullable<AppState["currentFilteredData"]>
	> {
		await renderStitched();
		const seeded = appState.currentFilteredData!;
		return seeded;
	}

	it("seeds through the shared concatenation, covering the analyzed laps", async () => {
		const seeded = await seedFromRender();

		// Both laps, one segment each — the segment convention
		// `standardSegments.ts` documents.
		expect(seeded.timestamps.length).toBe(SAMPLE_COUNT);
		// Four arrays of equal length, which `FilteredAnalysisData` implies and
		// every consumer indexes in parallel.
		expect(seeded.power.length).toBe(seeded.timestamps.length);
		expect(seeded.velocity.length).toBe(seeded.timestamps.length);
		expect(seeded.temperature.length).toBe(seeded.timestamps.length);
		expect(seeded.temperature.every((t) => t === 20)).toBe(true);
	});

	it("marks a missing temperature channel as NaN, never 0 \u00b0C", async () => {
		// The ride carries no temperature at all. `prepareAnalysisPayload` used to
		// push `\u2026 || 0` here and Standard's writer copied that array straight
		// into AppState, so Store Result persisted `avgTemperature: 0` \u2014
		// indistinguishable from a genuine 0 \u00b0C ride.
		(appState.currentFitData as any).temperature = [];

		const seeded = await seedFromRender();

		expect(seeded.temperature.length).toBe(seeded.timestamps.length);
		expect(seeded.temperature.every(Number.isNaN)).toBe(true);
		// The marker `handleStoreResult`'s `.some(Number.isFinite)` guard reads to
		// decide between a number and ABSENT.
		expect(seeded.temperature.some(Number.isFinite)).toBe(false);
	});

	it("still applies a SAVED trim that already sits at the 30-sample clamp", async () => {
		// The state the clamp itself parks users in: drag Trim Start into Trim End,
		// the clamp writes `start = end - 30`, a later control nudge persists the
		// pair exactly 30 apart, and re-analyzing reloads them. `handleTrim` then
		// took its clamp branch on the very first synthetic dispatch and returned
		// without `finish()`, so `summarize` never ran and `currentFilteredData`
		// kept the whole untrimmed selection while the plot showed 30 samples.
		appState.presetTrimEnd = SAMPLE_COUNT - 1;
		appState.presetTrimStart = SAMPLE_COUNT - 1 - 30;

		await renderStitched();
		await settle();

		const filtered = appState.currentFilteredData!;
		expect(filtered.timestamps.length).toBeLessThan(SAMPLE_COUNT);
		expect(filtered.timestamps[0]).toBe(SAMPLE_COUNT - 1 - 30);
		expect(filtered.timestamps[filtered.timestamps.length - 1]).toBe(
			SAMPLE_COUNT - 1,
		);
	});
});

/**
 * WR-4, Standard's half.
 *
 * The header spans used to be interpolated into the template from
 * `prepareAnalysisPayload`'s `initialResult` -- a fit over the CONCATENATED
 * selection with NO trim window and the wind source forced to `"fit"` with the
 * offset off -- while the plot immediately below them was drawn from the fit
 * this render computes itself, WITH the trim and WITH the selected source
 * (`renderStandardVe.ts:100-123`). Two fits of one ride, stacked, until the
 * post-bind kick replaced both a macrotask later.
 *
 * That parameter is gone: the template now ships the spans EMPTY and
 * `initializeVEAnalysis` fills them from the integration that just drew the
 * curve, on the same rule the virtual-distance header already followed. So the
 * disagreement is unwritable rather than merely corrected, and what is left to
 * guard is the half that can still regress -- that something fills them at all.
 * An empty template plus a forgotten fill would leave the user staring at
 * "R²: | RMSE: |" until the first nudge landed.
 *
 * Asserted BEFORE `settle()`, deliberately: after the kick, pass 3 has written
 * the spans and this would pass even if the first paint left them blank.
 */
describe("standard: the header spans at first paint (WR-4)", () => {
	it("carries the fit the plot below them was drawn from", async () => {
		await renderStitched();

		// The mocked calculator's own numbers -- so reaching them means the
		// render's own integration, not a value handed in from outside.
		expect(document.getElementById("r2Value")?.textContent).toBe("0.5000");
		expect(document.getElementById("rmseValue")?.textContent).toBe("1.00m");
		expect(document.getElementById("veGainValue")?.textContent).toBe("2.00m");
		expect(document.getElementById("actualGainValue")?.textContent).toBe(
			"3.00m",
		);
	});
});

/**
 * EVERY STANDARD PLOT REDRAWS WITH `Plotly.react` (bundle D).
 *
 * GPS-lap made this move already, pinned by `gpsLapPlotDrawMethod.test.ts`;
 * out-and-back followed, pinned by `outAndBackPlotDrawMethod.test.ts`. Standard
 * was the last holdout, and only on its FIRST draw: `bindStandardSliders`
 * already reached four of these five ids through `react`, while
 * `initializeVEAnalysis` opened every one of them with `newPlot`.
 *
 * Pinned here rather than in a unit test because this chain drives the real
 * render, so it sees the ids the panel actually opens with -- including the
 * ones whose panes are hidden at that moment, which a hand-built DOM would have
 * to guess at.
 *
 * A stub that provided only `react` would make this vacuous: any renderer would
 * be forced onto it. `fakePlotly` supplies both and records which was used, so
 * choosing `newPlot` is available and simply not taken.
 */
describe("standard: plots redraw by diffing, not by teardown", () => {
	it("opens all five plots with react and none with newPlot", async () => {
		await renderStitched();

		expect(drawMethods.filter(draw => draw.method === "newPlot")).toEqual([]);
		expect(drawMethods.map(draw => draw.id)).toEqual(
			expect.arrayContaining([
				"vePlot",
				"veResidualsPlot",
				"windSpeedPlot",
				"speedPowerPlot",
				"vdPlot",
			]),
		);
	});

	it("stays on react when a slider drag redraws them", async () => {
		await renderStitched();
		await settle();
		drawMethods.length = 0;

		await dragCda(0.3);

		expect(drawMethods.length).toBeGreaterThan(0);
		expect(drawMethods.filter(draw => draw.method === "newPlot")).toEqual([]);
	});
});

/**
 * THE TIME/DISTANCE X-AXIS SWITCH, end to end (bundle D).
 *
 * The unit cases cover the two halves separately: `distancePlotContext.test.ts`
 * holds the context builder, `plotXAxisToggle.test.ts` holds the one-setting
 * control, `standardSegments.test.ts` holds the cumulative distance. What none
 * of them can see is whether a click on the rendered control actually reaches
 * the figures — which is the whole feature, and which spans the toggle, the
 * tab render map, the adapter's `contextFor` and four figure builders.
 *
 * Asserted on the DRAWN x data rather than on a call count: the point of the
 * design is that no figure builder knows which axis it is drawing, so the only
 * honest observation is what came out.
 */
describe("standard: the time/distance x-axis switch", () => {
	function toggleButton(axis: "time" | "distance"): HTMLButtonElement {
		const button = document.querySelector<HTMLButtonElement>(
			`#ve-tab .plot-x-axis-toggle__btn[data-axis="${axis}"]`,
		);
		if (!button) throw new Error(`no ${axis} button in the VE pane`);
		return button;
	}

	function lastDraw(id: string) {
		const matching = draws.filter(draw => draw.id === id);
		return matching[matching.length - 1];
	}

	it("draws against time until the switch is used", async () => {
		await renderStitched();
		await settle();

		const ve = lastDraw("vePlot");
		// The time axis IS the sample index, so the last x is one less than the
		// series length rather than a distance.
		expect(Math.max(...ve.data[0].x)).toBeGreaterThan(50);
		expect(lastDraw("veResidualsPlot").layout.xaxis.title).toBe("Time (seconds)");
	});

	it("shows the control once a draw has seen a usable distance channel", async () => {
		await renderStitched();
		await settle();

		const group = document.querySelector<HTMLElement>("#ve-tab .plot-x-axis-toggle");
		expect(group).not.toBeNull();
		expect(group!.hidden).toBe(false);
	});

	it("redraws the VE pair in kilometres when Distance is clicked", async () => {
		await renderStitched();
		await settle();
		draws.length = 0;

		toggleButton("distance").click();
		await settle();

		const ve = lastDraw("vePlot");
		const residuals = lastDraw("veResidualsPlot");
		expect(ve).toBeDefined();

		// 10 m per sample in the fixture, so the whole selection is well under
		// 10 km -- a decisive separation from the index axis above.
		expect(Math.max(...ve.data[0].x)).toBeLessThan(10);
		expect(residuals.layout.xaxis.title).toBe("Distance (km)");
	});

	it("puts the trim boundary lines in kilometres too, not at sample indices", async () => {
		// The `xTrimStart`/`xTrimEnd` split. Under time the two are numerically
		// equal, so a builder that kept reading `trimStart` would pass every
		// time-axis test and put the dashed lines past the right edge here.
		await renderStitched();
		await settle();
		draws.length = 0;

		toggleButton("distance").click();
		await settle();

		const shapes = lastDraw("veResidualsPlot").layout.shapes;
		expect(shapes).toHaveLength(2);
		for (const shape of shapes) {
			expect(shape.x0).toBeLessThan(10);
		}
	});

	it("carries the axis over to a tab the user opens afterwards", async () => {
		// The "one setting, four controls" half: Wind was not redrawn by the
		// click, and must come up in distance when it is activated.
		await renderStitched();
		await settle();

		toggleButton("distance").click();
		await settle();
		draws.length = 0;

		clickTab("wind");
		await settle();

		const wind = lastDraw("windSpeedPlot");
		expect(wind).toBeDefined();
		expect(wind.layout.xaxis.title).toBe("Distance (km)");
		expect(Math.max(...wind.data[0].x)).toBeLessThan(10);
	});

	it("goes back to time, and takes the plots with it", async () => {
		await renderStitched();
		await settle();

		toggleButton("distance").click();
		await settle();
		draws.length = 0;

		toggleButton("time").click();
		await settle();

		expect(lastDraw("veResidualsPlot").layout.xaxis.title).toBe("Time (seconds)");
		expect(Math.max(...lastDraw("vePlot").data[0].x)).toBeGreaterThan(50);
	});

	it("keeps the axis across a slider drag", async () => {
		// The recompute path builds its own context. If it read the setting only
		// at first paint, a drag would silently snap the axis back to time.
		await renderStitched();
		await settle();

		toggleButton("distance").click();
		await settle();
		draws.length = 0;

		await dragCda(0.3);

		expect(lastDraw("veResidualsPlot").layout.xaxis.title).toBe("Distance (km)");
	});
});
