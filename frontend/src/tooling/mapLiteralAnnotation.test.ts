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
 * A key is matched against the match's SPANNING LINES with runs of whitespace
 * collapsed to one space (see `siteText`), not against a single physical line.
 * So a key written in prettier's one-line form still matches a site prettier has
 * broken across lines to fit the parameter list.
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
			callback: ".map((lap) => ({",
			why: "fixture JSON shapes, written to disk rather than to a typed consumer",
		},
		{
			file: "scripts/build-out-and-back-fixture.ts",
			callback: ".map((section) => ({",
			why: "fixture JSON shapes, written to disk rather than to a typed consumer",
		},
	];

function isAllowed(file: string, siteText: string): boolean {
	return ALLOWED.some(
		(entry) => entry.file === file && siteText.includes(entry.callback),
	);
}

/**
 * The physical lines a match spans, with runs of whitespace collapsed to one
 * space: from the start of the line the match begins on, through the end of the
 * line it ends on. That collapsed text is what an allow-list key is matched
 * against, and both the offender case and the staleness case use this one rule,
 * so an entry can never be live for one and stale for the other.
 */
function siteText(src: string, match: RegExpExecArray): string {
	const start = src.lastIndexOf("\n", match.index) + 1;
	const nextNewline = src.indexOf("\n", match.index + match[0].length);
	const end = nextNewline === -1 ? src.length : nextNewline;
	return src.slice(start, end).replace(/\s+/g, " ");
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
 * code it guards.
 *
 * It is run over the WHOLE FILE TEXT, not line by line, because prettier is what
 * CREATES the multi-line form: when the parameter list is too wide to hug
 * `.map(`, prettier breaks the callback onto its own line, and a per-line scan's
 * `\s*` can never cross that newline. `npm run check` being green is no help —
 * it is prettier that put the site out of reach. `renderSection3Template.ts` is
 * the live case: a per-line scan calls that file clean.
 *
 * A whole-file scan has no line number of its own, so the reported line is
 * derived from the match offset: the newline count in `src.slice(0, index)`.
 */
const UNANNOTATED_MAP_LITERAL =
	/\.map\(\s*(?:\([^)]*\)|[A-Za-z_$][\w$]*)\s*=>\s*\(\{/g;

/**
 * The unannotated sites in one file's text, as `file:line`. The offender case
 * and the prettier-broken-shape case both go through this one function, so a
 * fixture proving the scan sees a broken site is proving it about the code that
 * actually runs over `src/` and `scripts/` — not about a copy of it.
 */
function unannotatedSites(file: string, src: string): string[] {
	const sites: string[] = [];
	UNANNOTATED_MAP_LITERAL.lastIndex = 0;
	let match: RegExpExecArray | null;
	while ((match = UNANNOTATED_MAP_LITERAL.exec(src)) !== null) {
		const line = src.slice(0, match.index).split("\n").length;
		if (!isAllowed(file, siteText(src, match))) sites.push(`${file}:${line}`);
	}
	return sites;
}

/**
 * Prettier's own output when the parameter list is too wide to hug `.map(`: the
 * callback sits on its own line, so the site's `.map(` and its `=> ({` are on
 * different physical lines and a per-line scan can never join them. The
 * annotated twin is the same shape carrying `: T` on the callback.
 */
const PRETTIER_BROKEN =
	"\tconst xs: T[] = ys.map(\n\t\t(y: SomeWideType, i: number) => ({\n\t\t\ta: y,\n\t\t}),\n\t);";
const PRETTIER_BROKEN_ANNOTATED =
	"\tconst xs: T[] = ys.map(\n\t\t(y: SomeWideType, i: number): T => ({\n\t\t\ta: y,\n\t\t}),\n\t);";

describe("map callbacks building object literals annotate their return type", () => {
	it("has no unannotated site in production source", () => {
		const offenders: string[] = [];
		for (const root of ROOTS) {
			for (const file of sourceFiles(root)) {
				offenders.push(...unannotatedSites(file, readFileSync(file, "utf8")));
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
			// The same whole-file rule the offender case uses, so an entry keyed to
			// a site prettier broke across lines is not called stale.
			const texts: string[] = [];
			UNANNOTATED_MAP_LITERAL.lastIndex = 0;
			let match: RegExpExecArray | null;
			while ((match = UNANNOTATED_MAP_LITERAL.exec(src)) !== null) {
				texts.push(siteText(src, match));
			}
			return !texts.some((text) => text.includes(entry.callback));
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
		// The two assertions on the prettier-broken shape establish one property
		// and only one: the PATTERN itself spans newlines, which is the
		// precondition for scanning whole files rather than lines. They say
		// nothing about the scan — the scan's own guard is the case below,
		// "reports a site prettier has broken across lines" (PR #23, F37-01,
		// F38-01).

		UNANNOTATED_MAP_LITERAL.lastIndex = 0;
		expect(UNANNOTATED_MAP_LITERAL.test(unannotated)).toBe(true);
		UNANNOTATED_MAP_LITERAL.lastIndex = 0;
		expect(UNANNOTATED_MAP_LITERAL.test(bare)).toBe(true);
		UNANNOTATED_MAP_LITERAL.lastIndex = 0;
		expect(UNANNOTATED_MAP_LITERAL.test(annotated)).toBe(false);
		UNANNOTATED_MAP_LITERAL.lastIndex = 0;
		expect(UNANNOTATED_MAP_LITERAL.test(PRETTIER_BROKEN)).toBe(true);
		UNANNOTATED_MAP_LITERAL.lastIndex = 0;
		expect(UNANNOTATED_MAP_LITERAL.test(PRETTIER_BROKEN_ANNOTATED)).toBe(false);
	});

	it("reports a site prettier has broken across lines", () => {
		// The regression guard for the whole-file scan itself (PR #23, F37-01,
		// F38-01). A per-line scan cannot cross the newline prettier inserts, so
		// reverting `unannotatedSites` to a line-by-line pass makes this case fail.
		// It goes through the same `unannotatedSites` the offender case uses; a
		// second copy of the loop here would guard nothing.
		expect(unannotatedSites("src/fake-fixture.ts", PRETTIER_BROKEN)).toEqual([
			"src/fake-fixture.ts:1",
		]);
		expect(
			unannotatedSites("src/fake-fixture.ts", PRETTIER_BROKEN_ANNOTATED),
		).toEqual([]);
	});
});
