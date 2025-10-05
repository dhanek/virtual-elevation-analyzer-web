import { DEMProcessor } from '../../pkg/virtual_elevation_analyzer';

/**
 * Manages DEM (Digital Elevation Model) files for elevation correction
 * Uses streaming approach - DEM files are processed on-the-fly and not stored in IndexedDB
 */
export class DEMManager {
    private demProcessor: DEMProcessor | null = null;
    private demFile: File | null = null;
    private demFileLoaded: boolean = false;

    /**
     * Load a DEM file into memory for processing
     * @param file The DEM file (GeoTIFF, TIF, etc.)
     */
    async loadDEMFile(file: File): Promise<void> {
        if (!this.isValidDEMFile(file)) {
            throw new Error('Invalid DEM file format. Supported formats: .tif, .tiff, .vrt');
        }

        try {
            // Read file as ArrayBuffer
            const arrayBuffer = await file.arrayBuffer();
            const uint8Array = new Uint8Array(arrayBuffer);

            // Create DEM processor from file data (pass filename for SRTM parsing)
            this.demProcessor = new DEMProcessor(uint8Array, file.name);
            this.demFile = file;
            this.demFileLoaded = true;

            console.log('DEM file loaded successfully:', file.name);
            console.log('DEM metadata:', this.demProcessor.get_metadata());
            console.log('DEM bounds:', this.demProcessor.get_bounds());
        } catch (error) {
            this.demProcessor = null;
            this.demFile = null;
            this.demFileLoaded = false;
            throw new Error(`Failed to load DEM file: ${error}`);
        }
    }

    /**
     * Correct elevation for a set of GPS coordinates
     * @param lats Array of latitudes (WGS84)
     * @param lons Array of longitudes (WGS84)
     * @param fallbackAltitudes Original GPS altitudes to use if DEM lookup fails
     * @returns Corrected elevations and error rate
     */
    async correctElevation(
        lats: number[],
        lons: number[],
        fallbackAltitudes: number[]
    ): Promise<{ elevations: number[], errorRate: number }> {
        if (!this.demProcessor || !this.demFileLoaded) {
            throw new Error('DEM file not loaded. Please load a DEM file first.');
        }

        if (lats.length !== lons.length || lats.length !== fallbackAltitudes.length) {
            throw new Error('lats, lons, and fallbackAltitudes must have the same length');
        }

        try {
            // Perform batch lookup
            const demElevations = this.demProcessor.batch_lookup(lats, lons);

            // Merge with fallback altitudes where DEM lookup failed
            const correctedElevations: number[] = [];
            let errorCount = 0;

            for (let i = 0; i < demElevations.length; i++) {
                if (isNaN(demElevations[i]) || demElevations[i] === null) {
                    correctedElevations.push(fallbackAltitudes[i]);
                    errorCount++;
                } else {
                    correctedElevations.push(demElevations[i]);
                }
            }

            const errorRate = errorCount / demElevations.length;

            return {
                elevations: correctedElevations,
                errorRate: errorRate
            };
        } catch (error) {
            throw new Error(`Failed to correct elevation: ${error}`);
        }
    }

    /**
     * Check if a DEM file is currently loaded
     */
    isDEMLoaded(): boolean {
        return this.demFileLoaded;
    }

    /**
     * Get the currently loaded DEM file name
     */
    getDEMFileName(): string | null {
        return this.demFile ? this.demFile.name : null;
    }

    /**
     * Get DEM metadata
     */
    getDEMMetadata(): string | null {
        return this.demProcessor ? this.demProcessor.get_metadata() : null;
    }

    /**
     * Get DEM bounds [min_lon, min_lat, max_lon, max_lat]
     */
    getDEMBounds(): number[] | null {
        return this.demProcessor ? this.demProcessor.get_bounds() : null;
    }

    /**
     * Clear the loaded DEM file from memory
     */
    clearDEM(): void {
        if (this.demProcessor) {
            this.demProcessor.free();
            this.demProcessor = null;
        }
        this.demFile = null;
        this.demFileLoaded = false;
    }

    /**
     * Validate DEM file format
     */
    private isValidDEMFile(file: File): boolean {
        const validExtensions = ['.tif', '.tiff', '.vrt'];
        const fileName = file.name.toLowerCase();
        return validExtensions.some(ext => fileName.endsWith(ext));
    }
}

/**
 * Elevation profile cache for storing corrected elevations per FIT file
 */
export class ElevationProfileCache {
    private dbName = 've-elevation-profiles';
    private storeName = 'profiles';
    private db: IDBDatabase | null = null;

    async initialize(): Promise<void> {
        return new Promise((resolve, reject) => {
            const request = indexedDB.open(this.dbName, 1);

            request.onerror = () => reject(request.error);
            request.onsuccess = () => {
                this.db = request.result;
                resolve();
            };

            request.onupgradeneeded = (event) => {
                const db = (event.target as IDBOpenDBRequest).result;
                if (!db.objectStoreNames.contains(this.storeName)) {
                    db.createObjectStore(this.storeName, { keyPath: 'fileHash' });
                }
            };
        });
    }

    /**
     * Cache elevation profile for a FIT file
     */
    async cacheProfile(
        fileHash: string,
        fileName: string,
        elevations: number[],
        bounds: { minLat: number, maxLat: number, minLon: number, maxLon: number }
    ): Promise<void> {
        if (!this.db) await this.initialize();

        return new Promise((resolve, reject) => {
            const transaction = this.db!.transaction([this.storeName], 'readwrite');
            const store = transaction.objectStore(this.storeName);

            const profile = {
                fileHash,
                fileName,
                elevations,
                bounds,
                timestamp: Date.now(),
                size: elevations.length * 8 // Approximate size in bytes
            };

            const request = store.put(profile);
            request.onsuccess = () => resolve();
            request.onerror = () => reject(request.error);
        });
    }

    /**
     * Get cached elevation profile for a FIT file
     */
    async getProfile(fileHash: string): Promise<number[] | null> {
        if (!this.db) await this.initialize();

        return new Promise((resolve, reject) => {
            const transaction = this.db!.transaction([this.storeName], 'readonly');
            const store = transaction.objectStore(this.storeName);
            const request = store.get(fileHash);

            request.onsuccess = () => {
                const result = request.result;
                resolve(result ? result.elevations : null);
            };
            request.onerror = () => reject(request.error);
        });
    }

    /**
     * Clear all cached elevation profiles
     */
    async clearAll(): Promise<void> {
        if (!this.db) await this.initialize();

        return new Promise((resolve, reject) => {
            const transaction = this.db!.transaction([this.storeName], 'readwrite');
            const store = transaction.objectStore(this.storeName);
            const request = store.clear();

            request.onsuccess = () => resolve();
            request.onerror = () => reject(request.error);
        });
    }

    /**
     * Get total storage size of cached profiles
     */
    async getStorageSize(): Promise<number> {
        if (!this.db) await this.initialize();

        return new Promise((resolve, reject) => {
            const transaction = this.db!.transaction([this.storeName], 'readonly');
            const store = transaction.objectStore(this.storeName);
            const request = store.getAll();

            request.onsuccess = () => {
                const profiles = request.result;
                const totalSize = profiles.reduce((sum, profile) => sum + (profile.size || 0), 0);
                resolve(totalSize);
            };
            request.onerror = () => reject(request.error);
        });
    }
}
