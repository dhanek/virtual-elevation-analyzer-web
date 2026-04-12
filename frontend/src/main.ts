import { DataProtection } from './utils/DataProtection';
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
import { calculateTrimRegionMetadata, formatCoordinates, roundToNearest15Min } from './utils/GeoCalculations';
import { WeatherAPI, WeatherAPIError } from './utils/WeatherAPI';
import { WeatherCache, type WeatherCacheEntry } from './utils/WeatherCache';
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
import { createAnalysisInput, type AnalysisInput } from './analysis/AnalysisInput';
import { getNormalizedActivityArrays } from './analysis/ActivityArrayCache';
import {
    buildSegmentSupplementarySeries,
    calculateConstantApparentWindSeries,
    type SegmentSupplementarySeries,
} from './analysis/SegmentSupplementarySeries';
import { extractSegmentData } from './analysis/SegmentExtractor';
import { createVeCalculator } from './analysis/VeCalculatorFactory';
import { applyAirSpeedOffset, calculateAirSpeedSyncError, resolveWindSeries } from './analysis/WindSourceResolver';
import { createPlotContext } from './plots/PlotContext';
import {
    buildSpeedPowerFigure,
    buildVirtualDistanceFigure,
    buildVirtualElevationComparisonFigures,
    buildVirtualElevationFigures,
    buildWindSpeedFigure,
} from './plots/StandardPlotBuilders';
import {
    buildMultiSegmentPowerFigure,
    buildMultiSegmentVirtualDistanceFigure,
    buildMultiSegmentWindFigure,
} from './plots/MultiSegmentPlotBuilders';
import { collectSelectionIndices, getAnalysisModeHandler } from './modes/analysis/AnalysisModes';
import init, { AirDensityCalculator } from '../pkg/virtual_elevation_analyzer.js';

// Plotly.js type declaration
declare const Plotly: any;

// Plotly monkey-patches an `on` method onto divs after `Plotly.newPlot()`
// to let callers subscribe to plotly_* events (e.g. plotly_relayout).
// Plotly's own @types aren't installed (it's loaded via CDN), so declare
// the minimum surface we use.
interface PlotlyHTMLElement extends HTMLElement {
    on(event: string, callback: (data: any) => void): void;
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

// Initialize security measures
DataProtection.setupContentSecurityPolicy();

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
    if (!DataProtection.validateFileType(file)) {
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
        const fileType = DataProtection.getFileType(appState.selectedFile);

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
        const isValidMagicNumber = await DataProtection.validateFitMagicNumber(file);
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

        // Trigger auto-rho calculation if enabled and we have GPS data
        if (parametersComponent?.getParameters().auto_calculate_rho && result.parsing_statistics.has_gps_data) {
            // Delay slightly to ensure trim sliders are initialized
            setTimeout(async () => {
                await calculateAutoRho();
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
async function calculateAutoRho(): Promise<number | null> {
    // Prevent infinite loops
    if (appState.isCalculatingAutoRho) {
        log.debug('⏭️  Auto-rho calculation already in progress, skipping\n');
        return null;
    }

    appState.isCalculatingAutoRho = true;

    log.debug('\n╔═══════════════════════════════════════════════════════════════╗');
    log.debug('║  🌦️  AUTO RHO CALCULATION STARTED                            ║');
    log.debug('╚═══════════════════════════════════════════════════════════════╝\n');

    if (!appState.currentFitData || !parametersComponent) {
        log.warn('❌ Cannot calculate auto rho: missing FIT data or parameters component');
        log.debug('  - appState.currentFitData:', !!appState.currentFitData);
        log.debug('  - parametersComponent:', !!parametersComponent);
        appState.isCalculatingAutoRho = false;
        return null;
    }

    const params = parametersComponent.getParameters();

    // Check if auto-calculate is enabled
    if (!params.auto_calculate_rho) {
        log.debug('⏭️  Auto-calculate disabled, skipping\n');
        appState.isCalculatingAutoRho = false;
        return null;
    }

    log.debug('✅ Auto-calculate enabled, proceeding...\n');

    try {
        // IMPORTANT: For auto-rho calculation, always use map trim sliders
        // Map trim sliders are relative to filtered lap data, which is what we need
        // Section 3 trim sliders are relative to full FIT data
        let trimStartSlider = document.getElementById('mapTrimStartSlider') as HTMLInputElement;
        let trimEndSlider = document.getElementById('mapTrimEndSlider') as HTMLInputElement;

        // Fallback to section 3 sliders only if map sliders don't exist
        if (!trimStartSlider || !trimEndSlider) {
            trimStartSlider = document.getElementById('trimStartSlider') as HTMLInputElement;
            trimEndSlider = document.getElementById('trimEndSlider') as HTMLInputElement;
            log.debug('🔍 Map trim sliders not found, using section 3 sliders...');
        } else {
            log.debug('🔍 Using map trim sliders (relative to filtered lap data)...');
        }

        log.debug('  - trimStartSlider exists:', !!trimStartSlider);
        log.debug('  - trimEndSlider exists:', !!trimEndSlider);

        if (!trimStartSlider || !trimEndSlider) {
            log.warn('❌ No trim sliders found - cannot calculate auto rho');
            log.debug('  This usually means the UI is not ready yet.');
            log.debug('  Will retry when sliders are available.\n');
            appState.isCalculatingAutoRho = false;
            return null;
        }

        const trimStart = parseInt(trimStartSlider.value);
        const trimEnd = parseInt(trimEndSlider.value);

        log.debug('📊 Trim region values:', {
            start: trimStart,
            end: trimEnd,
            dataPointsInRange: trimEnd - trimStart + 1
        });
        log.debug('');

        // Show loading state
        showLoading('Fetching weather data...');

        try {
            // Calculate GPS metadata from trim region
            // Use filtered lap data (only selected laps), not the full FIT data
            if (!appState.filteredLapData) {
                log.warn('❌ No filtered lap data available - cannot calculate auto rho');
                log.debug('  This usually means laps have not been selected yet.\n');
                hideLoading();
                appState.isCalculatingAutoRho = false;
                return null;
            }

            log.debug('🗺️  Calculating GPS metadata from trim region...');
            log.debug('  Using filtered lap data with', appState.filteredLapData.timestamps.length, 'data points');

            const metadata = calculateTrimRegionMetadata(
                appState.filteredLapData,
                trimStart,
                trimEnd
            );

            log.debug('═══════════════════════════════════════════════════════');
            log.debug('📍 TRIM REGION METADATA');
            log.debug('═══════════════════════════════════════════════════════');
            log.debug('  Location:', formatCoordinates(metadata.avgLat, metadata.avgLon));
            log.debug('  Coordinates:', `${metadata.avgLat}, ${metadata.avgLon}`);
            log.debug('  Date/Time:', metadata.middleDate.toISOString());
            log.debug('  Valid GPS Points:', metadata.dataPointCount);
            log.debug('  Trim Range:', `${trimStart} to ${trimEnd}`);
            log.debug('═══════════════════════════════════════════════════════\n');

            // Generate query key (rounded to nearest 15-min slot to match API granularity)
            const slot = roundToNearest15Min(metadata.middleDate);
            const queryKey = `${metadata.avgLat.toFixed(6)}_${metadata.avgLon.toFixed(6)}_${slot.date}_${String(slot.slotHour).padStart(2, '0')}:${String(slot.slotMinute).padStart(2, '0')}`;

            // Check if query has actually changed
            if (appState.lastWeatherQueryKey === queryKey) {
                log.debug('⏭️  Query unchanged from last calculation, using cached rho');
                log.debug('  Query key:', queryKey);
                hideLoading();
                appState.isCalculatingAutoRho = false;
                return params.rho; // Return current rho value
            }

            log.debug('🔄 Query changed, fetching new weather data');
            log.debug('  Previous:', appState.lastWeatherQueryKey || 'none');
            log.debug('  Current:', queryKey);
            log.debug('');

            // Update last query key
            appState.lastWeatherQueryKey = queryKey;

            // Initialize weather services
            const weatherCache = new WeatherCache();
            const weatherAPI = new WeatherAPI();

            // Get weather data (from cache or API)
            log.debug('🔄 Fetching weather data (checking cache first)...\n');
            let weatherEntry: WeatherCacheEntry = await weatherCache.getWeatherData(metadata, weatherAPI);

            // Check if cached entry has wind data - if not, re-fetch from API
            if (weatherEntry.source === 'cache' &&
                (weatherEntry.data.windSpeed === undefined || weatherEntry.data.windDirection === undefined)) {
                log.debug('⚠️  Cached entry missing wind data, re-fetching from API...');
                // Fetch directly from API to get complete data
                const freshData = await weatherAPI.fetchWeatherData(metadata);
                weatherEntry = {
                    key: weatherEntry.key,
                    data: freshData,
                    cachedAt: Date.now(),
                    source: 'api'
                };
                // Update cache with complete data
                await weatherCache.updateCachedEntry(metadata, freshData);
            }

            // Calculate air density using WASM
            log.debug('═══════════════════════════════════════════════════════');
            log.debug('🧮 CALCULATING AIR DENSITY');
            log.debug('═══════════════════════════════════════════════════════');
            log.debug('  Input:');
            log.debug('    - Temperature:', weatherEntry.data.temperature, '°C');
            log.debug('    - Pressure:', weatherEntry.data.pressure, 'hPa');
            log.debug('    - Dew Point:', weatherEntry.data.dewPoint, '°C');

            const rhoRaw = AirDensityCalculator.calculate_air_density(
                weatherEntry.data.temperature,
                weatherEntry.data.pressure,
                weatherEntry.data.dewPoint
            );

            // Round to 4 decimal places for practical use
            const rho = parseFloat(rhoRaw.toFixed(4));

            log.debug('  Output:');
            log.debug('    - Air Density (ρ):', rho, 'kg/m³');
            log.debug('    - Wind Speed:', weatherEntry.data.windSpeed, 'm/s');
            log.debug('    - Wind Direction:', weatherEntry.data.windDirection, '°');
            log.debug('    - Source:', weatherEntry.source === 'cache' ? '💾 Cache' : '⬇️ API');
            log.debug('═══════════════════════════════════════════════════════\n');

            // Update parameters with calculated rho, wind data, and weather metadata
            const updateParams: Partial<AnalysisParameters> = {
                rho,
                rho_source: weatherEntry.source === 'cache' ? 'weather_cache' : 'weather_api',
                weather_metadata: {
                    temperature: weatherEntry.data.temperature,
                    dewPoint: weatherEntry.data.dewPoint,
                    pressure: weatherEntry.data.pressure,
                    windSpeed: weatherEntry.data.windSpeed ?? 0,
                    windDirection: weatherEntry.data.windDirection ?? 0,
                    location: { lat: metadata.avgLat, lon: metadata.avgLon },
                    timestamp: metadata.middleDate.toISOString(),
                    source: weatherEntry.source
                }
            };

            // Only set wind parameters if they are valid numbers
            // Weather API always returns m/s, and we store wind_speed internally in m/s
            // (The UI converts to display unit automatically based on wind_speed_unit)
            if (weatherEntry.data.windSpeed !== undefined && weatherEntry.data.windSpeed !== null) {
                updateParams.wind_speed = weatherEntry.data.windSpeed;  // Always store in m/s
            }
            if (weatherEntry.data.windDirection !== undefined && weatherEntry.data.windDirection !== null) {
                updateParams.wind_direction = weatherEntry.data.windDirection;
            }

            parametersComponent.setParameters(updateParams);

            // Show success notification
            const sourceText = weatherEntry.source === 'cache' ? 'cached data' : 'weather API';
            showNotification(`Air density calculated: ${rho.toFixed(3)} kg/m³ (from ${sourceText})`, 'success');

            log.debug('╔═══════════════════════════════════════════════════════════════╗');
            log.debug('║  ✅ AUTO RHO CALCULATION COMPLETED SUCCESSFULLY              ║');
            log.debug('║  Final ρ: ' + rho.toFixed(3) + ' kg/m³                                     ║');
            log.debug('╚═══════════════════════════════════════════════════════════════╝\n');

            hideLoading();
            appState.isCalculatingAutoRho = false;
            return rho;

        } catch (error) {
            hideLoading();

            if (error instanceof WeatherAPIError) {
                log.error('Weather API error:', error.message, error.code);

                // Show user-friendly error message
                let userMessage = 'Could not fetch weather data: ';
                if (error.code === 'DATA_TOO_OLD') {
                    userMessage += 'Activity is too old (>92 days). Using manual rho value.';
                } else if (error.code === 'API_ERROR') {
                    userMessage += 'Weather service unavailable. Using manual rho value.';
                } else if (error.code === 'FETCH_ERROR') {
                    userMessage += 'Network error. Check your internet connection.';
                } else {
                    userMessage += error.message;
                }

                showNotification(userMessage, 'warning');
            } else {
                log.error('Failed to calculate auto rho:', error);
                const errorMsg = error instanceof Error ? error.message : 'Unknown error';
                showNotification(`Auto-rho calculation failed: ${errorMsg}`, 'error');
            }

            appState.isCalculatingAutoRho = false;
            return null;
        }

    } catch (error) {
        hideLoading();
        log.error('Unexpected error in calculateAutoRho:', error);
        showNotification('Failed to calculate air density. Using manual value.', 'error');
        appState.isCalculatingAutoRho = false;
        return null;
    }
}

/**
 * Show notification to user
 */
function showNotification(message: string, type: 'success' | 'warning' | 'error' = 'success'): void {
    // Create notification element if it doesn't exist
    let notification = document.getElementById('notification');

    if (!notification) {
        notification = document.createElement('div');
        notification.id = 'notification';
        notification.style.cssText = `
            position: fixed;
            top: 20px;
            right: 20px;
            padding: 12px 20px;
            border-radius: 4px;
            box-shadow: 0 2px 8px rgba(0,0,0,0.2);
            z-index: 10000;
            max-width: 400px;
            font-size: 0.9em;
            display: none;
        `;
        document.body.appendChild(notification);
    }

    // Set colors based on type
    const colors = {
        success: { bg: '#4CAF50', text: '#fff' },
        warning: { bg: '#FF9800', text: '#fff' },
        error: { bg: '#f44336', text: '#fff' }
    };

    notification.style.backgroundColor = colors[type].bg;
    notification.style.color = colors[type].text;
    notification.textContent = message;
    notification.style.display = 'block';

    // Auto-hide after 5 seconds
    setTimeout(() => {
        if (notification) {
            notification.style.display = 'none';
        }
    }, 5000);
}

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

function setupLapSelectionHandlers() {
    const selectAllBtn = document.getElementById('selectAllLaps');
    const lapList = document.getElementById('lapList');

    if (selectAllBtn) {
        selectAllBtn.addEventListener('click', toggleAllLaps);
    }

    if (lapList) {
        lapList.addEventListener('change', handleLapSelection);
        lapList.addEventListener('click', handleLapItemClick);
    }
}

// ==================== GPS Lap Detection Functions ====================

// Track if GPS lap detection event handlers have been set up
let gpsLapHandlersInitialized = false;
// Store reference to current handler function so we can update it
let gpsUpdateGateHandler: ((timeOffset: number) => void) | null = null;

/**
 * Setup GPS lap detection UI and handlers (slider-based gate positioning)
 */
async function setupGpsLapDetection() {
    if (!mapVisualization || !appState.currentFitData) return;

    const sliderControls = document.getElementById('gpsGateSliderControls');
    const gateSlider = document.getElementById('gpsGateSlider') as HTMLInputElement;
    const gateValue = document.getElementById('gpsGateValue') as HTMLInputElement;
    const gatePositionInfo = document.getElementById('gpsGatePositionInfo');

    if (!sliderControls || !gateSlider || !gateValue) {
        log.warn('GPS lap detection slider controls not found in DOM');
        return;
    }

    // Calculate the duration of selected data
    const timeRange = getSelectedDataTimeRange();
    const { duration } = timeRange;

    // Set slider max to duration in seconds
    const maxSeconds = Math.floor(duration);
    if (maxSeconds <= 0) {
        log.warn('Invalid duration for GPS lap detection:', maxSeconds);
        return;
    }

    gateSlider.max = String(maxSeconds);
    gateValue.max = String(maxSeconds);

    // Show slider controls
    sliderControls.style.display = 'block';

    // Load saved gate position or use default
    let initialOffset = 5; // Default 5 seconds
    if (appState.currentFileHash) {
        try {
            const savedMarker = await parameterStorage.loadGpsMarkerSettings(appState.currentFileHash, appState.selectedLaps);
            if (savedMarker && savedMarker.gateTimeOffset !== undefined) {
                initialOffset = savedMarker.gateTimeOffset;
                log.debug('Loading saved GPS gate time offset:', initialOffset);
            }
        } catch (err) {
            log.error('Failed to load saved GPS marker settings:', err);
        }
    }

    // Clamp to valid range
    initialOffset = Math.max(0, Math.min(initialOffset, maxSeconds));
    gateSlider.value = String(initialOffset);
    gateValue.value = String(initialOffset);

    // Helper to update gate position and run detection
    const updateGatePosition = async (timeOffset: number) => {
        // Re-fetch current time range to handle lap selection changes
        const currentTimeRange = getSelectedDataTimeRange();
        // Find the data index for this time offset
        const gateIndex = findDataIndexAtTimeOffset(timeOffset, currentTimeRange.startTime);
        if (gateIndex === null) return;

        const lat = appState.currentFitData!.position_lat[gateIndex];
        const lon = appState.currentFitData!.position_long[gateIndex];

        if (lat && lon && lat !== 0 && lon !== 0) {
            // Update position info display
            if (gatePositionInfo) {
                gatePositionInfo.textContent = `Position: ${lat.toFixed(5)}, ${lon.toFixed(5)}`;
            }

            // Show marker on map
            mapVisualization?.setGpsMarker(lat, lon);

            // Save settings
            if (appState.currentFileHash) {
                try {
                    await parameterStorage.saveGpsMarkerSettings(appState.currentFileHash, appState.selectedLaps, {
                        gateTimeOffset: timeOffset
                    });
                } catch (err) {
                    log.error('Failed to save GPS marker settings:', err);
                }
            }

            // Run lap detection
            runGpsLapDetection(lat, lon, gateIndex);
        }
    };

    // Store reference to update handler
    gpsUpdateGateHandler = updateGatePosition;

    // Only add event handlers once
    if (!gpsLapHandlersInitialized) {
        // Setup slider event handlers
        gateSlider.addEventListener('input', () => {
            gateValue.value = gateSlider.value;
            gpsUpdateGateHandler?.(parseInt(gateSlider.value));
        });

        gateValue.addEventListener('change', () => {
            const maxSecondsNow = parseInt(gateSlider.max);
            const val = Math.max(0, Math.min(parseInt(gateValue.value) || 0, maxSecondsNow));
            gateValue.value = String(val);
            gateSlider.value = String(val);
            gpsUpdateGateHandler?.(val);
        });

        gpsLapHandlersInitialized = true;
        log.debug('GPS lap detection slider handlers initialized');
    }

    // Initial detection with loaded/default offset
    updateGatePosition(initialOffset);
}

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

// ==================== Out and Back Detection Functions ====================

// Track if Out and Back event handlers have been set up
let outAndBackHandlersInitialized = false;
// Store references to current handler functions so we can update them
let oabUpdateGatesHandler: (() => void) | null = null;

/**
 * Setup Out and Back detection UI and handlers (slider-based gate positioning)
 */
async function setupOutAndBackDetection() {
    if (!mapVisualization || !appState.currentFitData) return;

    const sliderControls = document.getElementById('oabGateSliderControls');
    const gateASlider = document.getElementById('oabGateASlider') as HTMLInputElement;
    const gateAValue = document.getElementById('oabGateAValue') as HTMLInputElement;
    const gateAInfo = document.getElementById('oabGateAInfo');
    const gateBSlider = document.getElementById('oabGateBSlider') as HTMLInputElement;
    const gateBValue = document.getElementById('oabGateBValue') as HTMLInputElement;
    const gateBInfo = document.getElementById('oabGateBInfo');

    if (!sliderControls || !gateASlider || !gateAValue || !gateBSlider || !gateBValue) {
        log.warn('Out and Back slider controls not found in DOM');
        return;
    }

    // Calculate the duration of selected data
    const timeRange = getSelectedDataTimeRange();
    const { duration } = timeRange;

    // Set slider max to duration in seconds
    const maxSeconds = Math.floor(duration);
    if (maxSeconds <= 0) {
        log.warn('Invalid duration for Out and Back detection:', maxSeconds);
        return;
    }

    gateASlider.max = String(maxSeconds);
    gateAValue.max = String(maxSeconds);
    gateBSlider.max = String(maxSeconds);
    gateBValue.max = String(maxSeconds);

    // Show slider controls
    sliderControls.style.display = 'block';

    // Load saved gate positions or use defaults
    let initialOffsetA = 5;  // Default 5 seconds
    let initialOffsetB = Math.min(60, maxSeconds - 5);  // Default 60 seconds or near end
    if (appState.currentFileHash) {
        try {
            const savedMarkers = await parameterStorage.loadOutAndBackMarkerSettings(appState.currentFileHash, appState.selectedLaps);
            if (savedMarkers && savedMarkers.gateATimeOffset !== undefined && savedMarkers.gateBTimeOffset !== undefined) {
                initialOffsetA = savedMarkers.gateATimeOffset;
                initialOffsetB = savedMarkers.gateBTimeOffset;
                log.debug('Loading saved Out and Back gate time offsets:', { A: initialOffsetA, B: initialOffsetB });
            }
        } catch (err) {
            log.error('Failed to load saved Out and Back marker settings:', err);
        }
    }

    // Clamp to valid range
    initialOffsetA = Math.max(0, Math.min(initialOffsetA, maxSeconds - 1));
    initialOffsetB = Math.max(initialOffsetA + 1, Math.min(initialOffsetB, maxSeconds));
    gateASlider.value = String(initialOffsetA);
    gateAValue.value = String(initialOffsetA);
    gateBSlider.value = String(initialOffsetB);
    gateBValue.value = String(initialOffsetB);

    // Helper to get gate position info from time offset (uses current startTime from closure)
    const getGatePosition = (timeOffset: number) => {
        // Re-fetch current time range to handle lap selection changes
        const currentTimeRange = getSelectedDataTimeRange();
        const gateIndex = findDataIndexAtTimeOffset(timeOffset, currentTimeRange.startTime);
        if (gateIndex === null) return null;

        const lat = appState.currentFitData!.position_lat[gateIndex];
        const lon = appState.currentFitData!.position_long[gateIndex];

        if (lat && lon && lat !== 0 && lon !== 0) {
            return { lat, lon, index: gateIndex };
        }
        return null;
    };

    // Helper to update gates and run detection
    const updateGates = async () => {
        const offsetA = parseInt(gateASlider.value);
        const offsetB = parseInt(gateBSlider.value);

        const posA = getGatePosition(offsetA);
        const posB = getGatePosition(offsetB);

        // Update info displays
        if (gateAInfo && posA) {
            gateAInfo.textContent = `Position: ${posA.lat.toFixed(5)}, ${posA.lon.toFixed(5)}`;
        }
        if (gateBInfo && posB) {
            gateBInfo.textContent = `Position: ${posB.lat.toFixed(5)}, ${posB.lon.toFixed(5)}`;
        }

        // Update markers on map
        if (posA) mapVisualization?.setGpsMarkerA(posA.lat, posA.lon);
        if (posB) mapVisualization?.setGpsMarkerB(posB.lat, posB.lon);

        // Save settings
        if (appState.currentFileHash) {
            try {
                await parameterStorage.saveOutAndBackMarkerSettings(appState.currentFileHash, appState.selectedLaps, {
                    gateATimeOffset: offsetA,
                    gateBTimeOffset: offsetB
                });
            } catch (err) {
                log.error('Failed to save Out and Back marker settings:', err);
            }
        }

        // Run detection if both positions are valid
        if (posA && posB) {
            runOutAndBackDetection(posA.lat, posA.lon, posB.lat, posB.lon);
        }
    };

    // Store reference to update handler
    oabUpdateGatesHandler = updateGates;

    // Only add event handlers once
    if (!outAndBackHandlersInitialized) {
        // Setup slider event handlers for Gate A
        gateASlider.addEventListener('input', () => {
            let val = parseInt(gateASlider.value);
            const maxA = parseInt(gateBSlider.value) - 1;
            if (val >= maxA) {
                val = maxA;
                gateASlider.value = String(val);
            }
            gateAValue.value = String(val);
            oabUpdateGatesHandler?.();
        });

        gateAValue.addEventListener('change', () => {
            const maxA = parseInt(gateBSlider.value) - 1;
            let val = Math.max(0, Math.min(parseInt(gateAValue.value) || 0, maxA));
            gateAValue.value = String(val);
            gateASlider.value = String(val);
            oabUpdateGatesHandler?.();
        });

        // Setup slider event handlers for Gate B
        gateBSlider.addEventListener('input', () => {
            let val = parseInt(gateBSlider.value);
            const minB = parseInt(gateASlider.value) + 1;
            if (val <= minB) {
                val = minB;
                gateBSlider.value = String(val);
            }
            gateBValue.value = String(val);
            oabUpdateGatesHandler?.();
        });

        gateBValue.addEventListener('change', () => {
            const maxSecondsNow = parseInt(gateBSlider.max);
            const minB = parseInt(gateASlider.value) + 1;
            let val = Math.max(minB, Math.min(parseInt(gateBValue.value) || 0, maxSecondsNow));
            gateBValue.value = String(val);
            gateBSlider.value = String(val);
            oabUpdateGatesHandler?.();
        });

        outAndBackHandlersInitialized = true;
        log.debug('Out and Back slider handlers initialized');
    }

    // Initial detection with loaded/default offsets
    updateGates();
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
        setupOutAndBackDetection();
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

function toggleAllLaps() {
    const checkboxes = document.querySelectorAll('.lap-checkbox') as NodeListOf<HTMLInputElement>;
    const anySelected = Array.from(checkboxes).some(cb => cb.checked);

    // If any are selected, deselect all; otherwise select all
    checkboxes.forEach(cb => {
        cb.checked = !anySelected;
        const item = cb.closest('.lap-checkbox-item');
        if (item) {
            if (cb.checked) {
                item.classList.add('selected');
            } else {
                item.classList.remove('selected');
            }
        }
    });

    updateSelectedLaps();
}

function handleLapSelection(event: Event) {
    if (event.target instanceof HTMLInputElement && event.target.classList.contains('lap-checkbox')) {
        const item = event.target.closest('.lap-checkbox-item');
        if (item) {
            if (event.target.checked) {
                item.classList.add('selected');
            } else {
                item.classList.remove('selected');
            }
        }
        updateSelectedLaps();
    }
}

function handleLapItemClick(event: Event) {
    if (!event.target) return;

    const target = event.target as Element;
    const item = target.closest('.lap-checkbox-item');
    if (item && !target.classList.contains('lap-checkbox')) {
        const checkbox = item.querySelector('.lap-checkbox') as HTMLInputElement;
        if (checkbox) {
            checkbox.checked = !checkbox.checked;
            if (checkbox.checked) {
                item.classList.add('selected');
            } else {
                item.classList.remove('selected');
            }
            updateSelectedLaps();
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
    mapTrimStartSlider.max = (dataLength - 30).toString();
    mapTrimStartSlider.value = '0';
    mapTrimStartValue.value = '0';
    mapTrimStartValue.min = '0';
    mapTrimStartValue.max = (dataLength - 30).toString();

    mapTrimEndSlider.min = '30';
    mapTrimEndSlider.max = (dataLength - 1).toString();
    mapTrimEndSlider.value = (dataLength - 1).toString();
    mapTrimEndValue.value = (dataLength - 1).toString();
    mapTrimEndValue.min = '30';
    mapTrimEndValue.max = (dataLength - 1).toString();

}

/**
 * Update GPS gate slider visibility based on FIT lap selection
 * The slider is shown when FIT laps are selected and GPS lap mode is enabled
 */
function updateGpsMarkerButtonState() {
    const sliderControls = document.getElementById('gpsGateSliderControls');

    const lapDetectionMode = appState.currentParameters?.auto_lap_detection || 'None';
    const isGpsLapMode = lapDetectionMode === 'GPS based lap splitting';

    if (!isGpsLapMode) {
        // GPS lap detection is not enabled
        if (sliderControls) sliderControls.style.display = 'none';
        return;
    }

    if (appState.selectedLaps.length > 0) {
        // FIT laps are selected - setup and show slider controls
        setupGpsLapDetection();
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

    // Show/hide trim controls based on lap selection
    const mapTrimControls = document.getElementById('mapTrimControls');
    if (mapTrimControls) {
        if (appState.selectedLaps.length > 0) {
            mapTrimControls.style.display = 'flex';
            // Calculate total duration of selected laps
            initializeMapTrimControlsForSelectedLaps();

            // Trigger auto-rho calculation when laps are selected (trim sliders now available)
            if (appState.currentParameters?.auto_calculate_rho && !appState.isCalculatingAutoRho) {
                setTimeout(() => {
                    calculateAutoRho().catch(err => {
                        log.error('Auto-rho calculation error on lap selection:', err);
                    });
                }, 500); // Small delay to ensure sliders are initialized
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
                const clamped = Math.max(0, Math.min(value, trimEnd - 30));
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
                const clamped = Math.max(appState.presetTrimStart + 30, Math.min(value, dataLength - 1));
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
                    calculateAutoRho().catch(err => {
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
            calculateAutoRho().catch(err => {
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

    // Reset handler initialization flags since HTML is being recreated
    gpsLapHandlersInitialized = false;
    outAndBackHandlersInitialized = false;

    const hasGpsData = appState.currentFitResult?.parsing_statistics?.has_gps_data ?? false;
    const lapDetectionMode = appState.currentParameters?.auto_lap_detection || 'None';
    const showGpsLapDetection = hasGpsData && lapDetectionMode === 'GPS based lap splitting';
    const showOutAndBack = hasGpsData && lapDetectionMode === 'GPS based out and back';

    // Update the analysis section with map and lap selection (map only if GPS available)
    // ALWAYS show FIT lap selection first, then GPS detection panel below if enabled
    const analysisHtml = `
        <div class="analysis-layout">
            <div class="analysis-sidebar">
                <!-- FIT Lap Selection (always shown) -->
                <div class="lap-selection">
                    <h4>Lap Selection</h4>
                    <div class="lap-controls">
                        <button class="select-all-btn" id="selectAllLaps">Select / Deselect All</button>
                    </div>
                    <div class="lap-list" id="lapList">
                        ${laps.map((lap: any, index: number) => `
                            <div class="lap-checkbox-item" data-lap="${index + 1}">
                                <input type="checkbox" class="lap-checkbox" id="lap-${index + 1}">
                                <div class="lap-info">
                                    <div class="lap-number">Lap ${index + 1}</div>
                                    <div class="lap-details">
                                        ${formatDuration(lap.total_elapsed_time)} •
                                        ${formatDistance(lap.total_distance)} •
                                        ${lap.avg_power > 0 ? formatPower(lap.avg_power) : 'N/A'}
                                    </div>
                                </div>
                            </div>
                        `).join('')}
                    </div>
                </div>
                ${showGpsLapDetection ? `
                <!-- GPS Lap Detection Panel (shown below lap selection when enabled) -->
                <div class="gps-lap-detection-panel" id="gpsLapDetectionPanel" style="margin-top: 0.5rem;">
                    <h4>GPS Virtual Lap Detection</h4>
                    <p style="font-size: 0.75rem; color: #666; margin-bottom: 0.5rem;">
                        Select FIT laps above, then set gate position to detect virtual laps.
                    </p>
                    <div class="gps-gate-slider-controls" id="gpsGateSliderControls" style="display: none;">
                        <div style="display: flex; align-items: center; gap: 0.5rem; margin-bottom: 0.5rem;">
                            <label style="font-size: 0.85rem; white-space: nowrap;">Gate Position:</label>
                            <input type="range" id="gpsGateSlider" min="0" max="100" value="5" step="1" style="flex: 1;">
                            <input type="number" id="gpsGateValue" value="5" min="0" step="1" style="width: 50px; text-align: right;">
                            <span style="font-size: 0.85rem;">s</span>
                        </div>
                        <div id="gpsGatePositionInfo" style="font-size: 0.75rem; color: #666;"></div>
                    </div>
                    <div id="gpsDetectedLapsInfo" style="margin-top: 1rem; display: none;">
                        <div style="font-size: 0.9em; color: #666; margin-bottom: 0.5rem;">
                            Detected <span id="gpsLapCount">0</span> virtual laps
                        </div>
                        <div class="lap-list" id="gpsLapList" style="max-height: 200px; overflow-y: auto;">
                            <!-- GPS detected laps will be populated here -->
                        </div>
                    </div>
                </div>
                ` : ''}
                ${showOutAndBack ? `
                <!-- Out and Back Detection Panel -->
                <div class="gps-lap-detection-panel" id="outAndBackPanel" style="margin-top: 0.5rem;">
                    <h4>Out & Back Detection</h4>
                    <p style="font-size: 0.75rem; color: #666; margin-bottom: 0.5rem;">
                        Set two gates: A (start/end) and B (turnaround). B must be after A.
                    </p>
                    <div class="oab-gate-slider-controls" id="oabGateSliderControls" style="display: none;">
                        <div style="margin-bottom: 0.75rem;">
                            <div style="display: flex; align-items: center; gap: 0.5rem; margin-bottom: 0.25rem;">
                                <label style="font-size: 0.85rem; white-space: nowrap; color: #00aa00; font-weight: 500;">Gate A:</label>
                                <input type="range" id="oabGateASlider" min="0" max="100" value="5" step="1" style="flex: 1;">
                                <input type="number" id="oabGateAValue" value="5" min="0" step="1" style="width: 50px; text-align: right;">
                                <span style="font-size: 0.85rem;">s</span>
                            </div>
                            <div id="oabGateAInfo" style="font-size: 0.75rem; color: #666; margin-left: 3.5rem;"></div>
                        </div>
                        <div>
                            <div style="display: flex; align-items: center; gap: 0.5rem; margin-bottom: 0.25rem;">
                                <label style="font-size: 0.85rem; white-space: nowrap; color: #0066cc; font-weight: 500;">Gate B:</label>
                                <input type="range" id="oabGateBSlider" min="0" max="100" value="60" step="1" style="flex: 1;">
                                <input type="number" id="oabGateBValue" value="60" min="0" step="1" style="width: 50px; text-align: right;">
                                <span style="font-size: 0.85rem;">s</span>
                            </div>
                            <div id="oabGateBInfo" style="font-size: 0.75rem; color: #666; margin-left: 3.5rem;"></div>
                        </div>
                    </div>
                    <div id="outAndBackSectionsInfo" style="margin-top: 1rem; display: none;">
                        <div style="font-size: 0.9em; color: #666; margin-bottom: 0.5rem;">
                            Detected <span id="outAndBackSectionCount">0</span> out-and-back sections
                        </div>
                        <div class="lap-list" id="outAndBackSectionList" style="max-height: 200px; overflow-y: auto;">
                            <!-- Out and Back sections will be populated here -->
                        </div>
                    </div>
                </div>
                ` : ''}
                <div class="map-trim-controls" id="mapTrimControls" style="display: none;">
                    <div class="map-trim-group">
                        <label>Trim Start:</label>
                        <input type="range" id="mapTrimStartSlider" class="ve-slider-compact">
                        <input type="number" id="mapTrimStartValue" class="ve-value-input-compact">
                    </div>
                    <div class="map-trim-group">
                        <label>Trim End:</label>
                        <input type="range" id="mapTrimEndSlider" class="ve-slider-compact">
                        <input type="number" id="mapTrimEndValue" class="ve-value-input-compact">
                    </div>
                </div>
            </div>
            ${hasGpsData ? `
            <div class="analysis-main">
                <div class="map-container">
                    <div id="mapView"></div>
                </div>
            </div>
            ` : `
            <div class="analysis-main">
                <div style="padding: 2rem; text-align: center; background: #f7fafc; border: 2px dashed #cbd5e0; border-radius: 8px;">
                    <div style="font-size: 3rem; margin-bottom: 1rem;">📍</div>
                    <h3 style="margin-bottom: 0.5rem;">No GPS Data Available</h3>
                    <p style="color: #718096; margin-bottom: 1rem;">This file contains power and speed data but no GPS coordinates.</p>
                    <p style="color: #718096; margin: 0;">Velodrome mode has been automatically enabled (zero altitude reference).</p>
                </div>
            </div>
            `}
        </div>
        <div class="analysis-actions" style="margin-top: 2rem;">
            <button id="analyzeBtn" class="primary-btn" disabled>Select Laps to Analyze</button>
        </div>
    `;

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
                    setupGpsLapDetection();
                }

                // Setup Out and Back detection if enabled
                if (showOutAndBack) {
                    setupOutAndBackDetection();
                }
            } else {
                log.debug('No GPS data - skipping map initialization');
            }

            // Always setup lap selection handlers (FIT laps always shown)
            setupLapSelectionHandlers();
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
        const isGpsLapMode = lapDetectionMode === 'GPS based lap splitting';
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
        const allTimestamps = normalizedArrays.timestamps;
        const allPower = normalizedArrays.power;
        const allVelocity = normalizedArrays.velocity;
        const allPositionLat = normalizedArrays.positionLat;
        const allPositionLong = normalizedArrays.positionLong;
        const allAltitude = normalizedArrays.altitude;
        const allDistance = normalizedArrays.distance;
        const hasWindYaw = normalizedArrays.windYaw.some((yaw: number) => !isNaN(yaw) && yaw !== 0);
        const initialWindResolution = resolveWindSeries({
            fitData,
            windSource: 'fit',
            applyOffset: false,
        });
        const { defaultAirSpeedOffset } = initialWindResolution;
        const allWindSpeed = initialWindResolution.windSpeed;

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

        const allAirDensity = normalizedArrays.airDensity;
        const allTemperature = normalizedArrays.temperature;

        const hasRoadSpeed = normalizedArrays.roadSpeed.some((v: number) => !isNaN(v) && v !== 0);
        const hasEnhancedSpeed = allVelocity.some((v: number) => !isNaN(v) && v !== 0);
        if (hasRoadSpeed && hasEnhancedSpeed) {
            log.debug('🚴 Found enhanced speed and road speed, prefer road speed');
        }

        const selectedIndices = collectSelectionIndices(selection, allTimestamps);

        const filteredTimestamps: number[] = [];
        const filteredPower: number[] = [];
        const filteredVelocity: number[] = [];
        const filteredPositionLat: number[] = [];
        const filteredPositionLong: number[] = [];
        const filteredAltitude: number[] = [];
        const filteredDistance: number[] = [];
        const filteredWindSpeed: number[] = [];
        const filteredAirDensity: number[] = [];
        const filteredTemperature: number[] = [];

        for (const index of selectedIndices) {
            filteredTimestamps.push(allTimestamps[index]);
            filteredPower.push(allPower[index]);
            filteredVelocity.push(allVelocity[index]);
            filteredPositionLat.push(allPositionLat[index]);
            filteredPositionLong.push(allPositionLong[index]);
            filteredAltitude.push(allAltitude[index]);
            filteredDistance.push(allDistance[index]);
            filteredWindSpeed.push(allWindSpeed[index]);
            filteredAirDensity.push(allAirDensity[index] || 0);
            filteredTemperature.push(allTemperature[index] || 0);
        }

        if (filteredTimestamps.length === 0) {
            throw new Error('No valid data points found in selected laps');
        }

        const powerDataPoints = filteredPower.filter(p => p > 0).length;
        if (powerDataPoints < filteredTimestamps.length * 0.5) {
            log.warn(`Only ${powerDataPoints}/${filteredTimestamps.length} records have power data`);
        }

        showLoading('Running Virtual Elevation calculation...');

        appState.currentRhoArray = null;
        const hasAirDensityData = filteredAirDensity.length > 0 &&
            filteredAirDensity.some(rho => !isNaN(rho) && rho > 0);

        if (hasAirDensityData) {
            log.debug('💨 Found air density data, using it for calculations');
            appState.currentRhoArray = filteredAirDensity;
        } else {
            const hasEnvironmentalData = fitData.temperature && fitData.humidity && fitData.pressure;
            if (hasEnvironmentalData) {
                const fullRhoArray = calculateRhoArrayFromFitData(fitData);
                if (fullRhoArray) {
                    appState.currentRhoArray = selectedIndices.map(index => fullRhoArray[index]);
                    log.debug('💨 Calculated air density from environmental data');
                }
            } else {
                log.debug('💨 No air density found, using constant value from weather API');
            }
        }

        const calculator = createVeCalculator({
            timestamps: filteredTimestamps,
            power: filteredPower,
            velocity: filteredVelocity,
            positionLat: filteredPositionLat,
            positionLong: filteredPositionLong,
            altitude: filteredAltitude,
            distance: filteredDistance,
            windSpeed: filteredWindSpeed,
            rhoArray: appState.currentRhoArray,
            params: appState.currentParameters,
            cda: appState.currentParameters.cda,
            crr: appState.currentParameters.crr,
        });

        const cda = appState.currentParameters.cda ?? 0.3;
        const crr = appState.currentParameters.crr ?? 0.008;
        const trimStart = 0;
        const trimEnd = filteredTimestamps.length - 1;
        const result = calculator.calculate_virtual_elevation(cda, crr, trimStart, trimEnd);

        let filteredCdaReference: number[] | null = null;
        if (normalizedArrays.cdaReference) {
            log.debug('📊 Data has CdA reference - will enable validation tab');
            filteredCdaReference = selectedIndices.map(index => normalizedArrays.cdaReference![index]);
        }

        hideLoading();

        appState.filteredVEData = {
            positionLat: filteredPositionLat,
            positionLong: filteredPositionLong,
        };

        modeHandler.syncState(appState, selection);

        await modeHandler.render({
            appState,
            selection,
            fitData,
            params: appState.currentParameters,
            defaultAirSpeedOffset,
            initialResult: result,
            filteredData: {
                timestamps: filteredTimestamps,
                power: filteredPower,
                velocity: filteredVelocity,
                positionLat: filteredPositionLat,
                positionLong: filteredPositionLong,
                altitude: filteredAltitude,
                distance: filteredDistance,
                windSpeed: filteredWindSpeed,
                temperature: filteredTemperature,
                cdaReference: filteredCdaReference,
            },
            callbacks: {
                standard: ({ initialResult, analyzedLaps, timestamps, power, velocity, positionLat, positionLong, altitude, distance, windSpeed, temperature, cdaReference, defaultAirSpeedOffset }) =>
                    showVirtualElevationAnalysisInline(
                        initialResult,
                        analyzedLaps,
                        timestamps,
                        power,
                        velocity,
                        positionLat,
                        positionLong,
                        altitude,
                        distance,
                        windSpeed,
                        temperature,
                        cdaReference,
                        defaultAirSpeedOffset,
                    ),
                gpsLap: ({ lapIndexRanges, fitData, params, defaultAirSpeedOffset }) =>
                    showGpsLapVEAnalysis(lapIndexRanges, fitData, params, defaultAirSpeedOffset),
                outAndBack: ({ sections, fitData, params, defaultAirSpeedOffset }) =>
                    showOutAndBackVEAnalysis(sections, fitData, params, defaultAirSpeedOffset),
            },
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
    defaultAirSpeedOffset: number
) {
    showLoading('Calculating VE for each lap...');

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
    const windSourceRadio = document.querySelector('input[name="windSource"]:checked') as HTMLInputElement;
    const gpsLapWindResolution = resolveWindSeries({
        fitData,
        windSource: windSourceRadio ? windSourceRadio.value : null,
        params,
        airSpeedCalibrationPercent: appState.airSpeedCalibrationPercent,
    });
    const {
        hasAirSpeed,
        hasWindSpeed,
        defaultAirSpeedOffset: defaultOffset,
        windSpeed: allWindSpeed,
    } = gpsLapWindResolution;
    const windSpeedOffset = params?.air_speed_offset ?? defaultOffset;

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
    const cda = params.cda ?? 0.3;
    const crr = params.crr ?? 0.008;

    // Calculate VE for each lap
    for (let lapIdx = 0; lapIdx < lapIndexRanges.length; lapIdx++) {
        const range = lapIndexRanges[lapIdx];
        const lapNumber = appState.gpsDetectedLaps[lapIdx]?.lapNumber ?? (lapIdx + 1);

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
            params,
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
                params,
                cda,
                crr,
            });

            // Calculate VE for full lap
            const result = calculator.calculate_virtual_elevation(cda, crr, 0, lapTimestamps.length - 1);

            // Extract VE values
            const veArray = Array.from(result.virtual_elevation as Float64Array);

            // Get actual elevation (use zeros for velodrome mode)
            const actualElevation = params.velodrome
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
    const hasConstantWind = params.wind_speed !== undefined && params.wind_speed !== 0 &&
                            params.wind_direction !== undefined;

    // Preserve current wind source selection if UI exists (for recalculations)
    const currentWindSourceRadio = document.querySelector('input[name="windSource"]:checked') as HTMLInputElement;
    const preservedWindSource = currentWindSourceRadio ? currentWindSourceRadio.value : null;

    // Show the GPS lap VE analysis interface with wind data info
    showGpsLapVEPlot(lapVEProfiles, meanElevationProfile, params, hasAirSpeed || hasWindSpeed, hasConstantWind, defaultAirSpeedOffset, preservedWindSource);
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

    // Store lap profiles globally for recalculation
    (window as any).__gpsLapProfiles = lapProfiles;
    (window as any).__gpsMeanElevation = meanElevation;

    // Calculate initial statistics
    const initialStats = calculateGpsLapStats(lapProfiles, meanElevation);

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
                                    <input type="number" id="airSpeedCalibrationValue" value="0.0" step="0.1" min="-20.0" max="20.0"
                                           style="width: 60px; text-align: right;" />
                                    <span>%</span>
                                </div>
                                <input type="range" id="airSpeedCalibrationSlider" min="-20.0" max="20.0" step="0.1" value="0.0" />
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
    setupGpsLapTabSwitching(lapProfiles, showWindTab, showVirtualDistanceTab);

    // Setup wind source radio button listeners
    const windSourceRadios = document.querySelectorAll('input[name="windSource"]');
    windSourceRadios.forEach(radio => {
        radio.addEventListener('change', () => {
            log.debug('Wind source changed - triggering GPS lap VE recalculation');
            recalculateGpsLapVE();
        });
    });

    // Setup air speed calibration listeners
    const airSpeedCalibrationSlider = document.getElementById('airSpeedCalibrationSlider') as HTMLInputElement;
    const airSpeedCalibrationValue = document.getElementById('airSpeedCalibrationValue') as HTMLInputElement;

    if (airSpeedCalibrationSlider && airSpeedCalibrationValue) {
        const updateAirSpeedCalibration = () => {
            const value = parseFloat(airSpeedCalibrationSlider.value);
            airSpeedCalibrationValue.value = value.toFixed(1);
            appState.airSpeedCalibrationPercent = value;
            log.debug('Air speed calibration changed - triggering GPS lap VE recalculation');
            recalculateGpsLapVE();
        };

        const updateAirSpeedCalibrationFromInput = () => {
            const value = parseFloat(airSpeedCalibrationValue.value);
            if (isNaN(value)) return;
            const clamped = Math.max(-20.0, Math.min(value, 20.0));
            airSpeedCalibrationSlider.value = clamped.toString();
            airSpeedCalibrationValue.value = clamped.toFixed(1);
            appState.airSpeedCalibrationPercent = clamped;
            log.debug('Air speed calibration changed - triggering GPS lap VE recalculation');
            recalculateGpsLapVE();
        };

        airSpeedCalibrationSlider.addEventListener('input', updateAirSpeedCalibration);
        airSpeedCalibrationValue.addEventListener('change', updateAirSpeedCalibrationFromInput);

        // Setup auto-adjust button
        const autoAdjustButton = document.getElementById('autoAdjustCalibration') as HTMLButtonElement;
        if (autoAdjustButton) {
            autoAdjustButton.addEventListener('click', () => {
                // Auto-adjust logic for GPS lap mode
                // For now, just show a message - full implementation would need lap-specific calculations
                log.debug('Auto-adjust clicked for GPS lap mode');
                alert('Auto-adjust for GPS lap mode is not yet implemented. Please adjust manually.');
            });
        }
    }

    // Setup screenshot button
    const screenshotBtn = document.getElementById('saveScreenshot');
    if (screenshotBtn) {
        screenshotBtn.addEventListener('click', () => {
            saveGpsLapScreenshot();
        });
    }

    // Setup store result button
    const storeBtn = document.getElementById('storeResult');
    if (storeBtn) {
        storeBtn.addEventListener('click', () => {
            handleStoreResult();
        });
    }

    // Setup export button
    const exportBtn = document.getElementById('exportAllResults');
    if (exportBtn) {
        exportBtn.addEventListener('click', () => {
            handleExportAllResults();
        });
    }

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

    // Helper to trigger recalculation
    const triggerRecalculation = () => {
        recalculateGpsLapVE();
    };

    if (cdaSlider && cdaValue) {
        cdaSlider.addEventListener('input', () => {
            cdaValue.value = parseFloat(cdaSlider.value).toFixed(3);
            triggerRecalculation();
        });
        cdaValue.addEventListener('change', () => {
            cdaSlider.value = cdaValue.value;
            triggerRecalculation();
        });
    }

    if (crrSlider && crrValue) {
        crrSlider.addEventListener('input', () => {
            crrValue.value = parseFloat(crrSlider.value).toFixed(4);
            triggerRecalculation();
        });
        crrValue.addEventListener('change', () => {
            crrSlider.value = crrValue.value;
            triggerRecalculation();
        });
    }
}

/**
 * Setup tab switching for GPS lap mode
 */
function setupGpsLapTabSwitching(lapProfiles: LapVEProfile[], showWindTab: boolean, showVirtualDistanceTab: boolean) {
    const tabButtons = document.querySelectorAll('.ve-tab-button');
    tabButtons.forEach(button => {
        button.addEventListener('click', (e) => {
            const target = e.target as HTMLElement;
            const tabName = target.getAttribute('data-tab');

            // Update button states
            tabButtons.forEach(btn => btn.classList.remove('active'));
            target.classList.add('active');

            // Update tab content
            document.querySelectorAll('.ve-tab-content').forEach(content => {
                content.classList.remove('active');
            });
            document.getElementById(`${tabName}-tab`)?.classList.add('active');

            // Render tab-specific content when switched to
            if (tabName === 'wind' && showWindTab) {
                renderGpsLapWindPlot(lapProfiles);
            } else if (tabName === 'power') {
                renderGpsLapPowerPlot(lapProfiles);
            } else if (tabName === 'vd' && showVirtualDistanceTab) {
                renderGpsLapVdPlot(lapProfiles);
            }
        });
    });
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
            appState.currentParameters.air_speed_offset ?? 2
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

async function showVirtualElevationAnalysisInline(initialResult: any, analyzedLaps: number[], timestamps: number[], power: number[], velocity: number[], positionLat: number[], positionLong: number[], altitude: number[], distance: number[], windSpeed: number[], temperature: number[] = [], cdaReference: number[] | null = null, defaultAirSpeedOffset: number = 0) {
    // appState.currentParameters is set by the AnalysisParameters component when
    // the user enters values — this function cannot run before that.
    // Narrow `appState.currentParameters` from '... | null' for the rest of the body.
    if (!appState.currentParameters) {
        log.error('showVirtualElevationAnalysisInline: appState.currentParameters is null');
        return;
    }

    // Store analyzed laps globally for save functionality
    appState.currentAnalyzedLaps = analyzedLaps;
    // Store filtered data globally for save functionality
    appState.currentFilteredData = { power, velocity, temperature, timestamps };
    // Store CdA reference data globally (will be used for dynamic validation)
    appState.currentCdaReference = cdaReference;

    // Check if wind_speed data is available (not all zeros/NaN)
    const hasWindSpeed = windSpeed.some(val => !isNaN(val) && val !== 0);
    const hasConstantWind = appState.currentParameters.wind_speed !== undefined && appState.currentParameters.wind_speed !== 0 &&
                            appState.currentParameters.wind_direction !== undefined;

    log.debug('Wind data availability:', {
        hasWindSpeed,
        hasConstantWind,
        windSpeedLength: windSpeed.length,
        sampleFilteredWindSpeed: windSpeed.slice(0, 10),
        nonZeroCount: windSpeed.filter(val => !isNaN(val) && val !== 0).length,
        windSpeedStats: {
            min: Math.min(...windSpeed.filter(v => !isNaN(v))),
            max: Math.max(...windSpeed.filter(v => !isNaN(v))),
            allZero: windSpeed.every(v => v === 0 || isNaN(v))
        }
    });

    // Show the VE analysis section
    const veSection = document.getElementById('veAnalysisSection') as HTMLElement;
    if (veSection) {
        log.debug('Found veSection, removing hidden/inactive classes');
        veSection.classList.remove('hidden', 'inactive');
        log.debug('veSection classes after removal:', veSection.className);
    } else {
        log.error('veAnalysisSection element not found in DOM');
        return;
    }

    // Get the VE analysis content container
    const veAnalysisContent = document.getElementById('veAnalysisContent') as HTMLElement;
    if (!veAnalysisContent) {
        log.error('VE analysis content container not found');
        return;
    }

    // Create the VE analysis interface content
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
                        <label>Trim Start (seconds):</label>
                        <input type="range" id="trimStartSlider" min="0" max="${timestamps.length - 30}" value="${appState.presetTrimStart}" class="ve-slider">
                        <input type="number" id="trimStartValue" value="${appState.presetTrimStart}" min="0" max="${timestamps.length - 30}" class="ve-value-input">
                    </div>

                    <div class="ve-control-group">
                        <label>Trim End (seconds):</label>
                        <input type="range" id="trimEndSlider" min="30" max="${timestamps.length - 1}" value="${appState.presetTrimEnd ?? timestamps.length - 1}" class="ve-slider">
                        <input type="number" id="trimEndValue" value="${appState.presetTrimEnd ?? timestamps.length - 1}" min="30" max="${timestamps.length - 1}" class="ve-value-input">
                    </div>

                    <div class="ve-control-group">
                        <label>CdA (Drag Coefficient × Area):</label>
                        <input type="range" id="cdaSlider" min="${appState.currentParameters.cda_min}" max="${appState.currentParameters.cda_max}" value="${appState.currentParameters.cda || 0.3}" step="0.001" class="ve-slider">
                        <input type="number" id="cdaValue" value="${(appState.currentParameters.cda || 0.3).toFixed(3)}" min="${appState.currentParameters.cda_min}" max="${appState.currentParameters.cda_max}" step="0.001" class="ve-value-input">
                    </div>

                    <div class="ve-control-group">
                        <label>Crr (Rolling Resistance):</label>
                        <input type="range" id="crrSlider" min="${appState.currentParameters.crr_min}" max="${appState.currentParameters.crr_max}" value="${appState.currentParameters.crr || 0.008}" step="0.0001" class="ve-slider">
                        <input type="number" id="crrValue" value="${(appState.currentParameters.crr || 0.008).toFixed(4)}" min="${appState.currentParameters.crr_min}" max="${appState.currentParameters.crr_max}" step="0.0001" class="ve-value-input">
                    </div>
                </div>

                ${(hasWindSpeed || hasConstantWind) ? `
                <div class="ve-wind-source">
                    <h4>Wind Source</h4>
                    <div class="ve-radio-group">
                        <label class="ve-radio-label">
                            <input type="radio" name="windSource" value="constant" ${!hasWindSpeed ? 'checked' : ''}>
                            <span>Use constant wind settings</span>
                        </label>
                        ${hasWindSpeed ? `
                        <label class="ve-radio-label">
                            <input type="radio" name="windSource" value="fit" ${hasWindSpeed ? 'checked' : ''}>
                            <span>Use FIT file wind data</span>
                        </label>
                        <label class="ve-radio-label">
                            <input type="radio" name="windSource" value="compare">
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
                        <input type="number" id="airSpeedCalibrationValue" value="0.0" step="0.1" min="-20.0" max="20.0"
                               style="width: 60px; text-align: right;" />
                        <span>%</span>
                    </div>
                    <input type="range" id="airSpeedCalibrationSlider" min="-20.0" max="20.0" step="0.1" value="0.0" />
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
                    ${cdaReference ? `
                    <button class="ve-tab-button" data-tab="cda-validation">CdA Validation</button>
                    ` : ''}
                    ${(hasWindSpeed || hasConstantWind) ? `
                    <button class="ve-tab-button" data-tab="wind">Wind</button>
                    ` : ''}
                    <button class="ve-tab-button" data-tab="power">Power</button>
                    ${hasWindSpeed ? `
                    <button class="ve-tab-button" data-tab="vd">VD</button>
                    ` : ''}
                </div>

                <div class="ve-tab-content active" id="ve-tab">
                    <div class="ve-metrics-compact">
                        R²:<span id="r2Value">${initialResult.r2.toFixed(4)}</span> |
                        RMSE:<span id="rmseValue">${initialResult.rmse.toFixed(2)}m</span> |
                        VE:<span id="veGainValue">${initialResult.ve_elevation_diff.toFixed(2)}m</span> |
                        Actual:<span id="actualGainValue">${initialResult.actual_elevation_diff.toFixed(2)}m</span>
                    </div>
                    <div id="vePlot" class="ve-plot" style="margin-bottom: 0; height: 380px;"></div>
                    <div id="veResidualsPlot" class="ve-plot" style="margin-top: 0; height: 220px;"></div>
                </div>

                ${cdaReference ? `
                <div class="ve-tab-content" id="cda-validation-tab">
                    <div style="background: #f5f5f5; padding: 1rem; border-radius: 4px; margin-bottom: 1rem;">
                        <h4 style="margin: 0 0 0.75rem 0; font-size: 1.1rem;">CdA Comparison</h4>
                        <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 1rem;">
                            <div>
                                <div style="font-weight: 600; color: #1976d2;">VE Calculated</div>
                                <div id="cdaOptimizedMetrics" style="font-size: 0.9em; color: #666; margin-top: 0.25rem;">
                                    <!-- Updated dynamically -->
                                </div>
                            </div>
                            <div>
                                <div style="font-weight: 600; color: #000;">Reference CdA</div>
                                <div id="cdaReferenceMetrics" style="font-size: 0.9em; color: #666; margin-top: 0.25rem;">
                                    <!-- Updated dynamically -->
                                </div>
                            </div>
                        </div>
                        <div style="margin-top: 0.75rem; padding-top: 0.75rem; border-top: 1px solid #ddd;">
                            <div id="cdaDifferenceMetrics" style="font-size: 0.9em; color: #666;">
                                <!-- Updated dynamically -->
                            </div>
                        </div>
                    </div>
                    <div id="cdaValidationPlot" class="ve-plot" style="margin-bottom: 0; height: 380px;"></div>
                    <div id="cdaValidationResidualsPlot" class="ve-plot" style="margin-top: 0; height: 220px;"></div>
                </div>
                ` : ''}

                ${(hasWindSpeed || hasConstantWind) ? `
                <div class="ve-tab-content" id="wind-tab">
                    <div id="windSpeedPlot" class="ve-plot" style="height: 600px;"></div>

                    ${hasWindSpeed ? `
                    <div class="ve-parameter" style="margin-top: 1.5rem; padding: 1rem; border: 1px solid #ddd; border-radius: 4px; background: #f9f9f9;">
                        <h4 style="margin: 0 0 1rem 0; font-size: 1rem; font-weight: 500;">Air Speed Time Offset</h4>
                        <div style="display: grid; grid-template-columns: 1fr auto auto; gap: 0.5rem; align-items: center; margin-bottom: 0.5rem;">
                            <input type="range" id="airSpeedOffsetSlider" min="-10" max="10" step="1" value="${appState.currentParameters?.air_speed_offset ?? defaultAirSpeedOffset}"
                                   style="width: 100%;" />
                            <input type="number" id="airSpeedOffsetValue" value="${appState.currentParameters?.air_speed_offset ?? defaultAirSpeedOffset}" step="1" min="-10" max="10"
                                   style="width: 60px; text-align: right;" />
                            <span style="font-weight: 500;">seconds</span>
                        </div>
                        <div style="font-size: 0.9em; color: #666; margin-top: 0.75rem;">
                            <div style="display: flex; justify-content: space-between; align-items: center;">
                                <span>Sync Error:</span>
                                <span id="airSpeedOffsetErrorMetric" style="font-weight: bold; color: #e65100; font-size: 1.1em;">--</span>
                            </div>
                            <p style="margin: 0.5rem 0 0 0; font-size: 0.85em; line-height: 1.4;">
                                Adjust to minimize sync error between ground speed and air speed.
                                Positive = shift later, Negative = shift earlier.
                            </p>
                        </div>
                    </div>
                    ` : ''}
                </div>
                ` : ''}

                <div class="ve-tab-content" id="power-tab">
                    <div id="speedPowerPlot" class="ve-plot" style="height: 600px;"></div>
                </div>

                ${hasWindSpeed ? `
                <div class="ve-tab-content" id="vd-tab">
                    <div class="ve-metrics-compact" style="margin-bottom: 1rem;">
                        VD (Air):<span id="vdAirValue">${(initialResult.virtual_distance_air / 1000).toFixed(3)} km</span> |
                        VD (Ground):<span id="vdGroundValue">${(initialResult.virtual_distance_ground / 1000).toFixed(3)} km</span> |
                        Difference:<span id="vdDiffValue" style="${initialResult.vd_difference_percent >= 0 ? 'color: #4caf50;' : 'color: #f44336;'}">${initialResult.vd_difference_percent >= 0 ? '+' : ''}${initialResult.vd_difference_percent.toFixed(2)}%</span>
                    </div>
                    <div id="vdPlot" class="ve-plot" style="height: 600px;"></div>
                </div>
                ` : ''}
                    </div>
                </div>
            </div>
        </div>
    `;

    // Initialize the VE analysis interface (await to ensure lap settings load before rendering)
    await initializeVEAnalysis(timestamps, power, velocity, positionLat, positionLong, altitude, distance, windSpeed, analyzedLaps, defaultAirSpeedOffset);

    // Scroll to the VE analysis section
    veSection.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

async function initializeVEAnalysis(timestamps: number[], power: number[], velocity: number[], positionLat: number[], positionLong: number[], altitude: number[], distance: number[], windSpeed: number[], analyzedLaps: number[], defaultAirSpeedOffset: number) {
    const analysisInput = createAnalysisInput({
        timestamps,
        power,
        velocity,
        positionLat,
        positionLong,
        altitude,
        distance,
        windSpeed,
    });

    // Try to load saved lap settings for this file and lap combination
    let savedSettings: LapSettings | null = null;
    if (appState.currentFileHash) {
        try {
            savedSettings = await parameterStorage.loadLapSettings(appState.currentFileHash, analyzedLaps);
            if (savedSettings) {
                // Update preset values that will be used when rendering
                appState.presetTrimStart = savedSettings.trimStart;
                appState.presetTrimEnd = savedSettings.trimEnd;

                // Apply saved CdA, Crr, and airSpeedCalibration values to sliders after they're created
                const savedCda = savedSettings.cda;
                const savedCrr = savedSettings.crr;
                const savedAirSpeedCalibration = savedSettings.airSpeedCalibration;
                setTimeout(() => {
                    const cdaSlider = document.getElementById('cdaSlider') as HTMLInputElement;
                    const crrSlider = document.getElementById('crrSlider') as HTMLInputElement;
                    const cdaValue = document.getElementById('cdaValue') as HTMLInputElement;
                    const crrValue = document.getElementById('crrValue') as HTMLInputElement;
                    const airSpeedCalibrationSlider = document.getElementById('airSpeedCalibrationSlider') as HTMLInputElement;
                    const airSpeedCalibrationValue = document.getElementById('airSpeedCalibrationValue') as HTMLInputElement;

                    if (cdaSlider && savedCda !== null) {
                        cdaSlider.value = savedCda.toString();
                        if (cdaValue) cdaValue.value = savedCda.toFixed(3);
                    }
                    if (crrSlider && savedCrr !== null) {
                        crrSlider.value = savedCrr.toString();
                        if (crrValue) crrValue.value = savedCrr.toFixed(4);
                    }
                    if (airSpeedCalibrationSlider && savedAirSpeedCalibration !== undefined) {
                        airSpeedCalibrationSlider.value = savedAirSpeedCalibration.toString();
                        if (airSpeedCalibrationValue) airSpeedCalibrationValue.value = savedAirSpeedCalibration.toFixed(1);
                        // Update global variable
                        appState.airSpeedCalibrationPercent = savedAirSpeedCalibration;
                    }

                    // Trigger an update to re-render with saved values
                    if (cdaSlider) cdaSlider.dispatchEvent(new Event('input'));
                }, 100);
            }
        } catch (err) {
            log.error('Failed to load lap settings:', err);
        }
    }

    // Set up tab switching
    const tabButtons = document.querySelectorAll('.ve-tab-button');
    tabButtons.forEach(button => {
        button.addEventListener('click', (e) => {
            const target = e.target as HTMLElement;
            const tabName = target.getAttribute('data-tab');

            // Update button states
            tabButtons.forEach(btn => btn.classList.remove('active'));
            target.classList.add('active');

            // Update tab content
            document.querySelectorAll('.ve-tab-content').forEach(content => {
                content.classList.remove('active');
            });
            document.getElementById(`${tabName}-tab`)?.classList.add('active');

            const trimStart = parseInt((document.getElementById('trimStartSlider') as HTMLInputElement).value);
            const trimEnd = parseInt((document.getElementById('trimEndSlider') as HTMLInputElement).value);

            // If switching to wind tab, create the wind plot
            if (tabName === 'wind') {
                setTimeout(() => {
                    createWindSpeedPlot(analysisInput,trimStart, trimEnd, defaultAirSpeedOffset);
                }, 100);
            } else if (tabName === 'power') {
                // Create speed & power plot
                setTimeout(() => {
                    createSpeedPowerPlot(analysisInput, trimStart, trimEnd);
                }, 100);
            } else if (tabName === 'vd') {
                // Create virtual distance plot
                setTimeout(() => {
                    createVirtualDistancePlot(analysisInput,trimStart, trimEnd);
                }, 100);
            } else if (tabName === 've') {
                // Resize VE plots when switching back
                setTimeout(async () => {
                    try {
                        const Plotly = await waitForPlotly();
                        Plotly.Plots.resize('vePlot');
                        Plotly.Plots.resize('veResidualsPlot');
                    } catch (error) {
                        log.error('Failed to resize plots:', error);
                    }
                }, 100);
            }
        });
    });

    // Set up sliders with real-time updates
    setupVESliders(timestamps, power, velocity, positionLat, positionLong, altitude, distance, windSpeed, defaultAirSpeedOffset);

    // Initial plot rendering (with delay to ensure Plotly is loaded)
    // Use preset trim values if they were set before clicking analyze
    const initialTrimStart = appState.presetTrimStart;
    const initialTrimEnd = appState.presetTrimEnd ?? timestamps.length - 1;
    log.debug('Using preset trim values for initial render:', {
        trimStart: initialTrimStart,
        trimEnd: initialTrimEnd
    });
    setTimeout(() => {
        updateVEPlots(analysisInput,initialTrimStart, initialTrimEnd);

        // CdA validation plots will be rendered dynamically by updateVEPlots if CdA reference exists

        // Update map markers with preset trim values after analyze
        if (mapVisualization && appState.filteredVEData) {
            log.debug('Setting map trim markers to preset values after analyze');
            mapVisualization.fitBoundsToTrimRegion(initialTrimStart, initialTrimEnd, appState.filteredVEData.positionLat, appState.filteredVEData.positionLong);
        }
    }, 500);

    // Set up Save Screenshot button
    const saveScreenshotBtn = document.getElementById('saveScreenshot') as HTMLButtonElement;
    if (saveScreenshotBtn) {
        saveScreenshotBtn.addEventListener('click', async () => {
            await handleSaveScreenshot();
        });
    }

    // Set up Store Result button
    const storeResultBtn = document.getElementById('storeResult') as HTMLButtonElement;
    if (storeResultBtn) {
        storeResultBtn.addEventListener('click', async () => {
            await handleStoreResult();
        });
    }

    // Set up Export All Results button
    const exportAllBtn = document.getElementById('exportAllResults') as HTMLButtonElement;
    if (exportAllBtn) {
        exportAllBtn.addEventListener('click', async () => {
            await handleExportAllResults();
        });
    }
}

// Handle Save Screenshot button click
async function handleSaveScreenshot() {
    if (!appState.selectedFile) {
        log.error('Cannot save: missing file');
        alert('Cannot save screenshot: missing file data.');
        return;
    }

    const lapCombo = appState.currentAnalyzedLaps.length === 0 ? 'all' : appState.currentAnalyzedLaps.join('-');
    const saveBtn = document.getElementById('saveScreenshot') as HTMLButtonElement;
    if (!saveBtn) return;

    const originalText = saveBtn.textContent;

    try {
        saveBtn.disabled = true;
        saveBtn.textContent = 'Saving...';

        await resultsStorage.saveScreenshot(appState.selectedFile.name, lapCombo);

        saveBtn.textContent = '✓ Saved';
        setTimeout(() => {
            saveBtn.disabled = false;
            saveBtn.textContent = originalText || 'Save Screenshot';
        }, 2000);
    } catch (error) {
        log.error('❌ Failed to save screenshot:', error);
        alert('Failed to save screenshot. See console for details.');

        saveBtn.disabled = false;
        saveBtn.textContent = originalText || 'Save Screenshot';
    }
}

// Calculate average of array values (excluding NaN and 0 values for temperature)
function calculateAverage(values: number[], excludeZero: boolean = false): number {
    const validValues = values.filter(v => !isNaN(v) && (excludeZero ? v !== 0 : true));
    if (validValues.length === 0) return 0;
    const sum = validValues.reduce((acc, val) => acc + val, 0);
    return sum / validValues.length;
}

// Show notes dialog and return the entered notes
function showNotesDialog(): Promise<string> {
    return new Promise((resolve) => {
        const dialog = document.createElement('div');
        dialog.style.cssText = `
            position: fixed;
            top: 50%;
            left: 50%;
            transform: translate(-50%, -50%);
            background: white;
            padding: 20px;
            border-radius: 8px;
            box-shadow: 0 4px 6px rgba(0, 0, 0, 0.1);
            z-index: 10000;
            min-width: 300px;
        `;

        dialog.innerHTML = `
            <h3 style="margin-top: 0;">Add Notes</h3>
            <input type="text" id="notesInput" placeholder="e.g., test_config_A" style="width: 100%; padding: 8px; margin: 10px 0; border: 1px solid #ccc; border-radius: 4px;">
            <div style="display: flex; gap: 10px; justify-content: flex-end; margin-top: 15px;">
                <button id="notesCancelBtn" style="padding: 8px 16px; border: 1px solid #ccc; background: white; border-radius: 4px; cursor: pointer;">Cancel</button>
                <button id="notesOkBtn" style="padding: 8px 16px; border: none; background: #007bff; color: white; border-radius: 4px; cursor: pointer;">OK</button>
            </div>
        `;

        const overlay = document.createElement('div');
        overlay.style.cssText = `
            position: fixed;
            top: 0;
            left: 0;
            right: 0;
            bottom: 0;
            background: rgba(0, 0, 0, 0.5);
            z-index: 9999;
        `;

        document.body.appendChild(overlay);
        document.body.appendChild(dialog);

        const input = document.getElementById('notesInput') as HTMLInputElement;
        const okBtn = document.getElementById('notesOkBtn') as HTMLButtonElement;
        const cancelBtn = document.getElementById('notesCancelBtn') as HTMLButtonElement;

        input.focus();

        const cleanup = (notes: string) => {
            document.body.removeChild(overlay);
            document.body.removeChild(dialog);
            resolve(notes);
        };

        okBtn.addEventListener('click', () => cleanup(input.value.trim()));
        cancelBtn.addEventListener('click', () => cleanup(''));
        input.addEventListener('keypress', (e) => {
            if (e.key === 'Enter') cleanup(input.value.trim());
            if (e.key === 'Escape') cleanup('');
        });
    });
}

// Handle Store Result button click
async function handleStoreResult() {
    if (!appState.selectedFile || !appState.currentParameters || !appState.currentVEResult) {
        log.error('Cannot store: missing required data');
        alert('Cannot store result: missing analysis data. Please run analysis first.');
        return;
    }

    // Get filtered data arrays (already filtered by selected laps)
    if (!appState.currentFilteredData) {
        alert('Cannot store result: filtered data not available. Please run analysis first.');
        return;
    }

    const storeBtn = document.getElementById('storeResult') as HTMLButtonElement;
    if (!storeBtn) return;

    const originalText = storeBtn.textContent;

    try {
        // Show notes dialog first
        const notes = await showNotesDialog();

        // Check if we're in GPS lap mode or normal mode
        let trimStart: number;
        let trimEnd: number;
        let cda: number;
        let crr: number;

        if (appState.isGpsLapModeActive) {
            // GPS lap mode - use full data range and get CdA/Crr from sliders
            trimStart = 0;
            trimEnd = appState.currentFilteredData.power.length - 1;
            const cdaSlider = document.getElementById('cdaSlider') as HTMLInputElement;
            const crrSlider = document.getElementById('crrSlider') as HTMLInputElement;
            cda = cdaSlider ? parseFloat(cdaSlider.value) : appState.currentParameters.cda ?? 0.3;
            crr = crrSlider ? parseFloat(crrSlider.value) : appState.currentParameters.crr ?? 0.005;
        } else {
            // Normal mode - get trim values from sliders
            const trimStartSlider = document.getElementById('trimStartSlider') as HTMLInputElement;
            const trimEndSlider = document.getElementById('trimEndSlider') as HTMLInputElement;
            const cdaSlider = document.getElementById('cdaSlider') as HTMLInputElement;
            const crrSlider = document.getElementById('crrSlider') as HTMLInputElement;

            if (!trimStartSlider || !trimEndSlider || !cdaSlider || !crrSlider) {
                log.error('Cannot store: UI elements not found');
                return;
            }

            trimStart = parseInt(trimStartSlider.value);
            trimEnd = parseInt(trimEndSlider.value);
            cda = parseFloat(cdaSlider.value);
            crr = parseFloat(crrSlider.value);
        }

        const filteredPower = appState.currentFilteredData.power;
        const filteredVelocity = appState.currentFilteredData.velocity;
        const filteredTemperature = appState.currentFilteredData.temperature;
        const filteredTimestamps = appState.currentFilteredData.timestamps;

        // Calculate averages from trimmed data (trimStart and trimEnd are indices into the filtered arrays)
        const trimmedPower = filteredPower.slice(trimStart, trimEnd + 1);
        const trimmedVelocity = filteredVelocity.slice(trimStart, trimEnd + 1);
        const trimmedTemperature = filteredTemperature.slice(trimStart, trimEnd + 1);

        const avgPower = calculateAverage(trimmedPower, false);
        const avgSpeed = calculateAverage(trimmedVelocity, false) * 3.6; // Convert m/s to km/h
        const avgTemperature = calculateAverage(trimmedTemperature, true); // Exclude zeros for temperature

        // Extract recording date from the first timestamp in the trimmed range
        // Timestamps are Unix seconds since epoch
        const firstTimestamp = filteredTimestamps[trimStart];
        const recordingDate = new Date(firstTimestamp * 1000).toISOString().split('T')[0]; // yyyy-mm-dd

        // Prepare save data
        const saveData = {
            fileName: appState.selectedFile.name,
            laps: appState.currentAnalyzedLaps,
            trimStart: trimStart,
            trimEnd: trimEnd,
            cda: cda,
            crr: crr,
            airSpeedCalibration: appState.airSpeedCalibrationPercent !== 0 ? appState.airSpeedCalibrationPercent : undefined,
            windSource: appState.currentWindSource,
            parameters: appState.currentParameters,
            result: appState.currentVEResult,
            timestamp: new Date(),
            recordingDate: recordingDate,
            avgPower: avgPower,
            avgSpeed: avgSpeed,
            avgTemperature: avgTemperature,
            notes: notes,
            isGpsLapMode: appState.isGpsLapModeActive  // Track if this was GPS lap mode
        };

        storeBtn.disabled = true;
        storeBtn.textContent = 'Storing...';

        await resultsStorage.saveResult(saveData);

        storeBtn.textContent = '✓ Stored';
        setTimeout(() => {
            storeBtn.disabled = false;
            storeBtn.textContent = originalText || 'Store Result';
        }, 2000);
    } catch (error) {
        log.error('❌ Failed to store result:', error);
        alert('Failed to store result. See console for details.');

        storeBtn.disabled = false;
        storeBtn.textContent = originalText || 'Store Result';
    }
}

// Handle Export All Results button click
async function handleExportAllResults() {
    const exportBtn = document.getElementById('exportAllResults') as HTMLButtonElement;
    if (!exportBtn) return;

    const originalText = exportBtn.textContent;

    try {
        exportBtn.disabled = true;
        exportBtn.textContent = 'Exporting...';

        await resultsStorage.exportAllResultsToCSV();

        exportBtn.textContent = '✓ Exported';
        setTimeout(() => {
            exportBtn.disabled = false;
            exportBtn.textContent = originalText || 'Export all results to CSV';
        }, 2000);
    } catch (error) {
        log.error('❌ Failed to export results:', error);
        alert('Failed to export results. See console for details.');

        exportBtn.disabled = false;
        exportBtn.textContent = originalText || 'Export all results to CSV';
    }
}

// Helper function to save current lap settings to IndexedDB
async function saveCurrentLapSettings() {
    if (!appState.currentFileHash || !appState.selectedFile) return;

    const trimStartSlider = document.getElementById('trimStartSlider') as HTMLInputElement;
    const trimEndSlider = document.getElementById('trimEndSlider') as HTMLInputElement;
    const cdaSlider = document.getElementById('cdaSlider') as HTMLInputElement;
    const crrSlider = document.getElementById('crrSlider') as HTMLInputElement;

    if (!trimStartSlider || !trimEndSlider || !cdaSlider || !crrSlider) return;

    const settings: LapSettings = {
        trimStart: parseInt(trimStartSlider.value),
        trimEnd: parseInt(trimEndSlider.value),
        cda: parseFloat(cdaSlider.value) || null,
        crr: parseFloat(crrSlider.value) || null,
        airSpeedCalibration: appState.airSpeedCalibrationPercent !== 0 ? appState.airSpeedCalibrationPercent : undefined
    };

    try {
        await parameterStorage.saveLapSettings(appState.currentFileHash, appState.selectedLaps, settings);
    } catch (err) {
        log.error('Failed to save lap settings:', err);
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

function setupVESliders(timestamps: number[], power: number[], velocity: number[], positionLat: number[], positionLong: number[], altitude: number[], distance: number[], windSpeed: number[], defaultAirSpeedOffset: number) {
    const analysisInput = createAnalysisInput({
        timestamps,
        power,
        velocity,
        positionLat,
        positionLong,
        altitude,
        distance,
        windSpeed,
    });

    // setupVESliders is only called after appState.currentParameters has been set
    // in showVirtualElevationAnalysisInline. Capture into a const local
    // so nested slider callbacks can close over a non-null reference
    // (top-level narrowing doesn't propagate into callback scopes).
    if (!appState.currentParameters) {
        log.error('setupVESliders: appState.currentParameters is null');
        return;
    }
    const params = appState.currentParameters;

    const trimStartSlider = document.getElementById('trimStartSlider') as HTMLInputElement;
    const trimEndSlider = document.getElementById('trimEndSlider') as HTMLInputElement;
    const cdaSlider = document.getElementById('cdaSlider') as HTMLInputElement;
    const crrSlider = document.getElementById('crrSlider') as HTMLInputElement;

    const trimStartValue = document.getElementById('trimStartValue') as HTMLInputElement;
    const trimEndValue = document.getElementById('trimEndValue') as HTMLInputElement;
    const cdaValue = document.getElementById('cdaValue') as HTMLInputElement;
    const crrValue = document.getElementById('crrValue') as HTMLInputElement;

    // Update functions for sliders
    const updateTrimStart = () => {
        const value = parseInt(trimStartSlider.value);
        trimStartValue.value = value.toString();

        // Ensure trim start < trim end - 30
        const trimEnd = parseInt(trimEndSlider.value);
        log.debug('Trim Start changed:', {
            trimStart: value,
            trimEnd: trimEnd,
            dataLength: timestamps.length,
            selectedDuration: trimEnd - value,
            lastDataIndex: timestamps.length - 1
        });

        if (value >= trimEnd - 30) {
            const corrected = trimEnd - 30;
            trimStartSlider.value = corrected.toString();
            trimStartValue.value = corrected.toString();
            return;
        }

        updateVEPlots(analysisInput,value, trimEnd);

        // Update other plots if they're visible
        const windTab = document.getElementById('wind-tab');
        if (windTab && windTab.classList.contains('active')) {
            createWindSpeedPlot(analysisInput,value, trimEnd, defaultAirSpeedOffset);
        }
        const powerTab = document.getElementById('power-tab');
        if (powerTab && powerTab.classList.contains('active')) {
            createSpeedPowerPlot(analysisInput, value, trimEnd);
        }
        const vdTab = document.getElementById('vd-tab');
        if (vdTab && vdTab.classList.contains('active')) {
            createVirtualDistancePlot(analysisInput,value, trimEnd);
        }

        // Auto-zoom map to trim region
        if (mapVisualization && appState.filteredVEData) {
            mapVisualization.fitBoundsToTrimRegion(value, trimEnd, appState.filteredVEData.positionLat, appState.filteredVEData.positionLong);
        }

        // Save lap settings
        saveCurrentLapSettings();
    };

    const updateTrimEnd = () => {
        const value = parseInt(trimEndSlider.value);
        trimEndValue.value = value.toString();

        // Ensure trim end > trim start + 30
        const trimStart = parseInt(trimStartSlider.value);
        log.debug('Trim End changed:', {
            trimStart: trimStart,
            trimEnd: value,
            dataLength: timestamps.length,
            selectedDuration: value - trimStart,
            lastDataIndex: timestamps.length - 1
        });

        if (value <= trimStart + 30) {
            const corrected = trimStart + 30;
            trimEndSlider.value = corrected.toString();
            trimEndValue.value = corrected.toString();
            return;
        }

        updateVEPlots(analysisInput,trimStart, value);

        // Update other plots if they're visible
        const windTab = document.getElementById('wind-tab');
        if (windTab && windTab.classList.contains('active')) {
            createWindSpeedPlot(analysisInput,trimStart, value, defaultAirSpeedOffset);
        }
        const powerTab = document.getElementById('power-tab');
        if (powerTab && powerTab.classList.contains('active')) {
            createSpeedPowerPlot(analysisInput, trimStart, value);
        }
        const vdTab = document.getElementById('vd-tab');
        if (vdTab && vdTab.classList.contains('active')) {
            createVirtualDistancePlot(analysisInput,trimStart, value);
        }

        // Auto-zoom map to trim region
        if (mapVisualization && appState.filteredVEData) {
            mapVisualization.fitBoundsToTrimRegion(trimStart, value, appState.filteredVEData.positionLat, appState.filteredVEData.positionLong);
        }

        // Save lap settings
        saveCurrentLapSettings();
    };

    const updateCdA = () => {
        const value = parseFloat(cdaSlider.value);
        cdaValue.value = value.toFixed(3);

        const trimStart = parseInt(trimStartSlider.value);
        const trimEnd = parseInt(trimEndSlider.value);
        updateVEPlots(analysisInput,trimStart, trimEnd);

        // Save lap settings
        saveCurrentLapSettings();
    };

    const updateCrr = () => {
        const value = parseFloat(crrSlider.value);
        crrValue.value = value.toFixed(4);

        const trimStart = parseInt(trimStartSlider.value);
        const trimEnd = parseInt(trimEndSlider.value);
        updateVEPlots(analysisInput,trimStart, trimEnd);

        // Save lap settings
        saveCurrentLapSettings();
    };

    // Update functions for input fields (when user types)
    const updateTrimStartFromInput = () => {
        const value = parseInt(trimStartValue.value);
        if (isNaN(value)) return;

        const trimEnd = parseInt(trimEndSlider.value);
        const clamped = Math.max(0, Math.min(value, trimEnd - 30));

        trimStartSlider.value = clamped.toString();
        trimStartValue.value = clamped.toString();

        updateVEPlots(analysisInput,clamped, trimEnd);

        // Update wind speed plot if it's visible
        const windTab = document.getElementById('wind-tab');
        if (windTab && windTab.classList.contains('active')) {
            createWindSpeedPlot(analysisInput,clamped, trimEnd, defaultAirSpeedOffset);
        }

        // Update power plot if it's visible
        const powerTab = document.getElementById('power-tab');
        if (powerTab && powerTab.classList.contains('active')) {
            createSpeedPowerPlot(analysisInput, clamped, trimEnd);
        }

        // Update VD plot if it's visible
        const vdTab = document.getElementById('vd-tab');
        if (vdTab && vdTab.classList.contains('active')) {
            createVirtualDistancePlot(analysisInput,clamped, trimEnd);
        }

        if (mapVisualization && appState.filteredVEData) {
            mapVisualization.fitBoundsToTrimRegion(clamped, trimEnd, appState.filteredVEData.positionLat, appState.filteredVEData.positionLong);
        }

        // Save lap settings
        saveCurrentLapSettings();
    };

    const updateTrimEndFromInput = () => {
        const value = parseInt(trimEndValue.value);
        if (isNaN(value)) return;

        const trimStart = parseInt(trimStartSlider.value);
        const clamped = Math.max(trimStart + 30, Math.min(value, timestamps.length));

        trimEndSlider.value = clamped.toString();
        trimEndValue.value = clamped.toString();

        updateVEPlots(analysisInput,trimStart, clamped);

        // Update wind speed plot if it's visible
        const windTab = document.getElementById('wind-tab');
        if (windTab && windTab.classList.contains('active')) {
            createWindSpeedPlot(analysisInput,trimStart, clamped, defaultAirSpeedOffset);
        }

        // Update power plot if it's visible
        const powerTab = document.getElementById('power-tab');
        if (powerTab && powerTab.classList.contains('active')) {
            createSpeedPowerPlot(analysisInput, trimStart, clamped);
        }

        // Update VD plot if it's visible
        const vdTab = document.getElementById('vd-tab');
        if (vdTab && vdTab.classList.contains('active')) {
            createVirtualDistancePlot(analysisInput,trimStart, clamped);
        }

        if (mapVisualization && appState.filteredVEData) {
            mapVisualization.fitBoundsToTrimRegion(trimStart, clamped, appState.filteredVEData.positionLat, appState.filteredVEData.positionLong);
        }

        // Save lap settings
        saveCurrentLapSettings();
    };

    const updateCdAFromInput = () => {
        const value = parseFloat(cdaValue.value);
        if (isNaN(value)) return;

        const clamped = Math.max(params.cda_min, Math.min(value, params.cda_max));

        cdaSlider.value = clamped.toString();
        cdaValue.value = clamped.toFixed(3);

        const trimStart = parseInt(trimStartSlider.value);
        const trimEnd = parseInt(trimEndSlider.value);
        updateVEPlots(analysisInput,trimStart, trimEnd);

        // Save lap settings
        saveCurrentLapSettings();
    };

    const updateCrrFromInput = () => {
        const value = parseFloat(crrValue.value);
        if (isNaN(value)) return;

        const clamped = Math.max(params.crr_min, Math.min(value, params.crr_max));

        crrSlider.value = clamped.toString();
        crrValue.value = clamped.toFixed(4);

        const trimStart = parseInt(trimStartSlider.value);
        const trimEnd = parseInt(trimEndSlider.value);
        updateVEPlots(analysisInput,trimStart, trimEnd);

        // Save lap settings
        saveCurrentLapSettings();
    };

    // Add event listeners for sliders
    trimStartSlider.addEventListener('input', updateTrimStart);
    trimEndSlider.addEventListener('input', updateTrimEnd);
    cdaSlider.addEventListener('input', updateCdA);
    crrSlider.addEventListener('input', updateCrr);

    // Add auto-rho trigger on trim slider changes (debounced)
    let autoRhoDebounceTimer: ReturnType<typeof setTimeout> | null = null;
    const triggerAutoRhoOnTrimChange = () => {
        if (autoRhoDebounceTimer) {
            clearTimeout(autoRhoDebounceTimer);
        }
        autoRhoDebounceTimer = setTimeout(() => {
            if (appState.currentParameters?.auto_calculate_rho && !appState.isCalculatingAutoRho) {
                calculateAutoRho().catch(err => {
                    log.error('Auto-rho calculation error on trim change:', err);
                });
            }
        }, 500); // Wait 500ms after last slider change
    };

    trimStartSlider.addEventListener('input', triggerAutoRhoOnTrimChange);
    trimEndSlider.addEventListener('input', triggerAutoRhoOnTrimChange);

    // Also trigger auto-rho immediately after VE analysis completes (if enabled)
    if (appState.currentParameters?.auto_calculate_rho && !appState.isCalculatingAutoRho) {
        setTimeout(() => {
            calculateAutoRho().catch(err => {
                log.error('Auto-rho initial calculation error:', err);
            });
        }, 1000); // Wait 1s for UI to fully render
    }

    // Add event listeners for input fields
    trimStartValue.addEventListener('change', updateTrimStartFromInput);
    trimEndValue.addEventListener('change', updateTrimEndFromInput);
    cdaValue.addEventListener('change', updateCdAFromInput);
    crrValue.addEventListener('change', updateCrrFromInput);

    // Add wind source radio button listeners
    const windSourceRadios = document.querySelectorAll('input[name="windSource"]');
    windSourceRadios.forEach(radio => {
        radio.addEventListener('change', (e) => {
            const target = e.target as HTMLInputElement;
            const windSource = target.value;
            log.debug('Wind source changed to:', windSource);

            const trimStart = parseInt(trimStartSlider.value);
            const trimEnd = parseInt(trimEndSlider.value);

            // Update VE calculation with new wind source
            updateVEPlotsWithWindSource(analysisInput, trimStart, trimEnd, windSource);
        });
    });

    // Add air speed calibration slider listeners (if available)
    const airSpeedCalibrationSlider = document.getElementById('airSpeedCalibrationSlider') as HTMLInputElement;
    const airSpeedCalibrationValue = document.getElementById('airSpeedCalibrationValue') as HTMLInputElement;

    if (airSpeedCalibrationSlider && airSpeedCalibrationValue) {
        const updateAirSpeedCalibration = () => {
            const value = parseFloat(airSpeedCalibrationSlider.value);
            airSpeedCalibrationValue.value = value.toFixed(1);

            // Store calibration percentage globally
            appState.airSpeedCalibrationPercent = value;

            const trimStart = parseInt(trimStartSlider.value);
            const trimEnd = parseInt(trimEndSlider.value);

            // Trigger full recalculation (which will apply calibration when creating calculator)
            updateVEPlots(analysisInput,trimStart, trimEnd);

            // Update VD tab if visible
            const vdTab = document.getElementById('vd-tab');
            if (vdTab && vdTab.classList.contains('active')) {
                createVirtualDistancePlot(analysisInput,trimStart, trimEnd);
            }

            // Save lap settings with new calibration value
            saveCurrentLapSettings();
        };

        const updateAirSpeedCalibrationFromInput = () => {
            const value = parseFloat(airSpeedCalibrationValue.value);
            if (isNaN(value)) return;

            const clamped = Math.max(-20.0, Math.min(value, 20.0));

            airSpeedCalibrationSlider.value = clamped.toString();
            airSpeedCalibrationValue.value = clamped.toFixed(1);

            // Store calibration percentage globally
            appState.airSpeedCalibrationPercent = clamped;

            const trimStart = parseInt(trimStartSlider.value);
            const trimEnd = parseInt(trimEndSlider.value);

            // Trigger full recalculation
            updateVEPlots(analysisInput,trimStart, trimEnd);

            // Update VD tab if visible
            const vdTab = document.getElementById('vd-tab');
            if (vdTab && vdTab.classList.contains('active')) {
                createVirtualDistancePlot(analysisInput,trimStart, trimEnd);
            }

            // Save lap settings with new calibration value
            saveCurrentLapSettings();
        };

        airSpeedCalibrationSlider.addEventListener('input', updateAirSpeedCalibration);
        airSpeedCalibrationValue.addEventListener('change', updateAirSpeedCalibrationFromInput);

        // Add auto-adjust button listener
        const autoAdjustButton = document.getElementById('autoAdjustCalibration') as HTMLButtonElement;
        if (autoAdjustButton) {
            autoAdjustButton.addEventListener('click', () => {
                const trimStart = parseInt(trimStartSlider.value);
                const trimEnd = parseInt(trimEndSlider.value);

                // Calculate uncalibrated VD distances
                let vdAirUncalibrated = 0;
                let vdGround = 0;

                for (let i = trimStart + 1; i <= trimEnd; i++) {
                    const dt = timestamps[i] - timestamps[i - 1];
                    if (dt > 0 && dt < 10) {
                        // Wind speed is already apparent velocity (no calibration)
                        const apparentSpeed = (!isNaN(windSpeed[i])) ? windSpeed[i] : 0;
                        vdAirUncalibrated += (apparentSpeed > 0 ? apparentSpeed : 0) * dt;

                        // Ground speed
                        const groundSpeedVal = (!isNaN(velocity[i]) && velocity[i] > 0) ? velocity[i] : 0;
                        vdGround += groundSpeedVal * dt;
                    }
                }

                // Calculate calibration factor: we want VD_air * calibration = VD_ground
                // So: calibration = VD_ground / VD_air
                if (vdAirUncalibrated > 0) {
                    const calibrationMultiplier = vdGround / vdAirUncalibrated;
                    // Convert from multiplier to percentage: (1.05 -> +5%, 0.95 -> -5%)
                    const calibrationPercent = (calibrationMultiplier - 1.0) * 100.0;

                    // Clamp to ±20%
                    const clampedPercent = Math.max(-20.0, Math.min(calibrationPercent, 20.0));

                    // Update sliders
                    airSpeedCalibrationSlider.value = clampedPercent.toFixed(1);
                    airSpeedCalibrationValue.value = clampedPercent.toFixed(1);
                    appState.airSpeedCalibrationPercent = clampedPercent;

                    // Trigger recalculation
                    updateVEPlots(analysisInput,trimStart, trimEnd);

                    // Update VD tab if visible
                    const vdTab = document.getElementById('vd-tab');
                    if (vdTab && vdTab.classList.contains('active')) {
                        createVirtualDistancePlot(analysisInput,trimStart, trimEnd);
                    }

                    // Save settings
                    saveCurrentLapSettings();

                    log.debug(`Auto-adjusted air speed calibration to ${clampedPercent.toFixed(1)}%`);
                } else {
                    log.warn('Cannot auto-adjust: no air speed data available');
                }
            });
        }
    }

    // Add air speed offset control listeners
    const airSpeedOffsetSlider = document.getElementById('airSpeedOffsetSlider') as HTMLInputElement;
    const airSpeedOffsetValue = document.getElementById('airSpeedOffsetValue') as HTMLInputElement;
    const airSpeedOffsetErrorMetric = document.getElementById('airSpeedOffsetErrorMetric') as HTMLSpanElement;

    if (airSpeedOffsetSlider && airSpeedOffsetValue) {
        const updateAirSpeedOffset = () => {
            const value = parseInt(airSpeedOffsetSlider.value);
            airSpeedOffsetValue.value = value.toString();

            // Update parameters
            if (parametersComponent && appState.currentParameters) {
                parametersComponent.setParameters({ air_speed_offset: value });
            }

            const trimStart = parseInt(trimStartSlider.value);
            const trimEnd = parseInt(trimEndSlider.value);

            // Calculate error metric (sum of absolute differences)
            const errorMetric = calculateAirSpeedSyncError(velocity, windSpeed, value, trimStart, trimEnd);
            if (airSpeedOffsetErrorMetric && !isNaN(errorMetric)) {
                airSpeedOffsetErrorMetric.textContent = errorMetric.toFixed(2);
            }

            // Trigger full recalculation with new offset
            updateVEPlots(analysisInput,trimStart, trimEnd);

            // Update wind plot if visible
            const windTab = document.getElementById('wind-tab');
            if (windTab && windTab.classList.contains('active')) {
                createWindSpeedPlot(analysisInput,trimStart, trimEnd, defaultAirSpeedOffset);
            }

            // Save lap settings with new offset value
            saveCurrentLapSettings();
        };

        const updateAirSpeedOffsetFromInput = () => {
            const value = parseInt(airSpeedOffsetValue.value);
            if (isNaN(value)) return;

            const clamped = Math.max(-10, Math.min(value, 10));
            airSpeedOffsetSlider.value = clamped.toString();
            airSpeedOffsetValue.value = clamped.toString();

            // Update parameters
            if (parametersComponent && appState.currentParameters) {
                parametersComponent.setParameters({ air_speed_offset: clamped });
            }

            const trimStart = parseInt(trimStartSlider.value);
            const trimEnd = parseInt(trimEndSlider.value);

            // Calculate error metric
            const errorMetric = calculateAirSpeedSyncError(velocity, windSpeed, clamped, trimStart, trimEnd);
            if (airSpeedOffsetErrorMetric && !isNaN(errorMetric)) {
                airSpeedOffsetErrorMetric.textContent = errorMetric.toFixed(2);
            }

            // Trigger full recalculation
            updateVEPlots(analysisInput,trimStart, trimEnd);

            // Update wind plot if visible
            const windTab = document.getElementById('wind-tab');
            if (windTab && windTab.classList.contains('active')) {
                createWindSpeedPlot(analysisInput,trimStart, trimEnd, defaultAirSpeedOffset);
            }

            // Save settings
            saveCurrentLapSettings();
        };

        airSpeedOffsetSlider.addEventListener('input', updateAirSpeedOffset);
        airSpeedOffsetValue.addEventListener('change', updateAirSpeedOffsetFromInput);

        // Calculate initial error metric
        const trimStart = parseInt(trimStartSlider.value);
        const trimEnd = parseInt(trimEndSlider.value);
        const initialOffset = appState.currentParameters?.air_speed_offset ?? defaultAirSpeedOffset;
        const initialError = calculateAirSpeedSyncError(velocity, windSpeed, initialOffset, trimStart, trimEnd);
        if (airSpeedOffsetErrorMetric && !isNaN(initialError)) {
            airSpeedOffsetErrorMetric.textContent = initialError.toFixed(2);
        }
    }

    // Initialize map trim controls (synchronized with main trim controls)
    const mapTrimControls = document.getElementById('mapTrimControls');
    const mapTrimStartSlider = document.getElementById('mapTrimStartSlider') as HTMLInputElement;
    const mapTrimEndSlider = document.getElementById('mapTrimEndSlider') as HTMLInputElement;
    const mapTrimStartValue = document.getElementById('mapTrimStartValue') as HTMLInputElement;
    const mapTrimEndValue = document.getElementById('mapTrimEndValue') as HTMLInputElement;

    log.debug('Map trim controls lookup:', {
        mapTrimControls: !!mapTrimControls,
        mapTrimStartSlider: !!mapTrimStartSlider,
        mapTrimEndSlider: !!mapTrimEndSlider,
        mapTrimStartValue: !!mapTrimStartValue,
        mapTrimEndValue: !!mapTrimEndValue
    });

    if (mapTrimControls && mapTrimStartSlider && mapTrimEndSlider && mapTrimStartValue && mapTrimEndValue) {
        log.debug('Showing map trim controls');
        // Show the map trim controls
        mapTrimControls.style.display = 'flex';

        // Set same ranges and initial values as main controls (preserve preset values from section 3)
        mapTrimStartSlider.min = '0';
        mapTrimStartSlider.max = (timestamps.length - 30).toString();
        mapTrimStartSlider.value = appState.presetTrimStart.toString();
        mapTrimStartValue.value = appState.presetTrimStart.toString();
        mapTrimStartValue.min = '0';
        mapTrimStartValue.max = (timestamps.length - 30).toString();

        const initialTrimEnd = appState.presetTrimEnd ?? timestamps.length - 1;
        mapTrimEndSlider.min = '30';
        mapTrimEndSlider.max = (timestamps.length - 1).toString();
        mapTrimEndSlider.value = initialTrimEnd.toString();
        mapTrimEndValue.value = initialTrimEnd.toString();
        mapTrimEndValue.min = '30';
        mapTrimEndValue.max = (timestamps.length - 1).toString();

        // Sync map controls to main controls
        const syncMapToMain = () => {
            mapTrimStartSlider.value = trimStartSlider.value;
            mapTrimStartValue.value = trimStartValue.value;
            mapTrimEndSlider.value = trimEndSlider.value;
            mapTrimEndValue.value = trimEndValue.value;
        };

        // Sync main controls to map controls
        const syncMainToMap = (isStart: boolean) => {
            if (isStart) {
                const value = parseInt(mapTrimStartValue.value);
                if (!isNaN(value)) {
                    const trimEnd = parseInt(trimEndSlider.value);
                    const clamped = Math.max(0, Math.min(value, trimEnd - 30));
                    mapTrimStartSlider.value = clamped.toString();
                    mapTrimStartValue.value = clamped.toString();
                    trimStartSlider.value = clamped.toString();
                    trimStartValue.value = clamped.toString();
                    updateTrimStart();
                }
            } else {
                const value = parseInt(mapTrimEndValue.value);
                if (!isNaN(value)) {
                    const trimStart = parseInt(trimStartSlider.value);
                    const clamped = Math.max(trimStart + 30, Math.min(value, timestamps.length - 1));
                    mapTrimEndSlider.value = clamped.toString();
                    mapTrimEndValue.value = clamped.toString();
                    trimEndSlider.value = clamped.toString();
                    trimEndValue.value = clamped.toString();
                    updateTrimEnd();
                }
            }
        };

        // Listen to main trim changes and sync to map
        trimStartSlider.addEventListener('input', syncMapToMain);
        trimEndSlider.addEventListener('input', syncMapToMain);
        trimStartValue.addEventListener('change', syncMapToMain);
        trimEndValue.addEventListener('change', syncMapToMain);

        // Listen to map trim changes and sync to main
        mapTrimStartSlider.addEventListener('input', () => {
            // Update map text box
            mapTrimStartValue.value = mapTrimStartSlider.value;
            // Sync to main controls
            trimStartSlider.value = mapTrimStartSlider.value;
            trimStartValue.value = mapTrimStartSlider.value;
            updateTrimStart();
        });
        mapTrimEndSlider.addEventListener('input', () => {
            // Update map text box
            mapTrimEndValue.value = mapTrimEndSlider.value;
            // Sync to main controls
            trimEndSlider.value = mapTrimEndSlider.value;
            trimEndValue.value = mapTrimEndSlider.value;
            updateTrimEnd();
        });
        mapTrimStartValue.addEventListener('change', () => syncMainToMap(true));
        mapTrimEndValue.addEventListener('change', () => syncMainToMap(false));
    }
}

/**
 * Apply time offset to air speed data
 * Negative offset shifts air speed earlier (e.g., -2 means use air speed from 2 seconds earlier)
 * Positive offset shifts air speed later (e.g., +2 means use air speed from 2 seconds later)
 */
function updateVEPlots(analysisInput: AnalysisInput, trimStart: number, trimEnd: number) {
    // Check which wind source is currently selected
    const windSourceRadio = document.querySelector('input[name="windSource"]:checked') as HTMLInputElement;
    const windSource = windSourceRadio ? windSourceRadio.value : 'fit';

    log.debug('updateVEPlots: Using wind source:', windSource);

    // Use the wind source specific function
    updateVEPlotsWithWindSource(analysisInput, trimStart, trimEnd, windSource);
}

async function updateVEPlotsWithWindSource(analysisInput: AnalysisInput, trimStart: number, trimEnd: number, windSource: string) {
    const { timestamps, power, velocity, positionLat, positionLong, altitude, distance, windSpeed } = analysisInput;

    // Narrow `appState.currentParameters` from '... | null' for the rest of the body.
    if (!appState.currentParameters) {
        log.error('updateVEPlotsWithWindSource: appState.currentParameters is null');
        return;
    }

    const cdaSlider = document.getElementById('cdaSlider') as HTMLInputElement;
    const crrSlider = document.getElementById('crrSlider') as HTMLInputElement;

    const cda = parseFloat(cdaSlider.value);
    const crr = parseFloat(crrSlider.value);

    try {
        // GPS Lap Mode: Calculate VE for each lap separately and show stacked plot
        if (appState.isGpsLapModeActive && appState.currentGpsLapIndexRanges && appState.currentFitData) {
            await updateGpsLapVEPlots(cda, crr, windSource);
            return;
        }

        if (windSource === 'compare') {
            // Compare both methods - create two calculators
            if (!appState.currentParameters) return;

            // Calculator 1: Use constant wind
            const constantWindSpeed = new Array(windSpeed.length).fill(NaN);
            const calculator1 = createVeCalculator({
                timestamps,
                power,
                velocity,
                positionLat,
                positionLong,
                altitude,
                distance,
                windSpeed: constantWindSpeed,
                params: appState.currentParameters,
                cda,
                crr,
            });

            // Calculator 2: Use FIT file wind data
            // Apply time offset first (to sync with ground speed)
            const defaultOffset = 2;
            const windSpeedOffset = appState.currentParameters?.air_speed_offset ?? defaultOffset;
            const offsetWindSpeed = applyAirSpeedOffset(windSpeed, windSpeedOffset);

            // Then apply calibration if set
            const calibratedWindSpeed = appState.airSpeedCalibrationPercent !== 0
                ? offsetWindSpeed.map(speed => speed * (1.0 + appState.airSpeedCalibrationPercent / 100.0))
                : offsetWindSpeed;

            const calculator2 = createVeCalculator({
                timestamps,
                power,
                velocity,
                positionLat,
                positionLong,
                altitude,
                distance,
                windSpeed: calibratedWindSpeed,
                params: appState.currentParameters,
                cda,
                crr,
            });

            // NOTE: calculator2 used to be stored in a `_veCalculator` global
            // "for air speed calibration" but was never read downstream.

            const result1 = calculator1.calculate_virtual_elevation(cda, crr, trimStart, trimEnd);
            const result2 = calculator2.calculate_virtual_elevation(cda, crr, trimStart, trimEnd);

            // Store first result globally for save functionality (use constant wind result).
            // VEResult's Float64Array fields are passed through directly — no
            // need to copy to number[] since VEAnalysisResult now mirrors the
            // WASM shape exactly.
            appState.currentVEResult = {
                virtual_elevation: result1.virtual_elevation,
                virtual_slope: result1.virtual_slope,
                acceleration: result1.acceleration,
                effective_wind: result1.effective_wind,
                apparent_velocity: result1.apparent_velocity,
                r2: result1.r2,
                rmse: result1.rmse,
                ve_elevation_diff: result1.ve_elevation_diff,
                actual_elevation_diff: result1.actual_elevation_diff,
                virtual_distance_air: result1.virtual_distance_air,
                virtual_distance_ground: result1.virtual_distance_ground,
                vd_difference_percent: result1.vd_difference_percent,
            };
            appState.currentWindSource = 'compare';

            // Update metrics to show both
            updateVEMetricsComparison(result1, result2);

            // Use zero altitude for plotting if velodrome mode is enabled
            const plotAltitude = appState.currentParameters.velodrome
                ? new Array(altitude.length).fill(0)
                : altitude;

            // Create comparison plots
            createVirtualElevationPlotsComparison(trimStart, trimEnd, result1.virtual_elevation, result2.virtual_elevation, plotAltitude);

        } else {
            // Single method
            let useWindSpeed: number[];

            if (windSource === 'constant') {
                // Use constant wind - set wind_speed to NaN to force fallback to constant wind
                // If no constant wind is configured, it will use 0
                useWindSpeed = new Array(windSpeed.length).fill(NaN);
                log.debug('Using constant wind - wind_speed array filled with NaN');
                log.debug('Wind speed param:', appState.currentParameters.wind_speed ?? 0, 'Wind direction:', appState.currentParameters.wind_direction ?? 0);
            } else {
                // Use FIT file wind data
                // Apply time offset first (to sync with ground speed).
                // Default of 2s matches the sibling branch above (line 5764)
                // — the old code referenced an undefined `defaultAirSpeedOffset`
                // which would have thrown ReferenceError at runtime.
                const windSpeedOffset = appState.currentParameters?.air_speed_offset ?? 2;
                useWindSpeed = applyAirSpeedOffset(windSpeed, windSpeedOffset);
                log.debug('Using FIT wind data with offset:', windSpeedOffset, 'seconds');
                log.debug('Sample offset wind_speed values:', useWindSpeed.slice(0, 5));
                log.debug('Non-zero wind_speed count:', useWindSpeed.filter(v => !isNaN(v) && v !== 0).length);
            }

            // Debug altitude data AND velodrome parameter before passing to calculator
            log.debug('Altitude data being passed to calculator:', {
                length: altitude.length,
                allZeros: altitude.every(v => v === 0),
                allNaN: altitude.every(v => isNaN(v)),
                samples: [altitude[0], altitude[Math.floor(altitude.length/2)], altitude[altitude.length-1]],
                trimStartValue: altitude[trimStart],
                trimEndValue: altitude[trimEnd],
                expectedDiff: altitude[trimEnd] - altitude[trimStart]
            });
            log.debug('VELODROME PARAMETER:', appState.currentParameters.velodrome, 'Type:', typeof appState.currentParameters.velodrome);

            // Apply wind speed calibration if set (after offset)
            const calibratedWindSpeed = appState.airSpeedCalibrationPercent !== 0
                ? useWindSpeed.map(speed => speed * (1.0 + appState.airSpeedCalibrationPercent / 100.0))
                : useWindSpeed;

            const calculator = createVeCalculator({
                timestamps,
                power,
                velocity,
                positionLat,
                positionLong,
                altitude,
                distance,
                windSpeed: calibratedWindSpeed,
                rhoArray: appState.currentRhoArray,
                params: appState.currentParameters,
                cda,
                crr,
            });

            // NOTE: calculator used to be stored in a `_veCalculator` global
            // "for air speed calibration" but was never read downstream.

            const result = calculator.calculate_virtual_elevation(cda, crr, trimStart, trimEnd);

            log.debug('VE calculation result:', {
                r2: result.r2,
                rmse: result.rmse,
                veGain: result.ve_elevation_diff,
                actualGain: result.actual_elevation_diff,
                windSource: windSource
            });

            // Store result globally for save functionality
            appState.currentVEResult = result;
            appState.currentWindSource = windSource as 'constant' | 'fit' | 'compare' | 'none';

            // Update metrics
            updateVEMetrics(result);

            // Use zero altitude for plotting if velodrome mode is enabled
            const plotAltitude = appState.currentParameters.velodrome
                ? new Array(altitude.length).fill(0)
                : altitude;

            // Create plots with Plotly.js
            createVirtualElevationPlots(trimStart, trimEnd, result.virtual_elevation, plotAltitude);

            // Update CdA validation plots if CdA reference data is available
            if (appState.currentCdaReference) {
                await updateCdaValidationPlots(
                    timestamps, power, velocity, positionLat, positionLong, altitude, distance,
                    calibratedWindSpeed,
                    cda, crr, trimStart, trimEnd, result
                );
            }
        }

    } catch (error) {
        log.error('Error updating VE plots with wind source:', error);
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

    const Plotly = await waitForPlotly();

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

    const lapVEProfiles: LapVEProfile[] = [];

    // Calculate VE for each selected GPS lap
    for (let lapIdx = 0; lapIdx < appState.currentGpsLapIndexRanges.length; lapIdx++) {
        const range = appState.currentGpsLapIndexRanges[lapIdx];
        const lapNumber = appState.gpsDetectedLaps[lapIdx]?.lapNumber ?? (lapIdx + 1);

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
    appState.currentWindSource = 'none';  // GPS lap mode stores aggregate VE metrics separately from the standard-mode wind source state.

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

    updateVEMetrics({
        r2: stats.meanR2,
        rmse: stats.meanRMSE,
        ve_elevation_diff: stats.avgVeGain,
        actual_elevation_diff: stats.avgActualGain,
        virtual_elevation: new Float64Array(0),
        virtual_distance_air: 0,
        virtual_distance_ground: 0,
        vd_difference_percent: 0
    });

    // Find maximum distance for axis
    let maxDist = 0;
    for (const lap of lapVEProfiles) {
        const lapMax = lap.distances[lap.distances.length - 1];
        if (lapMax > maxDist) maxDist = lapMax;
    }

    // Build plot traces for main VE plot
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
    for (let i = 0; i < lapVEProfiles.length; i++) {
        const lap = lapVEProfiles[i];
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
            y: -0.15
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

    // Render plots to the existing VE plot containers
    Plotly.newPlot('vePlot', veTraces, veLayout, { responsive: true });
    Plotly.newPlot('veResidualsPlot', residualTraces, residualLayout, { responsive: true });

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
    defaultAirSpeedOffset: number
) {
    showLoading('Calculating VE for out-and-back sections...');

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
    const windSourceRadio = document.querySelector('input[name="windSource"]:checked') as HTMLInputElement;
    const outAndBackWindResolution = resolveWindSeries({
        fitData,
        windSource: windSourceRadio ? windSourceRadio.value : null,
        params,
        airSpeedCalibrationPercent: appState.airSpeedCalibrationPercent,
    });
    const {
        hasAirSpeed,
        hasWindSpeed,
        windSpeed: allWindSpeed,
    } = outAndBackWindResolution;
    const windSpeedOffset = params?.air_speed_offset ?? defaultAirSpeedOffset;

    if (outAndBackWindResolution.selectedWindSource === 'constant') {
        log.debug('Out and Back VE: Using constant wind settings');
    } else if (outAndBackWindResolution.dataSource === 'air_speed') {
        log.debug(`Out and Back VE: Using FIT air speed data (offset: ${windSpeedOffset}s, calibration: ${appState.airSpeedCalibrationPercent}%)`);
    } else if (outAndBackWindResolution.dataSource === 'wind_speed') {
        log.debug(`Out and Back VE: Using FIT wind speed data (offset: ${windSpeedOffset}s, calibration: ${appState.airSpeedCalibrationPercent}%)`);
    } else {
        log.debug('Out and Back VE: No wind data available');
    }

    const cda = params.cda ?? 0.3;
    const crr = params.crr ?? 0.008;

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
                    params,
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
                    params,
                    selectedWindSource: outAndBackWindResolution.selectedWindSource,
                });
                profile.outboundDistances = profile.outboundSeries.distancesKm;
                profile.outboundVE = veArray;
                profile.outboundActualElevation = params.velodrome
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
                    params,
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
                    params,
                    selectedWindSource: outAndBackWindResolution.selectedWindSource,
                });
                profile.inboundDistances = profile.inboundSeries.distancesKm;
                profile.inboundVE = veArray;
                profile.inboundActualElevation = params.velodrome
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
    const hasConstantWind = params.wind_speed !== undefined && params.wind_speed !== 0 &&
                            params.wind_direction !== undefined;

    // Preserve current wind source selection if UI exists (for recalculations)
    const currentWindSourceRadio = document.querySelector('input[name="windSource"]:checked') as HTMLInputElement;
    const preservedWindSource = currentWindSourceRadio ? currentWindSourceRadio.value : null;

    // Show the Out and Back VE analysis interface with wind data info
    showOutAndBackVEPlot(profiles, meanElevation, params, hasAirSpeed || hasWindSpeed, hasConstantWind, defaultAirSpeedOffset, preservedWindSource);
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

    // Store profiles globally for recalculation
    (window as any).__outAndBackProfiles = profiles;
    (window as any).__outAndBackMeanElevation = meanElevation;

    // Calculate initial statistics
    const initialStats = calculateOutAndBackStats(profiles, meanElevation);

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
                                    <input type="number" id="airSpeedCalibrationValue" value="0.0" step="0.1" min="-20.0" max="20.0"
                                           style="width: 60px; text-align: right;" />
                                    <span>%</span>
                                </div>
                                <input type="range" id="airSpeedCalibrationSlider" min="-20.0" max="20.0" step="0.1" value="0.0" />
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
    setupOutAndBackTabSwitching(profiles, showWindTab, showVirtualDistanceTab);

    // Setup wind source radio button listeners
    const windSourceRadios = document.querySelectorAll('input[name="windSource"]');
    windSourceRadios.forEach(radio => {
        radio.addEventListener('change', () => {
            log.debug('Wind source changed - triggering Out and Back VE recalculation');
            recalculateOutAndBackVE();
        });
    });

    // Setup air speed calibration listeners
    const airSpeedCalibrationSlider = document.getElementById('airSpeedCalibrationSlider') as HTMLInputElement;
    const airSpeedCalibrationValueEl = document.getElementById('airSpeedCalibrationValue') as HTMLInputElement;

    if (airSpeedCalibrationSlider && airSpeedCalibrationValueEl) {
        const updateAirSpeedCalibration = () => {
            const value = parseFloat(airSpeedCalibrationSlider.value);
            airSpeedCalibrationValueEl.value = value.toFixed(1);
            appState.airSpeedCalibrationPercent = value;
            log.debug('Air speed calibration changed - triggering Out and Back VE recalculation');
            const cda = parseFloat((document.getElementById('cdaValue') as HTMLInputElement)?.value || '0.3');
            const crr = parseFloat((document.getElementById('crrValue') as HTMLInputElement)?.value || '0.008');
            updateOutAndBackVEPlots(cda, crr);
        };

        const updateAirSpeedCalibrationFromInput = () => {
            const value = parseFloat(airSpeedCalibrationValueEl.value);
            if (isNaN(value)) return;
            const clamped = Math.max(-20.0, Math.min(value, 20.0));
            airSpeedCalibrationSlider.value = clamped.toString();
            airSpeedCalibrationValueEl.value = clamped.toFixed(1);
            appState.airSpeedCalibrationPercent = clamped;
            log.debug('Air speed calibration changed - triggering Out and Back VE recalculation');
            const cda = parseFloat((document.getElementById('cdaValue') as HTMLInputElement)?.value || '0.3');
            const crr = parseFloat((document.getElementById('crrValue') as HTMLInputElement)?.value || '0.008');
            updateOutAndBackVEPlots(cda, crr);
        };

        airSpeedCalibrationSlider.addEventListener('input', updateAirSpeedCalibration);
        airSpeedCalibrationValueEl.addEventListener('change', updateAirSpeedCalibrationFromInput);

        // Setup auto-adjust button
        const autoAdjustButton = document.getElementById('autoAdjustCalibration') as HTMLButtonElement;
        if (autoAdjustButton) {
            autoAdjustButton.addEventListener('click', () => {
                // Auto-adjust logic for Out and Back mode
                log.debug('Auto-adjust clicked for Out and Back mode');
                alert('Auto-adjust for Out and Back mode is not yet implemented. Please adjust manually.');
            });
        }
    }

    // Setup screenshot button
    const screenshotBtn = document.getElementById('saveScreenshot');
    if (screenshotBtn) {
        screenshotBtn.addEventListener('click', () => {
            saveOutAndBackScreenshot();
        });
    }

    // Setup store result button
    const storeBtn = document.getElementById('storeResult');
    if (storeBtn) {
        storeBtn.addEventListener('click', () => {
            handleStoreResult();
        });
    }

    // Setup export button
    const exportBtn = document.getElementById('exportAllResults');
    if (exportBtn) {
        exportBtn.addEventListener('click', () => {
            handleExportAllResults();
        });
    }

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
            triggerRecalculation();
        });
        cdaValueEl.addEventListener('change', () => {
            cdaSlider.value = cdaValueEl.value;
            triggerRecalculation();
        });
    }

    if (crrSlider && crrValueEl) {
        crrSlider.addEventListener('input', () => {
            crrValueEl.value = parseFloat(crrSlider.value).toFixed(4);
            triggerRecalculation();
        });
        crrValueEl.addEventListener('change', () => {
            crrSlider.value = crrValueEl.value;
            triggerRecalculation();
        });
    }
}

/**
 * Setup tab switching for Out and Back mode
 */
function setupOutAndBackTabSwitching(profiles: OutAndBackVEProfile[], showWindTab: boolean, showVirtualDistanceTab: boolean) {
    const tabButtons = document.querySelectorAll('.ve-tab-button');
    tabButtons.forEach(button => {
        button.addEventListener('click', (e) => {
            const target = e.target as HTMLElement;
            const tabName = target.getAttribute('data-tab');

            // Update button states
            tabButtons.forEach(btn => btn.classList.remove('active'));
            target.classList.add('active');

            // Update tab content
            document.querySelectorAll('.ve-tab-content').forEach(content => {
                content.classList.remove('active');
            });
            document.getElementById(`${tabName}-tab`)?.classList.add('active');

            // Render tab-specific content when switched to
            if (tabName === 'wind' && showWindTab) {
                renderOutAndBackWindPlot(profiles);
            } else if (tabName === 'power') {
                renderOutAndBackPowerPlot(profiles);
            } else if (tabName === 'vd' && showVirtualDistanceTab) {
                renderOutAndBackVdPlot(profiles);
            }
        });
    });
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
    const windSourceRadio = document.querySelector('input[name="windSource"]:checked') as HTMLInputElement;
    const outAndBackUpdateWindResolution = resolveWindSeries({
        fitData: appState.currentFitData,
        windSource: windSourceRadio ? windSourceRadio.value : null,
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

async function createVirtualElevationPlots(
    trimStart: number,
    trimEnd: number,
    virtualElevationIn: Float64Array | number[],
    actualElevationIn: Float64Array | number[],
) {
    // Convert once at the boundary. Downstream .slice/.length/.map all
    // work on either input, but Float64Array.slice returns Float64Array
    // which fouls the existing `.map(...)` calls that expect number[].
    const virtualElevation: number[] = Array.from(virtualElevationIn);
    const actualElevation: number[] = Array.from(actualElevationIn);
    log.debug('Creating VE plots:', {
        trimStart,
        trimEnd,
        dataLength: virtualElevation.length,
        trimEndIsInclusive: 'trimEnd value represents last INCLUDED index',
        willSlice: `slice(${trimStart}, ${trimEnd + 1})`,
        dataPointsInMainRegion: trimEnd - trimStart + 1
    });

    // Wait for Plotly to load
    let Plotly;
    try {
        Plotly = await waitForPlotly();
    } catch (error) {
        log.error('Failed to load Plotly:', error);
        // Show error message in plot divs
        const vePlotDiv = document.getElementById('vePlot');
        const residualsPlotDiv = document.getElementById('veResidualsPlot');
        if (vePlotDiv) vePlotDiv.innerHTML = '<p style="text-align: center; padding: 50px; color: #e74c3c;">Plotly failed to load. Please check your internet connection.</p>';
        if (residualsPlotDiv) residualsPlotDiv.innerHTML = '<p style="text-align: center; padding: 50px; color: #e74c3c;">Plotly failed to load. Please check your internet connection.</p>';
        return;
    }

    const cdaSlider = document.getElementById('cdaSlider') as HTMLInputElement;
    const crrSlider = document.getElementById('crrSlider') as HTMLInputElement;
    const cdaValue = cdaSlider ? parseFloat(cdaSlider.value).toFixed(3) : '0.300';
    const crrValue = crrSlider ? parseFloat(crrSlider.value).toFixed(4) : '0.0050';
    const plotContext = createPlotContext(virtualElevation.length, trimStart, trimEnd);
    const figures = buildVirtualElevationFigures({
        context: plotContext,
        virtualElevation,
        actualElevation,
        cdaLabel: cdaValue,
        crrLabel: crrValue,
    });

    // Create the plots
    try {
        const vePlotDiv = document.getElementById('vePlot');
        const residualsPlotDiv = document.getElementById('veResidualsPlot');

        log.debug('Plot divs found:', { vePlot: !!vePlotDiv, residualsPlot: !!residualsPlotDiv });
        log.debug('Plot data:', {
            elevationPoints: figures.elevation.data.length,
            residualsPoints: figures.residuals.data.length,
            sampleVirtualElevation: virtualElevation.slice(trimStart, trimStart + 5),
            sampleActualElevation: actualElevation.slice(trimStart, trimStart + 5)
        });

        if (vePlotDiv && residualsPlotDiv) {
            log.debug('Creating elevation plot...');
            await Plotly.newPlot(vePlotDiv, figures.elevation.data, figures.elevation.layout, figures.elevation.config);
            log.debug('Elevation plot created');

            log.debug('Creating residuals plot...');
            await Plotly.newPlot(residualsPlotDiv, figures.residuals.data, figures.residuals.layout, figures.residuals.config);
            log.debug('Residuals plot created');

            // Link the x-axes so they zoom/pan together (with guards to prevent infinite loops)
            let isRelayoutInProgress = false;

            (vePlotDiv as PlotlyHTMLElement).on('plotly_relayout', (eventData: any) => {
                if (isRelayoutInProgress) return;

                if (eventData['xaxis.range[0]'] !== undefined && eventData['xaxis.range[1]'] !== undefined) {
                    isRelayoutInProgress = true;
                    Plotly.relayout(residualsPlotDiv, {
                        'xaxis.range[0]': eventData['xaxis.range[0]'],
                        'xaxis.range[1]': eventData['xaxis.range[1]']
                    }).finally(() => {
                        isRelayoutInProgress = false;
                    });
                } else if (eventData['xaxis.autorange'] !== undefined) {
                    isRelayoutInProgress = true;
                    Plotly.relayout(residualsPlotDiv, { 'xaxis.autorange': eventData['xaxis.autorange'] }).finally(() => {
                        isRelayoutInProgress = false;
                    });
                }
            });

            (residualsPlotDiv as PlotlyHTMLElement).on('plotly_relayout', (eventData: any) => {
                if (isRelayoutInProgress) return;

                if (eventData['xaxis.range[0]'] !== undefined && eventData['xaxis.range[1]'] !== undefined) {
                    isRelayoutInProgress = true;
                    Plotly.relayout(vePlotDiv, {
                        'xaxis.range[0]': eventData['xaxis.range[0]'],
                        'xaxis.range[1]': eventData['xaxis.range[1]']
                    }).finally(() => {
                        isRelayoutInProgress = false;
                    });
                } else if (eventData['xaxis.autorange'] !== undefined) {
                    isRelayoutInProgress = true;
                    Plotly.relayout(vePlotDiv, { 'xaxis.autorange': eventData['xaxis.autorange'] }).finally(() => {
                        isRelayoutInProgress = false;
                    });
                }
            });
        } else {
            log.error('Plot divs not found!');
        }
    } catch (error) {
        log.error('Error creating plots:', error);
    }
}

// Update CdA validation plots and metrics dynamically
async function updateCdaValidationPlots(
    timestamps: number[],
    power: number[],
    velocity: number[],
    positionLat: number[],
    positionLong: number[],
    altitude: number[],
    distance: number[],
    windSpeed: number[],
    cdaOptimized: number,
    crrOptimized: number,
    trimStart: number,
    trimEnd: number,
    veOptimizedResult: any
) {
    if (!appState.currentCdaReference || !appState.currentParameters) return;

    // Calculate average CdA from reference data for the TRIMMED region (for metrics display)
    const trimmedCdaRef = appState.currentCdaReference.slice(trimStart, trimEnd + 1);
    const validCda = trimmedCdaRef.filter(c => !isNaN(c));
    if (validCda.length === 0) return;

    const avgCdaRef = validCda.reduce((sum, c) => sum + c, 0) / validCda.length;

    const refCalculator = createVeCalculator({
        timestamps,
        power,
        velocity,
        positionLat,
        positionLong,
        altitude,
        distance,
        windSpeed,
        rhoArray: appState.currentRhoArray,
        params: appState.currentParameters,
        cda: appState.currentParameters.cda,
        crr: crrOptimized,
    });

    // Calculate VE with per-datapoint CdA reference array
    // Pre-process: Replace any NaN values with the average to avoid using default 0.3
    const cleanedCdaRef = appState.currentCdaReference.map(cda => isNaN(cda) ? avgCdaRef : cda);
    const cdaRefArray = new Float64Array(cleanedCdaRef);

    // Debug: Verify we're using per-datapoint CdA, not average
    const nanCount = appState.currentCdaReference.filter(c => isNaN(c)).length;
    log.debug('CdA Array Debug:', {
        arrayLength: cdaRefArray.length,
        trimmedLength: trimmedCdaRef.length,
        nanCount: nanCount,
        nanReplaced: nanCount > 0 ? `${nanCount} NaN values replaced with average (${avgCdaRef.toFixed(4)})` : 'No NaN values',
        sampleValues: Array.from(cdaRefArray.slice(trimStart, trimStart + 10)),
        average: avgCdaRef,
        min: Math.min(...Array.from(cdaRefArray.slice(trimStart, trimEnd + 1))),
        max: Math.max(...Array.from(cdaRefArray.slice(trimStart, trimEnd + 1))),
        stdDev: (() => {
            const trimmedArray = Array.from(cdaRefArray.slice(trimStart, trimEnd + 1));
            const mean = avgCdaRef;
            const variance = trimmedArray.reduce((sum, val) => sum + Math.pow(val - mean, 2), 0) / trimmedArray.length;
            return Math.sqrt(variance);
        })(),
        usingPerDatapoint: true
    });

    let refResult;
    try {
        refResult = refCalculator.calculate_virtual_elevation_with_cda_array(cdaRefArray, crrOptimized, trimStart, trimEnd);
    } catch (error) {
        log.error('Error calculating VE with CdA array - WASM method may not exist yet:', error);
        log.error('Please rebuild WASM with: ./build.sh or wasm-pack build backend --target web --out-dir ../frontend/wasm');
        return;
    }

    // Update metrics
    const cdaOptimizedMetrics = document.getElementById('cdaOptimizedMetrics');
    const cdaReferenceMetrics = document.getElementById('cdaReferenceMetrics');
    const cdaDifferenceMetrics = document.getElementById('cdaDifferenceMetrics');

    if (cdaOptimizedMetrics) {
        cdaOptimizedMetrics.innerHTML = `
            CdA: <span style="font-weight: 600;">${cdaOptimized.toFixed(4)}</span><br>
            VE Gain: <span style="font-weight: 600;">${veOptimizedResult.ve_elevation_diff.toFixed(2)}m</span>
        `;
    }

    if (cdaReferenceMetrics) {
        cdaReferenceMetrics.innerHTML = `
            CdA: <span style="font-weight: 600;">${avgCdaRef.toFixed(4)}</span><br>
            VE Gain: <span style="font-weight: 600;">${refResult.ve_elevation_diff.toFixed(2)}m</span>
        `;
    }

    if (cdaDifferenceMetrics) {
        const cdaDiff = cdaOptimized - avgCdaRef;
        const veGainDiff = veOptimizedResult.ve_elevation_diff - refResult.ve_elevation_diff;

        cdaDifferenceMetrics.innerHTML = `
            <strong>Difference:</strong>
            CdA: <span style="font-weight: 600;">${cdaDiff >= 0 ? '+' : ''}${cdaDiff.toFixed(4)}</span> |
            VE Gain: <span style="font-weight: 600;">${veGainDiff >= 0 ? '+' : ''}${veGainDiff.toFixed(2)}m</span>
        `;
    }

    // Render plots
    const Plotly = await waitForPlotly();
    const vePlotDiv = document.getElementById('cdaValidationPlot');
    const residualsPlotDiv = document.getElementById('cdaValidationResidualsPlot');

    if (!vePlotDiv || !residualsPlotDiv) return;

    // Extract data (trim end is inclusive, so we slice to trimEnd + 1)
    const veRefCdaArray = Array.from(refResult.virtual_elevation).slice(trimStart, trimEnd + 1) as number[];
    const veSliderCdaArray = Array.from(veOptimizedResult.virtual_elevation).slice(trimStart, trimEnd + 1) as number[];
    const actualElevation = altitude.slice(trimStart, trimEnd + 1);
    const timeSlice = timestamps.slice(trimStart, trimEnd + 1);

    // Calculate elevation offset (start at actual elevation, not 0)
    const elevationOffset = actualElevation[0];

    log.debug('Before offset:', {
        veRefCdaFirst: veRefCdaArray[0],
        veSliderCdaFirst: veSliderCdaArray[0],
        difference: veRefCdaArray[0] - veSliderCdaArray[0],
        actualElevFirst: actualElevation[0]
    });

    const offsetVeRefCda = veRefCdaArray.map(ve => ve - veRefCdaArray[0] + elevationOffset);
    const offsetVeSliderCda = veSliderCdaArray.map(ve => ve - veSliderCdaArray[0] + elevationOffset);

    // Residuals: VE (slider CdA) - VE (ref CdA)
    const residuals = offsetVeSliderCda.map((ve, i) => ve - offsetVeRefCda[i]);

    // Debug: Check if VE profiles are actually different
    log.debug('VE Profile Comparison:', {
        sliderCdA: cdaOptimized,
        avgRefCdA: avgCdaRef,
        cdaDiffPercent: ((cdaOptimized - avgCdaRef) / avgCdaRef * 100).toFixed(2) + '%',
        veRefSample: offsetVeRefCda.slice(0, 5),
        veSliderSample: offsetVeSliderCda.slice(0, 5),
        veRefFinal: offsetVeRefCda[offsetVeRefCda.length - 1],
        veSliderFinal: offsetVeSliderCda[offsetVeSliderCda.length - 1],
        totalVEDiff: offsetVeSliderCda[offsetVeSliderCda.length - 1] - offsetVeRefCda[offsetVeRefCda.length - 1],
        residualsSample: residuals.slice(0, 5),
        maxResidual: Math.max(...residuals.map(Math.abs)),
        avgResidual: residuals.reduce((sum, r) => sum + Math.abs(r), 0) / residuals.length,
        expectedDiff: 'With 5% CdA difference, expecting significant VE difference'
    });

    // VE plot comparing slider CdA vs reference CdA
    const vePlotData = [
        {
            x: timeSlice,
            y: offsetVeSliderCda,
            mode: 'lines',
            name: `VE (Slider CdA: ${cdaOptimized.toFixed(4)})`,
            line: { color: '#1976d2', width: 2 } // Blue for slider CdA
        },
        {
            x: timeSlice,
            y: offsetVeRefCda,
            mode: 'lines',
            name: `VE (Ref CdA: ${avgCdaRef.toFixed(4)})`,
            line: { color: '#000', width: 2 } // Black for reference CdA
        }
    ];

    const vePlotLayout = {
        title: `CdA Validation - VE Comparison`,
        xaxis: { title: 'Time (seconds)' },
        yaxis: { title: 'Virtual Elevation (m)' },
        showlegend: true,
        margin: { l: 60, r: 20, t: 40, b: 5 },
        height: 380
    };

    // Residuals plot: difference between the two VE calculations
    const residualsData = [{
        x: timeSlice,
        y: residuals,
        mode: 'markers',
        name: 'VE Difference',
        marker: { color: '#1976d2', size: 3 }
    }, {
        x: timeSlice,
        y: new Array(residuals.length).fill(0),
        mode: 'lines',
        name: 'Zero',
        line: { color: 'black', width: 1, dash: 'dash' },
        showlegend: false
    }];

    const residualsLayout = {
        title: 'Residuals (VE Slider - VE Ref)',
        xaxis: { title: 'Time (seconds)' },
        yaxis: { title: 'VE Difference (m)' },
        showlegend: false,
        margin: { l: 60, r: 20, t: 30, b: 60 },
        height: 220
    };

    const config = {
        responsive: true,
        displayModeBar: true,
        modeBarButtonsToRemove: ['pan2d', 'lasso2d', 'select2d'],
        displaylogo: false
    };

    Plotly.newPlot(vePlotDiv, vePlotData, vePlotLayout, config);
    Plotly.newPlot(residualsPlotDiv, residualsData, residualsLayout, config);
}

function updateVEMetrics(result: any) {
    const r2Value = document.getElementById('r2Value') as HTMLSpanElement;
    const rmseValue = document.getElementById('rmseValue') as HTMLSpanElement;
    const veGainValue = document.getElementById('veGainValue') as HTMLSpanElement;
    const actualGainValue = document.getElementById('actualGainValue') as HTMLSpanElement;

    if (r2Value) r2Value.textContent = result.r2.toFixed(4);
    if (rmseValue) rmseValue.textContent = result.rmse.toFixed(2) + ' m';
    if (veGainValue) veGainValue.textContent = result.ve_elevation_diff.toFixed(2) + ' m';
    if (actualGainValue) actualGainValue.textContent = result.actual_elevation_diff.toFixed(2) + ' m';

    // Update VD metrics if available
    const vdAirValue = document.getElementById('vdAirValue') as HTMLSpanElement;
    const vdGroundValue = document.getElementById('vdGroundValue') as HTMLSpanElement;
    const vdDiffValue = document.getElementById('vdDiffValue') as HTMLSpanElement;

    if (vdAirValue && result.virtual_distance_air !== undefined) {
        vdAirValue.textContent = (result.virtual_distance_air / 1000).toFixed(3) + ' km';
    }
    if (vdGroundValue && result.virtual_distance_ground !== undefined) {
        vdGroundValue.textContent = (result.virtual_distance_ground / 1000).toFixed(3) + ' km';
    }
    if (vdDiffValue && result.vd_difference_percent !== undefined) {
        const diffPercent = result.vd_difference_percent;
        vdDiffValue.textContent = (diffPercent >= 0 ? '+' : '') + diffPercent.toFixed(2) + '%';
        vdDiffValue.style.color = diffPercent >= 0 ? '#4caf50' : '#f44336';
    }
}

function updateVEMetricsComparison(result1: any, result2: any) {
    const r2Value = document.getElementById('r2Value') as HTMLSpanElement;
    const rmseValue = document.getElementById('rmseValue') as HTMLSpanElement;
    const veGainValue = document.getElementById('veGainValue') as HTMLSpanElement;
    const actualGainValue = document.getElementById('actualGainValue') as HTMLSpanElement;

    // Display both results side by side
    if (r2Value) r2Value.textContent = `Const: ${result1.r2.toFixed(4)} | FIT: ${result2.r2.toFixed(4)}`;
    if (rmseValue) rmseValue.textContent = `Const: ${result1.rmse.toFixed(2)} m | FIT: ${result2.rmse.toFixed(2)} m`;
    if (veGainValue) veGainValue.textContent = `Const: ${result1.ve_elevation_diff.toFixed(1)} m | FIT: ${result2.ve_elevation_diff.toFixed(1)} m`;
    if (actualGainValue) actualGainValue.textContent = result1.actual_elevation_diff.toFixed(1) + ' m';
}

async function createVirtualElevationPlotsComparison(
    trimStart: number,
    trimEnd: number,
    virtualElevation1In: Float64Array | number[],
    virtualElevation2In: Float64Array | number[],
    actualElevationIn: Float64Array | number[],
) {
    // Normalize WASM Float64Array inputs to plain number[] once. See the
    // companion note in createVirtualElevationPlots.
    const virtualElevation1: number[] = Array.from(virtualElevation1In);
    const virtualElevation2: number[] = Array.from(virtualElevation2In);
    const actualElevation: number[] = Array.from(actualElevationIn);
    // Wait for Plotly to load
    let Plotly;
    try {
        Plotly = await waitForPlotly();
    } catch (error) {
        log.error('Failed to load Plotly:', error);
        const vePlotDiv = document.getElementById('vePlot');
        const residualsPlotDiv = document.getElementById('veResidualsPlot');
        if (vePlotDiv) vePlotDiv.innerHTML = '<p style="text-align: center; padding: 50px; color: #e74c3c;">Plotly failed to load. Please check your internet connection.</p>';
        if (residualsPlotDiv) residualsPlotDiv.innerHTML = '<p style="text-align: center; padding: 50px; color: #e74c3c;">Plotly failed to load. Please check your internet connection.</p>';
        return;
    }

    const figures = buildVirtualElevationComparisonFigures({
        context: createPlotContext(virtualElevation1.length, trimStart, trimEnd, 0),
        virtualElevationConstant: virtualElevation1,
        virtualElevationFit: virtualElevation2,
        actualElevation,
    });

    await Plotly.newPlot('vePlot', figures.elevation.data, figures.elevation.layout, figures.elevation.config);
    await Plotly.newPlot('veResidualsPlot', figures.residuals.data, figures.residuals.layout, figures.residuals.config);
}

async function createWindSpeedPlot(analysisInput: AnalysisInput, trimStart: number, trimEnd: number, defaultAirSpeedOffset: number = 0) {
    const { velocity, windSpeed } = analysisInput;

    if (!appState.currentParameters) {
        log.error('createWindSpeedPlot: appState.currentParameters is null');
        return;
    }

    let Plotly;
    try {
        Plotly = await waitForPlotly();
    } catch (error) {
        log.error('Failed to load Plotly:', error);
        const windPlotDiv = document.getElementById('windSpeedPlot');
        if (windPlotDiv) windPlotDiv.innerHTML = '<p style="text-align: center; padding: 50px; color: #e74c3c;">Plotly failed to load. Please check your internet connection.</p>';
        return;
    }

    const hasWindSpeed = windSpeed.some(value => !isNaN(value) && value !== 0);
    const hasConstantWind = appState.currentParameters.wind_speed !== undefined && appState.currentParameters.wind_speed !== 0 &&
        appState.currentParameters.wind_direction !== undefined;
    const windSpeedOffset = appState.currentParameters.air_speed_offset ?? defaultAirSpeedOffset;
    const fitWindSpeedKmh = hasWindSpeed
        ? applyAirSpeedOffset(windSpeed, windSpeedOffset).map(value => isNaN(value) ? null : value * 3.6)
        : new Array<number | null>(velocity.length).fill(null);

    let constantWindApparentKmh: number[] | undefined;
    if (hasConstantWind) {
        const constantWindApparentSpeed = calculateConstantApparentWindSeries(
            velocity,
            appState.filteredVEData?.positionLat ?? [],
            appState.filteredVEData?.positionLong ?? [],
            appState.currentParameters,
        );
        constantWindApparentKmh = constantWindApparentSpeed.map(value => value * 3.6);
    }

    const figure = buildWindSpeedFigure({
        context: createPlotContext(velocity.length, trimStart, trimEnd),
        velocity,
        fitWindSpeedKmh,
        constantWindApparentKmh,
    });

    await Plotly.newPlot('windSpeedPlot', figure.data, figure.layout, figure.config);
}

async function createSpeedPowerPlot(analysisInput: AnalysisInput, trimStart: number, trimEnd: number) {
    let Plotly;
    try {
        Plotly = await waitForPlotly();
    } catch (error) {
        log.error('Failed to load Plotly:', error);
        const plotDiv = document.getElementById('speedPowerPlot');
        if (plotDiv) plotDiv.innerHTML = '<p style="text-align: center; padding: 50px; color: #e74c3c;">Plotly failed to load. Please check your internet connection.</p>';
        return;
    }

    const figure = buildSpeedPowerFigure({
        context: createPlotContext(analysisInput.velocity.length, trimStart, trimEnd),
        velocity: analysisInput.velocity,
        power: analysisInput.power,
    });

    await Plotly.newPlot('speedPowerPlot', figure.data, figure.layout, figure.config);
}

async function createVirtualDistancePlot(analysisInput: AnalysisInput, trimStart: number, trimEnd: number) {
    let Plotly;
    try {
        Plotly = await waitForPlotly();
    } catch (error) {
        log.error('Failed to load Plotly:', error);
        const plotDiv = document.getElementById('vdPlot');
        if (plotDiv) plotDiv.innerHTML = '<p style="text-align: center; padding: 50px; color: #e74c3c;">Plotly failed to load. Please check your internet connection.</p>';
        return;
    }

    const figure = buildVirtualDistanceFigure({
        context: createPlotContext(analysisInput.velocity.length, trimStart, trimEnd),
        timestamps: analysisInput.timestamps,
        velocity: analysisInput.velocity,
        windSpeed: analysisInput.windSpeed,
        airSpeedCalibrationPercent: appState.airSpeedCalibrationPercent,
    });

    await Plotly.newPlot('vdPlot', figure.data, figure.layout, figure.config);
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
    DataProtection.secureMemoryWipe();
});