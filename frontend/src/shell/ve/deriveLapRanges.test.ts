import { describe, expect, it } from "vitest";
import { deriveOverlayLaps, type SelectedLapInput } from "./deriveLapRanges";
import type { ActivityLapLike } from "../../state/AppState";

function lap(start: number, end: number): ActivityLapLike {
	return {
		start_time: start,
		end_time: end,
		total_elapsed_time: end - start,
		total_distance: 0,
		avg_power: 0,
		avg_speed: 0,
		start_position_lat: 0,
		start_position_long: 0,
	} as ActivityLapLike;
}

describe("deriveOverlayLaps", () => {
	const timestamps = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9];

	it("resolves contiguous index ranges from each lap's time span", () => {
		const selected: SelectedLapInput[] = [
			{ lapNumber: 3, lap: lap(0, 2) },
			{ lapNumber: 5, lap: lap(5, 7) },
		];

		const { ranges, lapNumbers } = deriveOverlayLaps(timestamps, selected);

		expect(ranges).toEqual([
			{ startIdx: 0, endIdx: 2 },
			{ startIdx: 5, endIdx: 7 },
		]);
		expect(lapNumbers).toEqual([3, 5]);
	});

	it("includes both boundary samples (inclusive range)", () => {
		const { ranges } = deriveOverlayLaps(timestamps, [
			{ lapNumber: 1, lap: lap(2, 4) },
		]);
		expect(ranges).toEqual([{ startIdx: 2, endIdx: 4 }]);
	});

	it("preserves the user's real lap numbers aligned to ranges", () => {
		const { lapNumbers } = deriveOverlayLaps(timestamps, [
			{ lapNumber: 8, lap: lap(0, 1) },
			{ lapNumber: 12, lap: lap(8, 9) },
		]);
		expect(lapNumbers).toEqual([8, 12]);
	});

	it("drops laps that resolve to no samples and keeps arrays aligned", () => {
		const { ranges, lapNumbers } = deriveOverlayLaps(timestamps, [
			{ lapNumber: 1, lap: lap(0, 1) },
			{ lapNumber: 2, lap: lap(100, 200) }, // outside timestamp range
			{ lapNumber: 3, lap: lap(8, 9) },
		]);

		expect(ranges).toEqual([
			{ startIdx: 0, endIdx: 1 },
			{ startIdx: 8, endIdx: 9 },
		]);
		expect(lapNumbers).toEqual([1, 3]);
	});
});
