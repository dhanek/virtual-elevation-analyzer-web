/**
 * PER-LAP WEATHER, and the two ways it can be silently wrong.
 *
 * `autoRho` took ONE weather sample at the trim region's middle timestamp and
 * applied it to every selected lap. For a multi-lap selection spanning hours
 * that is one wind value for laps recorded far apart, and measured on the
 * historical-forecast 15-minute series the wind moves up to 1.20 m/s across a
 * three-hour ride. Each lap now resolves its own sample, interpolated between
 * the two 15-minute slots that bracket the lap's own midpoint.
 *
 * The two failure modes these cases exist for:
 *
 *  1. WIND IS A VECTOR. Interpolating direction as a scalar averages 350° and
 *     10° to 180° — a headwind becomes a tailwind. Measured on real data, 0.3%
 *     of consecutive slot pairs cross 0/360, and on those the naive mean is
 *     exactly 180° wrong. Rare and catastrophic is the worst combination, so it
 *     gets a test rather than a comment.
 *  2. WEIGHTING DIRECTION. A lap at 15:05 must weight 15:00 at 2/3, not 1/3.
 *     Getting it backwards is invisible in any test whose lap sits at a slot
 *     midpoint, so no case here uses 50/50 except the one asserting it.
 */
import { describe, expect, it } from "vitest";
import {
	bracketingSlots,
	interpolateAt,
	interpolateWeather,
	SLOT_MS,
} from "./segmentWeather";
import type { WeatherResponse } from "../utils/WeatherAPI";

function sample(over: Partial<WeatherResponse> = {}): WeatherResponse {
	return {
		temperature: 20,
		dewPoint: 10,
		pressure: 1010,
		windSpeed: 4,
		windDirection: 90,
		queriedAt: 0,
		...over,
	};
}

describe("bracketing a lap midpoint with two 15-minute slots", () => {
	it("splits a lap exactly between two slots evenly", () => {
		const { before, after, weightAfter } = bracketingSlots(
			new Date("2026-08-04T15:07:30Z"),
		);

		expect(before.toISOString()).toBe("2026-08-04T15:00:00.000Z");
		expect(after.toISOString()).toBe("2026-08-04T15:15:00.000Z");
		expect(weightAfter).toBeCloseTo(0.5, 10);
	});

	it("weights the NEARER slot more heavily", () => {
		// 15:05 is a third of the way from 15:00 to 15:15, so 15:00 carries 2/3.
		// Killed by inverting the weight — which a 50/50 fixture cannot catch.
		const { weightAfter } = bracketingSlots(new Date("2026-08-04T15:05:00Z"));

		expect(weightAfter).toBeCloseTo(1 / 3, 10);
	});

	it("degenerates to a single slot when the midpoint sits exactly on one", () => {
		const { before, after, weightAfter } = bracketingSlots(
			new Date("2026-08-04T15:15:00Z"),
		);

		expect(before.toISOString()).toBe("2026-08-04T15:15:00.000Z");
		expect(after.toISOString()).toBe("2026-08-04T15:15:00.000Z");
		expect(weightAfter).toBe(0);
	});

	it("brackets across an hour boundary", () => {
		const { before, after } = bracketingSlots(new Date("2026-08-04T15:52:00Z"));

		expect(before.toISOString()).toBe("2026-08-04T15:45:00.000Z");
		expect(after.toISOString()).toBe("2026-08-04T16:00:00.000Z");
	});

	it("brackets across midnight", () => {
		const { before, after } = bracketingSlots(new Date("2026-08-04T23:50:00Z"));

		expect(before.toISOString()).toBe("2026-08-04T23:45:00.000Z");
		expect(after.toISOString()).toBe("2026-08-05T00:00:00.000Z");
	});

	it("uses a 15-minute slot", () => {
		expect(SLOT_MS).toBe(15 * 60 * 1000);
	});
});

describe("interpolating between two weather samples", () => {
	it("interpolates the scalar quantities linearly", () => {
		const result = interpolateWeather(
			sample({ temperature: 20, dewPoint: 10, pressure: 1000 }),
			sample({ temperature: 24, dewPoint: 14, pressure: 1004 }),
			0.25,
		);

		expect(result.temperature).toBeCloseTo(21, 10);
		expect(result.dewPoint).toBeCloseTo(11, 10);
		expect(result.pressure).toBeCloseTo(1001, 10);
	});

	it("returns each endpoint exactly at weight 0 and 1", () => {
		const a = sample({ temperature: 20, windSpeed: 4, windDirection: 90 });
		const b = sample({ temperature: 30, windSpeed: 9, windDirection: 270 });

		expect(interpolateWeather(a, b, 0).temperature).toBeCloseTo(20, 10);
		expect(interpolateWeather(a, b, 0).windSpeed).toBeCloseTo(4, 10);
		expect(interpolateWeather(a, b, 1).temperature).toBeCloseTo(30, 10);
		expect(interpolateWeather(a, b, 1).windSpeed).toBeCloseTo(9, 10);
	});

	it("interpolates wind DIRECTION the short way around 0/360", () => {
		// THE CASE THIS FILE EXISTS FOR. Scalar interpolation gives 180° — the
		// exact reverse. Measured on real 15-minute data, this occurs on 0.3% of
		// consecutive slot pairs.
		const result = interpolateWeather(
			sample({ windSpeed: 5, windDirection: 350 }),
			sample({ windSpeed: 5, windDirection: 10 }),
			0.5,
		);

		expect(result.windDirection).toBeCloseTo(0, 6);
		// 4.924, not 5: the vector mean of two winds 20° apart is 5·cos(10°).
		// A shorter mean vector is the physically right answer — the wind is
		// veering, so its average over the interval genuinely carries less
		// along any one bearing. Asserting 5 here would only pass under the
		// scalar interpolation this file exists to avoid.
		expect(result.windSpeed).toBeCloseTo(5 * Math.cos((10 * Math.PI) / 180), 6);
	});

	it("normalises an interpolated direction into [0, 360)", () => {
		const result = interpolateWeather(
			sample({ windSpeed: 3, windDirection: 340 }),
			sample({ windSpeed: 3, windDirection: 20 }),
			0.25,
		);

		expect(result.windDirection).toBeGreaterThanOrEqual(0);
		expect(result.windDirection).toBeLessThan(360);
		// 349.686, not the 350.0 an ANGULAR interpolation would give. This is a
		// chord across the circle, not an arc along it, because averaging wind
		// is componentwise — the same reason the magnitude shrinks above. The
		// 0.31° gap is the chord/arc difference and is the correct behaviour,
		// pinned so a later switch to slerp is a deliberate change, not a drift.
		expect(result.windDirection).toBeCloseTo(349.6858951843818, 6);
	});

	it("shrinks the speed when two opposing winds are averaged", () => {
		// Vector interpolation, not scalar: a 5 m/s northerly and a 5 m/s
		// southerly average to CALM, not to 5 m/s from some third direction.
		// Killed by interpolating speed and direction independently, which is
		// the obvious implementation and preserves the magnitude wrongly.
		const result = interpolateWeather(
			sample({ windSpeed: 5, windDirection: 0 }),
			sample({ windSpeed: 5, windDirection: 180 }),
			0.5,
		);

		expect(result.windSpeed).toBeCloseTo(0, 6);
	});

	it("carries the later sample's queriedAt", () => {
		const result = interpolateWeather(
			sample({ queriedAt: 100 }),
			sample({ queriedAt: 500 }),
			0.5,
		);

		expect(result.queriedAt).toBe(500);
	});
});

describe("interpolating a weather series at an arbitrary instant", () => {
	const at = (iso: string, over: Partial<WeatherResponse> = {}) => ({
		slotMs: new Date(iso).getTime(),
		data: sample(over),
	});

	const series = [
		at("2026-08-04T15:00:00Z", { temperature: 20, windSpeed: 2 }),
		at("2026-08-04T15:15:00Z", { temperature: 24, windSpeed: 6 }),
		at("2026-08-04T15:30:00Z", { temperature: 26, windSpeed: 8 }),
	];

	it("interpolates between the two slots bracketing the instant", () => {
		const result = interpolateAt(series, new Date("2026-08-04T15:05:00Z"));

		// 15:05 is a third past 15:00, so temperature is 20 + (24-20)/3.
		expect(result!.temperature).toBeCloseTo(20 + 4 / 3, 10);
	});

	it("picks the correct bracket when the series has more than two slots", () => {
		// Killed by always using the first pair, which a two-slot fixture cannot
		// catch. 15:22:30 sits midway inside the SECOND interval.
		const result = interpolateAt(series, new Date("2026-08-04T15:22:30Z"));

		expect(result!.temperature).toBeCloseTo(25, 10);
	});

	it("returns the exact sample when the instant lands on a slot", () => {
		const result = interpolateAt(series, new Date("2026-08-04T15:15:00Z"));

		expect(result!.temperature).toBe(24);
		expect(result!.windSpeed).toBe(6);
	});

	it("clamps to the first slot before the series starts", () => {
		// A lap can begin fractionally before the first slot the fetch covered.
		// Extrapolating there would invent weather; the nearest real sample is
		// the honest answer and is at most 15 minutes away.
		const result = interpolateAt(series, new Date("2026-08-04T14:50:00Z"));

		expect(result!.temperature).toBe(20);
	});

	it("clamps to the last slot after the series ends", () => {
		const result = interpolateAt(series, new Date("2026-08-04T15:45:00Z"));

		expect(result!.temperature).toBe(26);
	});

	it("returns null for an empty series rather than inventing a value", () => {
		// The caller falls back to the selection-level constant, which is what
		// the app did before per-lap weather existed.
		expect(interpolateAt([], new Date("2026-08-04T15:05:00Z"))).toBeNull();
	});

	it("handles a single-slot series by returning it", () => {
		expect(
			interpolateAt([series[0]], new Date("2026-08-04T15:40:00Z"))!.temperature,
		).toBe(20);
	});
});
