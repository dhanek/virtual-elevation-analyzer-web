import { describe, expect, it } from "vitest";
import { collectValidPoints, degreeToCardinal } from "./geo";

describe("degreeToCardinal", () => {
	it("maps the cardinal axes", () => {
		expect(degreeToCardinal(0)).toBe("N");
		expect(degreeToCardinal(90)).toBe("E");
		expect(degreeToCardinal(180)).toBe("S");
		expect(degreeToCardinal(270)).toBe("W");
	});

	it("maps intercardinal directions", () => {
		expect(degreeToCardinal(225)).toBe("SW");
		expect(degreeToCardinal(45)).toBe("NE");
	});

	it("wraps values near 360 back to N via rounding", () => {
		expect(degreeToCardinal(359)).toBe("N");
	});

	it("wraps the 348.75 sector boundary to N (Math.round half-up)", () => {
		expect(degreeToCardinal(348.75)).toBe("N");
	});
});

describe("collectValidPoints", () => {
	// Mirrors the guard repeated 7x in MapVisualization.ts:
	// `lat && lng && lat !== 0 && lng !== 0`
	const posLat = [0, 52.5, Number.NaN, 52.6, 52.7];
	const posLong = [13.4, 13.41, 13.42, 0, 13.44];

	it("filters entries where lat/lng are falsy or exactly 0, keeping pairs and source indices", () => {
		const { points, indices } = collectValidPoints(posLat, posLong, 0, 4);
		expect(points).toEqual([
			[52.5, 13.41],
			[52.7, 13.44],
		]);
		expect(indices).toEqual([1, 4]);
	});

	it("respects the inclusive [startIdx, endIdx] range", () => {
		const { points, indices } = collectValidPoints(posLat, posLong, 1, 3);
		expect(points).toEqual([[52.5, 13.41]]);
		expect(indices).toEqual([1]);
	});

	it("clamps endIdx past the array length and startIdx below 0", () => {
		const { points, indices } = collectValidPoints(posLat, posLong, -2, 100);
		expect(points).toEqual([
			[52.5, 13.41],
			[52.7, 13.44],
		]);
		expect(indices).toEqual([1, 4]);
	});

	it("returns empty results for empty inputs or inverted ranges", () => {
		expect(collectValidPoints([], [], 0, 10)).toEqual({
			points: [],
			indices: [],
		});
		expect(collectValidPoints(posLat, posLong, 4, 1)).toEqual({
			points: [],
			indices: [],
		});
	});
});
