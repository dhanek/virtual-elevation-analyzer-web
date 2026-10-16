import { execSync } from "node:child_process";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * EVERY TRACE TYPE THE APP DRAWS IS ONE THE BUNDLED PLOTLY REGISTERS.
 *
 * `plotlyBundle.ts` builds Plotly from source: core (which carries `scatter`)
 * plus the trace modules it imports. A trace whose `type` is not registered
 * renders as nothing — no error, no console warning — and every unit test
 * still passes, because the builders only return figure objects. Under the
 * old prebuilt cartesian bundle `bar`, `heatmap` or `histogram` drew; under
 * the source build they silently do not.
 *
 * Everything compared is READ from the repository: the registered set from
 * `plotlyBundle.ts`'s imports, the set of names that are Plotly trace types
 * from plotly.js's own `src/traces/` directory, and the source files from
 * `git ls-files`. A `type: "…"` literal that is not a trace type (a shape's
 * `"line"`, a contour's `"levels"`) is ignored.
 */

/** The frontend package root, i.e. the directory holding `package.json`. */
const PACKAGE_ROOT = fileURLToPath(new URL("../../", import.meta.url));

function registeredTypes(): Set<string> {
	const bundle = readFileSync(
		join(PACKAGE_ROOT, "src/shell/analysis/plotlyBundle.ts"),
		"utf8",
	);
	const types = new Set<string>();
	for (const match of bundle.matchAll(/from "plotly\.js\/lib\/([a-z0-9]+)"/g)) {
		// `core` registers `scatter` itself.
		types.add(match[1] === "core" ? "scatter" : match[1]);
	}
	return types;
}

function plotlyTraceTypes(): Set<string> {
	return new Set(
		readdirSync(join(PACKAGE_ROOT, "node_modules/plotly.js/src/traces"), {
			withFileTypes: true,
		})
			.filter((entry) => entry.isDirectory())
			.map((entry) => entry.name),
	);
}

/** `file:line  type` for every trace-type literal in non-test source. */
function traceTypeLiterals(traceTypes: Set<string>): Array<[string, string]> {
	const files = execSync("git ls-files src", {
		cwd: PACKAGE_ROOT,
		encoding: "utf8",
	})
		.split("\n")
		.filter((f) => /\.tsx?$/.test(f) && !/\.test\.tsx?$/.test(f));
	const found: Array<[string, string]> = [];
	for (const file of files) {
		const lines = readFileSync(join(PACKAGE_ROOT, file), "utf8").split("\n");
		lines.forEach((line, i) => {
			for (const match of line.matchAll(/\btype:\s*["']([a-z0-9]+)["']/g)) {
				if (traceTypes.has(match[1])) {
					found.push([`${file}:${i + 1}`, match[1]]);
				}
			}
		});
	}
	return found;
}

describe("trace types the bundled Plotly registers", () => {
	const registered = registeredTypes();
	const traceTypes = plotlyTraceTypes();
	const literals = traceTypeLiterals(traceTypes);

	it("reads a non-empty registered set and trace-type list", () => {
		expect(registered.has("scatter")).toBe(true);
		expect(registered.size).toBeGreaterThan(1);
		expect(traceTypes.has("bar")).toBe(true);
		expect(traceTypes.has("scatter")).toBe(true);
	});

	it("finds a literal for every registered type, so the scan is not vacuous", () => {
		const types = new Set(literals.map(([, type]) => type));
		for (const type of registered) {
			expect(types.has(type), type).toBe(true);
		}
	});

	it("uses no trace type the bundle leaves out", () => {
		const unregistered = literals
			.filter(([, type]) => !registered.has(type))
			.map(([where, type]) => `${where}  ${type}`);
		expect(unregistered).toEqual([]);
	});
});
