/**
 * @vitest-environment jsdom
 *
 * THE MAP-TRIM SLIDERS MUST ASK THE PANEL TO RECOMPUTE, AND KEEP ASKING.
 *
 * Section 3's four map-trim nodes had TWO owners. `MODE_CONTROL_TABLE` declared
 * them as `mapTrim` rows and `bindModeControls` wired them at ANALYZE time;
 * `initializeMapTrimControlsForSelectedLaps` CLONED all four on every Section 3
 * render (`// Remove old listeners by cloning elements`) and attached its own.
 * The clone stripped the table's listeners along with the stale ones, and the
 * replacements never called `requestModeUpdate` — so the sliders moved the map,
 * saved settings and left the VE panel describing the previous window.
 *
 * Measured in the running app on 2026-09-02, counting `syncRangeAndNumber`'s
 * `Range [mapTrimStartSlider] changed to N` line, which only the TABLE binding
 * emits: present immediately after Analyze, ABSENT after one lap-checkbox click.
 *
 * The fix follows this table's OWN stated doctrine (`modeControlTable.ts:34-39`):
 * a reason raised by a control that is not inside the mode panel gets no row and
 * is raised by Section 3 directly, exactly as `segmentSelection` already is
 * (`section3Orchestration.ts:384`). The map-trim sliders live in Section 3, so
 * they are Section 3's to own — and the clone becomes harmless, because the only
 * listeners it strips are the ones the same function immediately re-adds.
 *
 * Every case below names the mutation that kills it.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AnalysisParameters } from "../../components/AnalysisParameters";
import { AppState } from "../../state/AppState";

const SAMPLE_COUNT = 400;

/** The funnel is the observable: these cases are about who ASKS, not what it does. */
const modeUpdate = vi.hoisted(() => ({ request: vi.fn() }));

vi.mock("../analysis/requestModeUpdate", async (importOriginal) => ({
	...(await importOriginal<Record<string, unknown>>()),
	requestModeUpdate: (...args: unknown[]) => modeUpdate.request(...args),
}));

const mapInstances: FakeMap[] = [];

class FakeMap {
	public destroyed = false;
	// Recorded, not ignored: a fix that stops the map following would otherwise
	// pass every assertion in this file.
	public trimRegionFits: Array<{ start: number; end: number }> = [];
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
	fitBoundsToTrimRegion(start: number, end: number): void {
		this.trimRegionFits.push({ start, end });
	}
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

import {
	configureSection3Orchestration,
	initializeSection3,
	updateSelectedLaps,
} from "./section3Orchestration";
import { MODE_CONTROL_TABLE } from "../analysis/modeControlTable";

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

function setupDom() {
	document.body.innerHTML = `
        <div id="analysisSection"><div id="results"></div></div>
        <div id="veAnalysisSection"><div id="veAnalysisContent">
            <input id="trimStartSlider" type="range" min="0" max="399" value="0" />
            <input id="trimStartValue" type="number" value="0" />
            <input id="trimEndSlider" type="range" min="0" max="399" value="399" />
            <input id="trimEndValue" type="number" value="399" />
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
				end_time: SAMPLE_COUNT - 1,
			},
		],
	} as never;
	appState.selectedLaps = [1];
	appState.currentParameters = { ...PARAMS };
	appState.activeDisplayProfile = "fit-raw";
	appState.demProfilesAvailable = true;
	return appState;
}

function configure(appState: AppState) {
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
}

function startSlider(): HTMLInputElement {
	const el = document.getElementById("mapTrimStartSlider");
	if (!el) throw new Error("mapTrimStartSlider missing — Section 3 did not render");
	return el as HTMLInputElement;
}

/** One drag step on the start slider, as the browser delivers it. */
function dragStartTo(value: number): void {
	const slider = startSlider();
	slider.value = String(value);
	slider.dispatchEvent(new Event("input", { bubbles: true }));
}

function mapTrimRequests(): number {
	return modeUpdate.request.mock.calls.filter((c) => c[0] === "mapTrim").length;
}

async function renderSection3(appState: AppState) {
	configure(appState);
	await initializeSection3();
	updateSelectedLaps();
	await Promise.resolve();
}

describe("the map-trim sliders and the recompute funnel", () => {
	beforeEach(() => {
		setupDom();
		mapInstances.length = 0;
		modeUpdate.request.mockClear();
		// `initializeSection3` constructs no map in this harness, so one is made
		// here. Without it the map case asserts against an empty `mapInstances`
		// and fails for a harness reason rather than a code one.
		new FakeMap("map");
	});

	/**
	 * THE defect. The sliders moved the map and saved settings while the VE
	 * panel kept describing the previous window, because nothing on this path
	 * ever reached the funnel.
	 *
	 * Kills: the `requestModeUpdate("mapTrim")` call removed from Section 3's
	 * start-slider handler.
	 */
	it("asks the panel to recompute when the start slider moves", async () => {
		const appState = makeAppState();
		await renderSection3(appState);

		dragStartTo(25);

		expect(mapTrimRequests()).toBe(1);
	});

	/**
	 * The regression the item was filed for, and the case the whole change
	 * exists to make impossible: a Section 3 re-render must not leave the
	 * control inert. `updateSelectedLaps` re-runs the clone every time.
	 *
	 * Kills: a fix that binds the funnel call ONCE outside the re-render path,
	 * so it is stripped by the clone exactly as the table's binding was.
	 */
	it("keeps asking after the re-render that clones the controls", async () => {
		const appState = makeAppState();
		await renderSection3(appState);

		dragStartTo(25);
		updateSelectedLaps(); // the clone runs again
		await Promise.resolve();
		dragStartTo(60);

		expect(mapTrimRequests()).toBe(2);
	});

	/**
	 * Kills a fix that stacks listeners instead of replacing them — the exact
	 * failure the clone was written to prevent. A count assertion elsewhere
	 * would read a double-fire as success.
	 */
	it("asks exactly once per drag step, after repeated re-renders", async () => {
		const appState = makeAppState();
		await renderSection3(appState);

		for (let i = 0; i < 3; i++) {
			updateSelectedLaps();
			await Promise.resolve();
		}
		dragStartTo(40);

		expect(mapTrimRequests()).toBe(1);
	});

	/**
	 * THE OTHER HALF OF THE OWNERSHIP RULE, and the one that stops the fix from
	 * trading a dead control for a double-firing one.
	 *
	 * Section 3's clone runs BEFORE `bindModeControls` — measured in the app on
	 * 2026-09-02, where the table's binding was alive immediately after Analyze.
	 * So a `mapTrim` row would put the binder's listener on the same four nodes
	 * that now carry Section 3's own, and one drag would reach the funnel twice.
	 *
	 * Asserting the table's contents rather than the double call is deliberate:
	 * the harness above never runs Analyze, so a behavioural assertion here
	 * would be vacuous. This is the declaration that has to stay true.
	 *
	 * Kills: either `mapTrim` row put back into `MODE_CONTROL_TABLE`.
	 */
	it("declares no mapTrim row, because Section 3 owns those controls", () => {
		const rows = MODE_CONTROL_TABLE.filter((spec) => spec.reason === "mapTrim");
		expect(rows).toEqual([]);
	});

	/**
	 * THE MIRROR, AND IT IS LOAD-BEARING RATHER THAN COSMETIC.
	 *
	 * `requestModeUpdate` reads the window it recomputes with from
	 * `trimStartSlider`/`trimEndSlider` — the PANEL's pair, not these
	 * (`requestModeUpdate.ts:116-131`). The binder used to keep the two faces in
	 * step through `writeTrim`; with no `mapTrim` row that no longer happens, so
	 * Section 3 has to do it before it raises the reason.
	 *
	 * Without this the panel would recompute against the PREVIOUS window on
	 * every map-trim drag — quietly wrong, and worse than not recomputing.
	 *
	 * Kills: the mirror write dropped from `commitMapTrim`.
	 */
	it("mirrors the new value onto the panel's own trim pair", async () => {
		const appState = makeAppState();
		await renderSection3(appState);

		dragStartTo(55);

		expect((document.getElementById("trimStartSlider") as HTMLInputElement).value).toBe("55");
		expect((document.getElementById("trimStartValue") as HTMLInputElement).value).toBe("55");
	});

	/**
	 * The map must keep following. Section 3's handler owns this, and a fix
	 * that reached the funnel while dropping the map update would satisfy every
	 * case above.
	 */
	it("still moves the map when the slider moves", async () => {
		const appState = makeAppState();
		await renderSection3(appState);
		const map = mapInstances.find((m) => !m.destroyed);
		const before = map?.trimRegionFits.length ?? 0;

		dragStartTo(30);

		expect((map?.trimRegionFits.length ?? 0) - before).toBeGreaterThan(0);
		const last = map?.trimRegionFits[(map?.trimRegionFits.length ?? 1) - 1];
		expect(last?.start).toBe(30);
	});

	/**
	 * `presetTrimStart` is what `initializeVEAnalysis` and auto-rho read, and
	 * nothing in the binder ever wrote it — only these handlers do. A fix that
	 * moved ownership without carrying this write would break the pipeline
	 * silently.
	 */
	it("records the new trim start in app state", async () => {
		const appState = makeAppState();
		await renderSection3(appState);

		dragStartTo(45);

		expect(appState.presetTrimStart).toBe(45);
	});
});
