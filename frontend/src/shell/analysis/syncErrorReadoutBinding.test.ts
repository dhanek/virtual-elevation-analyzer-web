/**
 * @vitest-environment jsdom
 *
 * THE GPS MODES' SYNC-ERROR READOUT, THROUGH THE REAL BINDER (F83-02 b, c).
 *
 * `syncErrorSeries.test.ts` owns `resolveSyncErrorSeries` itself. This owns the
 * WIRING: each GPS renderer's `getSyncErrorSeries` hands the binder that
 * function's unshifted series, so `refreshOffsetMetric` shifts the air speed
 * once, at the slider's offset. Reverting a renderer to the series it built
 * itself (shifted by `params.air_speed_offset`) measures at twice the offset.
 *
 * Same pattern as `modeControlBindingCoverage.test.ts`: jsdom, the mode's REAL
 * template, the REAL `setupGpsLapSliderHandlers` / `setupOutAndBackSliderSync`.
 * Only the update callback is a stub, so no WASM is reached. The ride is
 * `syncErrorSeries.test.ts`'s `laggedRide`: air speed exactly LAG seconds late,
 * ground speed changing every second so a wrong shift is never free. The params
 * offset is LAG too — the old bug only shows when it is non-zero.
 *
 * The slider's `requestModeUpdate` resolves Standard on this stub state (no
 * Section 3 mode set) and logs a caught error from the calibration-hint
 * refresh; `refreshOffsetMetric` runs after it in `finish` and is unaffected.
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
		airSpeedCalibrationPercent: 0,
		activeDisplayProfile: "fit-raw",
		demProfilesAvailable: true,
	} as unknown as AppState;
}

const parameterStorage = {} as unknown as ParameterStorage;

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
	"$name: the sync-error readout shifts the air speed once",
	({ renderSidebar, bind }) => {
		beforeEach(() => {
			resetModeUpdateRequests();
			const appState = makeAppState();
			document.body.innerHTML = `<div id="veAnalysisSection"><div id="veAnalysisContent"></div></div>`;
			document.getElementById("veAnalysisContent")!.innerHTML =
				renderSidebar(appState);
			bind(appState);
		});

		it("reads 0 at the true lag after a slider input", () => {
			const slider = document.getElementById(
				"airSpeedOffsetSlider",
			) as HTMLInputElement | null;
			const metric = document.getElementById("airSpeedOffsetErrorMetric");
			expect(slider).not.toBeNull();
			expect(metric).not.toBeNull();

			// Reach: a binder that bailed (no windows, NaN offset, no series)
			// leaves this sentinel in place.
			metric!.textContent = "SENTINEL";
			slider!.value = String(LAG);
			slider!.dispatchEvent(new Event("input", { bubbles: true }));

			expect(metric!.textContent).not.toBe("SENTINEL");
			expect(metric!.textContent).not.toBe("");
			expect(Number(metric!.textContent)).toBeCloseTo(0, 2);
		});
	},
);
