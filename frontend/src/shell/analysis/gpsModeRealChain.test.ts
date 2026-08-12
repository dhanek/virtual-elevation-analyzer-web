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
	() => [] as Array<{ cda: number; crr: number }>,
);

vi.mock("../../analysis/VeCalculatorFactory", () => ({
	createVeCalculator: (input: any) => {
		calculatorCalls.push({ cda: input.cda, crr: input.crr });
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

/** The far end of the chain: the functions that actually paint a figure. */
const drawn = vi.hoisted(() => ({
	gpsLapVe: vi.fn(),
	outAndBackVe: vi.fn(),
}));

vi.mock("../gpsLap/gpsLapPlots", async (importOriginal) => ({
	...(await importOriginal<Record<string, unknown>>()),
	renderGpsLapVEPlots: (...args: unknown[]) => drawn.gpsLapVe(...args),
	renderGpsLapWindPlot: () => {},
	renderGpsLapPowerPlot: () => {},
	renderGpsLapVdPlot: () => {},
}));

vi.mock("../outAndBack/outAndBackPlots", async (importOriginal) => ({
	...(await importOriginal<Record<string, unknown>>()),
	renderOutAndBackPlots: (...args: unknown[]) => drawn.outAndBackVe(...args),
	renderOutAndBackWindPlot: () => {},
	renderOutAndBackPowerPlot: () => {},
	renderOutAndBackVdPlot: () => {},
}));

import type { AnalysisParameters } from "../../components/AnalysisParameters";
import type { AppState } from "../../state/AppState";
import type { ParameterStorage } from "../../utils/ParameterStorage";
import type { ResultsStorage } from "../../utils/ResultsStorage";
import type { ShellServices } from "./types";
import { showGpsLapVEPlot } from "../gpsLap/renderGpsLap";
import { showOutAndBackVEPlot } from "../outAndBack/renderOutAndBack";
import { clearModeUpdateCallbacks } from "./modeUpdateCallbacks";
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
	distances: [0, 1, 2],
	virtualElevation: [0, 1, 2],
	actualElevation: [0, 1, 2],
	supplementarySeries: null,
	duration: HALF,
	totalDistance: 2,
});

const meanElevation = { distances: [0, 1, 2], elevation: [0, 1, 2] };

const sectionProfile = {
	sectionNumber: 1,
	outboundDistances: [0, 1, 2],
	outboundVE: [0, 1, 2],
	outboundActualElevation: [0, 1, 2],
	outboundSeries: null,
	inboundDistances: [0, 1, 2],
	inboundVE: [0, 1, 2],
	inboundActualElevation: [0, 1, 2],
	inboundSeries: null,
	outboundDuration: HALF,
	inboundDuration: HALF,
	totalDistance: 4,
};

/** Drain the recompute runner's debounce so the scheduled run executes. */
async function settle(): Promise<void> {
	await vi.advanceTimersByTimeAsync(500);
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

interface ModeUnderTest {
	name: string;
	gpsAnalysisMode: string;
	/** Renders the real sidebar and does the real binding. */
	render: (appState: AppState) => Promise<void>;
	drawSpy: ReturnType<typeof vi.fn>;
}

const MODES: readonly ModeUnderTest[] = [
	{
		name: "GPS-lap",
		gpsAnalysisMode: "GPS based lap splitting",
		drawSpy: drawn.gpsLapVe,
		render: (appState) =>
			showGpsLapVEPlot(
				makeServices(appState),
				parameterStorage,
				resultsStorage,
				async () => ({}),
				[lapProfile(1), lapProfile(2)] as any,
				meanElevation,
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
		render: (appState) =>
			showOutAndBackVEPlot(
				makeServices(appState),
				parameterStorage,
				resultsStorage,
				async () => ({}),
				[sectionProfile] as any,
				meanElevation,
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
			drawn.outAndBackVe.mockClear();

			renderHostPage();
			appState = makeAppState();
			await render(appState);

			// The initial paint is not what is under test; only what a later
			// gesture provokes is.
			drawSpy.mockClear();
			calculatorCalls.length = 0;
		});

		afterEach(() => {
			vi.useRealTimers();
			clearModeUpdateCallbacks();
			resetModeUpdateRequests();
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
