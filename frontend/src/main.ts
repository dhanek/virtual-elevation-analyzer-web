import { getActivityFileType, validateActivityFile, validateFitMagicNumber } from './utils/FileValidation';
import { FitFileProcessor } from './components/FitFileProcessor';
import { MapVisualization } from './components/MapVisualization';
import { AnalysisParametersComponent, AnalysisParameters } from './components/AnalysisParameters';
import { ViewportAdapter } from './utils/ViewportAdapter';
import { ParameterStorage, type LapSettings } from './utils/ParameterStorage';
import { ResultsStorage } from './utils/ResultsStorage';
import { DEMManager, ElevationProfileCache } from './utils/DEMManager';
import { RemoteDEMConfig, type DEMSourceType } from './utils/RemoteDEMConfig';
import { RemoteDEMService } from './utils/RemoteDEMService';
import { MultiDEMManager } from './utils/MultiDEMManager';
import { WeatherCache } from './utils/WeatherCache';
import { CsvParseError, type GibliCsvData } from './utils/CsvParser';
import { log } from './utils/log';
import {
    GpsLapDetector,
    OutAndBackDetector,
    type GpsLapDetectionConfig,
    type OutAndBackConfig,
    getDefaultLapDetectionConfig,
    DEFAULT_OUT_AND_BACK_CONFIG,
    formatLapDuration,
    formatLapDistance
} from './utils/GpsLapDetection';
import { AppState } from './state/AppState';
import { createFitLoadedActivity, loadCsvActivity } from './activity/ActivityLoader';
import { getNormalizedActivityArrays } from './analysis/ActivityArrayCache';
import {
    saveMapTrimSettings,
} from './analysis/MultiSegmentSettings';
import { showGpsLapVEAnalysis } from './shell/gpsLap';
import { showOutAndBackVEAnalysis } from './shell/outAndBack';
import { resolveWindSeries } from './analysis/WindSourceResolver';
import { getAnalysisModeHandler } from './modes/analysis/AnalysisModes';
import { prepareAnalysisPayload } from './shell/analysis/prepareAnalysisPayload'
import { createModeRenderCallbacks } from './shell/analysis/renderDelegates'
import init, { AirDensityCalculator } from '../pkg/virtual_elevation_analyzer.js';
import {
    renderSection3Template,
    bindLapSelection,
    bindSelectAllButton,
    bindGpsDetection,
    bindOutAndBackDetection
} from './shell/section3'
import {
    calculateAutoRho,
    showVirtualElevationAnalysisInline
} from './shell/ve'
import {
    handleSaveScreenshot,
    handleStoreResult,
    handleExportAllResults,
    saveCurrentLapSettings
} from './shell/analysis/storageHandlers';

// Plotly.js type declaration
declare const Plotly: any;

const MIN_TRIM_WINDOW_SAMPLES = 30;

function isGpsLapSelectionMode(lapDetectionMode: string | null | undefined): boolean {
    return lapDetectionMode === 'GPS based lap splitting' || lapDetectionMode === 'GPS gate one way';
}

// Helper function to dynamically load and wait for Plotly
function waitForPlotly(): Promise<any> {
    return new Promise((resolve, reject) => {
        // Check if already loaded
        if (typeof (window as any).Plotly !== 'undefined') {
            resolve((window as any).Plotly);
            return;
        }


        // Load Plotly script dynamically
        const script = document.createElement('script');
        script.src = 'https://cdn.plot.ly/plotly-basic-2.27.0.min.js'; // Use basic bundle (no eval required)
        script.async = false;
        script.crossOrigin = 'anonymous';

        script.onload = () => {
            // Give it a moment to initialize
            setTimeout(() => {
                if (typeof (window as any).Plotly !== 'undefined') {
                    resolve((window as any).Plotly);
                } else {
                    log.error('Plotly script loaded but Plotly is not on window object');
                    reject(new Error('Plotly loaded but not available'));
                }
            }, 100);
        };

        script.onerror = (error) => {
            log.error('Failed to load Plotly script:', error);
            log.error('Network error or CSP blocking the script');
            reject(new Error('Failed to load Plotly script from CDN'));
        };

        document.head.appendChild(script);
    });
}

// DOM elements
const fitFileInput = document.getElementById('fitFileInput') as HTMLInputElement;
const fileDropZone = document.getElementById('fileDropZone') as HTMLDivElement;
const fileInfo = document.getElementById('fileInfo') as HTMLDivElement;
const fileDetails = document.getElementById('fileDetails') as HTMLDivElement;
const analyzeButton = document.getElementById('analyzeButton') as HTMLButtonElement;
const loading = document.getElementById('loading') as HTMLDivElement;
const loadingText = document.getElementById('loadingText') as HTMLSpanElement;
const error = document.getElementById('error') as HTMLDivElement;
const results = document.getElementById('results') as HTMLDivElement;
const statisticsContent = document.getElementById('statisticsContent') as HTMLDivElement;
const clearStorageButton = document.getElementById('clearStorageButton') as HTMLButtonElement;

// DEM-related DOM elements
const demFileInput = document.getElementById('demFileInput') as HTMLInputElement;
const demFileDropZone = document.getElementById('demFileDropZone') as HTMLDivElement;
const demFileInfo = document.getElementById('demFileInfo') as HTMLDivElement;
const demFileName = document.getElementById('demFileName') as HTMLSpanElement;
const demFileMetadata = document.getElementById('demFileMetadata') as HTMLDivElement;
const clearDemButton = document.getElementById('clearDemButton') as HTMLButtonElement;
// DEM source selector & status
const remoteDEMSelector = document.getElementById('remoteDEMSelector') as HTMLSelectElement;
const localDEMFileSection = document.getElementById('localDEMFileSection') as HTMLDivElement;
const remoteDEMStatus = document.getElementById('remoteDEMStatus') as HTMLDivElement;

const appState = new AppState();

// Stateful services / adapters (kept out of AppState on purpose)
let fitProcessor: FitFileProcessor | null = null;
let mapVisualization: MapVisualization | null = null;
let parametersComponent: AnalysisParametersComponent | null = null;
let viewportAdapter: ViewportAdapter;
let parameterStorage: ParameterStorage;
let resultsStorage: ResultsStorage = new ResultsStorage();

// DEM-related services (kept out of AppState on purpose)
let demManager: DEMManager = new DEMManager();
let elevationCache: ElevationProfileCache = new ElevationProfileCache();

// Remote DEM services (kept out of AppState on purpose)
let multiDEMManager: MultiDEMManager = new MultiDEMManager();
let remoteDEMService: RemoteDEMService = new RemoteDEMService();

// NOTE: A parallel `isOutAndBackModeActive` flag used to live here, but it
// was write-only (set in handleAnalyze, never read). Out-and-back mode is
// detected per-function via `lapDetectionMode === 'GPS based out and back'`.

// Initialize FIT processor and parameter storage
async function initializeFitProcessor() {
    try {
        showLoading('Initializing WebAssembly module...');

        // Initialize the Virtual Elevation WASM module
        await init();

        fitProcessor = new FitFileProcessor();
        await fitProcessor.initialize();

        // Initialize parameter storage
        parameterStorage = new ParameterStorage();
        await parameterStorage.initialize();

        // Initialize results storage
        await resultsStorage.initialize();

        // Clean up old entries on startup
        await parameterStorage.cleanup();

        hideLoading();
        hideError();
    } catch (err) {
        log.error('Failed to initialize:', err);
        hideLoading();
        const errorMessage = err instanceof Error ? err.message : 'Unknown error';
        showError(`Failed to initialize: ${errorMessage}. Check browser console for details.`);
    }
}

// File selection handlers
fileDropZone.addEventListener('click', () => {
    fitFileInput.click();
});

fitFileInput.addEventListener('change', (event) => {
    const target = event.target as HTMLInputElement;
    if (target.files && target.files.length > 0) {
        handleFileSelection(target.files[0]);
    }
});

// Drag and drop handlers
fileDropZone.addEventListener('dragover', (event) => {
    event.preventDefault();
    fileDropZone.classList.add('dragover');
});

fileDropZone.addEventListener('dragleave', () => {
    fileDropZone.classList.remove('dragover');
});

fileDropZone.addEventListener('drop', (event) => {
    event.preventDefault();
    fileDropZone.classList.remove('dragover');

    const files = event.dataTransfer?.files;
    if (files && files.length > 0) {
        handleFileSelection(files[0]);
    }
});

// DEM file selection handlers
demFileDropZone.addEventListener('click', () => {
    demFileInput.click();
});

demFileInput.addEventListener('change', async (event) => {
    const target = event.target as HTMLInputElement;
    if (target.files && target.files.length > 0) {
        await handleDEMFileSelection(target.files);
    }
});

demFileDropZone.addEventListener('dragover', (event) => {
    event.preventDefault();
    demFileDropZone.classList.add('dragover');
});

demFileDropZone.addEventListener('dragleave', () => {
    demFileDropZone.classList.remove('dragover');
});

demFileDropZone.addEventListener('drop', async (event) => {
    event.preventDefault();
    demFileDropZone.classList.remove('dragover');

    const files = event.dataTransfer?.files;
    if (files && files.length > 0) {
        await handleDEMFileSelection(files);
    }
});

clearDemButton.addEventListener('click', () => {
    clearDEMFile();
});

// DEM source selection: aws-terrain (default), none, local
function updateDEMSourceSelection(value: string): void {
    // Show local file section only when "local" is selected
    localDEMFileSection.classList.toggle('hidden', value !== 'local');

    // Update description text
    const desc = document.getElementById('demDescription');
    if (desc) {
        switch (value) {
            case 'aws-terrain':
                desc.textContent = 'AWS Terrain Tiles are downloaded automatically to provide accurate elevation data.';
                break;
            case 'none':
                desc.textContent = 'Using the elevation recorded in the FIT file (GPS / barometer).';
                break;
            case 'local':
                desc.textContent = 'Upload a local GeoTIFF DEM file to use as elevation source.';
                break;
        }
    }

    // Set remote sources for AWS; clear for none/local
    if (value === 'aws-terrain') {
        appState.remoteDEMSources = ['aws-terrain'];
    } else {
        appState.remoteDEMSources = [];
    }

    RemoteDEMConfig.setPreferredSources(value === 'none' ? [] : [value as DEMSourceType]);
}

remoteDEMSelector.addEventListener('change', (event) => {
    updateDEMSourceSelection((event.target as HTMLSelectElement).value);
});

// Restore saved DEM preference
const savedSources = RemoteDEMConfig.getPreferredSources();
if (savedSources.length > 0 && savedSources.includes('aws-terrain')) {
    remoteDEMSelector.value = 'aws-terrain';
} else if (savedSources.length === 0) {
    // Check if user explicitly saved "none"
    const raw = localStorage.getItem('remote-dem-sources');
    if (raw && JSON.parse(raw).length === 0) {
        remoteDEMSelector.value = 'none';
    }
}
updateDEMSourceSelection(remoteDEMSelector.value);

// DEM file handling functions
async function handleDEMFileSelection(files: FileList): Promise<void> {
    try {
        showLoading('Loading DEM file...');

        // Separate TIF, world, and projection files
        let tifFile: File | null = null;
        let worldFile: File | null = null;
        let projFile: File | null = null;

        for (let i = 0; i < files.length; i++) {
            const file = files[i];
            const fileName = file.name.toLowerCase();

            if (fileName.endsWith('.tif') || fileName.endsWith('.tiff') || fileName.endsWith('.vrt')) {
                tifFile = file;
            } else if (fileName.endsWith('.tfw') || fileName.endsWith('.tifw')) {
                worldFile = file;
            } else if (fileName.endsWith('.prj')) {
                projFile = file;
            }
        }

        if (!tifFile) {
            throw new Error('No .tif or .tiff file selected');
        }

        // Load DEM file with optional world and projection files
        await demManager.loadDEMFile(tifFile, worldFile ?? undefined, projFile ?? undefined);
        appState.selectedDEMFile = tifFile;

        // Update UI
        demFileInfo.classList.remove('hidden');
        const fileNames = [tifFile.name];
        if (worldFile) fileNames.push(worldFile.name);
        if (projFile) fileNames.push(projFile.name);
        const displayName = fileNames.join(' + ');
        demFileName.textContent = displayName;

        // Show metadata
        const metadata = JSON.parse(demManager.getDEMMetadata()!);
        const bounds = demManager.getDEMBounds();
        demFileMetadata.innerHTML = `
            <p>Size: ${metadata.width} × ${metadata.height} pixels</p>
            <p>Bounds: [${bounds![0].toFixed(2)}, ${bounds![1].toFixed(2)}, ${bounds![2].toFixed(2)}, ${bounds![3].toFixed(2)}]</p>
        `;

        appState.elevationCorrectionEnabled = true;

        hideLoading();
        log.debug('DEM file loaded successfully:', displayName);
    } catch (err) {
        hideLoading();
        showError(`Failed to load DEM file: ${err}`);
        clearDEMFile();
    }
}

function clearDEMFile(): void {
    demManager.clearDEM();
    appState.selectedDEMFile = null;
    demFileInfo.classList.add('hidden');
    appState.elevationCorrectionEnabled = false;
    demFileInput.value = '';
    appState.elevationErrorRate = 0;
}

// File validation and display
async function handleFileSelection(file: File) {
    // Validate file type and size
    if (!validateActivityFile(file)) {
        showError('Please select a valid FIT or CSV file (.fit or .csv extension, under 50MB)');
        return;
    }

    appState.selectedFile = file;
    displayFileInfo(file);

    // Calculate file hash immediately for parameter persistence
    if (parameterStorage) {
        appState.currentFileHash = await parameterStorage.calculateFileHash(file);
    }

    analyzeButton.disabled = false;
    hideError();
}

function displayFileInfo(file: File) {
    const fileSize = formatFileSize(file.size);
    const lastModified = new Date(file.lastModified).toLocaleString();

    fileDetails.innerHTML = `
        <div><strong>Name:</strong> ${file.name}</div>
        <div><strong>Size:</strong> ${fileSize}</div>
        <div><strong>Modified:</strong> ${lastModified}</div>
    `;

    fileInfo.classList.remove('hidden');
}

// Analyze button handler
analyzeButton.addEventListener('click', async () => {
    if (!appState.selectedFile || !fitProcessor) {
        showError('No file selected or processor not initialized');
        return;
    }

    try {
        // Detect file type
        const fileType = getActivityFileType(appState.selectedFile);

        if (fileType === 'fit') {
            await processFitFile(appState.selectedFile);
        } else if (fileType === 'csv') {
            await processCsvFile(appState.selectedFile);
        } else {
            showError('Unknown file type. Please select a .fit or .csv file.');
            hideLoading();
            return;
        }

    } catch (err) {
        log.error('Error processing file:', err);
        showError(`Failed to process file: ${err instanceof Error ? err.message : 'Unknown error'}`);
        hideLoading();
    }
});

// Process FIT file
async function processFitFile(file: File) {
    try {
        showLoading('Reading FIT file...');

        // Additional validation
        const isValidMagicNumber = await validateFitMagicNumber(file);
        if (!isValidMagicNumber) {
            showError('Invalid FIT file format. Please select a valid FIT file.');
            hideLoading();
            return;
        }

        showLoading('Parsing FIT data...');

        if (!fitProcessor) {
            showError('FIT processor not initialized');
            hideLoading();
            return;
        }

        const result = await fitProcessor.processFitFile(file);
        appState.setLoadedActivity(createFitLoadedActivity({
            file,
            fileHash: appState.currentFileHash,
            result,
        }));

        // Apply DEM elevation correction if enabled
        if (appState.elevationCorrectionEnabled && demManager.isDEMLoaded() && result.fit_data) {
            showLoading('Correcting elevation using DEM...');

            try {
                const fitData = result.fit_data;
                const lats = fitData.position_lat;
                const lons = fitData.position_long;
                const originalAltitudes = fitData.altitude;

                if (lats && lons && originalAltitudes) {
                    // Debug: Log first few coordinates
                    log.debug('Sample GPS coordinates:', {
                        lat: lats.slice(0, 5),
                        lon: lons.slice(0, 5),
                        originalAlt: originalAltitudes.slice(0, 5)
                    });

                    const correctionResult = await demManager.correctElevation(lats, lons, originalAltitudes);

                    log.debug('Sample corrected elevations:', correctionResult.elevations.slice(0, 5));

                    // Replace altitudes with corrected values using setter
                    result.fit_data.set_altitude(correctionResult.elevations);
                    appState.elevationErrorRate = correctionResult.errorRate;

                    log.debug(`Elevation corrected. Error rate: ${(appState.elevationErrorRate * 100).toFixed(1)}%`);

                    if (appState.elevationErrorRate > 0.5) {
                        log.warn('High error rate! DEM may not cover route area. DEM bounds:', demManager.getDEMBounds());
                    }

                    // Cache the corrected elevation profile
                    if (appState.currentFileHash && elevationCache) {
                        const bounds = {
                            minLat: Math.min(...lats),
                            maxLat: Math.max(...lats),
                            minLon: Math.min(...lons),
                            maxLon: Math.max(...lons)
                        };

                        await elevationCache.cacheProfile(
                            appState.currentFileHash,
                            appState.selectedFile?.name ?? 'unknown',
                            correctionResult.elevations,
                            bounds
                        );
                    }
                } else {
                    log.warn('Missing GPS or altitude data, skipping DEM correction');
                }
            } catch (demError) {
                log.warn('DEM elevation correction failed, using GPS altitude:', demError);
                showError(`Warning: DEM correction failed: ${demError}. Using GPS altitude.`);
                // Continue with original GPS altitude
            }
        }

        // Apply remote DEM elevation correction(s) if any sources selected
        appState.remoteDEMResults = null;
        if (appState.remoteDEMSources.length > 0 && result.fit_data) {
            const fitData = result.fit_data;
            const lats = fitData.position_lat;
            const lons = fitData.position_long;
            const originalAltitudes = fitData.altitude;

            if (lats && lons && originalAltitudes) {
                try {
                    showLoading('Downloading remote DEM data...');
                    remoteDEMStatus.classList.remove('hidden');
                    remoteDEMStatus.textContent = 'Fetching elevation data...';

                    multiDEMManager.clearAll();

                    const fetchResults = await remoteDEMService.fetchForRoute(
                        Array.from(lats), Array.from(lons), appState.remoteDEMSources,
                        {},
                        (_source, stage, _percent) => {
                            remoteDEMStatus.textContent = stage;
                        }
                    );

                    // Load each source into MultiDEMManager
                    for (const [source, data] of fetchResults) {
                        showLoading(`Loading ${source} DEM...`);
                        await multiDEMManager.loadSource(source, data);
                    }

                    // Correct elevations for all sources
                    showLoading('Correcting elevation from remote DEM...');
                    appState.remoteDEMResults = await multiDEMManager.correctAllSources(
                        Array.from(lats), Array.from(lons), Array.from(originalAltitudes)
                    );

                    // Apply the best available DEM as actual elevation
                    const bestSource: DEMSourceType | undefined =
                        appState.remoteDEMResults.has('aws-terrain') ? 'aws-terrain' : undefined;
                    if (bestSource) {
                        const bestDEM = appState.remoteDEMResults.get(bestSource)!;
                        if (bestDEM.errorRate < 0.5) {
                            result.fit_data.set_altitude(bestDEM.elevations);
                            log.debug(`Applied ${bestSource} DEM as actual elevation (error rate: ${(bestDEM.errorRate * 100).toFixed(1)}%)`);
                        } else {
                            log.warn(`${bestSource} DEM error rate too high (${(bestDEM.errorRate * 100).toFixed(1)}%), keeping FIT elevation`);
                        }
                    }

                    // Update status display
                    const statusParts: string[] = [];
                    for (const [, demRes] of appState.remoteDEMResults) {
                        const coverage = ((1 - demRes.errorRate) * 100).toFixed(1);
                        statusParts.push(`AWS Terrain: ${coverage}% coverage`);
                    }
                    remoteDEMStatus.textContent = statusParts.join(' | ');

                    log.debug('Remote DEM results:', Object.fromEntries(appState.remoteDEMResults));
                } catch (remoteDemError) {
                    log.warn('Remote DEM correction failed:', remoteDemError);
                    remoteDEMStatus.textContent = `Failed: ${remoteDemError}`;
                }
            }
        } else {
            remoteDEMStatus.classList.add('hidden');
        }

        hideLoading();
        displayResults(result);

        // Activate section 2 (parameters) and 3 (lap selection) after successful file analysis
        activateSection(2);
        scrollToSection('parametersSection');

        // Trigger auto-rho calculation if enabled and we have GPS data
        if (parametersComponent?.getParameters().auto_calculate_rho && result.parsing_statistics.has_gps_data) {
            // Delay slightly to ensure trim sliders are initialized
            setTimeout(async () => {
                await calculateAutoRho(appState, parametersComponent, { appState, showLoading, hideLoading, showError });
            }, 500);
        }

        // Activate section 3 if we have laps (GPS data optional)
        if (result.laps.length > 0) {
            activateSection(3);

            // Initialize section 3 after a brief delay to ensure DOM is ready
            setTimeout(() => {
                initializeSection3();
            }, 100);
        }

    } catch (err) {
        hideLoading();
        log.error('Error processing FIT file:', err);
        showError(`Error processing FIT file: ${err}`);
    }
}

// Display CSV results (similar to displayResults but for CSV)
async function displayCsvResults(csvData: GibliCsvData, result: any) {
    const stats = result.parsing_statistics;

    fileDetails.innerHTML = `
        <div><strong>File Type:</strong> CSV (Gibli Aerosensor)</div>
        <div><strong>Data Points:</strong> ${stats.data_points}</div>
        <div><strong>Duration:</strong> ${(csvData.timeRangeSeconds / 60).toFixed(1)} minutes</div>
        <div><strong>Power Data:</strong> ${stats.has_power_data ? '✅ Yes' : '❌ No'}</div>
        <div><strong>GPS Data:</strong> ${stats.has_gps_data ? '✅ Yes' : '❌ No'}</div>
        <div><strong>Altitude Data:</strong> ${stats.has_altitude_data ? '✅ Yes' : '❌ No'}</div>
        <div><strong>Air Speed Data:</strong> ${stats.has_air_speed_data ? '✅ Yes' : '❌ No'}</div>
        <div><strong>Environmental Data:</strong> ${csvData.hasEnvironmentalData ? '✅ Yes (Temp, Humidity, Pressure)' : '❌ No'}</div>
        <div><strong>CdA Reference:</strong> ${csvData.hasCdaReference ? `✅ Yes (avg: ${calculateAvgCda(csvData).toFixed(3)})` : '❌ No'}</div>
        <div><strong>Laps:</strong> ${result.laps.length > 0 ? `✅ ${result.laps.length} lap(s)` : '❌ No lap data'}</div>
    `;

    fileInfo.classList.remove('hidden');

    // Initialize analysis parameters component (same as FIT files)
    appState.isLoadingParameters = true; // Prevent saving during initialization
    initializeAnalysisParameters();

    // Try to load saved parameters for this file
    if (appState.currentFileHash && parametersComponent) {
        const savedParameters = await parameterStorage.loadParameters(appState.currentFileHash);
        if (savedParameters) {
            // Load saved parameters
            parametersComponent.setParameters(savedParameters);
        } else {
            // First time loading - apply smart defaults
            if (csvData.hasEnvironmentalData) {
                // CSV has environmental data - disable weather API
                parametersComponent.setParameters({
                    auto_calculate_rho: false
                });
                log.debug('📊 CSV has environmental data - weather API disabled');
            } else if (stats.has_gps_data) {
                // No environmental data but has GPS - enable weather API
                parametersComponent.setParameters({
                    auto_calculate_rho: true
                });
                log.debug('📍 GPS data detected - auto-rho enabled');
            }
        }
    }

    appState.isLoadingParameters = false;

    // Update appState.previousAutoLapDetection to match loaded parameters
    appState.previousAutoLapDetection = appState.currentParameters?.auto_lap_detection || 'None';
}

// Calculate average CdA from CSV reference data
function calculateAvgCda(csvData: GibliCsvData): number {
    if (!csvData.cdaReference) return 0;
    const validCda = csvData.cdaReference.filter(v => !isNaN(v));
    if (validCda.length === 0) return 0;
    return validCda.reduce((sum, v) => sum + v, 0) / validCda.length;
}

// Calculate per-datapoint air density from environmental data (works for both FIT and CSV)
function calculateRhoArrayFromFitData(fitData: any): number[] | null {
    // Check if data has all required environmental data
    if (!fitData.temperature || !fitData.humidity || !fitData.pressure) {
        log.debug('📊 No environmental data available, using single rho parameter');
        return null;
    }

    const rhoArray: number[] = [];
    let successCount = 0;
    let failureCount = 0;

    for (let i = 0; i < fitData.timestamps.length; i++) {
        const temp = fitData.temperature[i];
        const humidity = fitData.humidity[i];
        const pressure = fitData.pressure[i];

        // Skip invalid data points
        if (isNaN(temp) || isNaN(humidity) || isNaN(pressure)) {
            rhoArray.push(1.225); // Use standard air density as fallback
            failureCount++;
            continue;
        }

        try {
            // Calculate air density from temperature, humidity, and pressure
            const rho = AirDensityCalculator.calculate_air_density_from_humidity(temp, pressure, humidity);
            rhoArray.push(rho);
            successCount++;
        } catch (err) {
            log.warn(`Failed to calculate rho at index ${i}:`, err);
            rhoArray.push(1.225); // Use standard air density as fallback
            failureCount++;
        }
    }

    log.debug('📊 Per-datapoint rho calculation:', {
        totalPoints: fitData.timestamps.length,
        successCount,
        failureCount,
        sampleRho: rhoArray.slice(0, 5),
        avgRho: (rhoArray.reduce((sum, r) => sum + r, 0) / rhoArray.length).toFixed(4),
        minRho: Math.min(...rhoArray).toFixed(4),
        maxRho: Math.max(...rhoArray).toFixed(4)
    });

    return rhoArray;
}

// Initialize section 3 for CSV data
function initializeSection3Csv(_csvData: GibliCsvData, _result: any) {
    // CSV data is normalized into appState.currentFitData during file loading.
    initializeSection3();
}

// Process CSV file
async function processCsvFile(file: File) {
    try {
        showLoading('Reading CSV file...');

        // Read file content
        const text = await file.text();

        showLoading('Parsing CSV data...');

        const loadedCsv = loadCsvActivity({
            file,
            fileHash: appState.currentFileHash,
            text,
        });
        const { csvData, result, loadedActivity, summary, intervals, wasInterpolated } = loadedCsv;

        log.debug('CSV Data Summary:');
        log.debug(summary);
        log.debug('Time interval statistics:', intervals);

        if (wasInterpolated) {
            log.debug('Non-uniform time series detected, interpolated to 1Hz');
        }

        appState.setLoadedActivity(loadedActivity);

        hideLoading();
        await displayCsvResults(csvData, result);

        // Activate section 2 (parameters) and section 3 (map/laps)
        // CSV files work just like FIT files - both sections are active after loading
        activateSection(2);
        scrollToSection('parametersSection');

        // Initialize and activate section 3 if we have laps
        if (result.laps.length > 0) {
            log.debug('📍 Activating section 3 for CSV lap analysis...');
            activateSection(3);
            setTimeout(() => {
                initializeSection3Csv(csvData, result);
                log.debug('✅ Section 3 initialized for CSV');
            }, 100);
        }

    } catch (err) {
        hideLoading();
        log.error('Error processing CSV file:', err);
        if (err instanceof CsvParseError) {
            showError(`CSV parsing error:\n${err.message}`);
            return;
        }
        showError(`Error processing CSV file: ${err}`);
    }
}

// Workflow management
function scrollToSection(sectionId: string) {
    const section = document.getElementById(sectionId);
    if (!section) return;

    section.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

function activateSection(sectionNumber: number) {
    // Mark previous sections as completed
    for (let i = 1; i < sectionNumber; i++) {
        const numberEl = document.getElementById(`section${i}Number`);
        if (numberEl) {
            numberEl.classList.add('completed');
            numberEl.textContent = '✓';
        }
    }

    // Activate current section
    const sections = ['fileSection', 'parametersSection', 'analysisSection'];
    sections.forEach((sectionId, index) => {
        const section = document.getElementById(sectionId);
        if (section) {
            if (index + 1 <= sectionNumber) {
                section.classList.remove('inactive');
            } else {
                section.classList.add('inactive');
            }
        }
    });
}

// Display results
async function displayResults(result: any) {
    const stats = result.parsing_statistics;
    const laps = result.laps;

    statisticsContent.innerHTML = `
        <div class="stats-grid">
            <div class="stat-item">
                <div class="stat-label">File Size</div>
                <div class="stat-value">${formatFileSize(stats.file_size)}</div>
            </div>
            <div class="stat-item">
                <div class="stat-label">Records</div>
                <div class="stat-value">${stats.record_count.toLocaleString()}</div>
            </div>
            <div class="stat-item">
                <div class="stat-label">Duration</div>
                <div class="stat-value">${formatDuration(stats.duration_seconds)}</div>
            </div>
            <div class="stat-item">
                <div class="stat-label">Distance</div>
                <div class="stat-value">${formatDistance(stats.total_distance_m)}</div>
            </div>
            <div class="stat-item">
                <div class="stat-label">Avg Speed</div>
                <div class="stat-value">${formatSpeed(stats.avg_speed_ms)}</div>
            </div>
            <div class="stat-item">
                <div class="stat-label">Max Speed</div>
                <div class="stat-value">${formatSpeed(stats.max_speed_ms)}</div>
            </div>
            <div class="stat-item">
                <div class="stat-label">Avg Power</div>
                <div class="stat-value">${stats.has_power_data ? formatPower(stats.avg_power) : 'N/A'}</div>
            </div>
            <div class="stat-item">
                <div class="stat-label">Max Power</div>
                <div class="stat-value">${stats.has_power_data ? formatPower(stats.max_power) : 'N/A'}</div>
            </div>
            <div class="stat-item">
                <div class="stat-label">GPS Data</div>
                <div class="stat-value">${stats.has_gps_data ? 'Yes' : 'No'}</div>
            </div>
            <div class="stat-item">
                <div class="stat-label">Power Data</div>
                <div class="stat-value">${stats.has_power_data ? 'Yes' : 'No'}</div>
            </div>
        </div>

        ${laps.length > 0 ? `
        <div style="margin-top: 1.5rem; padding: 1rem; background: #f0fff4; border: 1px solid #38a169; border-radius: 4px; color: #2d7a52;">
            File analyzed successfully! Found ${laps.length} lap${laps.length > 1 ? 's' : ''} with ${stats.has_gps_data ? 'GPS data' : 'no GPS data'}.
            ${stats.has_gps_data ? 'Map and lap selection are now available below.' : ''}
        </div>
        ` : ''}

        ${appState.elevationCorrectionEnabled && appState.selectedDEMFile ? `
        <div style="margin-top: 1.5rem; padding: 1rem; background: #e8f5e9; border-left: 4px solid #4caf50; border-radius: 4px;">
            <h4 style="margin: 0 0 0.5rem 0; color: #2d7a52;">📊 Elevation Correction Applied</h4>
            <p style="margin: 0 0 0.5rem 0; color: #2d7a52;"><strong>DEM file:</strong> ${appState.selectedDEMFile.name}</p>
            <p style="margin: 0 0 0.5rem 0; color: #2d7a52;">
                <strong>Successfully corrected:</strong> ${(100 - appState.elevationErrorRate * 100).toFixed(1)}%
            </p>
            ${appState.elevationErrorRate > 0.01 ? `
            <p style="margin: 0; color: #f57c00; font-weight: 500;">
                ⚠️ ${(appState.elevationErrorRate * 100).toFixed(1)}% of points used GPS fallback (DEM lookup failed)
            </p>
            ` : ''}
        </div>
        ` : ''}
    `;

    results.classList.remove('hidden');

    // Initialize analysis parameters component immediately
    appState.isLoadingParameters = true; // Prevent saving during initialization
    initializeAnalysisParameters();

    // Try to load saved parameters for this file
    if (appState.currentFileHash && parametersComponent) {
        const savedParameters = await parameterStorage.loadParameters(appState.currentFileHash);
        if (savedParameters) {
            // Load saved parameters (preserves user's preference for auto-rho)
            parametersComponent.setParameters(savedParameters);
        } else {
            // First time loading this file - apply smart defaults

            // Determine correct air_speed_offset default based on wind data source
            const fitData = result.fit_data;
            const hasAirSpeed = fitData.air_speed && (Array.from(fitData.air_speed) as number[]).some((v: number) => !isNaN(v) && v !== 0);
            const defaultAirSpeedOffset = hasAirSpeed ? 2 : 0;

            const smartDefaults: any = {
                air_speed_offset: defaultAirSpeedOffset
            };

            // Auto-enable velodrome mode if no GPS data
            if (!result.parsing_statistics.has_gps_data) {
                smartDefaults.velodrome = true;
            }
            // Auto-enable auto-rho if HAS GPS data
            else if (result.parsing_statistics.has_gps_data) {
                smartDefaults.auto_calculate_rho = true;
                log.debug('📍 GPS data detected - auto-rho enabled by default');
            }

            parametersComponent.setParameters(smartDefaults);
            log.debug(`📊 Set air_speed_offset default to ${defaultAirSpeedOffset}s (hasAirSpeed: ${hasAirSpeed})`);
        }
    }

    appState.isLoadingParameters = false; // Re-enable saving after load complete

    // Update appState.previousAutoLapDetection to match loaded parameters
    appState.previousAutoLapDetection = appState.currentParameters?.auto_lap_detection || 'None';
}


// Utility functions
function formatFileSize(bytes: number): string {
    const sizes = ['Bytes', 'KB', 'MB', 'GB'];
    if (bytes === 0) return '0 Bytes';
    const i = Math.floor(Math.log(bytes) / Math.log(1024));
    return Math.round(bytes / Math.pow(1024, i) * 100) / 100 + ' ' + sizes[i];
}

function formatDuration(seconds: number): string {
    const hours = Math.floor(seconds / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    const secs = Math.floor(seconds % 60);

    if (hours > 0) {
        return `${hours}:${minutes.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
    } else {
        return `${minutes}:${secs.toString().padStart(2, '0')}`;
    }
}

function formatDistance(meters: number): string {
    if (meters >= 1000) {
        return `${(meters / 1000).toFixed(1)} km`;
    } else {
        return `${meters.toFixed(0)} m`;
    }
}

function formatSpeed(ms: number): string {
    const kmh = ms * 3.6;
    return `${kmh.toFixed(1)} km/h`;
}

function formatPower(watts: number): string {
    return `${watts.toFixed(0)} W`;
}

/**
 * Calculate air density automatically from weather data
 * Uses GPS coordinates and timestamp from trim region
 * Caches weather data permanently in IndexedDB
 */

// UI state management
function showLoading(message: string) {
    loadingText.textContent = message;
    loading.classList.add('show');
    analyzeButton.disabled = true;
}

function hideLoading() {
    loading.classList.remove('show');
    analyzeButton.disabled = false;
}

function showError(message: string) {
    error.textContent = message;
    error.classList.remove('hidden');
}

function hideError() {
    error.classList.add('hidden');
}

// Initialize application with viewport adaptation
async function initializeApplication() {
    // Initialize viewport adapter first
    viewportAdapter = ViewportAdapter.getInstance();

    // Setup viewport change listener for map resizing
    viewportAdapter.onViewportChange((_viewportInfo) => {

        // Update CSS custom properties for sidebar width
        const sidebarWidth = viewportAdapter.getOptimalSidebarWidth();
        document.documentElement.style.setProperty('--sidebar-width', `${sidebarWidth}px`);

        // Trigger map resize if map exists
        if (mapVisualization && mapVisualization.hasGpsData()) {
            // Map libraries usually need a resize trigger when container dimensions change
            mapVisualization.resizeMap();
        }
    });

    // Initialize FIT processor
    await initializeFitProcessor();
}

// Initialize the application
initializeApplication().catch(err => {
    log.error('Failed to initialize application:', err);
    hideLoading();
    showError(`Failed to initialize application: ${err.message}`);
});


/**
 * Get the time range of currently selected data (from selected FIT laps)
 */
function getSelectedDataTimeRange(): { startTime: number; endTime: number; duration: number } {
    if (!appState.currentFitData) {
        return { startTime: 0, endTime: 0, duration: 0 };
    }

    const timestamps = Array.from(appState.currentFitData.timestamps) as number[];

    if (appState.selectedLaps.length === 0 || appState.currentLaps.length === 0) {
        // No laps selected, use full data range
        const startTime = timestamps[0] || 0;
        const endTime = timestamps[timestamps.length - 1] || 0;
        return { startTime, endTime, duration: endTime - startTime };
    }

    // Get time range from selected FIT laps
    const selectedLapData = appState.selectedLaps.map(lapNumber => appState.currentLaps[lapNumber - 1]).filter(Boolean);
    if (selectedLapData.length === 0) {
        const startTime = timestamps[0] || 0;
        const endTime = timestamps[timestamps.length - 1] || 0;
        return { startTime, endTime, duration: endTime - startTime };
    }

    const startTime = Math.min(...selectedLapData.map(lap => lap.start_time));
    const endTime = Math.max(...selectedLapData.map(lap => lap.end_time));

    return { startTime, endTime, duration: endTime - startTime };
}

/**
 * Find the data index at a given time offset from start
 */
function findDataIndexAtTimeOffset(timeOffset: number, startTime: number): number | null {
    if (!appState.currentFitData) return null;

    const timestamps = Array.from(appState.currentFitData.timestamps) as number[];
    const targetTime = startTime + timeOffset;

    // Find the index with timestamp closest to targetTime
    let closestIndex = 0;
    let closestDiff = Math.abs(timestamps[0] - targetTime);

    for (let i = 1; i < timestamps.length; i++) {
        const diff = Math.abs(timestamps[i] - targetTime);
        if (diff < closestDiff) {
            closestDiff = diff;
            closestIndex = i;
        }
    }

    return closestIndex;
}

/**
 * Run GPS lap detection algorithm
 */
function runGpsLapDetection(markerLat: number, markerLon: number, _markerIndex: number) {
    if (!appState.currentFitData) return;

    // Calculate trim indices from selected FIT laps' time ranges
    let trimStart = 0;
    let trimEnd = appState.currentFitData.timestamps.length - 1;

    if (appState.selectedLaps.length > 0 && appState.currentLaps.length > 0) {
        // Get time ranges for selected FIT laps
        const selectedLapData = appState.selectedLaps.map(lapNumber => appState.currentLaps[lapNumber - 1]);
        const allTimestamps = Array.from(appState.currentFitData.timestamps) as number[];

        // Find the data indices that fall within the selected FIT laps' time ranges
        const indicesInSelectedLaps: number[] = [];
        for (let i = 0; i < allTimestamps.length; i++) {
            const timestamp = allTimestamps[i];
            const isInSelectedLap = selectedLapData.some(lap =>
                timestamp >= lap.start_time && timestamp <= lap.end_time
            );
            if (isInSelectedLap) {
                indicesInSelectedLaps.push(i);
            }
        }

        if (indicesInSelectedLaps.length > 0) {
            trimStart = indicesInSelectedLaps[0];
            trimEnd = indicesInSelectedLaps[indicesInSelectedLaps.length - 1];
            log.debug(`GPS lap detection trim region: ${trimStart} to ${trimEnd} (${indicesInSelectedLaps.length} points from ${appState.selectedLaps.length} FIT laps)`);
        }
    }

    // Get detection mode, defaulting to GPS based lap splitting (not None since we're running detection)
    const detectionMode = appState.currentParameters?.auto_lap_detection;
    const mode = detectionMode && detectionMode !== 'None'
        ? detectionMode
        : 'GPS based lap splitting';

    const config: GpsLapDetectionConfig = {
        markerLat,
        markerLon,
        trimStart,
        trimEnd,
        ...getDefaultLapDetectionConfig(),
        mode
    };

    const detector = new GpsLapDetector(
        Array.from(appState.currentFitData.position_lat),
        Array.from(appState.currentFitData.position_long),
        Array.from(appState.currentFitData.timestamps),
        Array.from(appState.currentFitData.distance),
        config
    );

    appState.gpsLapDetectionResult = detector.detectLaps();
    appState.gpsDetectedLaps = appState.gpsLapDetectionResult.detectedLaps;

    log.debug(`Detected ${appState.gpsDetectedLaps.length} laps:`, appState.gpsDetectedLaps);

    // Show detected laps on map
    if (mapVisualization && appState.gpsLapDetectionResult) {
        mapVisualization.showDetectedLaps(
            appState.gpsLapDetectionResult.detectedLaps,
            appState.gpsLapDetectionResult.passings
        );
    }

    // Update UI
    updateGpsDetectedLapsUI();

    // Auto-select all laps initially
    appState.gpsSelectedLaps = appState.gpsDetectedLaps.map(lap => lap.lapNumber);
    updateAnalyzeButton();
}

/**
 * Update the GPS detected laps UI list
 */
function updateGpsDetectedLapsUI() {
    const lapsInfo = document.getElementById('gpsDetectedLapsInfo');
    const lapCountSpan = document.getElementById('gpsLapCount');
    const lapList = document.getElementById('gpsLapList');

    if (!lapsInfo || !lapCountSpan || !lapList) return;

    if (appState.gpsDetectedLaps.length === 0) {
        lapsInfo.style.display = 'none';
        return;
    }

    lapsInfo.style.display = 'block';
    lapCountSpan.textContent = appState.gpsDetectedLaps.length.toString();

    // Populate lap list
    lapList.innerHTML = appState.gpsDetectedLaps.map(lap => `
        <div class="lap-checkbox-item selected" data-gps-lap="${lap.lapNumber}">
            <input type="checkbox" class="gps-lap-checkbox" id="gps-lap-${lap.lapNumber}" checked>
            <div class="lap-info">
                <div class="lap-number">Lap ${lap.lapNumber}</div>
                <div class="lap-details">
                    ${formatLapDuration(lap.duration)} •
                    ${formatLapDistance(lap.distance)} •
                    ${lap.directionName}
                </div>
            </div>
        </div>
    `).join('');

    // Setup event handlers for GPS lap checkboxes
    lapList.querySelectorAll('.gps-lap-checkbox').forEach(checkbox => {
        checkbox.addEventListener('change', handleGpsLapSelectionChange);
    });

    // Setup click handlers for lap items
    lapList.querySelectorAll('.lap-checkbox-item').forEach(item => {
        item.addEventListener('click', (e) => {
            const target = e.target as Element;
            if (!target.classList.contains('gps-lap-checkbox')) {
                const checkbox = item.querySelector('.gps-lap-checkbox') as HTMLInputElement;
                if (checkbox) {
                    checkbox.checked = !checkbox.checked;
                    handleGpsLapSelectionChange();
                }
            }
        });
    });
}

/**
 * Handle GPS lap selection checkbox changes
 */
function handleGpsLapSelectionChange() {
    const checkboxes = document.querySelectorAll('.gps-lap-checkbox:checked') as NodeListOf<HTMLInputElement>;
    appState.gpsSelectedLaps = Array.from(checkboxes).map(cb => {
        const item = cb.closest('.lap-checkbox-item');
        return item ? parseInt(item.getAttribute('data-gps-lap') || '0') : 0;
    }).filter(lap => lap > 0);

    // Update visual selection state
    document.querySelectorAll('.lap-checkbox-item[data-gps-lap]').forEach(item => {
        const checkbox = item.querySelector('.gps-lap-checkbox') as HTMLInputElement;
        if (checkbox?.checked) {
            item.classList.add('selected');
        } else {
            item.classList.remove('selected');
        }
    });

    log.debug('GPS selected laps:', appState.gpsSelectedLaps);
    updateAnalyzeButton();
}


/**
 * Run Out and Back detection algorithm
 */
function runOutAndBackDetection(markerALat: number, markerALon: number, markerBLat: number, markerBLon: number) {
    if (!appState.currentFitData) return;

    // Calculate trim indices from selected FIT laps' time ranges
    let trimStart = 0;
    let trimEnd = appState.currentFitData.timestamps.length - 1;

    if (appState.selectedLaps.length > 0 && appState.currentLaps.length > 0) {
        const selectedLapData = appState.selectedLaps.map(lapNumber => appState.currentLaps[lapNumber - 1]);
        const allTimestamps = Array.from(appState.currentFitData.timestamps) as number[];

        const indicesInSelectedLaps: number[] = [];
        for (let i = 0; i < allTimestamps.length; i++) {
            const timestamp = allTimestamps[i];
            const isInSelectedLap = selectedLapData.some(lap =>
                timestamp >= lap.start_time && timestamp <= lap.end_time
            );
            if (isInSelectedLap) {
                indicesInSelectedLaps.push(i);
            }
        }

        if (indicesInSelectedLaps.length > 0) {
            trimStart = indicesInSelectedLaps[0];
            trimEnd = indicesInSelectedLaps[indicesInSelectedLaps.length - 1];
            log.debug(`Out and Back trim region: ${trimStart} to ${trimEnd}`);
        }
    }

    const config: OutAndBackConfig = {
        markerALat,
        markerALon,
        markerBLat,
        markerBLon,
        trimStart,
        trimEnd,
        ...DEFAULT_OUT_AND_BACK_CONFIG
    };

    const detector = new OutAndBackDetector(
        Array.from(appState.currentFitData.position_lat),
        Array.from(appState.currentFitData.position_long),
        Array.from(appState.currentFitData.timestamps),
        Array.from(appState.currentFitData.distance),
        config
    );

    appState.outAndBackResult = detector.detectSections();
    appState.outAndBackSections = appState.outAndBackResult.detectedSections;

    log.debug(`Detected ${appState.outAndBackSections.length} out-and-back sections:`, appState.outAndBackSections);

    // Show detected sections on map
    if (mapVisualization && appState.outAndBackResult) {
        mapVisualization.showOutAndBackSections(
            appState.outAndBackResult.detectedSections,
            appState.outAndBackResult.passingsA,
            appState.outAndBackResult.passingsB
        );
    }

    // Update UI
    updateOutAndBackSectionsUI();

    // Auto-select all sections initially
    appState.outAndBackSelectedSections = appState.outAndBackSections.map(s => s.sectionNumber);
    updateAnalyzeButton();
}

/**
 * Update the Out and Back sections UI list
 */
function updateOutAndBackSectionsUI() {
    const sectionsInfo = document.getElementById('outAndBackSectionsInfo');
    const sectionCountSpan = document.getElementById('outAndBackSectionCount');
    const sectionList = document.getElementById('outAndBackSectionList');

    if (!sectionsInfo || !sectionCountSpan || !sectionList) return;

    if (appState.outAndBackSections.length === 0) {
        sectionsInfo.style.display = 'none';
        return;
    }

    sectionsInfo.style.display = 'block';
    sectionCountSpan.textContent = appState.outAndBackSections.length.toString();

    // Populate section list
    sectionList.innerHTML = appState.outAndBackSections.map(section => `
        <div class="lap-checkbox-item selected" data-oab-section="${section.sectionNumber}">
            <input type="checkbox" class="oab-section-checkbox" id="oab-section-${section.sectionNumber}" checked>
            <div class="lap-info">
                <div class="lap-number">Section ${section.sectionNumber}</div>
                <div class="lap-details">
                    Out: ${formatLapDuration(section.outboundDuration)} •
                    Back: ${formatLapDuration(section.inboundDuration)} •
                    ${formatLapDistance(section.totalDistance)}
                </div>
            </div>
        </div>
    `).join('');

    // Setup event handlers for section checkboxes
    sectionList.querySelectorAll('.oab-section-checkbox').forEach(checkbox => {
        checkbox.addEventListener('change', handleOutAndBackSectionSelectionChange);
    });

    // Setup click handlers for section items
    sectionList.querySelectorAll('.lap-checkbox-item').forEach(item => {
        item.addEventListener('click', (e) => {
            const target = e.target as Element;
            if (!target.classList.contains('oab-section-checkbox')) {
                const checkbox = item.querySelector('.oab-section-checkbox') as HTMLInputElement;
                if (checkbox) {
                    checkbox.checked = !checkbox.checked;
                    handleOutAndBackSectionSelectionChange();
                }
            }
        });
    });
}

/**
 * Handle Out and Back section selection checkbox changes
 */
function handleOutAndBackSectionSelectionChange() {
    const checkboxes = document.querySelectorAll('.oab-section-checkbox:checked') as NodeListOf<HTMLInputElement>;
    appState.outAndBackSelectedSections = Array.from(checkboxes).map(cb => {
        const item = cb.closest('.lap-checkbox-item');
        return item ? parseInt(item.getAttribute('data-oab-section') || '0') : 0;
    }).filter(s => s > 0);

    // Update visual selection state
    document.querySelectorAll('.lap-checkbox-item[data-oab-section]').forEach(item => {
        const checkbox = item.querySelector('.oab-section-checkbox') as HTMLInputElement;
        if (checkbox?.checked) {
            item.classList.add('selected');
        } else {
            item.classList.remove('selected');
        }
    });

    log.debug('Out and Back selected sections:', appState.outAndBackSelectedSections);
    updateAnalyzeButton();
}

/**
 * Update Out and Back slider visibility based on FIT lap selection
 */
function updateOutAndBackButtonState() {
    const sliderControls = document.getElementById('oabGateSliderControls');

    const lapDetectionMode = appState.currentParameters?.auto_lap_detection || 'None';

    if (lapDetectionMode !== 'GPS based out and back') {
        if (sliderControls) sliderControls.style.display = 'none';
        return;
    }

    if (appState.selectedLaps.length > 0) {
        // FIT laps are selected - setup and show slider controls
        void bindOutAndBackDetection(appState, parameterStorage, mapVisualization, {
            getSelectedDataTimeRange,
            findDataIndexAtTimeOffset,
            runOutAndBackDetection
        });
    } else {
        // No FIT laps selected - hide slider controls
        if (sliderControls) sliderControls.style.display = 'none';

        // Clear any existing detection when FIT laps are deselected
        if (appState.outAndBackSections.length > 0) {
            appState.outAndBackSections = [];
            appState.outAndBackSelectedSections = [];
            appState.outAndBackResult = null;
            mapVisualization?.clearDetectedLaps();
            mapVisualization?.clearOutAndBackMarkers();
            updateOutAndBackSectionsUI();
        }
    }
}

function initializeMapTrimControls(dataLength: number) {
    const mapTrimStartSlider = document.getElementById('mapTrimStartSlider') as HTMLInputElement;
    const mapTrimEndSlider = document.getElementById('mapTrimEndSlider') as HTMLInputElement;
    const mapTrimStartValue = document.getElementById('mapTrimStartValue') as HTMLInputElement;
    const mapTrimEndValue = document.getElementById('mapTrimEndValue') as HTMLInputElement;

    if (!mapTrimStartSlider || !mapTrimEndSlider || !mapTrimStartValue || !mapTrimEndValue) return;

    // Set initial ranges based on actual lap data
    mapTrimStartSlider.min = '0';
    mapTrimStartSlider.max = (dataLength - MIN_TRIM_WINDOW_SAMPLES).toString();
    mapTrimStartSlider.value = '0';
    mapTrimStartValue.value = '0';
    mapTrimStartValue.min = '0';
    mapTrimStartValue.max = (dataLength - MIN_TRIM_WINDOW_SAMPLES).toString();

    mapTrimEndSlider.min = MIN_TRIM_WINDOW_SAMPLES.toString();
    mapTrimEndSlider.max = (dataLength - 1).toString();
    mapTrimEndSlider.value = (dataLength - 1).toString();
    mapTrimEndValue.value = (dataLength - 1).toString();
    mapTrimEndValue.min = MIN_TRIM_WINDOW_SAMPLES.toString();
    mapTrimEndValue.max = (dataLength - 1).toString();

}

/**
 * Update GPS gate slider visibility based on FIT lap selection
 * The slider is shown when FIT laps are selected and GPS lap mode is enabled
 */
function updateGpsMarkerButtonState() {
    const sliderControls = document.getElementById('gpsGateSliderControls');

    const lapDetectionMode = appState.currentParameters?.auto_lap_detection || 'None';
    const isGpsLapMode = isGpsLapSelectionMode(lapDetectionMode);

    if (!isGpsLapMode) {
        // GPS lap detection is not enabled
        if (sliderControls) sliderControls.style.display = 'none';
        return;
    }

    if (appState.selectedLaps.length > 0) {
        // FIT laps are selected - setup and show slider controls
        void bindGpsDetection(appState, parameterStorage, mapVisualization, {
            getSelectedDataTimeRange,
            findDataIndexAtTimeOffset,
            runGpsLapDetection
        });
    } else {
        // No FIT laps selected - hide slider controls
        if (sliderControls) sliderControls.style.display = 'none';

        // Clear any existing GPS lap detection when FIT laps are deselected
        if (appState.gpsDetectedLaps.length > 0) {
            appState.gpsDetectedLaps = [];
            appState.gpsSelectedLaps = [];
            appState.gpsLapDetectionResult = null;
            mapVisualization?.clearDetectedLaps();
            mapVisualization?.clearGpsMarker();
            updateGpsDetectedLapsUI();
        }
    }
}

function updateSelectedLaps() {
    const checkboxes = document.querySelectorAll('.lap-checkbox:checked') as NodeListOf<HTMLInputElement>;
    appState.selectedLaps = Array.from(checkboxes).map(cb => {
        const item = cb.closest('.lap-checkbox-item');
        return item ? parseInt(item.getAttribute('data-lap') || '0') : 0;
    }).filter(lap => lap > 0);

    // Update map visualization
    if (mapVisualization) {
        mapVisualization.setSelectedLaps(appState.selectedLaps);
    }

    // Update GPS marker button state based on FIT lap selection
    updateGpsMarkerButtonState();

    // Update Out and Back button state based on FIT lap selection
    updateOutAndBackButtonState();

    const lapDetectionMode = appState.currentParameters?.auto_lap_detection || 'None';
    const shouldShowSelectionTrimControls =
        appState.selectedLaps.length > 0
        && !isGpsLapSelectionMode(lapDetectionMode)
        && lapDetectionMode !== 'GPS based out and back';

    // Show/hide trim controls based on lap selection.
    // GPS-based splitting modes have their own selection model, so these
    // FIT-lap trim controls are misleading there and should stay hidden.
    const mapTrimControls = document.getElementById('mapTrimControls');
    if (mapTrimControls) {
        if (shouldShowSelectionTrimControls) {
            mapTrimControls.style.display = 'flex';
            initializeMapTrimControlsForSelectedLaps();

            if (appState.currentParameters?.auto_calculate_rho && !appState.isCalculatingAutoRho) {
                setTimeout(() => {
                    calculateAutoRho(appState, parametersComponent, { appState, showLoading, hideLoading, showError }).catch(err => {
                        log.error('Auto-rho calculation error on lap selection:', err);
                    });
                }, 500);
            }
        } else {
            mapTrimControls.style.display = 'none';
        }
    }

    // Update analyze button in section 3
    updateAnalyzeButton();
}

async function initializeMapTrimControlsForSelectedLaps() {

    if (!appState.currentFitResult || !appState.currentLaps || appState.selectedLaps.length === 0) {
        return;
    }

    // Get selected lap data
    const selectedLapData = appState.selectedLaps.map(lapNumber => appState.currentLaps[lapNumber - 1]);

    // Get data from unified structure (works for both FIT and CSV)
    const fitData = appState.currentFitData || appState.currentFitResult.fit_data;
    if (!fitData) {
        log.error('No fit data available for map trim controls');
        return;
    }

    const allTimestamps = fitData.timestamps;
    const allPositionLat = fitData.position_lat;
    const allPositionLong = fitData.position_long;

    const hasGpsData = appState.currentFitResult.parsing_statistics?.has_gps_data ?? false;

    // Get time ranges for selected laps
    const selectedLapTimeRanges = selectedLapData.map(lap => ({
        start: lap.start_time,
        end: lap.end_time
    }));

    // Filter GPS data for selected laps (if available)
    const filteredLapPositionLat: number[] = [];
    const filteredLapPositionLong: number[] = [];
    const filteredLapTimestamps: number[] = [];

    let dataLength = 0;

    if (hasGpsData && allPositionLat && allPositionLong) {
        for (let i = 0; i < allTimestamps.length; i++) {
            const timestamp = allTimestamps[i];
            const isInSelectedLap = selectedLapTimeRanges.some(range =>
                timestamp >= range.start && timestamp <= range.end
            );
            if (isInSelectedLap) {
                filteredLapPositionLat.push(allPositionLat[i]);
                filteredLapPositionLong.push(allPositionLong[i]);
                filteredLapTimestamps.push(timestamp);
            }
        }
        dataLength = filteredLapPositionLat.length;
    } else {
        // Use timestamp count instead of GPS points
        for (let i = 0; i < allTimestamps.length; i++) {
            const timestamp = allTimestamps[i];
            const isInSelectedLap = selectedLapTimeRanges.some(range =>
                timestamp >= range.start && timestamp <= range.end
            );
            if (isInSelectedLap) {
                filteredLapTimestamps.push(timestamp);
                dataLength++;
            }
        }
    }

    // Store filtered lap data globally for auto-rho calculation
    appState.filteredLapData = {
        position_lat: filteredLapPositionLat,
        position_long: filteredLapPositionLong,
        timestamps: filteredLapTimestamps
    };

    // Initialize the controls with correct data length
    initializeMapTrimControls(dataLength);

    // Try to load saved lap settings for this file and lap combination
    let savedSettings: LapSettings | null = null;
    if (appState.currentFileHash) {
        try {
            savedSettings = await parameterStorage.loadLapSettings(appState.currentFileHash, appState.selectedLaps);
            if (savedSettings) {
                // Use saved trim values
                appState.presetTrimStart = savedSettings.trimStart;
                appState.presetTrimEnd = savedSettings.trimEnd;
            } else {
                // Set preset values to defaults
                appState.presetTrimStart = 0;
                appState.presetTrimEnd = dataLength - 1;
            }
        } catch (err) {
            log.error('Failed to load lap settings:', err);
            // Fallback to defaults
            appState.presetTrimStart = 0;
            appState.presetTrimEnd = dataLength - 1;
        }
    } else {
        // No file hash, use defaults
        appState.presetTrimStart = 0;
        appState.presetTrimEnd = dataLength - 1;
    }

    // Set up event listeners for map trim controls
    const mapTrimStartSlider = document.getElementById('mapTrimStartSlider') as HTMLInputElement;
    const mapTrimEndSlider = document.getElementById('mapTrimEndSlider') as HTMLInputElement;
    const mapTrimStartValue = document.getElementById('mapTrimStartValue') as HTMLInputElement;
    const mapTrimEndValue = document.getElementById('mapTrimEndValue') as HTMLInputElement;

    if (mapTrimStartSlider && mapTrimEndSlider && mapTrimStartValue && mapTrimEndValue) {
        // Remove old listeners by cloning elements
        const newMapTrimStartSlider = mapTrimStartSlider.cloneNode(true) as HTMLInputElement;
        const newMapTrimEndSlider = mapTrimEndSlider.cloneNode(true) as HTMLInputElement;
        const newMapTrimStartValue = mapTrimStartValue.cloneNode(true) as HTMLInputElement;
        const newMapTrimEndValue = mapTrimEndValue.cloneNode(true) as HTMLInputElement;

        mapTrimStartSlider.parentNode?.replaceChild(newMapTrimStartSlider, mapTrimStartSlider);
        mapTrimEndSlider.parentNode?.replaceChild(newMapTrimEndSlider, mapTrimEndSlider);
        mapTrimStartValue.parentNode?.replaceChild(newMapTrimStartValue, mapTrimStartValue);
        mapTrimEndValue.parentNode?.replaceChild(newMapTrimEndValue, mapTrimEndValue);

        // Set slider values to loaded settings (or defaults)
        newMapTrimStartSlider.value = appState.presetTrimStart.toString();
        newMapTrimStartValue.value = appState.presetTrimStart.toString();
        newMapTrimEndSlider.value = appState.presetTrimEnd.toString();
        newMapTrimEndValue.value = appState.presetTrimEnd.toString();

        // Set map markers with loaded/default trim values
        if (mapVisualization && savedSettings && appState.presetTrimStart !== null && appState.presetTrimEnd !== null) {
            log.debug('Setting map trim markers to loaded settings:', { trimStart: appState.presetTrimStart, trimEnd: appState.presetTrimEnd });
            const trimStartVal = appState.presetTrimStart;
            const trimEndVal = appState.presetTrimEnd;
            setTimeout(() => {
                if (mapVisualization) {
                    mapVisualization.fitBoundsToTrimRegion(trimStartVal, trimEndVal, filteredLapPositionLat, filteredLapPositionLong);
                }
            }, 100);
        }

        // Add new listeners
        newMapTrimStartSlider.addEventListener('input', () => {
            const value = parseInt(newMapTrimStartSlider.value);
            newMapTrimStartValue.value = value.toString();
            appState.presetTrimStart = value;

            // Update map markers immediately (before analyze) - use filtered lap GPS data
            if (mapVisualization) {
                const trimEnd = appState.presetTrimEnd ?? dataLength - 1;
                mapVisualization.fitBoundsToTrimRegion(value, trimEnd, filteredLapPositionLat, filteredLapPositionLong);
            }

            // Save map trim settings
            saveMapTrimSettings(appState, parameterStorage);
        });

        newMapTrimEndSlider.addEventListener('input', () => {
            const value = parseInt(newMapTrimEndSlider.value);
            newMapTrimEndValue.value = value.toString();
            appState.presetTrimEnd = value;

            // Update map markers immediately (before analyze) - use filtered lap GPS data
            if (mapVisualization) {
                mapVisualization.fitBoundsToTrimRegion(appState.presetTrimStart, value, filteredLapPositionLat, filteredLapPositionLong);
            }

            // Save map trim settings
            saveMapTrimSettings(appState, parameterStorage);
        });

        newMapTrimStartValue.addEventListener('change', () => {
            const value = parseInt(newMapTrimStartValue.value);
            if (!isNaN(value)) {
                const trimEnd = appState.presetTrimEnd ?? dataLength - 1;
                const clamped = Math.max(0, Math.min(value, trimEnd - MIN_TRIM_WINDOW_SAMPLES));
                newMapTrimStartSlider.value = clamped.toString();
                newMapTrimStartValue.value = clamped.toString();
                appState.presetTrimStart = clamped;

                // Update map markers immediately (before analyze) - use filtered lap GPS data
                if (mapVisualization) {
                    mapVisualization.fitBoundsToTrimRegion(clamped, trimEnd, filteredLapPositionLat, filteredLapPositionLong);
                }

                // Save map trim settings
                saveMapTrimSettings(appState, parameterStorage);
            }
        });

        newMapTrimEndValue.addEventListener('change', () => {
            const value = parseInt(newMapTrimEndValue.value);
            if (!isNaN(value)) {
                const clamped = Math.max(appState.presetTrimStart + MIN_TRIM_WINDOW_SAMPLES, Math.min(value, dataLength - 1));
                newMapTrimEndSlider.value = clamped.toString();
                newMapTrimEndValue.value = clamped.toString();
                appState.presetTrimEnd = clamped;

                // Update map markers immediately (before analyze) - use filtered lap GPS data
                if (mapVisualization) {
                    mapVisualization.fitBoundsToTrimRegion(appState.presetTrimStart, clamped, filteredLapPositionLat, filteredLapPositionLong);
                }

                // Save map trim settings
                saveMapTrimSettings(appState, parameterStorage);
            }
        });

        // Add auto-rho trigger on map trim slider changes (debounced)
        let mapAutoRhoDebounceTimer: ReturnType<typeof setTimeout> | null = null;
        const triggerAutoRhoOnMapTrimChange = () => {
            if (mapAutoRhoDebounceTimer) {
                clearTimeout(mapAutoRhoDebounceTimer);
            }
            mapAutoRhoDebounceTimer = setTimeout(() => {
                if (appState.currentParameters?.auto_calculate_rho && !appState.isCalculatingAutoRho) {
                    calculateAutoRho(appState, parametersComponent, { appState, showLoading, hideLoading, showError }).catch(err => {
                        log.error('Auto-rho calculation error on map trim change:', err);
                    });
                }
            }, 500); // Wait 500ms after last slider change
        };

        newMapTrimStartSlider.addEventListener('input', triggerAutoRhoOnMapTrimChange);
        newMapTrimEndSlider.addEventListener('input', triggerAutoRhoOnMapTrimChange);
        newMapTrimStartValue.addEventListener('change', triggerAutoRhoOnMapTrimChange);
        newMapTrimEndValue.addEventListener('change', triggerAutoRhoOnMapTrimChange);
    }

}

// Analysis parameters initialization
function initializeAnalysisParameters() {
    try {
        parametersComponent = new AnalysisParametersComponent('analysisParameters', handleParametersChange);

        // Initialize appState.currentParameters with the default values from the component
        appState.currentParameters = parametersComponent.getParameters();

        // Update analyze button with the default parameters
        updateAnalyzeButton();
    } catch (error) {
        log.error('Error initializing analysis parameters:', error);
    }
}

function handleParametersChange(parameters: AnalysisParameters) {
    const previousLapDetectionMode = appState.previousAutoLapDetection;
    appState.currentParameters = parameters;

    // Check if auto_lap_detection changed and Section 3 needs to be re-rendered
    const lapDetectionChanged = parameters.auto_lap_detection !== previousLapDetectionMode;
    appState.previousAutoLapDetection = parameters.auto_lap_detection;

    // Don't save if we're currently loading parameters from storage
    if (appState.isLoadingParameters) {
        // Still need to update previous value when loading
        return;
    }

    // If lap detection mode changed, re-initialize Section 3 to show/hide GPS panel
    if (lapDetectionChanged && appState.currentFitData && appState.currentLaps.length > 0) {
        log.debug(`Auto lap detection changed: ${previousLapDetectionMode} -> ${parameters.auto_lap_detection}`);
        // Reset GPS lap detection state when mode changes
        appState.gpsLapDetectionResult = null;
        appState.gpsDetectedLaps = [];
        appState.gpsSelectedLaps = [];
        // Re-initialize Section 3 to show/hide GPS lap detection panel
        initializeSection3();
        // Continue to save parameters below (don't return early)
    }

    // Save parameters to IndexedDB for this file
    if (!appState.currentFileHash) {
        log.error('❌ Cannot save: appState.currentFileHash is null/undefined');
        return;
    }

    if (!appState.selectedFile) {
        log.error('❌ Cannot save: appState.selectedFile is null/undefined');
        return;
    }

    parameterStorage.saveParameters(appState.currentFileHash, parameters, appState.selectedFile.name)
        .then(() => {
        })
        .catch(err => {
            log.error('❌ Failed to save parameters:', err);
        });

    // Update wind indicator on map if wind parameters are set
    if (mapVisualization && appState.currentParameters) {
        if (appState.currentParameters.wind_speed !== null && appState.currentParameters.wind_speed !== undefined &&
            appState.currentParameters.wind_direction !== null && appState.currentParameters.wind_direction !== undefined) {
            mapVisualization.showWindIndicator(
                appState.currentParameters.wind_speed,
                appState.currentParameters.wind_direction,
                appState.currentParameters.wind_speed_unit
            );
        } else {
            mapVisualization.hideWindIndicator();
        }
    }

    // Trigger auto-rho calculation if checkbox was just enabled
    // or if auto-calculate is already enabled (parameters changed)
    // BUT skip if we're already calculating (prevents infinite loop)
    if (parameters.auto_calculate_rho && appState.currentFitData && !appState.isCalculatingAutoRho) {
        // Small delay to ensure UI is updated
        setTimeout(() => {
            calculateAutoRho(appState, parametersComponent, { appState, showLoading, hideLoading, showError }).catch(err => {
                log.error('Auto-rho calculation error:', err);
            });
        }, 100);
    }

    // If VE analysis is already visible, recalculate when parameters change
    const veSection = document.getElementById('veSection');
    if (veSection && !veSection.classList.contains('hidden')) {
        // Get the current sliders and data for recalculation
        const cdaSlider = document.getElementById('cdaSlider') as HTMLInputElement;
        const crrSlider = document.getElementById('crrSlider') as HTMLInputElement;
        const trimStartSlider = document.getElementById('trimStartSlider') as HTMLInputElement;
        const trimEndSlider = document.getElementById('trimEndSlider') as HTMLInputElement;

        if (cdaSlider && crrSlider && trimStartSlider && trimEndSlider) {
            // trimStart and trimEnd are read from sliders but dispatch triggers recalc
            // const trimStart = parseInt(trimStartSlider.value);
            // const trimEnd = parseInt(trimEndSlider.value);

            // Need to get the data arrays - they should be in scope from the initial analysis
            // Trigger a recalculation by simulating a slider change
            trimStartSlider.dispatchEvent(new Event('input', { bubbles: true }));
        }
    }

    // Update analyze button state
    updateAnalyzeButton();
}

// Initialize Section 3: Map Analysis & Lap Selection
function initializeSection3() {
    const analysisSection = document.getElementById('analysisSection');
    const fitData = appState.currentFitData;
    const laps = appState.currentLaps;
    if (!analysisSection || !fitData || !laps.length) return;

    const hasGpsData = appState.currentFitResult?.parsing_statistics?.has_gps_data ?? false;
    const lapDetectionMode = appState.currentParameters?.auto_lap_detection || 'None';
    const showGpsLapDetection = hasGpsData && isGpsLapSelectionMode(lapDetectionMode);
    const showOutAndBack = hasGpsData && lapDetectionMode === 'GPS based out and back';

    // Generate Section 3 HTML using the shell template helper
    const analysisHtml = renderSection3Template({
        laps,
        hasGpsData,
        showGpsLapDetection,
        showOutAndBack,
        formatDuration,
        formatDistance,
        formatPower,
    });

    const resultsDiv = analysisSection.querySelector('#results');
    if (resultsDiv) {
        resultsDiv.innerHTML = analysisHtml;
        resultsDiv.classList.remove('hidden');
    }

    // Initialize map visualization only if GPS data is available
    setTimeout(async () => {
        try {
            if (hasGpsData) {
                mapVisualization = new MapVisualization('mapView');
                await mapVisualization.initialize();
                mapVisualization.setData(fitData, laps);
                log.debug('Map initialized with GPS data');

                // Setup GPS lap detection if enabled
                if (showGpsLapDetection) {
                    void bindGpsDetection(appState, parameterStorage, mapVisualization, {
                        getSelectedDataTimeRange,
                        findDataIndexAtTimeOffset,
                        runGpsLapDetection
                    });
                }

                // Setup Out and Back detection if enabled
                if (showOutAndBack) {
                    void bindOutAndBackDetection(appState, parameterStorage, mapVisualization, {
                        getSelectedDataTimeRange,
                        findDataIndexAtTimeOffset,
                        runOutAndBackDetection
                    });
                }
            } else {
                log.debug('No GPS data - skipping map initialization');
            }

            // Setup lap selection handlers using shell helpers
            const lapListEl = document.getElementById('lapList');
            if (lapListEl) {
                bindLapSelection(lapListEl, () => updateSelectedLaps());
                bindSelectAllButton('selectAllLaps', 'lapList', () => updateSelectedLaps());
            }
            setupAnalyzeButton();

            log.debug('Section 3 initialized (GPS:', hasGpsData, ', GPS Lap Detection:', showGpsLapDetection, ', Out and Back:', showOutAndBack, ')');
        } catch (error) {
            log.error('Error initializing section 3:', error);
        }
    }, 100);
}

// Setup analyze button functionality
function setupAnalyzeButton() {
    const analyzeBtn = document.getElementById('analyzeBtn');
    if (analyzeBtn) {
        analyzeBtn.addEventListener('click', handleAnalyze);
    }
}

function updateAnalyzeButton() {
    const analyzeBtn = document.getElementById('analyzeBtn') as HTMLButtonElement;
    if (analyzeBtn) {
        const lapDetectionMode = appState.currentParameters?.auto_lap_detection || 'None';
        const isGpsLapMode = isGpsLapSelectionMode(lapDetectionMode);
        const isOutAndBackMode = lapDetectionMode === 'GPS based out and back';

        // Check which lap/section selection to use
        let hasSelectedLaps: boolean;
        let lapCount: number;
        let hasDetectedItems: boolean;

        if (isOutAndBackMode) {
            hasSelectedLaps = appState.outAndBackSelectedSections.length > 0;
            lapCount = appState.outAndBackSelectedSections.length;
            hasDetectedItems = appState.outAndBackSections.length > 0;
        } else if (isGpsLapMode) {
            hasSelectedLaps = appState.gpsSelectedLaps.length > 0;
            lapCount = appState.gpsSelectedLaps.length;
            hasDetectedItems = appState.gpsDetectedLaps.length > 0;
        } else {
            hasSelectedLaps = appState.selectedLaps.length > 0;
            lapCount = appState.selectedLaps.length;
            hasDetectedItems = true;
        }

        const hasValidParameters = parametersComponent ? parametersComponent.isValid() : false;

        analyzeBtn.disabled = !hasSelectedLaps || !hasValidParameters || !hasDetectedItems;

        if (isOutAndBackMode && appState.outAndBackSections.length === 0) {
            analyzeBtn.textContent = 'Set GPS Gates to Detect Sections';
        } else if (isGpsLapMode && appState.gpsDetectedLaps.length === 0) {
            analyzeBtn.textContent = 'Set GPS Gate to Detect Laps';
        } else if (!hasSelectedLaps) {
            analyzeBtn.textContent = isOutAndBackMode ? 'Select Sections to Analyze' : 'Select Laps to Analyze';
        } else if (!hasValidParameters) {
            analyzeBtn.textContent = 'Check Parameters Above';
        } else {
            if (isOutAndBackMode) {
                analyzeBtn.textContent = `Analyze ${lapCount} Selected Section${lapCount > 1 ? 's' : ''}`;
            } else {
                analyzeBtn.textContent = `Analyze ${lapCount} Selected Lap${lapCount > 1 ? 's' : ''}`;
            }
        }
    }
}

async function handleAnalyze() {
    const lapDetectionMode = appState.currentParameters?.auto_lap_detection || 'None';
    const modeHandler = getAnalysisModeHandler(lapDetectionMode);
    const selection = modeHandler.prepareSelection(appState);

    if (!appState.currentParameters || selection.selectedItems.length === 0) {
        alert(selection.emptySelectionMessage);
        return;
    }

    if (!appState.currentFitData) {
        alert('No FIT data available for analysis.');
        return;
    }

    const validationMessage = modeHandler.validate(appState);
    if (validationMessage) {
        alert(validationMessage);
        return;
    }

    // Note: Auto-rho will be triggered AFTER VE analysis when trim sliders are created
    // (trim sliders don't exist yet at this point)
    try {
        showLoading('Preparing data for Virtual Elevation analysis...');

        if (selection.mode === 'outAndBack') {
            log.debug('Out and Back mode - selected sections:', selection.outAndBackSections);
        } else if (selection.mode === 'gpsLap') {
            log.debug('GPS lap mode - selected lap index ranges:', selection.indexRanges);
        } else {
            log.debug('Normal mode - selected lap data:', selection.selectedEntries);
        }

        log.debug('appState.currentFitResult structure:', appState.currentFitResult);
        log.debug('appState.currentFitResult keys:', appState.currentFitResult ? Object.keys(appState.currentFitResult) : 'null');

        if (!appState.currentFitResult) {
            throw new Error('No data available for analysis');
        }

        const fitData = appState.currentFitData || appState.currentFitResult.fit_data;
        if (!fitData) {
            throw new Error('No analysis data available');
        }

        const normalizedArrays = getNormalizedActivityArrays(fitData);
        const hasWindYaw = normalizedArrays.windYaw.some((yaw: number) => !isNaN(yaw) && yaw !== 0);
        const initialWindResolution = resolveWindSeries({
            fitData,
            windSource: 'fit',
            applyOffset: false,
        });

        if (initialWindResolution.dataSource === 'air_speed') {
            log.debug('🌬️ Found air speed data, using it as apparent wind speed');
        } else if (initialWindResolution.dataSource === 'wind_speed') {
            if (hasWindYaw) {
                log.debug('🌬️ Found wind speed with yaw, triangulating for apparent wind speed');
            } else {
                log.debug('🌬️ Found wind speed without yaw, using it as apparent wind speed');
            }
        } else {
            log.debug('🌬️ No air/wind speed data found, using constant wind as source');
        }

        const hasRoadSpeed = normalizedArrays.roadSpeed.some((v: number) => !isNaN(v) && v !== 0);
        const hasEnhancedSpeed = normalizedArrays.velocity.some((v: number) => !isNaN(v) && v !== 0);
        if (hasRoadSpeed && hasEnhancedSpeed) {
            log.debug('🚴 Found enhanced speed and road speed, prefer road speed');
        }

        showLoading('Running Virtual Elevation calculation...');

        const hasEnvironmentalData = !!(fitData.temperature && fitData.humidity && fitData.pressure);
        const payload = prepareAnalysisPayload({
            fitData,
            selection,
            params: appState.currentParameters,
            cda: appState.currentParameters.cda,
            crr: appState.currentParameters.crr,
            getNormalizedActivityArrays,
            calculateRhoArray: (fd) => {
                const currentNormalized = getNormalizedActivityArrays(fd);
                const hasAirDensityData = currentNormalized.airDensity.some(rho => !isNaN(rho) && rho > 0);
                if (hasAirDensityData) {
                    log.debug('💨 Found air density data, using it for calculations');
                    return currentNormalized.airDensity;
                }

                if (hasEnvironmentalData) {
                    const calculated = calculateRhoArrayFromFitData(fd);
                    if (calculated) {
                        log.debug('💨 Calculated air density from environmental data');
                    }
                    return calculated;
                }

                log.debug('💨 No air density found, using constant value from weather API');
                return null;
            },
        });

        const powerDataPoints = payload.filteredData.power.filter((p) => p > 0).length;
        if (powerDataPoints < payload.filteredData.timestamps.length * 0.5) {
            log.warn(`Only ${powerDataPoints}/${payload.filteredData.timestamps.length} records have power data`);
        }

        hideLoading();

        appState.currentRhoArray = payload.rhoArray;
        appState.currentVEResult = payload.initialResult;
        appState.filteredVEData = {
            positionLat: payload.filteredData.positionLat,
            positionLong: payload.filteredData.positionLong,
        };

        modeHandler.syncState(appState, selection);

        const callbacks = createModeRenderCallbacks({
            standard: (args) =>
                showVirtualElevationAnalysisInline(
                    appState,
                    parameterStorage,
                    parametersComponent,
                    { appState, showLoading, hideLoading, showError },
                    mapVisualization,
                    {
                        onSaveScreenshot: () => { void handleSaveScreenshot(appState, resultsStorage); },
                        onStoreResult: () => { void handleStoreResult(appState, resultsStorage); },
                        onExportAll: () => { void handleExportAllResults(resultsStorage); },
                        saveCurrentLapSettings: () => { void saveCurrentLapSettings(appState, parameterStorage); }
                    },
                    args.initialResult,
                    args.analyzedLaps,
                    args.timestamps,
                    args.power,
                    args.velocity,
                    args.positionLat,
                    args.positionLong,
                    args.altitude,
                    args.distance,
                    args.windSpeed,
                    args.temperature,
                    args.cdaReference,
                    args.defaultAirSpeedOffset,
                ),
            gpsLap: ({ lapIndexRanges, fitData, params, defaultAirSpeedOffset }) =>
                showGpsLapVEAnalysis(
                    { appState, showLoading, hideLoading, showError },
                    parameterStorage,
                    resultsStorage,
                    waitForPlotly,
                    lapIndexRanges,
                    fitData,
                    params,
                    defaultAirSpeedOffset,
                ),
            outAndBack: ({ sections, fitData, params, defaultAirSpeedOffset }) =>
                showOutAndBackVEAnalysis(
                    { appState, showLoading, hideLoading, showError },
                    parameterStorage,
                    resultsStorage,
                    sections,
                    fitData,
                    params,
                    defaultAirSpeedOffset,
                    waitForPlotly,
                ),
        });

        await modeHandler.render({
            appState,
            selection,
            fitData,
            params: appState.currentParameters,
            defaultAirSpeedOffset: payload.defaultAirSpeedOffset,
            initialResult: payload.initialResult,
            filteredData: payload.filteredData,
            callbacks,
        });
    } catch (err) {
        log.error('Virtual Elevation analysis failed:', err);
        hideLoading();
        const errorMessage = err instanceof Error ? err.message : 'Unknown error';
        showError(`Virtual Elevation analysis failed: ${errorMessage}`);
    }
}



// Clear saved parameters and results button
clearStorageButton.addEventListener('click', async () => {
    if (confirm('Are you sure you want to clear all saved parameters, results, AND weather cache? This cannot be undone.')) {
        try {
            await parameterStorage.clearAll();
            await resultsStorage.clearAllResults();

            // Also clear weather cache
            const weatherCacheInstance = new WeatherCache();
            await weatherCacheInstance.clearCache();

            alert('All saved parameters, results, and weather cache have been cleared.');
        } catch (err) {
            log.error('Failed to clear storage:', err);
            alert('Failed to clear storage. Please try again.');
        }
    }
});

// Clean up on page unload
window.addEventListener('beforeunload', () => {
    if (mapVisualization) {
        mapVisualization.destroy();
    }
});
