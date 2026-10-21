import { describe, expect, test } from "vitest";
import { MAX_STEP_SECONDS, shiftByTime, shiftIndices } from "./TimeShift";

/** The whole-sample shift every lag used before (clamp or NaN at the ends). */
function oldShift(values: number[], lag: number, edge: "clamp" | "nan") {
	const n = Math.round(lag);
	const last = values.length - 1;
	return values.map((_, i) => {
		const k = i + n;
		if (k >= 0 && k <= last) return values[k];
		return edge === "nan" ? NaN : values[Math.min(last, Math.max(0, k))];
	});
}

describe("shiftByTime", () => {
	test("on a strictly 1 Hz recording it is the old whole-sample shift, bit for bit", () => {
		const values = Array.from(
			{ length: 50 },
			(_, i) => Math.sin(i * 0.7) * 1e3,
		);
		// Epoch seconds, as a FIT file carries them.
		const t = values.map((_, i) => 1_700_000_000 + i);
		for (const lag of [-7, -3, -2.4, -1, 1, 1.6, 2, 3, 49, 60]) {
			for (const edge of ["clamp", "nan"] as const) {
				expect(shiftByTime(values, t, lag, edge)).toEqual(
					oldShift(values, lag, edge),
				);
			}
		}
	});

	test("a lag that rounds to zero returns the channel itself", () => {
		const values = [1, 2, 3];
		expect(shiftByTime(values, [0, 1, 2], 0.4, "nan")).toBe(values);
		expect(shiftByTime([], [], 3, "clamp")).toEqual([]);
	});

	test("on irregular recording it reads the sample nearest to t + lag", () => {
		const t = [0, 2, 5, 8, 12];
		const values = [10, 20, 30, 40, 50];
		// 0+3 → 2 (1 s away), 2+3 → 5, 5+3 → 8, 8+3 → 12, 12+3 → outside.
		expect(shiftByTime(values, t, 3, "nan")).toEqual([20, 30, 40, 50, NaN]);
		expect(shiftByTime(values, t, 3, "clamp")).toEqual([20, 30, 40, 50, 50]);
		// Backwards: 12−4 → 8, 8−4 → 5 (1 s away; 2 is 2 s away), and 5−4 = 1
		// sits 1 s from both 0 and 2 — a tie, which goes to the earlier sample.
		expect(shiftByTime(values, t, -4, "nan")).toEqual([NaN, NaN, 10, 30, 40]);
	});

	test("a recording gap splits the recording: no shift reads across it", () => {
		const t = [0, 1, 2, 2 + MAX_STEP_SECONDS, 3 + MAX_STEP_SECONDS];
		const values = [1, 2, 3, 4, 5];
		expect(shiftByTime(values, t, 1, "nan")).toEqual([2, 3, NaN, 5, NaN]);
		expect(shiftByTime(values, t, 1, "clamp")).toEqual([2, 3, 3, 5, 5]);
		expect(shiftByTime(values, t, -1, "clamp")).toEqual([1, 1, 2, 4, 4]);
		// A step just under the threshold is ridden, and is crossed.
		const ridden = [0, 1, 1 + MAX_STEP_SECONDS - 1, 2 + MAX_STEP_SECONDS - 1];
		expect(shiftByTime([1, 2, 3, 4], ridden, 1, "nan")).toEqual([2, 2, 4, NaN]);
	});

	test("a duplicate timestamp is a gap of its own, as in the VE step", () => {
		const t = [0, 1, 1, 2];
		expect(shiftIndices(t, 4, 1, "nan")).toEqual(
			Int32Array.from([1, -1, 3, -1]),
		);
	});

	test("refuses a channel without a timestamp for every sample", () => {
		expect(() => shiftByTime([1, 2, 3], [0, 1], 1, "nan")).toThrow();
	});
});
