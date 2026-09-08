/**
 * EVERY CALCULATOR GETS A RHO ARRAY — THE PRESENCE HALF.
 *
 * Restored from `selectionRhoArray.test.ts`, which was deleted whole when the
 * two dead resolvers went. That file held two unrelated properties and said so
 * nowhere, so a deletion aimed at the first — a unit test of
 * `resolveSelectionRhoArray`, a function with no caller left — took this one
 * with it. Only the source-level case came back; the resolver's own cases are
 * correctly gone.
 *
 * WHAT THE OTHER FILE COVERS, so this cannot happen again. The BEHAVIOURAL half
 * lives in `gpsModeRealChain.test.ts` ("the air-density slice under the
 * calculator"): it drives the real chain and inspects the values that actually
 * reach the physics — that a rho array is as long as its `timestamps`, that
 * every element is finite, and that a short channel falls back to `null` rather
 * than a hole-punched array. Those are runtime values and nothing here can see
 * them. This file asserts only that a `rhoArray:` is PRESENT at all. Neither
 * file subsumes the other; deleting either loses real coverage.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

describe("no analyze leg builds a calculator without a rho array", () => {
	/**
	 * Source-level, deliberately. The case is STRUCTURAL, NOT BEHAVIOURAL: the
	 * property is "no leg was forgotten", and the thing that makes a leg wrong
	 * is an omission — which no test of the leg's own module can observe,
	 * because the omitted argument simply is not there to assert on. Standard
	 * was the leg this case would have caught.
	 *
	 * The list spans BOTH PATHS now, and the two ends assert different things
	 * with the same body: the three render legs assert that no analyze leg
	 * re-acquires a calculator after the retirement, and `updateModeVEPlots.ts`
	 * — the path that does compute — asserts that it never builds one without a
	 * rho array.
	 *
	 * FRAGILITY, so nobody tidies it into a bug: the count pattern is
	 * `createVeCalculator({` and the `({` is LOAD-BEARING.
	 * `renderStandardVe.ts:116` contains the bare identifier
	 * `createVeCalculator` inside the comment recording what the analyze-leg
	 * retirement removed, and it is not counted precisely because it lacks the
	 * `({`. Relax the pattern to a bare identifier and the retired-leg branch
	 * below goes red on a comment.
	 */
	const legs = [
		"../ve/renderStandardVe.ts",
		"../gpsLap/renderGpsLap.ts",
		"../outAndBack/renderOutAndBack.ts",
		"./updateModeVEPlots.ts",
	];

	for (const leg of legs) {
		it(`${leg} passes rhoArray to createVeCalculator, or builds no calculator at all`, () => {
			const source = readFileSync(
				fileURLToPath(new URL(leg, import.meta.url)),
				"utf8",
			);

			const calculatorCalls = source.split("createVeCalculator({").length - 1;

			// A RETIRED LEG, and this is how one is recognised rather than
			// silently tolerated. Once a leg stops computing, the pairing below
			// has nothing to pair and "zero calculators" would make the case pass
			// for the wrong reason — the vacuity the `> 0` guard was there to
			// prevent. So the guard becomes conditional on the IMPORT: a leg that
			// still pulls in `VeCalculatorFactory` must build at least one
			// calculator and give every one of them a rho array; a leg that does
			// not import it must build none, and that absence is asserted rather
			// than assumed. `updateModeVEPlots` is where the property lives for a
			// retired leg, and it is now in the list above rather than only in
			// `gpsModeRealChain.test.ts`.
			const importsCalculatorFactory =
				/from\s+["'][^"']*VeCalculatorFactory["']/.test(source);
			if (!importsCalculatorFactory) {
				expect(calculatorCalls).toBe(0);
				return;
			}

			expect(calculatorCalls).toBeGreaterThan(0);
			expect(source.split(/\brhoArray:/).length - 1).toBe(calculatorCalls);
		});
	}
});
