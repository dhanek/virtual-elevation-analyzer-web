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
import {
	WeatherCache,
	WEATHER_CACHE_MAX_ENTRIES,
	WEATHER_KEY_DECIMALS,
	buildWeatherQueryKey,
	resetWeatherCacheInstance,
	weatherCacheInstance,
} from "./WeatherCache";
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

		await cache.updateCachedEntry(metadataAt(47.2), {
			...weather,
			temperature: 21,
		});

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

/**
 * THE CONNECTION'S LIFETIME. `initialize()` assigned `this.db` and nothing ever
 * released it, while `autoRho` built a NEW cache inside its query path — so a
 * long session accumulated one open IndexedDB connection per distinct trim
 * window, which is exactly the per-window churn the cap above is sized for.
 *
 * The observable is `deleteDatabase`, and it is the right one rather than a
 * convenient one: an open connection makes a delete BLOCK rather than fail, so
 * a leaked connection shows up as a request that never fires `onsuccess`. That
 * is the same property the harness above documents as an unreadable hook
 * timeout, used deliberately here.
 */
describe("WeatherCache connection lifetime", () => {
	beforeEach(() => {
		globalThis.indexedDB = new IDBFactory();
	});

	/** Resolves true if the delete completed, false if it was blocked. */
	function deleteUnblocked(dbName: string): Promise<boolean> {
		return new Promise((resolve) => {
			const request = indexedDB.deleteDatabase(dbName);
			request.onsuccess = () => resolve(true);
			request.onerror = () => resolve(true);
			request.onblocked = () => resolve(false);
		});
	}

	it("releases the connection on close, so a delete is not blocked", async () => {
		const cache = new WeatherCache();
		await cache.initialize();

		cache.close();

		expect(await deleteUnblocked("ve-weather-cache")).toBe(true);
	});

	it("holds the connection open until close is called", async () => {
		// The paired negative: without it, a `close()` that did nothing at all
		// would still pass the case above, because nothing would have proved the
		// connection was ever held.
		const cache = new WeatherCache();
		await cache.initialize();

		expect(await deleteUnblocked("ve-weather-cache")).toBe(false);
	});

	it("re-opens on the next use after a close", async () => {
		// Closing must not poison the instance: `initialize()` memoizes, so a
		// close that left `initPromise` set would resolve immediately against a
		// dead connection and every later read would throw.
		const cache = new WeatherCache();
		const api = countingApi();
		await cache.getWeatherData(metadataAt(47.1), api);

		cache.close();
		const entry = await cache.getWeatherData(metadataAt(47.1), api);

		expect(entry.data.temperature).toBe(weather.temperature);
	});

	it("is safe to close twice, and to close one that was never opened", async () => {
		const cache = new WeatherCache();
		expect(() => cache.close()).not.toThrow();

		await cache.initialize();
		cache.close();
		expect(() => cache.close()).not.toThrow();
	});
});

/**
 * THE SHARED INSTANCE. The leak had two halves and `close()` only fixes one:
 * `autoRho` constructed a cache INSIDE its query path, so each distinct trim
 * window built an instance that opened its own connection. Every other store in
 * this directory is built once and held (`ResultsStorage`, `ParameterStorage`),
 * and that is the shape this restores — the accessor, not the constructor, is
 * what callers on a hot path reach for.
 */
describe("the shared WeatherCache instance", () => {
	beforeEach(() => {
		globalThis.indexedDB = new IDBFactory();
		resetWeatherCacheInstance();
	});

	it("hands every caller the same object", () => {
		expect(weatherCacheInstance()).toBe(weatherCacheInstance());
	});

	it("re-opens after the shared instance is closed and released", async () => {
		const first = weatherCacheInstance();
		await first.initialize();

		resetWeatherCacheInstance();

		const second = weatherCacheInstance();
		expect(second).not.toBe(first);
		await expect(second.initialize()).resolves.toBeUndefined();
	});
});

/**
 * THE KEY'S WIDTH, which decides whether the cache can ever hit.
 *
 * The key used the trim centroid at 6 decimals — 0.11 m — while the data behind
 * it is a 1–11 km model grid. Measured on real rides, a ONE-POINT slider nudge
 * moves the centroid 0.1–2.5 m, so every nudge minted a row and re-queried the
 * API; the cache was write-only in practice and the size cap was load-bearing.
 *
 * 3 decimals (~111 m, ≤78 m worst case) is the width. It is not a guess about
 * accuracy: Open-Meteo snaps to its own grid and returns byte-identical data for
 * points 500 m apart, so rounding the KEY discards precision the API already
 * discarded. The query itself is deliberately left at full precision — rounding
 * it would change nothing observable.
 *
 * What this buys is a HIGH hit rate, not a guaranteed one. Snapping to a grid
 * means two points can straddle a cell boundary however close they are, so a
 * nudge across one still misses. That case has its own test below rather than
 * being left for someone to rediscover as a bug.
 *
 * Each case names the mutation that kills it.
 */
describe("the width of the weather cache key", () => {
	let api: WeatherAPI & { calls: number };

	beforeEach(() => {
		globalThis.indexedDB = new IDBFactory();
		api = countingApi();
	});

	afterEach(() => {
		resetWeatherCacheInstance();
	});

	/** Same fixture as above but with both coordinates free. */
	function metadataAtLatLon(lat: number, lon: number): TrimRegionMetadata {
		return { ...metadataAt(lat), avgLon: lon };
	}

	it("serves a second window ~40 m away from cache", async () => {
		// Killed by removing the rounding: at 6 decimals these are two keys and
		// the API is called twice. This is the production case — a slider nudge.
		// Both points sit INSIDE cell 47.123_8.654, which is the case the
		// rounding is for; see the boundary case below for the one it is not.
		const cache = new WeatherCache();
		await cache.getWeatherData(metadataAtLatLon(47.1231, 8.6541), api);
		await cache.getWeatherData(metadataAtLatLon(47.1234, 8.6544), api);

		expect(api.calls).toBe(1);
	});

	it("still misses when a small move straddles a cell boundary", async () => {
		// NOT a defect, and recorded so nobody files it as one. Snapping to a
		// grid buys a high hit rate, never a guaranteed one: two points 40 m
		// apart land in different cells when the boundary runs between them.
		// 47.123456 → 47.123, 47.123812 → 47.124.
		const cache = new WeatherCache();
		await cache.getWeatherData(metadataAtLatLon(47.123456, 8.654321), api);
		await cache.getWeatherData(metadataAtLatLon(47.123812, 8.654321), api);

		expect(api.calls).toBe(2);
	});

	it("still fetches for a window ~500 m away", async () => {
		// Killed by rounding too hard (2 decimals or coarser), which would fold
		// genuinely different locations onto one row.
		const cache = new WeatherCache();
		await cache.getWeatherData(metadataAtLatLon(47.123456, 8.654321), api);
		await cache.getWeatherData(metadataAtLatLon(47.128456, 8.654321), api);

		expect(api.calls).toBe(2);
	});

	it("still separates two 15-minute slots at one location", async () => {
		// Killed by coarsening TIME along with location. The key has two
		// dimensions and only one of them was too narrow.
		const cache = new WeatherCache();
		const base = metadataAtLatLon(47.123456, 8.654321);
		await cache.getWeatherData(base, api);
		await cache.getWeatherData(
			{ ...base, middleDate: new Date("2026-08-04T10:37:00.000Z") },
			api,
		);

		expect(api.calls).toBe(2);
	});

	it("stores the ROUNDED coordinates, so the location index agrees with the key", async () => {
		// Killed by rounding only inside the key string and leaving `key.lat`
		// raw: the row would then be unreachable through the `location` index
		// that `getEntriesForLocation` reads, and two windows sharing a cacheKey
		// would disagree about where they were.
		const cache = new WeatherCache();
		await cache.getWeatherData(metadataAtLatLon(47.123456, 8.654321), api);

		expect(await cache.getEntriesForLocation(47.123456, 8.654321)).toHaveLength(
			0,
		);
		const rounded = await cache.getEntriesForLocation(47.123, 8.654);
		expect(rounded).toHaveLength(1);
		expect(rounded[0].key.lat).toBe(47.123);
		expect(rounded[0].key.lon).toBe(8.654);
	});

	it("pins the key format, including a zero-padded hour", async () => {
		// Killed by changing the separator, the field order, or the padding.
		// The hour is padded here and was NOT padded in the cache's own key
		// before this builder existed, while autoRho's copy padded it — the two
		// call sites silently disagreed on format for hours below 10.
		const key = buildWeatherQueryKey({
			...metadataAt(47.123456),
			avgLon: 8.654321,
			middleDate: new Date("2026-08-04T09:07:00.000Z"),
		});

		expect(key).toBe("47.123_8.654_2026-08-04_09:00");
	});

	it("does not leak full precision into the key", async () => {
		// Non-vacuity guard: asserts the rounding actually happened rather than
		// trusting the constant. Killed by any decimal count above 3.
		const key = buildWeatherQueryKey(metadataAtLatLon(47.123456, 8.654321));

		expect(WEATHER_KEY_DECIMALS).toBe(3);
		expect(key).not.toContain("47.123456");
		expect(key).not.toContain("8.654321");
		expect(key.startsWith("47.123_8.654_")).toBe(true);
	});
});
