/**
 * FETCHING THE SLOT SERIES that per-lap weather interpolates over.
 *
 * One entry per 15-minute slot spanning the selection, each one an ordinary
 * `WeatherCache` lookup — so laps sharing a slot share its cached row, and a
 * re-analysis of the same ride costs nothing. The cache is doubled here; the
 * enumeration and the degradation are what these cases are about.
 */
import { describe, expect, it } from "vitest";
import {
	fetchWeatherSeries,
	MAX_WEATHER_SLOTS,
	segmentWeatherOverride,
	trimRegionTimeSpan,
} from "./weatherSeries";
import type { WeatherSlot } from "../../analysis/segmentWeather";
import type { AnalysisParameters } from "../../components/AnalysisParameters";
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

describe("stopping early once the caller is stale", () => {
	it("stops before the next lookup and returns the partial series", async () => {
		const cache = cacheDouble();

		const series = await fetchWeatherSeries(
			metadata(),
			new Date("2026-08-04T15:05:00Z"),
			new Date("2026-08-04T15:40:00Z"),
			cache,
			api,
			() => cache.asked.length >= 2,
		);

		expect(cache.asked).toHaveLength(2);
		expect(series).toHaveLength(2);
	});

	it("fetches every slot when no staleness check is given", async () => {
		const cache = cacheDouble();

		const series = await fetchWeatherSeries(
			metadata(),
			new Date("2026-08-04T15:05:00Z"),
			new Date("2026-08-04T15:40:00Z"),
			cache,
			api,
		);

		expect(cache.asked).toHaveLength(4);
		expect(series).toHaveLength(4);
	});
});

const SLOT0_MS = Date.parse("2026-08-04T15:00:00Z");
const SLOT1_MS = SLOT0_MS + 15 * 60 * 1000;

/** Two slots whose winds differ, so the instant they are read at is visible. */
function twoSlotSeries(): WeatherSlot[] {
	return [
		{
			slotMs: SLOT0_MS,
			data: { ...weather(10), windSpeed: 2, windDirection: 90 },
		},
		{
			slotMs: SLOT1_MS,
			data: { ...weather(12), windSpeed: 6, windDirection: 90 },
		},
	];
}

/** A segment spanning both slots, so its midpoint sits exactly between them. */
const SEGMENT_TS = [SLOT0_MS / 1000, SLOT1_MS / 1000];

function overrideParams(
	overrides: Partial<AnalysisParameters> = {},
): AnalysisParameters {
	return {
		rho: 1.2,
		auto_calculate_rho: true,
		rho_source: "weather_api",
		wind_speed: 5,
		wind_direction: 270,
		wind_entry: "weather",
		...overrides,
	} as AnalysisParameters;
}

const calcRho = () => 1.234567;

describe("segmentWeatherOverride — who owns the fields", () => {
	it("is null for a null series and for an empty one", () => {
		expect(
			segmentWeatherOverride(
				null,
				SEGMENT_TS,
				"constant",
				overrideParams(),
				calcRho,
			),
		).toBeNull();
		expect(
			segmentWeatherOverride(
				[],
				SEGMENT_TS,
				"constant",
				overrideParams(),
				calcRho,
			),
		).toBeNull();
	});

	it("is null when the wind comes from the FIT file, or from nowhere", () => {
		for (const source of ["fit", "none"] as const) {
			expect(
				segmentWeatherOverride(
					twoSlotSeries(),
					SEGMENT_TS,
					source,
					overrideParams(),
					calcRho,
				),
			).toBeNull();
		}
	});

	it("is null for empty timestamps and for a non-finite first or last one", () => {
		for (const ts of [[], [NaN, SEGMENT_TS[1]], [SEGMENT_TS[0], Infinity]]) {
			expect(
				segmentWeatherOverride(
					twoSlotSeries(),
					ts,
					"constant",
					overrideParams(),
					calcRho,
				),
			).toBeNull();
		}
	});

	it("is null when auto-rho is off, so a leftover series cannot replace a typed rho", () => {
		expect(
			segmentWeatherOverride(
				twoSlotSeries(),
				SEGMENT_TS,
				"constant",
				overrideParams({ auto_calculate_rho: false }),
				calcRho,
			),
		).toBeNull();
	});

	it("is null when rho_source is manual, which the failed-fetch path sets", () => {
		expect(
			segmentWeatherOverride(
				twoSlotSeries(),
				SEGMENT_TS,
				"constant",
				overrideParams({ rho_source: "manual" }),
				calcRho,
			),
		).toBeNull();
	});

	it("a weather-owned wind is read at the segment midpoint, with rho to 4 decimals", () => {
		expect(
			segmentWeatherOverride(
				twoSlotSeries(),
				SEGMENT_TS,
				"constant",
				overrideParams({ wind_entry: "weather" }),
				calcRho,
			),
		).toEqual({ rho: 1.2346, wind_speed: 4, wind_direction: 90 });
	});

	it("a hand-typed wind is kept, and only the rho comes from the series", () => {
		expect(
			segmentWeatherOverride(
				twoSlotSeries(),
				SEGMENT_TS,
				"constant",
				overrideParams({ wind_entry: "manual" }),
				calcRho,
			),
		).toEqual({ rho: 1.2346, wind_speed: 5, wind_direction: 270 });
	});

	it("a legacy wind of unknown provenance is kept the same way (D-a)", () => {
		expect(
			segmentWeatherOverride(
				twoSlotSeries(),
				SEGMENT_TS,
				"constant",
				overrideParams({ wind_entry: "unknown" }),
				calcRho,
			),
		).toEqual({ rho: 1.2346, wind_speed: 5, wind_direction: 270 });
	});

	it("an absent or NaN wind is fillable even when marked manual", () => {
		for (const wind_speed of [undefined, NaN]) {
			expect(
				segmentWeatherOverride(
					twoSlotSeries(),
					SEGMENT_TS,
					"constant",
					overrideParams({
						wind_entry: "manual",
						wind_speed: wind_speed as unknown as number,
					}),
					calcRho,
				),
			).toEqual({ rho: 1.2346, wind_speed: 4, wind_direction: 90 });
		}
	});
});

describe("trimRegionTimeSpan", () => {
	it("is null for missing filtered data and for empty timestamps", () => {
		expect(trimRegionTimeSpan(null, 0, 1)).toBeNull();
		expect(trimRegionTimeSpan(undefined, 0, 1)).toBeNull();
		expect(trimRegionTimeSpan({ timestamps: [] }, 0, 1)).toBeNull();
	});

	it("clamps a trim beyond the array to the last index", () => {
		const span = trimRegionTimeSpan({ timestamps: [1000, 1060] }, 5, 9);
		expect(span?.start.getTime()).toBe(1_060_000);
		expect(span?.end.getTime()).toBe(1_060_000);
	});

	it("is null when the end sits before the start after clamping", () => {
		expect(trimRegionTimeSpan({ timestamps: [1000, 1060] }, 5, 0)).toBeNull();
	});

	it("is null when an end timestamp is not finite", () => {
		expect(trimRegionTimeSpan({ timestamps: [1000, NaN] }, 0, 1)).toBeNull();
	});

	it("converts FIT seconds to milliseconds", () => {
		const span = trimRegionTimeSpan({ timestamps: [1000, 1060] }, 0, 1);
		expect(span?.start.getTime()).toBe(1_000_000);
		expect(span?.end.getTime()).toBe(1_060_000);
	});
});
