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
    cdaError: number;
    crrError: number;
    timestamp: string;
}

export class ResultsStorage {
    private dbName = 'VirtualElevationResults'; // Separate database for results
    private storeName = 'veResults';
    private db: IDBDatabase | null = null;

    async initialize(): Promise<void> {
        return new Promise((resolve, reject) => {
            const request = indexedDB.open(this.dbName, 1); // First version of results DB

            request.onerror = () => {
                console.error('❌ IndexedDB failed to open:', request.error);
                reject(request.error);
            };

            request.onsuccess = () => {
                this.db = request.result;
                console.log('✅ ResultsStorage IndexedDB initialized');
                resolve();
            };

            request.onupgradeneeded = (event) => {
                const db = (event.target as IDBOpenDBRequest).result;

                // Create VE results store if it doesn't exist
                if (!db.objectStoreNames.contains(this.storeName)) {
                    const objectStore = db.createObjectStore(this.storeName, {
                        keyPath: ['fileName', 'lapKey'] // Composite key
                    });
                    objectStore.createIndex('fileName', 'fileName', { unique: false });
                    objectStore.createIndex('timestamp', 'timestamp', { unique: false });
                    console.log('✅ Created veResults object store');
                }
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
            cdaError: this.calculateCdAError(data.result, data.cda),
            crrError: this.calculateCrrError(data.result, data.crr),
            timestamp: data.timestamp.toISOString()
        };

        return new Promise((resolve, reject) => {
            const transaction = this.db!.transaction([this.storeName], 'readwrite');
            const objectStore = transaction.objectStore(this.storeName);
            const request = objectStore.put(storedResult);

            request.onsuccess = () => {
                console.log(`✅ Saved VE result for ${data.fileName}, laps: ${lapKey}`);
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
            'FileName', 'Laps', 'TrimStart', 'TrimEnd', 'CdA', 'Crr',
            'WindSource', 'WindSpeed', 'WindDir', 'SystemMass', 'Rho', 'Eta',
            'R2', 'RMSE', 'VEGain', 'ActualGain', 'CdAError', 'CrrError', 'Timestamp'
        ];

        let csv = headers.join(',') + '\n';

        // Sort by fileName, then by lapKey
        results.sort((a, b) => {
            if (a.fileName !== b.fileName) {
                return a.fileName.localeCompare(b.fileName);
            }
            return a.lapKey.localeCompare(b.lapKey);
        });

        // Rows
        for (const result of results) {
            const values = [
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
                result.cdaError.toFixed(3),
                result.crrError.toFixed(4),
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
                resolve(request.result as StoredVEResult[]);
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
                console.log('✅ Cleared all VE results');
                resolve();
            };

            request.onerror = () => {
                console.error('Failed to clear results:', request.error);
                reject(request.error);
            };
        });
    }

    /**
     * Calculate CdA error (simplified - using RMSE as proxy)
     */
    private calculateCdAError(result: VEAnalysisResult, cda: number): number {
        // Simple heuristic: error proportional to RMSE and CdA
        // In a real implementation, this would come from optimization bounds
        return result.rmse * 0.001 * cda;
    }

    /**
     * Calculate Crr error (simplified - using RMSE as proxy)
     */
    private calculateCrrError(result: VEAnalysisResult, crr: number): number {
        // Simple heuristic: error proportional to RMSE and Crr
        // In a real implementation, this would come from optimization bounds
        return result.rmse * 0.0001 * crr;
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
