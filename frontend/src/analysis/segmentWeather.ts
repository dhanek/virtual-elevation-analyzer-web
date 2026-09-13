/**
 * PER-LAP WEATHER: one sample per independently-integrated segment, each
 * interpolated between the two 15-minute slots that bracket that segment's own
 * midpoint.
 *
 * WHAT THIS REPLACES. `autoRho` resolved ONE weather sample, at the trim
 * region's middle timestamp, and every selected lap was analysed with it. A
 * multi-lap selection routinely spans hours — the laps are concatenated, the
 * gaps between them are not — so laps recorded far apart were all given the
 * wind of whichever instant happened to sit in the middle. Measured on the
 * historical-forecast 15-minute series, wind moves up to 1.20 m/s across a
 * three-hour ride, against a 0.3 m/s bar.
 *
 * WHY INTERPOLATE RATHER THAN SNAP. Snapping a lap to its nearest slot makes
 * the value jump as a trim slider crosses a slot boundary, for no better
 * reason than rounding. Weighting the two neighbours by where the lap actually
 * sits is both smoother and closer to the truth, and costs one extra fetch that
 * the cache usually absorbs — laps sharing a bracket share both its keys.
 *
 * WIND IS A VECTOR AND EVERYTHING ELSE IS NOT. This is the whole subtlety of
 * the file. Interpolating a bearing as a scalar averages 350° and 10° to 180°:
 * a headwind becomes a tailwind, the single worst error this code could make.
 * On real 15-minute data 0.3% of consecutive slot pairs cross 0/360, so it is
 * rare enough to survive casual testing and catastrophic when it lands. Wind is
 * therefore resolved through its components; temperature, dew point and
 * pressure are ordinary linear interpolations.
 */
import type { WeatherResponse } from "../utils/WeatherAPI";

/** The API's finest temporal resolution, and the bracket width. */
export const SLOT_MS = 15 * 60 * 1000;

export interface SlotBracket {
	/** The 15-minute slot at or before the instant. */
	before: Date;
	/** The next slot, or `before` again when the instant sits exactly on one. */
	after: Date;
	/** How much of `after` the interpolation takes; 0 means "use `before`". */
	weightAfter: number;
}

/**
 * The two slots bracketing `instant`, and where between them it falls.
 *
 * An instant sitting exactly on a slot returns that slot twice with weight 0,
 * so the caller fetches once instead of fetching a needless second sample and
 * blending it at zero weight.
 */
export function bracketingSlots(instant: Date): SlotBracket {
	const ms = instant.getTime();
	const floored = Math.floor(ms / SLOT_MS) * SLOT_MS;

	if (floored === ms) {
		const exact = new Date(floored);
		return { before: exact, after: exact, weightAfter: 0 };
	}

	return {
		before: new Date(floored),
		after: new Date(floored + SLOT_MS),
		weightAfter: (ms - floored) / SLOT_MS,
	};
}

function lerp(a: number, b: number, t: number): number {
	return a + (b - a) * t;
}

/**
 * Blend two samples, `weightAfter` of the way from `before` to `after`.
 *
 * `queriedAt` is taken from the later sample rather than blended: it records
 * when the data was fetched, not what the weather was, and an average of two
 * fetch times is a timestamp at which nothing happened.
 */
export function interpolateWeather(
	before: WeatherResponse,
	after: WeatherResponse,
	weightAfter: number,
): WeatherResponse {
	if (weightAfter === 0) return { ...before };
	if (weightAfter === 1) return { ...after };

	// Meteorological convention: direction is where the wind comes FROM, so the
	// components carry a negation. It cancels on the way back out through
	// atan2, but writing the pair consistently keeps the intermediate values
	// meaningful to anyone who logs them.
	const toComponents = (w: WeatherResponse): [number, number] => {
		const rad = (w.windDirection * Math.PI) / 180;
		return [-w.windSpeed * Math.sin(rad), -w.windSpeed * Math.cos(rad)];
	};

	const [u1, v1] = toComponents(before);
	const [u2, v2] = toComponents(after);
	const u = lerp(u1, u2, weightAfter);
	const v = lerp(v1, v2, weightAfter);

	// Two opposing winds of equal strength cancel to calm, which is the
	// physically right answer and the one scalar interpolation cannot give.
	const windSpeed = Math.hypot(u, v);
	const windDirection =
		windSpeed === 0
			? before.windDirection
			: ((Math.atan2(-u, -v) * 180) / Math.PI + 360) % 360;

	return {
		temperature: lerp(before.temperature, after.temperature, weightAfter),
		dewPoint: lerp(before.dewPoint, after.dewPoint, weightAfter),
		pressure: lerp(before.pressure, after.pressure, weightAfter),
		windSpeed,
		windDirection,
		queriedAt: after.queriedAt,
	};
}

/** One fetched 15-minute slot, keyed by the instant it describes. */
export interface WeatherSlot {
	slotMs: number;
	data: WeatherResponse;
}

/**
 * The weather at `instant`, interpolated from a slot series sorted ascending.
 *
 * CLAMPS RATHER THAN EXTRAPOLATES at both ends. A lap can begin fractionally
 * before the first slot the fetch covered or end after the last; projecting a
 * trend past the data would invent weather that was never reported, and the
 * nearest real sample is at most one slot — 15 minutes — away.
 *
 * Returns null for an empty series so the caller can fall back to the
 * selection-level constant, which is what the app used before per-lap weather.
 */
export function interpolateAt(
	series: readonly WeatherSlot[],
	instant: Date,
): WeatherResponse | null {
	if (series.length === 0) return null;

	const ms = instant.getTime();
	if (ms <= series[0].slotMs) return { ...series[0].data };

	const last = series[series.length - 1];
	if (ms >= last.slotMs) return { ...last.data };

	// Linear scan: a selection spans tens of slots at most, so the index maths
	// a binary search would add costs more in review than it saves in time.
	for (let i = 1; i < series.length; i++) {
		const after = series[i];
		if (ms > after.slotMs) continue;

		const before = series[i - 1];
		const span = after.slotMs - before.slotMs;
		const weightAfter = span === 0 ? 0 : (ms - before.slotMs) / span;
		return interpolateWeather(before.data, after.data, weightAfter);
	}

	return { ...last.data };
}
