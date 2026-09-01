/**
 * @vitest-environment jsdom
 *
 * AUTO-CONVERGE'S DOM HALF: the driven write-back and the lock controls.
 *
 * The reentrancy claim is the load-bearing one. When a lock is on, every pass
 * resolves the driven slider value and the funnel writes it into the range
 * and number inputs AFTER its await. That write must not re-arm the
 * recompute: `syncRangeAndNumber` listens on the range's `input` and the
 * number's `change`, neither of which fires on a programmatic `.value`
 * assignment — so one drag is exactly one pass, with no flags and no guards.
 * If someone "helpfully" adds a `dispatchEvent` to `drivenControls.ts`, the
 * first case here is the thing that fails.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const primitive = vi.fn();

vi.mock("./updateModeVEPlots", () => ({
	updateModeVEPlots: (args: Record<string, unknown>) => primitive(args),
}));

import type { AutoConvergeResolution } from "../../analysis/AutoConverge";
import type { AppState } from "../../state/AppState";
import {
	bindAutoConvergeLocks,
	ensureAutoConvergeState,
	syncAutoConvergeControlState,
} from "../ve/autoConvergeLocks";
import { bindModeControls } from "./bindModeControls";
import {
	clearModeUpdateCallbacks,
	registerModeUpdateCallbacks,
} from "./modeUpdateCallbacks";
import { resetModeUpdateRequests } from "./requestModeUpdate";
import type { ModeUpdateCallbacks } from "../../modes/analysis/types";

const SAMPLE_COUNT = 400;

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
		currentLaps: [{ start_time: 0, end_time: SAMPLE_COUNT - 1 }],
		selectedLaps: [1],
		currentAnalyzedLaps: [1],
		airSpeedCalibrationPercent: 0,
		activeDisplayProfile: "fit-raw",
		isCalculatingAutoRho: false,
		autoConverge: { enabled: true, cdaLocked: false, crrLocked: true },
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
	renderConvergence: () => {},
	renderMetrics: () => {},
};

function renderPanel(): void {
	document.body.innerHTML = `
		<div id="veAnalysisSection">
			<input type="range" id="cdaSlider" min="0.1" max="0.5" step="0.001" value="0.27">
			<input type="number" id="cdaValue" value="0.270">
			<input type="range" id="crrSlider" min="0.001" max="0.02" step="0.0001" value="0.0060">
			<input type="number" id="crrValue" value="0.0060">
			<div id="autoConvergeLocks" hidden>
				<input type="checkbox" id="cdaLockToggle">
				<input type="checkbox" id="crrLockToggle">
				<div id="autoConvergeStatus" hidden></div>
			</div>
			<label><input type="radio" name="windSource" value="fit" checked></label>
		</div>
	`;
}

/** An outcome whose pass drove Crr to 0.0042. */
function drivenOutcome(overrides: Partial<AutoConvergeResolution> = {}) {
	return {
		inputs: { cda: 0.27, crr: 0.0042 },
		profiles: [],
		aggregate: noopCallbacks.aggregate([]),
		autoConverge: {
			cda: 0.27,
			crr: 0.0042,
			drivenCda: false,
			drivenCrr: true,
			status: "ok",
			reason: null,
			...overrides,
		},
	};
}

function el(id: string): HTMLInputElement {
	return document.getElementById(id) as HTMLInputElement;
}

async function settle(): Promise<void> {
	await vi.advanceTimersByTimeAsync(500);
}

let saveSettings: ReturnType<typeof vi.fn>;

beforeEach(() => {
	vi.useFakeTimers();
	primitive.mockClear();
	primitive.mockResolvedValue(drivenOutcome());
	resetModeUpdateRequests();
	clearModeUpdateCallbacks();
	renderPanel();
	registerModeUpdateCallbacks("standard", () => noopCallbacks);
	saveSettings = vi.fn();
	bindModeControls({
		appState: makeAppState(),
		modeId: "standard",
		saveSettings,
	});
});

afterEach(() => {
	vi.useRealTimers();
});

describe("the driven write-back", () => {
	it("writes the driven Crr into both inputs and fires NO second pass", async () => {
		const cda = el("cdaSlider");
		cda.value = "0.28";
		cda.dispatchEvent(new Event("input"));
		await settle();

		// One drag, one pass — the programmatic write re-armed nothing.
		expect(primitive).toHaveBeenCalledTimes(1);
		expect(el("crrSlider").value).toBe("0.0042");
		expect(el("crrValue").value).toBe("0.0042");
		// The dragged pair is untouched.
		expect(el("cdaSlider").value).toBe("0.28");
	});

	it("re-runs the mode's saveSettings when a driven value changed", async () => {
		const cda = el("cdaSlider");
		cda.value = "0.28";
		cda.dispatchEvent(new Event("input"));
		await settle();

		// Once from the cda row's own persistsSettings at interaction time,
		// once more because the pass wrote a stale-persisted Crr.
		expect(saveSettings).toHaveBeenCalledTimes(2);
	});

	it("stops writing (and re-saving) once the solve is settled", async () => {
		el("crrSlider").value = "0.0042";
		el("crrValue").value = "0.0042";
		const cda = el("cdaSlider");
		cda.value = "0.28";
		cda.dispatchEvent(new Event("input"));
		await settle();

		// Values already match the solve: nothing written, only the row's save.
		expect(saveSettings).toHaveBeenCalledTimes(1);
	});

	it("surfaces an underdetermined refusal on the status line, sliders untouched", async () => {
		primitive.mockResolvedValue(
			drivenOutcome({
				drivenCrr: false,
				status: "underdetermined",
				reason: "The ridge is flat — closure error alone cannot separate CdA from Crr.",
			}),
		);
		const cda = el("cdaSlider");
		cda.value = "0.28";
		cda.dispatchEvent(new Event("input"));
		await settle();

		expect(el("crrSlider").value).toBe("0.0060");
		const status = document.getElementById("autoConvergeStatus")!;
		expect(status.hidden).toBe(false);
		expect(status.textContent).toContain("ridge is flat");
	});
});

describe("the lock controls", () => {
	it("a locked slider pair is disabled; unlocking releases it", () => {
		const appState = makeAppState();
		syncAutoConvergeControlState(appState);
		expect(el("crrSlider").disabled).toBe(true);
		expect(el("crrValue").disabled).toBe(true);
		expect(el("cdaSlider").disabled).toBe(false);

		appState.autoConverge.crrLocked = false;
		syncAutoConvergeControlState(appState);
		expect(el("crrSlider").disabled).toBe(false);
	});

	it("the block hides when auto-converge is off, and its state survives", () => {
		const appState = makeAppState();
		syncAutoConvergeControlState(appState);
		expect(document.getElementById("autoConvergeLocks")!.hidden).toBe(false);
		expect(el("crrLockToggle").checked).toBe(true);

		appState.autoConverge.enabled = false;
		syncAutoConvergeControlState(appState);
		expect(document.getElementById("autoConvergeLocks")!.hidden).toBe(true);
		// Disabled is released with the feature off — the sliders are the
		// user's again even though the lock preference is remembered.
		expect(el("crrSlider").disabled).toBe(false);
		expect(appState.autoConverge.crrLocked).toBe(true);
	});

	it("clicking a lock writes the state and reports the change", () => {
		const appState = makeAppState();
		const changes: number[] = [];
		expect(bindAutoConvergeLocks(appState, () => changes.push(1))).toBe(true);

		const cdaLock = el("cdaLockToggle");
		cdaLock.checked = true;
		cdaLock.dispatchEvent(new Event("change"));

		expect(appState.autoConverge.cdaLocked).toBe(true);
		expect(changes).toHaveLength(1);
		expect(el("cdaSlider").disabled).toBe(true);
	});

	it("ensureAutoConvergeState creates the state on bare test doubles", () => {
		const bare = {} as AppState;
		const state = ensureAutoConvergeState(bare);
		expect(state).toEqual({ enabled: false, cdaLocked: false, crrLocked: false });
		expect(ensureAutoConvergeState(bare)).toBe(state);
	});
});
