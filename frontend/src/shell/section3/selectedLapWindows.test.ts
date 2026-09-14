import { describe, expect, it } from "vitest";
import { selectedLapWindows } from "./selectedLapWindows";

/** Ten samples a second apart, cut into three FIT laps of 0-3, 4-6 and 7-9 s. */
const timestamps = Array.from({ length: 10 }, (_, i) => 100 + i);
const laps = [
	{ start_time: 100, end_time: 103 },
	{ start_time: 104, end_time: 106 },
	{ start_time: 107, end_time: 109 },
];

describe("selectedLapWindows", () => {
	it("leaves an unselected lap between two selected ones out", () => {
		expect(selectedLapWindows(timestamps, laps, [1, 3])).toEqual([
			{ startIdx: 0, endIdx: 3 },
			{ startIdx: 7, endIdx: 9 },
		]);
	});

	it("joins adjacent selected laps into one window", () => {
		expect(selectedLapWindows(timestamps, laps, [2, 1])).toEqual([
			{ startIdx: 0, endIdx: 6 },
		]);
	});

	it("is empty when no selected lap exists", () => {
		expect(selectedLapWindows(timestamps, laps, [])).toEqual([]);
		expect(selectedLapWindows(timestamps, laps, [7])).toEqual([]);
	});
});
