import { fileSave } from 'browser-fs-access';
import { AnalysisParameters } from '../components/AnalysisParameters';

export interface VEAnalysisResult {
    virtual_elevation: number[];
    virtual_slope: number[];
    acceleration: number[];
    effective_wind: number[];
    apparent_velocity: number[];
    r2: number;
    rmse: number;
    ve_elevation_diff: number;
    actual_elevation_diff: number;
}

export interface SaveResultData {
    fileName: string;
    laps: number[];
    trimStart: number;
    trimEnd: number;
    cda: number;
    crr: number;
    windSource: 'constant' | 'fit' | 'compare' | 'none';
    parameters: AnalysisParameters;
    result: VEAnalysisResult;
    timestamp: Date;
    recordingDate: string; // yyyy-mm-dd format from FIT file
    avgPower: number;
    avgSpeed: number;
    avgTemperature: number;
    notes: string;
}

interface StoredVEResult {
    fileName: string;
    lapKey: string; // e.g., "1", "2", "1,2"
    trimStart: number;
    trimEnd: number;
    cda: number;
    crr: number;
    windSource: string;
    windSpeed: number | string;
    windDirection: number | string;
    systemMass: number;
    rho: number;
    eta: number;
    r2: number;
    rmse: number;
    veGain: number;
    actualGain: number;
    avgPower: number;
    avgSpeed: number;
    avgTemperature: number;
    notes: string;
    recordingDate: string; // yyyy-mm-dd
    timestamp: string; // ISO timestamp when entry was added to DB
}

export class ResultsStorage {
    private dbName = 'VirtualElevationResults'; // Separate database for results
    private storeName = 'veResults';
    private db: IDBDatabase | null = null;

    /**
     * Delete the database completely (for testing/debugging)
     */
    async deleteDatabase(): Promise<void> {
        return new Promise((resolve, reject) => {
            const request = indexedDB.deleteDatabase(this.dbName);

            request.onsuccess = () => {
                resolve();
            };

            request.onerror = () => {
                console.error('❌ Failed to delete database:', request.error);
                reject(request.error);
            };

            request.onblocked = () => {
                console.warn('⚠️ Database deletion blocked - close all tabs using this database');
            };
        });
    }

    async initialize(): Promise<void> {
        return new Promise((resolve, reject) => {
            // First check current version
            const checkRequest = indexedDB.open(this.dbName);

            checkRequest.onsuccess = async () => {
                const db = checkRequest.result;
                const currentVersion = db.version;

                // Check if the keyPath is correct
                let keyPathCorrect = false;
                let needsMigration = false;

                if (db.objectStoreNames.contains(this.storeName)) {
                    const transaction = db.transaction([this.storeName], 'readonly');
                    const objectStore = transaction.objectStore(this.storeName);
                    const keyPath = objectStore.keyPath;

                    // Check if it's the correct composite key with notes
                    keyPathCorrect = Array.isArray(keyPath) &&
                                    keyPath.length === 3 &&
                                    keyPath[0] === 'fileName' &&
                                    keyPath[1] === 'lapKey' &&
                                    keyPath[2] === 'notes';

                    needsMigration = currentVersion < 5 || !keyPathCorrect;
                }

                // If migration needed, backup existing data first
                if (needsMigration) {
                    try {
                        // Read all existing data before migration
                        const existingData = await this.readAllExistingData(db);
                        db.close();

                        // Delete old database
                        await this.deleteDatabase();

                        // Create new database
                        await this.createDatabase();

                        // Migrate old data to new schema
                        if (existingData.length > 0) {
                            await this.migrateData(existingData);
                        }

                        resolve();
                    } catch (error) {
                        console.error('❌ Migration failed:', error);
                        reject(error);
                    }
                } else {
                    db.close();
                    // Version is correct, just open it
                    this.createDatabase().then(resolve).catch(reject);
                }
            };

            checkRequest.onerror = () => {
                // Database doesn't exist yet, create it
                this.createDatabase().then(resolve).catch(reject);
            };
        });
    }

    /**
     * Read all existing data from the database before migration
     */
    private async readAllExistingData(db: IDBDatabase): Promise<any[]> {
        return new Promise((resolve, reject) => {
            if (!db.objectStoreNames.contains(this.storeName)) {
                resolve([]);
                return;
            }

            const transaction = db.transaction([this.storeName], 'readonly');
            const objectStore = transaction.objectStore(this.storeName);
            const request = objectStore.getAll();

            request.onsuccess = () => {
                const data = request.result || [];
                resolve(data);
            };

            request.onerror = () => {
                console.error('❌ Failed to read existing data:', request.error);
                reject(request.error);
            };
        });
    }

    /**
     * Migrate old data to new schema
     */
    private async migrateData(oldData: any[]): Promise<void> {
        if (!this.db) {
            throw new Error('Database not initialized');
        }

        return new Promise((resolve, reject) => {
            const transaction = this.db!.transaction([this.storeName], 'readwrite');
            const objectStore = transaction.objectStore(this.storeName);

            let migratedCount = 0;
            let errorCount = 0;

            for (const oldRecord of oldData) {
                try {
                    // Transform old record to new schema
                    const migratedRecord: StoredVEResult = {
                        fileName: oldRecord.fileName || 'unknown.fit',
                        lapKey: oldRecord.lapKey || 'all',
                        trimStart: oldRecord.trimStart ?? 0,
                        trimEnd: oldRecord.trimEnd ?? 0,
                        cda: oldRecord.cda ?? 0,
                        crr: oldRecord.crr ?? 0,
                        windSource: oldRecord.windSource || 'none',
                        windSpeed: oldRecord.windSpeed ?? '',
                        windDirection: oldRecord.windDirection ?? '',
                        systemMass: oldRecord.systemMass ?? 80,
                        rho: oldRecord.rho ?? 1.225,
                        eta: oldRecord.eta ?? 0.97,
                        r2: oldRecord.r2 ?? 0,
                        rmse: oldRecord.rmse ?? 0,
                        veGain: oldRecord.veGain ?? 0,
                        actualGain: oldRecord.actualGain ?? 0,
                        avgPower: oldRecord.avgPower ?? 0,
                        avgSpeed: oldRecord.avgSpeed ?? 0,
                        avgTemperature: oldRecord.avgTemperature ?? 0,
                        notes: oldRecord.notes || '',
                        recordingDate: oldRecord.recordingDate || '', // V5: New field
                        timestamp: oldRecord.timestamp || new Date().toISOString()
                    };

                    const request = objectStore.add(migratedRecord);

                    request.onsuccess = () => {
                        migratedCount++;
                    };

                    request.onerror = () => {
                        errorCount++;
                    };
                } catch (error) {
                    errorCount++;
                }
            }

            transaction.oncomplete = () => {
                resolve();
            };

            transaction.onerror = () => {
                console.error('❌ Migration transaction failed:', transaction.error);
                reject(transaction.error);
            };
        });
    }

    private async createDatabase(): Promise<void> {
        return new Promise((resolve, reject) => {
            const request = indexedDB.open(this.dbName, 5); // Version 5: Removed error columns, added recordingDate

            request.onerror = () => {
                console.error('❌ IndexedDB failed to open:', request.error);
                reject(request.error);
            };

            request.onsuccess = () => {
                this.db = request.result;
                resolve();
            };

            request.onupgradeneeded = (event) => {
                const db = (event.target as IDBOpenDBRequest).result;

                // Always recreate the store to ensure correct schema
                if (db.objectStoreNames.contains(this.storeName)) {
                    db.deleteObjectStore(this.storeName);
                }

                const objectStore = db.createObjectStore(this.storeName, {
                    keyPath: ['fileName', 'lapKey', 'notes'] // Composite key with notes
                });
                objectStore.createIndex('fileName', 'fileName', { unique: false });
                objectStore.createIndex('timestamp', 'timestamp', { unique: false });
            };
        });
    }

    /**
     * Save screenshot of VE plot as PNG
     */
    async saveScreenshot(fileName: string, lapCombo: string): Promise<void> {
        try {
            // Get the VE plot div
            const vePlotDiv = document.getElementById('vePlot');
            if (!vePlotDiv) {
                throw new Error('VE plot not found');
            }

            // Use Plotly's toImage to capture the plot
            const Plotly = (window as any).Plotly;
            if (!Plotly) {
                throw new Error('Plotly not loaded');
            }

            // Generate image as PNG blob
            const imageData = await Plotly.toImage(vePlotDiv, {
                format: 'png',
                width: 1200,
                height: 600,
                scale: 2 // Higher resolution
            });

            // Convert base64 data URL to blob
            const base64Data = imageData.split(',')[1];
            const binaryData = atob(base64Data);
            const arrayBuffer = new Uint8Array(binaryData.length);
            for (let i = 0; i < binaryData.length; i++) {
                arrayBuffer[i] = binaryData.charCodeAt(i);
            }
            const blob = new Blob([arrayBuffer], { type: 'image/png' });

            // Generate filename
            const baseFileName = fileName.replace(/\.fit$/i, '');
            const screenshotFileName = `${baseFileName}_lap${lapCombo}_screenshot.png`;

            // Save using browser-fs-access (with fallback)
            await fileSave(blob, {
                fileName: screenshotFileName,
                extensions: ['.png'],
                description: 'VE Profile Screenshot'
            });

            console.log('✅ Screenshot saved:', screenshotFileName);
        } catch (error) {
            console.error('❌ Failed to save screenshot:', error);
            throw error;
        }
    }

    /**
     * Save VE result to IndexedDB
     */
    async saveResult(data: SaveResultData): Promise<void> {
        if (!this.db) {
            console.warn('IndexedDB not initialized, cannot save result');
            throw new Error('Database not initialized');
        }

        const lapKey = data.laps.length === 0 ? 'all' : data.laps.join('-');

        const storedResult: StoredVEResult = {
            fileName: data.fileName,
            lapKey: lapKey,
            trimStart: data.trimStart,
            trimEnd: data.trimEnd,
            cda: data.cda,
            crr: data.crr,
            windSource: data.windSource,
            windSpeed: data.parameters.wind_speed ?? '',
            windDirection: data.parameters.wind_direction ?? '',
            systemMass: data.parameters.system_mass,
            rho: data.parameters.rho,
            eta: data.parameters.eta,
            r2: data.result.r2,
            rmse: data.result.rmse,
            veGain: data.result.ve_elevation_diff,
            actualGain: data.result.actual_elevation_diff,
            avgPower: data.avgPower,
            avgSpeed: data.avgSpeed,
            avgTemperature: data.avgTemperature,
            notes: data.notes,
            recordingDate: data.recordingDate,
            timestamp: data.timestamp.toISOString()
        };

        return new Promise((resolve, reject) => {
            const transaction = this.db!.transaction([this.storeName], 'readwrite');
            const objectStore = transaction.objectStore(this.storeName);
            const request = objectStore.put(storedResult);

            request.onsuccess = () => {
                resolve();
            };

            request.onerror = () => {
                console.error('❌ Failed to save VE result:', request.error);
                reject(request.error);
            };
        });
    }

    /**
     * Export all VE results to CSV
     */
    async exportAllResultsToCSV(): Promise<void> {
        if (!this.db) {
            console.warn('IndexedDB not initialized');
            throw new Error('Database not initialized');
        }

        return new Promise((resolve, reject) => {
            const transaction = this.db!.transaction([this.storeName], 'readonly');
            const objectStore = transaction.objectStore(this.storeName);
            const request = objectStore.getAll();

            request.onsuccess = async () => {
                const results = request.result as StoredVEResult[];

                if (results.length === 0) {
                    alert('No results to export. Save some results first!');
                    resolve();
                    return;
                }

                // Generate CSV
                const csv = this.generateCSVFromResults(results);

                // Create filename with timestamp
                const timestamp = new Date().toISOString().split('T')[0];
                const csvFileName = `VE_Results_Export_${timestamp}.csv`;

                // Save file
                const blob = new Blob([csv], { type: 'text/csv' });
                try {
                    await fileSave(blob, {
                        fileName: csvFileName,
                        extensions: ['.csv'],
                        description: 'VE Analysis Results Export'
                    });
                    console.log(`✅ Exported ${results.length} results to CSV`);
                    resolve();
                } catch (error) {
                    console.error('❌ Failed to save CSV:', error);
                    reject(error);
                }
            };

            request.onerror = () => {
                console.error('❌ Failed to retrieve results:', request.error);
                reject(request.error);
            };
        });
    }

    /**
     * Generate CSV from stored results
     */
    private generateCSVFromResults(results: StoredVEResult[]): string {
        // Headers
        const headers = [
            'RecordingDate', 'FileName', 'Laps', 'TrimStart', 'TrimEnd', 'CdA', 'Crr',
            'WindSource', 'WindSpeed', 'WindDir', 'SystemMass', 'Rho', 'Eta',
            'R2', 'RMSE', 'VEGain', 'ActualGain',
            'AvgPower', 'AvgSpeed', 'AvgTemp', 'Notes', 'Timestamp'
        ];

        let csv = headers.join(',') + '\n';

        // Sort by recording date (descending), then fileName, then by lapKey
        results.sort((a, b) => {
            if (a.recordingDate !== b.recordingDate) {
                return b.recordingDate.localeCompare(a.recordingDate); // Descending
            }
            if (a.fileName !== b.fileName) {
                return a.fileName.localeCompare(b.fileName);
            }
            return a.lapKey.localeCompare(b.lapKey);
        });

        // Rows
        for (const result of results) {
            const values = [
                result.recordingDate,
                result.fileName,
                result.lapKey,
                result.trimStart,
                result.trimEnd,
                result.cda.toFixed(3),
                result.crr.toFixed(4),
                result.windSource,
                result.windSpeed,
                result.windDirection,
                result.systemMass,
                result.rho.toFixed(3),
                result.eta.toFixed(3),
                result.r2.toFixed(4),
                result.rmse.toFixed(2),
                result.veGain.toFixed(2),
                result.actualGain.toFixed(2),
                result.avgPower.toFixed(1),
                result.avgSpeed.toFixed(2),
                result.avgTemperature.toFixed(1),
                `"${result.notes.replace(/"/g, '""')}"`, // Escape quotes in notes
                result.timestamp
            ];
            csv += values.join(',') + '\n';
        }

        return csv;
    }

    /**
     * Get all stored results
     */
    async getAllResults(): Promise<StoredVEResult[]> {
        if (!this.db) {
            return [];
        }

        return new Promise((resolve, reject) => {
            const transaction = this.db!.transaction([this.storeName], 'readonly');
            const objectStore = transaction.objectStore(this.storeName);
            const request = objectStore.getAll();

            request.onsuccess = () => {
                const results = request.result as StoredVEResult[];
                resolve(results);
            };

            request.onerror = () => {
                console.error('Failed to get results:', request.error);
                reject(request.error);
            };
        });
    }

    /**
     * Clear all stored results
     */
    async clearAllResults(): Promise<void> {
        if (!this.db) return;

        return new Promise((resolve, reject) => {
            const transaction = this.db!.transaction([this.storeName], 'readwrite');
            const objectStore = transaction.objectStore(this.storeName);
            const request = objectStore.clear();

            request.onsuccess = () => {
                resolve();
            };

            request.onerror = () => {
                console.error('Failed to clear results:', request.error);
                reject(request.error);
            };
        });
    }

    /**
     * Save screenshot and result to IndexedDB
     */
    async saveAll(data: SaveResultData): Promise<void> {
        const lapCombo = data.laps.length === 0 ? 'all' : data.laps.join('-');

        // Save screenshot first
        await this.saveScreenshot(data.fileName, lapCombo);

        // Then save to IndexedDB
        await this.saveResult(data);
    }
}
