/**
 * THE TWO-IMPORTER RULE, AS A PROPERTY (Convergence plan, C7).
 *
 * `updateModeVEPlots` is allowed exactly two importers — the browser funnel
 * and the headless runner, one per surface. That rule lived only in a header
 * comment; this test makes it checkable the way the repo pins its other
 * structural claims (`resultColumns.test.ts`, `modeControlBindingCoverage`).
 * The match is on IMPORT SPECIFIERS, not the bare identifier — a dozen files
 * mention the name in prose.
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const SRC_ROOT = join(process.cwd(), "src");

function* walk(dir: string): Generator<string> {
	for (const entry of readdirSync(dir)) {
		const path = join(dir, entry);
		if (statSync(path).isDirectory()) {
			yield* walk(path);
		} else if (path.endsWith(".ts") && !path.endsWith(".test.ts")) {
			yield path;
		}
	}
}

describe("updateModeVEPlots has one funnel per surface", () => {
	it("is VALUE-imported by exactly the browser funnel and the headless runner", () => {
		const valueImporters: string[] = [];
		// A statement importing the module; `import type` lines are erased at
		// compile time and cannot call anything, so they do not count.
		const importStatement =
			/import\s+(type\s+)?[^;]*from\s+["'][^"']*\/updateModeVEPlots(?:\.ts)?["']/g;
		// A dynamic import loads the module's values, so it always counts.
		const dynamicImport =
			/import\s*\(\s*["'][^"']*\/updateModeVEPlots(?:\.ts)?["']\s*\)/g;
		// A re-export hands the values on; `export type` is erased like `import type`.
		// Anchored to a line start so the word "export" in prose cannot open a match.
		const reExport =
			/^\s*export\s+(type\s+)?[^;]*from\s+["'][^"']*\/updateModeVEPlots(?:\.ts)?["']/gm;

		for (const path of walk(SRC_ROOT)) {
			const source = readFileSync(path, "utf8");
			const relative = path.slice(SRC_ROOT.length + 1).replace(/\\/g, "/");
			for (const match of source.matchAll(importStatement)) {
				if (match[1]) continue; // type-only
				valueImporters.push(relative);
			}
			for (const _match of source.matchAll(dynamicImport)) {
				valueImporters.push(relative);
			}
			for (const match of source.matchAll(reExport)) {
				if (match[1]) continue; // type-only
				valueImporters.push(relative);
			}
		}

		// (Test files are excluded by the walk: the round-trip test drives the
		// primitive directly as its reference, which is a harness, not a caller.)
		expect(valueImporters.sort()).toEqual([
			"api/runAnalysis.ts",
			"shell/analysis/requestModeUpdate.ts",
		]);
	});
});

/**
 * NO SECOND COPY OF THE MATHS (Bundle I, I2 — the maintainer's condition that
 * the headless path "uses the same code").
 *
 * `headlessCallbacks.ts` is the one place a headless-only aggregate could
 * grow: it picks which aggregate a mode uses, and the easy fix for any
 * mismatch would be a local mean. It may only delegate — every mode's number
 * comes from a `compute…Aggregate` the browser panel also calls — so any
 * arithmetic of its own is a fork, and fails here. The parity test in
 * `apiGolden.wasm.test.ts` checks the numbers; this checks the shape that
 * keeps them equal when nobody is running that test.
 */
describe("the headless path computes nothing of its own", () => {
	it("headlessCallbacks only delegates to the screens' aggregate functions", () => {
		const source = readFileSync(
			join(SRC_ROOT, "api/headlessCallbacks.ts"),
			"utf8",
		)
			.replace(/\/\*[\s\S]*?\*\//g, "")
			.replace(/\/\/.*$/gm, "");
		const arithmetic = [
			/\.reduce\s*\(/,
			/\bMath\./,
			/\bfor\s*\(/,
			/\bwhile\s*\(/,
			/[^=!<>]=\s*[^=>][^;\n]*[+\-*/]\s*[\w(]/,
		].filter((pattern) => pattern.test(source));
		expect(arithmetic).toEqual([]);

		const returned = [...source.matchAll(/return\s+(\w+)\s*\(/g)].map(
			(match) => match[1],
		);
		expect(returned.sort()).toEqual([
			"computeGpsLapAggregate",
			"computeOutAndBackAggregate",
			"computeStandardAggregate",
		]);
	});

});
