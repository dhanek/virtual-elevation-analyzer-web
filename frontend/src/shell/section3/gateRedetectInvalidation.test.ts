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

/** What the two detectors will return on the next call. */
const detected = vi.hoisted(() => ({
	sections: [] as unknown[],
	laps: [] as unknown[],
}));

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
	GpsLapDetector: class {
		detectLaps() {
			return {
				detectedLaps: detected.laps,
				passings: [],
				markerLat: 0,
				markerLon: 0,
			};
		}
	},
}));

import {
	configureSection3Orchestration,
	handleGpsLapSelectionChange,
	runGpsLapDetection,
	runOutAndBackDetection,
} from "./section3Orchestration";
import { AppState } from "../../state/AppState";
import type {
	DetectedLap,
	OutAndBackSection,
} from "../../utils/GpsLapDetection";
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
	// AND THE DETECTION THAT PRODUCED IT. The guard compares the detected list
	// before against the detected list after, so a fixture that leaves
	// `outAndBackSections` empty is not "a panel over an unchanged detection" —
	// it is a panel over no detection at all, and every re-detection reads as a
	// change. Production always has both.
	appState.outAndBackSections = sections;
	appState.outAndBackSelectedSections = sections.map((s) => s.sectionNumber);
}

describe("the VE panel after an out-and-back gate re-detection", () => {
	beforeEach(() => {
		setupDom();
		detected.sections = [];
		detected.laps = [];
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

	/**
	 * SPARING THIS CASE WAS THE SECOND WRONG ANSWER, and it shipped.
	 *
	 * The reasoning was that everything on screen still describes the ride
	 * accurately, so an added section is no reason to throw the panel away. It
	 * is: the panel's own section NUMBERS are the key Store Result and the saved
	 * CdA/Crr live under, and a detection that gained a section has renumbered
	 * them. Observed as the GPS-lap count going 6 -> 14 under a plot that stayed
	 * put (2026-09-01). A detection that changed is a basis that changed,
	 * whichever direction it moved.
	 */
	it("tears the panel down when the re-cut only adds a section", async () => {
		const appState = makeAppState();
		configure(appState);
		analyzed(appState, [section(1, 0, 40, 41, 80)]);

		detected.sections = [
			section(1, 0, 40, 41, 80),
			section(2, 81, 120, 121, 160),
		];
		await runOutAndBackDetection(52.52, 13.405, 52.53, 13.406);

		expect(veSectionHidden()).toBe(true);
		expect(appState.currentVEResult).toBeNull();
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


/**
 * THE SAME TWO GUARDS, IN THE MODE THAT NEVER HAD EITHER.
 *
 * `runGpsLapDetection` had no invalidation at all, and neither did
 * `handleGpsLapSelectionChange` — while their out-and-back twins had one each.
 * The gap was masked rather than caught: before the FIT-lap fix,
 * `updateSelectedLaps` compared `currentAnalyzedLaps` (GPS virtual laps here)
 * against `selectedLaps` (FIT laps) and tore the panel down whenever those two
 * unrelated lists happened to differ. Coincidental teardowns are not a guard,
 * and removing the wrong comparison left GPS-lap mode with nothing.
 */
describe("the VE panel in GPS-lap mode", () => {
	beforeEach(() => {
		setupDom();
		detected.sections = [];
		detected.laps = [];
		clearModeUpdateCallbacks();
		resetModeUpdateRequests();
	});

	afterEach(() => {
		resetRecomputeThrottle();
		clearModeUpdateCallbacks();
		resetModeUpdateRequests();
	});

	/**
	 * GPS-lap detection is SCOPED TO THE FIT SELECTION and bails outright
	 * without one (`section3Orchestration.ts:701`), so this mode's fixture
	 * carries a FIT lap over the whole activity. The trim that implies is not
	 * what these tests are about — the faked detector ignores it — but without
	 * it the function under test never runs.
	 */
	function configureWithFitLap(appState: AppState): void {
		configure(appState);
		appState.currentLaps = [{ start_time: 0, end_time: SAMPLE_COUNT - 1 }] as never;
		appState.selectedLaps = [1];
	}

	function lap(lapNumber: number, startIdx: number, endIdx: number): DetectedLap {
		return {
			lapNumber,
			startIdx,
			endIdx,
			startTime: startIdx,
			endTime: endIdx,
			duration: endIdx - startIdx,
			distance: 1,
			startDirection: 0,
			endDirection: 0,
			directionName: "N",
			startLat: 52.52,
			startLon: 13.405,
		} as DetectedLap;
	}

	/**
	 * The state a completed GPS-lap analyze leaves behind. The basis is
	 * `currentGpsLapIndexRanges`, written by `gpsLapMode.syncState`
	 * (`gpsLapMode.ts:70`) and cleared by the teardown, exactly as
	 * `currentOutAndBackSections` is.
	 */
	function analyzedLaps(appState: AppState, laps: DetectedLap[]): void {
		document.getElementById("veAnalysisSection")?.classList.remove("hidden");
		appState.currentVEResult = { r2: 0.9 } as never;
		appState.currentGpsLapIndexRanges = laps.map((l) => ({
			startIdx: l.startIdx,
			endIdx: l.endIdx,
		}));
		appState.currentCoveredItems = laps.map((l) => l.lapNumber);
		// And the detection it came from — see the out-and-back twin above.
		appState.gpsDetectedLaps = laps;
		appState.gpsSelectedLaps = laps.map((l) => l.lapNumber);
	}

	describe("after a gate re-detection", () => {
		it("tears the panel down when the gate move re-cuts the laps", async () => {
			const appState = makeAppState();
			configureWithFitLap(appState);
			analyzedLaps(appState, [lap(1, 0, 80), lap(2, 81, 160)]);

			// Three laps before, three laps after, numbered 1..3 both times —
			// the shape that made the section-number comparison useless.
			detected.laps = [lap(1, 5, 85), lap(2, 86, 165)];
			await runGpsLapDetection(52.52, 13.405, 0);

			expect(veSectionHidden()).toBe(true);
			expect(appState.currentVEResult).toBeNull();
			expect(appState.currentGpsLapIndexRanges).toBeNull();
		});

		/**
		 * THE REPORTED SEQUENCE, in the mode it was reported in. With FIT lap 8
		 * selected the gate found 6 laps and the user analysed one of them;
		 * ticking lap 10 as well widened the detection window and the count went
		 * to 14 — while the plot stayed, still labelled with lap numbers that now
		 * belong to different laps (2026-09-01).
		 */
		it("tears the panel down when a wider window finds more laps", async () => {
			const appState = makeAppState();
			configureWithFitLap(appState);
			analyzedLaps(appState, [lap(1, 0, 80), lap(2, 81, 160)]);

			// Every analysed range survives untouched; there are simply more of
			// them now. That is still a changed basis.
			detected.laps = [lap(1, 0, 80), lap(2, 81, 160), lap(3, 161, 240)];
			await runGpsLapDetection(52.52, 13.405, 0);

			expect(veSectionHidden()).toBe(true);
			expect(appState.currentVEResult).toBeNull();
		});

		/**
		 * A RE-DETECTION THAT CHANGED NOTHING MUST NOT RE-TICK WHAT THE USER
		 * UNTICKED.
		 *
		 * Auto-selecting every detected lap was harmless while a checkbox change
		 * tore the panel down. Once a checkbox NARROWS the panel instead, an
		 * unconditional reset leaves the sidebar claiming five laps over a panel
		 * computing four, and no gesture resyncs them.
		 */
		it("keeps a narrowed selection when the detection is unchanged", async () => {
			const appState = makeAppState();
			configureWithFitLap(appState);
			const laps = [lap(1, 0, 80), lap(2, 81, 160), lap(3, 161, 240)];
			analyzedLaps(appState, laps);
			appState.gpsSelectedLaps = [1, 3];

			detected.laps = laps.map((l) => ({ ...l }));
			await runGpsLapDetection(52.52, 13.405, 0);

			expect(appState.gpsSelectedLaps).toEqual([1, 3]);
			expect(veSectionHidden()).toBe(false);
		});

		it("selects everything again when the detection did move", async () => {
			const appState = makeAppState();
			configureWithFitLap(appState);
			analyzedLaps(appState, [lap(1, 0, 80), lap(2, 81, 160)]);
			appState.gpsSelectedLaps = [1];

			// The panel is torn down by this, so there is nothing left for the
			// selection to contradict and all-selected is the right fresh start.
			detected.laps = [lap(1, 5, 85), lap(2, 86, 165)];
			await runGpsLapDetection(52.52, 13.405, 0);

			expect(appState.gpsSelectedLaps).toEqual([1, 2]);
			expect(veSectionHidden()).toBe(true);
		});

		it("leaves the panel alone when the gate has not moved", async () => {
			const appState = makeAppState();
			configureWithFitLap(appState);
			const laps = [lap(1, 0, 80), lap(2, 81, 160)];
			analyzedLaps(appState, laps);

			// `bindGpsDetection` runs an initial detection on every Section 3
			// re-render, so this pass must not disturb a valid panel.
			detected.laps = laps.map((l) => ({ ...l }));
			await runGpsLapDetection(52.52, 13.405, 0);

			expect(veSectionHidden()).toBe(false);
			expect(appState.currentVEResult).not.toBeNull();
		});

		it("does not tear down when nothing has been analysed yet", async () => {
			const appState = makeAppState();
			configureWithFitLap(appState);

			detected.laps = [lap(1, 0, 80)];
			await runGpsLapDetection(52.52, 13.405, 0);

			expect(veSectionHidden()).toBe(false);
			expect(appState.gpsSelectedLaps).toEqual([1]);
		});
	});

	describe("after a lap checkbox change", () => {
		/** The GPS lap list, reduced to what the handler actually reads. */
		function renderGpsLapCheckboxes(laps: number[], checked: number[]): void {
			const results = document.getElementById("results");
			if (!results) throw new Error("#results is not on the page");
			results.innerHTML = laps
				.map(
					(l) => `
        <div class="lap-checkbox-item" data-gps-lap="${l}">
            <input type="checkbox" class="gps-lap-checkbox"${checked.includes(l) ? " checked" : ""}>
        </div>`,
				)
				.join("");
		}

		/**
		 * A LAP CHECKBOX NARROWS THE QUESTION; it does not re-cut the ride.
		 *
		 * Tearing down here was more destructive than the change warranted
		 * (maintainer, 2026-09-01): the detection is untouched, so the panel can
		 * recompute over the ticked subset. The gate cases above are the other
		 * kind of change and still tear down.
		 *
		 * `requestModeUpdate` is unconfigured in this file, so what is asserted is
		 * the panel SURVIVING and the on-screen range list having moved — the
		 * state `resolveActiveGpsLapRanges` hands the recompute.
		 */
		it("narrows the panel to the ticked laps instead of tearing it down", () => {
			const appState = makeAppState();
			configure(appState);
			analyzedLaps(appState, [lap(1, 0, 80), lap(2, 81, 160), lap(3, 161, 240)]);

			renderGpsLapCheckboxes([1, 2, 3], [1, 3]);
			handleGpsLapSelectionChange();

			expect(veSectionHidden()).toBe(false);
			expect(appState.currentVEResult).not.toBeNull();
			expect(appState.currentGpsLapIndexRanges).toEqual([
				{ startIdx: 0, endIdx: 80 },
				{ startIdx: 161, endIdx: 240 },
			]);
			// `gpsLapNumberAt` indexes this by RANGE ordinal, so it has to move
			// with the ranges or lap 3 would be drawn as "Lap 2".
			expect(appState.currentOverlayLapNumbers).toEqual([1, 3]);
		});

		it("leaves the on-screen ranges alone when the selection still matches", () => {
			const appState = makeAppState();
			configure(appState);
			analyzedLaps(appState, [lap(1, 0, 80), lap(2, 81, 160)]);

			// Order-insensitive: the list is derived by walking rendered
			// checkboxes and has no meaningful order.
			renderGpsLapCheckboxes([1, 2, 3], [2, 1]);
			handleGpsLapSelectionChange();

			expect(veSectionHidden()).toBe(false);
			expect(appState.currentGpsLapIndexRanges).toEqual([
				{ startIdx: 0, endIdx: 80 },
				{ startIdx: 81, endIdx: 160 },
			]);
		});

		it("tears the panel down when every lap is unticked", () => {
			const appState = makeAppState();
			configure(appState);
			analyzedLaps(appState, [lap(1, 0, 80), lap(2, 81, 160)]);

			// Not a narrower question — no question.
			renderGpsLapCheckboxes([1, 2, 3], []);
			handleGpsLapSelectionChange();

			expect(veSectionHidden()).toBe(true);
			expect(appState.currentVEResult).toBeNull();
		});

		it("does not tear down when nothing has been analysed yet", () => {
			const appState = makeAppState();
			configure(appState);

			renderGpsLapCheckboxes([1, 2, 3], [1, 2]);
			expect(() => handleGpsLapSelectionChange()).not.toThrow();
			expect(appState.gpsSelectedLaps).toEqual([1, 2]);
		});
	});
});
