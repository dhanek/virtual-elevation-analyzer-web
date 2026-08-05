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
import {
	configureModeUpdateRequests,
	resetModeUpdateRequests,
} from "./requestModeUpdate";

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

			<input type="range" id="windHeightSlider" min="0.2" max="1.2" step="0.01" value="1">
			<input type="number" id="windHeightValue" value="1">
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
	configureModeUpdateRequests({ appState });

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
				"mapTrim",
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
		expect(new Set(modesFor("mapTrim"))).toEqual(new Set(["standard"]));
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
		expect(standardRows.length).toBe(13);
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

	it("drives the same segment trim from the map's twin slider", async () => {
		setup();
		const slider = el("mapTrimStartSlider");
		slider.value = "60";
		slider.dispatchEvent(new Event("input"));
		await settle();

		const args = soleCall();
		expect(args.segments[0].trim).toEqual({ start: 60, end: LAST_INDEX });
		// The main slider follows, because they are two faces of one control.
		expect(el("trimStartSlider").value).toBe("60");
	});

	it("parks the sliders and SKIPS the update when the minimum window clamps", async () => {
		setup();
		const slider = el("trimStartSlider");
		// Well inside the 30-sample minimum window.
		slider.value = (LAST_INDEX - 5).toString();
		slider.dispatchEvent(new Event("input"));
		await settle();

		expect(primitive).not.toHaveBeenCalled();
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
	const K_DRAG = ["0.55", "0.6", "0.65"] as const;

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
