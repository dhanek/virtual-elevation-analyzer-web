/**
 * @vitest-environment jsdom
 *
 * GPS-01: the Section 3 mode selector reaches `setGpsAnalysisMode`.
 *
 * The requirement GPS-01 closed was "the user can reach the GPS analysis mode
 * selector from Section 3, next to the lap-selection UI", i.e. the dropdown was
 * MOVED out of Analysis Parameters. It was verified by hand and shipped, and it
 * has had no direct test since — the milestone audit recorded that gap against
 * both GPS-01 and GPS-02, Phase 7 closed GPS-02 in `section3ModeSwitch.test.ts`
 * and left this half open.
 *
 * WHAT WAS ACTUALLY UNCOVERED, and why it is not the same as GPS-02's block.
 * Every existing test of this area calls `setGpsAnalysisMode(...)` DIRECTLY.
 * That is the pipeline half — given a mode change, does the app unwind
 * correctly. Nothing asserted the half in front of it: that the `<select>` the
 * user actually operates is wired to that function at all. A dropdown bound to
 * nothing would leave all of those tests green.
 *
 * THE RE-RENDER IS THE POINT, not an incidental detail. `bindGpsModeSelector`
 * runs from `restoreSection3Controls`, which runs from `rerenderSection3`,
 * which `setGpsAnalysisMode` calls on every invocation — so using the dropdown
 * DESTROYS AND REPLACES THE DROPDOWN, along with the listener bound to it. The
 * binding therefore has to be re-established by the very render its own change
 * triggered, or the control works exactly once and then goes quietly inert.
 * That is why the second case below changes the mode twice: a single change
 * cannot tell a live re-binding apart from a listener that happened to survive
 * because nothing replaced it yet.
 */
import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";

/**
 * Section 3's re-render tears down and re-initialises the Leaflet map on a
 * timer. Only the methods that path actually reaches are stubbed; a missing one
 * surfaces as an unhandled rejection rather than a failing assertion, which is
 * noise that hides real failures.
 */
class FakeMap {
	public destroyed = false;
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

const mapInstances: FakeMap[] = [];

vi.mock("../../components/MapVisualization", () => ({
	MapVisualization: class {
		constructor() {
			const map = new FakeMap();
			mapInstances.push(map);
			return map as unknown as never;
		}
	},
}));

import {
	configureSection3Orchestration,
	getGpsAnalysisMode,
	setGpsAnalysisMode,
} from "./section3Orchestration";
import { AppState } from "../../state/AppState";
import type { AnalysisParameters } from "../../components/AnalysisParameters";

const SAMPLE_COUNT = 200;

const PARAMS = {
	cda: 0.25,
	crr: 0.0042,
	wind_speed: 3,
	wind_direction: 90,
	wind_height_factor: 1,
	velodrome: false,
	auto_calculate_rho: false,
} as unknown as AnalysisParameters;

/**
 * `has_gps_data: true` is load-bearing: `restoreSection3Controls` binds the
 * dropdown only on that branch, so a fixture without it would render a selector
 * that is CORRECTLY unbound and the tests would fail for the wrong reason.
 */
function makeAppState(): AppState {
	const appState = new AppState();
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

/** The element the user operates, as Section 3 last rendered it. */
function selector(): HTMLSelectElement {
	const el = document.getElementById(
		"gpsAnalysisMode",
	) as HTMLSelectElement | null;
	if (!el) throw new Error("#gpsAnalysisMode is not in the rendered markup");
	return el;
}

/** Operate the dropdown the way a user does: set the value, fire `change`. */
async function chooseMode(mode: string): Promise<void> {
	const el = selector();
	el.value = mode;
	el.dispatchEvent(new Event("change", { bubbles: true }));
	// The re-render the change triggers re-initialises the map on a 100 ms timer.
	await vi.advanceTimersByTimeAsync(500);
}

/**
 * Render Section 3 and bind its controls, without going through the dropdown —
 * `setGpsAnalysisMode` calls `rerenderSection3` unconditionally, so this is the
 * app's own first paint of the section.
 */
async function renderSection3(): Promise<void> {
	setGpsAnalysisMode("None");
	await vi.advanceTimersByTimeAsync(500);
}

describe("GPS-01: the Section 3 mode selector drives the analysis mode", () => {
	beforeEach(() => {
		document.body.innerHTML = `
            <div id="analysisSection">
                <div id="results"></div>
            </div>
            <div id="veAnalysisSection">
                <div id="veAnalysisContent"></div>
            </div>
        `;
		mapInstances.length = 0;
		vi.useFakeTimers();
		configure(makeAppState());
	});

	afterEach(() => {
		vi.useRealTimers();
	});

	it("renders the selector into Section 3, seeded with the current mode", async () => {
		await renderSection3();

		// GPS-01's own words: reachable from Section 3, not from Analysis
		// Parameters. `#results` is the subtree `rerenderSection3` replaces.
		const results = document.getElementById("results");
		expect(results?.querySelector("#gpsAnalysisMode")).not.toBeNull();
		expect(selector().value).toBe("None");
	});

	it("moves the analysis mode when the user picks one", async () => {
		await renderSection3();
		expect(getGpsAnalysisMode()).toBe("None");

		await chooseMode("GPS based lap splitting");

		expect(getGpsAnalysisMode()).toBe("GPS based lap splitting");
	});

	it("stays live after the re-render its own change triggers", async () => {
		await renderSection3();

		// The first change replaces the element this listener was bound to.
		await chooseMode("GPS based lap splitting");
		expect(getGpsAnalysisMode()).toBe("GPS based lap splitting");

		// So the second change is operating a DIFFERENT DOM node, and only a
		// re-binding can carry it. Without one the control is a one-shot.
		await chooseMode("GPS based out and back");
		expect(getGpsAnalysisMode()).toBe("GPS based out and back");
	});

	it("re-renders the selector showing the mode the app is now in", async () => {
		await renderSection3();
		const before = selector();
		await chooseMode("GPS based lap splitting");

		// NOT asserted on `.value`. `chooseMode` assigns that itself, so a
		// version of this test that read it back would pass on its own input —
		// it stayed green under a mutation that stopped the mode moving at all.
		// `data-gps-mode` is written by `renderSection3Template` from the state,
		// so only an actual re-render can produce it.
		const after = selector();
		expect(after).not.toBe(before);
		expect(after.getAttribute("data-gps-mode")).toBe("GPS based lap splitting");
	});
});
