/**
 * @vitest-environment jsdom
 *
 * MOVING AN OUT-AND-BACK GATE MUST TAKE THE VE PANEL WITH IT — and an ordinary
 * re-render must not.
 *
 * `runOutAndBackDetection` re-cuts the ride, so a panel analysed from the
 * previous cut describes segments that no longer exist. The first attempt at
 * this invalidation compared `currentCoveredItems` against
 * `outAndBackSelectedSections`, which the same function had just assigned from
 * `detectSections().map(s => s.sectionNumber)` — the detector's own sequential
 * 1..N. A gate nudge that still yields three sections therefore compared
 * `[1, 2, 3]` with `[1, 2, 3]`, and the guard could not fire in the one case its
 * comment described. What changes under a gate move is WHERE each section starts
 * and ends, so that is what the guard compares now.
 *
 * THE OTHER DIRECTION IS THE REASON THIS CANNOT SIMPLY BE UNCONDITIONAL.
 * `bindOutAndBackDetection` ends with an initial `void updateGates()`
 * (`bindOutAndBackDetection.ts:176`), and that binder runs from
 * `rerenderSection3`. So detection re-runs, with the gates unmoved, on every
 * Section 3 re-render — the reconciliation shape that the first describe block
 * of `section3ModeSwitch.test.ts` exists to protect. Both directions are pinned
 * below.
 *
 * THE DETECTOR IS FAKED, and only the detector. It is the one collaborator whose
 * output this guard reads, and driving the real one would mean synthesising GPS
 * traces that retrace a course precisely enough to yield a chosen set of index
 * ranges — a fixture whose own correctness would then be the thing under test.
 * Everything else here is production: `runOutAndBackDetection`, the real
 * `tearDownVeAnalysisPanel` it reaches, and the real module-level state both
 * read.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/** What `detectSections()` will return on the next call. */
const detected = vi.hoisted(() => ({ sections: [] as unknown[] }));

vi.mock("../../utils/GpsLapDetection", async (importOriginal) => ({
	...(await importOriginal<Record<string, unknown>>()),
	OutAndBackDetector: class {
		detectSections() {
			return {
				detectedSections: detected.sections,
				passingsA: [],
				passingsB: [],
			};
		}
	},
}));

import {
	configureSection3Orchestration,
	runOutAndBackDetection,
} from "./section3Orchestration";
import { AppState } from "../../state/AppState";
import type { OutAndBackSection } from "../../utils/GpsLapDetection";
import { resetRecomputeThrottle } from "../analysis/recomputeRunner";
import { clearModeUpdateCallbacks } from "../analysis/modeUpdateCallbacks";
import { resetModeUpdateRequests } from "../analysis/requestModeUpdate";

const SAMPLE_COUNT = 200;

/**
 * One section, identified the way the guard identifies it: by its four index
 * bounds. `sectionNumber` is deliberately a separate argument so a test can hold
 * the number fixed while the ranges move — which is precisely the case the old
 * comparison could not see.
 */
function section(
	sectionNumber: number,
	outboundStartIdx: number,
	outboundEndIdx: number,
	inboundStartIdx: number,
	inboundEndIdx: number,
): OutAndBackSection {
	return {
		sectionNumber,
		outboundStartIdx,
		outboundEndIdx,
		outboundStartDirection: 0,
		outboundEndDirection: 0,
		outboundDuration: 60,
		outboundDistance: 1,
		inboundStartIdx,
		inboundEndIdx,
		inboundStartDirection: 180,
		inboundEndDirection: 180,
		inboundDuration: 60,
		inboundDistance: 1,
	} as OutAndBackSection;
}

function setupDom() {
	document.body.innerHTML = `
        <div id="analysisSection"><div id="results"></div></div>
        <div id="veAnalysisSection">
            <div id="veAnalysisContent"></div>
        </div>
    `;
}

function veSectionHidden(): boolean {
	const el = document.getElementById("veAnalysisSection");
	if (!el) throw new Error("#veAnalysisSection is not on the page");
	return el.classList.contains("hidden");
}

function makeAppState(): AppState {
	const appState = new AppState();
	appState.currentFileHash = null;
	const timestamps = Array.from({ length: SAMPLE_COUNT }, (_, i) => i);
	appState.currentFitResult = {
		parsing_statistics: { has_gps_data: true },
		fit_data: {
			timestamps,
			position_lat: timestamps.map(() => 52.52),
			position_long: timestamps.map(() => 13.405),
			distance: timestamps.map((t) => t * 10),
		},
		laps: [],
	} as never;
	// No FIT lap selection, so detection runs over the whole activity and the
	// trim branch at the top of `runOutAndBackDetection` stays out of the way.
	appState.selectedLaps = [];
	return appState;
}

function configure(appState: AppState) {
	configureSection3Orchestration({
		appState,
		parameterStorage: {
			loadLapSettings: () => Promise.resolve(null),
			saveLapSettings: () => Promise.resolve(),
		} as never,
		getMapVisualization: () => null as never,
		setMapVisualization: () => {},
		getParametersComponent: () => null,
		updateAnalyzeButton: () => {},
		setupAnalyzeButton: () => {},
		showLoading: () => {},
		hideLoading: () => {},
		showError: () => {},
	});
}

/**
 * The state a completed out-and-back analyze leaves behind: a visible panel, a
 * result, and — the field the guard reads — the sections that were actually
 * drawn, written by `showOutAndBackVEAnalysis` (`renderOutAndBack.ts:101`).
 */
function analyzed(appState: AppState, sections: OutAndBackSection[]): void {
	document.getElementById("veAnalysisSection")?.classList.remove("hidden");
	appState.currentVEResult = { r2: 0.9 } as never;
	appState.currentOutAndBackSections = sections;
	appState.currentCoveredItems = sections.map((s) => s.sectionNumber);
}

describe("the VE panel after an out-and-back gate re-detection", () => {
	beforeEach(() => {
		setupDom();
		detected.sections = [];
		clearModeUpdateCallbacks();
		resetModeUpdateRequests();
	});

	afterEach(() => {
		resetRecomputeThrottle();
		clearModeUpdateCallbacks();
		resetModeUpdateRequests();
	});

	it("tears the panel down when a gate move re-cuts the ride", async () => {
		const appState = makeAppState();
		configure(appState);
		analyzed(appState, [
			section(1, 0, 40, 41, 80),
			section(2, 81, 120, 121, 160),
		]);

		// THE REPORTED CASE. The gate moved five samples, both sections shifted
		// with it, and the detector numbered its output 1 and 2 again — so the
		// section NUMBERS are unchanged and only the ranges say what happened.
		detected.sections = [
			section(1, 5, 45, 46, 85),
			section(2, 86, 125, 126, 165),
		];
		await runOutAndBackDetection(52.52, 13.405, 52.53, 13.406);

		expect(veSectionHidden()).toBe(true);
		expect(appState.currentVEResult).toBeNull();
		expect(appState.currentOutAndBackSections).toEqual([]);
	});

	it("tears the panel down when the re-cut drops an analysed section", async () => {
		const appState = makeAppState();
		configure(appState);
		analyzed(appState, [
			section(1, 0, 40, 41, 80),
			section(2, 81, 120, 121, 160),
		]);

		detected.sections = [section(1, 0, 40, 41, 80)];
		await runOutAndBackDetection(52.52, 13.405, 52.53, 13.406);

		expect(veSectionHidden()).toBe(true);
		expect(appState.currentVEResult).toBeNull();
	});

	it("leaves the panel alone when the gates have not moved", async () => {
		const appState = makeAppState();
		configure(appState);
		const cut = [section(1, 0, 40, 41, 80), section(2, 81, 120, 121, 160)];
		analyzed(appState, cut);

		// `bindOutAndBackDetection` runs an initial `updateGates()` on every
		// Section 3 re-render, which re-derives exactly this. Tearing down here
		// would destroy a valid panel on an ordinary mode re-render.
		detected.sections = cut.map((s) => ({ ...s }));
		await runOutAndBackDetection(52.52, 13.405, 52.53, 13.406);

		expect(veSectionHidden()).toBe(false);
		expect(appState.currentVEResult).not.toBeNull();
	});

	it("leaves the panel alone when the re-cut only adds a section", async () => {
		const appState = makeAppState();
		configure(appState);
		analyzed(appState, [section(1, 0, 40, 41, 80)]);

		// Everything on screen still describes the ride accurately; there is
		// simply more of the ride available to analyse next time.
		detected.sections = [
			section(1, 0, 40, 41, 80),
			section(2, 81, 120, 121, 160),
		];
		await runOutAndBackDetection(52.52, 13.405, 52.53, 13.406);

		expect(veSectionHidden()).toBe(false);
		expect(appState.currentVEResult).not.toBeNull();
	});

	it("does not tear down when nothing has been analysed yet", async () => {
		const appState = makeAppState();
		configure(appState);

		// The FIRST detection, before any analyze. `currentOutAndBackSections` is
		// empty, so there is no panel to invalidate and the guard must not fire.
		detected.sections = [section(1, 0, 40, 41, 80)];
		await runOutAndBackDetection(52.52, 13.405, 52.53, 13.406);

		expect(veSectionHidden()).toBe(false);
		expect(appState.outAndBackSelectedSections).toEqual([1]);
	});

	/**
	 * The gap the old comparison had even when its numbers happened to differ:
	 * `currentCoveredItems` is nulled by `resolveMultiSegmentAnalysisParams`
	 * (`MultiSegmentSettings.ts:89`) and refilled only by `summarize`, so a
	 * re-detection landing between Analyze and the first recompute found no
	 * analysed basis at all and returned early. `currentOutAndBackSections` is
	 * written at RENDER, so it is already there.
	 */
	it("still invalidates before the first recompute has reported coverage", async () => {
		const appState = makeAppState();
		configure(appState);
		analyzed(appState, [section(1, 0, 40, 41, 80)]);
		appState.currentCoveredItems = null;

		detected.sections = [section(1, 5, 45, 46, 85)];
		await runOutAndBackDetection(52.52, 13.405, 52.53, 13.406);

		expect(veSectionHidden()).toBe(true);
		expect(appState.currentVEResult).toBeNull();
	});
});
