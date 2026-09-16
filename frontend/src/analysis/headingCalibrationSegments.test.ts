import { describe, expect, it } from "vitest";
import { buildHeadingCalibrationSegments } from "./headingCalibrationSegments";

const N = 40;
const arrays = {
	timestamps: Array.from({ length: N }, (_, i) => i),
	velocity: Array.from({ length: N }, (_, i) => 100 + i),
	positionLat: Array.from({ length: N }, (_, i) => 52 + i / 1000),
	positionLong: Array.from({ length: N }, (_, i) => 13 + i / 1000),
};
const aligned = Array.from({ length: N }, (_, i) => 200 + i);

describe("buildHeadingCalibrationSegments", () => {
	it("R2: cuts each non-adjacent lap from its own range and never bridges the gap", () => {
		const segments = buildHeadingCalibrationSegments(
			[
				{ label: "Lap 2", range: { startIdx: 5, endIdx: 14 } },
				{ label: "Lap 5", range: { startIdx: 25, endIdx: 34 } },
			],
			arrays,
			aligned,
		);
		expect(segments.map((s) => s.label)).toEqual(["Lap 2", "Lap 5"]);
		expect(Array.from(segments[0].timestamps)).toEqual(
			arrays.timestamps.slice(5, 15),
		);
		expect(Array.from(segments[1].velocity)).toEqual(
			arrays.velocity.slice(25, 35),
		);
		expect(Array.from(segments[1].airSpeed)).toEqual(aligned.slice(25, 35));
	});

	it("applies a segment-local trim inside the lap", () => {
		const [segment] = buildHeadingCalibrationSegments(
			[
				{
					label: "Lap 3",
					range: { startIdx: 10, endIdx: 29 },
					trim: { start: 4, end: 12 },
				},
			],
			arrays,
			aligned,
		);
		expect(Array.from(segment.timestamps)).toEqual(
			arrays.timestamps.slice(14, 23),
		);
		expect(Array.from(segment.positionLat)).toEqual(
			arrays.positionLat.slice(14, 23),
		);
	});
});
