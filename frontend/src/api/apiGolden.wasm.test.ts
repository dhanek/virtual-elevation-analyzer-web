/**
 * THE API ROUND TRIP (Convergence plan, C9): the headless runner must
 * reproduce, number for number, what the primitive produces when driven the
 * way `veGolden.wasm.test.ts` drives it — same WASM, same activity, two entry
 * paths. The direct path is pinned to 13 committed literals over there, so
 * equality HERE means the API inherits those literals transitively without a
 * second copy of them to rot.
 *
 * The standard-vs-gpsLap identity is the free cross-check the golden fixture
 * was built for: its Standard selection is laps whose per-lap ranges equal its
 * `indexRanges`, so the two modes must produce identical numbers — a config
 * bug that swaps a mode shows up immediately.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { existsSync } from "node:fs";
import { beforeAll, describe, expect, it, test } from "vitest";
import { initSync } from "@wasm/virtual_elevation_analyzer.js";
import {
	isGoldenRidePresent,
	loadGoldenRide,
} from "../analysis/__fixtures__/loadGoldenRide";
import { getAnalysisModeHandlerById } from "../modes/analysis/AnalysisModes";
import type {
	AnalysisModeId,
	ModeUpdateCallbacks,
	SegmentVeProfile,
} from "../modes/analysis/types";
import { updateModeVEPlots } from "../shell/analysis/updateModeVEPlots";
import type { AppState } from "../state/AppState";
import { RESULT_COLUMNS } from "../utils/resultColumns";
import { loadRunActivity } from "./loadActivity";
import { runAnalysis } from "./runAnalysis";
import {
	RUN_SCHEMA_VERSION,
	type RunActivityChannels,
	type RunConfig,
} from "./schema";
import { validateRunConfig } from "./validateRunConfig";

const WASM_PATH = fileURLToPath(
	new URL("../../pkg/virtual_elevation_analyzer_bg.wasm", import.meta.url),
);
const built = existsSync(WASM_PATH);
const fixturePresent = isGoldenRidePresent();

const CDA = 0.28;
const CRR = 0.005;
const CALIBRATION = 5;
const PRECISION = 10;

test("wasm artifact and golden fixture are present in CI", () => {
	if (process.env.CI) {
		expect(built).toBe(true);
		expect(fixturePresent).toBe(true);
	}
});

interface SegmentSummary {
	length: number;
	r2: number;
	rmse: number;
	veGain: number;
	actualGain: number;
	checksum: number;
}

function summariseProfile(profile: SegmentVeProfile): SegmentSummary {
	return {
		length: profile.virtualElevation.length,
		r2: profile.result.r2,
		rmse: profile.result.rmse,
		veGain: profile.result.ve_elevation_diff,
		actualGain: profile.result.actual_elevation_diff,
		checksum: profile.virtualElevation.reduce((sum, v) => sum + v, 0),
	};
}

function expectSummariesEqual(
	actual: SegmentSummary[],
	expected: SegmentSummary[],
): void {
	expect(actual).toHaveLength(expected.length);
	for (let i = 0; i < actual.length; i++) {
		expect(actual[i].length).toBe(expected[i].length);
		expect(actual[i].r2).toBeCloseTo(expected[i].r2, PRECISION);
		expect(actual[i].rmse).toBeCloseTo(expected[i].rmse, PRECISION);
		expect(actual[i].veGain).toBeCloseTo(expected[i].veGain, PRECISION);
		expect(actual[i].actualGain).toBeCloseTo(expected[i].actualGain, PRECISION);
		expect(actual[i].checksum).toBeCloseTo(expected[i].checksum, PRECISION);
	}
}

describe.skipIf(!built || !fixturePresent)("headless API round trip", () => {
	beforeAll(() => {
		initSync({ module: readFileSync(WASM_PATH) });
	});

	function goldenChannels(): RunActivityChannels {
		const ride = loadGoldenRide();
		const data = ride.fitData as unknown as Record<string, number[]>;
		return {
			record_count: ride.fitData.record_count,
			timestamps: data.timestamps,
			power: data.power,
			velocity: data.velocity,
			position_lat: data.position_lat,
			position_long: data.position_long,
			altitude: data.altitude,
			distance: data.distance,
			air_speed: data.air_speed,
			wind_yaw: data.wind_yaw,
			temperature: data.temperature,
		};
	}

	function configFor(
		mode: AnalysisModeId,
		windSource: "fit" | "constant" | "compare",
		withRho: boolean,
	): RunConfig {
		const ride = loadGoldenRide();
		const selection =
			mode === "standard"
				? { laps: ride.laps.map((_, i) => i + 1) }
				: mode === "gpsLap"
					? { indexRanges: ride.indexRanges }
					: { sections: ride.sections };
		return {
			schemaVersion: RUN_SCHEMA_VERSION,
			mode,
			selection,
			inputs: {
				cda: CDA,
				crr: CRR,
				windSource,
				airSpeedCalibrationPercent: CALIBRATION,
				rhoArray: withRho ? loadGoldenRide().rhoArray : false,
			},
			parameters: ride.params,
		};
	}

	async function runApi(config: RunConfig) {
		expect(validateRunConfig(config).ok).toBe(true);
		const ride = loadGoldenRide();
		const activity = loadRunActivity({
			kind: "channels",
			channels: goldenChannels(),
			fileName: "golden-ride.json",
		});
		// The channels path carries no FIT lap records; standard-mode selection
		// resolves over the activity laps, which for the fixture come with it.
		activity.laps = ride.laps;
		const { result, outcome } = await runAnalysis({ config, activity });
		expect(outcome).not.toBeNull();
		expect(result.ok).toBe(true);
		return { result, outcome: outcome! };
	}

	/** The veGolden-style direct drive of the primitive, for the same case. */
	async function runDirect(
		mode: AnalysisModeId,
		windSource: "fit" | "constant" | "compare",
		withRho: boolean,
	) {
		const ride = loadGoldenRide();
		const noop: ModeUpdateCallbacks = {
			aggregate: (profiles) => ({
				r2: 0,
				rmse: 0,
				veGain: 0,
				actualGain: 0,
				segmentCount: profiles.length,
			}),
			renderVe: () => {},
			renderWind: () => {},
			renderPower: () => {},
			renderVd: () => {},
			renderConvergence: () => {},
			renderMetrics: () => {},
		};
		const appState = {
			fitRawElevation: null,
			demRawNearestElevation: null,
			demInterpolatedSmoothed5ptElevation: null,
			activeDisplayProfile: "fit-raw",
			currentFitData: ride.fitData,
			currentParameters: ride.params,
			airSpeedCalibrationPercent: CALIBRATION,
			currentGpsLapIndexRanges: mode === "gpsLap" ? ride.indexRanges : null,
			currentOverlayLapNumbers: null,
			currentAnalyzedLaps: [],
			currentFilteredData: null,
			currentVEResult: null,
			currentWindSource: "none",
			outAndBackSections: mode === "outAndBack" ? ride.sections : [],
			outAndBackSelectedSections:
				mode === "outAndBack" ? ride.sections.map((s) => s.sectionNumber) : [],
			gpsDetectedLaps: [],
			gpsSelectedLaps: [],
			currentLaps: ride.laps,
			selectedLaps: ride.laps.map((_, i) => i + 1),
		} as unknown as AppState;

		const outcome = await updateModeVEPlots({
			appState,
			handler: getAnalysisModeHandlerById(mode),
			makeCallbacks: () => noop,
			windSource,
			cda: CDA,
			crr: CRR,
			isTabActive: () => false,
			resolveRho: withRho ? () => ride.rhoArray : () => null,
		});
		expect(outcome).not.toBeNull();
		return outcome!;
	}

	const MODES: AnalysisModeId[] = ["standard", "gpsLap", "outAndBack"];

	for (const mode of MODES) {
		for (const windSource of ["fit", "constant"] as const) {
			for (const withRho of [true, false]) {
				it(`${mode} / ${windSource} / rho ${withRho ? "present" : "absent"}: API equals the direct primitive drive`, async () => {
					const config = configFor(mode, windSource, withRho);
					const api = await runApi(config);
					const direct = await runDirect(mode, windSource, withRho);
					expectSummariesEqual(
						api.outcome.profiles.map(summariseProfile),
						direct.profiles.map(summariseProfile),
					);
				});
			}
		}

		it(`${mode} / compare: both legs equal the direct drive's`, async () => {
			const api = await runApi(configFor(mode, "compare", true));
			const direct = await runDirect(mode, "compare", true);
			expectSummariesEqual(
				api.outcome.profiles.map(summariseProfile),
				direct.profiles.map(summariseProfile),
			);
			for (const [i, profile] of api.outcome.profiles.entries()) {
				expect(profile.resultCompare).not.toBeNull();
				expect(profile.resultCompare!.ve_elevation_diff).toBeCloseTo(
					direct.profiles[i].resultCompare!.ve_elevation_diff,
					PRECISION,
				);
			}
		});
	}

	it("standard by laps and gpsLap by the same ranges produce identical numbers", async () => {
		const standard = await runApi(configFor("standard", "fit", true));
		const gpsLap = await runApi(configFor("gpsLap", "fit", true));
		expectSummariesEqual(
			standard.outcome.profiles.map(summariseProfile),
			gpsLap.outcome.profiles.map(summariseProfile),
		);
	});

	it("the csvRow renders through RESULT_COLUMNS, headers and all", async () => {
		const { result } = await runApi(configFor("standard", "fit", true));
		expect(result.csvRow).toBeDefined();
		expect(result.csvRow!.headers).toEqual(
			RESULT_COLUMNS.map((column) => column.header),
		);
		expect(result.csvRow!.values).toHaveLength(RESULT_COLUMNS.length);
		const byHeader = Object.fromEntries(
			result.csvRow!.headers.map((header, i) => [
				header,
				result.csvRow!.values[i],
			]),
		);
		expect(byHeader.CdA).toBe(CDA.toFixed(3));
		expect(byHeader.Crr).toBe(CRR.toFixed(4));
		expect(byHeader.WindSource).toBe("fit");
		expect(Number(byHeader.R2)).toBeCloseTo(result.aggregate!.r2, 4);
	});

	it("a selection-space trim goes through the real mapTrimToSegments", async () => {
		const config = configFor("standard", "fit", true);
		config.trim = { space: "selection", start: 100, end: 900 };
		const api = await runApi(config);
		const untrimmed = await runApi(configFor("standard", "fit", true));
		// The trim narrowed the analysed window: fewer samples measured, and
		// the recorded trim rides out on the CSV row.
		const trimmedSamples = api.outcome.profiles.reduce(
			(sum, p) => sum + (p.segment.trim ? p.segment.trim.end - p.segment.trim.start + 1 : p.virtualElevation.length),
			0,
		);
		const fullSamples = untrimmed.outcome.profiles.reduce(
			(sum, p) => sum + p.virtualElevation.length,
			0,
		);
		expect(trimmedSamples).toBeLessThan(fullSamples);
		const headers = api.result.csvRow!.headers;
		expect(api.result.csvRow!.values[headers.indexOf("TrimStart")]).toBe("100");
		expect(api.result.csvRow!.values[headers.indexOf("TrimEnd")]).toBe("900");
	});

	it("the response is JSON-clean: no Float64Array, NaN only as counted nulls", async () => {
		const config = configFor("standard", "constant", false);
		config.output = { includeSeries: true };
		const { result } = await runApi(config);
		const text = JSON.stringify(result);
		const parsed = JSON.parse(text) as Record<string, unknown>;
		expect(JSON.stringify(parsed)).toBe(text);
		const walk = (value: unknown): void => {
			if (value instanceof Float64Array) {
				throw new Error("Float64Array leaked into the result");
			}
			if (Array.isArray(value)) value.forEach(walk);
			else if (value && typeof value === "object")
				Object.values(value).forEach(walk);
		};
		walk(result);
	});
});
