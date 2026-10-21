import { describe, expect, test } from "vitest";
import { applyBaroLag } from "./BaroLag";

/** 1 Hz timestamps for `n` samples. */
const hz1 = (n: number) => Array.from({ length: n }, (_, i) => i);

describe("applyBaroLag", () => {
	test("zero lag returns the input array itself (identity matters to memos)", () => {
		const altitude = [100, 101, 102];
		expect(applyBaroLag(altitude, hz1(altitude.length), 0)).toBe(altitude);
		expect(applyBaroLag(altitude, hz1(altitude.length), 0.4)).toBe(altitude); // rounds to 0
		expect(applyBaroLag([], [], 2)).toEqual([]);
	});

	test("positive lag reads the future sample — the channel was recorded late", () => {
		const altitude = [100, 101, 102, 103, 104];
		expect(applyBaroLag(altitude, hz1(altitude.length), 2)).toEqual([
			102, 103, 104, 104, 104,
		]);
	});

	test("the tail clamps to the last reading instead of going NaN", () => {
		const corrected = applyBaroLag([10, 20, 30], hz1(3), 2);
		// A closure target ending on the last sample must stay finite.
		expect(corrected[corrected.length - 1]).toBe(30);
		expect(corrected.every(Number.isFinite)).toBe(true);
	});

	test("negative lag reads the past and clamps at the head", () => {
		const altitude = [100, 101, 102, 103];
		expect(applyBaroLag(altitude, hz1(altitude.length), -2)).toEqual([
			100, 100, 100, 101,
		]);
	});

	test("fractional lag rounds to the nearest whole second, like applyAirSpeedOffset", () => {
		const altitude = [0, 1, 2, 3, 4];
		expect(applyBaroLag(altitude, hz1(altitude.length), 1.6)).toEqual(
			applyBaroLag(altitude, hz1(altitude.length), 2),
		);
		expect(applyBaroLag(altitude, hz1(altitude.length), 1.4)).toEqual(
			applyBaroLag(altitude, hz1(altitude.length), 1),
		);
	});

	test("existing NaN samples shift with the channel but do not spread", () => {
		const altitude = [100, Number.NaN, 102, 103];
		expect(applyBaroLag(altitude, hz1(altitude.length), 1)).toEqual([
			Number.NaN,
			102,
			103,
			103,
		]);
	});

	test("on irregular recording the lag is in seconds, not samples", () => {
		// Samples 3 s apart: a 3 s lag reads the next sample, not the third.
		const t = [0, 3, 6, 9, 12];
		const altitude = [100, 101, 102, 103, 104];
		expect(applyBaroLag(altitude, t, 3)).toEqual([101, 102, 103, 104, 104]);
		// 2 s is nearer to the next sample (1 s away) than to this one (2 s).
		expect(applyBaroLag(altitude, t, 2)).toEqual([101, 102, 103, 104, 104]);
	});

	test("a recording gap is never shifted across: each side clamps at its end", () => {
		const t = [0, 1, 2, 100, 101, 102];
		const altitude = [10, 11, 12, 50, 51, 52];
		expect(applyBaroLag(altitude, t, 2)).toEqual([12, 12, 12, 52, 52, 52]);
		expect(applyBaroLag(altitude, t, -2)).toEqual([10, 10, 10, 50, 50, 50]);
	});
});
