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
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

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

import {
	configureSection3Orchestration,
	setGpsAnalysisMode,
} from "./section3Orchestration";
import { AppState } from "../../state/AppState";

const SAMPLE_COUNT = 200;

function setupDom() {
	document.body.innerHTML = `
        <div id="analysisSection">
            <div id="results"></div>
        </div>
    `;
}

function makeAppState(): AppState {
	const appState = new AppState();
	appState.currentFileHash = null;
	const timestamps = Array.from({ length: SAMPLE_COUNT }, (_, i) => i);
	// GPS data present -- the maintainer's scenario. This is what routes the
	// post-render hook through the map branch the previous test skipped.
	appState.currentFitResult = {
		parsing_statistics: { has_gps_data: true },
		fit_data: {
			timestamps,
			position_lat: timestamps.map(() => 52.52),
			position_long: timestamps.map(() => 13.405),
			distance: timestamps.map((t) => t * 10),
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
