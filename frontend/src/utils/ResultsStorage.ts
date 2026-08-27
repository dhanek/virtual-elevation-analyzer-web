import { fileSave } from 'browser-fs-access';
import { AnalysisParameters } from '../components/AnalysisParameters';
import type { SegmentVirtualDistance } from '../analysis/VirtualDistance';
import { log } from './log';

// Shape of a VE analysis result kept in IndexedDB.
//
// The array fields are `Float64Array` to match the WASM `VEResult` class
// exactly — this lets `currentVEResult = wasmResult` work without a copy.
// They are `readonly` because VEResult's fields are readonly and widening
// them here would break assignment from a VEResult instance.
//
// The per-sample arrays other than `virtual_elevation` are optional because
// GPS-lap mode only produces a single combined virtual_elevation profile
// (per-sample slope/acceleration/wind/apparent_velocity are not meaningful
// across stitched laps).
export interface VEAnalysisResult {
    readonly virtual_elevation: Float64Array;
    readonly virtual_slope?: Float64Array;
    readonly acceleration?: Float64Array;
    readonly effective_wind?: Float64Array;
    readonly apparent_velocity?: Float64Array;
    r2: number;
    rmse: number;
    ve_elevation_diff: number;
    actual_elevation_diff: number;
    virtual_distance_air: number;
    virtual_distance_ground: number;
    vd_difference_percent: number;
}

export interface SaveResultData {
    fileName: string;
    laps: number[];
    trimStart: number;
    trimEnd: number;
    cda: number;
    crr: number; // 22 °C-referenced slider value
    crrApplied?: number; // temperature-corrected Crr used in the physics
    ambientTemp?: number; // ambient °C used for the Crr temperature correction
    tireSensitivity?: string; // tire sensitivity preset (stiff/typical/supple)
    airSpeedCalibration?: number; // Air speed calibration percentage
    windSource: 'constant' | 'fit' | 'compare' | 'none';
    parameters: AnalysisParameters;
    result: VEAnalysisResult;
    /**
     * One virtual distance per independently-integrated segment, in analysis
     * order — the same figures the VD header shows (change-list entry (h)).
     *
     * Optional so a caller that has not run through the `summarize` seam still
     * stores a valid record; it then carries no virtual distances rather than a
     * wrong one.
     */
    virtualDistances?: SegmentVirtualDistance[];
    timestamp: Date;
    recordingDate: string; // yyyy-mm-dd format from FIT file
    avgPower: number;
    avgSpeed: number;
    avgTemperature?: number;
    notes: string;
}

export interface StoredVEResult {
    fileName: string;
    lapKey: string; // e.g., "1", "2", "1,2"
    trimStart: number;
    trimEnd: number;
    cda: number;
    crr: number; // 22 °C-referenced slider value
    crrApplied?: number; // temperature-corrected Crr used in the physics
    ambientTemp?: number; // ambient °C used for the Crr temperature correction
    tireSensitivity?: string; // tire sensitivity preset (stiff/typical/supple)
    airSpeedCalibration?: number; // Air speed calibration percentage
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
    /**
     * Added with change-list entry (h). ABSENT on every record written before
     * it, which is why every read of it is guarded — an old record must still
     * load and export, just with these three columns empty.
     */
    virtualDistances?: SegmentVirtualDistance[];
    avgPower: number;
    avgSpeed: number;
    avgTemperature?: number;
    notes: string;
    recordingDate: string; // yyyy-mm-dd
    timestamp: string; // ISO timestamp when entry was added to DB
}

export const CSV_HEADERS = [
    'RecordingDate', 'FileName', 'Laps', 'TrimStart', 'TrimEnd', 'CdA', 'Crr',
    'CrrApplied', 'AmbientTemp', 'TireSensitivity', 'AirSpeedCal',
    'WindSource', 'WindSpeed', 'WindDir', 'SystemMass', 'Rho', 'Eta',
    'R2', 'RMSE', 'VEGain', 'ActualGain',
    // Entry (h). One value per independently-integrated segment, ';'-separated
    // in analysis order, aligned position-for-position with VDSegments.
    'VDSegments', 'VDAirKm', 'VDGroundKm', 'VDDiffPercent',
    'AvgPower', 'AvgSpeed', 'AvgTemp', 'Notes', 'Timestamp'
];

/**
 * How N virtual distances fit a format shaped for one value per analysis.
 *
 * A multi-segment analysis has N virtual distances and no single one, so the
 * export does not invent a total. Each of the three quantities gets ONE column
 * holding one value per segment, ';'-separated in analysis order, and a fourth
 * column names the segments in that same order so the mapping is stated rather
 * than inferred from the Laps column:
 *
 *     VDSegments        VDAirKm        VDGroundKm     VDDiffPercent
 *     Lap 2;Lap 3       2.476;2.481    2.702;2.699    -8.36;-8.08
 *
 * A SINGLE-segment analysis is unchanged in shape from what it has always shown
 * on screen: no segment label, and a bare number in each value column —
 *
 *     VDSegments        VDAirKm        VDGroundKm     VDDiffPercent
 *     (empty)           2.476          2.702          -8.36
 *
 * ';' is used rather than ',' because these are single CSV cells. A record
 * written before entry (h) has no virtual distances at all and yields four
 * empty cells; it must still export, which is the point of the `?? []`.
 */
export function virtualDistanceCsvCells(
    distances: SegmentVirtualDistance[] | undefined
): [string, string, string, string] {
    const entries = distances ?? [];
    return [
        // A lone segment needs no name: the row already says which laps it
        // covers, and this is the shape single-lap Standard has always had.
        entries.length > 1 ? entries.map(entry => entry.label).join(';') : '',
        entries.map(entry => entry.airKm.toFixed(3)).join(';'),
        entries.map(entry => entry.groundKm.toFixed(3)).join(';'),
        entries.map(entry => entry.differencePercent.toFixed(2)).join(';'),
    ];
}

/**
 * Generate CSV from stored results.
 *
 * Module-level and exported so the row shape can be asserted directly; the
 * class method delegates here.
 */
export function generateCSVFromResults(results: StoredVEResult[]): string {
    let csv = CSV_HEADERS.join(',') + '\n';

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
            result.crrApplied !== undefined ? result.crrApplied.toFixed(4) : '',
            result.ambientTemp !== undefined ? result.ambientTemp.toFixed(1) : '',
            result.tireSensitivity ?? '',
            result.airSpeedCalibration !== undefined ? result.airSpeedCalibration.toFixed(1) : '',
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
            ...virtualDistanceCsvCells(result.virtualDistances),
            result.avgPower.toFixed(1),
            result.avgSpeed.toFixed(2),
            result.avgTemperature !== undefined ? result.avgTemperature.toFixed(1) : '',
            `"${result.notes.replace(/"/g, '""')}"`, // Escape quotes in notes
            result.timestamp
        ];
        csv += values.join(',') + '\n';
    }

    return csv;
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
                log.error('❌ Failed to delete database:', request.error);
                reject(request.error);
            };

            request.onblocked = () => {
                log.warn('⚠️ Database deletion blocked - close all tabs using this database');
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
                        log.error('❌ Migration failed:', error);
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
                log.error('❌ Failed to read existing data:', request.error);
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
                        airSpeedCalibration: oldRecord.airSpeedCalibration,
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
                        // Pre-(h) records have none. Carried through rather
                        // than defaulted, so a migrated record stays honest
                        // about not having them.
                        virtualDistances: oldRecord.virtualDistances,
                        avgPower: oldRecord.avgPower ?? 0,
                        avgSpeed: oldRecord.avgSpeed ?? 0,
                        avgTemperature: oldRecord.avgTemperature,
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
                log.error('❌ Migration transaction failed:', transaction.error);
                reject(transaction.error);
            };
        });
    }

    private async createDatabase(): Promise<void> {
        return new Promise((resolve, reject) => {
            const request = indexedDB.open(this.dbName, 5); // Version 5: Removed error columns, added recordingDate

            request.onerror = () => {
                log.error('❌ IndexedDB failed to open:', request.error);
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

            log.debug('✅ Screenshot saved:', screenshotFileName);
        } catch (error) {
            log.error('❌ Failed to save screenshot:', error);
            throw error;
        }
    }

    /**
     * Save VE result to IndexedDB
     */
    async saveResult(data: SaveResultData): Promise<void> {
        if (!this.db) {
            log.warn('IndexedDB not initialized, cannot save result');
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
            crrApplied: data.crrApplied,
            ambientTemp: data.ambientTemp,
            tireSensitivity: data.tireSensitivity,
            airSpeedCalibration: data.airSpeedCalibration,
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
            // Entry (h): the per-segment figures as shown, NOT a flattened
            // total. `?? []` rather than a fabricated single value, so a caller
            // that supplies none stores none.
            virtualDistances: data.virtualDistances ?? [],
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
                log.error('❌ Failed to save VE result:', request.error);
                reject(request.error);
            };
        });
    }

    /**
     * Export all VE results to CSV
     */
    async exportAllResultsToCSV(): Promise<void> {
        if (!this.db) {
            log.warn('IndexedDB not initialized');
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
                    log.debug(`✅ Exported ${results.length} results to CSV`);
                    resolve();
                } catch (error) {
                    log.error('❌ Failed to save CSV:', error);
                    reject(error);
                }
            };

            request.onerror = () => {
                log.error('❌ Failed to retrieve results:', request.error);
                reject(request.error);
            };
        });
    }

    /**
     * Generate CSV from stored results
     */
    private generateCSVFromResults(results: StoredVEResult[]): string {
        return generateCSVFromResults(results);
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
                log.error('Failed to get results:', request.error);
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
                log.error('Failed to clear results:', request.error);
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
