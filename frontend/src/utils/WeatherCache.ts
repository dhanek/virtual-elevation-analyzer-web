/**
 * Permanent IndexedDB cache for weather data
 * Weather data never expires - identical queries return cached results indefinitely
 */

import { TrimRegionMetadata, roundToNearest15Min } from './GeoCalculations';
import { WeatherAPI, WeatherResponse, WeatherAPIError } from './WeatherAPI';
import { log } from './log';

export interface WeatherCacheKey {
    lat: number;        // Rounded to 6 decimals
    lon: number;        // Rounded to 6 decimals
    date: string;       // YYYY-MM-DD
    slotHour: number;   // 0-23 (UTC), hour of nearest 15-min slot
    slotMinute: number; // 0, 15, 30, or 45 (nearest 15-min slot)
}

export interface WeatherCacheEntry {
    key: WeatherCacheKey;
    data: WeatherResponse;
    cachedAt: number;     // Timestamp when stored (for statistics only)
    source: 'api' | 'cache';
}

interface WeatherCacheStats {
    count: number;
    oldestEntry: Date | null;
    newestEntry: Date | null;
    totalSizeEstimate: number; // Rough estimate in bytes
}

export class WeatherCache {
    private readonly dbName = 've-weather-cache';
    private readonly dbVersion = 1;
    private readonly storeName = 'weather-data';
    private db: IDBDatabase | null = null;
    private initPromise: Promise<void> | null = null;

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
                log.error('Failed to open IndexedDB:', request.error);
                reject(new Error(`IndexedDB error: ${request.error?.message}`));
            };

            request.onsuccess = () => {
                this.db = request.result;
                log.debug('✅ Weather cache IndexedDB initialized');
                resolve();
            };

            request.onupgradeneeded = (event) => {
                const db = (event.target as IDBOpenDBRequest).result;

                // Create object store if it doesn't exist
                if (!db.objectStoreNames.contains(this.storeName)) {
                    const store = db.createObjectStore(this.storeName, { keyPath: 'cacheKey' });

                    // Create indexes for efficient querying
                    store.createIndex('location', ['key.lat', 'key.lon'], { unique: false });
                    store.createIndex('date', 'key.date', { unique: false });
                    store.createIndex('cachedAt', 'cachedAt', { unique: false });

                    log.debug('📦 Created weather cache object store with indexes');
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
        api: WeatherAPI
    ): Promise<WeatherCacheEntry> {
        await this.initialize();

        const key = this.buildCacheKey(metadata);
        const cacheKey = this.generateCacheKeyString(key);

        // Try cache first
        const cached = await this.getCached(cacheKey);
        if (cached) {
            log.debug('💾 Weather data found in cache (permanent):', {
                location: `${key.lat}, ${key.lon}`,
                date: key.date,
                time: `${String(key.slotHour).padStart(2, '0')}:${String(key.slotMinute).padStart(2, '0')}`,
                cachedSince: new Date(cached.cachedAt).toISOString()
            });
            return cached;
        }

        // Not in cache - fetch from API
        log.debug('⬇️ Fetching weather data from API (not in cache)...');

        try {
            const apiData = await api.fetchWeatherData(metadata);

            // Store permanently in cache
            const entry: WeatherCacheEntry = {
                key,
                data: apiData,
                cachedAt: Date.now(),
                source: 'api'
            };

            await this.store(cacheKey, entry);
            log.debug('💾 Weather data cached permanently:', {
                location: `${key.lat}, ${key.lon}`,
                date: key.date,
                time: `${String(key.slotHour).padStart(2, '0')}:${String(key.slotMinute).padStart(2, '0')}`
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
        const slot = roundToNearest15Min(metadata.middleDate);

        return {
            lat: metadata.avgLat,
            lon: metadata.avgLon,
            date: slot.date,
            slotHour: slot.slotHour,
            slotMinute: slot.slotMinute
        };
    }

    /**
     * Generate unique string key for IndexedDB storage
     */
    private generateCacheKeyString(key: WeatherCacheKey): string {
        return `${key.lat.toFixed(6)}_${key.lon.toFixed(6)}_${key.date}_${key.slotHour}:${String(key.slotMinute).padStart(2, '0')}`;
    }

    /**
     * Get cached weather data
     */
    private async getCached(cacheKey: string): Promise<WeatherCacheEntry | null> {
        if (!this.db) {
            await this.initialize();
        }

        return new Promise((resolve, reject) => {
            const transaction = this.db!.transaction([this.storeName], 'readonly');
            const store = transaction.objectStore(this.storeName);
            const request = store.get(cacheKey);

            request.onsuccess = () => {
                const entry = request.result as (WeatherCacheEntry & { cacheKey: string }) | undefined;

                if (entry) {
                    // Mark as from cache
                    entry.source = 'cache';
                    resolve(entry);
                } else {
                    resolve(null);
                }
            };

            request.onerror = () => {
                log.error('Failed to retrieve from cache:', request.error);
                reject(new Error(`Cache retrieval error: ${request.error?.message}`));
            };
        });
    }

    /**
     * Store weather data permanently (no expiration)
     */
    private async store(cacheKey: string, entry: WeatherCacheEntry): Promise<void> {
        if (!this.db) {
            await this.initialize();
        }

        return new Promise((resolve, reject) => {
            const transaction = this.db!.transaction([this.storeName], 'readwrite');
            const store = transaction.objectStore(this.storeName);

            // Store entry with cacheKey as primary key
            const request = store.put({ ...entry, cacheKey });

            request.onsuccess = () => {
                resolve();
            };

            request.onerror = () => {
                log.error('Failed to store in cache:', request.error);
                reject(new Error(`Cache storage error: ${request.error?.message}`));
            };
        });
    }

    /**
     * Update an existing cache entry with fresh data
     * Used when cached data is incomplete (e.g., missing wind data)
     */
    async updateCachedEntry(metadata: TrimRegionMetadata, data: WeatherResponse): Promise<void> {
        const key = this.buildCacheKey(metadata);
        const cacheKey = this.generateCacheKeyString(key);

        const entry: WeatherCacheEntry = {
            key,
            data,
            cachedAt: Date.now(),
            source: 'api'
        };

        await this.store(cacheKey, entry);
        log.debug('🔄 Updated cache entry with complete data:', {
            location: `${key.lat}, ${key.lon}`,
            date: key.date,
            time: `${String(key.slotHour).padStart(2, '0')}:${String(key.slotMinute).padStart(2, '0')}`
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
            const transaction = this.db!.transaction([this.storeName], 'readonly');
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
                        totalSizeEstimate: 0
                    });
                    return;
                }

                // Get all entries to calculate statistics
                const getAllRequest = store.getAll();

                getAllRequest.onsuccess = () => {
                    const entries = getAllRequest.result as Array<WeatherCacheEntry & { cacheKey: string }>;

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
                        oldestEntry: oldestTimestamp < Infinity ? new Date(oldestTimestamp) : null,
                        newestEntry: newestTimestamp > 0 ? new Date(newestTimestamp) : null,
                        totalSizeEstimate: totalSize
                    });
                };

                getAllRequest.onerror = () => {
                    reject(new Error(`Failed to get cache stats: ${getAllRequest.error?.message}`));
                };
            };

            countRequest.onerror = () => {
                reject(new Error(`Failed to count cache entries: ${countRequest.error?.message}`));
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
            const transaction = this.db!.transaction([this.storeName], 'readwrite');
            const store = transaction.objectStore(this.storeName);
            const request = store.clear();

            request.onsuccess = () => {
                log.debug('🗑️ Weather cache cleared');
                resolve();
            };

            request.onerror = () => {
                log.error('Failed to clear cache:', request.error);
                reject(new Error(`Cache clear error: ${request.error?.message}`));
            };
        });
    }

    /**
     * Get entries for a specific location (for debugging/display)
     */
    async getEntriesForLocation(lat: number, lon: number): Promise<WeatherCacheEntry[]> {
        if (!this.db) {
            await this.initialize();
        }

        return new Promise((resolve, reject) => {
            const transaction = this.db!.transaction([this.storeName], 'readonly');
            const store = transaction.objectStore(this.storeName);
            const index = store.index('location');

            // Query by location coordinates
            const request = index.getAll([lat, lon]);

            request.onsuccess = () => {
                const entries = request.result as Array<WeatherCacheEntry & { cacheKey: string }>;
                resolve(entries);
            };

            request.onerror = () => {
                reject(new Error(`Failed to query by location: ${request.error?.message}`));
            };
        });
    }

    /**
     * Check if cache is available (IndexedDB support)
     */
    static isAvailable(): boolean {
        return typeof indexedDB !== 'undefined';
    }
}
