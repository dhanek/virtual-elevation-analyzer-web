/**
 * @vitest-environment jsdom
 *
 * THE HANDOFF BETWEEN THE MAP'S TRIM FACE AND THE PANEL'S.
 *
 * The four map-trim nodes and the panel's `trimStartSlider`/`trimEndSlider` are
 * two faces of ONE trim window. `bindModeControls` keeps a record of the window
 * the pipeline has actually been told about (`lastRequestedTrimWindow`) and
 * `requestTrim` skips a window identical to it — the half of the old clamp
 * behaviour worth keeping, so that parking one edge against the other does not
 * recompute the identical window over and over.
 *
 * Until Section 3 took ownership of the map's face, the binder wrote that record
 * on every gesture, because every gesture went through it. It no longer does, so
 * a map drag left the record naming a window the pipeline had already moved off
 * — and the next PANEL gesture back to that window was silently swallowed: no
 * recompute, plots and Store Result describing a window the sliders do not show.
 *
 * WHY THIS FILE EXISTS RATHER THAN A CASE IN ONE OF THE TWO NEIGHBOURS: this is
 * the only scenario that needs the REAL binder and the REAL Section 3 handlers
 * in one document. `mapTrimModeUpdate.test.ts` mocks `requestModeUpdate` away,
 * so the binder's record is never involved; `modeControls.callshape.test.ts`
 * never renders Section 3, so the map nodes carry no handler. Only
 * `updateModeVEPlots` is mocked here (so the primitive's arguments can be
 * observed) plus `MapVisualization`, which jsdom cannot construct.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/** The observed argument object of every primitive call, in order. */
type PrimitiveArgs = Record<string, any>;

const primitive = vi.fn(async (_args: PrimitiveArgs) => null);

vi.mock("../analysis/updateModeVEPlots", () => ({
	updateModeVEPlots: (args: PrimitiveArgs) => primitive(args),
	isVeTabActive: () => false,
}));

const mapInstances: FakeMap[] = [];

class FakeMap {
	public destroyed = false;
	constructor(containerId: string) {
		if (!document.getElementById(containerId)) {
			throw new Error(`Container with id '${containerId}' not found`);
		}
		mapInstances.push(this);
	}
	async initialize(): Promise<void> {}
	setData(): void {}
	setSelectedLaps(): void {}
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
	setGpsMarkerA(): void {}
	setGpsMarkerB(): void {}
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

import type { AnalysisParameters } from "../../components/AnalysisParameters";
import type { ModeUpdateCallbacks } from "../../modes/analysis/types";
import { AppState } from "../../state/AppState";
import { bindModeControls } from "../analysis/bindModeControls";
import {
	clearModeUpdateCallbacks,
	registerModeUpdateCallbacks,
} from "../analysis/modeUpdateCallbacks";
import { resetModeUpdateRequests } from "../analysis/requestModeUpdate";
import { veViewMatchesSelection } from "../ve/veSelectionGuard";
import {
	configureSection3Orchestration,
	initializeSection3,
	updateSelectedLaps,
} from "./section3Orchestration";

const SAMPLE_COUNT = 400;
const LAST_INDEX = SAMPLE_COUNT - 1;

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

const noopCallbacks: ModeUpdateCallbacks = {
	aggregate: () => ({
		r2: 0,
		rmse: 0,
		veGain: 0,
		actualGain: 0,
		segmentCount: 0,
	}),
	renderVe: () => {},
	renderWind: () => {},
	renderPower: () => {},
	renderVd: () => {},
	renderMetrics: () => {},
};

/**
 * Section 3's containers plus the Standard panel. The map-trim nodes are NOT
 * here: `renderSection3Template` renders them, and a second copy would leave
 * `getElementById` looking at whichever came first in document order.
 */
function setupDom(): void {
	document.body.innerHTML = `
		<div id="analysisSection"><div id="results"></div></div>
		<div id="veAnalysisSection"><div id="veAnalysisContent">
			<input type="range" id="trimStartSlider" min="0" max="${SAMPLE_COUNT - 30}" value="0">
			<input type="number" id="trimStartValue" value="0">
			<input type="range" id="trimEndSlider" min="30" max="${LAST_INDEX}" value="${LAST_INDEX}">
			<input type="number" id="trimEndValue" value="${LAST_INDEX}">
			<input type="range" id="cdaSlider" min="0.1" max="0.5" step="0.001" value="0.25">
			<input type="number" id="cdaValue" value="0.250">
			<input type="range" id="crrSlider" min="0.001" max="0.02" step="0.0001" value="0.0042">
			<input type="number" id="crrValue" value="0.0042">
		</div></div>
		<div id="map"></div>
	`;
}

function makeAppState(): AppState {
	const appState = new AppState();
	appState.currentFileHash = null;
	const timestamps = Array.from({ length: SAMPLE_COUNT }, (_, i) => i);
	const zeros = () => new Array<number>(SAMPLE_COUNT).fill(0);
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
				end_time: LAST_INDEX,
			},
		],
	} as never;
	appState.selectedLaps = [1];
	appState.currentAnalyzedLaps = [1];
	appState.currentParameters = { ...PARAMS };
	appState.activeDisplayProfile = "fit-raw";
	appState.demProfilesAvailable = true;
	return appState;
}

async function renderSection3(appState: AppState): Promise<void> {
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
		updateAnalyzeButton: () => {},
		setupAnalyzeButton: () => {},
		showLoading: () => {},
		hideLoading: () => {},
		showError: () => {},
	});
	await initializeSection3();
	updateSelectedLaps();
	await Promise.resolve();
}

/** The real Standard binding, as `renderStandardVe` performs it. */
function bindPanel(appState: AppState): void {
	bindModeControls({
		appState,
		modeId: "standard",
		saveSettings: () => {},
		onTrimMapUpdate: () => {},
		mapCanFollow: () =>
			veViewMatchesSelection(appState.currentAnalyzedLaps, appState.selectedLaps),
		triggerAutoRho: () => {},
		getOffsetMetricWindows: () => [{ start: 0, end: LAST_INDEX }],
		getSyncErrorSeries: () => ({
			groundSpeed: new Array<number>(SAMPLE_COUNT).fill(10),
			airSpeed: new Array<number>(SAMPLE_COUNT).fill(10),
		}),
		getAutoCalibrationPercent: () => null,
	});
}

function el(id: string): HTMLInputElement {
	const found = document.getElementById(id);
	if (!found) throw new Error(`#${id} missing — the harness did not render it`);
	return found as HTMLInputElement;
}

/** Drain the recompute runner's throttle so the pass actually executes. */
async function settle(): Promise<void> {
	await vi.advanceTimersByTimeAsync(500);
}

/** A panel gesture: type a value into the trim number input and commit it. */
function typePanelTrimStart(value: number): void {
	const number = el("trimStartValue");
	number.value = String(value);
	number.dispatchEvent(new Event("change"));
}

/** A panel gesture on the other edge: type into the end number input. */
function typePanelTrimEnd(value: number): void {
	const number = el("trimEndValue");
	number.value = String(value);
	number.dispatchEvent(new Event("change"));
}

/** A map gesture: drag the map's start slider. */
function dragMapTrimStart(value: number): void {
	const slider = el("mapTrimStartSlider");
	slider.value = String(value);
	slider.dispatchEvent(new Event("input", { bubbles: true }));
}

/** A map gesture on the other edge: drag the map's end slider. */
function dragMapTrimEnd(value: number): void {
	const slider = el("mapTrimEndSlider");
	slider.value = String(value);
	slider.dispatchEvent(new Event("input", { bubbles: true }));
}

/** A map gesture through the number inputs rather than the sliders. */
function setMapTrimNumber(id: string, value: number): void {
	const number = el(id);
	number.value = String(value);
	number.dispatchEvent(new Event("change"));
}

/**
 * DRAIN `initializeSection3`'S DEFERRED RESTORE PASS BEFORE THE FAKE CLOCK GOES IN.
 *
 * `initializeSection3` ends in `setTimeout(async () => { ... }, 100)`
 * (`section3Orchestration.ts:1999-2058`), and that callback runs
 * `restoreSection3Controls` -> `updateSelectedLaps` ->
 * `initializeMapTrimControlsForSelectedLaps`, which REPLACES the four map-trim
 * nodes and, with no `currentFileHash` in this harness, resets
 * `presetTrimStart`/`presetTrimEnd` to `0`/`dataLength - 1`.
 *
 * It is a REAL timer, scheduled before `vi.useFakeTimers()`, so nothing in the
 * test controls when it lands: `advanceTimersByTimeAsync` yields to the real
 * loop, so on a quiet machine it fires inside the FIRST `settle()`, and under
 * the load of the whole suite it can fire inside the second — after the map
 * gesture, wiping the very values these cases assert. That is what made the
 * first draft of this block flake roughly one full-suite run in three.
 *
 * Waiting it out here, while the clock is still real, makes the pass
 * deterministic without changing any behaviour under test: it only forces the
 * re-init that happens anyway to happen BEFORE the first gesture.
 */
async function drainDeferredRestore(): Promise<void> {
	await new Promise((resolve) => setTimeout(resolve, 150));
}

beforeEach(() => {
	setupDom();
	mapInstances.length = 0;
	primitive.mockClear();
	resetModeUpdateRequests();
	clearModeUpdateCallbacks();
	registerModeUpdateCallbacks("standard", () => noopCallbacks);
	// `initializeSection3` constructs no map in this harness, so one is made here.
	new FakeMap("map");
});

afterEach(() => {
	vi.useRealTimers();
	clearModeUpdateCallbacks();
});

describe("the map's trim face and the panel's, in one document", () => {
	/**
	 * THE defect, as the review reproduced it on `fdaa8ab`: the third gesture
	 * produced no recompute at all, because the binder still believed the
	 * pipeline held `150..399` — the window the MAP had since moved off.
	 *
	 * Kills: the `noteTrimWindowRequested(...)` call removed from
	 * `commitMapTrim`. Without it this fails at 2 calls instead of 3.
	 */
	it("recomputes when the panel returns to a window the map moved off", async () => {
		const appState = makeAppState();
		await renderSection3(appState);
		vi.useFakeTimers();
		bindPanel(appState);

		typePanelTrimStart(150);
		await settle();

		dragMapTrimStart(200);
		await settle();

		typePanelTrimStart(150);
		await settle();

		expect(primitive).toHaveBeenCalledTimes(3);
		expect(primitive.mock.calls[2]![0].segments[0].trim).toEqual({
			start: 150,
			end: LAST_INDEX,
		});
		// And the panel actually shows the window it recomputed. A "fix" that
		// recomputes while leaving the slider reading 200 is not a fix.
		expect(el("trimStartSlider").value).toBe("150");
	});
});

/**
 * THE FLOOR AFTER A PANEL GESTURE.
 *
 * THE FIRST GESTURE BEING ON THE PANEL IS THE LOAD-BEARING PART OF EVERY CASE
 * HERE. The four map handlers enforce the 30-sample floor themselves, and the
 * window they measure it against has to be the PANEL's pair: nothing in the
 * binder writes `appState.presetTrimStart/End`, so after a panel gesture that
 * state names a window nobody is showing. The two clamp cases already in
 * `mapTrimModeUpdate.test.ts` drive the MAP twice, which keeps `appState` in
 * step with itself — which is why they pass even while a panel-first gesture
 * lets the two edges cross straight through each other.
 *
 * `170` and `330` are `origin/main`'s observed values for these two gestures
 * (round 13 probed main and it printed `map trimStart=170 panel trimStart=170
 * panel trimEnd=200`), so these cases assert that the branch reproduces main.
 */
describe("the 30-sample floor after a PANEL gesture", () => {
	it("clamps the map START slider against the panel's end, not a stale appState", async () => {
		const appState = makeAppState();
		await renderSection3(appState);
		await drainDeferredRestore();
		vi.useFakeTimers();
		bindPanel(appState);

		typePanelTrimEnd(200);
		await settle();

		dragMapTrimStart(300);
		await settle();

		expect(el("mapTrimStartSlider").value).toBe("170");
		expect(el("mapTrimStartValue").value).toBe("170");
		expect(el("trimStartSlider").value).toBe("170");
		expect(el("trimEndSlider").value).toBe("200");
	});

	it("clamps the map END slider against the panel's start", async () => {
		const appState = makeAppState();
		await renderSection3(appState);
		await drainDeferredRestore();
		vi.useFakeTimers();
		bindPanel(appState);

		typePanelTrimStart(300);
		await settle();

		dragMapTrimEnd(200);
		await settle();

		expect(el("mapTrimEndSlider").value).toBe("330");
		expect(el("mapTrimEndValue").value).toBe("330");
		expect(el("trimEndSlider").value).toBe("330");
		expect(el("trimStartSlider").value).toBe("300");
	});

	it("clamps the map START number input the same way", async () => {
		const appState = makeAppState();
		await renderSection3(appState);
		await drainDeferredRestore();
		vi.useFakeTimers();
		bindPanel(appState);

		typePanelTrimEnd(200);
		await settle();

		setMapTrimNumber("mapTrimStartValue", 300);
		await settle();

		expect(el("mapTrimStartSlider").value).toBe("170");
		expect(el("mapTrimStartValue").value).toBe("170");
		expect(el("trimStartSlider").value).toBe("170");
		expect(el("trimEndSlider").value).toBe("200");
	});

	it("clamps the map END number input the same way", async () => {
		const appState = makeAppState();
		await renderSection3(appState);
		await drainDeferredRestore();
		vi.useFakeTimers();
		bindPanel(appState);

		typePanelTrimStart(300);
		await settle();

		setMapTrimNumber("mapTrimEndValue", 200);
		await settle();

		expect(el("mapTrimEndSlider").value).toBe("330");
		expect(el("mapTrimEndValue").value).toBe("330");
		expect(el("trimEndSlider").value).toBe("330");
		expect(el("trimStartSlider").value).toBe("300");
	});
});
