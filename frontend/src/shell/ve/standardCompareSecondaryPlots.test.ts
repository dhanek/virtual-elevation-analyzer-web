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
 * `updateModeVEPlots` — but `compare` deliberately does NOT go through that
 * primitive until plan 07-04 (D-20). The result was that in compare mode those
 * three tabs stopped updating on ANY interaction, and the tab render map still
 * held the closures registered by the last NON-compare update, so activating a
 * tab repainted stale non-compare data.
 *
 * These tests drive the REAL `updateStandardComparePlots` through its real
 * compare branch, its real wind resolution and the real `setupTabSwitching`
 * module. Only the WASM calculator is mocked, and only because a node test
 * cannot instantiate it — a rewrite of the compare branch to junk fails here.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../analysis/VeCalculatorFactory", () => ({
	createVeCalculator: (input: any) => {
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

import { AppState } from "../../state/AppState";
import { createAnalysisInput } from "../../analysis/AnalysisInput";
import { setupTabSwitching } from "../dom/tabs";
import { updateStandardComparePlots } from "./bindStandardSliders";

const SAMPLE_COUNT = 120;
const TRIM_START = 0;
const TRIM_END = SAMPLE_COUNT - 1;

/** Every `Plotly.react` call, in order: [divId, data]. */
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
	} as any;
	appState.airSpeedCalibrationPercent = 5;
	return appState;
}

function analysisInputFor(appState: AppState) {
	const fit = appState.currentFitData as any;
	return createAnalysisInput({
		timestamps: fit.timestamps,
		power: fit.power,
		velocity: fit.velocity,
		positionLat: fit.position_lat,
		positionLong: fit.position_long,
		altitude: fit.altitude,
		distance: fit.distance,
		windSpeed: fit.air_speed,
	});
}

const SELECTED_INDICES = Array.from({ length: SAMPLE_COUNT }, (_, i) => i);

/**
 * Render just enough of the VE panel for the compare branch: the two sliders it
 * reads, the three tab contents it checks for the active class, and one tab
 * button so `setupTabSwitching` has something to bind.
 */
function renderPanel(activeTabId: string | null): void {
	document.body.innerHTML = `
		<input id="cdaSlider" type="range" value="0.3">
		<input id="crrSlider" type="range" value="0.005">
		<button class="ve-tab-button" data-tab="wind">Wind</button>
		<div class="ve-tab-content" id="wind-tab"></div>
		<div class="ve-tab-content" id="power-tab"></div>
		<div class="ve-tab-content" id="vd-tab"></div>
		<span id="r2Value"></span>
		<span id="rmseValue"></span>
		<span id="veGainValue"></span>
		<span id="actualGainValue"></span>
	`;
	if (activeTabId) {
		document
			.getElementById(activeTabId)
			?.classList.add("ve-tab-content--active");
	}
}

function drawnIds(): string[] {
	return reactCalls.map((call) => call.id);
}

beforeEach(() => {
	reactCalls.length = 0;
	// Reset the module-level render map between cases.
	setupTabSwitching({});
	(globalThis as any).Plotly = {
		react: (id: string, data: any[]) => {
			reactCalls.push({ id, data });
		},
		newPlot: (id: string, data: any[]) => {
			reactCalls.push({ id, data });
		},
	};
});

async function runCompareUpdate(): Promise<AppState> {
	const appState = makeAppState();
	await updateStandardComparePlots(
		appState,
		analysisInputFor(appState),
		SELECTED_INDICES,
		TRIM_START,
		TRIM_END,
	);
	return appState;
}

describe("Standard compare refreshes the active secondary tab", () => {
	it("draws the VD plot when the VD tab is active", async () => {
		renderPanel("vd-tab");
		await runCompareUpdate();

		// The compare branch always draws the two VE figures.
		expect(drawnIds()).toContain("vePlot");
		expect(drawnIds()).toContain("veResidualsPlot");
		// The regression: this was absent entirely after Task 4.
		expect(drawnIds()).toContain("vdPlot");
	});

	it("draws the wind plot from the RESOLVED fit series when the wind tab is active", async () => {
		renderPanel("wind-tab");
		await runCompareUpdate();

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
			wind!.data.some(
				(trace: any) => trace.name === "Apparent (Constant Wind)",
			),
		).toBe(false);
	});

	it("draws the power plot when the power tab is active", async () => {
		renderPanel("power-tab");
		await runCompareUpdate();

		expect(drawnIds()).toContain("speedPowerPlot");
	});

	it("skips all three secondary plots when no tab is active (D-14 laziness)", async () => {
		renderPanel(null);
		await runCompareUpdate();

		expect(drawnIds()).toContain("vePlot");
		expect(drawnIds()).not.toContain("windSpeedPlot");
		expect(drawnIds()).not.toContain("speedPowerPlot");
		expect(drawnIds()).not.toContain("vdPlot");
	});
});

describe("Standard compare re-registers the tab render map", () => {
	it("replaces a stale non-compare wind callback, so activation draws compare data", async () => {
		renderPanel(null);

		// Stand in for the map a previous NON-compare update registered. Before
		// the fix this survived the compare update, so clicking Wind repainted
		// data computed from the fit-only path.
		const staleWind = vi.fn();
		setupTabSwitching({ wind: staleWind });

		await runCompareUpdate();

		const windButton = document.querySelector(
			'.ve-tab-button[data-tab="wind"]',
		) as HTMLElement;
		windButton.click();

		expect(staleWind).not.toHaveBeenCalled();
		expect(drawnIds()).toContain("windSpeedPlot");
	});
});
