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
 * calculator without a rho array".
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

describe("no site re-introduces its own Crr fallback literal", () => {
	/**
	 * Kills exactly the shape that shipped: a second numeric stand-in for a null
	 * Crr, anywhere in `src`. Matches `?? 0.005`, `|| 0.008` and their spacing
	 * variants when they sit next to a `crr` reference on the same line.
	 *
	 * THE SECOND PATTERN IS F17-06, and it is the reason this test's name is now
	 * true. `requestModeUpdate.ts` declared `const FALLBACK_CRR = 0.008;` — the
	 * same role as `UNSET_CRR_FALLBACK`, an eleventh site, and invisible to the
	 * operator pattern above because a declaration has no `??` or `||` on it.
	 * That is the mechanism by which the measured 0.005/0.008 split survived a
	 * scan written to end it.
	 *
	 * Deliberately a DECLARATION pattern and not a bare `=\s*0\.\d+` on any line
	 * mentioning crr: the loose form matches `crr_min: 0.0015` and
	 * `crr_max: 0.03` in `AnalysisParameters.ts` — real bounds, not fallbacks —
	 * and turns the guard into noise nobody reads.
	 *
	 * Mutation: put `crr ?? 0.005` back into any resolver — `updateModeVEPlots`'s
	 * `resolveAppliedCrr` call is where the computed half lives now — or re-add
	 * `const FALLBACK_CRR = 0.008;` to `requestModeUpdate.ts`, and this fails
	 * naming the file and the line.
	 *
	 * TWO CORRECTIONS TO THE PATTERN, both made when un-exporting internal
	 * symbols exposed them. It was anchored `^\s*(const|let|var)`, so an
	 * `export const` was invisible to it — a fallback declared and exported
	 * would have walked straight past. And it accepted `[0-9.]+`, so it fired on
	 * `const CRR_TEMP_ANCHOR_C = 22`, a TEMPERATURE in degrees C that is not a
	 * Crr value at all and only matched because its name contains "crr". A Crr
	 * fallback is `0.00x`, so the literal is now `0\.\d+`, which is the bar
	 * `asOperator` above already sets. The false positive had been masked by the
	 * `export` keyword rather than by the pattern being right.
	 */
	it("leaves no numeric crr fallback outside the shared module", () => {
		const offenders: string[] = [];
		const asOperator = /(\?\?|\|\|)\s*0\.\d+/;
		const asDeclaration =
			/^\s*(export\s+)?(const|let|var)\s+[A-Za-z_]*[Cc][Rr][Rr][A-Za-z_]*\s*(:\s*[A-Za-z]+\s*)?=\s*0\.\d+/;
		for (const file of sourceFiles(join(__dirname, ".."))) {
			const text = readFileSync(file, "utf8");
			text.split("\n").forEach((line, i) => {
				if (!/crr/i.test(line)) return;
				if (asOperator.test(line) || asDeclaration.test(line)) {
					offenders.push(`${file.split("/src/")[1]}:${i + 1}  ${line.trim()}`);
				}
			});
		}
		expect(offenders).toEqual([]);
	});
});
