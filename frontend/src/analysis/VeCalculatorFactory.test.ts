import { beforeEach, describe, expect, test, vi } from "vitest";
import type { VeCalculatorSeriesInput } from "./VeCalculatorFactory";
import type { WindSeriesResolution } from "./WindSourceResolver";
import type { AnalysisParameters } from "../components/AnalysisParameters";
import { DEFAULT_PARAMETERS } from "../components/AnalysisParameters";

/**
 * Equivalence guards for the 10 m → rider wind height transfer (Phase 08).
 *
 * 08-CONTEXT.md `<success_criteria>` calls these two guards "required, not
 * optional", and adds the reason they exist in this form: both assert behaviour
 * that is *already correct*, so both pass the moment they are written. That is
 * exactly what makes them worthless until they have been watched failing under
 * a deliberate mutation of production code. 06-05 verified its parity bar by
 * reading the diff and the bar turned out to be entirely unenforced; 06-06 set
 * the standard reproduced here. A guard nobody has watched fail is not a guard.
 *
 * The mutation table for this file lives in 08-02-SUMMARY.md.
 */

const mocks = vi.hoisted(() => ({
	createVeCalculator: vi.fn(),
	createVeCalculatorWithRhoArray: vi.fn(),
}));

// Mock the specifier the SUBJECT imports. Vitest resolves the `@wasm` → pkg/
// alias from vite.config.ts even though vitest.config.ts declares none itself.
vi.mock("@wasm/virtual_elevation_analyzer.js", () => ({
	create_ve_calculator: mocks.createVeCalculator,
	create_ve_calculator_with_rho_array: mocks.createVeCalculatorWithRhoArray,
}));

// Imported after the mocks so the module under test picks them up.
const { createVeCalculator } = await import("./VeCalculatorFactory");
// Imported for real and deliberately NOT mocked: guard 2 below has to exercise
// the actual FIT sensor path, or it cannot observe that path being scaled.
const { resolveWindSeries } = await import("./WindSourceResolver");

/**
 * Positional argument indices into the two WASM constructors.
 *
 * The constructors take ~20 positional arguments, so a bare `17` in an
 * assertion is unreadable and silently wrong the day an argument moves. The
 * rho-array branch is offset by one from the plain branch for every argument
 * after the series block: `create_ve_calculator_with_rho_array` inserts the rho
 * array at index 8, which shifts the whole tail — the scalars, the wind speed
 * and the wind direction — one place to the right.
 */
const WIND_SERIES_ARG_INDEX = 7; // per-sample series; index 7 in BOTH branches
const WIND_SPEED_ARG_INDEX = 17; // params.wind_speed, plain branch
const WIND_DIRECTION_ARG_INDEX = 18; // params.wind_direction, plain branch
const WIND_SPEED_ARG_INDEX_WITH_RHO = 18; // +1: the rho array sits at index 8
const WIND_DIRECTION_ARG_INDEX_WITH_RHO = 19; // +1, same reason

/** The reported 10 m wind and its bearing, used by every fixture below. */
const REPORTED_WIND_SPEED = 3.5;
const REPORTED_WIND_DIRECTION = 220;
/** 3.5 × 0.5 — exact in IEEE754, so the assertion can be an equality. */
const TRANSFERRED_WIND_SPEED = 1.75;

/**
 * Module-level series arrays, deliberately shared across calls.
 *
 * `toFloat64ArrayCached` keys a WeakMap on the array object, so reusing these
 * makes repeated calls hand the constructor the *identical* Float64Array
 * instance. Without that, a whole-argument-list comparison would be confounded
 * by allocation and could not use identity for the series arguments.
 */
const TIMESTAMPS = [0, 1, 2, 3, 4];
const POWER = [200, 205, 210, 215, 212];
const VELOCITY = [9, 9.5, 10, 9.8, 9.6];
const POSITION_LAT = [47.1, 47.1001, 47.1002, 47.1003, 47.1004];
const POSITION_LONG = [8.2, 8.2001, 8.2002, 8.2003, 8.2004];
const ALTITUDE = [400, 400.5, 401, 400.8, 400.6];
const DISTANCE = [0, 9, 18.5, 28.3, 37.9];
const WIND_SPEED_SERIES = [0, 0, 0, 0, 0];
const RHO_ARRAY = [1.2, 1.2, 1.21, 1.21, 1.2];

function makeSeries(): VeCalculatorSeriesInput {
	return {
		timestamps: TIMESTAMPS,
		power: POWER,
		velocity: VELOCITY,
		positionLat: POSITION_LAT,
		positionLong: POSITION_LONG,
		altitude: ALTITUDE,
		distance: DISTANCE,
		windSpeed: WIND_SPEED_SERIES,
	};
}

function makeParams(
	overrides: Partial<AnalysisParameters> = {},
): AnalysisParameters {
	return { ...DEFAULT_PARAMETERS, ...overrides };
}

/**
 * Params carrying a reported wind, at a named height factor.
 *
 * `DEFAULT_PARAMETERS` now carries a factor of 0.5, so `makeParams()` alone is
 * NOT the pre-feature shape. Every fixture therefore states its factor
 * explicitly; `undefined` is a legal override of a declared optional field and
 * reproduces exactly the record shape a pre-feature saved analysis restores.
 */
function windParams(factor: number | undefined): AnalysisParameters {
	return makeParams({
		wind_speed: REPORTED_WIND_SPEED,
		wind_direction: REPORTED_WIND_DIRECTION,
		wind_height_factor: factor,
	});
}

/** Invoke the plain branch and return the captured argument list. */
function callPlain(params: AnalysisParameters): unknown[] {
	createVeCalculator({ ...makeSeries(), params, cda: null, crr: null });
	return mocks.createVeCalculator.mock.calls[0];
}

/** Invoke the rho-array branch and return the captured argument list. */
function callWithRho(params: AnalysisParameters): unknown[] {
	createVeCalculator({
		...makeSeries(),
		rhoArray: RHO_ARRAY,
		params,
		cda: null,
		crr: null,
	});
	return mocks.createVeCalculatorWithRhoArray.mock.calls[0];
}

/**
 * Indices at which two captured argument lists differ.
 *
 * `Object.is` is sufficient because the series arguments are the same cached
 * Float64Array instance in both calls (see the note on the module-level series
 * arrays), so only genuinely different scalars show up.
 */
function differingArgIndices(first: unknown[], second: unknown[]): number[] {
	const differing: number[] = [];
	const length = Math.max(first.length, second.length);
	for (let index = 0; index < length; index++) {
		if (!Object.is(first[index], second[index])) differing.push(index);
	}
	return differing;
}

beforeEach(() => {
	mocks.createVeCalculator.mockClear();
	mocks.createVeCalculatorWithRhoArray.mockClear();
});

describe("equivalence guard 1 — k = 1.0 is pre-feature parity", () => {
	test("plain branch: the whole argument list at k = 1.0 equals the pre-feature one", () => {
		// The pre-feature record shape: no wind_height_factor key value at all.
		const preFeature = callPlain(windParams(undefined));
		mocks.createVeCalculator.mockClear();
		const atUnity = callPlain(windParams(1.0));

		// "k = 1.0 must reproduce pre-feature VE calculator arguments exactly"
		// — this is the state every legacy saved analysis restores into.
		expect(atUnity).toEqual(preFeature);
	});

	test("rho-array branch: the whole argument list at k = 1.0 equals the pre-feature one", () => {
		// Asserted separately because a half-applied change is invisible to a
		// single-branch test — both WASM constructors must stay in step.
		const preFeature = callWithRho(windParams(undefined));
		mocks.createVeCalculatorWithRhoArray.mockClear();
		const atUnity = callWithRho(windParams(1.0));

		expect(atUnity).toEqual(preFeature);
	});

	test("plain branch: k scales the wind speed and never the direction", () => {
		const atUnity = callPlain(windParams(1.0));
		expect(atUnity[WIND_SPEED_ARG_INDEX]).toBe(REPORTED_WIND_SPEED);
		expect(atUnity[WIND_DIRECTION_ARG_INDEX]).toBe(220);

		mocks.createVeCalculator.mockClear();
		const atHalf = callPlain(windParams(0.5));
		expect(atHalf[WIND_SPEED_ARG_INDEX]).toBe(TRANSFERRED_WIND_SPEED);
		// D-09: the transfer changes how hard the wind pushes, not where it
		// comes from. The bearing is 220 at every factor.
		expect(atHalf[WIND_DIRECTION_ARG_INDEX]).toBe(220);
	});

	test("rho-array branch: k scales the wind speed and never the direction", () => {
		const atUnity = callWithRho(windParams(1.0));
		expect(atUnity[WIND_SPEED_ARG_INDEX_WITH_RHO]).toBe(REPORTED_WIND_SPEED);
		expect(atUnity[WIND_DIRECTION_ARG_INDEX_WITH_RHO]).toBe(220);

		mocks.createVeCalculatorWithRhoArray.mockClear();
		const atHalf = callWithRho(windParams(0.5));
		expect(atHalf[WIND_SPEED_ARG_INDEX_WITH_RHO]).toBe(TRANSFERRED_WIND_SPEED);
		expect(atHalf[WIND_DIRECTION_ARG_INDEX_WITH_RHO]).toBe(220);
	});

	test("plain branch: k = 0.5 moves exactly one argument", () => {
		const atUnity = callPlain(windParams(1.0));
		mocks.createVeCalculator.mockClear();
		const atHalf = callPlain(windParams(0.5));

		// D-04 states the transfer is applied at one point; this pins the
		// consequence across the whole argument vector rather than at two spot
		// indices, so neither a dropped application nor a leak into a
		// neighbouring argument can pass unnoticed.
		expect(differingArgIndices(atUnity, atHalf)).toEqual([
			WIND_SPEED_ARG_INDEX,
		]);
	});

	test("rho-array branch: k = 0.5 moves exactly one argument", () => {
		const atUnity = callWithRho(windParams(1.0));
		mocks.createVeCalculatorWithRhoArray.mockClear();
		const atHalf = callWithRho(windParams(0.5));

		expect(differingArgIndices(atUnity, atHalf)).toEqual([
			WIND_SPEED_ARG_INDEX_WITH_RHO,
		]);
	});

	test("the per-sample wind series sits at index 7 in both branches", () => {
		// Pinned here because guard 2 asserts on this index: if the series ever
		// moved, that guard would quietly start comparing some other argument
		// and would pass while measuring nothing.
		const plain = callPlain(windParams(1.0));
		const withRho = callWithRho(windParams(1.0));
		const expected = new Float64Array(WIND_SPEED_SERIES);

		expect(plain[WIND_SERIES_ARG_INDEX]).toEqual(expected);
		expect(withRho[WIND_SERIES_ARG_INDEX]).toEqual(expected);
		// Same index, same cached instance — the rho array shifts only the tail.
		expect(plain[WIND_SERIES_ARG_INDEX]).toBe(withRho[WIND_SERIES_ARG_INDEX]);
	});

	test("a null wind stays null at every factor, in both branches", () => {
		// No wind is not zero wind: scaling must not manufacture a 0 the
		// physics would then treat as a measured calm.
		for (const factor of [undefined, 1.0, 0.5, 0.3]) {
			mocks.createVeCalculator.mockClear();
			mocks.createVeCalculatorWithRhoArray.mockClear();

			const params = makeParams({
				wind_speed: null,
				wind_direction: null,
				wind_height_factor: factor,
			});

			expect(callPlain(params)[WIND_SPEED_ARG_INDEX]).toBeNull();
			expect(callWithRho(params)[WIND_SPEED_ARG_INDEX_WITH_RHO]).toBeNull();
		}
	});
});

/**
 * D-01: the height transfer applies to weather-sourced constant wind only, and
 * never to the FIT sensor channel — sensor air speed is already measured at the
 * rider, and `virtual_elevation.rs:338` treats a sensor series as PRIORITY 1
 * and ignores `params.wind_speed` entirely on that path, so routing it through
 * the transfer would double-correct a number that needs no correction at all.
 *
 * Note what this guard does NOT claim: `params.wind_speed` still differs
 * between the two factors in the constructor arguments below, and that is
 * correct — the Rust never reads it when a sensor series is present. The
 * invariant pinned here is the per-sample **series** argument at index 7.
 * That difference is asserted rather than merely described, in the middle test
 * below, because it is what proves the surrounding invariance tests are
 * comparing two genuinely different configurations.
 */
describe("equivalence guard 2 — an air-speed ride is invariant to k (D-01)", () => {
	const AIR_SPEED_FIT_DATA = {
		timestamps: [0, 1, 2, 3, 4],
		air_speed: [3, 4, 5, 3, 4],
		wind_speed: [],
		wind_yaw: [],
	};

	function resolveAtFactor(factor: number) {
		return resolveWindSeries({
			fitData: AIR_SPEED_FIT_DATA,
			windSource: "fit",
			params: windParams(factor),
		});
	}

	/**
	 * Everything that must hold before "the two series are equal" means anything.
	 *
	 * An equality assertion between two things that *should* be equal is the
	 * easiest kind of test to make vacuous, so all three failure modes are
	 * excluded up front: a fixture that fell through to the constant path (two
	 * all-NaN arrays compare equal at any factor whatsoever), an empty series
	 * (ditto), and a series with no finite non-zero sample — the last matters
	 * because mutation D is a *multiply*, and multiplying NaN or 0 by k leaves
	 * it unchanged, so a magnitude-free fixture could not observe the mutation
	 * it exists to catch.
	 */
	function expectUsableSensorSeries(resolution: WindSeriesResolution): void {
		expect(resolution.dataSource).toBe("air_speed");
		expect(resolution.selectedWindSource).toBe("fit");
		expect(
			resolution.windSpeed.filter(speed => Number.isFinite(speed) && speed !== 0)
				.length,
		).toBeGreaterThan(0);
	}

	test("the resolved sensor series is identical at k = 0.5 and k = 1.0", () => {
		const atUnity = resolveAtFactor(1.0);
		const atHalf = resolveAtFactor(0.5);

		expectUsableSensorSeries(atUnity);
		expectUsableSensorSeries(atHalf);

		expect(atHalf.windSpeed).toEqual(atUnity.windSpeed);
	});

	test("the two factors really are different configurations", () => {
		// The witness for the two tests around this one. They both assert that
		// something does NOT change between k = 1.0 and k = 0.5, which would
		// also be trivially true if the factor never reached the production
		// code at all — a broken `windParams`, a dropped override, a resolver
		// that ignores the field. Pinning the one argument that MUST move
		// proves the comparison is between genuinely different configurations.
		//
		// This is also the D-01 statement in positive form: at the same k the
		// constant-wind argument is transferred while the sensor series is not.
		const atUnity = callPlain(windParams(1.0));
		mocks.createVeCalculator.mockClear();
		const atHalf = callPlain(windParams(0.5));

		expect(atUnity[WIND_SPEED_ARG_INDEX]).toBe(REPORTED_WIND_SPEED);
		expect(atHalf[WIND_SPEED_ARG_INDEX]).toBe(TRANSFERRED_WIND_SPEED);
	});

	test("the series argument reaching WASM is identical at k = 0.5 and k = 1.0", () => {
		const atUnity = resolveAtFactor(1.0);
		const atHalf = resolveAtFactor(0.5);
		expectUsableSensorSeries(atUnity);
		expectUsableSensorSeries(atHalf);

		// Plain branch.
		createVeCalculator({
			...makeSeries(),
			windSpeed: atUnity.windSpeed,
			params: windParams(1.0),
			cda: null,
			crr: null,
		});
		createVeCalculator({
			...makeSeries(),
			windSpeed: atHalf.windSpeed,
			params: windParams(0.5),
			cda: null,
			crr: null,
		});
		const plainCalls = mocks.createVeCalculator.mock.calls;
		expect(plainCalls[1][WIND_SERIES_ARG_INDEX]).toEqual(
			plainCalls[0][WIND_SERIES_ARG_INDEX],
		);

		// Rho-array branch — asserted too, so a change applied to only one of
		// the two WASM call sites cannot slip past.
		createVeCalculator({
			...makeSeries(),
			windSpeed: atUnity.windSpeed,
			rhoArray: RHO_ARRAY,
			params: windParams(1.0),
			cda: null,
			crr: null,
		});
		createVeCalculator({
			...makeSeries(),
			windSpeed: atHalf.windSpeed,
			rhoArray: RHO_ARRAY,
			params: windParams(0.5),
			cda: null,
			crr: null,
		});
		const rhoCalls = mocks.createVeCalculatorWithRhoArray.mock.calls;
		expect(rhoCalls[1][WIND_SERIES_ARG_INDEX]).toEqual(
			rhoCalls[0][WIND_SERIES_ARG_INDEX],
		);
	});
});
