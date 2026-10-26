/**
 * `ve-run kalman` end to end (TODO J6, spec §5): a selection JSON on stdin,
 * exactly one JSON line on stdout, the exit code by outcome. Spawns the real
 * script under vite-node, so it is slow (~5 s) and kept to one file.
 */
import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import type {
	KalmanLegInput,
	KalmanSelectionInput,
} from "../analysis/KalmanFit";

const WASM_PATH = fileURLToPath(
	new URL("../../pkg/virtual_elevation_analyzer_bg.wasm", import.meta.url),
);

function run(
	stdin: string,
	args: string[],
): { stdout: string; status: number } {
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
		return { stdout, status: 0 };
	} catch (error) {
		const failure = error as { stdout?: string; status?: number };
		return { stdout: failure.stdout ?? "", status: failure.status ?? 1 };
	}
}

/** Two legs up and down one 600 m road, VE exactly 0.3·a + 0.004·f plus a wobble. */
function selection(legs: number): KalmanSelectionInput {
	const n = 120;
	const out: KalmanLegInput[] = [];
	for (let l = 0; l < legs; l++) {
		const up = l % 2 === 0;
		let a = 0;
		let f = 0;
		const leg: KalmanLegInput = {
			label: `Leg ${l + 1}`,
			session: 0,
			timestamps: [],
			power: [],
			speed: [],
			airSpeed: [],
			rho: 1.2,
			distance: [],
			lat: [],
			lon: [],
			elevation: [],
			y: [],
			columns: [[], []],
		};
		for (let k = 0; k < n; k++) {
			if (k > 0) {
				a += up ? 0.005 : 0.03;
				f += 5;
			}
			const g = up ? k : n - 1 - k;
			leg.timestamps.push(k);
			leg.power.push(300);
			leg.speed.push(5);
			leg.airSpeed.push(5);
			leg.distance.push(5 * k);
			leg.lat.push(51 + (5 * g) / 111_320);
			leg.lon.push(7);
			leg.elevation.push(0);
			leg.y.push(
				0.3 * a +
					0.004 * f +
					0.05 * Math.sin(g / 7) +
					0.01 * Math.sin(1.7 * k + l),
			);
			leg.columns[0].push(a);
			leg.columns[1].push(f);
		}
		out.push(leg);
	}
	return {
		names: ["CdA", "Crr"],
		legs: out,
		physics: { mass: 85, eta: 1, cda: 0.3, crr: 0.004 },
		options: { gridM: 5, airSpeed: "measured", fixedCda: null, jumps: true },
	};
}

describe.skipIf(!existsSync(WASM_PATH))("ve-run kalman", () => {
	it("fits a selection from stdin: one JSON line, exit 0", () => {
		const { stdout, status } = run(JSON.stringify(selection(4)), [
			"kalman",
			"--selection",
			"-",
		]);
		expect(status).toBe(0);
		const lines = stdout.trim().split("\n");
		expect(lines).toHaveLength(1);
		const out = JSON.parse(lines[0]);
		expect(out.status).toBe("ok");
		expect(out.fit.names).toEqual(["CdA", "Crr"]);
		expect(out.fit.legs).toBe(4);
	}, 120_000);

	it("names a refusal and exits 4", () => {
		const { stdout, status } = run(JSON.stringify(selection(1)), [
			"kalman",
			"--selection",
			"-",
		]);
		expect(status).toBe(4);
		expect(JSON.parse(stdout.trim()).reason).toBe("tooFewLegs");
	}, 120_000);

	it("rejects malformed input with exit 2", () => {
		const { stdout, status } = run("{not json", ["kalman", "--selection", "-"]);
		expect(status).toBe(2);
		expect(JSON.parse(stdout.trim()).reason).toMatch(/badInput/);
	}, 120_000);
});
