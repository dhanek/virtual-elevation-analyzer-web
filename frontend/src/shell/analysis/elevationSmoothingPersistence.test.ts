/**
 * @vitest-environment jsdom
 *
 * WHAT THE ELEVATION-SMOOTHING TOGGLE ACTUALLY PERSISTS — D-09 entry (o), tested
 * rather than asserted.
 *
 * Entry (o) reads: "`elevationSmoothing` carries `persistsSettings: true`, so
 * the GPS modes now call `saveCurrentMultiSegmentSettings` on a toggle where
 * they did not", and its browser-check line asked the maintainer to toggle the
 * control and reload. That check is not runnable by hand — a reload is a hard
 * refresh and the FIT file has to be re-loaded afterwards — so it is settled
 * here instead.
 *
 * THE SECOND HALF OF THE CLAIM IS FALSE, AND SAYING SO IS THE POINT OF THIS
 * FILE. The toggle's state lives on `appState.activeDisplayProfile`. What the
 * save writes is a `LapSettings` record, and `LapSettings` is
 * `{ trimStart, trimEnd, cda, crr, airSpeedCalibration? }` — there is no field
 * for the display profile, in that record or anywhere else in
 * `ParameterStorage`. `grep -rn activeDisplayProfile src` returns readers, the
 * two setters in `elevationProfileCycle.ts`, and the file-load defaults in
 * `fileLoadOrchestration.ts`; not one write to storage. So the setting cannot
 * survive a reload, and never could — in any mode.
 *
 * What entry (o) DID change is real and is guarded below: a smoothing toggle now
 * writes the CdA/Crr record that every other control already wrote. The two
 * suites here say exactly that and nothing more:
 *
 *   1. the toggle reaches persistence at all (the true half of entry (o));
 *   2. a fresh load does NOT restore the toggle (the false half), driven through
 *      the same `resolveMultiSegmentAnalysisParams` the app loads with, against
 *      a genuinely fresh `AppState`.
 *
 * Suite 2 is a CHARACTERISATION test of a known-false claim, not a requirement.
 * If someone later persists the profile properly it will fail — which is the
 * correct signal: update it and D-09 entry (o) together.
 *
 * WHAT IS REAL: the GPS render entry points and their templates,
 * `bindModeControls`, `MODE_CONTROL_TABLE`, `bindElevationSmoothingToggle`,
 * `saveCurrentMultiSegmentSettings`, `resolveMultiSegmentAnalysisParams`, and
 * the `AppState` defaults a fresh load starts from. The storage double stores
 * records under the same `fileHash` + sorted-lap-key the real one uses, so the
 * round trip is a real round trip.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

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

const modeState = vi.hoisted(() => ({ gps: "None" as string }));

vi.mock("../section3/section3Orchestration", async (importOriginal) => ({
	...(await importOriginal<Record<string, unknown>>()),
	getGpsAnalysisMode: () => modeState.gps,
}));

vi.mock("../gpsLap/gpsLapPlots", async (importOriginal) => ({
	...(await importOriginal<Record<string, unknown>>()),
	renderGpsLapVEPlots: () => {},
	renderGpsLapWindPlot: () => {},
	renderGpsLapPowerPlot: () => {},
	renderGpsLapVdPlot: () => {},
}));

vi.mock("../outAndBack/outAndBackPlots", async (importOriginal) => ({
	...(await importOriginal<Record<string, unknown>>()),
	renderOutAndBackPlots: () => {},
	renderOutAndBackWindPlot: () => {},
	renderOutAndBackPowerPlot: () => {},
	renderOutAndBackVdPlot: () => {},
}));

import { resolveMultiSegmentAnalysisParams } from "../../analysis/MultiSegmentSettings";
import type { AnalysisParameters } from "../../components/AnalysisParameters";
import { AppState } from "../../state/AppState";
import type { LapSettings, ParameterStorage } from "../../utils/ParameterStorage";
import type { ResultsStorage } from "../../utils/ResultsStorage";
import type { ShellServices } from "./types";
import { showGpsLapVEPlot } from "../gpsLap/renderGpsLap";
import { showOutAndBackVEPlot } from "../outAndBack/renderOutAndBack";
import { clearModeUpdateCallbacks } from "./modeUpdateCallbacks";
import { resetModeUpdateRequests } from "./requestModeUpdate";

const SAMPLE_COUNT = 400;
const LAST_INDEX = SAMPLE_COUNT - 1;
const HALF = SAMPLE_COUNT / 2;
const FILE_HASH = "hash-under-test";
const ANALYZED = [1, 2];
const STORED_CDA = 0.317;
const STORED_CRR = 0.0061;

/**
 * A `ParameterStorage` double that keys records exactly as the real one does:
 * by file hash, then by the selected laps sorted and joined with "-"
 * (`ParameterStorage.getLapKey`). Everything else about the real class is
 * IndexedDB plumbing, which jsdom cannot run.
 */
class InMemoryParameterStorage {
	readonly records = new Map<string, LapSettings>();
	readonly saveCalls: Array<{ laps: number[]; settings: LapSettings }> = [];

	private key(fileHash: string, laps: number[]): string {
		const lapKey =
			laps.length === 0 ? "all" : [...laps].sort((a, b) => a - b).join("-");
		return `${fileHash}::${lapKey}`;
	}

	async saveLapSettings(
		fileHash: string,
		selectedLaps: number[],
		settings: LapSettings,
	): Promise<void> {
		this.saveCalls.push({ laps: [...selectedLaps], settings: { ...settings } });
		this.records.set(this.key(fileHash, selectedLaps), { ...settings });
	}

	async loadLapSettings(
		fileHash: string,
		selectedLaps: number[],
	): Promise<LapSettings | null> {
		return this.records.get(this.key(fileHash, selectedLaps)) ?? null;
	}

	asParameterStorage(): ParameterStorage {
		return this as unknown as ParameterStorage;
	}
}

const params = {
	cda: STORED_CDA,
	cda_min: 0.1,
	cda_max: 0.5,
	crr: STORED_CRR,
	crr_min: 0.001,
	crr_max: 0.02,
	air_speed_offset: 0,
	wind_speed: 3,
	wind_direction: 90,
	wind_height_factor: 1,
	velodrome: false,
	auto_calculate_rho: false,
} as unknown as AnalysisParameters;

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

const SECTION = {
	sectionNumber: 1,
	outboundRange: { startIdx: 0, endIdx: 1 },
	inboundRange: { startIdx: 2, endIdx: 3 },
	outboundStartIdx: 0,
	outboundEndIdx: HALF - 1,
	inboundStartIdx: HALF,
	inboundEndIdx: LAST_INDEX,
	outboundDuration: HALF,
	inboundDuration: HALF,
	totalDistance: 4,
};

/**
 * The state an analyzed activity leaves behind. `currentFileHash`,
 * `selectedFile` and a non-empty `currentAnalyzedLaps` are PRECONDITIONS of
 * `saveCurrentMultiSegmentSettings` — it returns early without them — and are
 * set by the file-load and analyze paths in production, not by the toggle.
 */
function makeAppState(): AppState {
	return {
		currentFitData: makeFitData(),
		currentParameters: { ...params },
		currentFileHash: FILE_HASH,
		selectedFile: { name: "ride.fit" },
		currentAnalyzedLaps: [...ANALYZED],
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
		airSpeedCalibrationPercent: 0,
		// OFF. The toggle under test turns it ON.
		activeDisplayProfile: "fit-raw",
		isGpsLapModeActive: false,
		isCalculatingAutoRho: false,
		// Without this the toggle is not rendered at all, and the row would be
		// reported as skipped rather than bound.
		demProfilesAvailable: true,
	} as unknown as AppState;
}

function makeServices(appState: AppState): ShellServices {
	return {
		appState,
		showLoading: () => {},
		hideLoading: () => {},
		showError: () => {},
	} as unknown as ShellServices;
}

function renderHostPage(): void {
	document.body.innerHTML = `
		<div id="veAnalysisSection">
			<div id="veAnalysisContent"></div>
		</div>
	`;
}

const lapProfile = (lapNumber: number) => ({
	range: { startIdx: 0, endIdx: 3 },
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
	outboundRange: { startIdx: 0, endIdx: 1 },
	inboundRange: { startIdx: 2, endIdx: 3 },
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

async function settle(): Promise<void> {
	await vi.advanceTimersByTimeAsync(500);
}

/** The real gesture: click the ON button of the segmented control. */
async function toggleSmoothingOn(): Promise<void> {
	const on = document.querySelector<HTMLButtonElement>(
		'#elevationProfileSwitchToggle [data-smoothing="on"]',
	);
	if (!on) throw new Error("the elevation-smoothing toggle is not rendered");
	on.dispatchEvent(new MouseEvent("click", { bubbles: true }));
	await settle();
}

interface ModeUnderTest {
	name: string;
	gpsAnalysisMode: string;
	render: (
		appState: AppState,
		storage: ParameterStorage,
	) => Promise<void>;
}

const MODES: readonly ModeUnderTest[] = [
	{
		name: "GPS-lap",
		gpsAnalysisMode: "GPS based lap splitting",
		render: (appState, storage) =>
			showGpsLapVEPlot(
				makeServices(appState),
				storage,
				{} as unknown as ResultsStorage,
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
		render: (appState, storage) =>
			showOutAndBackVEPlot(
				makeServices(appState),
				storage,
				{} as unknown as ResultsStorage,
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

let appState: AppState;
let storage: InMemoryParameterStorage;

describe.each(MODES)(
	"$name: what an elevation-smoothing toggle persists",
	({ gpsAnalysisMode, render }) => {
		beforeEach(async () => {
			vi.useFakeTimers();
			Element.prototype.scrollIntoView = () => {};
			(globalThis as any).Plotly = { newPlot: () => {}, react: () => {} };
			clearModeUpdateCallbacks();
			resetModeUpdateRequests();
			modeState.gps = gpsAnalysisMode;
			renderHostPage();
			appState = makeAppState();
			storage = new InMemoryParameterStorage();
			await render(appState, storage.asParameterStorage());
			// Only what the TOGGLE provokes is under test.
			storage.saveCalls.length = 0;
			storage.records.clear();
		});

		afterEach(() => {
			vi.useRealTimers();
			clearModeUpdateCallbacks();
			resetModeUpdateRequests();
		});

		it("writes a settings record — the true half of D-09 entry (o)", async () => {
			expect(appState.activeDisplayProfile).toBe("fit-raw");

			await toggleSmoothingOn();

			// The toggle did what it is for...
			expect(appState.activeDisplayProfile).toBe(
				"dem-interpolated-smoothed-5pt",
			);
			// ...and, because the row carries `persistsSettings: true`, it also
			// reached storage. Removing that flag from MODE_CONTROL_TABLE's
			// `elevationSmoothing` row fails exactly this assertion.
			expect(storage.saveCalls.length).toBeGreaterThan(0);
			expect(storage.saveCalls[0].laps).toEqual(ANALYZED);
		});

		it("does NOT restore the toggle on a fresh load — the false half", async () => {
			await toggleSmoothingOn();
			expect(appState.activeDisplayProfile).toBe(
				"dem-interpolated-smoothed-5pt",
			);

			// A reload: a brand-new AppState with the REAL defaults, then the same
			// load the app performs for this file and lap selection.
			const reloaded = new AppState();
			reloaded.currentFileHash = FILE_HASH;
			const profileBeforeLoad = reloaded.activeDisplayProfile;

			const restoredParams = await resolveMultiSegmentAnalysisParams(
				reloaded,
				storage.asParameterStorage(),
				[...ANALYZED],
				{ ...params, cda: 0.2, crr: 0.001 },
			);

			// The record IS there and IS read back — the round trip is real, so
			// this is not a load that silently found nothing.
			const stored = await storage.loadLapSettings(FILE_HASH, [...ANALYZED]);
			expect(stored).not.toBeNull();
			expect(restoredParams.cda).toBeCloseTo(STORED_CDA, 6);
			expect(restoredParams.crr).toBeCloseTo(STORED_CRR, 6);

			// And the smoothing state is not in it. `LapSettings` has no field for
			// the display profile, so there is nothing for the load to restore:
			// the fresh state keeps the default it was constructed with.
			expect(Object.keys(stored!)).not.toContain("activeDisplayProfile");
			expect(reloaded.activeDisplayProfile).toBe(profileBeforeLoad);
			expect(reloaded.activeDisplayProfile).not.toBe(
				"dem-interpolated-smoothed-5pt",
			);
		});
	},
);
