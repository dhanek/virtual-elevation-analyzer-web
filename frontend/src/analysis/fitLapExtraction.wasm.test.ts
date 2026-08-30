import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { beforeAll, describe, expect, test } from "vitest";
import { initSync, parse_fit_file } from "@wasm/virtual_elevation_analyzer.js";

import {
	buildSyntheticFit,
	DECOY_LAP_SUMMARY,
	SYNTHETIC_POWER_W,
	SYNTHETIC_RECORD_COUNT,
	SYNTHETIC_SPEED_MS,
	SYNTHETIC_START_LAT,
	SYNTHETIC_START_LON,
	SYNTHETIC_STEP_M,
	UNIX_START_TIME,
} from "./__fixtures__/buildSyntheticFit";

/**
 * Lap extraction against the real WASM parser.
 *
 * Reported from the field: a ride exported out of GoldenCheetah as a sub-file
 * loaded fine in GoldenCheetah and Strava, but the web app rendered Section 2
 * and then stopped — no map, no lap list. The stats banner it left behind
 * showed 552 records and correct distance/power, so the RECORDS parsed; the
 * laps did not, and `initializeSection3` early-returns when `laps.length` is 0.
 *
 * GoldenCheetah's export writes a lap message stripped down to its start and
 * end: no `total_elapsed_time` (which dropped the lap entirely) and no summary
 * fields (which rendered the surviving lap row as "0 m • N/A"). The fixture
 * toggles exactly those two groups, so a failure here names which one broke.
 */

const WASM_PATH = fileURLToPath(
	new URL("../../pkg/virtual_elevation_analyzer_bg.wasm", import.meta.url),
);

const built = existsSync(WASM_PATH);

/** The odometer advances once per record, so the last step falls outside the span. */
const EXPECTED_LAP_DISTANCE_M = SYNTHETIC_STEP_M * (SYNTHETIC_RECORD_COUNT - 1);

test("wasm artifact is present in CI", () => {
	if (process.env.CI) {
		expect(built).toBe(true);
	}
});

describe.skipIf(!built)("FIT lap extraction (real WASM)", () => {
	beforeAll(() => {
		initSync({ module: readFileSync(WASM_PATH) });
	});

	describe("resolving the lap's time span", () => {
		test("keeps a lap that carries total_elapsed_time", () => {
			const parsed = parse_fit_file(
				buildSyntheticFit({ lapTotalElapsedTime: true }),
			);

			expect(parsed.parsing_statistics.record_count).toBe(
				SYNTHETIC_RECORD_COUNT,
			);
			expect(parsed.laps).toHaveLength(1);
			expect(parsed.laps[0].start_time).toBe(UNIX_START_TIME);
			expect(parsed.laps[0].total_elapsed_time).toBe(SYNTHETIC_RECORD_COUNT);
		});

		test("keeps a lap whose only duration evidence is start_time and timestamp", () => {
			const parsed = parse_fit_file(
				buildSyntheticFit({ lapTotalElapsedTime: false }),
			);

			expect(parsed.parsing_statistics.record_count).toBe(
				SYNTHETIC_RECORD_COUNT,
			);
			expect(parsed.laps).toHaveLength(1);

			const lap = parsed.laps[0];
			expect(lap.start_time).toBe(UNIX_START_TIME);
			expect(lap.end_time).toBe(UNIX_START_TIME + SYNTHETIC_RECORD_COUNT);
			expect(lap.total_elapsed_time).toBe(SYNTHETIC_RECORD_COUNT);
		});
	});

	describe("filling in an absent lap summary", () => {
		test("derives distance, power and speed from the records the lap covers", () => {
			const parsed = parse_fit_file(
				buildSyntheticFit({
					lapTotalElapsedTime: false,
					lapSummaryFields: false,
				}),
			);

			const lap = parsed.laps[0];
			expect(lap.total_distance).toBeCloseTo(EXPECTED_LAP_DISTANCE_M, 6);
			expect(lap.avg_power).toBeCloseTo(SYNTHETIC_POWER_W, 6);
			expect(lap.avg_speed).toBeCloseTo(SYNTHETIC_SPEED_MS, 6);
			expect(lap.max_speed).toBeCloseTo(SYNTHETIC_SPEED_MS, 6);
		});

		test("derives the lap's start position from its first GPS fix", () => {
			const parsed = parse_fit_file(
				buildSyntheticFit({
					lapTotalElapsedTime: false,
					lapSummaryFields: false,
				}),
			);

			const lap = parsed.laps[0];
			expect(lap.start_position_lat).toBeCloseTo(SYNTHETIC_START_LAT, 6);
			expect(lap.start_position_long).toBeCloseTo(SYNTHETIC_START_LON, 6);
		});

		/**
		 * The guard against deriving over a summary the file actually reported.
		 * The decoy values disagree with the records on purpose, so reading a
		 * derived number here would fail rather than coincidentally match.
		 */
		test("prefers the lap's own summary when the file reports one", () => {
			const parsed = parse_fit_file(
				buildSyntheticFit({
					lapTotalElapsedTime: true,
					lapSummaryFields: true,
				}),
			);

			const lap = parsed.laps[0];
			expect(lap.total_distance).toBeCloseTo(
				DECOY_LAP_SUMMARY.totalDistance,
				6,
			);
			expect(lap.avg_power).toBeCloseTo(DECOY_LAP_SUMMARY.avgPower, 6);
			expect(lap.avg_speed).toBeCloseTo(DECOY_LAP_SUMMARY.avgSpeed, 6);
			expect(lap.max_speed).toBeCloseTo(DECOY_LAP_SUMMARY.maxSpeed, 6);

			// ...and the decoys are genuinely distinguishable from the records.
			expect(DECOY_LAP_SUMMARY.totalDistance).not.toBeCloseTo(
				EXPECTED_LAP_DISTANCE_M,
				6,
			);
			expect(DECOY_LAP_SUMMARY.avgPower).not.toBeCloseTo(SYNTHETIC_POWER_W, 6);
			expect(DECOY_LAP_SUMMARY.avgSpeed).not.toBeCloseTo(
				SYNTHETIC_SPEED_MS,
				6,
			);
		});
	});
});
