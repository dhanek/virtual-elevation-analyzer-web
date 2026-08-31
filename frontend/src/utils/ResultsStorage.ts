import { fileSave } from 'browser-fs-access';
import { AnalysisParameters } from '../components/AnalysisParameters';
import type { SegmentVirtualDistance } from '../analysis/VirtualDistance';
import { log } from './log';
import { RESULT_COLUMNS, toCsvCell } from './resultColumns';

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
    /**
     * WHAT THE USER SELECTED AND ANALYZED. One meaning, in all three modes.
     *
     * This column used to mean different things per mode (WR-02): Standard wrote
     * the selection while narrowing everything computed alongside it, and the two
     * segment modes wrote the SURVIVING items — so a 3-lap selection that lost
     * lap 2 read `laps: [1,2,3]` in one mode and `laps: [3]` in the others, and a
     * consumer of the results table or the CSV could not read the column
     * consistently. It is the selection everywhere now; coverage is
     * `lapsCovered`.
     */
    laps: number[];
    /**
     * WHICH OF `laps` THE STORED NUMBERS ACTUALLY DESCRIBE.
     *
     * A segment can drop out — under `MIN_SEGMENT_SAMPLES`, or because its
     * calculator threw — and when one does, `avgPower` / `avgSpeed` /
     * `avgTemperature` / `result` cover only what survived. Without this column
     * nothing in the row or the export says so.
     *
     * Optional, and absent (not equal to `laps`) when no `summarize` has run, so
     * "coverage unknown" stays distinguishable from "covered everything".
     */
    lapsCovered?: number[];
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
    /**
     * The `lapsCovered` subset, '-'-joined like `lapKey` so the two columns read
     * alike. ABSENT on every record written before WR-02, and on any record whose
     * caller ran no `summarize` — every read is guarded and yields an empty cell.
     */
    lapsCoveredKey?: string;
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
    /**
     * The 0-1 height factor the analysis was fitted at (WR-02). ABSENT on every
     * record written before this column, exactly like `crrApplied` above, so
     * every read of it is guarded — an old record must still load and export,
     * with the cell empty rather than a fabricated 1.0 claiming "no transfer".
     *
     * Stored as the FACTOR and exported as a percent, matching the control.
     * `windSpeed` beside it is the raw 10 m value; the wind that reached the
     * physics is `windSpeed * windHeightFactor`.
     */
    windHeightFactor?: number;
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

/**
 * The header line, derived from the one column table rather than restated.
 *
 * This used to be a hand-maintained array of 32 strings sitting beside a
 * hand-maintained array of 32 value expressions in `generateCSVFromResults`,
 * related only by position. See `resultColumns.ts` for why that is now one
 * table; `resultColumns.test.ts` pins the output byte for byte across the
 * change.
 */
export const CSV_HEADERS: readonly string[] = RESULT_COLUMNS.map(
    column => column.header
);

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

    for (const result of results) {
        // ONCE per row: the four VD cells come from one helper call and are
        // handed to the four columns that read them, rather than each column
        // recomputing the group.
        const vd = virtualDistanceCsvCells(result.virtualDistances);
        csv += RESULT_COLUMNS
            .map(column => toCsvCell(column, column.cell(result, vd)))
            .join(',') + '\n';
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
                        // Pre-WR-02 records carry no coverage. Carried through
                        // rather than defaulted to `lapKey`, so a migrated record
                        // stays honest about not knowing.
                        lapsCoveredKey: oldRecord.lapsCoveredKey,
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
            // UNDEFINED, not the full selection, when the caller supplies none:
            // "coverage unknown" and "covered everything" are different claims,
            // and only one of them is true of a record stored before a recompute.
            lapsCoveredKey: data.lapsCovered ? data.lapsCovered.join('-') : undefined,
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
            // WR-02: carried across explicitly, like every other named column.
            // `?? undefined` so a record whose params never held a factor stores
            // no field at all and exports an empty cell.
            windHeightFactor: data.parameters.wind_height_factor ?? undefined,
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
     * Delete ONE stored result.
     *
     * The store's `keyPath` is the composite `['fileName', 'lapKey', 'notes']`
     * (`createDatabase`), so a row is already uniquely addressable and this
     * needs no new index, no schema version and no migration. The key is passed
     * as an object rather than three positional strings precisely because the
     * components are all strings: a transposed pair would delete a different
     * row, silently, and positional arguments make that a typo rather than a
     * type error.
     *
     * Deleting a key that is not present RESOLVES rather than throwing, which is
     * IndexedDB's own behaviour and the right one here — a second click on a
     * table another tab has already pruned should not raise.
     *
     * RESOLVING IS A CLAIM, and the only caller acts on it: the results view
     * removes the row and decrements its count as soon as this settles. So the
     * two ways of resolving without having deleted anything are both errors:
     *
     *   - NO DATABASE. `saveResult` already throws here rather than returning
     *     quietly; a delete that reported success while storage was never
     *     opened would take the row off the table and leave it on disk.
     *   - REQUEST SUCCESS. An IndexedDB write can succeed at request level and
     *     still be rolled back when its transaction aborts (quota, an explicit
     *     abort, the connection closing). The row would then reappear the next
     *     time the view is opened, with nothing having reported a failure.
     *     `oncomplete`/`onabort` is the honest pair for a mutating request.
     */
    async deleteResult(key: {
        fileName: string;
        lapKey: string;
        notes: string;
    }): Promise<void> {
        if (!this.db) {
            log.warn('IndexedDB not initialized, cannot delete result');
            throw new Error('Database not initialized');
        }

        return new Promise((resolve, reject) => {
            const transaction = this.db!.transaction([this.storeName], 'readwrite');
            const objectStore = transaction.objectStore(this.storeName);
            const request = objectStore.delete([key.fileName, key.lapKey, key.notes]);

            // An explicit `abort()` leaves both `error` fields null, so the
            // reason has to be synthesised rather than passed through — a
            // rejection with `null` in it tells the caller nothing.
            const failure = (what: string) =>
                transaction.error ?? request.error ?? new Error(what);

            request.onerror = () => {
                log.error('Failed to delete result:', request.error);
            };

            transaction.oncomplete = () => {
                resolve();
            };

            transaction.onabort = () => {
                const error = failure('Delete transaction aborted');
                log.error('Delete transaction aborted:', error);
                reject(error);
            };

            transaction.onerror = () => {
                const error = failure('Delete transaction failed');
                log.error('Delete transaction failed:', error);
                reject(error);
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
