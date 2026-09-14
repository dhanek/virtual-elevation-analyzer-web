import { describe, expect, test } from "vitest";
import { applyBaroLag } from "./BaroLag";

describe("applyBaroLag", () => {
	test("zero lag returns the input array itself (identity matters to memos)", () => {
		const altitude = [100, 101, 102];
		expect(applyBaroLag(altitude, 0)).toBe(altitude);
		expect(applyBaroLag(altitude, 0.4)).toBe(altitude); // rounds to 0
		expect(applyBaroLag([], 2)).toEqual([]);
	});

	test("positive lag reads the future sample — the channel was recorded late", () => {
		const altitude = [100, 101, 102, 103, 104];
		expect(applyBaroLag(altitude, 2)).toEqual([102, 103, 104, 104, 104]);
	});

	test("the tail clamps to the last reading instead of going NaN", () => {
		const corrected = applyBaroLag([10, 20, 30], 2);
		// A closure target ending on the last sample must stay finite.
		expect(corrected[corrected.length - 1]).toBe(30);
		expect(corrected.every(Number.isFinite)).toBe(true);
	});

	test("negative lag reads the past and clamps at the head", () => {
		const altitude = [100, 101, 102, 103];
		expect(applyBaroLag(altitude, -2)).toEqual([100, 100, 100, 101]);
	});

	test("fractional lag rounds to the nearest whole sample, like applyAirSpeedOffset", () => {
		const altitude = [0, 1, 2, 3, 4];
		expect(applyBaroLag(altitude, 1.6)).toEqual(applyBaroLag(altitude, 2));
		expect(applyBaroLag(altitude, 1.4)).toEqual(applyBaroLag(altitude, 1));
	});

	test("existing NaN samples shift with the channel but do not spread", () => {
		const altitude = [100, Number.NaN, 102, 103];
		expect(applyBaroLag(altitude, 1)).toEqual([Number.NaN, 102, 103, 103]);
	});
});
