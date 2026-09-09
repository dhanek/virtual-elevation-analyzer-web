/**
 * ONE FALLBACK FOR AN UNSET Crr, ACROSS THE ANALYZE LEG AND THE SLIDER.
 *
 * The defect this guards was measured, not theorised: on a file with no stored
 * parameter record, Standard's analyze leg computed at `crr ?? 0.005` while its
 * slider rendered `crr || 0.008`. The post-bind kick reads the slider, so the
 * panel painted `0.8264 / 3.56 m / −7.32 m` and replaced it 16 ms later with
 * `0.8200 / 4.56 m / −9.07 m`. Instrumenting `createVeCalculator` showed the two
 * calls differing in `crr` alone — 0.005 vs 0.008 — with CdA, trim, rho array,
 * wind series, altitude and sample count byte-identical.
 *
 * The behavioural case below is the invariant. The source scan after it is the
 * one that actually stops the defect returning, because the defect is an
 * OMISSION — a site that quietly reintroduces its own literal — which no test of
 * this module's own exports can observe. Same reasoning as
 * `calculatorRhoArray.test.ts`'s source scan, under "no analyze leg builds a
 * calculator without a rho array". A third part, `CRR_FALLBACK_MATRIX` and the
 * block that walks it, pins every shape this guard has been wrong about in one
 * run, so a fix aimed at one row cannot quietly cost another — which is what
 * each of the previous two attempts did.
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
	UNSET_CDA_FALLBACK,
	UNSET_CRR_FALLBACK,
	resolveDisplayCda,
	resolveDisplayCrr,
} from "./unsetParameterFallbacks";

describe("the unset-Crr fallback", () => {
	/** Kills a resolver that returns its own literal instead of the shared one. */
	it("resolves a null Crr to the one shared value", () => {
		expect(resolveDisplayCrr(null)).toBe(UNSET_CRR_FALLBACK);
		expect(resolveDisplayCrr(undefined)).toBe(UNSET_CRR_FALLBACK);
	});

	/** Kills a resolver that overrides a real stored value with the fallback. */
	it("passes a set Crr through untouched, including values below the fallback", () => {
		expect(resolveDisplayCrr(0.005)).toBe(0.005);
		expect(resolveDisplayCrr(0.0015)).toBe(0.0015);
		expect(resolveDisplayCrr(0)).toBe(0);
	});

	/** The CdA half, same two properties. */
	it("resolves CdA the same way", () => {
		expect(resolveDisplayCda(null)).toBe(UNSET_CDA_FALLBACK);
		expect(resolveDisplayCda(0.21)).toBe(0.21);
	});

	/**
	 * The value itself is pinned, because the whole defect was two sites
	 * disagreeing about it. GPS-lap and out-and-back already used 0.008 on both
	 * halves; changing this constant silently re-splits Standard from them.
	 */
	it("is 0.008, the value the other two modes already used", () => {
		expect(UNSET_CRR_FALLBACK).toBe(0.008);
	});
});

/** Every `.ts` under src, excluding this module and the tests. */
function sourceFiles(dir: string, out: string[] = []): string[] {
	for (const entry of readdirSync(dir)) {
		const full = join(dir, entry);
		if (statSync(full).isDirectory()) {
			sourceFiles(full, out);
		} else if (
			entry.endsWith(".ts") &&
			!entry.endsWith(".test.ts") &&
			!entry.startsWith("unsetParameterFallbacks")
		) {
			out.push(full);
		}
	}
	return out;
}

/** Any numeric literal, however spelled: `0.008`, `.008`, `8e-3`. */
const NUMBER = String.raw`\d*\.?\d+(?:e-?\d+)?`;

/**
 * `?? 0.005`, `|| 0.008` and their spacing variants.
 *
 * GLOBAL, and the alternation is non-capturing so the number is group 1 here
 * exactly as it is in `asDeclaration`. Read it ONLY through `matchAll` — never
 * `.exec()` or `.test()`: a `g` regex carries `lastIndex` across calls, so a
 * shared instance driven by `exec` would start mid-line and skip lines at
 * random. `matchAll` clones the regex, which leaves this instance stateless.
 */
const asOperator = new RegExp(String.raw`(?:\?\?|\|\|)\s*(${NUMBER})`, "g");

/**
 * `const FALLBACK_CRR = 0.008;`, exported or not. `^` admits at most one match
 * per line, so this one stays non-global and its `NUMBER` is the sole group.
 */
const asDeclaration = new RegExp(
	String.raw`^\s*(?:export\s+)?(?:const|let|var)\s+[A-Za-z_]*[Cc][Rr][Rr][A-Za-z_]*\s*(?::\s*[A-Za-z]+\s*)?=\s*(${NUMBER})`,
);

/**
 * A Crr is a rolling-resistance coefficient: greater than zero and well under
 * 1. The upper bound rejects `CRR_TEMP_ANCHOR_C = 22`; the lower one rejects
 * `crr: oldRecord.crr ?? 0`, a null-coalesce in a storage migration rather than
 * a physics constant — which the original `0\.\d+` excluded by accident of
 * spelling and this must exclude on purpose.
 */
const isCrrSized = (value: string) => {
	const n = Number(value);
	return n > 0 && n < 1;
};

/**
 * Does this ONE line re-introduce a numeric Crr fallback?
 *
 * Kills exactly the shape that shipped: a second numeric stand-in for a null
 * Crr, anywhere in `src`. Matches `?? 0.005`, `|| 0.008` and their spacing
 * variants when they sit next to a `crr` reference on the same line.
 *
 * THE SECOND PATTERN IS F17-06, and it is the reason the scan below can claim
 * its name. `requestModeUpdate.ts` declared `const FALLBACK_CRR = 0.008;` — the
 * same role as `UNSET_CRR_FALLBACK`, an eleventh site, and invisible to the
 * operator pattern because a declaration has no `??` or `||` on it. That is the
 * mechanism by which the measured 0.005/0.008 split survived a scan written to
 * end it.
 *
 * Deliberately a DECLARATION pattern and not a bare `=\s*0\.\d+` on any line
 * mentioning crr: the loose form matches `crr_min: 0.0015` and
 * `crr_max: 0.03` in `AnalysisParameters.ts` — real bounds, not fallbacks —
 * and turns the guard into noise nobody reads.
 *
 * Mutation: put `crr ?? 0.005` back into any resolver — `updateModeVEPlots`'s
 * `resolveAppliedCrr` call is where the computed half lives now — or re-add
 * `const FALLBACK_CRR = 0.008;` to `requestModeUpdate.ts`, and the scan fails
 * naming the file and the line.
 *
 * THREE CORRECTIONS, each one made after the previous fix opened a new hole.
 *
 * BLIND SPOT: it was anchored `^\s*(const|let|var)`, so an `export const`
 * was invisible — a fallback declared and exported walked straight past the
 * guard built to catch it.
 *
 * FALSE POSITIVE: it accepted `[0-9.]+`, so it fired on
 * `const CRR_TEMP_ANCHOR_C = 22`, a TEMPERATURE in degrees C that is not a
 * Crr value and matched only because its name contains "crr".
 *
 * THE SECOND FIX IS ON THE VALUE, NOT ITS SPELLING, and that is deliberate.
 * Narrowing the literal to `0\.\d+` fixed the false positive and introduced
 * two blind spots in its place — `.008` (which the ORIGINAL pattern caught)
 * and `8e-3`. Both are legal TypeScript and both are Crr-sized. Any pattern
 * describing how a number is WRITTEN will keep losing this race, so the
 * literal is matched broadly and then parsed: what disqualifies
 * `CRR_TEMP_ANCHOR_C` is that 22 is not a plausible Crr, and no spelling of
 * 22 ever will be.
 *
 * POSITION DEPENDENCE, the third correction and the reason this function
 * exists. Matching broadly and parsing is right, but it was done through
 * `asOperator.exec(line) ?? asDeclaration.exec(line)`, and BOTH halves of that
 * take only the first thing they find: `exec` returns the FIRST match on the
 * line, and `??` stops at the first non-null result. So a Crr fallback hid
 * behind any earlier coalesce — `{ count: n ?? 0, crr: s.crr ?? 0.008 }` —
 * and a declaration hid behind any `??` on its own line, because once
 * `asOperator` matched at all, even on a value `isCrrSized` rejects,
 * `asDeclaration` was never tried. The scan is now over EVERY match of BOTH
 * patterns on the line, and the line is flagged when ANY captured number is
 * Crr-sized. Position on the line no longer decides whether the guard can see
 * the defect.
 *
 * `CRR_FALLBACK_MATRIX` below pins all nine shapes in one run; it is the
 * artefact this guard has lacked through three attempts, each of which was
 * verified against the single case that prompted it and against nothing else.
 */
function crrFallbackHit(line: string): boolean {
	if (!/crr/i.test(line)) return false;
	const candidates = [...line.matchAll(asOperator)].map((match) => match[1]);
	const declaration = asDeclaration.exec(line);
	if (declaration) candidates.push(declaration[1]);
	return candidates.some(isCrrSized);
}

describe("no site re-introduces its own Crr fallback literal", () => {
	it("leaves no numeric crr fallback outside the shared module", () => {
		const offenders: string[] = [];
		for (const file of sourceFiles(join(__dirname, ".."))) {
			const text = readFileSync(file, "utf8");
			text.split("\n").forEach((line, i) => {
				if (crrFallbackHit(line)) {
					offenders.push(`${file.split("/src/")[1]}:${i + 1}  ${line.trim()}`);
				}
			});
		}
		expect(offenders).toEqual([]);
	});
});

/**
 * Every shape this guard has ever been wrong about, plus the spellings a
 * previous narrowing lost, run TOGETHER. A fix aimed at one row may not quietly
 * cost another — which is how the last two attempts each traded one hole for
 * the next.
 *
 * Safe to spell the offending literals out here: `sourceFiles` skips every
 * `*.test.ts` and every file whose name starts with `unsetParameterFallbacks`,
 * so the tree scan above cannot read this array and report itself.
 */
const CRR_FALLBACK_MATRIX: ReadonlyArray<{ line: string; fires: boolean }> = [
	// Round 40: silent on this branch — not the first coalesce on the line.
	{ line: "return { count: n ?? 0, crr: s.crr ?? 0.008 };", fires: true },
	// Round 40: silent on this branch — `asDeclaration` was never reached.
	{
		line: "const FALLBACK_CRR = 0.008; // previously stored.crr ?? 0",
		fires: true,
	},
	// F17-06, the shape that actually shipped.
	{ line: "const FALLBACK_CRR = 0.008;", fires: true },
	// The spelling the `0\.\d+` narrowing lost.
	{ line: "const FALLBACK_CRR = .008;", fires: true },
	// Spelling.
	{ line: "const FALLBACK_CRR = 0.0080;", fires: true },
	// The other spelling the `0\.\d+` narrowing lost.
	{ line: "const FALLBACK_CRR = 8e-3;", fires: true },
	// The `export` blind spot `bbdf51f` closed; it must stay closed.
	{ line: "export const FALLBACK_CRR = 0.008;", fires: true },
	// The false positive the value check fixed: 22 degrees C fails `isCrrSized`.
	{ line: "const CRR_TEMP_ANCHOR_C = 22;", fires: false },
	// The documented lower-bound exclusion: a storage migration, not a fallback.
	{ line: "crr: oldRecord.crr ?? 0", fires: false },
];

describe("the per-line Crr-fallback check", () => {
	for (const row of CRR_FALLBACK_MATRIX) {
		it(`${row.fires ? "fires on" : "ignores"}: ${row.line}`, () => {
			expect(crrFallbackHit(row.line)).toBe(row.fires);
		});
	}
});
