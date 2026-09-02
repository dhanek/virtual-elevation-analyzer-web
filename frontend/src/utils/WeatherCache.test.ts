/**
 * THE CACHE'S SIZE CAP, against a real IndexedDB.
 *
 * The cache was permanent by construction: `clearCache()` was the only removal
 * path and its sole caller is a manual button. `autoRho` reaches it on every
 * analysis, keyed on the mean lat/lon of the TRIM REGION, so every distinct trim
 * window mints a fresh row that nothing ever removes.
 *
 * `fake-indexeddb` is the cache's own engine, not a stub of it — the same cursor
 * ordering and transaction semantics the browser applies. That matters more here
 * than it does for a keyed delete: the assertion that carries this file is
 * "the OLDEST row is the one that goes", and cursor order over a non-unique
 * index is precisely the thing a hand-rolled double would be free to invent.
 *
 * Every case below is paired with the mutation that kills it; see the comment
 * on each.
 */
import { IDBFactory } from "fake-indexeddb";
import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import { WeatherCache, WEATHER_CACHE_MAX_ENTRIES } from "./WeatherCache";
import type { WeatherAPI, WeatherResponse } from "./WeatherAPI";
import type { TrimRegionMetadata } from "./GeoCalculations";

const weather: WeatherResponse = {
	temperature: 18.5,
	dewPoint: 9.2,
	pressure: 1013.4,
	windSpeed: 3.1,
	windDirection: 220,
	queriedAt: 0,
};

/**
 * Distinct rows are minted by moving the LATITUDE, which is what a trim-window
 * change does in production — `calculateTrimRegionMetadata` averages the GPS
 * points inside the window, so moving either end moves the centroid.
 */
function metadataAt(lat: number): TrimRegionMetadata {
	return {
		avgLat: lat,
		avgLon: 8.5,
		middleTimestamp: 1_754_300_000,
		middleDate: new Date("2026-08-04T10:07:00.000Z"),
		dataPointCount: 500,
		trimStart: 0,
		trimEnd: 500,
	};
}

/**
 * The API is stubbed because it is the one collaborator that would otherwise go
 * to the network; the CACHE under test is real, `fake-indexeddb` and all. The
 * call count is what makes a miss visible -- `getWeatherData` reaches the API
 * only when the key is absent.
 */
function countingApi(): WeatherAPI & { calls: number } {
	const api = {
		calls: 0,
		async fetchWeatherData(): Promise<WeatherResponse> {
			api.calls += 1;
			return { ...weather };
		},
	};
	return api as unknown as WeatherAPI & { calls: number };
}

/**
 * Whether `lat`'s row is still in the store, read WITHOUT writing.
 *
 * `getWeatherData` is the tempting probe -- "did it reach the API?" -- but it
 * stores on a miss, so asking whether an evicted row is gone puts it back and
 * pushes out the next-oldest, and the assertions after the first one all read a
 * cache the probe itself rearranged. `getEntriesForLocation` is a plain index
 * read. Each case varies only the latitude, so a lat addresses exactly one row.
 */
async function survives(cache: WeatherCache, lat: number): Promise<boolean> {
	const entries = await cache.getEntriesForLocation(lat, 8.5);
	return entries.length === 1;
}

describe("bounding the weather cache", () => {
	let api: WeatherAPI & { calls: number };

	beforeEach(() => {
		// A FRESH factory per test rather than deleting the database on a shared
		// one — `deleteDatabase` against a still-open connection BLOCKS rather
		// than erroring, and surfaces as an unreadable hook timeout.
		globalThis.indexedDB = new IDBFactory();
		api = countingApi();

		// `cachedAt` is `Date.now()` at write time, and the eviction order is
		// read off it. Real time ties inside a millisecond, and a tie falls back
		// to primary-key order — which is the lat-derived cache key, so a broken
		// eviction could pass by coincidence. Fake timers make the order the
		// test's own, and each `store` below advances it explicitly.
		//
		// ONLY `Date` is faked. `fake-indexeddb` schedules every transaction's
		// event loop on `setImmediate`, so vitest's default `toFake` set freezes
		// the database itself: every request hangs and the suite fails as six
		// 5-second hook timeouts rather than as assertions.
		vi.useFakeTimers({ toFake: ["Date"] });
		vi.setSystemTime(new Date("2026-09-02T12:00:00.000Z"));
	});

	afterEach(() => {
		vi.useRealTimers();
	});

	async function store(cache: WeatherCache, lat: number): Promise<void> {
		await cache.getWeatherData(metadataAt(lat), api);
		vi.advanceTimersByTime(1000);
	}

	/**
	 * Kills a cap read as "evict once the store REACHES it" instead of "once it
	 * exceeds it" — the store sits at exactly 3 here, so an eviction one row
	 * eager takes a live entry while the count assertions below still see a
	 * bounded cache.
	 */
	it("keeps every entry while the cache is under its cap", async () => {
		const cache = new WeatherCache(3);

		await store(cache, 47.1);
		await store(cache, 47.2);
		await store(cache, 47.3);

		expect((await cache.getCacheStats()).count).toBe(3);
	});

	/**
	 * Kills a no-op eviction, and an off-by-one that leaves the store one row
	 * over the cap forever.
	 */
	it("settles at exactly the cap once the cap is crossed", async () => {
		const cache = new WeatherCache(3);

		for (const lat of [47.1, 47.2, 47.3, 47.4, 47.5]) {
			await store(cache, lat);
		}

		expect((await cache.getCacheStats()).count).toBe(3);
	});

	/**
	 * THE assertion of this file, and the case that stops the one above it from
	 * being vacuous: a count settling at the cap says nothing about WHICH rows
	 * were taken.
	 *
	 * Insertion order and key order deliberately DISAGREE — the highest latitude
	 * is written first, so it is the oldest row and the LAST in cursor order by
	 * primary key. An eviction that walked the primary key, or walked `cachedAt`
	 * descending, takes 47.1 and leaves 47.4; only oldest-first by insertion
	 * takes 47.4.
	 */
	it("evicts the oldest-inserted entry first", async () => {
		const cache = new WeatherCache(3);

		await store(cache, 47.4); // oldest, highest key
		await store(cache, 47.3);
		await store(cache, 47.2);
		await store(cache, 47.1); // newest, lowest key — pushes the cap

		expect(await survives(cache, 47.4)).toBe(false);
		expect(await survives(cache, 47.3)).toBe(true);
		expect(await survives(cache, 47.2)).toBe(true);
		expect(await survives(cache, 47.1)).toBe(true);
	});

	/**
	 * Kills an eviction driven by a running put-count rather than by the store's
	 * actual size. `updateCachedEntry` overwrites a key that is already present
	 * — `autoRho` reaches it whenever a cached row came back without wind data —
	 * so the row count does not move and nothing may be dropped.
	 */
	it("evicts nothing when an existing key is re-stored", async () => {
		const cache = new WeatherCache(3);

		await store(cache, 47.1);
		await store(cache, 47.2);
		await store(cache, 47.3);

		await cache.updateCachedEntry(metadataAt(47.2), { ...weather, temperature: 21 });

		expect((await cache.getCacheStats()).count).toBe(3);
		expect(await survives(cache, 47.1)).toBe(true);
		expect(await survives(cache, 47.3)).toBe(true);
	});

	/**
	 * The READ path after an eviction has run, which every case above leaves
	 * untested — they all assert which rows are in the store, never that a
	 * surviving row is still SERVED from it. Eviction is the one operation that
	 * could leave the store populated but no longer answering, and a cache that
	 * silently stopped hitting would show up only as an Open-Meteo bill.
	 *
	 * The first draft of this case asserted `survives(47.4)` instead, and was a
	 * restatement of the newest-row assertion in the case above: the mutation
	 * pass killed both with the same cursor direction and nothing else touched
	 * it.
	 */
	it("still serves a surviving row from cache after evicting", async () => {
		const cache = new WeatherCache(3);

		for (const lat of [47.1, 47.2, 47.3, 47.4]) {
			await store(cache, lat);
		}

		const reader = countingApi();
		const entry = await cache.getWeatherData(metadataAt(47.4), reader);

		expect(reader.calls).toBe(0);
		expect(entry.source).toBe("cache");
		expect(entry.data.windSpeed).toBe(weather.windSpeed);
	});

	/**
	 * The shipped default has to be a real cap, not 0 or 1. Asserting the
	 * constant's value against itself would be a tautology; storing through a
	 * default-constructed cache and finding every row still there is not.
	 */
	it("ships a default cap that does not evict a handful of rides", async () => {
		const cache = new WeatherCache();

		for (let i = 0; i < 10; i++) {
			await store(cache, 47 + i / 100);
		}

		expect((await cache.getCacheStats()).count).toBe(10);
		expect(WEATHER_CACHE_MAX_ENTRIES).toBeGreaterThanOrEqual(10);
	});
});
