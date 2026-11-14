/**
 * @vitest-environment jsdom
 *
 * THE "THIS SELECTION ONLY" SWITCH, THROUGH THE REAL BINDER, in both GPS modes
 * (Standard's is in `standardModeRealChain.test.ts`). Same pattern as
 * `syncErrorReadoutBinding.test.ts`: the mode's real template and real
 * setup function; only storage is in memory. Guards the wiring as well as the
 * behaviour: a renderer that stopped passing `persistCalibration` or
 * `setCalibrationScope` fails here.
 */
import { beforeEach, describe, expect, it } from "vitest";
import type { AnalysisParameters } from "../../components/AnalysisParameters";
import type { AppState } from "../../state/AppState";
import type { ParameterStorage } from "../../utils/ParameterStorage";
import type { ShellServices } from "./types";
import {
	setupGpsLapSliderHandlers,
	buildGpsLapVeAnalysisTemplate,
} from "../gpsLap/renderGpsLap";
import {
	setupOutAndBackSliderSync,
	buildOutAndBackVeAnalysisTemplate,
} from "../outAndBack/renderOutAndBack";
import { elevationSmoothingToggleMarkup } from "./elevationProfileCycle";
import { resetModeUpdateRequests } from "./requestModeUpdate";

/** Let the stores' promise chains settle. */
const flushPromises = () => new Promise((resolve) => setTimeout(resolve, 0));

const LAG = 2;
const N = 120;
const HALF = N / 2;

const params = {
	cda: 0.25,
	cda_min: 0.1,
	cda_max: 0.5,
	crr: 0.0042,
	crr_min: 0.001,
	crr_max: 0.02,
	air_speed_offset: LAG,
	wind_speed: 3,
	wind_direction: 90,
	wind_height_factor: 1,
} as unknown as AnalysisParameters;

function laggedRide() {
	const timestamps = Array.from({ length: N }, (_, i) => 1000 + i);
	const velocity = timestamps.map((_, i) => 8 + 2 * Math.sin(i / 3));
	// The sensor reports LAG seconds late: sample i holds what happened at i-LAG.
	const air_speed = velocity.map((_, i) => velocity[Math.max(0, i - LAG)]);
	const zeros = () => new Array<number>(N).fill(0);
	return {
		timestamps,
		power: zeros().map(() => 200),
		velocity,
		position_lat: zeros(),
		position_long: zeros(),
		altitude: zeros(),
		distance: velocity.map((_, i) => i * 8),
		air_speed,
		wind_speed: zeros(),
		wind_yaw: zeros(),
		air_density_data: zeros(),
		road_speed: zeros(),
		temperature: zeros().map(() => 20),
		cda_reference: null,
	};
}

const SECTION = {
	sectionNumber: 1,
	outboundStartIdx: 0,
	outboundEndIdx: HALF - 1,
	inboundStartIdx: HALF,
	inboundEndIdx: N - 1,
	outboundDuration: HALF,
	inboundDuration: HALF,
	totalDistance: 1,
};

function makeAppState(): AppState {
	return {
		currentFitData: laggedRide(),
		currentParameters: { ...params },
		// What `resolveActiveGpsLapRanges` reads: two laps.
		currentGpsLapIndexRanges: [
			{ startIdx: 0, endIdx: HALF - 1 },
			{ startIdx: HALF, endIdx: N - 1 },
		],
		// What `outAndBackRanges` reads: one section, two legs.
		currentOutAndBackSections: [SECTION],
		outAndBackSections: [SECTION],
		outAndBackSelectedSections: [1],
		gpsDetectedLaps: [],
		gpsSelectedLaps: [],
		currentAnalyzedLaps: [1, 2],
		currentFileHash: "hash",
		selectedFile: { name: "ride.fit" },
		airSpeedCalibrationPercent: 0,
		airSpeedCalibrationSource: "ride",
		rideAirSpeedCalibrationPercent: 0,
		activeDisplayProfile: "fit-raw",
		demProfilesAvailable: true,
	} as unknown as AppState;
}

/** The four calls the calibration path makes, in memory. */
function makeStorage() {
	const overrides = new Map<string, number>();
	const state = { ride: undefined as number | undefined, overrides };
	// Records the mode argument it receives, so a renderer passing the wrong
	// mode fails here.
	const key = (mode: string, laps: number[]) =>
		`${mode}|${[...laps].sort((a, b) => a - b).join("-")}`;
	const storage = {
		loadAirSpeedCalibration: async (
			_h: string,
			mode: string,
			laps: number[],
		) => ({
			ride: state.ride,
			override: overrides.get(key(mode, laps)),
		}),
		saveRideAirSpeedCalibration: async (_h: string, percent: number) => {
			state.ride = percent;
		},
		saveAirSpeedCalibrationOverride: async (
			_h: string,
			mode: string,
			laps: number[],
			percent: number | null,
		) => {
			if (percent === null) overrides.delete(key(mode, laps));
			else overrides.set(key(mode, laps), percent);
		},
		saveLapSettings: async () => {},
	} as unknown as ParameterStorage;
	return { storage, state };
}

let parameterStorage: ParameterStorage;

const FLAGS = {
	hasWindSpeed: true,
	hasConstantWind: true,
	showWindTab: true,
	showVirtualDistanceTab: true,
	selectedWindSource: "fit",
	currentAirSpeedCalibrationValue: "0.0",
	defaultAirSpeedOffset: LAG,
};

const MODES = [
	{
		name: "GPS lap splitting",
		mode: "gpsLap",
		renderSidebar: (appState: AppState) =>
			buildGpsLapVeAnalysisTemplate({
				...FLAGS,
				params,
				lapCount: 2,
				elevationToggleMarkup: elevationSmoothingToggleMarkup(appState),
			}),
		bind: (appState: AppState) =>
			setupGpsLapSliderHandlers(
				appState,
				parameterStorage,
				async () => ({}),
				params,
			),
	},
	{
		name: "out-and-back",
		mode: "outAndBack",
		renderSidebar: (appState: AppState) =>
			buildOutAndBackVeAnalysisTemplate({
				...FLAGS,
				params,
				sectionCount: 1,
				elevationToggleMarkup: elevationSmoothingToggleMarkup(appState),
			}),
		bind: (appState: AppState) => {
			const services: ShellServices = {
				appState,
				showLoading: () => {},
				hideLoading: () => {},
				showError: () => {},
			};
			return setupOutAndBackSliderSync(
				services,
				parameterStorage,
				async () => ({}),
			);
		},
	},
] as const;

describe.each(MODES)(
	"$name: the calibration is stored on the ride or the selection",
	({ mode, renderSidebar, bind }) => {
		let appState: AppState;
		let state: ReturnType<typeof makeStorage>["state"];
		const el = <T extends HTMLElement>(id: string) =>
			document.getElementById(id) as T;
		const drag = async (value: number) => {
			const slider = el<HTMLInputElement>("airSpeedCalibrationSlider");
			slider.value = String(value);
			slider.dispatchEvent(new Event("input", { bubbles: true }));
			await flushPromises();
		};

		beforeEach(() => {
			resetModeUpdateRequests();
			const made = makeStorage();
			parameterStorage = made.storage;
			state = made.state;
			appState = makeAppState();
			document.body.innerHTML = `<div id="veAnalysisSection"><div id="veAnalysisContent"></div></div>`;
			document.getElementById("veAnalysisContent")!.innerHTML =
				renderSidebar(appState);
			bind(appState);
		});

		it("a calibration change sets the ride value", async () => {
			await drag(5);
			expect(state.ride).toBe(5);
			expect(state.overrides.size).toBe(0);
			expect(el("airSpeedCalibrationSource").textContent).toBe("Ride value");
			expect(el("airSpeedCalibrationUseRide").hidden).toBe(true);
		});

		it("with the switch on, a change is this selection's alone", async () => {
			await drag(5);
			const scope = el<HTMLInputElement>("airSpeedCalibrationScope");
			scope.checked = true;
			scope.dispatchEvent(new Event("change", { bubbles: true }));
			await flushPromises();
			expect(state.overrides.get(`${mode}|1-2`)).toBe(5);
			expect(el("airSpeedCalibrationSource").textContent).toBe(
				"This selection only",
			);

			await drag(0);
			expect(state.overrides.get(`${mode}|1-2`)).toBe(0);
			expect(state.ride).toBe(5);
			expect(el("airSpeedCalibrationUseRide").textContent).toBe(
				"Use ride value (+5.0 %)",
			);
		});

		it("Use ride value removes the override and shows the ride value", async () => {
			await drag(5);
			const scope = el<HTMLInputElement>("airSpeedCalibrationScope");
			scope.checked = true;
			scope.dispatchEvent(new Event("change", { bubbles: true }));
			await flushPromises();
			await drag(2);

			el("airSpeedCalibrationUseRide").click();
			await flushPromises();

			expect(state.overrides.has(`${mode}|1-2`)).toBe(false);
			expect(appState.airSpeedCalibrationPercent).toBe(5);
			expect(el<HTMLInputElement>("airSpeedCalibrationValue").value).toBe(
				"5.0",
			);
			expect(el<HTMLInputElement>("airSpeedCalibrationScope").checked).toBe(
				false,
			);
		});
	},
);

describe("GPS-lap renderer drawing Standard's Stacked FIT laps", () => {
	it("stores the override under Standard, not GPS-lap", async () => {
		resetModeUpdateRequests();
		const made = makeStorage();
		parameterStorage = made.storage;
		const appState = makeAppState();
		appState.currentOverlayLapNumbers = [1, 2];
		document.body.innerHTML = `<div id="veAnalysisSection"><div id="veAnalysisContent"></div></div>`;
		document.getElementById("veAnalysisContent")!.innerHTML =
			MODES[0].renderSidebar(appState);
		MODES[0].bind(appState);

		const scope = document.getElementById(
			"airSpeedCalibrationScope",
		) as HTMLInputElement;
		scope.checked = true;
		scope.dispatchEvent(new Event("change", { bubbles: true }));
		await flushPromises();

		expect(made.state.overrides.get("standard|1-2")).toBe(0);
		expect(made.state.overrides.has("gpsLap|1-2")).toBe(false);
	});
});
