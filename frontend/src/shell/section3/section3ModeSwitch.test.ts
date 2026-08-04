/**
 * @vitest-environment jsdom
 *
 * Regression coverage for the mode-switch Analyze-button defect.
 *
 * `rerenderSection3` replaces `#results` with `renderSection3Template`, whose
 * Analyze button is hard-coded `disabled`. The post-render hook only called
 * `setupAnalyzeButton()` (which attaches a click listener); nothing ever
 * re-evaluated the button against the retained selection, so after a GPS-mode
 * switch the still-selected laps could not be analysed until the user toggled a
 * checkbox. See deferred-items.md "maintainer defect 4".
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
	configureSection3Orchestration,
	setGpsAnalysisMode,
} from "./section3Orchestration";
import { AppState } from "../../state/AppState";

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
	// currentFitResult's setter derives currentFitData/currentLaps, so it must be
	// assigned first. No GPS data: keeps the re-render hook off the map/Leaflet
	// path so the test exercises only the handler re-binding the defect lives in.
	appState.currentFitResult = {
		parsing_statistics: { has_gps_data: false },
		fit_data: { timestamps: [0, 1, 2, 3, 4, 5] },
		laps: [
			{ total_elapsed_time: 60, total_distance: 1000, avg_power: 200 },
			{ total_elapsed_time: 60, total_distance: 1000, avg_power: 200 },
		],
	} as any;
	appState.selectedLaps = [1];
	return appState;
}

describe("Section 3 re-render after a GPS analysis mode switch", () => {
	beforeEach(() => {
		setupDom();
		vi.clearAllMocks();
	});

	it("re-evaluates the Analyze button so a retained selection stays analysable", async () => {
		const updateAnalyzeButton = vi.fn();
		const setupAnalyzeButton = vi.fn();
		const appState = makeAppState();

		configureSection3Orchestration({
			appState,
			parameterStorage: {} as any,
			getMapVisualization: () => null,
			setMapVisualization: () => {},
			getParametersComponent: () => null,
			updateAnalyzeButton,
			setupAnalyzeButton,
			showLoading: () => {},
			hideLoading: () => {},
			showError: () => {},
		});

		vi.useFakeTimers();
		try {
			setGpsAnalysisMode("GPS based lap splitting");
			await vi.advanceTimersByTimeAsync(200);
			setGpsAnalysisMode("None");
			// Only the post-render hook's re-evaluation counts: clear anything the
			// synchronous mode-change bookkeeping already recorded.
			updateAnalyzeButton.mockClear();
			await vi.advanceTimersByTimeAsync(200);
		} finally {
			vi.useRealTimers();
		}

		// The laps survive the re-render...
		const lapCheckbox = document.querySelector<HTMLInputElement>(
			'.lap-checkbox-item[data-lap="1"] input.lap-checkbox',
		);
		expect(lapCheckbox?.checked).toBe(true);

		// ...so the button must be re-evaluated against them, not left at the
		// template's hard-coded `disabled`.
		expect(setupAnalyzeButton).toHaveBeenCalled();
		expect(updateAnalyzeButton).toHaveBeenCalled();
	});
});
