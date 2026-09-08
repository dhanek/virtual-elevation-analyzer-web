/**
 * @vitest-environment jsdom
 *
 * THE END-TO-END CHAIN, PER GPS MODE — render -> bind -> event -> primitive -> draw.
 *
 * WHY THIS FILE EXISTS. Plan 07-03 migrated GPS-lap (`f810cb9`) and out-and-back
 * (`5ea4279`) onto `bindModeControls`, and the 574-test suite stayed green while
 * BOTH modes were completely inert in the browser: not one control redrew
 * anything. The 39-pair, 66-test call-shape matrix could not see it, because it
 * mocks `updateModeVEPlots` at module level, calls `bindModeControls` directly
 * instead of going through the mode's own render, and — decisively — performs the
 * one piece of wiring production was missing (`configureModeUpdateRequests`) in
 * its own `setup()`. A matrix that supplies the missing wiring cannot observe it
 * missing. That is the same vacuous-guard shape this phase has now hit five
 * times, and the worst of them: it passed against a 100% dead feature.
 *
 * So this file asserts the property the matrix structurally cannot: that driving
 * the REAL production entry point — `showGpsLapVEPlot` / `showOutAndBackVEPlot`,
 * which builds the real sidebar markup and does the real binding — and then
 * dispatching a REAL `input` event on a REAL element makes the plots redraw with
 * the new value.
 *
 * WHAT IS REAL HERE: the render entry points, their templates, `bindModeControls`,
 * `MODE_CONTROL_TABLE`, `requestModeUpdate`, `scheduleRecompute`, the mode
 * handlers, and `updateModeVEPlots` itself. **`updateModeVEPlots` is deliberately
 * NOT mocked** — that is the whole point of the file.
 *
 * WHAT IS FAKED, and only what a jsdom process genuinely cannot run:
 *   - the WASM calculator (`VeCalculatorFactory`), exactly as
 *     `standardCompareSecondaryPlots.test.ts` does, and doubling as the probe for
 *     WHICH CdA/Crr actually reached the physics;
 *   - the Plotly-backed draw calls, which are the observation point;
 *   - `getGpsAnalysisMode`, a module-level state accessor, so the suite can say
 *     which mode is live without driving the whole Section 3 UI.
 *
 * NOTHING IN THIS FILE MAY CALL `configureModeUpdateRequests`. If a future change
 * makes these tests need it, production needs it too, and the mode is dead again.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/** Every `createVeCalculator` call the chain made, in order. */
const calculatorCalls = vi.hoisted(
	() =>
		[] as Array<{
			cda: number;
			crr: number;
			altitude: number[];
			rhoArray: number[] | null;
			timestamps: number;
		}>,
);

vi.mock("../../analysis/VeCalculatorFactory", () => ({
	createVeCalculator: (input: any) => {
		calculatorCalls.push({
			cda: input.cda,
			crr: input.crr,
			// WR-1's probe: WHICH elevation series reached the physics, which is
			// the only place the analyze leg's choice of profile is observable.
			altitude: Array.from(input.altitude ?? []),
			// And WHAT AIR DENSITY it was given. Kept unconverted -- an
			// `Array.from` would turn the `undefined` holes this probe exists to
			// catch into something that still looks like a number array.
			rhoArray: input.rhoArray ?? null,
			timestamps: input.timestamps.length,
		});
		const n = input.timestamps.length;
		return {
			calculate_virtual_elevation: () => ({
				virtual_elevation: new Float64Array(n).fill(1),
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

const modeState = vi.hoisted(() => ({ gps: "None" as string }));

vi.mock("../section3/section3Orchestration", async (importOriginal) => ({
	...(await importOriginal<Record<string, unknown>>()),
	getGpsAnalysisMode: () => modeState.gps,
}));

/**
 * THE STATUS AS SEEN FROM INSIDE `handler.summarize`.
 *
 * The central property of the analyze-leg retirement is that nothing ever
 * observes `veStatus === "ready"` before `summarize` has written the fields that
 * claim describes. `updateModeVEPlots` orders those two lines itself
 * (`:370,375`), but ordering asserted from OUTSIDE the primitive can only see
 * the end state — `ready` after the pass — which an implementation that set
 * `ready` on entry would also satisfy.
 *
 * So the real handler is wrapped here and asked, at the only moment that can
 * distinguish them, what the status is. The handler itself is UNTOUCHED: the
 * wrapper delegates to the real `summarize`, so every number this file asserts
 * is still produced by the real seam.
 */
const summarizeStatuses = vi.hoisted(() => [] as Array<unknown>);

vi.mock("../../modes/analysis/AnalysisModes", async (importOriginal) => {
	const actual = await importOriginal<Record<string, any>>();
	const wrap = (handler: any) => ({
		...handler,
		summarize: (appState: any, ...rest: unknown[]) => {
			summarizeStatuses.push(appState.veStatus);
			return handler.summarize(appState, ...rest);
		},
	});
	return {
		...actual,
		getAnalysisModeHandler: (...args: unknown[]) =>
			wrap(actual.getAnalysisModeHandler(...args)),
		getAnalysisModeHandlerById: (...args: unknown[]) =>
			wrap(actual.getAnalysisModeHandlerById(...args)),
	};
});

/**
 * The far end of the chain: the functions that actually paint a figure.
 *
 * The three SECONDARY draws per mode were `() => {}` no-ops until 07-05. They
 * are spies now because the tab-laziness predicate is only observable through
 * whether they ran — see the D-14 block at the foot of this file.
 */
const drawn = vi.hoisted(() => ({
	gpsLapVe: vi.fn(),
	gpsLapWind: vi.fn(),
	gpsLapPower: vi.fn(),
	gpsLapVd: vi.fn(),
	outAndBackVe: vi.fn(),
	outAndBackWind: vi.fn(),
	outAndBackPower: vi.fn(),
	outAndBackVd: vi.fn(),
}));

vi.mock("../gpsLap/gpsLapPlots", async (importOriginal) => ({
	...(await importOriginal<Record<string, unknown>>()),
	renderGpsLapVEPlots: (...args: unknown[]) => drawn.gpsLapVe(...args),
	renderGpsLapWindPlot: (...args: unknown[]) => drawn.gpsLapWind(...args),
	renderGpsLapPowerPlot: (...args: unknown[]) => drawn.gpsLapPower(...args),
	renderGpsLapVdPlot: (...args: unknown[]) => drawn.gpsLapVd(...args),
}));

vi.mock("../outAndBack/outAndBackPlots", async (importOriginal) => ({
	...(await importOriginal<Record<string, unknown>>()),
	renderOutAndBackPlots: (...args: unknown[]) => drawn.outAndBackVe(...args),
	renderOutAndBackWindPlot: (...args: unknown[]) =>
		drawn.outAndBackWind(...args),
	renderOutAndBackPowerPlot: (...args: unknown[]) =>
		drawn.outAndBackPower(...args),
	renderOutAndBackVdPlot: (...args: unknown[]) => drawn.outAndBackVd(...args),
}));

import type { AnalysisParameters } from "../../components/AnalysisParameters";
import type { AppState } from "../../state/AppState";
import type { ParameterStorage } from "../../utils/ParameterStorage";
import type { ResultsStorage } from "../../utils/ResultsStorage";
import type { ShellServices } from "./types";
import { showGpsLapVEAnalysis, showGpsLapVEPlot } from "../gpsLap/renderGpsLap";
import {
	showOutAndBackVEAnalysis,
	showOutAndBackVEPlot,
} from "../outAndBack/renderOutAndBack";
import { clearModeUpdateCallbacks } from "./modeUpdateCallbacks";
import { resetRecomputeThrottle } from "./recomputeRunner";
import { resetModeUpdateRequests } from "./requestModeUpdate";

const SAMPLE_COUNT = 400;
const LAST_INDEX = SAMPLE_COUNT - 1;
const HALF = SAMPLE_COUNT / 2;
const INITIAL_CDA = 0.25;
const DRAGGED_CDA = 0.42;
const INITIAL_CRR = 0.0042;
const DRAGGED_CRR = 0.0091;

function makeFitData() {
	const timestamps = Array.from({ length: SAMPLE_COUNT }, (_, i) => i);
	const zeros = () => new Array<number>(SAMPLE_COUNT).fill(0);
	return {
		timestamps,
		power: zeros().map(() => 200),
		velocity: zeros().map(() => 10),
		position_lat: zeros(),
		position_long: zeros(),
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

const params = {
	cda: INITIAL_CDA,
	cda_min: 0.1,
	cda_max: 0.5,
	crr: INITIAL_CRR,
	crr_min: 0.001,
	crr_max: 0.02,
	air_speed_offset: 0,
	wind_speed: 3,
	wind_direction: 90,
	wind_height_factor: 1,
	velodrome: false,
	auto_calculate_rho: false,
} as unknown as AnalysisParameters;

const SECTION = {
	sectionNumber: 1,
	outboundStartIdx: 0,
	outboundEndIdx: HALF - 1,
	inboundStartIdx: HALF,
	inboundEndIdx: LAST_INDEX,
	outboundDuration: HALF,
	inboundDuration: HALF,
	totalDistance: 4,
};

function makeAppState(): AppState {
	return {
		currentFitData: makeFitData(),
		currentParameters: { ...params },
		currentGpsLapIndexRanges: [
			{ startIdx: 0, endIdx: HALF - 1 },
			{ startIdx: HALF, endIdx: LAST_INDEX },
		],
		currentOutAndBackSections: [SECTION],
		outAndBackSections: [SECTION],
		outAndBackSelectedSections: [1],
		gpsDetectedLaps: [],
		gpsSelectedLaps: [],
		currentLaps: [{ start_time: 0, end_time: LAST_INDEX }],
		selectedLaps: [1],
		currentAnalyzedLaps: [1, 2],
		airSpeedCalibrationPercent: 0,
		// A FRESH SESSION, at the real AppState defaults (AppState.ts:272,284-285).
		// Without these the fixture leaves them `undefined`, and the WR-3/WR-4
		// assertions pass vacuously against `undefined !== "none"` and
		// `undefined !== null` — the exact vacuous-guard shape this file exists
		// to answer. Both bugs were first "caught" by tests that did that.
		currentWindSource: "none",
		currentVirtualDistances: [],
		currentCoveredItems: null,
		currentVEResult: null,
		activeDisplayProfile: "fit-raw",
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
	};
}

const parameterStorage = {} as unknown as ParameterStorage;
const resultsStorage = {} as unknown as ResultsStorage;

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

const lapProfile = (lapNumber: number) => ({
	lapNumber,
	range:
		lapNumber === 1
			? { startIdx: 0, endIdx: HALF - 1 }
			: { startIdx: HALF, endIdx: LAST_INDEX },
	distances: [0, 1, 2],
	virtualElevation: [0, 1, 2],
	actualElevation: [0, 1, 2],
	// The analyze leg builds one of these for every lap it keeps
	// (`buildSegmentSupplementarySeries`), so a null here modelled a state
	// production never reaches — and WR-3's seed reads it.
	supplementarySeries: {
		distancesKm: [0, 1, 2],
		powerWatts: [200, 200, 200],
		apparentWindSpeedMps: [3, 3, 3],
		virtualDistanceAirKm: [0, 1, 2],
		virtualDistanceGroundKm: [0, 1, 2.2],
	},
	duration: HALF,
	totalDistance: 2,
});

/** A minimal but well-formed supplementary series for one leg. */
const legSeries = (scale: number) => ({
	distancesKm: [0, 1, 2].map((d) => d * scale),
	powerWatts: [200, 200, 200],
	apparentWindSpeedMps: [3, 3, 3],
	virtualDistanceAirKm: [0, 1, 2].map((d) => d * scale),
	virtualDistanceGroundKm: [0, 1, 2.2].map((d) => d * scale),
});

const sectionProfile = {
	sectionNumber: 1,
	outboundDistances: [0, 1, 2],
	outboundVE: [0, 1, 2],
	outboundActualElevation: [0, 1, 2],
	// As with lapProfile above: the analyze leg builds a series per surviving
	// leg, and WR-3's seed reads them to total the section.
	outboundSeries: legSeries(1.0),
	inboundDistances: [0, 1, 2],
	inboundVE: [0, 1, 2],
	inboundActualElevation: [0, 1, 2],
	inboundSeries: legSeries(0.9),
	outboundDuration: HALF,
	inboundDuration: HALF,
	totalDistance: 4,
};

/** Drain the recompute runner's debounce so the scheduled run executes. */
async function settle(): Promise<void> {
	await vi.advanceTimersByTimeAsync(500);
}

/** The Store Result button the panel's own markup shipped. */
function storeButton(): HTMLButtonElement {
	const node = document.getElementById(
		"storeResult",
	) as HTMLButtonElement | null;
	if (!node) throw new Error("#storeResult is not in the rendered sidebar");
	return node;
}

/**
 * WHAT NOW PROTECTS ANALYZE -> STORE RESULT WITH NOTHING IN BETWEEN.
 *
 * The four cases below used to assert that the analyze leg had SEEDED
 * `currentFilteredData`, `currentWindSource` and `currentVirtualDistances`, so a
 * click landing before any control was touched could not persist a previous
 * analysis's data. That seed is deleted: it was a second producer whose answers
 * WR-03 showed do not match the recompute's, so what it protected against
 * ("stale data reaches Store Result") it also caused ("data no plot describes
 * reaches Store Result").
 *
 * The guarantee is unchanged; the mechanism is the status. Through the whole
 * window the fields simply are not claimed to be current, and Store Result
 * refuses — `handleStoreResult` returns on `veStatus !== "ready"`
 * (`storageHandlers.ts:132`) and says so, rather than storing whatever is
 * lying in those fields. This helper is that half of every case, asserted
 * BEFORE `settle()` so it describes the window and not its end.
 *
 * The BUTTON half — `#storeResult` visibly disabled across the window — is
 * asserted separately, and only for GPS-lap here; out-and-back's own version
 * of the same assertion lives in `outAndBackFixtureChain.test.ts` rather than
 * in this file.
 */
function expectStoreResultRefusesForNow(appState: AppState): void {
	expect(appState.veStatus).not.toBe("ready");
}

function el(id: string): HTMLInputElement {
	const node = document.getElementById(id) as HTMLInputElement | null;
	if (!node) throw new Error(`#${id} is not in the rendered sidebar`);
	return node;
}

/** A real user gesture: set the thumb, fire the event the browser fires. */
async function drag(id: string, value: number): Promise<void> {
	const slider = el(id);
	slider.value = value.toString();
	slider.dispatchEvent(new Event("input", { bubbles: true }));
	await settle();
}

/**
 * A real user gesture on a REAL tab button — the one the template shipped, not
 * a node this file created. `setupTabSwitching` bound the handler during the
 * mode's own render, so this goes through `activateTab` exactly as a browser
 * click does, `ve-tab-content--active` swap and one render callback included.
 */
function clickTab(name: string): void {
	const button = document.querySelector<HTMLElement>(
		`.ve-tab-button[data-tab="${name}"]`,
	);
	if (!button) {
		throw new Error(
			`.ve-tab-button[data-tab="${name}"] is not in the rendered sidebar`,
		);
	}
	button.click();
}

/** Which pane the templates/`activateTab` consider active, read never written. */
function activeTabId(): string | null {
	return document.querySelector(".ve-tab-content--active")?.id ?? null;
}

interface ModeUnderTest {
	name: string;
	gpsAnalysisMode: string;
	/** Renders the real sidebar and does the real binding. */
	render: (appState: AppState) => Promise<void>;
	/**
	 * The ANALYZE leg — the entry point that DESCRIBES the selection's segments
	 * from AppState and then renders the panel for them. `render` above is handed
	 * profiles this file built by hand, so it cannot reach the code that decides
	 * which samples and which elevation series a segment is made of.
	 *
	 * NEITHER OF THEM COMPUTES ANYMORE, for either mode. The physics is the
	 * update primitive's, reached through the post-bind kick, so a case that
	 * wants to see what the calculator was given must `analyze()` and then
	 * `settle()`.
	 */
	analyze: (appState: AppState) => Promise<unknown>;
	drawSpy: ReturnType<typeof vi.fn>;
	/** That mode's three secondary-tab draws, in tab order. */
	secondary: {
		wind: ReturnType<typeof vi.fn>;
		power: ReturnType<typeof vi.fn>;
		vd: ReturnType<typeof vi.fn>;
	};
}

const MODES: readonly ModeUnderTest[] = [
	{
		name: "GPS-lap",
		gpsAnalysisMode: "GPS based lap splitting",
		drawSpy: drawn.gpsLapVe,
		secondary: {
			wind: drawn.gpsLapWind,
			power: drawn.gpsLapPower,
			vd: drawn.gpsLapVd,
		},
		analyze: (appState) =>
			showGpsLapVEAnalysis(
				makeServices(appState),
				parameterStorage,
				resultsStorage,
				async () => ({}),
				appState.currentGpsLapIndexRanges!,
				appState.currentFitData,
				appState.currentParameters!,
				0,
			),
		render: (appState) =>
			showGpsLapVEPlot(
				makeServices(appState),
				parameterStorage,
				resultsStorage,
				async () => ({}),
				[lapProfile(1), lapProfile(2)] as any,
				appState.currentParameters!,
				true,
				true,
				0,
				"fit",
			),
	},
	{
		name: "out-and-back",
		gpsAnalysisMode: "GPS based out and back",
		drawSpy: drawn.outAndBackVe,
		secondary: {
			wind: drawn.outAndBackWind,
			power: drawn.outAndBackPower,
			vd: drawn.outAndBackVd,
		},
		analyze: (appState) =>
			showOutAndBackVEAnalysis(
				makeServices(appState),
				parameterStorage,
				resultsStorage,
				appState.outAndBackSections as any,
				appState.currentFitData,
				appState.currentParameters!,
				0,
				async () => ({}),
			),
		render: (appState) =>
			showOutAndBackVEPlot(
				makeServices(appState),
				parameterStorage,
				resultsStorage,
				async () => ({}),
				[sectionProfile] as any,
				appState.currentParameters!,
				true,
				true,
				0,
				"fit",
			),
	},
];

describe.each(MODES)(
	"$name: the real render -> bind -> event -> primitive -> draw chain",
	({ gpsAnalysisMode, render, drawSpy }) => {
		let appState: AppState;

		beforeEach(async () => {
			vi.useFakeTimers();
			// jsdom has no layout, so the render's closing scroll would throw.
			Element.prototype.scrollIntoView = () => {};
			clearModeUpdateCallbacks();
			resetModeUpdateRequests();
			modeState.gps = gpsAnalysisMode;
			calculatorCalls.length = 0;
			drawn.gpsLapVe.mockClear();
			drawn.gpsLapWind.mockClear();
			drawn.gpsLapPower.mockClear();
			drawn.gpsLapVd.mockClear();
			drawn.outAndBackVe.mockClear();
			drawn.outAndBackWind.mockClear();
			drawn.outAndBackPower.mockClear();
			drawn.outAndBackVd.mockClear();

			renderHostPage();
			appState = makeAppState();
			await render(appState);

			// The initial paint is not what is under test; only what a later
			// gesture provokes is.
			drawSpy.mockClear();
			calculatorCalls.length = 0;
		});

		afterEach(() => {
			// FIRST, and before `useRealTimers` -- this is CROSS-TEST state.
			//
			// `scheduleRecompute` guards on a MODULE-LEVEL `throttleTimer`
			// handle that is only nulled inside its own callback
			// (`recomputeRunner.ts:239`). `useRealTimers` DISCARDS a pending
			// fake timer without running it, so a test that ends with a
			// recompute still armed leaves that handle set forever -- and every
			// later test then hits `if (throttleTimer !== null) return`, arms
			// nothing, and observes no recompute at all. Its assertion fails for
			// a reason with nothing to do with what it tests.
			//
			// `standardModeRealChain.test.ts:387-398` carries the same hook for
			// the same reason; it is why Standard's post-bind kick was testable
			// and this file's was not.
			resetRecomputeThrottle();
			vi.useRealTimers();
			clearModeUpdateCallbacks();
			resetModeUpdateRequests();
		});

		/**
		 * CR-01, for BOTH segment modes through their real entry points.
		 *
		 * Neither mode had an analyze-time writer of `currentFilteredData` — the
		 * only one is `renderStandardVe.ts:265`, which is Standard-only. So the
		 * field was first written by `summarize`, on the first control
		 * interaction, and Analyze -> Store Result with nothing in between
		 * either refused ("no analysed samples") or averaged a previous Standard
		 * analysis's power, speed and recording date while persisting THIS
		 * ride's result.
		 *
		 * The `beforeEach` above renders and then clears the spies, so reaching
		 * this assertion means the panel is up and NOTHING has been dragged.
		 */
		/**
		 * WR-3, the rest of the same seam.
		 *
		 * `currentWindSource` and `currentVirtualDistances` had exactly ONE
		 * writer between them -- `summarize`, i.e. the UPDATE path. So Analyze ->
		 * Store Result with nothing in between persisted `windSource: "none"` on
		 * a fresh session, or the PREVIOUS analysis's virtual distances on a
		 * second analyze. The `beforeEach` renders and clears, so reaching these
		 * assertions means the panel is up and nothing has been dragged.
		 *
		 * WHAT CHANGED, AND WHY THE ASSERTION MOVED. These two cases used to run
		 * SYNCHRONOUSLY after the render, against the analyze-time seed. That
		 * seed is deleted (`renderGpsLap.ts`, and `renderOutAndBack.ts` next),
		 * because WR-03 established it wrote something the recompute does not
		 * reproduce -- a second answer, not a preview. `summarize` is once again
		 * the only writer, so the field assertion now runs after `settle()`, and
		 * the protection that used to come from "the field is already filled"
		 * comes from "the field is not claimed to be current" instead. Both
		 * halves are asserted; dropping the second one would be the real loss.
		 */
		it("records the wind source before any control is touched", async () => {
			expectStoreResultRefusesForNow(appState);

			await settle();

			expect(appState.currentWindSource).not.toBe("none");
		});

		it("records this analysis's virtual distances, not a previous one's", async () => {
			expectStoreResultRefusesForNow(appState);

			await settle();

			expect(appState.currentVirtualDistances.length).toBeGreaterThan(0);
		});

		/**
		 * WR-4, and the trap the re-scoping note called out: a seed that does
		 * not reproduce the first update is the SAME defect in a new place.
		 *
		 * `analyzeOrchestrator.ts` used to assign `payload.initialResult` -- ONE
		 * stitched fit over the concatenated selection -- while these panels
		 * display N per-lap fits (2N legs for out-and-back). Store Result
		 * straight after Analyze therefore persisted an r2/RMSE no screen ever
		 * showed, and the first control nudge silently replaced it.
		 *
		 * Asserted as an EQUALITY against a nudge that changes nothing, not as
		 * a non-null check: "a result exists" would pass against the stitched
		 * fit too. What has to hold is that the analyze-time value and the
		 * update-time value are the same number.
		 */
		it("seeds the result the first recompute goes on to write", async () => {
			await settle();

			const seeded = appState.currentVEResult;
			expect(seeded).not.toBeNull();
			const beforeNudge = JSON.stringify(seeded);

			// A gesture that changes NOTHING: re-fire `input` at the value the
			// slider already holds. Same inputs, so the same result -- unless
			// the seed came from somewhere else.
			await drag("cdaSlider", parseFloat(el("cdaSlider").value));

			expect(JSON.stringify(appState.currentVEResult)).toBe(beforeNudge);
		});

		/**
		 * CR-01, and the same relocation as the two WR-3 cases above: the samples
		 * arrive from `summarize` rather than from the deleted seed, and what
		 * covers the gap in between is the status, not a pre-filled field.
		 */
		it("has the analysed samples in AppState before any control is touched", async () => {
			expectStoreResultRefusesForNow(appState);

			await settle();

			expect(appState.currentFilteredData).not.toBeNull();
			expect(appState.currentFilteredData!.power.length).toBeGreaterThan(0);
			expect(appState.currentFilteredData!.timestamps).toHaveLength(
				appState.currentFilteredData!.power.length,
			);
		});

		/**
		 * WR-03. The CR-01 seed took EVERY active range, while the pass that
		 * produced the profiles dropped laps: at the time, any lap under 10
		 * samples and any whose calculator threw, both rules living in the
		 * GPS-lap analyze leg, and out-and-back dropped sections with no usable
		 * leg. Those laps were on no plot and in no profile — yet
		 * their samples were in the seeded averages, so Store Result before any
		 * interaction and Store Result after one nudge could report a different
		 * avgPower for the same analysis. Exactly the two-writers-two-answers
		 * property the seed existed to prevent.
		 *
		 * The fixture chain test could not catch this: nothing is dropped there.
		 * Here the panel is handed FEWER profiles than AppState has ranges,
		 * which is what a dropped lap looks like from the plot's side.
		 *
		 * WHAT CHANGED. The superset/subset mismatch is now structurally
		 * impossible rather than merely tested: with the seed gone there is ONE
		 * place that decides which laps survived, and it is the producer.
		 * `updateModeVEPlots.ts:217` applies the same `< 10 samples` rule to the
		 * third range below, so the samples that reach `currentFilteredData` are
		 * the samples of the laps that produced a profile — by construction, not
		 * by a filter written twice. The expected length is UNCHANGED, which is
		 * the point: the mechanism moved, the number did not.
		 */
		it("seeds only the ranges that produced a rendered profile", async () => {
			if (gpsAnalysisMode !== "GPS based lap splitting") return;

			const survivorsOnly = makeAppState();
			// Three active ranges; the third is what the analyze pass dropped.
			survivorsOnly.currentGpsLapIndexRanges = [
				{ startIdx: 0, endIdx: HALF - 1 },
				{ startIdx: HALF, endIdx: LAST_INDEX },
				{ startIdx: 0, endIdx: 4 },
			] as never;

			await showGpsLapVEPlot(
				makeServices(survivorsOnly),
				parameterStorage,
				resultsStorage,
				async () => ({}),
				[lapProfile(1), lapProfile(2)] as never,
				survivorsOnly.currentParameters!,
				true,
				true,
				0,
				"fit",
			);

			expectStoreResultRefusesForNow(survivorsOnly);

			await settle();

			// The two surviving laps cover the whole activity exactly once; the
			// dropped range would have added five more samples.
			expect(survivorsOnly.currentFilteredData!.power).toHaveLength(
				SAMPLE_COUNT,
			);
		});

		/**
		 * RULING B'S DELIVERABLE — THE ORDERING GUARANTEE ITSELF.
		 *
		 * The whole retirement rests on one property: nothing observes
		 * `veStatus === "ready"` before `handler.summarize` has run, because
		 * `ready` IS the claim that `currentVEResult` and its three siblings
		 * describe this selection. `updateModeVEPlots` orders the two lines
		 * (`:370` summarize, `:375` ready) and nothing tested it — the primitive
		 * cannot be driven from a unit test without a populated
		 * `currentFitData`/`currentParameters`, and every `makeAppState` helper in
		 * this repo is module-private. This file has a real one, built through the
		 * real entry point, so the assertion lives here.
		 *
		 * Three observation points, because two of them can each be satisfied by
		 * an implementation the third catches:
		 *
		 *   - BEFORE the kick: not `ready`. An implementation that never set
		 *     `ready` at all would pass this alone.
		 *   - AFTER the kick: `ready`. An implementation that set `ready` on ENTRY
		 *     to the primitive would pass this alone, and would be exactly the bug.
		 *   - INSIDE `summarize`: the wrapper at the head of this file records the
		 *     status at the one instant that separates those two, and it must not
		 *     be `ready` yet.
		 */
		it("never claims ready until the producer has summarized", async () => {
			summarizeStatuses.length = 0;

			expect(appState.veStatus).not.toBe("ready");

			await settle();

			expect(appState.veStatus).toBe("ready");
			// The pass actually reached the seam, or the middle assertion below
			// would be vacuous.
			expect(summarizeStatuses.length).toBeGreaterThan(0);
			for (const seen of summarizeStatuses) {
				expect(seen).toBe("computing");
			}
		});

		/**
		 * The same window, as the USER meets it: a Store Result button that is
		 * visibly refused rather than one that looks clickable and silently does
		 * nothing.
		 *
		 * GPS-lap only here, but not because out-and-back needs different
		 * behaviour any more — its own version of this same assertion lives in
		 * `outAndBackFixtureChain.test.ts` ("ships the Store Result button
		 * disabled until the producer is ready"), so the guard below is merely
		 * conservative, not covering a gap.
		 */
		it("ships the Store Result button disabled until the producer is ready", async () => {
			if (gpsAnalysisMode !== "GPS based lap splitting") return;

			expect(storeButton().disabled).toBe(true);

			await settle();

			expect(storeButton().disabled).toBe(false);
		});

		/**
		 * THE SECOND ANALYZE — the case the whole retirement exists for, and the
		 * only one in which `veStatus` starts out `ready`.
		 *
		 * Every other case in this file builds a fresh `makeAppState()`, whose
		 * `veStatus` is `undefined`, so "not ready" is true of it before anything
		 * runs and an assertion of that alone proves nothing. What must be true
		 * is stronger and only observable here: a status that IS `ready`, from a
		 * completed first analysis, stops being `ready` the moment a new panel
		 * goes up — because `currentVEResult` and its three siblings still hold
		 * the FIRST analysis, and the new panel is not what they describe.
		 *
		 * The button is asserted alongside the field for the same reason it is
		 * asserted at all: the second panel's `#storeResult` is fresh markup, so
		 * it arrives enabled unless something disables it, and this is the state
		 * in which a click would persist the previous analysis under this ride.
		 *
		 * GPS-lap only here, like the case above, and for the same reason: not a
		 * gap, since out-and-back's own version of this case — "stops claiming
		 * ready when a second analyze puts up a new panel" — already lives in
		 * `outAndBackFixtureChain.test.ts`. The guard below is merely
		 * conservative.
		 */
		it("stops claiming ready when a second analyze puts up a new panel", async () => {
			if (gpsAnalysisMode !== "GPS based lap splitting") return;

			await settle();
			expect(appState.veStatus).toBe("ready");
			expect(storeButton().disabled).toBe(false);

			// The user presses Analyze again. Same AppState, same fields, new panel.
			await render(appState);

			expect(appState.veStatus).not.toBe("ready");
			expect(storeButton().disabled).toBe(true);

			// And the second pass re-earns it, so the assertion above is about the
			// window and not about the panel being permanently broken.
			await settle();
			expect(appState.veStatus).toBe("ready");
			expect(storeButton().disabled).toBe(false);
		});

		it("redraws the VE plot when the CdA slider is dragged", async () => {
			await drag("cdaSlider", DRAGGED_CDA);

			expect(drawSpy).toHaveBeenCalled();
			expect(calculatorCalls.length).toBeGreaterThan(0);
			for (const call of calculatorCalls) {
				expect(call.cda).toBeCloseTo(DRAGGED_CDA, 6);
			}
		});

		it("redraws the VE plot when the Crr slider is dragged", async () => {
			await drag("crrSlider", DRAGGED_CRR);

			expect(drawSpy).toHaveBeenCalled();
			expect(calculatorCalls.length).toBeGreaterThan(0);
			for (const call of calculatorCalls) {
				expect(call.crr).toBeCloseTo(DRAGGED_CRR, 6);
			}
		});

		it("redraws the VE plot when the air-speed offset slider is dragged", async () => {
			// N-3's control, and the one the maintainer reported first.
			await drag("airSpeedOffsetSlider", 4);

			expect(drawSpy).toHaveBeenCalled();
		});

		it("redraws the VE plot when the air-speed calibration slider is dragged", async () => {
			await drag("airSpeedCalibrationSlider", 8);

			expect(drawSpy).toHaveBeenCalled();
			expect(appState.airSpeedCalibrationPercent).toBeCloseTo(8, 6);
		});

		it("redraws the VE plot when the wind source is switched to constant", async () => {
			const constant = document.querySelector(
				'input[name="windSource"][value="constant"]',
			) as HTMLInputElement;
			constant.checked = true;
			constant.dispatchEvent(new Event("change", { bubbles: true }));
			await settle();

			expect(drawSpy).toHaveBeenCalled();
		});

		it("redraws the VE plot when elevation smoothing is toggled", async () => {
			const on = document.querySelector(
				'#elevationProfileSwitchToggle [data-smoothing="on"]',
			) as HTMLButtonElement;
			on.dispatchEvent(new MouseEvent("click", { bubbles: true }));
			await settle();

			expect(drawSpy).toHaveBeenCalled();
		});

		it("redraws the VE plot when the wind-height k slider is dragged", async () => {
			await drag("windHeightSlider", 0.7);

			expect(drawSpy).toHaveBeenCalled();
		});
	},
);

/**
 * THE DEFAULT TAB-ACTIVE PREDICATE, DRIVEN AGAINST REAL TAB MARKUP (D-14).
 *
 * WHY THIS BLOCK EXISTS. Before 07-05 the mutation `?? false` -> `=== false` at
 * `updateModeVEPlots.ts:99` — which inverts `isVeTabActive` — failed exactly two
 * files, `standardModeRealChain.test.ts` and `standardCompareSecondaryPlots.test.ts`.
 * Both Standard. The predicate was guarded in ONE mode of three. It survived this
 * file untouched, and it survived `updateModeVEPlots.test.ts` entirely, because
 * that file's two "D-14" cases hand the primitive a predicate of their own: a test
 * cannot see missing what it supplies in its own setup. That is the phase's
 * anti-pattern 1, and these cases are shaped to be immune to it.
 *
 * So NOTHING here supplies a predicate. The panes and buttons come from the real
 * templates, `document` is real jsdom, and the only thing standing between a drag
 * and a secondary redraw is the production function itself.
 *
 * Watched failing, 2026-08-22, in both modes: under the inversion Case A reports
 * `expected "spy" to be called +0 times, but got 1 times` — wind repainted for a
 * tab nobody is on — and Case B reports `expected "spy" to be called 1 times, but
 * got 0 times` — the tab the user IS on left stale. The guard fails in BOTH
 * directions, which is what stops an inversion from passing as mere over-eager
 * repainting.
 *
 * The click matters as much as the drag. `activateTab` renders the tab it moves
 * to, exactly once; that render is the CLICK's, not the drag's, so the spies are
 * cleared between the two.
 */
describe.each(MODES)(
	"$name: the DEFAULT tab-active predicate gates the secondary plots (D-14)",
	({ gpsAnalysisMode, render, drawSpy, secondary }) => {
		let appState: AppState;

		beforeEach(async () => {
			vi.useFakeTimers();
			Element.prototype.scrollIntoView = () => {};
			clearModeUpdateCallbacks();
			resetModeUpdateRequests();
			modeState.gps = gpsAnalysisMode;
			calculatorCalls.length = 0;
			drawn.gpsLapVe.mockClear();
			drawn.gpsLapWind.mockClear();
			drawn.gpsLapPower.mockClear();
			drawn.gpsLapVd.mockClear();
			drawn.outAndBackVe.mockClear();
			drawn.outAndBackWind.mockClear();
			drawn.outAndBackPower.mockClear();
			drawn.outAndBackVd.mockClear();

			renderHostPage();
			appState = makeAppState();
			await render(appState);
		});

		afterEach(() => {
			vi.useRealTimers();
			clearModeUpdateCallbacks();
			resetModeUpdateRequests();
		});

		it("does not redraw an inactive secondary tab when a slider is dragged", async () => {
			// THE PRECONDITION, asserted rather than assumed: all three panes are
			// in the document and none of them is active. Without this the case
			// would also pass against a panel that never rendered the panes at
			// all, which is an accident, not a guard.
			for (const id of ["wind-tab", "power-tab", "vd-tab"]) {
				const pane = document.getElementById(id);
				expect(pane, `#${id} must be in the rendered panel`).not.toBeNull();
				expect(pane!.classList.contains("ve-tab-content--active")).toBe(false);
			}
			expect(activeTabId()).toBe("ve-tab");

			drawSpy.mockClear();
			secondary.wind.mockClear();
			secondary.power.mockClear();
			secondary.vd.mockClear();

			await drag("cdaSlider", DRAGGED_CDA);

			// The update genuinely ran — otherwise three zeroes below would mean
			// nothing at all.
			expect(drawSpy).toHaveBeenCalled();

			expect(secondary.wind).toHaveBeenCalledTimes(0);
			expect(secondary.power).toHaveBeenCalledTimes(0);
			expect(secondary.vd).toHaveBeenCalledTimes(0);
		});

		it("redraws the secondary tab the user is actually on when a slider is dragged", async () => {
			clickTab("wind");

			expect(activeTabId()).toBe("wind-tab");
			expect(
				document
					.getElementById("wind-tab")!
					.classList.contains("ve-tab-content--active"),
			).toBe(true);

			// AFTER the click: `activateTab` already painted wind once, and that
			// paint is not what is under test.
			drawSpy.mockClear();
			secondary.wind.mockClear();
			secondary.power.mockClear();
			secondary.vd.mockClear();

			await drag("cdaSlider", DRAGGED_CDA);

			// One active tab, one secondary redraw.
			expect(secondary.wind).toHaveBeenCalledTimes(1);
			expect(secondary.power).toHaveBeenCalledTimes(0);
			expect(secondary.vd).toHaveBeenCalledTimes(0);
		});
	},
);

/**
 * WR-1 — ANALYZE MUST HONOUR THE ACTIVE ELEVATION PROFILE.
 *
 * `resolveElevationProfile` is what turns "the smoothing toggle is ON" into an
 * actual array. Four production callers route through it; the two GPS ANALYZE
 * legs did not, reading `getNormalizedActivityArrays(fitData).altitude` — the
 * raw FIT channel — straight into the per-lap calculators. With a DEM applied
 * the toggle therefore rendered ON while the first paint was computed from
 * something else, and the numbers moved on the first control nudge, when the
 * update path (which DOES resolve) took over.
 *
 * WHAT CHANGED: the GPS-lap analyze leg has no calculator any more, so it has no
 * elevation series to get wrong. Every case here therefore drives Analyze and
 * then `settle()`s, and asserts on the series that reached the physics on the
 * ONE pass that runs. That is not a weaker claim — it is the same claim about
 * the only place left that can hold it — and the expected arrays are unchanged,
 * because the primitive resolves through the identical helper
 * (`updateModeVEPlots.ts:168`) over the identical first segment.
 *
 * `elevationToggle.integration.test.ts` claimed to cover exactly this in three
 * cases named "standard mode", "gps-lap mode" and "out-and-back mode". All
 * three called `resolveElevationProfile` directly with the same fixture and
 * imported no mode module at all, so all three passed against both GPS legs
 * being wired to the raw channel. That is the same vacuous-guard shape this
 * file was created to answer, which is why the real guard belongs here: the
 * assertion is on the series that reached the physics, through the real render.
 */
describe.each(MODES)(
	"$name: analyze honours the active elevation profile",
	({ gpsAnalysisMode, analyze }) => {
		/** Distinct per index, and distinct BETWEEN profiles, so a slice of one
		 * can never be mistaken for the same slice of another. */
		const FIT_RAW = Array.from({ length: SAMPLE_COUNT }, (_, i) => i);
		const DEM_NEAREST = Array.from(
			{ length: SAMPLE_COUNT },
			(_, i) => 1000 + i,
		);
		const DEM_SMOOTHED = Array.from(
			{ length: SAMPLE_COUNT },
			(_, i) => 5000 + i,
		);

		/** Both modes compute their FIRST segment over indices 0..HALF-1 — lap 1
		 * for GPS-lap, the outbound leg for out-and-back. */
		const firstSegment = (profile: number[]) => profile.slice(0, HALF);

		function appStateWithProfiles(
			active: "fit-raw" | "dem-raw-nearest" | "dem-interpolated-smoothed-5pt",
		): AppState {
			const appState = makeAppState();
			// Replaced wholesale rather than mutated: `altitude` is readonly on
			// ActivityDataLike, and the resolver reads the normalized arrays that
			// are derived from this object.
			appState.currentFitData = {
				...makeFitData(),
				altitude: [...FIT_RAW],
			} as unknown as AppState["currentFitData"];
			appState.fitRawElevation = [...FIT_RAW];
			appState.demRawNearestElevation = [...DEM_NEAREST];
			appState.demInterpolatedSmoothed5ptElevation = [...DEM_SMOOTHED];
			appState.demProfilesAvailable = true;
			appState.activeDisplayProfile = active;
			return appState;
		}

		beforeEach(() => {
			vi.useFakeTimers();
			Element.prototype.scrollIntoView = () => {};
			clearModeUpdateCallbacks();
			resetModeUpdateRequests();
			modeState.gps = gpsAnalysisMode;
			calculatorCalls.length = 0;
			renderHostPage();
		});

		afterEach(() => {
			// The pass this block now depends on is the SCHEDULED one, so the
			// module-level throttle handle has to be released the way the chain
			// describe above releases it -- see its afterEach for what a leaked
			// handle does to every later test.
			resetRecomputeThrottle();
			vi.useRealTimers();
			clearModeUpdateCallbacks();
			resetModeUpdateRequests();
		});

		/**
		 * Analyze, then let the scheduled pass run. `analyze` no longer reaches a
		 * calculator in either mode, so the series under assertion is the one the
		 * primitive was given -- which is the only one there is.
		 */
		async function analyzeAndSettle(appState: AppState): Promise<void> {
			await analyze(appState);
			await settle();
		}

		it("computes from the smoothed DEM profile when that is active", async () => {
			await analyzeAndSettle(
				appStateWithProfiles("dem-interpolated-smoothed-5pt"),
			);

			expect(calculatorCalls.length).toBeGreaterThan(0);
			expect(calculatorCalls[0].altitude).toEqual(firstSegment(DEM_SMOOTHED));
		});

		it("computes from the nearest-DEM profile when that is active", async () => {
			await analyzeAndSettle(appStateWithProfiles("dem-raw-nearest"));

			expect(calculatorCalls.length).toBeGreaterThan(0);
			expect(calculatorCalls[0].altitude).toEqual(firstSegment(DEM_NEAREST));
		});

		it("still uses the raw FIT channel when no DEM profile is active", async () => {
			// The other half of the guard: resolving must not mean "always DEM".
			await analyzeAndSettle(appStateWithProfiles("fit-raw"));

			expect(calculatorCalls.length).toBeGreaterThan(0);
			expect(calculatorCalls[0].altitude).toEqual(firstSegment(FIT_RAW));
		});
	},
);

/**
 * THE AIR-DENSITY SERIES AND THE SEGMENT IT IS SLICED FOR.
 *
 * Both analyze legs used to walk their segment on `allTimestamps.length` and
 * index their resolved `allRho` with the same counter — the GPS-lap leg into a
 * `lapRho`, `renderOutAndBack.ts` into a `legRho` — with nothing checking that
 * the density channel was as long as the ride.
 * `resolveRhoArray` accepts it on `.some(rho => rho > 0)`, and
 * `getNormalizedActivityArrays` converts it without padding, so a device that
 * stopped emitting air density mid-ride yields a SHORT array: the tail indices
 * pushed `undefined` into a `number[]` and NaN rho crossed the WASM boundary
 * for the rest of that segment.
 *
 * The Standard leg had already been given this guard, with the rule written
 * down at `rhoArrayResolver.ts:86` — "a short or hole-punched array under the
 * calculator is a worse bug than a constant one". These two legs are that rule
 * applied where it was missed, so the assertion is not "rho is right" but
 * "rho is either complete or absent, never partial".
 *
 * WHAT CHANGED, and it MATTERS MORE HERE THAN ANYWHERE ELSE IN THIS FILE. The
 * GPS-lap analyze leg is retired, so the guard it carried went with it — and the
 * rule above is not optional just because its holder moved. These cases now
 * Analyze and then `settle()`, so the series under assertion is the one
 * `updateModeVEPlots` handed the physics. That pass slices with
 * `indices.map((i) => rhoArray[i])` (`:258`), which on a short channel yields
 * `undefined` in every tail position, so this rewrite is what forced the guard
 * to be added there. The claim is unchanged and now covers the only pass there
 * is: rho reaching the calculator is complete or absent, never partial.
 *
 * WHAT THE OTHER FILE COVERS, so a deletion aimed at one cannot take the other.
 * These cases are BEHAVIOURAL: they drive the real chain and inspect the values
 * that reach the physics, which is why `null` versus a hole-punched array is
 * visible here and nowhere else. The PRESENCE half — that every
 * `createVeCalculator` call is given a `rhoArray:` at all, in every leg and in
 * `updateModeVEPlots.ts` — is asserted source-level in
 * `calculatorRhoArray.test.ts`. That guard supersedes only the presence
 * property these cases held implicitly; it cannot see a runtime value, so it
 * does not subsume anything below.
 */
describe.each(MODES)(
	"$name: the air-density slice under the calculator",
	({ gpsAnalysisMode, analyze }) => {
		beforeEach(() => {
			vi.useFakeTimers();
			modeState.gps = gpsAnalysisMode;
			calculatorCalls.length = 0;
			clearModeUpdateCallbacks();
			resetModeUpdateRequests();
			Element.prototype.scrollIntoView = () => {};
			renderHostPage();
		});

		afterEach(() => {
			resetRecomputeThrottle();
			vi.useRealTimers();
			clearModeUpdateCallbacks();
			resetModeUpdateRequests();
		});

		/** An activity whose recorded air density stops after `covered` samples. */
		function appStateWithRho(covered: number): AppState {
			const appState = makeAppState();
			appState.currentFitData = {
				...makeFitData(),
				air_density_data: new Array<number>(covered).fill(1.22),
			} as unknown as AppState["currentFitData"];
			return appState;
		}

		it("hands the calculator a complete series when the channel spans the ride", async () => {
			await analyze(appStateWithRho(SAMPLE_COUNT));
			await settle();

			expect(calculatorCalls.length).toBeGreaterThan(0);
			for (const call of calculatorCalls) {
				expect(call.rhoArray).not.toBeNull();
				expect(call.rhoArray).toHaveLength(call.timestamps);
				expect(call.rhoArray!.every(Number.isFinite)).toBe(true);
			}
		});

		it("falls back to a constant rather than a hole-punched series", async () => {
			// Density for the first quarter of the ride only, so the first
			// segment of BOTH modes (0..HALF-1) runs off the end of it.
			await analyze(appStateWithRho(SAMPLE_COUNT / 4));
			await settle();

			expect(calculatorCalls.length).toBeGreaterThan(0);
			for (const call of calculatorCalls) {
				// Null is the fallback; what must never reach the physics is an
				// array with holes in it or one shorter than the other series.
				if (call.rhoArray !== null) {
					expect(call.rhoArray).toHaveLength(call.timestamps);
					expect(call.rhoArray.every(Number.isFinite)).toBe(true);
				}
			}
			// And at least one segment actually hit the short tail, or this test
			// proves nothing.
			expect(calculatorCalls.some((call) => call.rhoArray === null)).toBe(true);
		});
	},
);
