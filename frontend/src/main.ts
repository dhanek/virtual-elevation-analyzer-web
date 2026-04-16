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
    type OutAndBackSection,
    getDefaultLapDetectionConfig,
    DEFAULT_OUT_AND_BACK_CONFIG,
    formatLapDuration,
    formatLapDistance
} from './utils/GpsLapDetection';
import { AppState } from './state/AppState';
import { createFitLoadedActivity, loadCsvActivity } from './activity/ActivityLoader';
import {
    AIR_SPEED_CALIBRATION_MAX_PERCENT,
    AIR_SPEED_CALIBRATION_MIN_PERCENT,
    AIR_SPEED_CALIBRATION_STEP_PERCENT,
    calculateAutoAirSpeedCalibrationPercent,
    clampAirSpeedCalibrationPercent,
    formatAirSpeedCalibrationPercent,
} from './analysis/AirSpeedCalibration';
import { getNormalizedActivityArrays } from './analysis/ActivityArrayCache';
import {
    buildSegmentSupplementarySeries,
    type SegmentSupplementarySeries,
} from './analysis/SegmentSupplementarySeries';
import { resolveMultiSegmentSettings } from './analysis/MultiSegmentSettings';
import { extractSegmentData } from './analysis/SegmentExtractor';
import { createVeCalculator } from './analysis/VeCalculatorFactory';
import { resolveWindSeries } from './analysis/WindSourceResolver';
import {
    buildMultiSegmentPowerFigure,
    buildMultiSegmentVirtualDistanceFigure,
    buildMultiSegmentWindFigure,
} from './plots/MultiSegmentPlotBuilders';
import { getAnalysisModeHandler } from './modes/analysis/AnalysisModes';
import { prepareAnalysisPayload } from './shell/analysis/prepareAnalysisPayload'
import { createModeRenderCallbacks } from './shell/analysis/renderDelegates'
import init, { AirDensityCalculator } from '../pkg/virtual_elevation_analyzer.js';
import { getSelectedWindSource, bindWindSourceRadios } from './shell/dom/windSource'
import { setupTabSwitching } from './shell/dom/tabs'
import { bindActionFooter } from './shell/dom/actionFooter'
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

function buildAutoCalibrationSegmentsFromRanges(
    indexRanges: Array<{ startIdx: number; endIdx: number }>,
) {
    if (!appState.currentFitData) {
        return [];
    }

    const normalizedArrays = getNormalizedActivityArrays(appState.currentFitData);
    const uncalibratedWindSpeed = resolveWindSeries({
        fitData: appState.currentFitData,
        windSource: 'fit',
        applyOffset: false,
        airSpeedCalibrationPercent: 0,
    }).windSpeed;

    return indexRanges
        .map(range => extractSegmentData({
            startIdx: range.startIdx,
            endIdx: range.endIdx,
            allTimestamps: normalizedArrays.timestamps,
            allPower: normalizedArrays.power,
            allVelocity: normalizedArrays.velocity,
            allPositionLat: normalizedArrays.positionLat,
            allPositionLong: normalizedArrays.positionLong,
            allAltitude: normalizedArrays.altitude,
            allDistance: normalizedArrays.distance,
            allWindSpeed: uncalibratedWindSpeed,
        }))
        .filter(segment => segment.timestamps.length > 1)
        .map(segment => ({
            timestamps: segment.timestamps,
            groundSpeed: segment.velocity,
            apparentSpeed: segment.windSpeed,
        }));
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
            saveMapTrimSettings();
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
            saveMapTrimSettings();
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
                saveMapTrimSettings();
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
                saveMapTrimSettings();
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
                showGpsLapVEAnalysis(lapIndexRanges, fitData, params, defaultAirSpeedOffset),
            outAndBack: ({ sections, fitData, params, defaultAirSpeedOffset }) =>
                showOutAndBackVEAnalysis(sections, fitData, params, defaultAirSpeedOffset),
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

// ==================== GPS Lap VE Analysis ====================

const MULTI_SEGMENT_COLORS = [
    '#4363d8',
    '#e6194b',
    '#3cb44b',
    '#f58231',
    '#911eb4',
    '#46f0f0',
    '#f032e6',
    '#bcf60c',
];

interface LapVEProfile {
    lapNumber: number;
    distances: number[];      // km, relative to gate crossing (starting at 0)
    virtualElevation: number[];
    actualElevation: number[];
    supplementarySeries: SegmentSupplementarySeries;
    duration: number;         // seconds
    totalDistance: number;    // km
}

/**
 * Calculate VE for each GPS-detected lap and show stacked plot
 */
async function showGpsLapVEAnalysis(
    lapIndexRanges: Array<{ startIdx: number; endIdx: number }>,
    fitData: any,
    params: AnalysisParameters,
    defaultAirSpeedOffset: number,
    reuseCurrentSettings: boolean = false,
) {
    showLoading('Calculating VE for each lap...');

    const analyzedLapNumbers = lapIndexRanges.map((range, index) =>
        getGpsLapNumberForRange(range, index + 1),
    );
    const resolvedParams = await resolveMultiSegmentAnalysisParams(
        analyzedLapNumbers,
        params,
        reuseCurrentSettings,
    );
    const lapVEProfiles: LapVEProfile[] = [];

    const normalizedArrays = getNormalizedActivityArrays(fitData);
    const allTimestamps = normalizedArrays.timestamps;
    const allPower = normalizedArrays.power;
    const allVelocity = normalizedArrays.velocity;
    const allPositionLat = normalizedArrays.positionLat;
    const allPositionLong = normalizedArrays.positionLong;
    const allAltitude = normalizedArrays.altitude;
    const allDistance = normalizedArrays.distance;

    // Handle wind/air speed
    const gpsLapWindResolution = resolveWindSeries({
        fitData,
        windSource: getSelectedWindSource(),
        params: resolvedParams,
        airSpeedCalibrationPercent: appState.airSpeedCalibrationPercent,
    });
    const {
        hasAirSpeed,
        hasWindSpeed,
        defaultAirSpeedOffset: defaultOffset,
        windSpeed: allWindSpeed,
    } = gpsLapWindResolution;
    const windSpeedOffset = resolvedParams.air_speed_offset ?? defaultOffset;

    if (gpsLapWindResolution.selectedWindSource === 'constant') {
        log.debug('GPS Lap VE: Using constant wind settings');
    } else if (gpsLapWindResolution.dataSource === 'air_speed') {
        log.debug(`GPS Lap VE: Using FIT air speed data (offset: ${windSpeedOffset}s, calibration: ${appState.airSpeedCalibrationPercent}%)`);
    } else if (gpsLapWindResolution.dataSource === 'wind_speed') {
        log.debug(`GPS Lap VE: Using FIT wind speed data (offset: ${windSpeedOffset}s, calibration: ${appState.airSpeedCalibrationPercent}%)`);
    } else {
        log.debug('GPS Lap VE: No wind data available');
    }

    // Get CdA and Crr values
    const cda = resolvedParams.cda ?? 0.3;
    const crr = resolvedParams.crr ?? 0.008;

    // Calculate VE for each lap
    for (let lapIdx = 0; lapIdx < lapIndexRanges.length; lapIdx++) {
        const range = lapIndexRanges[lapIdx];
        const lapNumber = analyzedLapNumbers[lapIdx] ?? (lapIdx + 1);

        // Extract data for this lap
        const lapTimestamps: number[] = [];
        const lapPower: number[] = [];
        const lapVelocity: number[] = [];
        const lapPositionLat: number[] = [];
        const lapPositionLong: number[] = [];
        const lapAltitude: number[] = [];
        const lapDistance: number[] = [];
        const lapWindSpeed: number[] = [];

        for (let i = range.startIdx; i <= range.endIdx && i < allTimestamps.length; i++) {
            lapTimestamps.push(allTimestamps[i]);
            lapPower.push(allPower[i]);
            lapVelocity.push(allVelocity[i]);
            lapPositionLat.push(allPositionLat[i]);
            lapPositionLong.push(allPositionLong[i]);
            lapAltitude.push(allAltitude[i]);
            lapDistance.push(allDistance[i]);
            lapWindSpeed.push(allWindSpeed[i]);
        }

        if (lapTimestamps.length < 10) {
            log.warn(`Lap ${lapNumber} has too few data points (${lapTimestamps.length}), skipping`);
            continue;
        }

        const supplementarySeries = buildSegmentSupplementarySeries({
            timestamps: lapTimestamps,
            power: lapPower,
            velocity: lapVelocity,
            positionLat: lapPositionLat,
            positionLong: lapPositionLong,
            distance: lapDistance,
            windSpeed: lapWindSpeed,
            params: resolvedParams,
            selectedWindSource: gpsLapWindResolution.selectedWindSource,
        });
        const relativeDistances = supplementarySeries.distancesKm;

        // Calculate duration
        const duration = lapTimestamps[lapTimestamps.length - 1] - lapTimestamps[0];
        const totalDistance = relativeDistances[relativeDistances.length - 1] ?? 0;

        try {
            const calculator = createVeCalculator({
                timestamps: lapTimestamps,
                power: lapPower,
                velocity: lapVelocity,
                positionLat: lapPositionLat,
                positionLong: lapPositionLong,
                altitude: lapAltitude,
                distance: lapDistance,
                windSpeed: lapWindSpeed,
                params: resolvedParams,
                cda,
                crr,
            });

            // Calculate VE for full lap
            const result = calculator.calculate_virtual_elevation(cda, crr, 0, lapTimestamps.length - 1);

            // Extract VE values
            const veArray = Array.from(result.virtual_elevation as Float64Array);

            // Get actual elevation (use zeros for velodrome mode)
            const actualElevation = resolvedParams.velodrome
                ? new Array(lapAltitude.length).fill(0)
                : lapAltitude;

            lapVEProfiles.push({
                lapNumber,
                distances: relativeDistances,
                virtualElevation: veArray,
                actualElevation: actualElevation,
                supplementarySeries,
                duration,
                totalDistance
            });

            log.debug(`Lap ${lapNumber}: ${totalDistance.toFixed(2)} km, ${duration.toFixed(0)}s, ${veArray.length} points`);

        } catch (err) {
            log.error(`Failed to calculate VE for lap ${lapNumber}:`, err);
        }
    }

    hideLoading();

    if (lapVEProfiles.length === 0) {
        showError('No valid laps to analyze');
        return;
    }

    // Calculate mean actual elevation profile
    const meanElevationProfile = calculateMeanElevationProfile(lapVEProfiles);

    // Check for constant wind settings
    const hasConstantWind = resolvedParams.wind_speed !== undefined && resolvedParams.wind_speed !== 0 &&
                            resolvedParams.wind_direction !== undefined;

    // Preserve current wind source selection if UI exists (for recalculations)
    const preservedWindSource = getSelectedWindSource();

    // Show the GPS lap VE analysis interface with wind data info
    showGpsLapVEPlot(lapVEProfiles, meanElevationProfile, resolvedParams, hasAirSpeed || hasWindSpeed, hasConstantWind, defaultAirSpeedOffset, preservedWindSource);
}

/**
 * Calculate mean actual elevation profile across all laps
 */
function calculateMeanElevationProfile(lapProfiles: LapVEProfile[]): { distances: number[]; elevation: number[] } {
    if (lapProfiles.length === 0) {
        return { distances: [], elevation: [] };
    }

    // Find maximum lap distance
    let maxDistance = 0;
    for (const lap of lapProfiles) {
        const lapMax = lap.distances[lap.distances.length - 1];
        if (lapMax > maxDistance) maxDistance = lapMax;
    }

    // Create reference distance array with ~10m intervals
    const numPoints = Math.max(100, Math.floor(maxDistance * 100)); // 10m resolution
    const referenceDistances: number[] = [];
    for (let i = 0; i <= numPoints; i++) {
        referenceDistances.push((i / numPoints) * maxDistance);
    }

    // Accumulate elevation values
    const elevationSum = new Array(referenceDistances.length).fill(0);
    const elevationCount = new Array(referenceDistances.length).fill(0);

    for (const lap of lapProfiles) {
        // Interpolate this lap's elevation onto the reference distances
        for (let i = 0; i < referenceDistances.length; i++) {
            const targetDist = referenceDistances[i];

            // Only interpolate within this lap's range
            if (targetDist > lap.distances[lap.distances.length - 1]) continue;

            // Find bracketing points
            let lowIdx = 0;
            for (let j = 0; j < lap.distances.length - 1; j++) {
                if (lap.distances[j] <= targetDist && lap.distances[j + 1] >= targetDist) {
                    lowIdx = j;
                    break;
                }
            }

            // Linear interpolation
            const d0 = lap.distances[lowIdx];
            const d1 = lap.distances[lowIdx + 1] || d0;
            const e0 = lap.actualElevation[lowIdx];
            const e1 = lap.actualElevation[lowIdx + 1] || e0;

            const t = (d1 !== d0) ? (targetDist - d0) / (d1 - d0) : 0;
            const interpolatedElevation = e0 + t * (e1 - e0);

            if (!isNaN(interpolatedElevation)) {
                elevationSum[i] += interpolatedElevation;
                elevationCount[i]++;
            }
        }
    }

    // Calculate mean
    const meanElevation: number[] = [];
    for (let i = 0; i < referenceDistances.length; i++) {
        if (elevationCount[i] > 0) {
            meanElevation.push(elevationSum[i] / elevationCount[i]);
        } else {
            // Use previous value or 0
            meanElevation.push(meanElevation.length > 0 ? meanElevation[meanElevation.length - 1] : 0);
        }
    }

    return { distances: referenceDistances, elevation: meanElevation };
}

/**
 * Show the GPS lap VE stacked plot with full controls (matching normal mode)
 */
async function showGpsLapVEPlot(
    lapProfiles: LapVEProfile[],
    meanElevation: { distances: number[]; elevation: number[] },
    params: AnalysisParameters,
    hasWindSpeed: boolean,
    hasConstantWind: boolean,
    defaultAirSpeedOffset: number,
    preservedWindSource: string | null = null
) {
    const selectedWindSource = preservedWindSource || (hasWindSpeed ? 'fit' : 'constant');
    const effectiveWindSource = selectedWindSource === 'compare' ? 'fit' : selectedWindSource;
    const showWindTab = hasWindSpeed || hasConstantWind;
    const showFitWindControls = hasWindSpeed && effectiveWindSource === 'fit';
    const showVirtualDistanceTab = showFitWindControls;
    // Ensure Plotly is loaded (side effect only; Plotly is accessed via the
    // global in downstream helpers).
    await waitForPlotly();

    // Show the VE analysis section
    const veSection = document.getElementById('veAnalysisSection') as HTMLElement;
    if (veSection) {
        veSection.classList.remove('hidden', 'inactive');
    }

    const veAnalysisContent = document.getElementById('veAnalysisContent') as HTMLElement;
    if (!veAnalysisContent) {
        log.error('VE analysis content container not found');
        return;
    }

    // Calculate initial statistics
    const initialStats = calculateGpsLapStats(lapProfiles, meanElevation);
    const currentAirSpeedCalibrationValue = formatAirSpeedCalibrationPercent(appState.airSpeedCalibrationPercent);

    // Create full interface with controls sidebar for GPS lap mode (matching normal mode)
    veAnalysisContent.innerHTML = `
        <div class="ve-inline-container">
            <div class="ve-layout">
                <!-- Controls Sidebar -->
                <div class="ve-controls-sidebar">
                    <div class="ve-controls-scrollable">
                        <div class="ve-controls">
                            <h4>Analysis Parameters</h4>
                            <div class="ve-control-grid">
                                <div class="ve-control-group">
                                    <label>CdA (Drag Coefficient × Area):</label>
                                    <input type="range" id="cdaSlider" min="${params.cda_min}" max="${params.cda_max}" value="${params.cda || 0.3}" step="0.001" class="ve-slider">
                                    <input type="number" id="cdaValue" value="${(params.cda || 0.3).toFixed(3)}" min="${params.cda_min}" max="${params.cda_max}" step="0.001" class="ve-value-input">
                                </div>
                                <div class="ve-control-group">
                                    <label>Crr (Rolling Resistance):</label>
                                    <input type="range" id="crrSlider" min="${params.crr_min}" max="${params.crr_max}" value="${params.crr || 0.008}" step="0.0001" class="ve-slider">
                                    <input type="number" id="crrValue" value="${(params.crr || 0.008).toFixed(4)}" min="${params.crr_min}" max="${params.crr_max}" step="0.0001" class="ve-value-input">
                                </div>
                            </div>

                            ${(hasWindSpeed || hasConstantWind) ? `
                            <div class="ve-wind-source">
                                <h4>Wind Source</h4>
                                <div class="ve-radio-group">
                                    <label class="ve-radio-label">
                                        <input type="radio" name="windSource" value="constant" ${selectedWindSource === 'constant' ? 'checked' : ''}>
                                        <span>Use constant wind settings</span>
                                    </label>
                                    ${hasWindSpeed ? `
                                    <label class="ve-radio-label">
                                        <input type="radio" name="windSource" value="fit" ${selectedWindSource === 'fit' ? 'checked' : ''}>
                                        <span>Use FIT file wind data</span>
                                    </label>
                                    <label class="ve-radio-label">
                                        <input type="radio" name="windSource" value="compare" ${selectedWindSource === 'compare' ? 'checked' : ''}>
                                        <span>Compare both methods</span>
                                    </label>
                                    ` : ''}
                                </div>
                            </div>
                            ` : ''}

                            ${hasWindSpeed ? `
                            <div class="ve-parameter">
                                <div class="ve-param-header">
                                    <label for="airSpeedCalibration">Air Speed Calibration</label>
                                    <input type="number" id="airSpeedCalibrationValue" value="${currentAirSpeedCalibrationValue}" step="${AIR_SPEED_CALIBRATION_STEP_PERCENT}" min="${AIR_SPEED_CALIBRATION_MIN_PERCENT.toFixed(1)}" max="${AIR_SPEED_CALIBRATION_MAX_PERCENT.toFixed(1)}"
                                           style="width: 60px; text-align: right;" />
                                    <span>%</span>
                                </div>
                                <input type="range" id="airSpeedCalibrationSlider" min="${AIR_SPEED_CALIBRATION_MIN_PERCENT.toFixed(1)}" max="${AIR_SPEED_CALIBRATION_MAX_PERCENT.toFixed(1)}" step="${AIR_SPEED_CALIBRATION_STEP_PERCENT}" value="${currentAirSpeedCalibrationValue}" />
                                <button id="autoAdjustCalibration" class="secondary-btn" style="width: 100%; margin-top: 0.5rem;">Auto Adjust</button>
                            </div>
                            ` : ''}
                        </div>
                    </div>

                    <div class="ve-sidebar-footer">
                        <button id="saveScreenshot" class="primary-btn" style="width: 100%; margin-bottom: 0.5rem;">Save Screenshot</button>
                        <button id="storeResult" class="primary-btn" style="width: 100%; margin-bottom: 0.5rem;">Store Result</button>
                        <button id="exportAllResults" class="secondary-btn" style="width: 100%; font-size: 0.9rem;">Export All Results to CSV</button>
                    </div>
                </div>

                <!-- Plots Main Area -->
                <div class="ve-plots-main">
                    <div class="ve-plots">
                        <div class="ve-tabs">
                            <button class="ve-tab-button active" data-tab="ve">VE</button>
                            ${showWindTab ? `
                            <button class="ve-tab-button" data-tab="wind">Wind</button>
                            ` : ''}
                            <button class="ve-tab-button" data-tab="power">Power</button>
                            ${showVirtualDistanceTab ? `
                            <button class="ve-tab-button" data-tab="vd">VD</button>
                            ` : ''}
                        </div>

                        <div class="ve-tab-content active" id="ve-tab">
                            <div class="ve-metrics-compact">
                                Mean R²:<span id="gpsLapR2Value">${initialStats.meanR2.toFixed(4)}</span> |
                                Mean RMSE:<span id="gpsLapRmseValue">${initialStats.meanRMSE.toFixed(2)}m</span> |
                                Closing Error:<span id="gpsLapClosingErrorValue">${initialStats.closingError.toFixed(2)}m</span> |
                                Laps:<span id="gpsLapCountValue">${lapProfiles.length}</span>
                            </div>
                            <div class="ve-plot-container">
                                <div id="gpsLapVePlot" style="width: 100%; height: 380px;"></div>
                            </div>
                            <div class="ve-plot-container">
                                <div id="gpsLapResidualPlot" style="width: 100%; height: 200px;"></div>
                            </div>
                            <div class="ve-lap-summary" style="margin-top: 1rem; padding: 1rem; background: #f7fafc; border-radius: 4px;">
                                <h4 style="margin-bottom: 0.5rem;">Detected Laps Summary</h4>
                                <div id="gpsLapSummaryTable"></div>
                            </div>
                        </div>

                        ${showWindTab ? `
                        <div class="ve-tab-content" id="wind-tab">
                            <div id="gpsLapWindPlot" class="ve-plot" style="height: 600px;"></div>
                            ${showFitWindControls ? `
                            <div class="ve-parameter" style="margin-top: 1.5rem; padding: 1rem; border: 1px solid #ddd; border-radius: 4px; background: #f9f9f9;">
                                <h4 style="margin: 0 0 1rem 0; font-size: 1rem; font-weight: 500;">Air Speed Time Offset</h4>
                                <div style="display: grid; grid-template-columns: 1fr auto auto; gap: 0.5rem; align-items: center; margin-bottom: 0.5rem;">
                                    <input type="range" id="airSpeedOffsetSlider" min="-10" max="10" step="1" value="${params?.air_speed_offset ?? defaultAirSpeedOffset}"
                                           style="width: 100%;" />
                                    <input type="number" id="airSpeedOffsetValue" value="${params?.air_speed_offset ?? defaultAirSpeedOffset}" step="1" min="-10" max="10"
                                           style="width: 60px; text-align: right;" />
                                    <span style="font-weight: 500;">seconds</span>
                                </div>
                            </div>
                            ` : ''}
                        </div>
                        ` : ''}

                        <div class="ve-tab-content" id="power-tab">
                            <div id="gpsLapPowerPlot" class="ve-plot" style="height: 600px;"></div>
                        </div>

                        ${showVirtualDistanceTab ? `
                        <div class="ve-tab-content" id="vd-tab">
                            <div id="gpsLapVdPlot" class="ve-plot" style="height: 600px;"></div>
                        </div>
                        ` : ''}
                    </div>
                </div>
            </div>
        </div>
    `;

    // Setup slider event handlers for CdA/Crr with recalculation
    setupGpsLapSliderHandlers(params);

    // Setup tab switching
    setupTabSwitching({
        wind: () => renderGpsLapWindPlot(lapProfiles),
        power: () => renderGpsLapPowerPlot(lapProfiles),
        vd: () => renderGpsLapVdPlot(lapProfiles),
    });

    // Setup wind source radio button listeners
    bindWindSourceRadios(() => {
        log.debug('Wind source changed - triggering GPS lap VE recalculation');
        recalculateGpsLapVE();
    });

    // Setup air speed calibration listeners
    const airSpeedCalibrationSlider = document.getElementById('airSpeedCalibrationSlider') as HTMLInputElement;
    const airSpeedCalibrationValue = document.getElementById('airSpeedCalibrationValue') as HTMLInputElement;

    if (airSpeedCalibrationSlider && airSpeedCalibrationValue) {
        const updateAirSpeedCalibration = () => {
            const value = parseFloat(airSpeedCalibrationSlider.value);
            airSpeedCalibrationValue.value = value.toFixed(1);
            appState.airSpeedCalibrationPercent = value;
            void saveCurrentMultiSegmentSettings();
            log.debug('Air speed calibration changed - updating GPS lap VE plots');
            const windSource = getSelectedWindSource();
            const cda = parseFloat((document.getElementById('cdaValue') as HTMLInputElement)?.value || '0.3');
            const crr = parseFloat((document.getElementById('crrValue') as HTMLInputElement)?.value || '0.008');
            void updateGpsLapVEPlots(cda, crr, windSource);
        };

        const updateAirSpeedCalibrationFromInput = () => {
            const value = parseFloat(airSpeedCalibrationValue.value);
            if (isNaN(value)) return;
            const clamped = clampAirSpeedCalibrationPercent(value);
            airSpeedCalibrationSlider.value = clamped.toString();
            airSpeedCalibrationValue.value = clamped.toFixed(1);
            appState.airSpeedCalibrationPercent = clamped;
            void saveCurrentMultiSegmentSettings();
            log.debug('Air speed calibration changed - updating GPS lap VE plots');
            const windSource = getSelectedWindSource();
            const cda = parseFloat((document.getElementById('cdaValue') as HTMLInputElement)?.value || '0.3');
            const crr = parseFloat((document.getElementById('crrValue') as HTMLInputElement)?.value || '0.008');
            void updateGpsLapVEPlots(cda, crr, windSource);
        };

        airSpeedCalibrationSlider.addEventListener('input', updateAirSpeedCalibration);
        airSpeedCalibrationValue.addEventListener('change', updateAirSpeedCalibrationFromInput);

        const autoAdjustButton = document.getElementById('autoAdjustCalibration') as HTMLButtonElement;
        if (autoAdjustButton) {
            autoAdjustButton.addEventListener('click', () => {
                const calibrationPercent = calculateAutoAirSpeedCalibrationPercent(
                    buildAutoCalibrationSegmentsFromRanges(appState.currentGpsLapIndexRanges ?? []),
                );

                if (calibrationPercent === null) {
                    log.warn('Cannot auto-adjust GPS lap calibration: no usable FIT air speed data available');
                    return;
                }

                airSpeedCalibrationSlider.value = calibrationPercent.toFixed(1);
                airSpeedCalibrationValue.value = calibrationPercent.toFixed(1);
                appState.airSpeedCalibrationPercent = calibrationPercent;
                void saveCurrentMultiSegmentSettings();
                log.debug(`Auto-adjusted GPS lap air speed calibration to ${calibrationPercent.toFixed(1)}%`);
                const windSource = getSelectedWindSource();
                const cda = parseFloat((document.getElementById('cdaValue') as HTMLInputElement)?.value || '0.3');
                const crr = parseFloat((document.getElementById('crrValue') as HTMLInputElement)?.value || '0.008');
                void updateGpsLapVEPlots(cda, crr, windSource);
            });
        }
    }

    // Setup action footer buttons
    bindActionFooter({
        onSaveScreenshot: () => { void saveGpsLapScreenshot(); },
        onStoreResult: () => { void handleStoreResult(appState, resultsStorage); },
        onExportAll: () => { void handleExportAllResults(resultsStorage); },
    });

    // Render the plots using the shared function
    renderGpsLapVEPlots(lapProfiles, meanElevation);

    // Scroll to the VE analysis section
    veSection.scrollIntoView({ behavior: 'smooth', block: 'start' });

    log.debug(`GPS Lap VE plot rendered with ${lapProfiles.length} laps`);
}

/**
 * Calculate statistics for GPS lap VE analysis
 */
function calculateGpsLapStats(
    lapProfiles: LapVEProfile[],
    meanElevation: { distances: number[]; elevation: number[] }
): { meanR2: number; meanRMSE: number; avgVeGain: number; avgActualGain: number; closingError: number; lapClosingErrors: number[] } {
    if (lapProfiles.length === 0) {
        return { meanR2: 0, meanRMSE: 0, avgVeGain: 0, avgActualGain: 0, closingError: 0, lapClosingErrors: [] };
    }

    let totalR2 = 0;
    let totalRMSE = 0;
    let totalVeGain = 0;
    let totalActualGain = 0;
    const lapClosingErrors: number[] = [];  // Per-lap closing errors

    for (const lap of lapProfiles) {
        // Calculate R² and RMSE for this lap against mean elevation
        let sumSquaredResiduals = 0;
        let sumSquaredTotal = 0;
        const startElevation = meanElevation.elevation.length > 0 ? meanElevation.elevation[0] : 0;
        const veOffset = lap.virtualElevation[0] - startElevation;
        const calibratedVE = lap.virtualElevation.map(v => v - veOffset);

        // Calculate VE gain for this lap (end - start of calibrated VE)
        // For GPS laps, this should be ~0 since we return to the same point
        let lapVeChange = 0;
        if (calibratedVE.length > 1) {
            lapVeChange = calibratedVE[calibratedVE.length - 1] - calibratedVE[0];
            totalVeGain += lapVeChange;
        }
        lapClosingErrors.push(lapVeChange);

        // Calculate actual elevation gain for this lap
        if (lap.actualElevation.length > 1) {
            totalActualGain += lap.actualElevation[lap.actualElevation.length - 1] - lap.actualElevation[0];
        }

        // Interpolate mean elevation at each lap distance point
        let meanElevSum = 0;
        let count = 0;
        for (let i = 0; i < lap.distances.length; i++) {
            const dist = lap.distances[i];
            let interpMeanElev = 0;
            for (let k = 0; k < meanElevation.distances.length - 1; k++) {
                if (meanElevation.distances[k] <= dist && meanElevation.distances[k + 1] >= dist) {
                    const t = (dist - meanElevation.distances[k]) /
                              (meanElevation.distances[k + 1] - meanElevation.distances[k]);
                    interpMeanElev = meanElevation.elevation[k] + t *
                                     (meanElevation.elevation[k + 1] - meanElevation.elevation[k]);
                    break;
                }
            }
            const residual = calibratedVE[i] - interpMeanElev;
            sumSquaredResiduals += residual * residual;
            meanElevSum += interpMeanElev;
            count++;
        }

        const meanMeanElev = count > 0 ? meanElevSum / count : 0;
        for (let i = 0; i < lap.distances.length; i++) {
            const dist = lap.distances[i];
            let interpMeanElev = 0;
            for (let k = 0; k < meanElevation.distances.length - 1; k++) {
                if (meanElevation.distances[k] <= dist && meanElevation.distances[k + 1] >= dist) {
                    const t = (dist - meanElevation.distances[k]) /
                              (meanElevation.distances[k + 1] - meanElevation.distances[k]);
                    interpMeanElev = meanElevation.elevation[k] + t *
                                     (meanElevation.elevation[k + 1] - meanElevation.elevation[k]);
                    break;
                }
            }
            sumSquaredTotal += Math.pow(interpMeanElev - meanMeanElev, 2);
        }

        const r2 = sumSquaredTotal > 0 ? 1 - (sumSquaredResiduals / sumSquaredTotal) : 0;
        const rmse = count > 0 ? Math.sqrt(sumSquaredResiduals / count) : 0;

        totalR2 += Math.max(0, r2); // Clamp negative R² to 0
        totalRMSE += rmse;
    }

    // Also calculate mean elevation gain from the mean profile
    let meanProfileGain = 0;
    if (meanElevation.elevation.length > 1) {
        meanProfileGain = meanElevation.elevation[meanElevation.elevation.length - 1] - meanElevation.elevation[0];
    }

    // Calculate closing error as sum of absolute VE changes per lap
    // For GPS laps, each lap should return to 0, so any deviation is an error
    const closingError = lapClosingErrors.reduce((sum, err) => sum + Math.abs(err), 0);

    return {
        meanR2: totalR2 / lapProfiles.length,
        meanRMSE: totalRMSE / lapProfiles.length,
        avgVeGain: totalVeGain / lapProfiles.length,
        avgActualGain: meanProfileGain,  // Use mean profile gain as the reference
        closingError: closingError,
        lapClosingErrors: lapClosingErrors
    };
}

/**
 * Setup slider event handlers for GPS lap mode (uses standard slider IDs)
 */
function setupGpsLapSliderHandlers(_params: AnalysisParameters) {
    const cdaSlider = document.getElementById('cdaSlider') as HTMLInputElement;
    const cdaValue = document.getElementById('cdaValue') as HTMLInputElement;
    const crrSlider = document.getElementById('crrSlider') as HTMLInputElement;
    const crrValue = document.getElementById('crrValue') as HTMLInputElement;

    const triggerRecalculation = () => {
        const windSource = getSelectedWindSource();
        const cda = parseFloat(cdaValue?.value || '0.3');
        const crr = parseFloat(crrValue?.value || '0.008');
        void updateGpsLapVEPlots(cda, crr, windSource);
    };

    if (cdaSlider && cdaValue) {
        cdaSlider.addEventListener('input', () => {
            cdaValue.value = parseFloat(cdaSlider.value).toFixed(3);
            void saveCurrentMultiSegmentSettings();
            triggerRecalculation();
        });
        cdaValue.addEventListener('change', () => {
            cdaSlider.value = cdaValue.value;
            void saveCurrentMultiSegmentSettings();
            triggerRecalculation();
        });
    }

    if (crrSlider && crrValue) {
        crrSlider.addEventListener('input', () => {
            crrValue.value = parseFloat(crrSlider.value).toFixed(4);
            void saveCurrentMultiSegmentSettings();
            triggerRecalculation();
        });
        crrValue.addEventListener('change', () => {
            crrSlider.value = crrValue.value;
            void saveCurrentMultiSegmentSettings();
            triggerRecalculation();
        });
    }
}

/**
 * Recalculate GPS lap VE with updated CdA/Crr values
 */
async function recalculateGpsLapVE() {
    if (!appState.currentFitData || !appState.currentParameters) {
        log.error('Cannot recalculate: missing data or parameters');
        return;
    }

    const cdaValueEl = document.getElementById('cdaValue') as HTMLInputElement;
    const crrValueEl = document.getElementById('crrValue') as HTMLInputElement;

    if (!cdaValueEl || !crrValueEl) return;

    const newCda = parseFloat(cdaValueEl.value);
    const newCrr = parseFloat(crrValueEl.value);

    // Get the selected GPS lap index ranges
    const selectedGpsLaps = appState.gpsDetectedLaps.filter(lap =>
        appState.gpsSelectedLaps.includes(lap.lapNumber)
    );
    const selectedLapIndexRanges = selectedGpsLaps.map(lap => ({
        startIdx: lap.startIdx,
        endIdx: lap.endIdx
    }));

    if (selectedLapIndexRanges.length === 0) {
        log.error('No GPS laps selected for recalculation');
        return;
    }

    // Update parameters with new values
    const updatedParams = { ...appState.currentParameters, cda: newCda, crr: newCrr };

    // Recalculate
    showLoading('Recalculating VE with new parameters...');

    try {
        await showGpsLapVEAnalysis(
            selectedLapIndexRanges,
            appState.currentFitData,
            updatedParams,
            appState.currentParameters.air_speed_offset ?? 2,
            true,
        );
    } catch (err) {
        log.error('Recalculation failed:', err);
        hideLoading();
    }
}

/**
 * Save GPS lap VE plot as screenshot
 */
async function saveGpsLapScreenshot() {
    const plotElement = document.getElementById('gpsLapVePlot');
    if (!plotElement) return;

    try {
        const Plotly = await waitForPlotly();
        const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
        await Plotly.downloadImage('gpsLapVePlot', {
            format: 'png',
            width: 1200,
            height: 600,
            filename: `gps-lap-ve-${timestamp}`
        });
    } catch (err) {
        log.error('Failed to save screenshot:', err);
    }
}

function getMultiSegmentColor(index: number): string {
    return MULTI_SEGMENT_COLORS[index % MULTI_SEGMENT_COLORS.length];
}

/**
 * Render stacked Wind plot for GPS lap mode
 */
function renderGpsLapWindPlot(lapProfiles: LapVEProfile[]) {
    const Plotly = (window as any).Plotly;
    if (!Plotly) return;

    const plotDiv = document.getElementById('gpsLapWindPlot');
    if (!plotDiv) return;

    const figure = buildMultiSegmentWindFigure({
        title: 'Apparent Wind Speed by Lap',
        series: lapProfiles.map((lap, index) => ({
            label: `Lap ${lap.lapNumber}`,
            color: getMultiSegmentColor(index),
            metrics: lap.supplementarySeries,
        })),
    });

    Plotly.newPlot('gpsLapWindPlot', figure.data, figure.layout, figure.config);
}

/**
 * Render stacked Power plot for GPS lap mode
 */
function renderGpsLapPowerPlot(lapProfiles: LapVEProfile[]) {
    const Plotly = (window as any).Plotly;
    if (!Plotly) return;

    const plotDiv = document.getElementById('gpsLapPowerPlot');
    if (!plotDiv) return;

    const figure = buildMultiSegmentPowerFigure({
        title: 'Power by Lap',
        series: lapProfiles.map((lap, index) => ({
            label: `Lap ${lap.lapNumber}`,
            color: getMultiSegmentColor(index),
            metrics: lap.supplementarySeries,
        })),
    });

    Plotly.newPlot('gpsLapPowerPlot', figure.data, figure.layout, figure.config);
}

/**
 * Render stacked VD plot for GPS lap mode
 */
function renderGpsLapVdPlot(lapProfiles: LapVEProfile[]) {
    const Plotly = (window as any).Plotly;
    if (!Plotly) return;

    const plotDiv = document.getElementById('gpsLapVdPlot');
    if (!plotDiv) return;

    const figure = buildMultiSegmentVirtualDistanceFigure({
        title: 'Virtual Distance Difference by Lap',
        series: lapProfiles.map((lap, index) => ({
            label: `Lap ${lap.lapNumber}`,
            color: getMultiSegmentColor(index),
            metrics: lap.supplementarySeries,
        })),
    });

    Plotly.newPlot('gpsLapVdPlot', figure.data, figure.layout, figure.config);
}

/**
 * Render GPS lap VE plots (extracted for reuse during recalculation)
 */
function renderGpsLapVEPlots(
    lapProfiles: LapVEProfile[],
    meanElevation: { distances: number[]; elevation: number[] }
) {
    const Plotly = (window as any).Plotly;
    if (!Plotly) return;

    // Color palette for laps
    const lapColors = [
        '#4363d8',  // Blue
        '#e6194b',  // Red
        '#3cb44b',  // Green
        '#f58231',  // Orange
        '#911eb4',  // Purple
        '#46f0f0',  // Cyan
        '#f032e6',  // Magenta
        '#bcf60c',  // Lime
    ];

    // Find maximum distance for axis
    let maxDist = 0;
    for (const lap of lapProfiles) {
        const lapMax = lap.distances[lap.distances.length - 1];
        if (lapMax > maxDist) maxDist = lapMax;
    }

    // Build plot traces
    const veTraces: any[] = [];
    const residualTraces: any[] = [];

    // Add mean elevation trace (dashed black line)
    if (meanElevation.distances.length > 0) {
        veTraces.push({
            x: meanElevation.distances,
            y: meanElevation.elevation,
            mode: 'lines',
            name: 'Mean Elevation',
            line: { color: 'black', dash: 'dash', width: 2 }
        });
    }

    // Add VE traces for each lap
    for (let i = 0; i < lapProfiles.length; i++) {
        const lap = lapProfiles[i];
        const color = lapColors[i % lapColors.length];

        // Calibrate VE to match mean elevation at start
        const startElevation = meanElevation.elevation.length > 0 ? meanElevation.elevation[0] : 0;
        const veOffset = lap.virtualElevation[0] - startElevation;
        const calibratedVE = lap.virtualElevation.map(v => v - veOffset);

        // VE trace
        veTraces.push({
            x: lap.distances,
            y: calibratedVE,
            mode: 'lines',
            name: `Lap ${lap.lapNumber}`,
            line: { color: color, width: 3 }
        });

        // Calculate residuals (VE - interpolated mean elevation)
        const residuals: number[] = [];
        const residualDistances: number[] = [];

        for (let j = 0; j < lap.distances.length; j++) {
            const dist = lap.distances[j];
            // Interpolate mean elevation at this distance
            let meanElev = 0;
            if (meanElevation.distances.length > 0) {
                for (let k = 0; k < meanElevation.distances.length - 1; k++) {
                    if (meanElevation.distances[k] <= dist && meanElevation.distances[k + 1] >= dist) {
                        const t = (dist - meanElevation.distances[k]) /
                                  (meanElevation.distances[k + 1] - meanElevation.distances[k]);
                        meanElev = meanElevation.elevation[k] + t *
                                   (meanElevation.elevation[k + 1] - meanElevation.elevation[k]);
                        break;
                    }
                }
            }
            residuals.push(calibratedVE[j] - meanElev);
            residualDistances.push(dist);
        }

        // Residual trace
        residualTraces.push({
            x: residualDistances,
            y: residuals,
            mode: 'lines',
            name: `Lap ${lap.lapNumber}`,
            line: { color: color, width: 2 },
            showlegend: false
        });
    }

    // Main VE plot layout
    const veLayout = {
        title: 'Virtual Elevation by Lap',
        xaxis: {
            title: 'Distance from Gate (km)',
            range: [0, maxDist]
        },
        yaxis: {
            title: 'Elevation (m)'
        },
        legend: {
            orientation: 'h',
            y: -0.2
        },
        margin: { t: 40, b: 80, l: 60, r: 20 },
        hovermode: 'closest'
    };

    // Residual plot layout
    const residualLayout = {
        title: 'VE Residuals (VE - Mean Elevation)',
        xaxis: {
            title: 'Distance from Gate (km)',
            range: [0, maxDist]
        },
        yaxis: {
            title: 'Residual (m)'
        },
        margin: { t: 40, b: 60, l: 60, r: 20 },
        hovermode: 'closest',
        shapes: [{
            type: 'line',
            x0: 0,
            x1: maxDist,
            y0: 0,
            y1: 0,
            line: { color: 'black', width: 1 }
        }]
    };

    // Render plots
    Plotly.newPlot('gpsLapVePlot', veTraces, veLayout, { responsive: true });
    Plotly.newPlot('gpsLapResidualPlot', residualTraces, residualLayout, { responsive: true });

    // Update statistics
    const stats = calculateGpsLapStats(lapProfiles, meanElevation);
    const r2Span = document.getElementById('gpsLapR2Value');
    const rmseSpan = document.getElementById('gpsLapRmseValue');
    const closingErrorSpan = document.getElementById('gpsLapClosingErrorValue');
    if (r2Span) r2Span.textContent = stats.meanR2.toFixed(4);
    if (rmseSpan) rmseSpan.textContent = stats.meanRMSE.toFixed(2) + 'm';
    if (closingErrorSpan) closingErrorSpan.textContent = stats.closingError.toFixed(2) + 'm';

    // Populate lap summary table
    const summaryTable = document.getElementById('gpsLapSummaryTable');
    if (summaryTable) {
        let tableHtml = `
            <table style="width: 100%; border-collapse: collapse; font-size: 0.85rem;">
                <thead>
                    <tr style="border-bottom: 2px solid #e2e8f0;">
                        <th style="text-align: left; padding: 0.5rem;">Lap</th>
                        <th style="text-align: right; padding: 0.5rem;">Duration</th>
                        <th style="text-align: right; padding: 0.5rem;">Distance</th>
                        <th style="text-align: right; padding: 0.5rem;">Avg Speed</th>
                    </tr>
                </thead>
                <tbody>
        `;

        for (let i = 0; i < lapProfiles.length; i++) {
            const lap = lapProfiles[i];
            const color = lapColors[i % lapColors.length];
            const avgSpeed = lap.totalDistance / (lap.duration / 3600); // km/h

            tableHtml += `
                <tr style="border-bottom: 1px solid #e2e8f0;">
                    <td style="padding: 0.5rem;">
                        <span style="display: inline-block; width: 12px; height: 12px; background: ${color}; border-radius: 2px; margin-right: 0.5rem;"></span>
                        Lap ${lap.lapNumber}
                    </td>
                    <td style="text-align: right; padding: 0.5rem;">${formatLapDuration(lap.duration)}</td>
                    <td style="text-align: right; padding: 0.5rem;">${lap.totalDistance.toFixed(2)} km</td>
                    <td style="text-align: right; padding: 0.5rem;">${avgSpeed.toFixed(1)} km/h</td>
                </tr>
            `;
        }

        tableHtml += '</tbody></table>';
        summaryTable.innerHTML = tableHtml;
    }
}




function getGpsLapNumberForRange(range: { startIdx: number; endIdx: number }, fallbackLapNumber: number): number {
    const matchingLap = appState.gpsDetectedLaps.find(lap =>
        lap.startIdx === range.startIdx && lap.endIdx === range.endIdx,
    );
    return matchingLap?.lapNumber ?? fallbackLapNumber;
}

async function resolveMultiSegmentAnalysisParams(
    analyzedItems: number[],
    params: AnalysisParameters,
    reuseCurrentSettings: boolean = false,
): Promise<AnalysisParameters> {
    const savedSettings = appState.currentFileHash
        ? await parameterStorage.loadLapSettings(appState.currentFileHash, analyzedItems)
        : null;
    const resolved = resolveMultiSegmentSettings({
        currentAnalyzedItems: reuseCurrentSettings ? appState.currentAnalyzedLaps : [],
        nextAnalyzedItems: analyzedItems,
        params,
        currentAirSpeedCalibrationPercent: appState.airSpeedCalibrationPercent,
        savedSettings,
    });

    appState.currentAnalyzedLaps = analyzedItems;
    appState.airSpeedCalibrationPercent = resolved.airSpeedCalibrationPercent;
    return resolved.params;
}

async function saveCurrentMultiSegmentSettings() {
    if (!appState.currentFileHash || !appState.selectedFile || appState.currentAnalyzedLaps.length === 0) {
        return;
    }

    const cdaValueEl = document.getElementById('cdaValue') as HTMLInputElement | null;
    const crrValueEl = document.getElementById('crrValue') as HTMLInputElement | null;
    if (!cdaValueEl || !crrValueEl) {
        return;
    }

    const parsedCda = parseFloat(cdaValueEl.value);
    const parsedCrr = parseFloat(crrValueEl.value);
    const settings: LapSettings = {
        trimStart: 0,
        trimEnd: 0,
        cda: Number.isFinite(parsedCda) ? parsedCda : null,
        crr: Number.isFinite(parsedCrr) ? parsedCrr : null,
        airSpeedCalibration:
            appState.airSpeedCalibrationPercent !== 0
                ? appState.airSpeedCalibrationPercent
                : undefined,
    };

    try {
        await parameterStorage.saveLapSettings(appState.currentFileHash, appState.currentAnalyzedLaps, settings);
    } catch (err) {
        log.error('Failed to save multi-segment settings:', err);
    }
}

// Helper function to save map trim settings (before VE analysis is opened)
async function saveMapTrimSettings() {

    if (!appState.currentFileHash || !appState.selectedFile) {
        log.warn('⚠️ Cannot save: missing fileHash or appState.selectedFile');
        return;
    }

    const settings: LapSettings = {
        trimStart: appState.presetTrimStart,
        trimEnd: appState.presetTrimEnd ?? 0,
        cda: null, // CdA/Crr not set yet
        crr: null
    };

    try {
        await parameterStorage.saveLapSettings(appState.currentFileHash, appState.selectedLaps, settings);
    } catch (err) {
        log.error('❌ Failed to save map trim settings:', err);
    }
}


/**
 * Update VE plots for GPS lap mode - calculates VE for each lap and shows stacked plot
 */
async function updateGpsLapVEPlots(cda: number, crr: number, windSource: string) {
    if (!appState.currentFitData || !appState.currentGpsLapIndexRanges || !appState.currentParameters) {
        log.error('Missing data for GPS lap VE update');
        return;
    }

    await waitForPlotly();

    const normalizedArrays = getNormalizedActivityArrays(appState.currentFitData);
    const allTimestamps = normalizedArrays.timestamps;
    const allPower = normalizedArrays.power;
    const allVelocity = normalizedArrays.velocity;
    const allPositionLat = normalizedArrays.positionLat;
    const allPositionLong = normalizedArrays.positionLong;
    const allAltitude = normalizedArrays.altitude;
    const allDistance = normalizedArrays.distance;

    const gpsLapUpdateWindResolution = resolveWindSeries({
        fitData: appState.currentFitData,
        windSource,
        params: appState.currentParameters,
        airSpeedCalibrationPercent: appState.airSpeedCalibrationPercent,
    });
    const allWindSpeed = gpsLapUpdateWindResolution.windSpeed;

    const lapVEProfiles: LapVEProfile[] = [];

    // Calculate VE for each selected GPS lap
    for (let lapIdx = 0; lapIdx < appState.currentGpsLapIndexRanges.length; lapIdx++) {
        const range = appState.currentGpsLapIndexRanges[lapIdx];
        const lapNumber = getGpsLapNumberForRange(range, lapIdx + 1);

        // Extract data for this lap
        const lapTimestamps: number[] = [];
        const lapPower: number[] = [];
        const lapVelocity: number[] = [];
        const lapPositionLat: number[] = [];
        const lapPositionLong: number[] = [];
        const lapAltitude: number[] = [];
        const lapDistance: number[] = [];
        const lapWindSpeed: number[] = [];

        for (let i = range.startIdx; i <= range.endIdx && i < allTimestamps.length; i++) {
            lapTimestamps.push(allTimestamps[i]);
            lapPower.push(allPower[i]);
            lapVelocity.push(allVelocity[i]);
            lapPositionLat.push(allPositionLat[i]);
            lapPositionLong.push(allPositionLong[i]);
            lapAltitude.push(allAltitude[i]);
            lapDistance.push(allDistance[i]);
            lapWindSpeed.push(allWindSpeed[i]);
        }

        if (lapTimestamps.length < 10) {
            log.warn(`Lap ${lapNumber} has too few data points (${lapTimestamps.length}), skipping`);
            continue;
        }

        const supplementarySeries = buildSegmentSupplementarySeries({
            timestamps: lapTimestamps,
            power: lapPower,
            velocity: lapVelocity,
            positionLat: lapPositionLat,
            positionLong: lapPositionLong,
            distance: lapDistance,
            windSpeed: lapWindSpeed,
            params: appState.currentParameters,
            selectedWindSource: gpsLapUpdateWindResolution.selectedWindSource,
        });
        const relativeDistances = supplementarySeries.distancesKm;

        // Calculate duration
        const duration = lapTimestamps[lapTimestamps.length - 1] - lapTimestamps[0];
        const totalDistance = relativeDistances[relativeDistances.length - 1] ?? 0;

        try {
            const calculator = createVeCalculator({
                timestamps: lapTimestamps,
                power: lapPower,
                velocity: lapVelocity,
                positionLat: lapPositionLat,
                positionLong: lapPositionLong,
                altitude: lapAltitude,
                distance: lapDistance,
                windSpeed: lapWindSpeed,
                params: appState.currentParameters,
                cda,
                crr,
            });

            // Calculate VE for full lap
            const result = calculator.calculate_virtual_elevation(cda, crr, 0, lapTimestamps.length - 1);

            // Extract VE values
            const veArray = Array.from(result.virtual_elevation as Float64Array);

            // Get actual elevation (use zeros for velodrome mode)
            const actualElevation = appState.currentParameters.velodrome
                ? new Array(lapAltitude.length).fill(0)
                : lapAltitude;

            lapVEProfiles.push({
                lapNumber,
                distances: relativeDistances,
                virtualElevation: veArray,
                actualElevation: actualElevation,
                supplementarySeries,
                duration,
                totalDistance
            });

        } catch (err) {
            log.error(`Failed to calculate VE for lap ${lapNumber}:`, err);
        }
    }

    if (lapVEProfiles.length === 0) {
        log.error('No valid laps to display');
        return;
    }

    // Calculate mean actual elevation profile
    const meanElevation = calculateMeanElevationProfile(lapVEProfiles);

    // Calculate and update statistics
    const stats = calculateGpsLapStats(lapVEProfiles, meanElevation);

    // Create a combined VE result for store functionality
    // Concatenate all lap VE profiles into a single array
    const combinedVE: number[] = [];
    for (const lap of lapVEProfiles) {
        combinedVE.push(...lap.virtualElevation);
    }

    // Store combined result globally for save functionality
    appState.currentVEResult = {
        r2: stats.meanR2,
        rmse: stats.meanRMSE,
        ve_elevation_diff: stats.avgVeGain,
        actual_elevation_diff: stats.avgActualGain,
        virtual_elevation: new Float64Array(combinedVE),
        virtual_distance_air: 0,
        virtual_distance_ground: 0,
        vd_difference_percent: 0
    };
    appState.currentWindSource = (windSource === 'compare'
        ? 'compare'
        : gpsLapUpdateWindResolution.selectedWindSource) as 'constant' | 'fit' | 'compare' | 'none';

    // Store filtered data globally for save functionality (combine all lap data)
    const combinedPower: number[] = [];
    const combinedVelocity: number[] = [];
    const combinedTimestamps: number[] = [];
    const combinedTemperature: number[] = [];

    for (const range of appState.currentGpsLapIndexRanges!) {
        for (let i = range.startIdx; i <= range.endIdx && i < allTimestamps.length; i++) {
            combinedPower.push(allPower[i]);
            combinedVelocity.push(allVelocity[i]);
            combinedTimestamps.push(allTimestamps[i]);
            // Temperature may not exist
            if (appState.currentFitData.temperature) {
                combinedTemperature.push(appState.currentFitData.temperature[i] || 0);
            }
        }
    }
    appState.currentFilteredData = {
        power: combinedPower,
        velocity: combinedVelocity,
        timestamps: combinedTimestamps,
        temperature: combinedTemperature
    };

    // Store analyzed laps (GPS lap numbers)
    appState.currentAnalyzedLaps = lapVEProfiles.map(lap => lap.lapNumber);

    renderGpsLapVEPlots(lapVEProfiles, meanElevation);
    setupTabSwitching({
        wind: () => renderGpsLapWindPlot(lapVEProfiles),
        power: () => renderGpsLapPowerPlot(lapVEProfiles),
        vd: () => renderGpsLapVdPlot(lapVEProfiles),
    });

    const windTab = document.getElementById('wind-tab');
    if (windTab?.classList.contains('active')) {
        renderGpsLapWindPlot(lapVEProfiles);
    }
    const powerTab = document.getElementById('power-tab');
    if (powerTab?.classList.contains('active')) {
        renderGpsLapPowerPlot(lapVEProfiles);
    }
    const vdTab = document.getElementById('vd-tab');
    if (vdTab?.classList.contains('active')) {
        renderGpsLapVdPlot(lapVEProfiles);
    }

    log.debug(`GPS Lap VE plots updated with ${lapVEProfiles.length} laps, CdA=${cda.toFixed(3)}, Crr=${crr.toFixed(4)}`);
}

// ==================== Out and Back VE Analysis ====================

interface OutAndBackVEProfile {
    sectionNumber: number;
    outboundDistances: number[];      // km, relative to gate A
    outboundVE: number[];
    outboundActualElevation: number[];
    outboundSeries: SegmentSupplementarySeries | null;
    inboundDistances: number[];       // km, relative to gate B (will be mirrored)
    inboundVE: number[];
    inboundActualElevation: number[];
    inboundSeries: SegmentSupplementarySeries | null;
    outboundDuration: number;
    inboundDuration: number;
    totalDistance: number;
}

// Store Out and Back sections in appState for recalculation.
// NOTE: A parallel `currentOutAndBackProfiles` used to live here but was
// write-only (assigned in two places, never read).

/**
 * Calculate VE for Out and Back sections and show stacked plot
 */
async function showOutAndBackVEAnalysis(
    sections: OutAndBackSection[],
    fitData: any,
    params: AnalysisParameters,
    defaultAirSpeedOffset: number,
    reuseCurrentSettings: boolean = false,
) {
    showLoading('Calculating VE for out-and-back sections...');

    const analyzedSectionNumbers = sections.map(section => section.sectionNumber);
    const resolvedParams = await resolveMultiSegmentAnalysisParams(
        analyzedSectionNumbers,
        params,
        reuseCurrentSettings,
    );
    appState.currentOutAndBackSections = sections;
    const profiles: OutAndBackVEProfile[] = [];

    const normalizedArrays = getNormalizedActivityArrays(fitData);
    const allTimestamps = normalizedArrays.timestamps;
    const allPower = normalizedArrays.power;
    const allVelocity = normalizedArrays.velocity;
    const allPositionLat = normalizedArrays.positionLat;
    const allPositionLong = normalizedArrays.positionLong;
    const allAltitude = normalizedArrays.altitude;
    const allDistance = normalizedArrays.distance;

    // Handle wind/air speed via typed locals.
    const outAndBackWindResolution = resolveWindSeries({
        fitData,
        windSource: getSelectedWindSource(),
        params: resolvedParams,
        airSpeedCalibrationPercent: appState.airSpeedCalibrationPercent,
    });
    const {
        hasAirSpeed,
        hasWindSpeed,
        windSpeed: allWindSpeed,
    } = outAndBackWindResolution;
    const windSpeedOffset = resolvedParams.air_speed_offset ?? defaultAirSpeedOffset;

    if (outAndBackWindResolution.selectedWindSource === 'constant') {
        log.debug('Out and Back VE: Using constant wind settings');
    } else if (outAndBackWindResolution.dataSource === 'air_speed') {
        log.debug(`Out and Back VE: Using FIT air speed data (offset: ${windSpeedOffset}s, calibration: ${appState.airSpeedCalibrationPercent}%)`);
    } else if (outAndBackWindResolution.dataSource === 'wind_speed') {
        log.debug(`Out and Back VE: Using FIT wind speed data (offset: ${windSpeedOffset}s, calibration: ${appState.airSpeedCalibrationPercent}%)`);
    } else {
        log.debug('Out and Back VE: No wind data available');
    }

    const cda = resolvedParams.cda ?? 0.3;
    const crr = resolvedParams.crr ?? 0.008;

    // Calculate VE for each section (outbound and inbound separately)
    for (const section of sections) {
        const profile: OutAndBackVEProfile = {
            sectionNumber: section.sectionNumber,
            outboundDistances: [],
            outboundVE: [],
            outboundActualElevation: [],
            outboundSeries: null,
            inboundDistances: [],
            inboundVE: [],
            inboundActualElevation: [],
            inboundSeries: null,
            outboundDuration: section.outboundDuration,
            inboundDuration: section.inboundDuration,
            totalDistance: section.totalDistance
        };

        // Process outbound segment (A → B)
        try {
            const outboundData = extractSegmentData({
                startIdx: section.outboundStartIdx,
                endIdx: section.outboundEndIdx,
                allTimestamps,
                allPower,
                allVelocity,
                allPositionLat,
                allPositionLong,
                allAltitude,
                allDistance,
                allWindSpeed,
            });

            if (outboundData.timestamps.length >= 10) {
                const calculator = createVeCalculator({
                    timestamps: outboundData.timestamps,
                    power: outboundData.power,
                    velocity: outboundData.velocity,
                    positionLat: outboundData.positionLat,
                    positionLong: outboundData.positionLong,
                    altitude: outboundData.altitude,
                    distance: outboundData.distance,
                    windSpeed: outboundData.windSpeed,
                    params: resolvedParams,
                    cda,
                    crr,
                });

                const result = calculator.calculate_virtual_elevation(cda, crr, 0, outboundData.timestamps.length - 1);
                const veArray = Array.from(result.virtual_elevation as Float64Array);

                profile.outboundSeries = buildSegmentSupplementarySeries({
                    timestamps: outboundData.timestamps,
                    power: outboundData.power,
                    velocity: outboundData.velocity,
                    positionLat: outboundData.positionLat,
                    positionLong: outboundData.positionLong,
                    distance: outboundData.distance,
                    windSpeed: outboundData.windSpeed,
                    params: resolvedParams,
                    selectedWindSource: outAndBackWindResolution.selectedWindSource,
                });
                profile.outboundDistances = profile.outboundSeries.distancesKm;
                profile.outboundVE = veArray;
                profile.outboundActualElevation = resolvedParams.velodrome
                    ? new Array(outboundData.altitude.length).fill(0)
                    : [...outboundData.altitude];
            }
        } catch (err) {
            log.error(`Failed to calculate outbound VE for section ${section.sectionNumber}:`, err);
        }

        // Process inbound segment (B → A)
        try {
            const inboundData = extractSegmentData({
                startIdx: section.inboundStartIdx,
                endIdx: section.inboundEndIdx,
                allTimestamps,
                allPower,
                allVelocity,
                allPositionLat,
                allPositionLong,
                allAltitude,
                allDistance,
                allWindSpeed,
            });

            if (inboundData.timestamps.length >= 10) {
                const calculator = createVeCalculator({
                    timestamps: inboundData.timestamps,
                    power: inboundData.power,
                    velocity: inboundData.velocity,
                    positionLat: inboundData.positionLat,
                    positionLong: inboundData.positionLong,
                    altitude: inboundData.altitude,
                    distance: inboundData.distance,
                    windSpeed: inboundData.windSpeed,
                    params: resolvedParams,
                    cda,
                    crr,
                });

                const result = calculator.calculate_virtual_elevation(cda, crr, 0, inboundData.timestamps.length - 1);
                const veArray = Array.from(result.virtual_elevation as Float64Array);

                profile.inboundSeries = buildSegmentSupplementarySeries({
                    timestamps: inboundData.timestamps,
                    power: inboundData.power,
                    velocity: inboundData.velocity,
                    positionLat: inboundData.positionLat,
                    positionLong: inboundData.positionLong,
                    distance: inboundData.distance,
                    windSpeed: inboundData.windSpeed,
                    params: resolvedParams,
                    selectedWindSource: outAndBackWindResolution.selectedWindSource,
                });
                profile.inboundDistances = profile.inboundSeries.distancesKm;
                profile.inboundVE = veArray;
                profile.inboundActualElevation = resolvedParams.velodrome
                    ? new Array(inboundData.altitude.length).fill(0)
                    : [...inboundData.altitude];
            }
        } catch (err) {
            log.error(`Failed to calculate inbound VE for section ${section.sectionNumber}:`, err);
        }

        if (profile.outboundVE.length > 0 || profile.inboundVE.length > 0) {
            profiles.push(profile);
        }
    }

    hideLoading();

    if (profiles.length === 0) {
        showError('No valid out-and-back sections to analyze');
        return;
    }

    // Calculate mean actual elevation profile (mirroring inbound)
    const meanElevation = calculateOutAndBackMeanElevation(profiles);

    // Check for constant wind settings
    const hasConstantWind = resolvedParams.wind_speed !== undefined && resolvedParams.wind_speed !== 0 &&
                            resolvedParams.wind_direction !== undefined;

    // Preserve current wind source selection if UI exists (for recalculations)
    const preservedWindSource = getSelectedWindSource();

    // Show the Out and Back VE analysis interface with wind data info
    showOutAndBackVEPlot(profiles, meanElevation, resolvedParams, hasAirSpeed || hasWindSpeed, hasConstantWind, defaultAirSpeedOffset, preservedWindSource);
}

/**
 * Extract segment data between start and end indices
 */

/**
 * Calculate mean actual elevation profile for Out and Back (with inbound mirrored)
 */
function calculateOutAndBackMeanElevation(profiles: OutAndBackVEProfile[]): { distances: number[]; elevation: number[] } {
    if (profiles.length === 0) {
        return { distances: [], elevation: [] };
    }

    // Find maximum distance across all segments
    let maxDistance = 0;
    for (const profile of profiles) {
        if (profile.outboundDistances.length > 0) {
            maxDistance = Math.max(maxDistance, profile.outboundDistances[profile.outboundDistances.length - 1]);
        }
        if (profile.inboundDistances.length > 0) {
            maxDistance = Math.max(maxDistance, profile.inboundDistances[profile.inboundDistances.length - 1]);
        }
    }

    // Create reference distance array with ~10m intervals
    const numPoints = Math.max(100, Math.floor(maxDistance * 100));
    const referenceDistances: number[] = [];
    for (let i = 0; i <= numPoints; i++) {
        referenceDistances.push((i / numPoints) * maxDistance);
    }

    // Accumulate elevation values
    const elevationSum = new Array(referenceDistances.length).fill(0);
    const elevationCount = new Array(referenceDistances.length).fill(0);

    for (const profile of profiles) {
        // Process outbound elevation (not mirrored)
        if (profile.outboundDistances.length > 0 && profile.outboundActualElevation.length > 0) {
            for (let i = 0; i < referenceDistances.length; i++) {
                const targetDist = referenceDistances[i];
                if (targetDist > profile.outboundDistances[profile.outboundDistances.length - 1]) continue;

                // Linear interpolation
                const elevAtDist = interpolateElevation(targetDist, profile.outboundDistances, profile.outboundActualElevation);
                if (!isNaN(elevAtDist)) {
                    elevationSum[i] += elevAtDist;
                    elevationCount[i]++;
                }
            }
        }

        // Process inbound elevation (mirrored on x-axis)
        if (profile.inboundDistances.length > 0 && profile.inboundActualElevation.length > 0) {
            const maxInboundDist = profile.inboundDistances[profile.inboundDistances.length - 1];
            const mirroredDistances = profile.inboundDistances.map(d => maxInboundDist - d);

            for (let i = 0; i < referenceDistances.length; i++) {
                const targetDist = referenceDistances[i];
                if (targetDist > maxInboundDist) continue;

                const elevAtDist = interpolateElevation(targetDist, mirroredDistances, profile.inboundActualElevation);
                if (!isNaN(elevAtDist)) {
                    elevationSum[i] += elevAtDist;
                    elevationCount[i]++;
                }
            }
        }
    }

    // Calculate mean
    const meanElevation: number[] = [];
    for (let i = 0; i < referenceDistances.length; i++) {
        if (elevationCount[i] > 0) {
            meanElevation.push(elevationSum[i] / elevationCount[i]);
        } else {
            meanElevation.push(meanElevation.length > 0 ? meanElevation[meanElevation.length - 1] : 0);
        }
    }

    return { distances: referenceDistances, elevation: meanElevation };
}

/**
 * Linear interpolation helper
 */
function interpolateElevation(targetDist: number, distances: number[], elevations: number[]): number {
    if (distances.length === 0) return NaN;
    if (targetDist <= distances[0]) return elevations[0];
    if (targetDist >= distances[distances.length - 1]) return elevations[elevations.length - 1];

    for (let j = 0; j < distances.length - 1; j++) {
        if (distances[j] <= targetDist && distances[j + 1] >= targetDist) {
            const t = (targetDist - distances[j]) / (distances[j + 1] - distances[j]);
            return elevations[j] + t * (elevations[j + 1] - elevations[j]);
        }
    }
    return NaN;
}

/**
 * Show the Out and Back VE stacked plot with full controls (matching normal mode)
 */
async function showOutAndBackVEPlot(
    profiles: OutAndBackVEProfile[],
    meanElevation: { distances: number[]; elevation: number[] },
    params: AnalysisParameters,
    hasWindSpeed: boolean,
    hasConstantWind: boolean,
    defaultAirSpeedOffset: number,
    preservedWindSource: string | null = null
) {
    const selectedWindSource = preservedWindSource || (hasWindSpeed ? 'fit' : 'constant');
    const effectiveWindSource = selectedWindSource === 'compare' ? 'fit' : selectedWindSource;
    const showWindTab = hasWindSpeed || hasConstantWind;
    const showFitWindControls = hasWindSpeed && effectiveWindSource === 'fit';
    const showVirtualDistanceTab = showFitWindControls;


    const Plotly = await waitForPlotly();

    // Show the VE analysis section
    const veSection = document.getElementById('veAnalysisSection') as HTMLElement;
    if (veSection) {
        veSection.classList.remove('hidden', 'inactive');
    }

    const veAnalysisContent = document.getElementById('veAnalysisContent') as HTMLElement;
    if (!veAnalysisContent) {
        log.error('VE analysis content container not found');
        return;
    }

    // Calculate initial statistics
    const initialStats = calculateOutAndBackStats(profiles, meanElevation);
    const currentAirSpeedCalibrationValue = formatAirSpeedCalibrationPercent(appState.airSpeedCalibrationPercent);

    // Create full interface with controls sidebar (matching normal mode)
    veAnalysisContent.innerHTML = `
        <div class="ve-inline-container">
            <div class="ve-layout">
                <!-- Controls Sidebar -->
                <div class="ve-controls-sidebar">
                    <div class="ve-controls-scrollable">
                        <div class="ve-controls">
                            <h4>Analysis Parameters</h4>
                            <div class="ve-control-grid">
                                <div class="ve-control-group">
                                    <label>CdA (Drag Coefficient × Area):</label>
                                    <input type="range" id="cdaSlider" min="${params.cda_min}" max="${params.cda_max}" value="${params.cda || 0.3}" step="0.001" class="ve-slider">
                                    <input type="number" id="cdaValue" value="${(params.cda || 0.3).toFixed(3)}" min="${params.cda_min}" max="${params.cda_max}" step="0.001" class="ve-value-input">
                                </div>
                                <div class="ve-control-group">
                                    <label>Crr (Rolling Resistance):</label>
                                    <input type="range" id="crrSlider" min="${params.crr_min}" max="${params.crr_max}" value="${params.crr || 0.008}" step="0.0001" class="ve-slider">
                                    <input type="number" id="crrValue" value="${(params.crr || 0.008).toFixed(4)}" min="${params.crr_min}" max="${params.crr_max}" step="0.0001" class="ve-value-input">
                                </div>
                            </div>

                            ${(hasWindSpeed || hasConstantWind) ? `
                            <div class="ve-wind-source">
                                <h4>Wind Source</h4>
                                <div class="ve-radio-group">
                                    <label class="ve-radio-label">
                                        <input type="radio" name="windSource" value="constant" ${selectedWindSource === 'constant' ? 'checked' : ''}>
                                        <span>Use constant wind settings</span>
                                    </label>
                                    ${hasWindSpeed ? `
                                    <label class="ve-radio-label">
                                        <input type="radio" name="windSource" value="fit" ${selectedWindSource === 'fit' ? 'checked' : ''}>
                                        <span>Use FIT file wind data</span>
                                    </label>
                                    <label class="ve-radio-label">
                                        <input type="radio" name="windSource" value="compare" ${selectedWindSource === 'compare' ? 'checked' : ''}>
                                        <span>Compare both methods</span>
                                    </label>
                                    ` : ''}
                                </div>
                            </div>
                            ` : ''}

                            ${hasWindSpeed ? `
                            <div class="ve-parameter">
                                <div class="ve-param-header">
                                    <label for="airSpeedCalibration">Air Speed Calibration</label>
                                    <input type="number" id="airSpeedCalibrationValue" value="${currentAirSpeedCalibrationValue}" step="${AIR_SPEED_CALIBRATION_STEP_PERCENT}" min="${AIR_SPEED_CALIBRATION_MIN_PERCENT.toFixed(1)}" max="${AIR_SPEED_CALIBRATION_MAX_PERCENT.toFixed(1)}"
                                           style="width: 60px; text-align: right;" />
                                    <span>%</span>
                                </div>
                                <input type="range" id="airSpeedCalibrationSlider" min="${AIR_SPEED_CALIBRATION_MIN_PERCENT.toFixed(1)}" max="${AIR_SPEED_CALIBRATION_MAX_PERCENT.toFixed(1)}" step="${AIR_SPEED_CALIBRATION_STEP_PERCENT}" value="${currentAirSpeedCalibrationValue}" />
                                <button id="autoAdjustCalibration" class="secondary-btn" style="width: 100%; margin-top: 0.5rem;">Auto Adjust</button>
                            </div>
                            ` : ''}
                        </div>
                    </div>

                    <div class="ve-sidebar-footer">
                        <button id="saveScreenshot" class="primary-btn" style="width: 100%; margin-bottom: 0.5rem;">Save Screenshot</button>
                        <button id="storeResult" class="primary-btn" style="width: 100%; margin-bottom: 0.5rem;">Store Result</button>
                        <button id="exportAllResults" class="secondary-btn" style="width: 100%; font-size: 0.9rem;">Export All Results to CSV</button>
                    </div>
                </div>

                <!-- Plots Main Area -->
                <div class="ve-plots-main">
                    <div class="ve-plots">
                        <div class="ve-tabs">
                            <button class="ve-tab-button active" data-tab="ve">VE</button>
                            ${showWindTab ? `
                            <button class="ve-tab-button" data-tab="wind">Wind</button>
                            ` : ''}
                            <button class="ve-tab-button" data-tab="power">Power</button>
                            ${showVirtualDistanceTab ? `
                            <button class="ve-tab-button" data-tab="vd">VD</button>
                            ` : ''}
                        </div>

                        <div class="ve-tab-content active" id="ve-tab">
                            <div class="ve-metrics-compact">
                                RMSE:<span id="oabRmseValue">${initialStats.rmse.toFixed(2)}m</span> |
                                VE Gain:<span id="oabVeGainValue">${initialStats.avgVeGain.toFixed(2)}m</span> |
                                Actual:<span id="oabActualGainValue">${initialStats.avgActualGain.toFixed(2)}m</span> |
                                Sections:<span id="oabSectionCountValue">${profiles.length}</span>
                            </div>
                            <div class="ve-plot-container">
                                <div id="oabVePlot" style="width: 100%; height: 380px;"></div>
                            </div>
                            <div class="ve-plot-container">
                                <div id="oabVeResidualsPlot" style="width: 100%; height: 200px;"></div>
                            </div>
                            <div id="oabClosingError" style="margin-top: 0.5rem; padding: 0.5rem 1rem; background: #f5f5f5; border-radius: 4px; font-size: 0.9rem; display: none;"></div>
                        </div>

                        ${showWindTab ? `
                        <div class="ve-tab-content" id="wind-tab">
                            <div id="oabWindPlot" class="ve-plot" style="height: 600px;"></div>
                            ${showFitWindControls ? `
                            <div class="ve-parameter" style="margin-top: 1.5rem; padding: 1rem; border: 1px solid #ddd; border-radius: 4px; background: #f9f9f9;">
                                <h4 style="margin: 0 0 1rem 0; font-size: 1rem; font-weight: 500;">Air Speed Time Offset</h4>
                                <div style="display: grid; grid-template-columns: 1fr auto auto; gap: 0.5rem; align-items: center; margin-bottom: 0.5rem;">
                                    <input type="range" id="airSpeedOffsetSlider" min="-10" max="10" step="1" value="${params?.air_speed_offset ?? defaultAirSpeedOffset}"
                                           style="width: 100%;" />
                                    <input type="number" id="airSpeedOffsetValue" value="${params?.air_speed_offset ?? defaultAirSpeedOffset}" step="1" min="-10" max="10"
                                           style="width: 60px; text-align: right;" />
                                    <span style="font-weight: 500;">seconds</span>
                                </div>
                            </div>
                            ` : ''}
                        </div>
                        ` : ''}

                        <div class="ve-tab-content" id="power-tab">
                            <div id="oabPowerPlot" class="ve-plot" style="height: 600px;"></div>
                        </div>

                        ${showVirtualDistanceTab ? `
                        <div class="ve-tab-content" id="vd-tab">
                            <div id="oabVdPlot" class="ve-plot" style="height: 600px;"></div>
                        </div>
                        ` : ''}
                    </div>
                </div>
            </div>
        </div>
    `;

    // Setup slider sync with recalculation
    setupOutAndBackSliderSync();

    // Setup tab switching
    setupTabSwitching({
        wind: () => renderOutAndBackWindPlot(profiles),
        power: () => renderOutAndBackPowerPlot(profiles),
        vd: () => renderOutAndBackVdPlot(profiles),
    });

    // Setup wind source radio button listeners
    bindWindSourceRadios(() => {
        log.debug('Wind source changed - triggering Out and Back VE recalculation');
        recalculateOutAndBackVE();
    });

    // Setup air speed calibration listeners
    const airSpeedCalibrationSlider = document.getElementById('airSpeedCalibrationSlider') as HTMLInputElement;
    const airSpeedCalibrationValueEl = document.getElementById('airSpeedCalibrationValue') as HTMLInputElement;

    if (airSpeedCalibrationSlider && airSpeedCalibrationValueEl) {
        const updateAirSpeedCalibration = () => {
            const value = parseFloat(airSpeedCalibrationSlider.value);
            airSpeedCalibrationValueEl.value = value.toFixed(1);
            appState.airSpeedCalibrationPercent = value;
            void saveCurrentMultiSegmentSettings();
            log.debug('Air speed calibration changed - triggering Out and Back VE recalculation');
            const cda = parseFloat((document.getElementById('cdaValue') as HTMLInputElement)?.value || '0.3');
            const crr = parseFloat((document.getElementById('crrValue') as HTMLInputElement)?.value || '0.008');
            updateOutAndBackVEPlots(cda, crr);
        };

        const updateAirSpeedCalibrationFromInput = () => {
            const value = parseFloat(airSpeedCalibrationValueEl.value);
            if (isNaN(value)) return;
            const clamped = clampAirSpeedCalibrationPercent(value);
            airSpeedCalibrationSlider.value = clamped.toString();
            airSpeedCalibrationValueEl.value = clamped.toFixed(1);
            appState.airSpeedCalibrationPercent = clamped;
            void saveCurrentMultiSegmentSettings();
            log.debug('Air speed calibration changed - triggering Out and Back VE recalculation');
            const cda = parseFloat((document.getElementById('cdaValue') as HTMLInputElement)?.value || '0.3');
            const crr = parseFloat((document.getElementById('crrValue') as HTMLInputElement)?.value || '0.008');
            updateOutAndBackVEPlots(cda, crr);
        };

        airSpeedCalibrationSlider.addEventListener('input', updateAirSpeedCalibration);
        airSpeedCalibrationValueEl.addEventListener('change', updateAirSpeedCalibrationFromInput);

        const autoAdjustButton = document.getElementById('autoAdjustCalibration') as HTMLButtonElement;
        if (autoAdjustButton) {
            autoAdjustButton.addEventListener('click', () => {
                const calibrationRanges = appState.currentOutAndBackSections.flatMap(section => ([
                    { startIdx: section.outboundStartIdx, endIdx: section.outboundEndIdx },
                    { startIdx: section.inboundStartIdx, endIdx: section.inboundEndIdx },
                ]));
                const calibrationPercent = calculateAutoAirSpeedCalibrationPercent(
                    buildAutoCalibrationSegmentsFromRanges(calibrationRanges),
                );

                if (calibrationPercent === null) {
                    log.warn('Cannot auto-adjust out-and-back calibration: no usable FIT air speed data available');
                    return;
                }

                airSpeedCalibrationSlider.value = calibrationPercent.toFixed(1);
                airSpeedCalibrationValueEl.value = calibrationPercent.toFixed(1);
                appState.airSpeedCalibrationPercent = calibrationPercent;
                void saveCurrentMultiSegmentSettings();
                log.debug(`Auto-adjusted out-and-back air speed calibration to ${calibrationPercent.toFixed(1)}%`);
                const cda = parseFloat((document.getElementById('cdaValue') as HTMLInputElement)?.value || '0.3');
                const crr = parseFloat((document.getElementById('crrValue') as HTMLInputElement)?.value || '0.008');
                updateOutAndBackVEPlots(cda, crr);
            });
        }
    }

    // Setup action footer buttons
    bindActionFooter({
        onSaveScreenshot: () => { void saveOutAndBackScreenshot(); },
        onStoreResult: () => { void handleStoreResult(appState, resultsStorage); },
        onExportAll: () => { void handleExportAllResults(resultsStorage); },
    });

    // Initial plot render
    renderOutAndBackPlots(Plotly, profiles, meanElevation);

    // Scroll to the VE analysis section
    veSection.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

async function recalculateOutAndBackVE() {
    if (!appState.currentFitData || !appState.currentParameters || !appState.currentOutAndBackSections || appState.currentOutAndBackSections.length === 0) {
        log.error('Cannot recalculate Out and Back VE: missing data, parameters, or sections');
        return;
    }

    const cda = parseFloat((document.getElementById('cdaValue') as HTMLInputElement)?.value || '0.3');
    const crr = parseFloat((document.getElementById('crrValue') as HTMLInputElement)?.value || '0.008');
    const updatedParams = { ...appState.currentParameters, cda, crr };

    showLoading('Recalculating VE with new parameters...');

    try {
        await showOutAndBackVEAnalysis(
            appState.currentOutAndBackSections,
            appState.currentFitData,
            updatedParams,
            appState.currentParameters.air_speed_offset ?? 2,
            true,
        );
    } catch (err) {
        log.error('Out and Back recalculation failed:', err);
        hideLoading();
    }
}

/**
 * Setup slider-input sync for Out and Back controls with dynamic recalculation (uses standard slider IDs)
 */
function setupOutAndBackSliderSync() {
    const cdaSlider = document.getElementById('cdaSlider') as HTMLInputElement;
    const cdaValueEl = document.getElementById('cdaValue') as HTMLInputElement;
    const crrSlider = document.getElementById('crrSlider') as HTMLInputElement;
    const crrValueEl = document.getElementById('crrValue') as HTMLInputElement;

    // Helper to trigger recalculation
    const triggerRecalculation = () => {
        const cda = parseFloat(cdaValueEl?.value || '0.3');
        const crr = parseFloat(crrValueEl?.value || '0.008');
        updateOutAndBackVEPlots(cda, crr);
    };

    if (cdaSlider && cdaValueEl) {
        cdaSlider.addEventListener('input', () => {
            cdaValueEl.value = parseFloat(cdaSlider.value).toFixed(3);
            void saveCurrentMultiSegmentSettings();
            triggerRecalculation();
        });
        cdaValueEl.addEventListener('change', () => {
            cdaSlider.value = cdaValueEl.value;
            void saveCurrentMultiSegmentSettings();
            triggerRecalculation();
        });
    }

    if (crrSlider && crrValueEl) {
        crrSlider.addEventListener('input', () => {
            crrValueEl.value = parseFloat(crrSlider.value).toFixed(4);
            void saveCurrentMultiSegmentSettings();
            triggerRecalculation();
        });
        crrValueEl.addEventListener('change', () => {
            crrSlider.value = crrValueEl.value;
            void saveCurrentMultiSegmentSettings();
            triggerRecalculation();
        });
    }
}

function buildOutAndBackMultiSegmentSeries(profiles: OutAndBackVEProfile[]) {
    return profiles.flatMap((profile, index) => {
        const color = getMultiSegmentColor(index);
        const series = [] as Array<{
            label: string;
            color: string;
            metrics: SegmentSupplementarySeries;
            dash?: 'solid' | 'dash';
        }>;

        if (profile.outboundSeries) {
            series.push({
                label: `Section ${profile.sectionNumber} Out`,
                color,
                metrics: profile.outboundSeries,
            });
        }

        if (profile.inboundSeries) {
            series.push({
                label: `Section ${profile.sectionNumber} Back`,
                color,
                metrics: profile.inboundSeries,
                dash: 'dash',
            });
        }

        return series;
    });
}

/**
 * Render stacked Wind plot for Out and Back mode
 */
function renderOutAndBackWindPlot(profiles: OutAndBackVEProfile[]) {
    const Plotly = (window as any).Plotly;
    if (!Plotly) return;

    const plotDiv = document.getElementById('oabWindPlot');
    if (!plotDiv) return;

    const figure = buildMultiSegmentWindFigure({
        title: 'Apparent Wind Speed by Section',
        series: buildOutAndBackMultiSegmentSeries(profiles),
    });

    Plotly.newPlot('oabWindPlot', figure.data, figure.layout, figure.config);
}

/**
 * Render stacked Power plot for Out and Back mode
 */
function renderOutAndBackPowerPlot(profiles: OutAndBackVEProfile[]) {
    const Plotly = (window as any).Plotly;
    if (!Plotly) return;

    const plotDiv = document.getElementById('oabPowerPlot');
    if (!plotDiv) return;

    const figure = buildMultiSegmentPowerFigure({
        title: 'Power by Section',
        series: buildOutAndBackMultiSegmentSeries(profiles),
    });

    Plotly.newPlot('oabPowerPlot', figure.data, figure.layout, figure.config);
}

/**
 * Render stacked VD plot for Out and Back mode
 */
function renderOutAndBackVdPlot(profiles: OutAndBackVEProfile[]) {
    const Plotly = (window as any).Plotly;
    if (!Plotly) return;

    const plotDiv = document.getElementById('oabVdPlot');
    if (!plotDiv) return;

    const figure = buildMultiSegmentVirtualDistanceFigure({
        title: 'Virtual Distance Difference by Section',
        series: buildOutAndBackMultiSegmentSeries(profiles),
    });

    Plotly.newPlot('oabVdPlot', figure.data, figure.layout, figure.config);
}

/**
 * Save Out and Back VE plot as screenshot
 */
async function saveOutAndBackScreenshot() {
    const plotElement = document.getElementById('oabVePlot');
    if (!plotElement) return;

    try {
        const Plotly = await waitForPlotly();
        const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
        await Plotly.downloadImage('oabVePlot', {
            format: 'png',
            width: 1200,
            height: 600,
            filename: `out-and-back-ve-${timestamp}`
        });
    } catch (err) {
        log.error('Failed to save screenshot:', err);
    }
}

/**
 * Calculate statistics for Out and Back analysis
 */
function calculateOutAndBackStats(profiles: OutAndBackVEProfile[], meanElevation: { distances: number[]; elevation: number[] }): {
    rmse: number; avgVeGain: number; avgActualGain: number; avgDiff: number;
} {
    if (profiles.length === 0 || meanElevation.distances.length === 0) {
        return { rmse: 0, avgVeGain: 0, avgActualGain: 0, avgDiff: 0 };
    }

    let sumSquaredError = 0;
    let errorCount = 0;
    let totalClosingError = 0;
    let sectionCount = 0;

    // For out-and-back, actual gain is 0 since we return to the same point (gate A)
    // The mean elevation profile only covers A→B, but we go A→B→A
    const startElev = meanElevation.elevation[0];
    const endElev = meanElevation.elevation[meanElevation.elevation.length - 1];
    const avgActualGain = 0;  // Always 0 for out-and-back (we return to start)

    for (const profile of profiles) {
        // Track the last outbound VE for continuity
        let outboundLastVE = endElev;

        // Process outbound
        if (profile.outboundVE.length > 0 && profile.outboundDistances.length > 0) {
            const calibratedOutboundVE = profile.outboundVE.map((ve) =>
                ve - profile.outboundVE[0] + startElev
            );
            outboundLastVE = calibratedOutboundVE[calibratedOutboundVE.length - 1];

            // RMSE calculation for outbound
            for (let i = 0; i < profile.outboundDistances.length; i++) {
                const dist = profile.outboundDistances[i];
                const meanElev = interpolateElevation(dist, meanElevation.distances, meanElevation.elevation);
                if (!isNaN(meanElev)) {
                    const error = calibratedOutboundVE[i] - meanElev;
                    sumSquaredError += error * error;
                    errorCount++;
                }
            }
        }

        // Process inbound (mirrored) - continues from outbound's last VE
        if (profile.inboundVE.length > 0 && profile.inboundDistances.length > 0) {
            const maxDist = profile.inboundDistances[profile.inboundDistances.length - 1];
            const mirroredDistances = profile.inboundDistances.map(d => maxDist - d);

            // Inbound VE starts from where outbound ended (continuity)
            const calibratedInboundVE = profile.inboundVE.map((ve) =>
                ve - profile.inboundVE[0] + outboundLastVE
            );

            // VE Gain (closing error) = last inbound VE - start elevation
            // This is the difference at gate A between end of inbound and start of outbound
            const inboundLastVE = calibratedInboundVE[calibratedInboundVE.length - 1];
            totalClosingError += inboundLastVE - startElev;
            sectionCount++;

            // RMSE calculation for inbound
            for (let i = 0; i < mirroredDistances.length; i++) {
                const dist = mirroredDistances[i];
                const meanElev = interpolateElevation(dist, meanElevation.distances, meanElevation.elevation);
                if (!isNaN(meanElev)) {
                    const error = calibratedInboundVE[i] - meanElev;
                    sumSquaredError += error * error;
                    errorCount++;
                }
            }
        }
    }

    const rmse = errorCount > 0 ? Math.sqrt(sumSquaredError / errorCount) : 0;
    // avgVeGain is the average closing error (VE at end of inbound - VE at start of outbound)
    // For perfect CdA/Crr, this should be close to 0
    const avgVeGain = sectionCount > 0 ? totalClosingError / sectionCount : 0;

    return {
        rmse,
        avgVeGain,
        avgActualGain,
        avgDiff: avgVeGain - avgActualGain
    };
}

/**
 * Render Out and Back plots
 */
function renderOutAndBackPlots(
    Plotly: any,
    profiles: OutAndBackVEProfile[],
    meanElevation: { distances: number[]; elevation: number[] }
) {
    const veTraces: any[] = [];
    const residualTraces: any[] = [];

    // Color palette
    const colors = ['#4363d8', '#e6194b', '#3cb44b', '#f58231', '#911eb4', '#46f0f0', '#f032e6'];

    // Find max distance for plot range
    let maxDist = 0;
    for (const profile of profiles) {
        if (profile.outboundDistances.length > 0) {
            maxDist = Math.max(maxDist, profile.outboundDistances[profile.outboundDistances.length - 1]);
        }
        if (profile.inboundDistances.length > 0) {
            maxDist = Math.max(maxDist, profile.inboundDistances[profile.inboundDistances.length - 1]);
        }
    }

    // Plot mean actual elevation
    if (meanElevation.distances.length > 0) {
        veTraces.push({
            x: meanElevation.distances,
            y: meanElevation.elevation,
            mode: 'lines',
            name: 'Mean Actual Elevation',
            line: { color: 'black', width: 1 }
        });
    }

    const startElev = meanElevation.elevation.length > 0 ? meanElevation.elevation[0] : 0;
    const endElev = meanElevation.elevation.length > 0 ? meanElevation.elevation[meanElevation.elevation.length - 1] : 0;

    // Track closing errors for each section (VE at end of inbound vs actual start elevation)
    const closingErrors: { sectionNumber: number; error: number }[] = [];

    // Plot each section
    for (let i = 0; i < profiles.length; i++) {
        const profile = profiles[i];
        const color = colors[i % colors.length];

        // Track the last VE value from outbound for inbound continuity
        let outboundLastVE = endElev;  // Default to end elevation if no outbound data

        // Plot outbound VE (solid line)
        if (profile.outboundVE.length > 0) {
            const calibratedOutboundVE = profile.outboundVE.map((ve) =>
                ve - profile.outboundVE[0] + startElev
            );

            // Store the last calibrated VE value for inbound continuity
            outboundLastVE = calibratedOutboundVE[calibratedOutboundVE.length - 1];

            veTraces.push({
                x: profile.outboundDistances,
                y: calibratedOutboundVE,
                mode: 'lines',
                name: `Section ${profile.sectionNumber} (A→B)`,
                line: { color, width: 3 }
            });

            // Outbound residuals
            const residuals: number[] = [];
            const residualDists: number[] = [];
            for (let j = 0; j < profile.outboundDistances.length; j++) {
                const dist = profile.outboundDistances[j];
                const meanElev = interpolateElevation(dist, meanElevation.distances, meanElevation.elevation);
                if (!isNaN(meanElev)) {
                    residuals.push(calibratedOutboundVE[j] - meanElev);
                    residualDists.push(dist);
                }
            }
            residualTraces.push({
                x: residualDists,
                y: residuals,
                mode: 'lines',
                name: `Section ${profile.sectionNumber} (A→B)`,
                line: { color, width: 2 },
                showlegend: false
            });
        }

        // Plot inbound VE (dashed line, mirrored on x-axis)
        if (profile.inboundVE.length > 0) {
            const inboundMaxDist = profile.inboundDistances[profile.inboundDistances.length - 1];
            const mirroredDistances = profile.inboundDistances.map(d => inboundMaxDist - d);

            // Calibrate: inbound VE starts from where outbound VE ended (continuity)
            // The first inbound point (at turnaround B) should equal the last outbound VE value
            const calibratedInboundVE = profile.inboundVE.map((ve) =>
                ve - profile.inboundVE[0] + outboundLastVE
            );

            // Calculate closing error: last inbound VE vs actual start elevation
            const inboundLastVE = calibratedInboundVE[calibratedInboundVE.length - 1];
            const closingError = inboundLastVE - startElev;
            closingErrors.push({
                sectionNumber: profile.sectionNumber,
                error: closingError
            });

            veTraces.push({
                x: mirroredDistances,
                y: calibratedInboundVE,
                mode: 'lines',
                name: `Section ${profile.sectionNumber} (B→A)`,
                line: { color, width: 3, dash: 'dash' }
            });

            // Inbound residuals
            const residuals: number[] = [];
            const residualDists: number[] = [];
            for (let j = 0; j < mirroredDistances.length; j++) {
                const dist = mirroredDistances[j];
                const meanElev = interpolateElevation(dist, meanElevation.distances, meanElevation.elevation);
                if (!isNaN(meanElev)) {
                    residuals.push(calibratedInboundVE[j] - meanElev);
                    residualDists.push(dist);
                }
            }
            residualTraces.push({
                x: residualDists,
                y: residuals,
                mode: 'lines',
                name: `Section ${profile.sectionNumber} (B→A)`,
                line: { color, width: 2, dash: 'dash' },
                showlegend: false
            });
        }
    }

    // Display closing errors in a summary element
    const closingErrorDiv = document.getElementById('oabClosingError');
    if (closingErrorDiv && closingErrors.length > 0) {
        const avgError = closingErrors.reduce((sum, e) => sum + e.error, 0) / closingErrors.length;
        const errorDetails = closingErrors.map(e =>
            `Section ${e.sectionNumber}: ${e.error >= 0 ? '+' : ''}${e.error.toFixed(2)} m`
        ).join(' | ');
        closingErrorDiv.innerHTML = `<strong>Closing Error:</strong> ${errorDetails}` +
            (closingErrors.length > 1 ? ` | <strong>Avg:</strong> ${avgError >= 0 ? '+' : ''}${avgError.toFixed(2)} m` : '');
        closingErrorDiv.style.display = 'block';
    }

    // Plot layouts
    const veLayout = {
        title: 'Out & Back Virtual Elevation',
        xaxis: { title: 'Distance (km)', range: [0, maxDist * 1.02] },
        yaxis: { title: 'Elevation (m)' },
        legend: { orientation: 'h', y: -0.15 },
        margin: { t: 40, b: 80, l: 60, r: 20 },
        hovermode: 'closest'
    };

    const residualLayout = {
        title: 'VE Residuals (VE - Mean Elevation)',
        xaxis: { title: 'Distance (km)', range: [0, maxDist * 1.02] },
        yaxis: { title: 'Residual (m)' },
        margin: { t: 40, b: 60, l: 60, r: 20 },
        hovermode: 'closest',
        shapes: [{
            type: 'line', x0: 0, x1: maxDist, y0: 0, y1: 0,
            line: { color: 'gray', width: 1, dash: 'dot' }
        }]
    };

    Plotly.newPlot('oabVePlot', veTraces, veLayout, { responsive: true });
    Plotly.newPlot('oabVeResidualsPlot', residualTraces, residualLayout, { responsive: true });
}

/**
 * Update Out and Back VE plots with new CdA/Crr values
 */
async function updateOutAndBackVEPlots(cda: number, crr: number) {
    if (!appState.currentFitData || !appState.currentOutAndBackSections || appState.currentOutAndBackSections.length === 0 || !appState.currentParameters) {
        log.error('Missing data for Out and Back VE update');
        return;
    }

    const Plotly = await waitForPlotly();

    // Recalculate VE for all sections
    const profiles: OutAndBackVEProfile[] = [];

    const normalizedArrays = getNormalizedActivityArrays(appState.currentFitData);
    const allTimestamps = normalizedArrays.timestamps;
    const allPower = normalizedArrays.power;
    const allVelocity = normalizedArrays.velocity;
    const allPositionLat = normalizedArrays.positionLat;
    const allPositionLong = normalizedArrays.positionLong;
    const allAltitude = normalizedArrays.altitude;
    const allDistance = normalizedArrays.distance;

    // Handle wind/air speed via typed locals - check wind source selection
    const outAndBackUpdateWindResolution = resolveWindSeries({
        fitData: appState.currentFitData,
        windSource: getSelectedWindSource(),
        params: appState.currentParameters,
        airSpeedCalibrationPercent: appState.airSpeedCalibrationPercent,
    });
    const allWindSpeed = outAndBackUpdateWindResolution.windSpeed;

    if (outAndBackUpdateWindResolution.selectedWindSource === 'constant') {
        log.debug('Out and Back VE update: Using constant wind settings');
    } else if (outAndBackUpdateWindResolution.dataSource === 'air_speed') {
        log.debug(`Out and Back VE update: Using FIT air speed data (calibration: ${appState.airSpeedCalibrationPercent}%)`);
    } else if (outAndBackUpdateWindResolution.dataSource === 'wind_speed') {
        log.debug(`Out and Back VE update: Using FIT wind speed data (calibration: ${appState.airSpeedCalibrationPercent}%)`);
    } else {
        log.debug('Out and Back VE update: No wind data available');
    }

    for (const section of appState.currentOutAndBackSections) {
        const profile: OutAndBackVEProfile = {
            sectionNumber: section.sectionNumber,
            outboundDistances: [],
            outboundVE: [],
            outboundActualElevation: [],
            outboundSeries: null,
            inboundDistances: [],
            inboundVE: [],
            inboundActualElevation: [],
            inboundSeries: null,
            outboundDuration: section.outboundDuration,
            inboundDuration: section.inboundDuration,
            totalDistance: section.totalDistance
        };

        // Process outbound
        try {
            const outboundData = extractSegmentData({
                startIdx: section.outboundStartIdx,
                endIdx: section.outboundEndIdx,
                allTimestamps,
                allPower,
                allVelocity,
                allPositionLat,
                allPositionLong,
                allAltitude,
                allDistance,
                allWindSpeed,
            });

            if (outboundData.timestamps.length >= 10) {
                const calculator = createVeCalculator({
                    timestamps: outboundData.timestamps,
                    power: outboundData.power,
                    velocity: outboundData.velocity,
                    positionLat: outboundData.positionLat,
                    positionLong: outboundData.positionLong,
                    altitude: outboundData.altitude,
                    distance: outboundData.distance,
                    windSpeed: outboundData.windSpeed,
                    params: appState.currentParameters,
                    cda,
                    crr,
                });

                const result = calculator.calculate_virtual_elevation(cda, crr, 0, outboundData.timestamps.length - 1);
                const veArray = Array.from(result.virtual_elevation as Float64Array);

                profile.outboundSeries = buildSegmentSupplementarySeries({
                    timestamps: outboundData.timestamps,
                    power: outboundData.power,
                    velocity: outboundData.velocity,
                    positionLat: outboundData.positionLat,
                    positionLong: outboundData.positionLong,
                    distance: outboundData.distance,
                    windSpeed: outboundData.windSpeed,
                    params: appState.currentParameters,
                    selectedWindSource: outAndBackUpdateWindResolution.selectedWindSource,
                });
                profile.outboundDistances = profile.outboundSeries.distancesKm;
                profile.outboundVE = veArray;
                profile.outboundActualElevation = appState.currentParameters.velodrome
                    ? new Array(outboundData.altitude.length).fill(0)
                    : [...outboundData.altitude];
            }
        } catch (err) {
            log.error(`Failed to calculate outbound VE for section ${section.sectionNumber}:`, err);
        }

        // Process inbound
        try {
            const inboundData = extractSegmentData({
                startIdx: section.inboundStartIdx,
                endIdx: section.inboundEndIdx,
                allTimestamps,
                allPower,
                allVelocity,
                allPositionLat,
                allPositionLong,
                allAltitude,
                allDistance,
                allWindSpeed,
            });

            if (inboundData.timestamps.length >= 10) {
                const calculator = createVeCalculator({
                    timestamps: inboundData.timestamps,
                    power: inboundData.power,
                    velocity: inboundData.velocity,
                    positionLat: inboundData.positionLat,
                    positionLong: inboundData.positionLong,
                    altitude: inboundData.altitude,
                    distance: inboundData.distance,
                    windSpeed: inboundData.windSpeed,
                    params: appState.currentParameters,
                    cda,
                    crr,
                });

                const result = calculator.calculate_virtual_elevation(cda, crr, 0, inboundData.timestamps.length - 1);
                const veArray = Array.from(result.virtual_elevation as Float64Array);

                profile.inboundSeries = buildSegmentSupplementarySeries({
                    timestamps: inboundData.timestamps,
                    power: inboundData.power,
                    velocity: inboundData.velocity,
                    positionLat: inboundData.positionLat,
                    positionLong: inboundData.positionLong,
                    distance: inboundData.distance,
                    windSpeed: inboundData.windSpeed,
                    params: appState.currentParameters,
                    selectedWindSource: outAndBackUpdateWindResolution.selectedWindSource,
                });
                profile.inboundDistances = profile.inboundSeries.distancesKm;
                profile.inboundVE = veArray;
                profile.inboundActualElevation = appState.currentParameters.velodrome
                    ? new Array(inboundData.altitude.length).fill(0)
                    : [...inboundData.altitude];
            }
        } catch (err) {
            log.error(`Failed to calculate inbound VE for section ${section.sectionNumber}:`, err);
        }

        if (profile.outboundVE.length > 0 || profile.inboundVE.length > 0) {
            profiles.push(profile);
        }
    }

    if (profiles.length === 0) {
        log.error('No valid sections to display');
        return;
    }

    // Recalculate mean elevation
    const meanElevation = calculateOutAndBackMeanElevation(profiles);

    // Update statistics display
    const stats = calculateOutAndBackStats(profiles, meanElevation);
    const metricsDiv = document.getElementById('oabVeMetrics');
    if (metricsDiv) {
        metricsDiv.textContent = `RMSE: ${stats.rmse.toFixed(2)} m | VE: ${stats.avgVeGain.toFixed(2)} m | Actual: ${stats.avgActualGain.toFixed(2)} m | Diff: ${stats.avgDiff.toFixed(2)} m`;
    }

    // Update header values
    const veGainValueSpan = document.getElementById('oabVeGainValue');
    const actualGainValueSpan = document.getElementById('oabActualGainValue');
    if (veGainValueSpan) {
        veGainValueSpan.textContent = `${stats.avgVeGain.toFixed(2)}m`;
    }
    if (actualGainValueSpan) {
        actualGainValueSpan.textContent = `${stats.avgActualGain.toFixed(2)}m`;
    }

    // Re-render plots
    renderOutAndBackPlots(Plotly, profiles, meanElevation);

    const windTab = document.getElementById('wind-tab');
    if (windTab?.classList.contains('active')) {
        renderOutAndBackWindPlot(profiles);
    }
    const powerTab = document.getElementById('power-tab');
    if (powerTab?.classList.contains('active')) {
        renderOutAndBackPowerPlot(profiles);
    }
    const vdTab = document.getElementById('vd-tab');
    if (vdTab?.classList.contains('active')) {
        renderOutAndBackVdPlot(profiles);
    }

    log.debug(`Out and Back VE plots updated with ${profiles.length} sections, CdA=${cda.toFixed(3)}, Crr=${crr.toFixed(4)}`);
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