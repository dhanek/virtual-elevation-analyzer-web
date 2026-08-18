// @vitest-environment jsdom
/**
 * REGRESSION GUARD — Standard `compare` must keep refreshing its secondary tabs.
 *
 * Before phase 07, the eight Standard slider handlers called a private
 * `updateSecondaryPlots` helper AFTER `updateVEPlots`, unconditionally. That
 * helper ran for EVERY wind source, so dragging a slider in `compare` mode
 * refreshed whichever of Wind / Power / VD was on screen.
 *
 * Plan 07-02 Task 4 deleted the helper and moved its job into
 * `updateModeVEPlots` — but `compare` did NOT go through that primitive, so in
 * compare mode those three tabs stopped updating on ANY interaction, and the tab
 * render map still held the closures registered by the last NON-compare update.
 *
 * RE-POINTED by plan 07-04 Task 1. The private compare branch these tests used
 * to call directly no longer exists: compare is now resolved inside the
 * primitive and dispatched from Standard's `renderVe`. So the guard now drives
 * the WHOLE production path — `setupVESliders` binds the real table rows, a real
 * DOM interaction funnels through `requestModeUpdate`, and the real primitive
 * runs with the wind-source radio on `compare`. That is strictly more of the app
 * than the previous version exercised, and it is the only shape in which the
 * defect could still recur.
 *
 * Only the WASM calculator is mocked, and only because a node test cannot
 * instantiate it. The mock distinguishes the two legs by their wind series, so a
 * "compare" render that quietly computed the same series twice is visible here.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../analysis/VeCalculatorFactory", () => ({
	createVeCalculator: (input: any) => {
		const n = input.timestamps.length;
		// The constant leg is the all-NaN wind series `resolveWindSeries` returns
		// for 'constant'. Encoding it in the output is what lets the assertions
		// tell a real two-model comparison from the same model drawn twice.
		const isConstantLeg = Array.from(input.windSpeed as number[]).every(
			(value) => Number.isNaN(value),
		);
		const ve = new Float64Array(n);
		for (let i = 0; i < n; i++) {
			ve[i] = isConstantLeg ? i * 2 : i * -1;
		}
		return {
			calculate_virtual_elevation: () => ({
				virtual_elevation: ve,
				r2: isConstantLeg ? 0.25 : 0.5,
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
import { clearModeUpdateCallbacks } from "../analysis/modeUpdateCallbacks";
import { RECOMPUTE_THROTTLE_MS } from "../analysis/recomputeRunner";
import { resetModeUpdateRequests } from "../analysis/requestModeUpdate";
import { setupTabSwitching } from "../dom/tabs";
import { setupVESliders } from "./bindStandardSliders";

const SAMPLE_COUNT = 120;

/** Every `Plotly.react` / `newPlot` call, in order: [divId, data]. */
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
		wind_speed: 0,
		wind_direction: 0,
		velodrome: false,
		air_speed_offset: 2,
		auto_calculate_rho: false,
	} as any;
	appState.airSpeedCalibrationPercent = 5;
	appState.presetTrimStart = 0;
	appState.presetTrimEnd = SAMPLE_COUNT - 1;
	// One selected lap spanning the whole activity. Without a selection the
	// primitive bails on "no valid segments" and draws nothing, which would let
	// every assertion below pass on an empty plot instead of a wrong one.
	appState.currentLaps = [{ start_time: 0, end_time: SAMPLE_COUNT - 1 }] as any;
	appState.selectedLaps = [1];
	appState.currentAnalyzedLaps = [1];
	return appState;
}

/**
 * The Standard panel with "Compare both methods" already selected: the four
 * range/number pairs `setupVESliders` hard-requires, the wind-source radios, the
 * three tab contents the D-14 check reads, and one tab button so
 * `setupTabSwitching` has something to bind.
 */
function renderPanel(activeTabId: string | null): void {
	document.body.innerHTML = `
		<div id="veAnalysisSection">
			<input id="trimStartSlider" type="range" min="0" max="${SAMPLE_COUNT - 1}" value="0">
			<input id="trimStartValue" type="number" value="0">
			<input id="trimEndSlider" type="range" min="0" max="${SAMPLE_COUNT - 1}" value="${SAMPLE_COUNT - 1}">
			<input id="trimEndValue" type="number" value="${SAMPLE_COUNT - 1}">
			<input id="cdaSlider" type="range" min="0.15" max="0.5" step="0.001" value="0.3">
			<input id="cdaValue" type="number" value="0.300">
			<input id="crrSlider" type="range" min="0.002" max="0.02" step="0.0001" value="0.005">
			<input id="crrValue" type="number" value="0.0050">
			<label><input type="radio" name="windSource" value="fit"> FIT</label>
			<label><input type="radio" name="windSource" value="constant"> Constant</label>
			<label><input type="radio" name="windSource" value="compare" checked> Compare</label>
			<button class="ve-tab-button" data-tab="wind">Wind</button>
			<div class="ve-tab-content" id="wind-tab"></div>
			<div class="ve-tab-content" id="power-tab"></div>
			<div class="ve-tab-content" id="vd-tab"></div>
			<div id="vdHeader"></div>
			<span id="r2Value"></span>
			<span id="rmseValue"></span>
			<span id="veGainValue"></span>
			<span id="actualGainValue"></span>
		</div>
	`;
	if (activeTabId) {
		document
			.getElementById(activeTabId)
			?.classList.add("ve-tab-content--active");
	}
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
 * recompute throttle interval (D-15) before flushing the run's own turns.
 */
async function settle(): Promise<void> {
	await new Promise((resolve) =>
		setTimeout(resolve, RECOMPUTE_THROTTLE_MS + 10),
	);
	for (let i = 0; i < 5; i++) {
		await new Promise((resolve) => setTimeout(resolve, 0));
	}
}

function drawnIds(): string[] {
	return reactCalls.map((call) => call.id);
}

beforeEach(() => {
	reactCalls.length = 0;
	// Reset the module-level render map between cases.
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
	clearModeUpdateCallbacks();
	resetModeUpdateRequests();
});

/**
 * Bind the panel, then drive ONE ordinary control. A control interaction — not
 * the wind-source radio — is deliberately the trigger: the historical defect was
 * that every control except the radio funnelled past compare.
 */
async function runCompareUpdate(activeTabId: string | null): Promise<AppState> {
	renderPanel(activeTabId);
	const appState = makeAppState();
	bindPanel(appState);
	await settle();
	reactCalls.length = 0;

	const cda = document.getElementById("cdaSlider") as HTMLInputElement;
	cda.value = "0.32";
	cda.dispatchEvent(new Event("input"));
	await settle();
	return appState;
}

describe("Standard compare refreshes the active secondary tab", () => {
	it("draws the VD plot when the VD tab is active", async () => {
		await runCompareUpdate("vd-tab");

		// Compare always draws the two VE figures.
		expect(drawnIds()).toContain("vePlot");
		expect(drawnIds()).toContain("veResidualsPlot");
		// The regression: this was absent entirely after 07-02 Task 4.
		expect(drawnIds()).toContain("vdPlot");
	});

	it("draws the wind plot from the RESOLVED fit series when the wind tab is active", async () => {
		await runCompareUpdate("wind-tab");

		const wind = reactCalls.find((call) => call.id === "windSpeedPlot");
		expect(wind).toBeDefined();
		// Compare's fit leg is what carries wind, so it belongs in the FIT
		// channel — not blanked, and not in the constant-wind channel.
		const fitTrace = wind!.data.find(
			(trace: any) => trace.name === "Apparent (FIT Air)",
		);
		expect(fitTrace).toBeDefined();
		expect(fitTrace.y.some((value: number | null) => value !== null)).toBe(true);
		expect(
			wind!.data.some((trace: any) => trace.name === "Apparent (Constant Wind)"),
		).toBe(false);
	});

	it("draws the power plot when the power tab is active", async () => {
		await runCompareUpdate("power-tab");

		expect(drawnIds()).toContain("speedPowerPlot");
	});

	it("skips all three secondary plots when no tab is active (D-14 laziness)", async () => {
		await runCompareUpdate(null);

		expect(drawnIds()).toContain("vePlot");
		expect(drawnIds()).not.toContain("windSpeedPlot");
		expect(drawnIds()).not.toContain("speedPowerPlot");
		expect(drawnIds()).not.toContain("vdPlot");
	});
});

describe("Standard compare re-registers the tab render map", () => {
	it("replaces a stale non-compare wind callback, so activation draws compare data", async () => {
		renderPanel(null);
		const appState = makeAppState();
		bindPanel(appState);
		await settle();

		// Stand in for the map a previous NON-compare update registered. Before
		// the fix this survived the compare update, so clicking Wind repainted
		// data computed from the fit-only path.
		const staleWind = vi.fn();
		setupTabSwitching({ wind: staleWind });
		reactCalls.length = 0;

		const cda = document.getElementById("cdaSlider") as HTMLInputElement;
		cda.value = "0.32";
		cda.dispatchEvent(new Event("input"));
		await settle();

		const windButton = document.querySelector(
			'.ve-tab-button[data-tab="wind"]',
		) as HTMLElement;
		windButton.click();

		expect(staleWind).not.toHaveBeenCalled();
		expect(drawnIds()).toContain("windSpeedPlot");
	});
});

/**
 * The compare figure itself, through the production path.
 *
 * The pre-07-04 version of this file could not assert this: it called the
 * private branch directly, so "compare reaches the user" was never the claim
 * under test. It is now, and it is the claim the whole plan rests on — D-07
 * exists because in two of three modes the radio lied.
 */
describe("Standard compare renders two genuinely different series", () => {
	it("draws both legs, with the constant leg computed from a different wind series", async () => {
		await runCompareUpdate(null);

		const vePlot = reactCalls.filter((call) => call.id === "vePlot").pop();
		expect(vePlot).toBeDefined();

		const names = vePlot!.data.map((trace: any) => trace.name);
		expect(names).toEqual([
			"VE (FIT Air Speed)",
			"Actual Elevation",
			"VE (Constant Wind)",
		]);

		const fit = vePlot!.data.find(
			(trace: any) => trace.name === "VE (FIT Air Speed)",
		);
		const constant = vePlot!.data.find(
			(trace: any) => trace.name === "VE (Constant Wind)",
		);
		// The mock ramps the constant leg at +2 and the fit leg at -1, and the
		// comparison builder anchors both on the same actual-elevation sample, so
		// the surviving slopes are the two legs' own. Identical slopes would mean
		// the same wind series had been handed to both calculators — which is
		// exactly what `resolveWindSeries`' 'compare' -> 'fit' collapse would do
		// if the primitive had passed 'compare' straight through.
		expect(constant.y[1] - constant.y[0]).toBeCloseTo(2, 10);
		expect(fit.y[1] - fit.y[0]).toBeCloseTo(-1, 10);
	});

	it("records the requested source as `compare`, not as the collapsed `fit`", async () => {
		const appState = await runCompareUpdate(null);
		expect(appState.currentWindSource).toBe("compare");
	});
});
