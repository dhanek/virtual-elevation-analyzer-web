/**
 * @vitest-environment jsdom
 *
 * EVERY ROW A MODE CLAIMS IS ACTUALLY BOUND IN THAT MODE.
 *
 * `bindModeControls` walks `MODE_CONTROL_TABLE` and wires the rows whose
 * elements it finds. Until this file, a row whose elements were absent at bind
 * time vanished into a `log.debug` and left a dead control behind — the same
 * omission class the table exists to remove, one level down, and invisible to
 * every guard in the suite. So the binder now REPORTS what it bound, each
 * binding helper returning whether it actually attached, and this file asserts
 * the report against what the table claims.
 *
 * The point is the failure mode, not the happy path: a mode that drops from N
 * bound rows to 0 — which is precisely what shipped for both GPS modes — breaks
 * this file loudly, naming the rows.
 *
 * The sidebar is the mode's REAL template, driven through the same flag
 * arithmetic its render function uses, on a ride that has both a FIT air-speed
 * channel and a configured constant wind — the only configuration in which every
 * row of the table is renderable at all.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
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
import type { BindModeControlsResult } from "./bindModeControls";
import { controlsForMode } from "./modeControlTable";
import { resetModeUpdateRequests } from "./requestModeUpdate";

const SAMPLE_COUNT = 400;
const LAST_INDEX = SAMPLE_COUNT - 1;
const HALF = SAMPLE_COUNT / 2;

const params = {
	cda: 0.25,
	cda_min: 0.1,
	cda_max: 0.5,
	crr: 0.0042,
	crr_min: 0.001,
	crr_max: 0.02,
	air_speed_offset: 0,
	wind_speed: 3,
	wind_direction: 90,
	wind_height_factor: 1,
} as unknown as AnalysisParameters;

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
		currentGpsLapIndexRanges: [{ startIdx: 0, endIdx: LAST_INDEX }],
		currentOutAndBackSections: [SECTION],
		outAndBackSections: [SECTION],
		outAndBackSelectedSections: [1],
		gpsDetectedLaps: [],
		gpsSelectedLaps: [],
		currentAnalyzedLaps: [1],
		airSpeedCalibrationPercent: 0,
		activeDisplayProfile: "fit-raw",
		// The elevation-smoothing toggle is not emitted at all without this, so a
		// fixture that omitted it would report the row skipped — as this file did
		// on its first run, which is the guard working.
		demProfilesAvailable: true,
	} as unknown as AppState;
}

const parameterStorage = {} as unknown as ParameterStorage;

/**
 * The flags both render functions compute for a ride that has everything, so the
 * markup under test is the markup the app produces rather than a fixture written
 * to satisfy the assertion. (A fixture that supplies the very markup whose
 * absence is the defect is how this phase's four earlier vacuous guards passed.)
 */
const FLAGS = {
	hasWindSpeed: true,
	hasConstantWind: true,
	showWindTab: true,
	showVirtualDistanceTab: true,
	selectedWindSource: "fit",
	currentAirSpeedCalibrationValue: "0.0",
	defaultAirSpeedOffset: 0,
};

interface ModeUnderTest {
	name: string;
	modeId: "gpsLap" | "outAndBack";
	renderSidebar: (appState: AppState) => string;
	bind: (appState: AppState) => BindModeControlsResult;
}

const MODES: readonly ModeUnderTest[] = [
	{
		name: "GPS-lap",
		modeId: "gpsLap",
		renderSidebar: (appState) =>
			buildGpsLapVeAnalysisTemplate({
				...FLAGS,
				params,
				initialStats: { meanR2: 0.5, meanRMSE: 1, closingError: 2 },
				lapCount: 2,
				elevationToggleMarkup: elevationSmoothingToggleMarkup(appState),
			}),
		bind: (appState) =>
			setupGpsLapSliderHandlers(
				appState,
				parameterStorage,
				async () => ({}),
				params,
			),
	},
	{
		name: "out-and-back",
		modeId: "outAndBack",
		renderSidebar: (appState) =>
			buildOutAndBackVeAnalysisTemplate({
				...FLAGS,
				params,
				initialStats: { rmse: 1, avgVeGain: 2, avgActualGain: 3 },
				sectionCount: 1,
				elevationToggleMarkup: elevationSmoothingToggleMarkup(appState),
			}),
		bind: (appState) => {
			const services: ShellServices = {
				appState,
				showLoading: () => {},
				hideLoading: () => {},
				showError: () => {},
			};
			return setupOutAndBackSliderSync(services, parameterStorage, async () => ({}));
		},
	},
];

describe.each(MODES)(
	"$name binds every control row the table claims for it",
	({ modeId, renderSidebar, bind }) => {
		let result: BindModeControlsResult;

		beforeEach(() => {
			resetModeUpdateRequests();
			const appState = makeAppState();
			document.body.innerHTML = `<div id="veAnalysisSection"><div id="veAnalysisContent"></div></div>`;
			// The mode's own template, interpolated from numeric parameters only —
			// the same string the render function assigns.
			document.getElementById("veAnalysisContent")!.innerHTML =
				renderSidebar(appState);
			result = bind(appState);
		});

		it("skips nothing", () => {
			expect(result.skipped.map((spec) => spec.reason)).toEqual([]);
		});

		it("binds every row, by reason", () => {
			// Compared as SETS of reasons rather than counts, so a row that stops
			// binding is named in the failure rather than showing up as an integer
			// that moved.
			const claimed = new Set(
				controlsForMode(modeId).map((spec) => spec.reason),
			);
			const bound = new Set(result.bound.map((spec) => spec.reason));
			expect([...bound].sort()).toEqual([...claimed].sort());
		});

		it("binds every row, counting the paired ones separately", () => {
			// `trim` and `mapTrim` are two rows apiece, so the reason set alone
			// would not notice one of a pair going dark. The GPS modes have no
			// paired rows today; asserting the count keeps that true if they grow
			// one.
			expect(result.bound).toHaveLength(controlsForMode(modeId).length);
		});

		it("reports a control whose markup is missing rather than swallowing it", () => {
			// The guard's own failure mode, exercised: strip the panel and every
			// row must be reported skipped, not silently dropped. If this ever
			// starts passing with a non-empty `bound`, the report is lying and
			// every assertion above it is vacuous.
			const warn = vi
				.spyOn(console, "warn")
				.mockImplementation(() => {});
			document.body.innerHTML = `<div id="veAnalysisSection"></div>`;
			const stripped = bind(makeAppState());

			expect(stripped.bound).toEqual([]);
			expect(stripped.skipped).toHaveLength(controlsForMode(modeId).length);
			expect(warn).toHaveBeenCalled();
			warn.mockRestore();
		});
	},
);
