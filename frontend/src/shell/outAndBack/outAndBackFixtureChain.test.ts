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

/** Clearly different from the template's `params.cda || 0.3` default, and inside
 * the fixture's own `cda_min` 0.15 / `cda_max` 0.5, so the binder does not clamp
 * it into something the assertions could not tell apart from the initial value. */
const DRAGGED_CDA = 0.42;

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

function el(id: string): HTMLInputElement {
	const node = document.getElementById(id) as HTMLInputElement | null;
	if (!node) throw new Error(`#${id} is not in the rendered panel`);
	return node;
}

/** A real user gesture: set the thumb, fire the event the browser fires. */
async function drag(id: string, value: number): Promise<void> {
	const slider = el(id);
	slider.value = value.toString();
	slider.dispatchEvent(new Event("input", { bubbles: true }));
	await settle();
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

/**
 * N-1: OUT-AND-BACK STORE RESULT / EXPORT CSV, EXECUTED RATHER THAN REASONED ABOUT.
 *
 * N-1 was recorded NOT VERIFIED at the 2026-08-18 maintainer sweep and stayed the
 * phase's one deliberately unconfirmed plan-03 behaviour, because no out-and-back
 * ride existed to click through. The fixture makes the CODE-PATH half executable.
 *
 * WHAT THIS BLOCK MAY AND MAY NOT SUPPLY — the line that decides whether it is
 * worth anything:
 *
 *   - It MAY fake `ResultsStorage` (jsdom has no persistence layer worth driving)
 *     and it MAY click the notes dialog's OK button to resolve
 *     `showNotesDialog()`. Neither is the behaviour under test.
 *   - It MUST NOT create `#storeResult` or `#exportAllResults`. Out-and-back's own
 *     template ships both (`renderOutAndBack.ts:469-470`) and the whole point is
 *     to click the buttons production renders.
 *   - It MUST NOT create the two trim sliders `handleStoreResult` looks for. Their
 *     ABSENCE from the out-and-back template is precisely the thing under test.
 *     Supplying them would be this phase's anti-pattern 1 in its purest form:
 *     anything a test supplies in `setup()`, it cannot see missing.
 *
 * The `Cannot store` case below is a CHARACTERISATION of a defect, not an
 * endorsement of it. It does not stand on `saveResult` not having been called —
 * that alone would also pass if the click never landed, if the footer was never
 * bound, if the dialog never resolved, or if the harness simply did nothing. It
 * asserts the positive path up to the abort (button present, dialog on
 * `document.body`, the specific log line emitted) and it was watched FLIPPING
 * under mutation OAB-5, which removes the CAUSE by adding the two ids to the
 * out-and-back template — recorded with its verbatim output in `07-08-SUMMARY.md`
 * and reverted in the same task.
 *
 * SYNTHETIC-FIXTURE EVIDENCE, as everywhere in this file. The on-screen half of
 * N-1 — "do the stored numbers match what the metrics header shows" — still needs
 * a human and a real ride.
 */
describe("N-1 on the synthetic fixture: the real Store Result / Export CSV chain", () => {
	let appState: AppState;
	const saveResult = vi.fn(async () => {});
	const exportAllResultsToCSV = vi.fn(async () => {});
	let consoleError: ReturnType<typeof vi.spyOn>;
	const alerts: string[] = [];

	/** Every `log.error(...)` line, which `utils/log` writes to `console.error`. */
	function errorLines(): string[] {
		return consoleError.mock.calls.map((call) => String(call[0]));
	}

	beforeEach(async () => {
		vi.useFakeTimers();
		Element.prototype.scrollIntoView = () => {};
		clearModeUpdateCallbacks();
		resetModeUpdateRequests();
		modeState.gps = "GPS based out and back";
		resetRecording();
		saveResult.mockClear();
		exportAllResultsToCSV.mockClear();
		alerts.length = 0;
		// jsdom's own `alert` is a not-implemented stub that only writes to the
		// virtual console. Recorded here because an alert is how `handleStoreResult`
		// reports its EARLY guards (`:96`, `:101`) and its `catch` (`:211`), and the
		// defect case has to be able to rule all three out.
		window.alert = (message?: any) => {
			alerts.push(String(message));
		};
		consoleError = vi.spyOn(console, "error").mockImplementation(() => {});

		renderHostPage();
		appState = makeAppState();
		appState.selectedFile = new File([], "synthetic-out-and-back.fit");
		await renderOutAndBack(appState, {
			saveResult,
			exportAllResultsToCSV,
		} as unknown as ResultsStorage);
	});

	afterEach(() => {
		consoleError.mockRestore();
		vi.useRealTimers();
		clearModeUpdateCallbacks();
		resetModeUpdateRequests();
	});

	/**
	 * Click the REAL footer button and resolve the module-private notes dialog the
	 * way a user does — by clicking its OK button.
	 *
	 * Returns which of the dialog's three elements were on `document.body` at the
	 * moment OK was clicked, so the caller can assert that execution really did
	 * reach `storageHandlers.ts:111` rather than dying earlier in silence.
	 */
	async function clickStoreResult(): Promise<{
		notesInput: boolean;
		notesOkBtn: boolean;
		notesCancelBtn: boolean;
	}> {
		const storeBtn = document.getElementById("storeResult");
		expect(
			storeBtn,
			"#storeResult must come from the rendered out-and-back template",
		).not.toBeNull();

		storeBtn!.click();
		// `showNotesDialog` appends synchronously inside its Promise executor, so
		// one microtask turn is enough for the handler to have reached it.
		await Promise.resolve();

		const seen = {
			notesInput: !!document.getElementById("notesInput"),
			notesOkBtn: !!document.getElementById("notesOkBtn"),
			notesCancelBtn: !!document.getElementById("notesCancelBtn"),
		};

		document.getElementById("notesOkBtn")?.click();
		await vi.advanceTimersByTimeAsync(0);
		await Promise.resolve();
		await Promise.resolve();

		return seen;
	}

	it("a CdA drag writes the on-screen result into AppState through the summarize seam", async () => {
		expect(appState.currentVEResult).toBeNull();

		await drag("cdaSlider", DRAGGED_CDA);

		// The physics really ran on the dragged value, for every leg.
		expect(calculatorCalls.length).toBe(EXPECTED_SEGMENTS);
		for (const call of calculatorCalls) {
			expect(call.cda).toBeCloseTo(DRAGGED_CDA, 6);
		}
		// D-17(a)'s seam holds: `outAndBackMode.summarize` ->
		// `writeSegmentModeResultState` (`segmentSummary.ts:131-141`) wrote all of
		// it. This is the half of N-1 that was already true.
		expect(appState.currentVEResult).not.toBeNull();
		expect(appState.currentFilteredData).not.toBeNull();
		expect(appState.currentWindSource).toBe("fit");
		expect(appState.currentAnalyzedLaps).toEqual(
			ride.sections.map((section) => section.sectionNumber),
		);
	});

	it("CHARACTERISES A DEFECT: Store Result reaches the notes dialog, then aborts on the trim sliders out-and-back never renders, and persists nothing", async () => {
		await drag("cdaSlider", DRAGGED_CDA);

		// The two early returns cannot explain the outcome: both of the values they
		// guard on are present before the click.
		expect(appState.currentVEResult).not.toBeNull();
		expect(appState.currentFilteredData).not.toBeNull();
		// `isGpsLapModeActive` is false in out-and-back (`outAndBackMode.ts:44`), so
		// `storageHandlers.ts:118` takes the `else` branch that needs the two trim
		// sliders.
		expect(appState.isGpsLapModeActive).toBe(false);

		// EVERYTHING BELOW IS `expect.soft`, deliberately. Under the positive
		// control (OAB-5 — the two trim ids ADDED to the out-and-back template) all
		// four of these observations change at once, and a hard assertion would
		// abort at the first of them and hide the rest. Soft assertions still fail
		// the case; they just let the whole flip be read off one run.
		//
		// The cause, named and asserted rather than described: this template ships
		// no trim window, and nothing in this file creates one.
		expect.soft(document.getElementById("trimStartSlider")).toBeNull();
		expect.soft(document.getElementById("trimEndSlider")).toBeNull();

		const dialog = await clickStoreResult();

		// EXECUTION REACHED THE HANDLER. All three dialog elements were on
		// `document.body`, which is strictly past `storageHandlers.ts:105` (the
		// `#storeResult` lookup) and inside `:111` (`await showNotesDialog()`) —
		// so "the click never landed" and "the footer was never bound" are both
		// ruled out by observation rather than by argument.
		expect(dialog).toEqual({
			notesInput: true,
			notesOkBtn: true,
			notesCancelBtn: true,
		});

		// THE DEFECT'S SIGNATURE, asserted directly: `storageHandlers.ts:132`,
		// inside the `else` branch, after the trim-slider lookup at `:126-127`
		// returned null.
		expect.soft(errorLines()).toContain("Cannot store: UI elements not found");
		// Not the `catch` at `:209-211` — that logs a different line and alerts.
		expect.soft(errorLines()).not.toContain("❌ Failed to store result:");
		expect.soft(alerts).toEqual([]);

		// Only now, standing on the four positive observations above, does the
		// negative mean anything.
		expect.soft(saveResult).not.toHaveBeenCalled();
	});

	it("Export All Results does reach resultsStorage.exportAllResultsToCSV", async () => {
		await drag("cdaSlider", DRAGGED_CDA);

		const exportBtn = document.getElementById("exportAllResults");
		expect(
			exportBtn,
			"#exportAllResults must come from the rendered out-and-back template",
		).not.toBeNull();

		exportBtn!.click();
		await vi.advanceTimersByTimeAsync(0);
		await Promise.resolve();

		// `handleExportAllResults` reads no AppState at all
		// (`storageHandlers.ts:222-248`), so the export button itself works in
		// out-and-back. What it exports is whatever `saveResult` was handed
		// earlier — which is what the case above shows never happens.
		expect(exportAllResultsToCSV).toHaveBeenCalledTimes(1);
		expect(errorLines()).not.toContain("❌ Failed to export results:");
	});
});
