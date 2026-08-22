/**
 * @vitest-environment jsdom
 *
 * THE OUT-AND-BACK CHAIN, DRIVEN ON THE SYNTHETIC FIXTURE — render -> bind ->
 * event -> primitive -> draw.
 *
 * WHAT IS REAL HERE. The production entry point `showOutAndBackVEPlot`, the real
 * out-and-back template it builds (its wind-source radios, its four compare
 * containers, its `#storeResult` / `#exportAllResults` footer), `bindModeControls`,
 * `MODE_CONTROL_TABLE`, `requestModeUpdate`, `scheduleRecompute`, `outAndBackMode`,
 * `updateModeVEPlots` itself, `createOutAndBackUpdateCallbacks` and
 * `renderOutAndBackPlots`. None of them is mocked.
 *
 * WHAT IS FAKED, and only what a jsdom process genuinely cannot run: the WASM
 * calculator (`VeCalculatorFactory`), which doubles as the probe for which CdA/Crr
 * and which WIND SERIES reached the physics; the Plotly draw calls, which are the
 * observation point; `getGpsAnalysisMode`, a module-level state accessor, so the
 * suite can say which mode is live without driving the whole Section 3 UI.
 *
 * THE PLOTLY FAKE THROWS WHEN ITS TARGET ID IS ABSENT, exactly as Plotly does
 * ("No DOM element with id '...' exists on the page"), and it is injected through
 * the `waitForPlotly` ARGUMENT rather than installed on `globalThis.Plotly`.
 * Out-and-back never reads the global — `renderOutAndBack.ts:589` awaits the
 * injected `waitForPlotly()` and hands that handle to
 * `createOutAndBackUpdateCallbacks` and `renderOutAndBackPlots` — so a global fake
 * would never be consulted and every draw assertion below would observe nothing
 * while passing.
 *
 * ================================================================
 * THE DATA IS A SYNTHETIC FIXTURE, AND THAT IS WEAKER EVIDENCE.
 * ================================================================
 * `out-and-back-ride.json` is derived from `golden-ride.json` by reversing and
 * re-concatenating three of its laps (plan 07-07). It is NOT a real out-and-back
 * ride; none exists, in the repo or to the maintainer. Passing this file shows
 * that the out-and-back code path accepts and processes genuinely retracing data,
 * and nothing more.
 *
 * **PASSING THIS FILE DOES NOT RETIRE "the four-plot out-and-back compare view has
 * never been displayed in a browser."** That exposure — `07-PROFILE-REPORT.md`
 * calls it the phase's single largest — survives every green run here, because a
 * jsdom draw call is not a look at a screen. Nothing observed in this file may be
 * cited as browser verification or as real-ride verification.
 *
 * A specific limit inherited from the fixture: `golden-ride.json`'s `wind_yaw` is
 * identically 0 at all 1436 samples, so this fixture's inbound legs carry a
 * CONSTANT 180. Nothing here can distinguish per-sample yaw handling from a
 * constant.
 *
 * NOTHING IN THIS FILE MAY CONFIGURE THE UPDATE FUNNEL FOR ITSELF. Handing the
 * funnel its `appState` is production's job and happens in exactly one place
 * (`bindModeControls.ts:154`, reached here through `setupOutAndBackSliderSync`).
 * A test that performs that step in its own `setup()` cannot see it missing —
 * which is precisely how plan 07-03 shipped two entire modes completely inert
 * while 574 tests stayed green. If a future change makes these tests need it,
 * production needs it too, and the mode is dead again.
 *
 * The configure function's NAME is deliberately not spelled anywhere in this
 * file: the acceptance check for this rule is a mechanical `grep -c`, which
 * cannot tell a prohibition from a call. Same trap, same fix, as the generator
 * header in plan 07-07.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Every `createVeCalculator` call the chain made, in order, tagged with WHICH
 * wind series it was handed.
 *
 * `resolveWindSeries` returns an all-NaN series for `constant`, so `constantLeg`
 * says which of the primitive's two calculators this call is.
 */
const calculatorCalls = vi.hoisted(
	() => [] as Array<{ cda: number; crr: number; constantLeg: boolean }>,
);

/**
 * The fake's virtual elevation is DERIVED FROM the wind series it was handed —
 * the constant leg ramps UP by 1 per sample, the FIT leg ramps DOWN by 1. A fake
 * that returned the same numbers for both calculators would make a compare figure
 * that drew the FIT series twice look perfectly correct in the plotted y values,
 * which is exactly the defect case 3 exists to catch.
 */
vi.mock("../../analysis/VeCalculatorFactory", () => ({
	createVeCalculator: (input: any) => {
		const n = input.timestamps.length;
		const constantLeg = Array.from(input.windSpeed as number[]).every((value) =>
			Number.isNaN(value),
		);
		calculatorCalls.push({
			cda: input.cda,
			crr: input.crr,
			constantLeg,
		});
		const ve = new Float64Array(n);
		for (let i = 0; i < n; i++) ve[i] = constantLeg ? i : -i;
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

const modeState = vi.hoisted(() => ({ gps: "GPS based out and back" }));

vi.mock("../section3/section3Orchestration", async (importOriginal) => ({
	...(await importOriginal<Record<string, unknown>>()),
	getGpsAnalysisMode: () => modeState.gps,
}));

import type { AppState } from "../../state/AppState";
import type { ParameterStorage } from "../../utils/ParameterStorage";
import type { ResultsStorage } from "../../utils/ResultsStorage";
import type { ShellServices } from "../analysis/types";
import {
	loadOutAndBackRide,
	type OutAndBackRide,
} from "../../analysis/__fixtures__/loadOutAndBackRide";
import { clearModeUpdateCallbacks } from "../analysis/modeUpdateCallbacks";
import { resetModeUpdateRequests } from "../analysis/requestModeUpdate";
import { showOutAndBackVEPlot } from "./renderOutAndBack";
import type { OutAndBackVEProfile } from "./types";

const ride: OutAndBackRide = loadOutAndBackRide();

/** Two legs per section, and every leg of this fixture clears MIN_SEGMENT_SAMPLES. */
const EXPECTED_SEGMENTS = ride.sections.length * 2;

/** Every id a draw was aimed at, whether or not the element existed. */
const drawTargets: string[] = [];
/** Draws aimed at an id this panel does not contain — always a defect. */
const missingTargets: string[] = [];
/** Every draw's trace list, in order, so a redraw's CONTENT can be read. */
const draws: Array<{ id: string; data: any[] }> = [];

function fakePlotly(name: "newPlot" | "react") {
	return (id: string, ...rest: unknown[]) => {
		void name;
		drawTargets.push(id);
		draws.push({ id, data: (rest[0] as any[]) ?? [] });
		if (!document.getElementById(id)) {
			missingTargets.push(id);
			// Exactly what Plotly does, so a draw into thin air cannot pass for one
			// that reached the screen.
			throw new Error(`No DOM element with id '${id}' exists on the page.`);
		}
	};
}

const waitForFakePlotly = async () => ({
	newPlot: fakePlotly("newPlot"),
	react: fakePlotly("react"),
});

/**
 * The AppState stand-in, built from the fixture.
 *
 * `sections` needs a cast: the fixture's `OutAndBackRideSection` is the 5-field
 * `*Idx` + `sectionNumber` SUBSET that `loadGoldenRide.ts` already uses, while
 * production's `OutAndBackSection` (`src/utils/GpsLapDetection.ts:85`) also
 * declares `outbound/inbound` start direction, end direction, duration and
 * distance plus `totalDuration` / `totalDistance`. Only `sectionNumber` and the
 * four `*Idx` fields are read on the update path (`outAndBackMode.prepareSelection`
 * / `getUpdateSegments`), so the cast is sound — this is a documented subset, NOT
 * a type bug, and the absent fields must not be "fixed" by fabricating direction
 * and duration values that nothing reads.
 *
 * `currentRhoArray` is deliberately absent: plan 07-06 deleted that field.
 */
function makeAppState(): AppState {
	return {
		currentFitData: ride.fitData,
		currentParameters: { ...ride.params },
		outAndBackSections: ride.sections as any,
		currentOutAndBackSections: ride.sections as any,
		outAndBackSelectedSections: ride.sections.map(
			(section) => section.sectionNumber,
		),
		currentLaps: ride.laps,
		selectedLaps: ride.laps.map((_, index) => index + 1),
		currentAnalyzedLaps: [],
		gpsDetectedLaps: [],
		gpsSelectedLaps: [],
		airSpeedCalibrationPercent: 0,
		activeDisplayProfile: "fit-raw",
		fitRawElevation: null,
		isGpsLapModeActive: false,
		isCalculatingAutoRho: false,
		demProfilesAvailable: true,
		currentVEResult: null,
		currentFilteredData: null,
		currentVirtualDistances: [],
		currentWindSource: "none",
		selectedFile: null,
	} as unknown as AppState;
}

function makeServices(appState: AppState): ShellServices {
	return {
		appState,
		showLoading: () => {},
		hideLoading: () => {},
		showError: () => {},
	};
}

const parameterStorage = {} as unknown as ParameterStorage;

/** The initial paint's profiles, read off the fixture rather than invented. */
function initialProfiles(): OutAndBackVEProfile[] {
	const altitude = Array.from(ride.fitData.altitude as ArrayLike<number>);
	const distance = Array.from(ride.fitData.distance as ArrayLike<number>);
	const leg = (startIdx: number, endIdx: number) => {
		const indices: number[] = [];
		for (let i = startIdx; i <= endIdx; i++) indices.push(i);
		const base = distance[startIdx];
		return {
			distances: indices.map((i) => (distance[i] - base) / 1000),
			elevation: indices.map((i) => altitude[i]),
		};
	};

	return ride.sections.map((section) => {
		const outbound = leg(section.outboundStartIdx, section.outboundEndIdx);
		const inbound = leg(section.inboundStartIdx, section.inboundEndIdx);
		return {
			sectionNumber: section.sectionNumber,
			outboundDistances: outbound.distances,
			outboundVE: outbound.elevation.slice(),
			outboundVECompare: null,
			outboundActualElevation: outbound.elevation,
			outboundSeries: null,
			inboundDistances: inbound.distances,
			inboundVE: inbound.elevation.slice(),
			inboundVECompare: null,
			inboundActualElevation: inbound.elevation,
			inboundSeries: null,
			outboundDuration: section.outboundEndIdx - section.outboundStartIdx,
			inboundDuration: section.inboundEndIdx - section.inboundStartIdx,
			totalDistance:
				(distance[section.inboundEndIdx] - distance[section.outboundStartIdx]) /
				1000,
		};
	});
}

const profiles = initialProfiles();

const meanElevation = {
	distances: profiles[0].outboundDistances,
	elevation: profiles[0].outboundActualElevation,
};

/**
 * The host page the analyze path leaves behind. `#veAnalysisSection` must not
 * carry `hidden`, because `requestModeUpdate` refuses to schedule anything while
 * the VE panel is off screen — and a fixture that got that wrong would produce a
 * test that fails for the wrong reason.
 */
function renderHostPage(): void {
	document.body.innerHTML = `
		<div id="veAnalysisSection">
			<div id="veAnalysisContent"></div>
		</div>
	`;
}

async function renderOutAndBack(
	appState: AppState,
	resultsStorage: ResultsStorage,
): Promise<void> {
	await showOutAndBackVEPlot(
		makeServices(appState),
		parameterStorage,
		resultsStorage,
		waitForFakePlotly,
		profiles,
		meanElevation,
		appState.currentParameters!,
		true,
		true,
		2,
		"fit",
	);
}

/** Drain the recompute runner's debounce so the scheduled run executes. */
async function settle(): Promise<void> {
	await vi.advanceTimersByTimeAsync(500);
}

/** A real click on the REAL radio the template rendered. */
async function selectWindSource(
	value: "constant" | "fit" | "compare",
): Promise<void> {
	const radio = document.querySelector<HTMLInputElement>(
		`input[name="windSource"][value="${value}"]`,
	);
	if (!radio) {
		throw new Error(
			`the out-and-back template rendered no windSource radio with value="${value}"`,
		);
	}
	radio.checked = true;
	radio.dispatchEvent(new Event("change", { bubbles: true }));
	await settle();
}

function compareViewIsHidden(): boolean {
	const view = document.getElementById("oabCompareView");
	if (!view) throw new Error("#oabCompareView is not in the rendered panel");
	return view.classList.contains("hidden");
}

/** The most recent draw aimed at `id`, or null if none was. */
function lastDraw(id: string): { id: string; data: any[] } | null {
	for (let i = draws.length - 1; i >= 0; i--) {
		if (draws[i].id === id) return draws[i];
	}
	return null;
}

/** One named section trace's plotted y values. */
function traceY(data: any[], name: string): number[] {
	const trace = data.find((candidate) => candidate.name === name);
	expect(trace, `no trace named "${name}" in this draw`).toBeDefined();
	return trace.y as number[];
}

function resetRecording(): void {
	drawTargets.length = 0;
	missingTargets.length = 0;
	draws.length = 0;
	calculatorCalls.length = 0;
}

describe("out-and-back on the synthetic fixture: the real compare render chain", () => {
	let appState: AppState;

	beforeEach(async () => {
		vi.useFakeTimers();
		// jsdom has no layout, so the render's closing scroll would throw.
		Element.prototype.scrollIntoView = () => {};
		clearModeUpdateCallbacks();
		resetModeUpdateRequests();
		modeState.gps = "GPS based out and back";
		resetRecording();

		renderHostPage();
		appState = makeAppState();
		await renderOutAndBack(appState, {} as unknown as ResultsStorage);

		// The initial paint is not what is under test; only what a later gesture
		// provokes is.
		resetRecording();
	});

	afterEach(() => {
		vi.useRealTimers();
		clearModeUpdateCallbacks();
		resetModeUpdateRequests();
	});

	it("compare draws four figures into the four template ids", async () => {
		await selectWindSource("compare");

		expect(drawTargets).toContain("oabVePlot");
		expect(drawTargets).toContain("oabVeResidualsPlot");
		expect(drawTargets).toContain("oabVeComparePlot");
		expect(drawTargets).toContain("oabVeCompareResidualsPlot");
		// No draw went into thin air. The fake throws on a missing id, so this is
		// the assertion that stops a figure built for a container the template does
		// not ship from passing as a figure on screen.
		expect(missingTargets).toEqual([]);
	});

	it("the compare view is unhidden before it is drawn", async () => {
		expect(compareViewIsHidden()).toBe(true);

		await selectWindSource("compare");

		// Plotly measures the container at draw time and a `display: none` div
		// measures zero, so the toggle at `outAndBackPlots.ts:678` has to have run
		// BEFORE the two compare draws — which the throwing fake proves it did, by
		// not throwing.
		expect(compareViewIsHidden()).toBe(false);
		expect(drawTargets).toContain("oabVeComparePlot");
		expect(missingTargets).toEqual([]);
	});

	it("the constant-wind curves are a different series from the FIT curves", async () => {
		await selectWindSource("fit");
		const fitCalls = calculatorCalls.length;
		expect(fitCalls).toBe(EXPECTED_SEGMENTS);
		expect(calculatorCalls.every((call) => !call.constantLeg)).toBe(true);

		resetRecording();
		await selectWindSource("compare");

		// One calculator per leg per wind model. Compare resolves twice.
		expect(calculatorCalls.length).toBe(fitCalls * 2);
		expect(calculatorCalls.filter((call) => call.constantLeg).length).toBe(
			fitCalls,
		);

		const fitFigure = lastDraw("oabVePlot");
		const compareFigure = lastDraw("oabVeComparePlot");
		expect(fitFigure, "no draw reached #oabVePlot").not.toBeNull();
		expect(compareFigure, "no draw reached #oabVeComparePlot").not.toBeNull();

		const fitY = traceY(fitFigure!.data, "Section 1 (A→B)");
		const compareY = traceY(compareFigure!.data, "Section 1 (A→B)");
		expect(compareY.length).toBe(fitY.length);
		expect(compareY).not.toEqual(fitY);
		// Not merely "not deep-equal": genuinely different numbers, sample for
		// sample, so a figure that drew the FIT series twice cannot pass. Sample 0
		// is the ONE coincidence, and it is structural rather than accidental —
		// both models' legs are drawn from the same anchor, so their first plotted
		// value is the same number by construction. Pinning the whole index list
		// rather than a count means a second coincidence appearing later would
		// fail here instead of being absorbed into a threshold.
		const identicalIndices = fitY
			.map((value, i) => (value === compareY[i] ? i : -1))
			.filter((i) => i >= 0);
		expect(identicalIndices).toEqual([0]);
	});

	it("deselecting compare re-hides the view and leaves the original pair", async () => {
		await selectWindSource("compare");
		expect(compareViewIsHidden()).toBe(false);

		resetRecording();
		await selectWindSource("fit");

		expect(compareViewIsHidden()).toBe(true);
		expect(drawTargets).toContain("oabVePlot");
		expect(drawTargets).toContain("oabVeResidualsPlot");
		expect(drawTargets).not.toContain("oabVeComparePlot");
		expect(drawTargets).not.toContain("oabVeCompareResidualsPlot");
		expect(missingTargets).toEqual([]);
	});
});
