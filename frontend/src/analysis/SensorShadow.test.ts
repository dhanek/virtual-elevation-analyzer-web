import { describe, expect, it } from "vitest";
import { calculateAutoAirSpeedCalibration } from "./AirSpeedCalibration";
import {
	correctSensorShadow,
	detectSensorShadow,
	SHADOW_THRESHOLD,
	type ShadowSegmentInput,
} from "./SensorShadow";

const LAT0 = 52.5;
const LON0 = 13.4;
const M_PER_DEG = 6_371_000 * (Math.PI / 180);
const RADIUS = 80;
const SPEED = 10;
/** Wind from the north, m/s: the measured air speed carries w·cos(heading). */
const WIND = 2;

interface Ride extends ShadowSegmentInput {
	timestamps: number[];
	velocity: number[];
	airSpeed: number[];
	positionLat: number[];
	positionLong: number[];
	/** What the sensor would have read with nothing in front of it. */
	clean: number[];
}

/**
 * Laps of an 80 m-radius circle at 10 m/s (~50 s per lap), 1 Hz, steady wind,
 * sensor scale 1. `shadow` multiplies the measured air speed over [from, to).
 */
function circuitRide(
	seconds: number,
	shadow?: { from: number; to: number; factor: number },
): Ride {
	const timestamps: number[] = [];
	const velocity: number[] = [];
	const positionLat: number[] = [];
	const positionLong: number[] = [];
	const clean: number[] = [];
	const airSpeed: number[] = [];
	for (let t = 0; t < seconds; t++) {
		const alpha = (SPEED * t) / RADIUS;
		const x = RADIUS * Math.sin(alpha);
		const y = RADIUS * Math.cos(alpha);
		timestamps.push(1_000 + t);
		velocity.push(SPEED);
		positionLat.push(LAT0 + y / M_PER_DEG);
		positionLong.push(
			LON0 + x / (M_PER_DEG * Math.cos((LAT0 * Math.PI) / 180)),
		);
		// Clockwise from north: heading is alpha + 90°.
		const heading = alpha + Math.PI / 2;
		const va = SPEED + WIND * Math.cos(heading);
		clean.push(va);
		const shadowed = shadow && t >= shadow.from && t < shadow.to;
		airSpeed.push(shadowed ? va * shadow.factor : va);
	}
	return {
		label: "lap 1",
		timestamps,
		velocity,
		airSpeed,
		positionLat,
		positionLong,
		clean,
	};
}

const SHADOW = { from: 300, to: 360, factor: 0.8 };

describe("detectSensorShadow", () => {
	it("flags nothing on a steady-wind ride", () => {
		const result = detectSensorShadow([circuitRide(600)]);
		expect(result.checked).toBe(true);
		expect(result.events).toEqual([]);
		expect(result.masks[0].some(Boolean)).toBe(false);
	});

	it("flags a stretch where the sensor reads low and covers all of it", () => {
		const result = detectSensorShadow([circuitRide(600, SHADOW)]);
		expect(result.checked).toBe(true);
		expect(result.events).toHaveLength(1);
		const [event] = result.events;
		expect(event.startIdx).toBeLessThanOrEqual(SHADOW.from);
		expect(event.endIdx).toBeGreaterThanOrEqual(SHADOW.to - 1);
		// A flagged window spans one circuit (~50 s), so the mask may reach at
		// most one circuit beyond the stretch on either side.
		expect(event.seconds).toBeLessThan(SHADOW.to - SHADOW.from + 2 * 52);
		expect(event.peakExcess).toBeGreaterThan(SHADOW_THRESHOLD);
		expect(event.label).toBe("lap 1");
	});

	it("does not flag a reading low by less than the threshold", () => {
		const result = detectSensorShadow([
			circuitRide(600, { ...SHADOW, factor: 0.95 }),
		]);
		expect(result.events).toEqual([]);
	});

	it("says it did not check a selection with too few circuit windows", () => {
		const result = detectSensorShadow([circuitRide(60, SHADOW)]);
		expect(result.checked).toBe(false);
		expect(result.events).toEqual([]);
	});

	it("checks nothing on a ride that never completes a circuit", () => {
		const straight = circuitRide(600);
		straight.positionLat = straight.timestamps.map(
			(_, i) => LAT0 + (i * SPEED) / M_PER_DEG,
		);
		straight.positionLong = straight.timestamps.map(() => LON0);
		expect(detectSensorShadow([straight]).checked).toBe(false);
	});
});

describe("correctSensorShadow", () => {
	it("replaces the shadowed seconds with ground speed plus the fitted wind", () => {
		const ride = circuitRide(600, SHADOW);
		const input = [...ride.airSpeed];
		const result = correctSensorShadow(
			[{ label: "lap 1", range: { startIdx: 0, endIdx: 599 } }],
			ride,
			ride.airSpeed,
		);
		expect(ride.airSpeed).toEqual(input);
		const mask = result.detection.masks[0];
		for (let i = 0; i < 600; i++) {
			if (mask[i]) {
				expect(Math.abs(result.windSpeed[i] - ride.clean[i])).toBeLessThan(
					0.05,
				);
			} else {
				expect(result.windSpeed[i]).toBe(ride.airSpeed[i]);
			}
		}
	});

	it("writes back at the segment's place in the full series, trim included", () => {
		const ride = circuitRide(700, { from: 400, to: 460, factor: 0.8 });
		const result = correctSensorShadow(
			[
				{
					label: "lap 1",
					range: { startIdx: 50, endIdx: 699 },
					trim: { start: 50, end: 649 },
				},
			],
			ride,
			ride.airSpeed,
		);
		expect(result.detection.events).toHaveLength(1);
		for (let i = 400; i < 460; i++)
			expect(Math.abs(result.windSpeed[i] - ride.clean[i])).toBeLessThan(0.05);
		for (let i = 0; i < 100; i++)
			expect(result.windSpeed[i]).toBe(ride.airSpeed[i]);
	});

	it("returns an unchanged copy when nothing is flagged", () => {
		const ride = circuitRide(600);
		const result = correctSensorShadow(
			[{ label: "lap 1", range: { startIdx: 0, endIdx: 599 } }],
			ride,
			ride.airSpeed,
		);
		expect(result.windSpeed).toEqual(ride.airSpeed);
		expect(result.windSpeed).not.toBe(ride.airSpeed);
	});
});

describe("Auto Adjust leaves shadowed samples out of the scale fit", () => {
	const calibrate = (ride: Ride) =>
		calculateAutoAirSpeedCalibration({
			measuredAirSpeed: true,
			headingSegments: [ride],
			vdSegments: [],
		});

	it("fits the clean scale and warns, where the shadow would have pulled it", () => {
		const outcome = calibrate(circuitRide(600, SHADOW));
		expect(outcome.method).toBe("sinusoid");
		if (outcome.method !== "sinusoid") return;
		expect(Math.abs(outcome.percent)).toBeLessThan(0.1);
		const warning = outcome.warnings.find((w) => w.kind === "sensorShadow");
		expect(warning).toMatchObject({ kind: "sensorShadow", label: "lap 1" });
		expect(outcome.perSegment[0].shadowMask?.some(Boolean)).toBe(true);
	});

	it("adds no warning and no mask to a clean ride", () => {
		const outcome = calibrate(circuitRide(600));
		if (outcome.method !== "sinusoid") throw new Error(outcome.method);
		expect(outcome.warnings.some((w) => w.kind === "sensorShadow")).toBe(false);
		expect(outcome.perSegment[0].shadowMask).toBeUndefined();
	});
});
