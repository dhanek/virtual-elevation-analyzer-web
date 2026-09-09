/**
 * EVERY `xs.map(x => ({ … }))` IN PRODUCTION SOURCE MUST ANNOTATE ITS CALLBACK
 * RETURN, because that is the only form `tsc` actually checks.
 *
 * Excess-property checking fires where a FRESH object literal meets an
 * annotated target. It does not fire through `Array<T>.map<U>`: `U` is inferred
 * from the callback's own return expression before any contextual type reaches
 * it, and the literal's freshness is lost across that inference. Measured, not
 * reasoned — all four forms compiled under `--strict`:
 *
 *   function f(xs: number[]): T[] { return xs.map(x => ({a: x, bogus: 1})) }
 *       -> NO ERROR. An annotated RETURN TYPE does not arm the check.
 *   const out: T[] = xs.map(x => ({a: x, bogus: 1}))
 *       -> NO ERROR. An annotated BINDING does not arm it either.
 *   return xs.map((x): T => ({a: x, bogus: 1}))
 *       -> TS2353. The callback return annotation is the one that works.
 *   const t: T = {a: 1, bogus: 1}
 *       -> TS2353, the baseline.
 *
 * That is why this guard checks the callback and nothing else, and why a site
 * inside a function that already declares `: T[]` is NOT exempt — it looks
 * checked and is not.
 *
 * WHAT IT COST TO LEARN. `LapVEProfile.range` was deleted from its type and its
 * writers in a fifteen-file sweep, and one writer survived in an unannotated
 * `.map` where `tsc` could not see it. It was found by a reviewer reading the
 * diff, not by any check (PR #21, F32-02). This file is that check.
 *
 * Tests are excluded: a fixture literal deliberately carrying an unexpected
 * shape is a legitimate thing for a test to build.
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const ROOTS = ["src", "scripts"];

/**
 * Sites whose literal reaches NO declared type, so there is nothing for a field
 * to rot against and an annotation would have to invent a type to satisfy this
 * guard. Keyed by file and by the callback's own text — NOT by line number.
 *
 * That choice is deliberate and was learned the hard way on this branch: a
 * line-keyed version of this list broke the moment prettier reflowed a file, and
 * PR #21 spent four review rounds on line-number citations decaying under edits
 * that grew a comment. A key that moves with the code cannot go stale silently.
 *
 * The list is the reason this guard is not simply "annotate every `.map`". The
 * defect class is a literal flowing into a DECLARED type while carrying a field
 * that type no longer has; a purely local shape cannot be in that class.
 */
const ALLOWED: ReadonlyArray<{ file: string; callback: string; why: string }> =
	[
		{
			file: "src/modes/analysis/segmentSummary.ts",
			callback: ".map((indices) => ({ indices }))",
			why: "local `{ indices }`, consumed in the same function",
		},
		{
			file: "src/modes/analysis/standardMode.ts",
			callback: ".map((lapNumber) => ({",
			why: "local `{ lapNumber, lap }`, filtered and destructured immediately",
		},
		{
			file: "src/plots/StandardPlotBuilders.ts",
			callback: "corners.map((corner) => ({",
			why: "local `{ ...corner, score }` scoring shape, never leaves the function",
		},
		{
			file: "src/shell/analysis/analyzeOrchestrator.ts",
			callback: ".map((lapNumber) => ({",
			why: "local `{ lapNumber, lap }` pairing, consumed in the same block",
		},
		{
			file: "scripts/build-golden-fixture.ts",
			callback: ".map(",
			why: "fixture JSON shapes, written to disk rather than to a typed consumer",
		},
		{
			file: "scripts/build-out-and-back-fixture.ts",
			callback: ".map(",
			why: "fixture JSON shapes, written to disk rather than to a typed consumer",
		},
	];

function isAllowed(file: string, line: string): boolean {
	return ALLOWED.some(
		(entry) => entry.file === file && line.includes(entry.callback),
	);
}

function sourceFiles(dir: string): string[] {
	const out: string[] = [];
	for (const name of readdirSync(dir)) {
		const path = join(dir, name);
		if (statSync(path).isDirectory()) {
			if (name === "__fixtures__" || name === "node_modules") continue;
			out.push(...sourceFiles(path));
			continue;
		}
		if (!name.endsWith(".ts") || name.endsWith(".test.ts")) continue;
		out.push(path);
	}
	return out;
}

/**
 * A `.map(` callback opening an object literal, with no `): Type =>` between
 * the parameter list and the arrow. Deliberately textual: the alternative is a
 * TypeScript AST pass, and this guard has to run in the unit suite beside the
 * code it guards. The cost of being textual is that it cannot see a callback
 * spread over unusual formatting; prettier normalises that, and `npm run check`
 * enforces prettier.
 */
const UNANNOTATED_MAP_LITERAL =
	/\.map\(\s*(?:\([^)]*\)|[A-Za-z_$][\w$]*)\s*=>\s*\(\{/g;

describe("map callbacks building object literals annotate their return type", () => {
	it("has no unannotated site in production source", () => {
		const offenders: string[] = [];
		for (const root of ROOTS) {
			for (const file of sourceFiles(root)) {
				const src = readFileSync(file, "utf8");
				const lines = src.split("\n");
				lines.forEach((line, i) => {
					UNANNOTATED_MAP_LITERAL.lastIndex = 0;
					if (!UNANNOTATED_MAP_LITERAL.test(line)) return;
					const site = `${file}:${i + 1}`;
					if (!isAllowed(file, line)) offenders.push(site);
				});
			}
		}

		expect(offenders).toEqual([]);
	});

	it("has no stale allow-list entry", () => {
		// An entry whose file or callback text no longer exists must leave the
		// list, or the list grows into a place real offenders can hide.
		const stale = ALLOWED.filter((entry) => {
			let src: string;
			try {
				src = readFileSync(entry.file, "utf8");
			} catch {
				return true;
			}
			return !src.split("\n").some((line) => {
				UNANNOTATED_MAP_LITERAL.lastIndex = 0;
				return (
					line.includes(entry.callback) && UNANNOTATED_MAP_LITERAL.test(line)
				);
			});
		});

		expect(stale.map((entry) => `${entry.file} :: ${entry.callback}`)).toEqual(
			[],
		);
	});

	it("the pattern actually matches an unannotated callback, and spares an annotated one", () => {
		// Without this the case above passes when the regex matches nothing at
		// all — the vacuous-guard failure this repo has been bitten by before.
		const unannotated = "\treturn xs.map((x) => ({ a: x }));";
		const annotated = "\treturn xs.map((x): T => ({ a: x }));";
		const bare = "\treturn xs.map(x => ({ a: x }));";

		UNANNOTATED_MAP_LITERAL.lastIndex = 0;
		expect(UNANNOTATED_MAP_LITERAL.test(unannotated)).toBe(true);
		UNANNOTATED_MAP_LITERAL.lastIndex = 0;
		expect(UNANNOTATED_MAP_LITERAL.test(bare)).toBe(true);
		UNANNOTATED_MAP_LITERAL.lastIndex = 0;
		expect(UNANNOTATED_MAP_LITERAL.test(annotated)).toBe(false);
	});
});
