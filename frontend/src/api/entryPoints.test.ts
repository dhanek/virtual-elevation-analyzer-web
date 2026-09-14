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

		for (const path of walk(SRC_ROOT)) {
			const source = readFileSync(path, "utf8");
			for (const match of source.matchAll(importStatement)) {
				if (match[1]) continue; // type-only
				valueImporters.push(
					path.slice(SRC_ROOT.length + 1).replace(/\\/g, "/"),
				);
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
