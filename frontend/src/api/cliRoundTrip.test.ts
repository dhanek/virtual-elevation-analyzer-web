/**
 * CLI END-TO-END (Convergence plan, C10): spawn the real `ve-run.ts` under
 * vite-node with a config on stdin and assert the four things only a process
 * boundary can prove — the exit code, that stdout is EXACTLY ONE JSON line
 * (the log-redirection guard: one stray `console.log` in the import graph
 * corrupts every result in a batch and surfaces as a JSON error in Python),
 * that the envelope parses, and that the csvRow renders the app's own column
 * table.
 *
 * Slow by nature (~5-10 s of vite-node boot), so it is one spawn, reused.
 */
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
	GOLDEN_RIDE_PATH,
	isGoldenRidePresent,
} from "../analysis/__fixtures__/loadGoldenRide";
import { RESULT_COLUMNS } from "../utils/resultColumns";
import { RUN_SCHEMA_VERSION, type RunResult } from "./schema";

const WASM_PATH = fileURLToPath(
	new URL("../../pkg/virtual_elevation_analyzer_bg.wasm", import.meta.url),
);
const runnable = existsSync(WASM_PATH) && isGoldenRidePresent();

function spawnCli(stdin: string, args: string[]): {
	stdout: string;
	stderr: string;
	status: number;
} {
	try {
		const stdout = execFileSync(
			process.execPath,
			[
				join(process.cwd(), "node_modules", "vite-node", "vite-node.mjs"),
				"scripts/ve-run.ts",
				"--",
				...args,
			],
			{ input: stdin, cwd: process.cwd(), encoding: "utf8", timeout: 120_000 },
		);
		return { stdout, stderr: "", status: 0 };
	} catch (error) {
		const failure = error as {
			stdout?: string;
			stderr?: string;
			status?: number;
		};
		return {
			stdout: failure.stdout ?? "",
			stderr: failure.stderr ?? "",
			status: failure.status ?? 1,
		};
	}
}

describe.skipIf(!runnable)("ve-run CLI", () => {
	it("emits exactly one clean JSON line for a good config, exit 0", () => {
		const golden = JSON.parse(readFileSync(GOLDEN_RIDE_PATH, "utf8"));
		const config = {
			schemaVersion: RUN_SCHEMA_VERSION,
			activity: {
				inline: {
					channels: {
						record_count: golden.record_count,
						timestamps: golden.timestamps,
						power: golden.power,
						velocity: golden.velocity,
						position_lat: golden.position_lat,
						position_long: golden.position_long,
						altitude: golden.altitude,
						distance: golden.distance,
						air_speed: golden.air_speed,
						wind_yaw: golden.wind_yaw,
						temperature: golden.temperature,
					},
				},
			},
			mode: "gpsLap",
			selection: { indexRanges: golden.indexRanges },
			inputs: {
				cda: 0.28,
				crr: 0.005,
				windSource: "fit",
				airSpeedCalibrationPercent: 5,
				rhoArray: golden.rhoArray,
			},
			parameters: golden.params,
			output: { fileName: "golden-ride" },
		};

		const run = spawnCli(JSON.stringify(config), ["--config", "-"]);
		expect(run.status).toBe(0);

		// THE stdout-purity assertion: one line, all JSON, nothing else.
		const lines = run.stdout.trim().split("\n");
		expect(lines).toHaveLength(1);

		const result = JSON.parse(lines[0]) as RunResult;
		expect(result.ok).toBe(true);
		expect(result.run?.mode).toBe("gpsLap");
		expect(result.segments!.length).toBe(golden.indexRanges.length);
		expect(result.csvRow!.headers).toEqual(
			RESULT_COLUMNS.map((column) => column.header),
		);
		expect(Number.isFinite(result.aggregate!.r2)).toBe(true);
	}, 180_000);

	it("rejects an invalid config with exit 2 and a structured envelope", () => {
		const run = spawnCli(JSON.stringify({ schemaVersion: 99 }), [
			"--config",
			"-",
		]);
		expect(run.status).toBe(2);
		const result = JSON.parse(run.stdout.trim()) as RunResult;
		expect(result.ok).toBe(false);
		expect(result.error?.code).toBe("invalid-config");
		expect(result.error?.details?.length).toBeGreaterThan(0);
	}, 180_000);
});
