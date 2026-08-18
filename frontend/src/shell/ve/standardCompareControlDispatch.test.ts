// @vitest-environment jsdom
/**
 * REGRESSION GUARD — under `compare`, a CONTROL must recompute the comparison,
 * not replace it with a single-source plot.
 *
 * Reported against 6873e17: with "Compare both methods" selected, dragging the
 * wind-height k slider made the constant-wind trace vanish from the VE plot.
 *
 * Before plan 07-03 Task 1, every Standard control called `updateVEPlots`, which
 * re-read the wind source INSIDE its scheduled run and dispatched on it — so any
 * control interacted with under compare re-rendered the compare figure. Task 1
 * moved the controls onto `requestModeUpdate`, which has no compare branch, and
 * left the compare path reachable only from the wind-source RADIO. So every
 * other control silently downgraded compare to a single-source render.
 *
 * k is the control that makes this most visible — it scales the constant-wind
 * leg, so it is exactly the leg that disappeared — but the defect was never
 * specific to k, and this file asserts that by covering CdA on the same path.
 *
 * The mock calculator encodes its input so the assertions can tell the two legs
 * apart and can see k: the constant leg (all-NaN wind series) ramps at the
 * applied height factor, the FIT leg ramps downward. A compare render therefore
 * produces a 'VE (Constant Wind)' trace whose slope IS k.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../analysis/VeCalculatorFactory", () => ({
	createVeCalculator: (input: any) => {
		const n = input.timestamps.length;
		const isConstantLeg = Array.from(input.windSpeed as number[]).every(
			(value) => Number.isNaN(value),
		);
		const k = input.params?.wind_height_factor ?? 1;
		const ve = new Float64Array(n);
		for (let i = 0; i < n; i++) {
			ve[i] = isConstantLeg ? i * k : i * -1;
		}
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

import { AppState } from "../../state/AppState";
import { configureParameterMerge } from "../analysis/parametersSync";
import { clearModeUpdateCallbacks } from "../analysis/modeUpdateCallbacks";
import { RECOMPUTE_THROTTLE_MS } from "../analysis/recomputeRunner";
import { resetModeUpdateRequests } from "../analysis/requestModeUpdate";
import { setupTabSwitching } from "../dom/tabs";
import { setupVESliders } from "./bindStandardSliders";

const SAMPLE_COUNT = 120;
const INITIAL_K = 0.5;
const NEW_K = 0.75;

/** Every `Plotly.react` / `newPlot` call, in order. */
const reactCalls: Array<{ id: string; data: any[] }> = [];

function makeFitData() {
	const timestamps = Array.from({ length: SAMPLE_COUNT }, (_, i) => i);
	return {
		timestamps,
		power: timestamps.map(() => 200),
		velocity: timestamps.map(() => 10),
		position_lat: timestamps.map((i) => 45 + i * 1e-5),
		position_long: timestamps.map((i) => -30 + i * 1e-5),
		altitude: timestamps.map(() => 100),
		distance: timestamps.map((i) => i * 10),
		air_speed: timestamps.map(() => 9),
		wind_speed: timestamps.map(() => 0),
		wind_yaw: timestamps.map(() => 0),
		air_density_data: timestamps.map(() => 0),
		road_speed: timestamps.map(() => 0),
		temperature: timestamps.map(() => 16),
		record_count: SAMPLE_COUNT,
	} as any;
}

function makeAppState(): AppState {
	const appState = new AppState();
	appState.currentFitData = makeFitData();
	appState.currentParameters = {
		system_mass: 80,
		rho: 1.2,
		eta: 0.98,
		cda: 0.3,
		crr: 0.005,
		cda_min: 0.15,
		cda_max: 0.5,
		crr_min: 0.002,
		crr_max: 0.02,
		wind_speed: 3,
		wind_direction: 0,
		wind_entry: "weather",
		wind_height_factor: INITIAL_K,
		velodrome: false,
		air_speed_offset: 2,
		auto_calculate_rho: false,
	} as any;
	appState.airSpeedCalibrationPercent = 0;
	appState.presetTrimStart = 0;
	appState.presetTrimEnd = SAMPLE_COUNT - 1;
	// One selected lap spanning the whole activity. Without this the NON-compare
	// path bails on "no valid segments" and draws nothing at all, which would let
	// the assertions below pass on an empty plot rather than on a wrong one — the
	// vacuous-guard trap this phase has already hit three times.
	appState.currentLaps = [{ start_time: 0, end_time: SAMPLE_COUNT - 1 }] as any;
	// Lap NUMBERS, 1-based: standardMode.prepareSelection indexes currentLaps[n-1].
	appState.selectedLaps = [1];
	appState.currentAnalyzedLaps = [1];
	return appState;
}

/**
 * The Standard panel, reduced to what `setupVESliders` reads: the four
 * range/number pairs it hard-requires, the wind-source radios, the k block, and
 * the VE section wrapper the funnel's visibility check looks for.
 */
function renderPanel(): void {
	document.body.innerHTML = `
		<div id="veAnalysisSection">
			<input id="trimStartSlider" type="range" min="0" max="119" value="0">
			<input id="trimStartValue" type="number" value="0">
			<input id="trimEndSlider" type="range" min="0" max="119" value="119">
			<input id="trimEndValue" type="number" value="119">
			<input id="cdaSlider" type="range" min="0.15" max="0.5" step="0.001" value="0.3">
			<input id="cdaValue" type="number" value="0.300">
			<input id="crrSlider" type="range" min="0.002" max="0.02" step="0.0001" value="0.005">
			<input id="crrValue" type="number" value="0.0050">
			<label><input type="radio" name="windSource" value="fit"> FIT</label>
			<label><input type="radio" name="windSource" value="constant"> Constant</label>
			<label><input type="radio" name="windSource" value="compare" checked> Compare</label>
			<div class="ve-control-group" id="windHeightControls">
				<input type="range" id="windHeightSlider" min="0.1" max="1.5" step="0.01" value="${INITIAL_K}">
				<input type="number" id="windHeightValue" min="0.1" max="1.5" step="0.01" value="${INITIAL_K}">
				<div id="windHeightReadout"></div>
			</div>
			<div class="ve-tab-content" id="wind-tab"></div>
			<div class="ve-tab-content" id="power-tab"></div>
			<div class="ve-tab-content" id="vd-tab"></div>
			<span id="r2Value"></span>
			<span id="rmseValue"></span>
			<span id="veGainValue"></span>
			<span id="actualGainValue"></span>
		</div>
	`;
}

function bindPanel(appState: AppState): void {
	const fit = appState.currentFitData as any;
	setupVESliders(
		appState,
		null,
		{} as any,
		null,
		() => {},
		fit.timestamps,
		fit.velocity,
		fit.position_lat,
		fit.position_long,
		fit.air_speed,
		0,
	);
}

/**
 * Let the scheduled run settle. Real timers, so this must outwait the uniform
 * recompute throttle interval (D-15) before flushing the run's own turns — reading the
 * constant rather than a literal keeps it correct when plan 04 ratifies a value.
 */
async function settle(): Promise<void> {
	await new Promise((resolve) =>
		setTimeout(resolve, RECOMPUTE_THROTTLE_MS + 10),
	);
	for (let i = 0; i < 5; i++) {
		await new Promise((resolve) => setTimeout(resolve, 0));
	}
}

function lastVePlotData(): any[] | null {
	for (let i = reactCalls.length - 1; i >= 0; i--) {
		if (reactCalls[i].id === "vePlot") return reactCalls[i].data;
	}
	return null;
}

function traceNames(data: any[] | null): string[] {
	return (data ?? []).map((trace) => trace.name);
}

beforeEach(() => {
	reactCalls.length = 0;
	setupTabSwitching({});
	clearModeUpdateCallbacks();
	resetModeUpdateRequests();
	(globalThis as any).Plotly = {
		react: (id: string, data: any[]) => {
			reactCalls.push({ id, data });
		},
		newPlot: (id: string, data: any[]) => {
			reactCalls.push({ id, data });
		},
	};
});

afterEach(() => {
	configureParameterMerge(null);
	clearModeUpdateCallbacks();
	resetModeUpdateRequests();
});

describe("Standard compare survives a control interaction", () => {
	it("keeps the constant-wind trace and recomputes it when k changes", async () => {
		const appState = makeAppState();
		configureParameterMerge((fields) => {
			Object.assign(appState.currentParameters as any, fields);
		});
		renderPanel();
		bindPanel(appState);
		await settle();

		reactCalls.length = 0;

		const slider = document.getElementById(
			"windHeightSlider",
		) as HTMLInputElement;
		slider.value = NEW_K.toString();
		// `input`, not `change`: k recomputes while the thumb moves, like every
		// other slider in the panel.
		slider.dispatchEvent(new Event("input"));
		await settle();

		// The model took the new factor.
		expect((appState.currentParameters as any).wind_height_factor).toBe(NEW_K);

		const data = lastVePlotData();
		expect(data, "k change must redraw the VE plot").not.toBeNull();

		// THE REPORTED DEFECT: the constant-wind leg vanished from the plot.
		expect(traceNames(data)).toContain("VE (Constant Wind)");

		// ...and it must be the leg recomputed AT THE NEW k, not a stale redraw.
		// The mock ramps the constant leg at the applied height factor, and the
		// comparison builder offsets it to the actual elevation at the first
		// sample, so the surviving slope is exactly k.
		const constant = (data ?? []).find(
			(trace) => trace.name === "VE (Constant Wind)",
		);
		expect(constant.y[1] - constant.y[0]).toBeCloseTo(NEW_K, 10);
		expect(constant.y[1] - constant.y[0]).not.toBeCloseTo(INITIAL_K, 10);
	});

	it("keeps the constant-wind trace when a non-k control changes", async () => {
		// k is where the maintainer saw it, but the dispatch defect was never
		// k-specific: EVERY row funnelled past the compare branch.
		const appState = makeAppState();
		configureParameterMerge((fields) => {
			Object.assign(appState.currentParameters as any, fields);
		});
		renderPanel();
		bindPanel(appState);
		await settle();

		reactCalls.length = 0;

		const cda = document.getElementById("cdaSlider") as HTMLInputElement;
		cda.value = "0.32";
		cda.dispatchEvent(new Event("input"));
		await settle();

		const data = lastVePlotData();
		expect(data, "a CdA change must redraw the VE plot").not.toBeNull();
		expect(traceNames(data)).toContain("VE (Constant Wind)");
		expect(traceNames(data)).toContain("VE (FIT Air Speed)");
	});
});
