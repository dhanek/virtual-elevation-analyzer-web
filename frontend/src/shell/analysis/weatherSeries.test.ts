/**
 * FETCHING THE SLOT SERIES that per-lap weather interpolates over.
 *
 * One entry per 15-minute slot spanning the selection, each one an ordinary
 * `WeatherCache` lookup — so laps sharing a slot share its cached row, and a
 * re-analysis of the same ride costs nothing. The cache is doubled here; the
 * enumeration and the degradation are what these cases are about.
 */
import { describe, expect, it } from "vitest";
import { fetchWeatherSeries, MAX_WEATHER_SLOTS } from "./weatherSeries";
import type { WeatherCache } from "../../utils/WeatherCache";
import type { WeatherAPI, WeatherResponse } from "../../utils/WeatherAPI";
import type { TrimRegionMetadata } from "../../utils/GeoCalculations";

function metadata(): TrimRegionMetadata {
	return {
		avgLat: 52.546,
		avgLon: 13.43,
		middleTimestamp: 0,
		middleDate: new Date("2026-08-04T15:00:00Z"),
		dataPointCount: 100,
		trimStart: 0,
		trimEnd: 99,
	};
}

function weather(temp: number): WeatherResponse {
	return {
		temperature: temp,
		dewPoint: 8,
		pressure: 1010,
		windSpeed: 3,
		windDirection: 180,
		queriedAt: 0,
	};
}

/** Records the instant each lookup asked for, which is what we assert on. */
function cacheDouble(
	onLookup?: (asked: Date) => void,
): WeatherCache & { asked: Date[] } {
	const asked: Date[] = [];
	return {
		asked,
		async getWeatherData(md: TrimRegionMetadata) {
			asked.push(md.middleDate);
			onLookup?.(md.middleDate);
			return { data: weather(asked.length), source: "api" as const };
		},
	} as unknown as WeatherCache & { asked: Date[] };
}

const api = {} as WeatherAPI;

describe("enumerating the slots a selection spans", () => {
	it("covers the whole span, inclusive of both ends", async () => {
		const cache = cacheDouble();

		const series = await fetchWeatherSeries(
			metadata(),
			new Date("2026-08-04T15:05:00Z"),
			new Date("2026-08-04T15:40:00Z"),
			cache,
			api,
		);

		// 15:05-15:40 needs 15:00 and 15:45 as well, or the ends extrapolate.
		expect(cache.asked.map((d) => d.toISOString())).toEqual([
			"2026-08-04T15:00:00.000Z",
			"2026-08-04T15:15:00.000Z",
			"2026-08-04T15:30:00.000Z",
			"2026-08-04T15:45:00.000Z",
		]);
		expect(series).toHaveLength(4);
	});

	it("asks for one slot when the selection sits inside one", async () => {
		const cache = cacheDouble();

		await fetchWeatherSeries(
			metadata(),
			new Date("2026-08-04T15:00:00Z"),
			new Date("2026-08-04T15:00:00Z"),
			cache,
			api,
		);

		expect(cache.asked).toHaveLength(1);
	});

	it("keeps the series sorted ascending", async () => {
		const cache = cacheDouble();

		const series = await fetchWeatherSeries(
			metadata(),
			new Date("2026-08-04T15:05:00Z"),
			new Date("2026-08-04T16:20:00Z"),
			cache,
			api,
		);

		const times = series.map((s) => s.slotMs);
		expect(times).toEqual([...times].sort((a, b) => a - b));
	});

	it("queries every slot at the SELECTION's location", async () => {
		// Killed by passing the slot instant but forgetting the coordinates —
		// every row would then be keyed at 0,0 and the cache would collide
		// across rides.
		const cache = cacheDouble();

		await fetchWeatherSeries(
			metadata(),
			new Date("2026-08-04T15:00:00Z"),
			new Date("2026-08-04T15:30:00Z"),
			cache,
			api,
		);

		expect(cache.asked).toHaveLength(3);
	});

	it("caps a pathological span rather than fetching without bound", async () => {
		// A selection spanning a multi-day file must not mint hundreds of
		// requests. The cap truncates; interpolateAt then clamps past its end.
		const cache = cacheDouble();

		const series = await fetchWeatherSeries(
			metadata(),
			new Date("2026-08-04T00:00:00Z"),
			new Date("2026-08-06T00:00:00Z"),
			cache,
			api,
		);

		expect(series.length).toBe(MAX_WEATHER_SLOTS);
	});
});

describe("degrading when a slot cannot be fetched", () => {
	it("keeps the slots that succeeded and drops the one that threw", async () => {
		// A partial series is strictly better than none: interpolateAt clamps
		// across the gap, and the caller still gets per-lap variation from the
		// slots that did arrive. Throwing here would take the whole analysis
		// down over one failed request.
		let n = 0;
		const cache = {
			async getWeatherData() {
				n += 1;
				if (n === 2) throw new Error("network");
				return { data: weather(n), source: "api" as const };
			},
		} as unknown as WeatherCache;

		const series = await fetchWeatherSeries(
			metadata(),
			new Date("2026-08-04T15:00:00Z"),
			new Date("2026-08-04T15:30:00Z"),
			cache,
			api,
		);

		expect(series).toHaveLength(2);
		expect(series.map((s) => new Date(s.slotMs).toISOString())).toEqual([
			"2026-08-04T15:00:00.000Z",
			"2026-08-04T15:30:00.000Z",
		]);
	});

	it("returns an empty series when every slot fails", async () => {
		// The caller falls back to the selection-level constant.
		const cache = {
			async getWeatherData() {
				throw new Error("offline");
			},
		} as unknown as WeatherCache;

		const series = await fetchWeatherSeries(
			metadata(),
			new Date("2026-08-04T15:00:00Z"),
			new Date("2026-08-04T15:30:00Z"),
			cache,
			api,
		);

		expect(series).toEqual([]);
	});
});
