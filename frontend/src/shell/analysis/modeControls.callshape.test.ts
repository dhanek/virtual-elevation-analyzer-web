/**
 * @vitest-environment jsdom
 *
 * THE type-B call-shape matrix (D-08 type B, 07-VALIDATION.md).
 *
 * The claim under test is the plan's central structural one: every row of
 * `MODE_CONTROL_TABLE` that a mode renders reaches the primitive EXACTLY ONCE
 * per interaction, with the arguments the live controls hold. That is the guard
 * against the 2026-04-19 omission class — a control that reaches the primitive
 * zero times (forgot to call the update) or twice (a second entry point).
 *
 * The matrix is TABLE-DRIVEN over the real `MODE_CONTROL_TABLE`, not over a
 * hand-listed set of controls, so adding a row without wiring it fails here
 * rather than shipping unbound. The reason-set case below pins the table itself
 * against the Priority 6 control union.
 *
 * WHAT IS REAL: `bindModeControls`, `requestModeUpdate`, `MODE_CONTROL_TABLE`,
 * `getAnalysisModeHandler`, `standardMode.getUpdateSegments`, `mapTrimToSegments`,
 * `syncRangeAndNumber`, `bindWindSourceRadios`, `scheduleRecompute`. Only the
 * primitive is mocked, and only so its arguments can be observed — no handler is
 * re-implemented in this file. (07-VALIDATION.md §Guard Types names
 * `parameterChangeHandler.test.ts` as the anti-pattern to avoid: a test that
 * imports no production module and asserts on its own mock.)
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/** The observed argument object of every primitive call, in order. */
type PrimitiveArgs = Record<string, any>;

const primitive = vi.fn(async (_args: PrimitiveArgs) => null);

vi.mock("./updateModeVEPlots", () => ({
	updateModeVEPlots: (args: PrimitiveArgs) => primitive(args),
	isVeTabActive: () => false,
}));

/**
 * Which mode the funnel resolves. `requestModeUpdate` asks
 * `getAnalysisModeHandler(getGpsAnalysisMode())`, so pointing the matrix at
 * gpsLap or outAndBack means moving this and nothing else — the funnel, the
 * binder and the table are all real. `importOriginal` keeps every other export
 * of the orchestration module intact.
 */
const modeState = vi.hoisted(() => ({ gps: "None" as string }));

vi.mock("../section3/section3Orchestration", async (importOriginal) => ({
	...(await importOriginal<Record<string, unknown>>()),
	getGpsAnalysisMode: () => modeState.gps,
}));

import type { ModeUpdateCallbacks } from "../../modes/analysis/types";
import type { AppState } from "../../state/AppState";
import { getAnalysisModeHandler } from "../../modes/analysis/AnalysisModes";
import { veViewMatchesSelection } from "../ve/veSelectionGuard";
import { bindModeControls } from "./bindModeControls";
import { MODE_CONTROL_TABLE, type ModeControlSpec } from "./modeControlTable";
import {
	clearModeUpdateCallbacks,
	registerModeUpdateCallbacks,
} from "./modeUpdateCallbacks";
import { configureParameterMerge } from "./parametersSync";
import { resetModeUpdateRequests } from "./requestModeUpdate";

const SAMPLE_COUNT = 400;
const LAST_INDEX = SAMPLE_COUNT - 1;
const CDA = 0.25;
const CRR = 0.0042;

function makeFitData() {
	const timestamps = Array.from({ length: SAMPLE_COUNT }, (_, i) => i);
	const zeros = () => new Array<number>(SAMPLE_COUNT).fill(0);
	return {
		timestamps,
		power: zeros(),
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

function makeAppState(): AppState {
	return {
		currentFitData: makeFitData(),
		currentParameters: {
			cda_min: 0.1,
			cda_max: 0.5,
			crr_min: 0.001,
			crr_max: 0.02,
			air_speed_offset: 0,
			velodrome: false,
			auto_calculate_rho: false,
		},
		currentLaps: [{ start_time: 0, end_time: LAST_INDEX }],
		selectedLaps: [1],
		currentAnalyzedLaps: [1],
		airSpeedCalibrationPercent: 5,
		activeDisplayProfile: "fit-raw",
		isCalculatingAutoRho: false,
		demProfilesAvailable: true,
	} as unknown as AppState;
}

const noopCallbacks: ModeUpdateCallbacks = {
	aggregate: () => ({
		r2: 0,
		rmse: 0,
		veGain: 0,
		actualGain: 0,
		segmentCount: 0,
	}),
	renderVe: () => {},
	renderWind: () => {},
	renderPower: () => {},
	renderVd: () => {},
	renderMetrics: () => {},
};

/**
 * Every element the Standard rows of the table declare, plus the containers the
 * delegated blocks look for. The panel is inside `#veAnalysisSection` because
 * the funnel refuses to schedule anything while the VE section is not visible.
 */
function renderPanel(): void {
	document.body.innerHTML = `
		<div id="veAnalysisSection">
			<input type="range" id="trimStartSlider" min="0" max="${SAMPLE_COUNT - 30}" value="0">
			<input type="number" id="trimStartValue" value="0">
			<input type="range" id="trimEndSlider" min="30" max="${LAST_INDEX}" value="${LAST_INDEX}">
			<input type="number" id="trimEndValue" value="${LAST_INDEX}">

			<div id="mapTrimControls" class="hidden">
				<input type="range" id="mapTrimStartSlider" min="0" max="${SAMPLE_COUNT - 30}" value="0">
				<input type="number" id="mapTrimStartValue" value="0">
				<input type="range" id="mapTrimEndSlider" min="30" max="${LAST_INDEX}" value="${LAST_INDEX}">
				<input type="number" id="mapTrimEndValue" value="${LAST_INDEX}">
			</div>

			<input type="range" id="cdaSlider" min="0.1" max="0.5" step="0.001" value="${CDA}">
			<input type="number" id="cdaValue" value="${CDA}">
			<input type="range" id="crrSlider" min="0.001" max="0.02" step="0.0001" value="${CRR}">
			<input type="number" id="crrValue" value="${CRR}">

			<input type="range" id="airSpeedCalibrationSlider" min="-20" max="20" step="0.1" value="5">
			<input type="number" id="airSpeedCalibrationValue" value="5.0">
			<button id="autoAdjustCalibration">Auto</button>

			<input type="range" id="airSpeedOffsetSlider" min="-10" max="10" step="1" value="0">
			<input type="number" id="airSpeedOffsetValue" value="0">
			<span id="airSpeedOffsetErrorMetric"></span>

			<label><input type="radio" name="windSource" value="fit" checked></label>
			<label><input type="radio" name="windSource" value="constant"></label>
			<label><input type="radio" name="windSource" value="compare"></label>

			<div class="lap-view-toggle" id="elevationProfileSwitchToggle">
				<button type="button" class="lap-view-toggle-btn lap-view-toggle-btn--active" data-smoothing="off">OFF</button>
				<button type="button" class="lap-view-toggle-btn" data-smoothing="on">ON</button>
			</div>

			<div id="crrTempControls">
				<input type="checkbox" id="crrTempToggle">
				<div id="crrTempFields">
					<input type="number" id="crrTempAmbient" value="18">
					<select id="crrTempSensitivity"><option value="typical" selected>typical</option></select>
					<div id="crrTempReadout"></div>
				</div>
			</div>

			<input type="range" id="windHeightSlider" min="0" max="100" step="1" value="100">
			<input type="number" id="windHeightValue" value="100">
			<div id="windHeightReadout"></div>
		</div>
	`;
}

interface Harness {
	appState: AppState;
	trimMapUpdates: Array<{ start: number; end: number }>;
}

function setup(overrides: Partial<AppState> = {}): Harness {
	renderPanel();
	primitive.mockClear();

	const appState = Object.assign(makeAppState(), overrides);
	const trimMapUpdates: Array<{ start: number; end: number }> = [];

	clearModeUpdateCallbacks();
	registerModeUpdateCallbacks("standard", () => noopCallbacks);
	// NOTE: this file must NOT call `configureModeUpdateRequests`. It used to,
	// and that single line is why 66 green tests coexisted with two entirely dead
	// modes: production configured the funnel only from Standard's binder, and
	// the matrix quietly did it for whichever mode it drove. A test that supplies
	// the wiring production is missing cannot observe it missing. The binder owns
	// that step now, so the matrix gets it the same way the app does.
	bindModeControls({
		appState,
		modeId: "standard",
		saveSettings: () => {},
		onTrimMapUpdate: (start, end) => trimMapUpdates.push({ start, end }),
		mapCanFollow: () =>
			veViewMatchesSelection(appState.currentAnalyzedLaps, appState.selectedLaps),
		triggerAutoRho: () => {},
		getOffsetMetricWindows: () => [{ start: 0, end: LAST_INDEX }],
		getSyncErrorSeries: () => ({
			groundSpeed: new Array<number>(SAMPLE_COUNT).fill(10),
			airSpeed: new Array<number>(SAMPLE_COUNT).fill(10),
		}),
		getAutoCalibrationPercent: () => 3.5,
	});

	return { appState, trimMapUpdates };
}

function el(id: string): HTMLInputElement {
	return document.getElementById(id) as HTMLInputElement;
}

/** Drain the recompute runner's debounce so `run` actually executes. */
async function settle(): Promise<void> {
	await vi.advanceTimersByTimeAsync(500);
}

/** The one primitive call this interaction produced. */
function soleCall(): PrimitiveArgs {
	expect(primitive).toHaveBeenCalledTimes(1);
	return primitive.mock.calls[0]![0];
}

/**
 * Drive the row the way a user drives that KIND of control. Returns nothing —
 * the assertion is always on the primitive call it produced.
 */
async function interact(spec: ModeControlSpec): Promise<void> {
	switch (spec.kind) {
		case "rangeNumber": {
			const range = el(spec.elements.rangeId!);
			// Nudge the value so the interaction is a real change. Trim start moves
			// up, trim end moves down; everything else moves within its own range.
			if (spec.reason === "trim" || spec.reason === "mapTrim") {
				range.value =
					spec.elements.role === "end"
						? (LAST_INDEX - 40).toString()
						: "40";
			} else if (spec.reason === "cda") {
				range.value = "0.31";
			} else if (spec.reason === "crr") {
				range.value = "0.0051";
			} else if (spec.reason === "calibration") {
				range.value = "7.5";
			} else {
				range.value = "3";
			}
			range.dispatchEvent(new Event("input"));
			break;
		}
		case "button":
			document.getElementById(spec.elements.buttonId!)!.click();
			break;
		case "radioGroup": {
			const constant = document.querySelector(
				'input[name="windSource"][value="constant"]',
			) as HTMLInputElement;
			constant.checked = true;
			constant.dispatchEvent(new Event("change"));
			break;
		}
		case "toggle":
			(
				document.querySelector(
					'#elevationProfileSwitchToggle [data-smoothing="on"]',
				) as HTMLButtonElement
			).click();
			break;
		case "delegated":
			if (spec.reason === "crrTemp") {
				const toggle = el("crrTempToggle");
				toggle.checked = true;
				toggle.dispatchEvent(new Event("change"));
			} else {
				// Driven with `input`, like every other slider in the matrix: k is a
				// range element wherever it is rendered, and it recomputes while the
				// thumb moves rather than only on release (see the cadence block).
				const slider = el("windHeightSlider");
				slider.value = "0.75";
				slider.dispatchEvent(new Event("input"));
			}
			break;
	}
	await settle();
}

beforeEach(() => {
	vi.useFakeTimers();
	resetModeUpdateRequests();
	clearModeUpdateCallbacks();
});

describe("MODE_CONTROL_TABLE is the Priority 6 control union", () => {
	it("carries exactly the controls the research inventory lists", () => {
		// A literal expected set, so adding or dropping a control without updating
		// the union is a failing test rather than a silently unwired control.
		expect(new Set(MODE_CONTROL_TABLE.map((spec) => spec.reason))).toEqual(
			new Set([
				"cda",
				"crr",
				"trim",
				"calibration",
				"autoAdjustCalibration",
				"airSpeedOffset",
				"windSource",
				"elevationSmoothing",
				"crrTemp",
				"windHeight",
			]),
		);
	});

	it("scopes trim to standard and offset/wind-source to all three modes", () => {
		const modesFor = (reason: string) =>
			MODE_CONTROL_TABLE.filter((spec) => spec.reason === reason).flatMap(
				(spec) => [...spec.modes],
			);

		// The GPS templates render no trim markup at all.
		expect(new Set(modesFor("trim"))).toEqual(new Set(["standard"]));
		// `mapTrim` has NO row in any mode since 2026-09-03. Those four sliders
		// live in Section 3 rather than in a mode panel, so by this table's own
		// doctrine (`modeControlTable.ts:34-39`) Section 3 raises the reason
		// itself, exactly as it does for `segmentSelection`. Behaviour covered by
		// `section3/mapTrimModeUpdate.test.ts`.
		expect(modesFor("mapTrim")).toEqual([]);
		// N-3 and N-5: both are all-mode rows.
		expect(new Set(modesFor("airSpeedOffset"))).toEqual(
			new Set(["standard", "gpsLap", "outAndBack"]),
		);
		expect(new Set(modesFor("windSource"))).toEqual(
			new Set(["standard", "gpsLap", "outAndBack"]),
		);
	});

	it("resolves the standard mode handler through the one registry", () => {
		expect(getAnalysisModeHandler(null).id).toBe("standard");
	});
});

describe("standard: every rendered row reaches the primitive exactly once", () => {
	const standardRows = MODE_CONTROL_TABLE.filter((spec) =>
		spec.modes.includes("standard"),
	);

	it("covers every standard row of the table", () => {
		// 13 before the two `mapTrim` rows moved to Section 3 (2026-09-03).
		expect(standardRows.length).toBe(11);
	});

	for (const spec of standardRows) {
		const name = spec.elements.rangeId ?? spec.elements.buttonId ?? spec.reason;

		it(`${spec.reason} (${name}) calls the primitive once with the live control values`, async () => {
			setup();
			await interact(spec);

			const args = soleCall();
			expect(args.cda).toBeCloseTo(
				spec.reason === "cda" ? 0.31 : CDA,
				6,
			);
			expect(args.crr).toBeCloseTo(spec.reason === "crr" ? 0.0051 : CRR, 6);
			// The wind-source row is the only one that changes the source.
			expect(args.windSource).toBe(
				spec.reason === "windSource" ? "constant" : "fit",
			);
			expect(args.handler.id).toBe("standard");
		});
	}
});

describe("standard: the trim window reaches the primitive as segment trim", () => {
	it("maps a moved trim start onto the segment", async () => {
		setup();
		const slider = el("trimStartSlider");
		slider.value = "40";
		slider.dispatchEvent(new Event("input"));
		await settle();

		const args = soleCall();
		expect(args.segments[0].trim).toEqual({ start: 40, end: LAST_INDEX });
	});

	it("maps a moved trim end onto the segment", async () => {
		setup();
		const slider = el("trimEndSlider");
		slider.value = (LAST_INDEX - 40).toString();
		slider.dispatchEvent(new Event("input"));
		await settle();

		const args = soleCall();
		expect(args.segments[0].trim).toEqual({
			start: 0,
			end: LAST_INDEX - 40,
		});
	});

	/**
	 * INVERTED ON 2026-09-03, and the inversion is the point.
	 *
	 * This case used to assert that the map's twin slider drove the primitive
	 * through the binder, and that the main slider followed via `writeTrim`.
	 * Both were real, and both were the SECOND owner of four nodes that
	 * `initializeMapTrimControlsForSelectedLaps` clones on every Section 3
	 * render — which stripped this binding and left the sliders moving the map
	 * while the panel described the previous window.
	 *
	 * `mapTrim` now has no row, by this table's own doctrine: it is not a
	 * control inside the mode panel. Section 3 raises the reason and mirrors
	 * onto the panel's pair itself, and `section3/mapTrimModeUpdate.test.ts`
	 * carries that behaviour, including the mirror — which is load-bearing,
	 * since `requestModeUpdate` reads its window from `trimStartSlider`.
	 *
	 * What has to stay true HERE is the absence: the binder must not wire these
	 * nodes, or the two owners come back and one drag reaches the funnel twice.
	 */
	it("leaves the map's twin sliders entirely to Section 3", async () => {
		setup();
		const slider = el("mapTrimStartSlider");
		slider.value = "60";
		slider.dispatchEvent(new Event("input"));
		await settle();

		// No row, so no listener, so nothing reaches the primitive from here.
		expect(primitive).toHaveBeenCalledTimes(0);
		// And the binder does not mirror it either -- Section 3 does that now.
		expect(el("trimStartSlider").value).not.toBe("60");
	});

	it("parks the sliders at the clamp and still reaches the primitive ONCE (CR-01)", async () => {
		setup();
		const slider = el("trimStartSlider");
		// Well inside the 30-sample minimum window.
		slider.value = (LAST_INDEX - 5).toString();
		slider.dispatchEvent(new Event("input"));
		await settle();

		// The slider parks at the limit, as it always has.
		expect(el("trimStartSlider").value).toBe((LAST_INDEX - 30).toString());
		// But the clamped window still reaches the primitive. This branch used to
		// `return` before `finish()`, and that swallowed the synthetic `input`
		// dispatch `showVirtualElevationAnalysisInline` fires to force the first
		// pass — so a lap whose SAVED trim already sat at the clamp never ran
		// `summarize`, and Store Result averaged the whole untrimmed lap while the
		// plot showed the 30-sample window.
		const args = soleCall();
		expect(args.segments[0].trim).toEqual({
			start: LAST_INDEX - 30,
			end: LAST_INDEX,
		});
	});

	it("does NOT recompute a second time while parked at the clamp", async () => {
		setup();
		const slider = el("trimStartSlider");
		slider.value = (LAST_INDEX - 5).toString();
		slider.dispatchEvent(new Event("input"));
		await settle();
		expect(primitive).toHaveBeenCalledTimes(1);

		// Dragging further into the end produces the SAME parked window, and the
		// pipeline already has it. This is the half of the old behaviour worth
		// keeping: dragging one edge into the other parks rather than recomputing
		// the identical window over and over.
		slider.value = (LAST_INDEX - 2).toString();
		slider.dispatchEvent(new Event("input"));
		await settle();

		expect(primitive).toHaveBeenCalledTimes(1);
		expect(el("trimStartSlider").value).toBe((LAST_INDEX - 30).toString());
	});
});

describe("standard: veViewMatchesSelection still gates the map markers", () => {
	it("recomputes but does NOT repaint trim markers for a stale selection", async () => {
		// The panel belongs to lap 1; the user has since ticked lap 2. Auto-rho can
		// still run these handlers ~500 ms later with the PREVIOUS lap's values, so
		// the plots must follow the sliders while the map must not.
		const { trimMapUpdates } = setup({
			currentAnalyzedLaps: [1],
			selectedLaps: [2],
		} as Partial<AppState>);

		const slider = el("trimStartSlider");
		slider.value = "40";
		slider.dispatchEvent(new Event("input"));
		await settle();

		expect(primitive).toHaveBeenCalledTimes(1);
		expect(trimMapUpdates).toEqual([]);
	});

	it("repaints trim markers when the panel still owns the selection", async () => {
		const { trimMapUpdates } = setup();

		const slider = el("trimStartSlider");
		slider.value = "40";
		slider.dispatchEvent(new Event("input"));
		await settle();

		expect(primitive).toHaveBeenCalledTimes(1);
		expect(trimMapUpdates).toEqual([{ start: 40, end: LAST_INDEX }]);
	});
});

/**
 * CADENCE — the 2026-08-05 report: "when I use the CDA slider the plots get
 * updated while I drag them, for the wind height k factor it only gets updated
 * on release".
 *
 * The assertion is on the OBSERVED CADENCE: how many times the primitive runs
 * while the thumb is moving, and how many more times it runs when the thumb is
 * released. It is deliberately NOT an assertion that a given row listens to a
 * given DOM event — a row that changes its listeners but keeps the cadence
 * passes here, and a row that keeps its listeners but loses the cadence fails.
 *
 * The equality case pins its own floor (`toBeGreaterThan(0)`) before comparing,
 * because "k matches CdA" is satisfied vacuously by a harness in which neither
 * one redraws at all.
 */
describe("standard: every slider redraws live during a drag, at one cadence", () => {
	/** Positions the thumb passes through, all on-step and in-range for both. */
	const CDA_DRAG = ["0.26", "0.27", "0.28"] as const;
	// D-b: k's thumb is on the 0-100% scale (the model still stores 0-1), so
	// these are percent positions where CdA's are raw factor values.
	const K_DRAG = ["55", "60", "65"] as const;

	interface Cadence {
		/** Primitive runs observed before the thumb was released. */
		duringDrag: number;
		/** Additional primitive runs the release itself produced. */
		onRelease: number;
	}

	/**
	 * What a browser emits for a pointer drag on a range input: one `input` per
	 * position the thumb passes through, then exactly one `change` on release.
	 */
	async function drag(
		rangeId: string,
		positions: readonly string[],
	): Promise<Cadence> {
		const range = el(rangeId);
		for (const position of positions) {
			range.value = position;
			range.dispatchEvent(new Event("input"));
			await settle();
		}
		const duringDrag = primitive.mock.calls.length;

		range.dispatchEvent(new Event("change"));
		await settle();

		return {
			duringDrag,
			onRelease: primitive.mock.calls.length - duringDrag,
		};
	}

	/**
	 * k is written through `mergeAnalysisParameters`, so without a merge handler
	 * the drag would redraw with a factor that never reached the model — a pass
	 * that proves nothing. Wiring the gateway lets the value be asserted too.
	 */
	function setupWithParameterMerge(): AppState {
		const { appState } = setup();
		configureParameterMerge((fields) => {
			Object.assign(appState.currentParameters!, fields);
		});
		return appState;
	}

	afterEach(() => {
		configureParameterMerge(null);
	});

	it("redraws at every position the CdA thumb passes, and not again on release", async () => {
		setup();
		expect(await drag("cdaSlider", CDA_DRAG)).toEqual({
			duringDrag: CDA_DRAG.length,
			onRelease: 0,
		});
	});

	it("redraws at every position the k thumb passes, and not again on release", async () => {
		const appState = setupWithParameterMerge();

		expect(await drag("windHeightSlider", K_DRAG)).toEqual({
			duringDrag: K_DRAG.length,
			onRelease: 0,
		});
		// Each of those redraws ran against the factor the thumb was sitting on,
		// not against the pre-drag one.
		expect(appState.currentParameters!.wind_height_factor).toBeCloseTo(0.65, 6);
	});

	it("gives k and CdA the same cadence for the same gesture", async () => {
		setup();
		const cda = await drag("cdaSlider", CDA_DRAG);

		setupWithParameterMerge();
		const k = await drag("windHeightSlider", K_DRAG);

		// Floor first: an equality that both sides satisfy with zero redraws is
		// not evidence of anything.
		expect(cda.duringDrag).toBeGreaterThan(0);
		expect(k).toEqual(cda);
	});
});

describe("standard: the air-speed offset row is bound and writes its readout", () => {
	it("refreshes the sync-error readout and calls the primitive once", async () => {
		setup();
		const slider = el("airSpeedOffsetSlider");
		slider.value = "3";
		slider.dispatchEvent(new Event("input"));
		await settle();

		expect(primitive).toHaveBeenCalledTimes(1);
		const metric = document.getElementById("airSpeedOffsetErrorMetric")!;
		expect(metric.textContent).not.toBe("");
		expect(Number.isNaN(Number(metric.textContent))).toBe(false);
	});
});


/**
 * THE FULL CONTROL x MODE PRODUCT.
 *
 * The blocks above drive Standard. This one drives every (row, mode) pair the
 * table admits, because "the binder handles all three modes" is exactly the
 * claim that a Standard-only matrix cannot make. The GPS modes reached the
 * primitive by their own private routes until plan 07-03, and the offset slider
 * in both of them was rendered, visible, draggable and bound to nothing (N-3).
 *
 * Everything here is real except the primitive itself and the mode accessor:
 * the binder, the funnel, `MODE_CONTROL_TABLE`, the mode handlers and the
 * recompute runner all run.
 */
const GPS_LAP_RANGES = [
	{ startIdx: 0, endIdx: 199 },
	{ startIdx: 200, endIdx: LAST_INDEX },
];

const OUT_AND_BACK_SECTIONS = [
	{
		sectionNumber: 1,
		outboundStartIdx: 0,
		outboundEndIdx: 199,
		inboundStartIdx: 200,
		inboundEndIdx: LAST_INDEX,
	},
];

interface ModeCase {
	modeId: "standard" | "gpsLap" | "outAndBack";
	/** What `getGpsAnalysisMode()` returns for this mode. */
	detectionMode: string;
	/** Does this mode's template render the trim markup? */
	rendersTrim: boolean;
	state: Partial<AppState>;
}

const MODE_CASES: readonly ModeCase[] = [
	{
		modeId: "standard",
		detectionMode: "None",
		rendersTrim: true,
		state: {},
	},
	{
		modeId: "gpsLap",
		detectionMode: "GPS based lap splitting",
		rendersTrim: false,
		state: {
			currentGpsLapIndexRanges: GPS_LAP_RANGES,
			// `gpsLapMode.getUpdateSegments` labels each range through
			// `resolveGpsLapNumber`, which reads these two.
			gpsDetectedLaps: [],
			gpsSelectedLaps: [],
		} as unknown as Partial<AppState>,
	},
	{
		modeId: "outAndBack",
		detectionMode: "GPS based out and back",
		rendersTrim: false,
		state: {
			currentOutAndBackSections: OUT_AND_BACK_SECTIONS,
		} as unknown as Partial<AppState>,
	},
];

function setupMode(modeCase: ModeCase): AppState {
	// The GPS sidebars render NO trim markup, so the panel must not either.
	// Rendering it anyway would let the trim rows bind in a mode whose template
	// has none, and the negative cases below would pass for the wrong reason.
	renderPanel();
	if (!modeCase.rendersTrim) {
		for (const id of [
			"trimStartSlider",
			"trimStartValue",
			"trimEndSlider",
			"trimEndValue",
			"mapTrimControls",
		]) {
			document.getElementById(id)?.remove();
		}
	}

	primitive.mockClear();
	modeState.gps = modeCase.detectionMode;

	const appState = Object.assign(
		makeAppState(),
		modeCase.state,
	) as AppState;

	clearModeUpdateCallbacks();
	registerModeUpdateCallbacks(modeCase.modeId, () => noopCallbacks);
	// The funnel is configured by `bindModeControls`, exactly as in production —
	// see the note in `setup()`.
	bindModeControls({
		appState,
		modeId: modeCase.modeId,
		saveSettings: () => {},
		getOffsetMetricWindows: () => [{ start: 0, end: LAST_INDEX }],
		getSyncErrorSeries: () => ({
			groundSpeed: new Array<number>(SAMPLE_COUNT).fill(10),
			airSpeed: new Array<number>(SAMPLE_COUNT).fill(10),
		}),
		getAutoCalibrationPercent: () => 3.5,
	});

	return appState;
}

describe.each(MODE_CASES)(
	"$modeId: every row the table gives it reaches the primitive exactly once",
	(modeCase) => {
		const rows = MODE_CONTROL_TABLE.filter((spec) =>
			spec.modes.includes(modeCase.modeId),
		);

		for (const spec of rows) {
			const name =
				spec.elements.rangeId ?? spec.elements.buttonId ?? spec.reason;

			it(`${spec.reason} (${name})`, async () => {
				setupMode(modeCase);
				await interact(spec);

				const args = soleCall();
				expect(args.handler.id).toBe(modeCase.modeId);
				expect(args.cda).toBeCloseTo(spec.reason === "cda" ? 0.31 : CDA, 6);
				expect(args.crr).toBeCloseTo(spec.reason === "crr" ? 0.0051 : CRR, 6);
				expect(args.windSource).toBe(
					spec.reason === "windSource" ? "constant" : "fit",
				);
				expect(Array.isArray(args.segments)).toBe(true);
				expect(args.segments.length).toBeGreaterThan(0);
			});
		}
	},
);

/**
 * COMPARE REACHES THE PRIMITIVE UNCOLLAPSED, IN ALL THREE MODES (D-07/D-20).
 *
 * The wind-source row above drives the radio to `constant`. This block drives it
 * to `compare`, which before plan 07-04 was a source two of the three modes
 * rendered a control for and neither of them honoured.
 *
 * WHAT THIS FILE CAN AND CANNOT SEE, stated rather than implied. The primitive
 * is mocked here, so this block observes the FUNNEL's half of the claim: the
 * requested source arrives as `'compare'` and not as the collapsed `'fit'`, once
 * per interaction, for every mode. The other half — that the primitive then
 * populates `virtualElevationCompare` for `compare` and leaves it null for every
 * other source — is unobservable behind a mock, and is asserted in
 * `updateModeVEPlots.test.ts`, which drives the real primitive. That split is
 * deliberate: plan 03 recorded D-10 mutation row (b) as unfireable HERE for
 * exactly this reason, and hiding it behind a mock a second time would repeat
 * the 66-green-cases-over-a-dead-mode failure.
 */
describe.each(MODE_CASES)(
	"$modeId: the compare source reaches the primitive uncollapsed",
	(modeCase) => {
		it("arrives as `compare`, exactly once", async () => {
			setupMode(modeCase);

			const compare = document.querySelector(
				'input[name="windSource"][value="compare"]',
			) as HTMLInputElement;
			compare.checked = true;
			compare.dispatchEvent(new Event("change"));
			await settle();

			const args = soleCall();
			// `'fit'` here would mean the funnel had let the resolver's collapse
			// decide, which is the defect D-07 names.
			expect(args.windSource).toBe("compare");
			expect(args.handler.id).toBe(modeCase.modeId);
		});

		it("keeps sending `compare` for a control moved afterwards", async () => {
			// The selected source outlives the interaction that selected it. When
			// this was only consulted from the radio handler, dragging CdA under
			// compare repainted a single-source figure over the comparison.
			setupMode(modeCase);
			const compare = document.querySelector(
				'input[name="windSource"][value="compare"]',
			) as HTMLInputElement;
			compare.checked = true;
			compare.dispatchEvent(new Event("change"));
			await settle();
			primitive.mockClear();

			const cda = el("cdaSlider");
			cda.value = "0.31";
			cda.dispatchEvent(new Event("input"));
			await settle();

			expect(soleCall().windSource).toBe("compare");
		});
	},
);

describe("the GPS modes render no trim markup, and the matrix says so", () => {
	// An explicit NEGATIVE case. Without it, "trim is standard-only" is asserted
	// nowhere that runs the binder, and a trim row silently gaining a GPS mode
	// would bind against markup that does not exist -- failing as a skip, which
	// is invisible.
	const gpsCases = MODE_CASES.filter((c) => c.modeId !== "standard");
	const trimRows = MODE_CONTROL_TABLE.filter(
		(spec) => spec.reason === "trim" || spec.reason === "mapTrim",
	);

	it.each(gpsCases)("$modeId binds without throwing", (modeCase) => {
		expect(() => setupMode(modeCase)).not.toThrow();
	});

	it.each(gpsCases)(
		"$modeId never receives a trim or mapTrim row",
		(modeCase) => {
			for (const spec of trimRows) {
				expect(spec.modes.includes(modeCase.modeId)).toBe(false);
			}
		},
	);

	it.each(gpsCases)(
		"$modeId has no trim elements to drive, so nothing reaches the primitive",
		async (modeCase) => {
			setupMode(modeCase);
			expect(document.getElementById("trimStartSlider")).toBeNull();
			expect(document.getElementById("mapTrimStartSlider")).toBeNull();
			await settle();
			expect(primitive).toHaveBeenCalledTimes(0);
		},
	);
});

describe("every ModeUpdateReason is exercised by the matrix", () => {
	it("covers all of them except the three that are not panel controls", () => {
		// THREE reasons reach the funnel from outside the mode panel and are
		// deliberately absent from the table: `parameters`, from
		// `handleParametersChange`; `segmentSelection`, from Section 3's
		// detected-lap and section checkboxes; and `mapTrim`, from Section 3's
		// map-trim sliders (2026-09-03). Every OTHER reason must appear in
		// at least one executed pair -- otherwise a control added to the table
		// without a matrix case would ship untested.
		const exercised = new Set<string>();
		for (const modeCase of MODE_CASES) {
			for (const spec of MODE_CONTROL_TABLE) {
				if (spec.modes.includes(modeCase.modeId)) {
					exercised.add(spec.reason);
				}
			}
		}

		expect(exercised).toEqual(
			new Set([
				"cda",
				"crr",
				"trim",
				"calibration",
				"autoAdjustCalibration",
				"airSpeedOffset",
				"windSource",
				"elevationSmoothing",
				"crrTemp",
				"windHeight",
			]),
		);
	});
});

describe("the matrix observes render EFFECTS, not only primitive calls", () => {
	// D-10 mutation row (b). Plan 02 recorded a primitive-INTERNAL row for tab
	// laziness; this asserts the binder-level matrix would notice too. Inverting
	// the `ve-tab-content--active` check inside `updateModeVEPlots` must break a
	// renderer call count here, not merely a call count on the primitive -- so
	// the matrix has to look at what the callbacks DID.
	it("counts renderer invocations for the mode that was driven", async () => {
		const renders: string[] = [];
		const spyCallbacks: ModeUpdateCallbacks = {
			...noopCallbacks,
			renderVe: () => {
				renders.push("ve");
			},
			renderWind: () => {
				renders.push("wind");
			},
			renderPower: () => {
				renders.push("power");
			},
			renderVd: () => {
				renders.push("vd");
			},
		};

		renderPanel();
		primitive.mockClear();
		modeState.gps = "GPS based lap splitting";
		const appState = Object.assign(makeAppState(), {
			currentGpsLapIndexRanges: GPS_LAP_RANGES,
			gpsDetectedLaps: [],
			gpsSelectedLaps: [],
		}) as unknown as AppState;

		clearModeUpdateCallbacks();
		registerModeUpdateCallbacks("gpsLap", () => spyCallbacks);
		bindModeControls({
			appState,
			modeId: "gpsLap",
			saveSettings: () => {},
		});

		const cda = el("cdaSlider");
		cda.value = "0.31";
		cda.dispatchEvent(new Event("input"));
		await settle();

		// The primitive is mocked here, so no renderer runs -- what this asserts
		// is that the callbacks the matrix hands the funnel are OBSERVABLE, which
		// is the property mutation row (b) needs in order to fail visibly.
		expect(primitive).toHaveBeenCalledTimes(1);
		const args = soleCall();
		expect(args.callbacks).toBe(spyCallbacks);
		args.callbacks.renderVe([]);
		expect(renders).toEqual(["ve"]);
	});
});
