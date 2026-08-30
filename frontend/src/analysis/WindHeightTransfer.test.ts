import { describe, expect, test } from "vitest";
import {
	DEFAULT_WIND_HEIGHT_FACTOR,
	LEGACY_WIND_HEIGHT_FACTOR,
	resolveAppliedWindSpeed,
	resolveWindHeightFactor,
	WIND_HEIGHT_FACTOR_MAX,
	WIND_HEIGHT_FACTOR_MIN,
	WIND_HEIGHT_FACTOR_STEP,
	WIND_HEIGHT_FITTED_MAX,
	WIND_HEIGHT_FITTED_MIN,
	WIND_HEIGHT_PERCENT_MAX,
	WIND_HEIGHT_PERCENT_MIN,
	WIND_HEIGHT_PERCENT_STEP,
	factorToPercent,
	percentToFactor,
	type WindHeightTransferParams,
} from "./WindHeightTransfer";

describe("resolveWindHeightFactor", () => {
	test("returns the legacy factor when no factor is stored", () => {
		expect(resolveWindHeightFactor({})).toBe(LEGACY_WIND_HEIGHT_FACTOR);
	});

	test("returns the legacy factor when the factor is explicitly undefined", () => {
		expect(
			resolveWindHeightFactor({ wind_height_factor: undefined }),
		).toBe(LEGACY_WIND_HEIGHT_FACTOR);
	});

	// A record read back from IndexedDB can hold anything (T-08-01); every
	// unusable value must degrade to today's behaviour, never to NaN wind.
	//
	// `zero` LEFT this table under D-b: once the control spans 0-100%, a stored
	// 0 is a choice ("no wind reaches the rider"), not corruption. It is pinned
	// as such in "resolveWindHeightFactor at zero" below.
	const unusableFactors: Array<[string, number]> = [
		["NaN", NaN],
		["Infinity", Infinity],
		["-Infinity", -Infinity],
		["a negative factor", -0.5],
	];

	test.each(unusableFactors)(
		"returns the legacy factor for %s",
		(_label, factor) => {
			expect(resolveWindHeightFactor({ wind_height_factor: factor })).toBe(
				LEGACY_WIND_HEIGHT_FACTOR,
			);
		},
	);

	test("returns the legacy factor for a non-number in a corrupt record", () => {
		const corrupt = {
			wind_height_factor: "0.5",
		} as unknown as WindHeightTransferParams;
		expect(resolveWindHeightFactor(corrupt)).toBe(LEGACY_WIND_HEIGHT_FACTOR);
	});

	const storedFactors: Array<[number]> = [[0.5], [0.65], [0.3]];

	test.each(storedFactors)("returns a stored %f verbatim", (factor) => {
		expect(resolveWindHeightFactor({ wind_height_factor: factor })).toBe(
			factor,
		);
	});

	test("returns a value outside the slider range unchanged, not narrowed", () => {
		// Deliberate: silently rewriting a persisted user choice to fit the
		// current slider bounds is the class of bug D-03 exists to avoid.
		expect(resolveWindHeightFactor({ wind_height_factor: 1.5 })).toBe(1.5);
	});

	test("resolves independently of wind_entry", () => {
		// Provenance must never leak into the physics: the resolver stays a
		// pure numeric guard.
		expect(
			resolveWindHeightFactor({
				wind_entry: "unknown",
				wind_height_factor: 1.0,
			}),
		).toBe(1.0);
	});
});

describe("resolveAppliedWindSpeed", () => {
	test("is bit-identical to the untransferred wind at k = 1.0", () => {
		// toBe, not toBeCloseTo: x * 1.0 === x is exact in IEEE754 and the
		// parity claim is an exactness claim.
		expect(resolveAppliedWindSpeed({ wind_height_factor: 1.0 }, 3.5)).toBe(3.5);
		expect(resolveAppliedWindSpeed({ wind_height_factor: 1.0 }, 0.1)).toBe(0.1);
		expect(resolveAppliedWindSpeed({ wind_height_factor: 1.0 }, 7.3333)).toBe(
			7.3333,
		);
		expect(resolveAppliedWindSpeed({ wind_height_factor: 1.0 }, 29.9)).toBe(
			29.9,
		);
	});

	test("leaves the wind untouched when the params carry no factor", () => {
		// The pre-feature record shape.
		expect(resolveAppliedWindSpeed({}, 3.5)).toBe(3.5);
	});

	test("leaves the wind untouched for a normalised legacy record", () => {
		expect(resolveAppliedWindSpeed({ wind_entry: "unknown" }, 3.5)).toBe(3.5);
	});

	test("halves the wind at the default factor", () => {
		expect(resolveAppliedWindSpeed({ wind_height_factor: 0.5 }, 3.5)).toBe(
			1.75,
		);
	});

	test("scales the wind at the upper fitted exposure", () => {
		expect(
			resolveAppliedWindSpeed({ wind_height_factor: 0.65 }, 4.0),
		).toBeCloseTo(2.6, 10);
	});

	test("passes a null wind through as null", () => {
		// No wind is not zero wind.
		expect(resolveAppliedWindSpeed({ wind_height_factor: 0.5 }, null)).toBeNull();
	});

	test("returns a non-finite wind unchanged", () => {
		expect(
			resolveAppliedWindSpeed({ wind_height_factor: 0.5 }, NaN),
		).toBeNaN();
	});
});

describe("constants", () => {
	test("pins the default and legacy factors", () => {
		expect(DEFAULT_WIND_HEIGHT_FACTOR).toBe(0.5);
		expect(LEGACY_WIND_HEIGHT_FACTOR).toBe(1.0);
	});

	test("pins the factor bounds and step", () => {
		// D-b: the floor opened from 0.3 to 0, and the step went 0.05 -> 0.01 so
		// every integer percent on the control maps to a distinct factor.
		expect(WIND_HEIGHT_FACTOR_MIN).toBe(0);
		expect(WIND_HEIGHT_FACTOR_MAX).toBe(1.0);
		expect(WIND_HEIGHT_FACTOR_STEP).toBe(0.01);
	});

	test("keeps the fitted exposure range inside the slider bounds", () => {
		expect(WIND_HEIGHT_FITTED_MIN).toBe(0.4);
		expect(WIND_HEIGHT_FITTED_MAX).toBe(0.65);
		expect(WIND_HEIGHT_FITTED_MIN).toBeGreaterThanOrEqual(
			WIND_HEIGHT_FACTOR_MIN,
		);
		expect(WIND_HEIGHT_FITTED_MAX).toBeLessThanOrEqual(WIND_HEIGHT_FACTOR_MAX);
	});
});

describe("the 0-100% scale (D-b)", () => {
	// Maintainer ruling 2026-08-30: the CONTROL speaks percent, storage stays the
	// 0-1 factor. So nothing persisted changes meaning and no migration is owed;
	// only the numbers on screen move.
	test("spans the full 0-100 with integer steps", () => {
		expect(WIND_HEIGHT_PERCENT_MIN).toBe(0);
		expect(WIND_HEIGHT_PERCENT_MAX).toBe(100);
		expect(WIND_HEIGHT_PERCENT_STEP).toBe(1);
	});

	test("converts between the stored factor and the displayed percent", () => {
		expect(factorToPercent(0.5)).toBe(50);
		expect(factorToPercent(1)).toBe(100);
		expect(factorToPercent(0)).toBe(0);
		expect(percentToFactor(50)).toBe(0.5);
		expect(percentToFactor(100)).toBe(1);
		expect(percentToFactor(0)).toBe(0);
	});

	test("round-trips every integer percent without drift", () => {
		// 0.01 steps are not exact in IEEE754, so the conversion must round
		// rather than let 0.07000000000000001 reach storage or the readout.
		for (let percent = 0; percent <= 100; percent++) {
			expect(factorToPercent(percentToFactor(percent))).toBe(percent);
		}
	});

	test("the fitted range maps onto the percent scale", () => {
		expect(factorToPercent(WIND_HEIGHT_FITTED_MIN)).toBe(40);
		expect(factorToPercent(WIND_HEIGHT_FITTED_MAX)).toBe(65);
	});
});

describe("resolveWindHeightFactor at zero (D-b)", () => {
	test("honours a stored factor of 0 instead of degrading to no transfer", () => {
		// REQUIRED for coherence once the slider reaches 0%: the guard used to
		// map `factor <= 0` onto LEGACY (1.0), so dragging to zero would have
		// applied the FULL wind -- the exact opposite of what the control says.
		// 0 now means what it reads as: no wind reaches the rider.
		expect(resolveWindHeightFactor({ wind_height_factor: 0 })).toBe(0);
	});

	test("still degrades a negative factor, which no input can produce", () => {
		expect(resolveWindHeightFactor({ wind_height_factor: -0.5 })).toBe(
			LEGACY_WIND_HEIGHT_FACTOR,
		);
	});
});
