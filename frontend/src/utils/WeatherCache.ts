/**
 * IndexedDB cache for weather data.
 *
 * Entries do not EXPIRE -- an entry is the weather at a fixed instant at a
 * fixed place, so an identical query returns the cached result however old it
 * is. They are still evicted: the store is capped at
 * `WEATHER_CACHE_MAX_ENTRIES` rows and the oldest-inserted go first, because
 * nothing about the key stops a session from minting rows without limit.
 */

import { TrimRegionMetadata, roundToNearest15Min } from "./GeoCalculations";
import { WeatherAPI, WeatherResponse, WeatherAPIError } from "./WeatherAPI";
import { log } from "./log";

export interface WeatherCacheKey {
	lat: number; // Rounded to WEATHER_KEY_DECIMALS
	lon: number; // Rounded to WEATHER_KEY_DECIMALS
	date: string; // YYYY-MM-DD
	slotHour: number; // 0-23 (UTC), hour of nearest 15-min slot
	slotMinute: number; // 0, 15, 30, or 45 (nearest 15-min slot)
}

export interface WeatherCacheEntry {
	key: WeatherCacheKey;
	data: WeatherResponse;
	cachedAt: number; // Timestamp when stored; also the eviction order
	source: "api" | "cache";
}

interface WeatherCacheStats {
	count: number;
	oldestEntry: Date | null;
	newestEntry: Date | null;
	totalSizeEstimate: number; // Rough estimate in bytes
}

/**
 * Largest number of rows the cache keeps. An entry is six numbers plus its key,
 * so ~300 bytes of JSON — 5000 rows is roughly 1.5 MB, and far more distinct
 * trim windows than a session produces.
 *
 * The cap was load-bearing while the key was 6 decimals wide (~0.1 m) against
 * kilometre-scale data, because every trim-slider move minted another row. The
 * key is now coarsened (see `WEATHER_KEY_DECIMALS`) and rows accumulate far more
 * slowly, so the cap is a backstop rather than the only thing holding the store
 * down. It stays: nothing about the key BOUNDS the row count, it only slows it.
 */
export const WEATHER_CACHE_MAX_ENTRIES = 5000;

/**
 * How many decimals of latitude/longitude the cache key keeps — ~111 m, and at
 * worst ~78 m from the true centroid.
 *
 * The key was 6 decimals (0.11 m). Measured across the local rides, a ONE-POINT
 * trim-slider nudge moves the centroid 0.1–2.5 m and a 1% trim moves it 4–212 m,
 * so essentially every slider move missed the cache and re-queried Open-Meteo.
 *
 * 3 decimals is not a trade of accuracy for hit rate. Open-Meteo snaps a query
 * to its own model grid — 1–11 km on the forecast endpoints, 0.25° ≈ 28 km on
 * ERA5 — and returns byte-identical data for points 500 m apart, so this rounds
 * away precision the API had already discarded. The API query itself is
 * deliberately NOT rounded: it would change nothing observable, and leaving it
 * alone keeps the request identical to what a cache-less path would send.
 */
export const WEATHER_KEY_DECIMALS = 3;

/**
 * The single source of the key string. Both the IndexedDB primary key and
 * `autoRho`'s in-session `lastWeatherQueryKey` guard come from here.
 *
 * They used to be two inline format literals that were NOT equivalent: the
 * cache emitted an unpadded hour (`9:15`) and autoRho a padded one (`09:15`),
 * so the two silently disagreed for any ride before 10:00 UTC. Neither needed
 * the other's format, which is exactly why the divergence went unnoticed —
 * and why one builder is worth more than the duplication it removes.
 */
export function buildWeatherQueryKey(metadata: TrimRegionMetadata): string {
	return weatherCacheKeyString(weatherCacheKeyOf(metadata));
}

/** The structured key: coordinates snapped, timestamp on its 15-minute slot. */
function weatherCacheKeyOf(metadata: TrimRegionMetadata): WeatherCacheKey {
	const slot = roundToNearest15Min(metadata.middleDate);

	return {
		lat: Number(metadata.avgLat.toFixed(WEATHER_KEY_DECIMALS)),
		lon: Number(metadata.avgLon.toFixed(WEATHER_KEY_DECIMALS)),
		date: slot.date,
		slotHour: slot.slotHour,
		slotMinute: slot.slotMinute,
	};
}

/**
 * Format a structured key for IndexedDB. Reads the key's own already-snapped
 * coordinates rather than re-rounding, so the string and the `location` index
 * cannot drift apart.
 */
function weatherCacheKeyString(key: WeatherCacheKey): string {
	const hh = String(key.slotHour).padStart(2, "0");
	const mm = String(key.slotMinute).padStart(2, "0");
	return `${key.lat.toFixed(WEATHER_KEY_DECIMALS)}_${key.lon.toFixed(WEATHER_KEY_DECIMALS)}_${key.date}_${hh}:${mm}`;
}

/**
 * THE ONE CACHE THE APP USES, and the reason it is a module-level singleton
 * rather than a `new` at each call site.
 *
 * Every instance opens its own IndexedDB connection on first use. `autoRho`
 * built a cache INSIDE its query path, which runs once per distinct trim
 * window, so a long session accumulated connections at exactly the rate
 * `WEATHER_CACHE_MAX_ENTRIES` bounds rows. The other stores in this directory
 * are built once and held for the session (`ResultsStorage`,
 * `ParameterStorage`); this brings the weather cache into line with them.
 *
 * Note that those stores do NOT close their long-lived connections either —
 * they hold one for the session by design, and so does this. The defect was the
 * per-query CONSTRUCTION, not the holding.
 */
let sharedInstance: WeatherCache | null = null;

/** The shared cache. Prefer this to `new WeatherCache()` at every call site. */
export function weatherCacheInstance(): WeatherCache {
	if (!sharedInstance) {
		sharedInstance = new WeatherCache();
	}
	return sharedInstance;
}

/**
 * Close the shared cache and drop it, so the next `weatherCacheInstance()`
 * builds a fresh one. The unload handler calls this; tests call it to isolate.
 */
export function resetWeatherCacheInstance(): void {
	sharedInstance?.close();
	sharedInstance = null;
}

export class WeatherCache {
	private readonly dbName = "ve-weather-cache";
	private readonly dbVersion = 1;
	private readonly storeName = "weather-data";
	private readonly maxEntries: number;
	private db: IDBDatabase | null = null;
	private initPromise: Promise<void> | null = null;

	constructor(maxEntries: number = WEATHER_CACHE_MAX_ENTRIES) {
		this.maxEntries = maxEntries;
	}

	/**
	 * Release the IndexedDB connection this instance holds.
	 *
	 * WHY THIS EXISTS AT ALL. `initialize()` assigned `this.db` and nothing ever
	 * released it, while `autoRho` built a NEW cache inside its query path — so
	 * a long session accumulated one open connection per distinct trim window,
	 * which is the same per-window churn `WEATHER_CACHE_MAX_ENTRIES` is sized
	 * for. The construction site is now a single shared instance
	 * (`weatherCacheInstance()`), which is the half that stops the accumulation;
	 * this method is what lets the one remaining connection be given up
	 * deliberately rather than only at unload.
	 *
	 * `initPromise` is cleared along with `db`, and that pairing is the whole
	 * correctness of it: `initialize()` returns the memoized promise when one is
	 * set, so a close that left it behind would resolve instantly against a
	 * connection that is gone and every later read would throw.
	 *
	 * Safe to call on an instance that was never opened, and safe to call twice
	 * — an unload handler and an explicit teardown can both reach it.
	 */
	close(): void {
		this.db?.close();
		this.db = null;
		this.initPromise = null;
	}

	/**
	 * Initialize IndexedDB
	 * Creates database and object store if they don't exist
	 */
	async initialize(): Promise<void> {
		// Return existing promise if initialization is in progress
		if (this.initPromise) {
			return this.initPromise;
		}

		// Return immediately if already initialized
		if (this.db) {
			return Promise.resolve();
		}

		this.initPromise = new Promise((resolve, reject) => {
			const request = indexedDB.open(this.dbName, this.dbVersion);

			request.onerror = () => {
				log.error("Failed to open IndexedDB:", request.error);
				reject(new Error(`IndexedDB error: ${request.error?.message}`));
			};

			request.onsuccess = () => {
				this.db = request.result;
				log.debug("✅ Weather cache IndexedDB initialized");
				resolve();
			};

			request.onupgradeneeded = (event) => {
				const db = (event.target as IDBOpenDBRequest).result;

				// Create object store if it doesn't exist
				if (!db.objectStoreNames.contains(this.storeName)) {
					const store = db.createObjectStore(this.storeName, {
						keyPath: "cacheKey",
					});

					// Create indexes for efficient querying
					store.createIndex("location", ["key.lat", "key.lon"], {
						unique: false,
					});
					store.createIndex("date", "key.date", { unique: false });
					store.createIndex("cachedAt", "cachedAt", { unique: false });

					log.debug("📦 Created weather cache object store with indexes");
				}
			};
		});

		return this.initPromise;
	}

	/**
	 * Get weather data from cache or fetch from API
	 * This is the main public method for retrieving weather data
	 *
	 * @param metadata - Trim region metadata
	 * @param api - Weather API instance
	 * @returns Weather cache entry (from cache or API)
	 */
	async getWeatherData(
		metadata: TrimRegionMetadata,
		api: WeatherAPI,
	): Promise<WeatherCacheEntry> {
		await this.initialize();

		const key = this.buildCacheKey(metadata);
		const cacheKey = this.generateCacheKeyString(key);

		// Try cache first
		const cached = await this.getCached(cacheKey);
		if (cached) {
			log.debug("💾 Weather data found in cache:", {
				location: `${key.lat}, ${key.lon}`,
				date: key.date,
				time: `${String(key.slotHour).padStart(2, "0")}:${String(key.slotMinute).padStart(2, "0")}`,
				cachedSince: new Date(cached.cachedAt).toISOString(),
			});
			return cached;
		}

		// Not in cache - fetch from API
		log.debug("⬇️ Fetching weather data from API (not in cache)...");

		try {
			const apiData = await api.fetchWeatherData(metadata);

			// Store, evicting the oldest rows if this takes the store over its cap
			const entry: WeatherCacheEntry = {
				key,
				data: apiData,
				cachedAt: Date.now(),
				source: "api",
			};

			await this.store(cacheKey, entry);
			log.debug("💾 Weather data cached:", {
				location: `${key.lat}, ${key.lon}`,
				date: key.date,
				time: `${String(key.slotHour).padStart(2, "0")}:${String(key.slotMinute).padStart(2, "0")}`,
			});

			return entry;
		} catch (error) {
			// Re-throw API errors (don't cache errors)
			if (error instanceof WeatherAPIError) {
				throw error;
			}
			const message = error instanceof Error ? error.message : String(error);
			throw new Error(`Failed to fetch weather data: ${message}`);
		}
	}

	/**
	 * Build cache key from metadata
	 */
	private buildCacheKey(metadata: TrimRegionMetadata): WeatherCacheKey {
		return weatherCacheKeyOf(metadata);
	}

	/**
	 * Generate unique string key for IndexedDB storage
	 */
	private generateCacheKeyString(key: WeatherCacheKey): string {
		return weatherCacheKeyString(key);
	}

	/**
	 * Get cached weather data
	 */
	private async getCached(cacheKey: string): Promise<WeatherCacheEntry | null> {
		if (!this.db) {
			await this.initialize();
		}

		return new Promise((resolve, reject) => {
			const transaction = this.db!.transaction([this.storeName], "readonly");
			const store = transaction.objectStore(this.storeName);
			const request = store.get(cacheKey);

			request.onsuccess = () => {
				const entry = request.result as
					(WeatherCacheEntry & { cacheKey: string }) | undefined;

				if (entry) {
					// Mark as from cache
					entry.source = "cache";
					resolve(entry);
				} else {
					resolve(null);
				}
			};

			request.onerror = () => {
				log.error("Failed to retrieve from cache:", request.error);
				reject(new Error(`Cache retrieval error: ${request.error?.message}`));
			};
		});
	}

	/**
	 * Store weather data, then drop the oldest rows if that put took the store
	 * over its cap. Entries do not expire — see `evictOverflow` for why the
	 * removal is a cap rather than a TTL.
	 */
	private async store(
		cacheKey: string,
		entry: WeatherCacheEntry,
	): Promise<void> {
		if (!this.db) {
			await this.initialize();
		}

		return new Promise((resolve, reject) => {
			const transaction = this.db!.transaction([this.storeName], "readwrite");
			const store = transaction.objectStore(this.storeName);

			// Store entry with cacheKey as primary key
			const request = store.put({ ...entry, cacheKey });

			request.onsuccess = () => {
				// Counted AFTER the put lands, and on the store rather than on a
				// running total, so overwriting an existing key -- which leaves
				// the row count where it was -- evicts nothing.
				this.evictOverflow(store);
			};

			request.onerror = () => {
				log.error("Failed to store in cache:", request.error);
				reject(new Error(`Cache storage error: ${request.error?.message}`));
			};

			// Resolved on the transaction rather than on the put, so the entry
			// and the evictions it triggered commit together.
			transaction.oncomplete = () => {
				resolve();
			};

			transaction.onabort = () => {
				log.error("Weather cache write aborted:", transaction.error);
				reject(new Error(`Cache storage error: ${transaction.error?.message}`));
			};
		});
	}

	/**
	 * Delete oldest-first until the store is back at the cap.
	 *
	 * FIFO by insertion, not LRU: `cachedAt` is written once and never touched
	 * on a read, so this is oldest-INSERTED. True LRU would need a write on
	 * every cache hit, turning each read into a readwrite transaction, and it
	 * would buy nothing here -- re-reading a ride hits the same key, and a
	 * moved trim window is a new key either way.
	 *
	 * There is no TTL, deliberately. An entry is the weather at a fixed instant
	 * at a fixed place: rides past `forecastMaxDays` come from the archive,
	 * which does not change, so an expiry would re-fetch immutable data forever
	 * to serve only the recent-ride case. `autoRho` already re-fetches the one
	 * case that matters -- a cached row that came back without wind data.
	 *
	 * Runs inside the caller's transaction. Failures here are logged and
	 * swallowed: `preventDefault()` stops a failed delete from aborting the
	 * transaction, because a ride's analysis must not fail over a row the cache
	 * could not tidy up.
	 */
	private evictOverflow(store: IDBObjectStore): void {
		const countRequest = store.count();

		countRequest.onerror = (event) => {
			event.preventDefault();
			log.warn(
				"Weather cache eviction skipped, count failed:",
				countRequest.error,
			);
		};

		countRequest.onsuccess = () => {
			let remaining = countRequest.result - this.maxEntries;
			if (remaining <= 0) {
				return;
			}

			log.debug(
				`🧹 Weather cache over cap, evicting ${remaining} oldest ${remaining === 1 ? "entry" : "entries"}`,
			);

			// Ascending over `cachedAt`, so the cursor reaches the oldest row
			// first. The index is declared in `onupgradeneeded` already, so no
			// schema change and no `dbVersion` bump is owed for this.
			const cursorRequest = store.index("cachedAt").openCursor();

			cursorRequest.onerror = (event) => {
				event.preventDefault();
				log.warn(
					"Weather cache eviction stopped, cursor failed:",
					cursorRequest.error,
				);
			};

			cursorRequest.onsuccess = () => {
				const cursor = cursorRequest.result;
				if (!cursor || remaining <= 0) {
					return;
				}

				const deleteRequest = cursor.delete();
				deleteRequest.onerror = (event) => {
					event.preventDefault();
					log.warn(
						"Weather cache eviction skipped a row:",
						deleteRequest.error,
					);
				};

				remaining -= 1;
				cursor.continue();
			};
		};
	}

	/**
	 * Update an existing cache entry with fresh data
	 * Used when cached data is incomplete (e.g., missing wind data)
	 */
	async updateCachedEntry(
		metadata: TrimRegionMetadata,
		data: WeatherResponse,
	): Promise<void> {
		const key = this.buildCacheKey(metadata);
		const cacheKey = this.generateCacheKeyString(key);

		const entry: WeatherCacheEntry = {
			key,
			data,
			cachedAt: Date.now(),
			source: "api",
		};

		await this.store(cacheKey, entry);
		log.debug("🔄 Updated cache entry with complete data:", {
			location: `${key.lat}, ${key.lon}`,
			date: key.date,
			time: `${String(key.slotHour).padStart(2, "0")}:${String(key.slotMinute).padStart(2, "0")}`,
		});
	}

	/**
	 * Get cache statistics (for UI display and debugging)
	 */
	async getCacheStats(): Promise<WeatherCacheStats> {
		if (!this.db) {
			await this.initialize();
		}

		return new Promise((resolve, reject) => {
			const transaction = this.db!.transaction([this.storeName], "readonly");
			const store = transaction.objectStore(this.storeName);

			// Get total count
			const countRequest = store.count();

			countRequest.onsuccess = () => {
				const count = countRequest.result;

				if (count === 0) {
					resolve({
						count: 0,
						oldestEntry: null,
						newestEntry: null,
						totalSizeEstimate: 0,
					});
					return;
				}

				// Get all entries to calculate statistics
				const getAllRequest = store.getAll();

				getAllRequest.onsuccess = () => {
					const entries = getAllRequest.result as Array<
						WeatherCacheEntry & { cacheKey: string }
					>;

					let oldestTimestamp = Infinity;
					let newestTimestamp = 0;
					let totalSize = 0;

					for (const entry of entries) {
						if (entry.cachedAt < oldestTimestamp) {
							oldestTimestamp = entry.cachedAt;
						}
						if (entry.cachedAt > newestTimestamp) {
							newestTimestamp = entry.cachedAt;
						}

						// Rough size estimate (serialized JSON)
						totalSize += JSON.stringify(entry).length;
					}

					resolve({
						count,
						oldestEntry:
							oldestTimestamp < Infinity ? new Date(oldestTimestamp) : null,
						newestEntry: newestTimestamp > 0 ? new Date(newestTimestamp) : null,
						totalSizeEstimate: totalSize,
					});
				};

				getAllRequest.onerror = () => {
					reject(
						new Error(
							`Failed to get cache stats: ${getAllRequest.error?.message}`,
						),
					);
				};
			};

			countRequest.onerror = () => {
				reject(
					new Error(
						`Failed to count cache entries: ${countRequest.error?.message}`,
					),
				);
			};
		});
	}

	/**
	 * Clear all cached weather data
	 * Should only be called when user explicitly requests it
	 */
	async clearCache(): Promise<void> {
		if (!this.db) {
			await this.initialize();
		}

		return new Promise((resolve, reject) => {
			const transaction = this.db!.transaction([this.storeName], "readwrite");
			const store = transaction.objectStore(this.storeName);
			const request = store.clear();

			request.onsuccess = () => {
				log.debug("🗑️ Weather cache cleared");
				resolve();
			};

			request.onerror = () => {
				log.error("Failed to clear cache:", request.error);
				reject(new Error(`Cache clear error: ${request.error?.message}`));
			};
		});
	}

	/**
	 * Get entries for a specific location (for debugging/display)
	 */
	async getEntriesForLocation(
		lat: number,
		lon: number,
	): Promise<WeatherCacheEntry[]> {
		if (!this.db) {
			await this.initialize();
		}

		return new Promise((resolve, reject) => {
			const transaction = this.db!.transaction([this.storeName], "readonly");
			const store = transaction.objectStore(this.storeName);
			const index = store.index("location");

			// Query by location coordinates
			const request = index.getAll([lat, lon]);

			request.onsuccess = () => {
				const entries = request.result as Array<
					WeatherCacheEntry & { cacheKey: string }
				>;
				resolve(entries);
			};

			request.onerror = () => {
				reject(
					new Error(`Failed to query by location: ${request.error?.message}`),
				);
			};
		});
	}

	/**
	 * Check if cache is available (IndexedDB support)
	 */
	static isAvailable(): boolean {
		return typeof indexedDB !== "undefined";
	}
}
