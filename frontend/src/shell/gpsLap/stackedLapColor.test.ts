import { describe, expect, it } from "vitest";
import { STACKED_LAP_COLORS, stackedLapColor } from "./gpsLapPlots";

describe("stackedLapColor", () => {
	it("assigns colors by position so a 2/4/6 selection uses the first three palette entries", () => {
		// The selected laps map to profile indices 0, 1, 2 regardless of lap number.
		expect(stackedLapColor(0)).toBe(STACKED_LAP_COLORS[0]);
		expect(stackedLapColor(1)).toBe(STACKED_LAP_COLORS[1]);
		expect(stackedLapColor(2)).toBe(STACKED_LAP_COLORS[2]);
	});

	it("uses the requested 9-color palette", () => {
		expect(STACKED_LAP_COLORS).toEqual([
			"#e41a1c",
			"#377eb8",
			"#4daf4a",
			"#984ea3",
			"#ff7f00",
			"#ffff33",
			"#a65628",
			"#f781bf",
			"#999999",
		]);
	});

	it("wraps around when there are more laps than palette colors", () => {
		expect(stackedLapColor(9)).toBe(STACKED_LAP_COLORS[0]);
		expect(stackedLapColor(10)).toBe(STACKED_LAP_COLORS[1]);
	});
});
