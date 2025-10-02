import { AnalysisParameters } from '../components/AnalysisParameters';

interface LapSettings {
    trimStart: number;
    trimEnd: number;
    cda: number | null;
    crr: number | null;
}

interface StoredParameters {
    fileHash: string;
    parameters: AnalysisParameters;
    lapSettings: { [lapKey: string]: LapSettings }; // Key is lap indices joined by '-' (e.g., "0", "1-2-3")
    lastUsed: number; // timestamp
    fileName?: string; // optional, for debugging
}

export class ParameterStorage {
    private dbName = 'VirtualElevationAnalyzer';
    private storeName = 'fileParameters';
    private db: IDBDatabase | null = null;

    async initialize(): Promise<void> {
        return new Promise((resolve, reject) => {
            const request = indexedDB.open(this.dbName, 2);

            request.onerror = () => {
                console.error('❌ IndexedDB failed to open:', request.error);
                reject(request.error);
            };

            request.onsuccess = () => {
                this.db = request.result;
                resolve();
            };

            request.onupgradeneeded = (event) => {
                const oldVersion = (event as IDBVersionChangeEvent).oldVersion;
                const newVersion = (event as IDBVersionChangeEvent).newVersion;

                const db = (event.target as IDBOpenDBRequest).result;
                const transaction = (event.target as IDBOpenDBRequest).transaction!;

                // Create object store if it doesn't exist (version 1)
                if (!db.objectStoreNames.contains(this.storeName)) {
                    const objectStore = db.createObjectStore(this.storeName, { keyPath: 'fileHash' });
                    objectStore.createIndex('lastUsed', 'lastUsed', { unique: false });
                } else {
                }

                // Migrate from version 1 to 2: add lapSettings field to existing entries
                if (oldVersion < 2) {
                    const objectStore = transaction.objectStore(this.storeName);
                    const getAllRequest = objectStore.getAll();

                    getAllRequest.onsuccess = () => {
                        const allRecords = getAllRequest.result as StoredParameters[];

                        allRecords.forEach(record => {
                            if (!record.lapSettings) {
                                record.lapSettings = {};
                                objectStore.put(record);
                            }
                        });
                    };
                }
            };
        });
    }

    /**
     * Calculate a hash from file data for identification
     * Uses first 8KB + file size for speed (not cryptographic hash)
     */
    async calculateFileHash(file: File): Promise<string> {
        const chunkSize = 8192; // 8KB
        const buffer = await file.slice(0, Math.min(chunkSize, file.size)).arrayBuffer();
        const bytes = new Uint8Array(buffer);

        // Simple hash: combine first bytes with file size and name
        let hash = file.size.toString(36);

        // Add sample bytes from start
        for (let i = 0; i < Math.min(64, bytes.length); i += 4) {
            hash += bytes[i].toString(36);
        }

        // Add filename (sanitized)
        hash += '_' + file.name.replace(/[^a-zA-Z0-9]/g, '').substring(0, 20);

        return hash;
    }

    /**
     * Save parameters for a file
     */
    async saveParameters(fileHash: string, parameters: AnalysisParameters, fileName?: string): Promise<void> {
        if (!this.db) {
            console.warn('IndexedDB not initialized, cannot save parameters');
            return;
        }


        return new Promise((resolve, reject) => {
            const transaction = this.db!.transaction([this.storeName], 'readwrite');
            const objectStore = transaction.objectStore(this.storeName);

            // Get existing data to preserve lapSettings
            const getRequest = objectStore.get(fileHash);

            getRequest.onsuccess = () => {
                const existingData = getRequest.result as StoredParameters | undefined;

                const data: StoredParameters = {
                    fileHash,
                    parameters,
                    lapSettings: existingData?.lapSettings || {}, // Preserve existing lap settings
                    lastUsed: Date.now(),
                    fileName
                };

                const request = objectStore.put(data);

            request.onsuccess = () => {
                // Verify the save
                const verifyRequest = objectStore.get(fileHash);
                verifyRequest.onsuccess = () => {
                };
                resolve();
            };

                request.onerror = () => {
                    console.error('❌ Failed to save parameters:', request.error);
                    reject(request.error);
                };
            };

            getRequest.onerror = () => {
                console.error('❌ Failed to get existing data:', getRequest.error);
                reject(getRequest.error);
            };
        });
    }

    /**
     * Load parameters for a file
     */
    async loadParameters(fileHash: string): Promise<AnalysisParameters | null> {
        if (!this.db) {
            console.warn('IndexedDB not initialized, cannot load parameters');
            return null;
        }


        return new Promise((resolve, reject) => {
            const transaction = this.db!.transaction([this.storeName], 'readonly');
            const objectStore = transaction.objectStore(this.storeName);
            const request = objectStore.get(fileHash);

            request.onsuccess = () => {
                const result = request.result as StoredParameters | undefined;
                if (result) {
                    resolve(result.parameters);
                } else {
                    // Debug: show what hashes we DO have
                    objectStore.getAllKeys().onsuccess = (e: any) => {
                    };
                    resolve(null);
                }
            };

            request.onerror = () => {
                console.error('❌ Failed to load parameters:', request.error);
                reject(request.error);
            };
        });
    }

    /**
     * Get all stored file hashes (for debugging)
     */
    async getAllStoredFiles(): Promise<StoredParameters[]> {
        if (!this.db) return [];

        return new Promise((resolve, reject) => {
            const transaction = this.db!.transaction([this.storeName], 'readonly');
            const objectStore = transaction.objectStore(this.storeName);
            const request = objectStore.getAll();

            request.onsuccess = () => {
                resolve(request.result);
            };

            request.onerror = () => {
                console.error('Failed to get all files:', request.error);
                reject(request.error);
            };
        });
    }

    /**
     * Clean up old entries (keep only last N files or last X days)
     */
    async cleanup(maxFiles: number = 50, maxAgeDays: number = 30): Promise<void> {
        if (!this.db) return;

        try {
            const allFiles = await this.getAllStoredFiles();

            // Sort by lastUsed descending
            allFiles.sort((a, b) => b.lastUsed - a.lastUsed);

            const maxAgeMs = maxAgeDays * 24 * 60 * 60 * 1000;
            const cutoffTime = Date.now() - maxAgeMs;

            const transaction = this.db.transaction([this.storeName], 'readwrite');
            const objectStore = transaction.objectStore(this.storeName);

            let deleteCount = 0;

            // Delete files beyond maxFiles or older than maxAgeDays
            for (let i = 0; i < allFiles.length; i++) {
                const file = allFiles[i];
                if (i >= maxFiles || file.lastUsed < cutoffTime) {
                    objectStore.delete(file.fileHash);
                    deleteCount++;
                }
            }

            if (deleteCount > 0) {
            }
        } catch (error) {
            console.error('Cleanup failed:', error);
        }
    }

    /**
     * Clear all stored parameters (for debugging or user request)
     */
    async clearAll(): Promise<void> {
        if (!this.db) return;

        return new Promise((resolve, reject) => {
            const transaction = this.db!.transaction([this.storeName], 'readwrite');
            const objectStore = transaction.objectStore(this.storeName);
            const request = objectStore.clear();

            request.onsuccess = () => {
                resolve();
            };

            request.onerror = () => {
                console.error('Failed to clear parameters:', request.error);
                reject(request.error);
            };
        });
    }

    /**
     * Generate lap key from selected lap indices
     */
    private getLapKey(selectedLaps: number[]): string {
        if (selectedLaps.length === 0) {
            return 'all'; // Full route
        }
        return selectedLaps.sort((a, b) => a - b).join('-');
    }

    /**
     * Save lap-specific settings (trim indices and CdA/Crr values)
     */
    async saveLapSettings(
        fileHash: string,
        selectedLaps: number[],
        settings: LapSettings
    ): Promise<void> {
        if (!this.db) {
            console.warn('IndexedDB not initialized, cannot save lap settings');
            return;
        }

        const lapKey = this.getLapKey(selectedLaps);

        return new Promise((resolve, reject) => {
            const transaction = this.db!.transaction([this.storeName], 'readwrite');
            const objectStore = transaction.objectStore(this.storeName);

            const getRequest = objectStore.get(fileHash);

            getRequest.onsuccess = () => {
                let existingData = getRequest.result as StoredParameters | undefined;

                if (!existingData) {
                    console.warn('⚠️ No existing data found for file, creating default entry for lap settings');
                    // Create a minimal entry with default parameters
                    existingData = {
                        fileHash,
                        parameters: {
                            system_mass: 75,
                            rho: 1.225,
                            eta: 0.97,
                            cda: null,
                            crr: null,
                            cda_min: 0.15,
                            cda_max: 0.5,
                            crr_min: 0.002,
                            crr_max: 0.015,
                            wind_speed: null,
                            wind_direction: null,
                            wind_speed_unit: 'm/s',
                            velodrome: false,
                            auto_lap_detection: 'None'
                        },
                        lapSettings: {},
                        lastUsed: Date.now()
                    };
                }

                // Ensure lapSettings exists (for backwards compatibility with old data)
                if (!existingData.lapSettings) {
                    existingData.lapSettings = {};
                }

                // Update lap settings
                existingData.lapSettings[lapKey] = settings;
                existingData.lastUsed = Date.now();

                const putRequest = objectStore.put(existingData);

                putRequest.onsuccess = () => {
                    resolve();
                };

                putRequest.onerror = () => {
                    console.error('❌ Failed to save lap settings:', putRequest.error);
                    reject(putRequest.error);
                };
            };

            getRequest.onerror = () => {
                console.error('❌ Failed to get existing data:', getRequest.error);
                reject(getRequest.error);
            };
        });
    }

    /**
     * Load lap-specific settings
     */
    async loadLapSettings(fileHash: string, selectedLaps: number[]): Promise<LapSettings | null> {
        if (!this.db) {
            console.warn('IndexedDB not initialized, cannot load lap settings');
            return null;
        }

        const lapKey = this.getLapKey(selectedLaps);

        return new Promise((resolve, reject) => {
            const transaction = this.db!.transaction([this.storeName], 'readonly');
            const objectStore = transaction.objectStore(this.storeName);
            const request = objectStore.get(fileHash);

            request.onsuccess = () => {
                const result = request.result as StoredParameters | undefined;
                if (result && result.lapSettings && result.lapSettings[lapKey]) {
                    resolve(result.lapSettings[lapKey]);
                } else {
                    resolve(null);
                }
            };

            request.onerror = () => {
                console.error('❌ Failed to load lap settings:', request.error);
                reject(request.error);
            };
        });
    }
}

export type { LapSettings };
