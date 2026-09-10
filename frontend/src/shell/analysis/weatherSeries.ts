/**
 * The 15-minute weather slots a selection spans, fetched once and interpolated
 * many times.
 *
 * WHY A SERIES RATHER THAN A LOOKUP PER LAP. Laps are short — median 2.8
 * minutes across the local rides — so several laps routinely fall inside one
 * slot, and a fetch per lap would ask for the same instant repeatedly. Slots
 * are the natural unit: one cache row each, shared by every lap that touches
 * them. It also keeps the expensive half ASYNC and the consumed half SYNC,
 * which matters because the plot path (`updateModeVEPlots`) recomputes on every
 * slider move and cannot await anything.
 *
 * Each lookup goes through the ordinary `WeatherCache`, so the coarsened key
 * applies and a re-analysis of the same ride costs no requests at all.
 */
import {
	bracketingSlots,
	interpolateAt,
	SLOT_MS,
} from "../../analysis/segmentWeather";
import type { WeatherSlot } from "../../analysis/segmentWeather";
import type { WeatherCache } from "../../utils/WeatherCache";
import type { WeatherAPI } from "../../utils/WeatherAPI";
import type { TrimRegionMetadata } from "../../utils/GeoCalculations";
import { log } from "../../utils/log";

/**
 * Most slots one selection may fetch — 12 hours.
 *
 * A selection is normally an hour or two, so this is not a limit anyone meets
 * honestly; it is there so a corrupt timestamp or a multi-day file cannot turn
 * one analysis into hundreds of requests. Past the cap the series simply ends
 * and `interpolateAt` clamps, which degrades to the old constant-ish behaviour
 * for the tail rather than failing.
 */
export const MAX_WEATHER_SLOTS = 48;

/**
 * Fetch every slot from the one at or before `start` to the one at or after
 * `end`, inclusive.
 *
 * Both ends are extended to a slot boundary deliberately: a selection starting
 * at 15:05 needs the 15:00 sample, or its first lap has nothing to interpolate
 * back to and would clamp to a slot that is already inside the ride.
 *
 * A slot that fails is DROPPED, not fatal. A partial series still gives per-lap
 * variation from the slots that arrived, and `interpolateAt` spans the gap; a
 * throw here would take an entire analysis down over one failed request. An
 * empty result tells the caller to fall back to the selection-level constant.
 *
 * Lookups are sequential rather than parallel. The cache absorbs a re-analysis
 * entirely, so this cost is paid once per ride, and a burst of parallel
 * requests to a free public API is a worse neighbour than a slow loop.
 */
export async function fetchWeatherSeries(
	metadata: TrimRegionMetadata,
	start: Date,
	end: Date,
	cache: WeatherCache,
	api: WeatherAPI,
): Promise<WeatherSlot[]> {
	const first = bracketingSlots(start).before.getTime();
	const lastBracket = bracketingSlots(end);
	// `after` equals `before` when `end` sits exactly on a slot, which is what
	// makes a selection inside a single slot cost one lookup rather than two.
	const last = lastBracket.after.getTime();

	const slots: number[] = [];
	for (
		let t = first;
		t <= last && slots.length < MAX_WEATHER_SLOTS;
		t += SLOT_MS
	) {
		slots.push(t);
	}

	const series: WeatherSlot[] = [];
	for (const slotMs of slots) {
		try {
			const entry = await cache.getWeatherData(
				{ ...metadata, middleDate: new Date(slotMs) },
				api,
			);
			series.push({ slotMs, data: entry.data });
		} catch (error) {
			log.debug(
				`⚠️ Weather slot ${new Date(slotMs).toISOString()} unavailable; ` +
					`interpolating across it`,
				error,
			);
		}
	}

	return series;
}

/**
 * The wall-clock span a trim window covers, or null when it has no usable
 * timestamps.
 *
 * Read from the FILTERED (selected-laps) series, so it is the span of the laps
 * actually being analysed — including the gaps between them, which is the point:
 * a selection of lap 2 and lap 16 spans the hours in between, and those hours
 * are exactly where the wind moves.
 */
export function trimRegionTimeSpan(
	filtered: { timestamps?: ArrayLike<number> | null } | null | undefined,
	trimStart: number,
	trimEnd: number,
): { start: Date; end: Date } | null {
	const timestamps = filtered?.timestamps;
	if (!timestamps || timestamps.length === 0) return null;

	const lo = Math.max(0, Math.min(trimStart, timestamps.length - 1));
	const hi = Math.max(0, Math.min(trimEnd, timestamps.length - 1));
	if (hi < lo) return null;

	const first = timestamps[lo];
	const last = timestamps[hi];
	if (!Number.isFinite(first) || !Number.isFinite(last)) return null;

	// FIT timestamps are seconds; everything downstream works in milliseconds.
	return { start: new Date(first * 1000), end: new Date(last * 1000) };
}

/**
 * The rho/wind a single segment should be analysed at, or null to keep the
 * selection-level values.
 *
 * Returns null — meaning "use `params` unchanged" — whenever per-lap weather
 * cannot honestly improve on it: no series was fetched, the segment has no
 * usable timestamps, or the wind is coming from the FIT file's own channel
 * rather than the API. That last one matters: a recorded air-speed series is a
 * measurement of the air the rider actually met, and overriding it with a model
 * would replace data with a forecast.
 *
 * `calcRho` is injected rather than imported so this stays node-testable; the
 * production caller passes the WASM air-density calculator.
 */
export function segmentWeatherOverride(
	series: readonly WeatherSlot[] | null | undefined,
	timestamps: ArrayLike<number>,
	windSource: "constant" | "fit" | "none",
	calcRho: (tempC: number, pressureHpa: number, dewPointC: number) => number,
): { rho: number; wind_speed: number; wind_direction: number } | null {
	if (!series || series.length === 0) return null;
	if (windSource !== "constant") return null;
	if (timestamps.length === 0) return null;

	const first = timestamps[0];
	const last = timestamps[timestamps.length - 1];
	if (!Number.isFinite(first) || !Number.isFinite(last)) return null;

	// The segment's own MIDPOINT, which is the same convention the
	// selection-level metadata uses — one instant standing for one span.
	const midpoint = new Date(((first + last) / 2) * 1000);
	const weather = interpolateAt(series, midpoint);
	if (!weather) return null;

	return {
		// 4 decimals, matching what autoRho writes into params, so a per-lap
		// value and the selection value are directly comparable on screen.
		rho: parseFloat(
			calcRho(weather.temperature, weather.pressure, weather.dewPoint).toFixed(
				4,
			),
		),
		wind_speed: weather.windSpeed,
		wind_direction: weather.windDirection,
	};
}
