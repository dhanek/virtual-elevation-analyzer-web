import { DataProtection } from './utils/DataProtection';
import { FitFileProcessor } from './components/FitFileProcessor';
import { MapVisualization } from './components/MapVisualization';
import { AnalysisParametersComponent, AnalysisParameters } from './components/AnalysisParameters';
import { ViewportAdapter } from './utils/ViewportAdapter';
import { ParameterStorage, type LapSettings } from './utils/ParameterStorage';
import { ResultsStorage, type VEAnalysisResult } from './utils/ResultsStorage';
import { DEMManager, ElevationProfileCache } from './utils/DEMManager';
import { calculateTrimRegionMetadata, formatCoordinates } from './utils/GeoCalculations';
import { WeatherAPI, WeatherAPIError } from './utils/WeatherAPI';
import { WeatherCache, type WeatherCacheEntry } from './utils/WeatherCache';
import { GibliCsvParser, type GibliCsvData, CsvParseError } from './utils/CsvParser';
import { interpolateAllData, analyzeTimeIntervals } from './utils/DataInterpolation';
import {
    GpsLapDetector,
    OutAndBackDetector,
    type GpsLapDetectionConfig,
    type DetectedLap,
    type GpsLapDetectionResult,
    type OutAndBackConfig,
    type OutAndBackSection,
    type OutAndBackResult,
    getDefaultLapDetectionConfig,
    DEFAULT_OUT_AND_BACK_CONFIG,
    formatLapDuration,
    formatLapDistance
} from './utils/GpsLapDetection';
import init, { create_ve_calculator, create_ve_calculator_with_rho_array, AirDensityCalculator } from '../pkg/virtual_elevation_analyzer.js';

// Plotly.js type declaration
declare const Plotly: any;

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
                    console.error('Plotly script loaded but Plotly is not on window object');
                    reject(new Error('Plotly loaded but not available'));
                }
            }, 100);
        };

        script.onerror = (error) => {
            console.error('Failed to load Plotly script:', error);
            console.error('Network error or CSP blocking the script');
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
const correctElevationCheckbox = document.getElementById('correctElevationCheckbox') as HTMLInputElement;

let selectedFile: File | null = null;
let fitProcessor: FitFileProcessor | null = null;
let mapVisualization: MapVisualization | null = null;
let parametersComponent: AnalysisParametersComponent | null = null;
let viewportAdapter: ViewportAdapter;
let parameterStorage: ParameterStorage;
let currentFileHash: string | null = null;
let currentFitData: any = null; // Unified data structure for both FIT and CSV
let currentFitResult: any = null;
let currentLaps: any[] = [];
let currentCdaReference: number[] | null = null; // Filtered CdA reference for current analysis
let currentRhoArray: number[] | null = null; // Per-datapoint rho array for VE calculation
let filteredLapData: {
    position_lat: number[];
    position_long: number[];
    timestamps: number[];
} | null = null;
let isCalculatingAutoRho = false; // Flag to prevent infinite loops
let lastWeatherQueryKey: string | null = null; // Cache last query to avoid redundant API calls
let selectedLaps: number[] = [];
let currentParameters: AnalysisParameters | null = null;
let filteredVEData: { positionLat: number[], positionLong: number[] } | null = null;
let presetTrimStart: number = 0;
let presetTrimEnd: number | null = null;
let isLoadingParameters: boolean = false;
let currentVEResult: VEAnalysisResult | null = null;
let currentWindSource: 'constant' | 'fit' | 'compare' | 'none' = 'none';
let currentAnalyzedLaps: number[] = [];
let currentFilteredData: { power: number[], velocity: number[], temperature: number[], timestamps: number[] } | null = null;
let _veCalculator: any = null; // VE calculator instance for air speed calibration (unused, reserved for future)
let airSpeedCalibrationPercent: number = 0; // Air speed calibration percentage (-20 to +20)
let resultsStorage: ResultsStorage = new ResultsStorage();

// DEM-related state
let demManager: DEMManager = new DEMManager();
let elevationCache: ElevationProfileCache = new ElevationProfileCache();
let selectedDEMFile: File | null = null;
let elevationCorrectionEnabled: boolean = false;
let elevationErrorRate: number = 0;

// GPS Lap Detection state
let gpsLapDetectionResult: GpsLapDetectionResult | null = null;
let gpsDetectedLaps: DetectedLap[] = [];
let gpsSelectedLaps: number[] = [];  // Selected GPS-detected laps for VE analysis
let isGpsLapModeActive: boolean = false;  // Flag for GPS lap mode in VE analysis
let isOutAndBackModeActive: boolean = false;  // Flag for Out and Back mode in VE analysis
let currentGpsLapIndexRanges: Array<{ startIdx: number; endIdx: number }> | null = null;  // Current GPS lap ranges
let previousAutoLapDetection: string = 'None';  // Track previous value to detect changes

// Out and Back Detection state
let outAndBackResult: OutAndBackResult | null = null;
let outAndBackSections: OutAndBackSection[] = [];
let outAndBackSelectedSections: number[] = [];  // Selected sections for VE analysis

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
        console.error('Failed to initialize:', err);
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

correctElevationCheckbox.addEventListener('change', (event) => {
    elevationCorrectionEnabled = (event.target as HTMLInputElement).checked;
});

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
        selectedDEMFile = tifFile;

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

        // Enable correction checkbox
        correctElevationCheckbox.disabled = false;
        correctElevationCheckbox.checked = true;
        elevationCorrectionEnabled = true;

        hideLoading();
        console.log('DEM file loaded successfully:', displayName);
    } catch (err) {
        hideLoading();
        showError(`Failed to load DEM file: ${err}`);
        clearDEMFile();
    }
}

function clearDEMFile(): void {
    demManager.clearDEM();
    selectedDEMFile = null;
    demFileInfo.classList.add('hidden');
    correctElevationCheckbox.disabled = true;
    correctElevationCheckbox.checked = false;
    elevationCorrectionEnabled = false;
    demFileInput.value = '';
    elevationErrorRate = 0;
}

// File validation and display
async function handleFileSelection(file: File) {
    // Validate file type and size
    if (!DataProtection.validateFileType(file)) {
        showError('Please select a valid FIT or CSV file (.fit or .csv extension, under 50MB)');
        return;
    }

    selectedFile = file;
    displayFileInfo(file);

    // Calculate file hash immediately for parameter persistence
    if (parameterStorage) {
        currentFileHash = await parameterStorage.calculateFileHash(file);
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
    if (!selectedFile || !fitProcessor) {
        showError('No file selected or processor not initialized');
        return;
    }

    try {
        // Detect file type
        const fileType = DataProtection.getFileType(selectedFile);

        if (fileType === 'fit') {
            await processFitFile(selectedFile);
        } else if (fileType === 'csv') {
            await processCsvFile(selectedFile);
        } else {
            showError('Unknown file type. Please select a .fit or .csv file.');
            hideLoading();
            return;
        }

    } catch (err) {
        console.error('Error processing file:', err);
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

        // Apply DEM elevation correction if enabled
        if (elevationCorrectionEnabled && demManager.isDEMLoaded() && result.fit_data) {
            showLoading('Correcting elevation using DEM...');

            try {
                const fitData = result.fit_data;
                const lats = fitData.position_lat;
                const lons = fitData.position_long;
                const originalAltitudes = fitData.altitude;

                if (lats && lons && originalAltitudes) {
                    // Debug: Log first few coordinates
                    console.log('Sample GPS coordinates:', {
                        lat: lats.slice(0, 5),
                        lon: lons.slice(0, 5),
                        originalAlt: originalAltitudes.slice(0, 5)
                    });

                    const correctionResult = await demManager.correctElevation(lats, lons, originalAltitudes);

                    console.log('Sample corrected elevations:', correctionResult.elevations.slice(0, 5));

                    // Replace altitudes with corrected values using setter
                    result.fit_data.set_altitude(correctionResult.elevations);
                    elevationErrorRate = correctionResult.errorRate;

                    console.log(`Elevation corrected. Error rate: ${(elevationErrorRate * 100).toFixed(1)}%`);

                    if (elevationErrorRate > 0.5) {
                        console.warn('High error rate! DEM may not cover route area. DEM bounds:', demManager.getDEMBounds());
                    }

                    // Cache the corrected elevation profile
                    if (currentFileHash && elevationCache) {
                        const bounds = {
                            minLat: Math.min(...lats),
                            maxLat: Math.max(...lats),
                            minLon: Math.min(...lons),
                            maxLon: Math.max(...lons)
                        };

                        await elevationCache.cacheProfile(
                            currentFileHash,
                            selectedFile?.name ?? 'unknown',
                            correctionResult.elevations,
                            bounds
                        );
                    }
                } else {
                    console.warn('Missing GPS or altitude data, skipping DEM correction');
                }
            } catch (demError) {
                console.warn('DEM elevation correction failed, using GPS altitude:', demError);
                showError(`Warning: DEM correction failed: ${demError}. Using GPS altitude.`);
                // Continue with original GPS altitude
            }
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
        console.error('Error processing FIT file:', err);
        showError(`Error processing FIT file: ${err}`);
    }
}

// Helper function to calculate cumulative distance from GPS coordinates
function calculateDistanceArray(lats: number[], lons: number[]): number[] {
    const distances: number[] = [0];
    let cumulative = 0;

    for (let i = 1; i < lats.length; i++) {
        const lat1 = lats[i - 1];
        const lon1 = lons[i - 1];
        const lat2 = lats[i];
        const lon2 = lons[i];

        // Haversine formula
        const R = 6371000; // Earth's radius in meters
        const φ1 = lat1 * Math.PI / 180;
        const φ2 = lat2 * Math.PI / 180;
        const Δφ = (lat2 - lat1) * Math.PI / 180;
        const Δλ = (lon2 - lon1) * Math.PI / 180;

        const a = Math.sin(Δφ / 2) * Math.sin(Δφ / 2) +
                  Math.cos(φ1) * Math.cos(φ2) *
                  Math.sin(Δλ / 2) * Math.sin(Δλ / 2);
        const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
        const d = R * c;

        cumulative += d;
        distances.push(cumulative);
    }

    return distances;
}

// Generate laps from CSV lap number column
function generateLapsFromCsv(csvData: GibliCsvData): any[] {
    if (!csvData.hasLapData || !csvData.lapNumber) {
        return [];
    }

    const laps: any[] = [];
    const uniqueLapNumbers = Array.from(new Set(csvData.lapNumber.filter(n => !isNaN(n)))).sort((a, b) => a - b);

    for (const lapNum of uniqueLapNumbers) {
        const indices = csvData.lapNumber
            .map((n, i) => n === lapNum ? i : -1)
            .filter(i => i !== -1);

        if (indices.length > 0) {
            const startIdx = indices[0];
            const endIdx = indices[indices.length - 1];

            laps.push({
                lap_number: lapNum,
                start_time: csvData.timestamps[startIdx],
                end_time: csvData.timestamps[endIdx],
                total_elapsed_time: csvData.timestamps[endIdx] - csvData.timestamps[startIdx],
                start_index: startIdx,
                end_index: endIdx,
                total_distance: 0, // Will calculate if needed
            });
        }
    }

    return laps;
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
    isLoadingParameters = true; // Prevent saving during initialization
    initializeAnalysisParameters();

    // Try to load saved parameters for this file
    if (currentFileHash && parametersComponent) {
        const savedParameters = await parameterStorage.loadParameters(currentFileHash);
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
                console.log('📊 CSV has environmental data - weather API disabled');
            } else if (stats.has_gps_data) {
                // No environmental data but has GPS - enable weather API
                parametersComponent.setParameters({
                    auto_calculate_rho: true
                });
                console.log('📍 GPS data detected - auto-rho enabled');
            }
        }
    }

    isLoadingParameters = false;

    // Update previousAutoLapDetection to match loaded parameters
    previousAutoLapDetection = currentParameters?.auto_lap_detection || 'None';
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
        console.log('📊 No environmental data available, using single rho parameter');
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
            console.warn(`Failed to calculate rho at index ${i}:`, err);
            rhoArray.push(1.225); // Use standard air density as fallback
            failureCount++;
        }
    }

    console.log('📊 Per-datapoint rho calculation:', {
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
function initializeSection3Csv(csvData: GibliCsvData, _result: any) {
    // Calculate distance from GPS coordinates
    const distance = calculateDistanceArray(csvData.positionLat, csvData.positionLong);

    // Calculate wind speed in the direction of the rider from Wind Magnitude and Wind Angle
    // Formula: ws_rider = cos(angle_radians) * magnitude
    const windSpeed = csvData.windAngle.map((angleDeg, i) => {
        const magnitude = csvData.airSpeed[i]; // airSpeed is already converted to m/s
        if (isNaN(angleDeg) || isNaN(magnitude)) {
            return 0;
        }
        const angleRad = (angleDeg * Math.PI) / 180;
        return Math.cos(angleRad) * magnitude;
    });

    console.log('📊 Calculated wind speed from CSV:', {
        sampleAngles: csvData.windAngle.slice(0, 5),
        sampleMagnitudes: csvData.airSpeed.slice(0, 5),
        sampleWindSpeeds: windSpeed.slice(0, 5),
        nonZeroCount: windSpeed.filter(ws => Math.abs(ws) > 0.1).length
    });

    // Create a FitData-compatible structure
    // This structure matches FitData from WASM, allowing all downstream code to work identically
    currentFitData = {
        // Required fields (same as FitData)
        timestamps: csvData.timestamps,
        position_lat: csvData.positionLat,
        position_long: csvData.positionLong,
        altitude: csvData.altitude,
        velocity: csvData.velocity,
        power: csvData.power,
        air_speed: csvData.airSpeed,
        distance: distance,
        wind_speed: windSpeed,
        wind_yaw: csvData.windAngle || new Array(csvData.timestamps.length).fill(0),
        air_density_data: new Array(csvData.timestamps.length).fill(0), // Will be calculated from environmental data if available
        road_speed: new Array(csvData.timestamps.length).fill(0), // Not available in CSV
        temperature: csvData.temperature || new Array(csvData.timestamps.length).fill(0),
        battery_soc: new Array(csvData.timestamps.length).fill(0),
        heart_rate: new Array(csvData.timestamps.length).fill(0),
        cadence: new Array(csvData.timestamps.length).fill(0),
        record_count: csvData.timestamps.length,

        // Extended fields (not in standard FitData, but available from CSV)
        // These will be checked by feature detection, not file type
        humidity: csvData.humidity,  // Optional: only present if CSV has it
        pressure: csvData.pressure,  // Optional: only present if CSV has it
        cda_reference: csvData.cdaReference,  // Optional: only present if CSV has it
    };

    // Call regular initializeSection3
    initializeSection3();
}

// Process CSV file
async function processCsvFile(file: File) {
    try {
        showLoading('Reading CSV file...');

        // Read file content
        const text = await file.text();

        showLoading('Parsing CSV data...');

        // Parse CSV
        let csvData: GibliCsvData;
        try {
            csvData = GibliCsvParser.parse(text);
        } catch (parseError) {
            if (parseError instanceof CsvParseError) {
                showError(`CSV parsing error:\n${parseError.message}`);
            } else {
                showError(`Failed to parse CSV file: ${parseError}`);
            }
            hideLoading();
            return;
        }

        // Show summary
        console.log('CSV Data Summary:');
        console.log(GibliCsvParser.getSummary(csvData));

        // Analyze time intervals
        const intervals = analyzeTimeIntervals(csvData.timestamps);
        console.log('Time interval statistics:', intervals);

        // Interpolate to 1Hz if needed
        if (intervals.std > 0.1) {
            showLoading('Interpolating data to 1Hz...');
            console.log('Non-uniform time series detected, interpolating to 1Hz');

            const dataToInterpolate: Record<string, number[]> = {
                velocity: csvData.velocity,
                power: csvData.power,
                airSpeed: csvData.airSpeed,
                windAngle: csvData.windAngle,
                altitude: csvData.altitude,
                positionLat: csvData.positionLat,
                positionLong: csvData.positionLong,
            };

            // Add optional arrays if they exist
            if (csvData.temperature) dataToInterpolate.temperature = csvData.temperature;
            if (csvData.humidity) dataToInterpolate.humidity = csvData.humidity;
            if (csvData.pressure) dataToInterpolate.pressure = csvData.pressure;
            if (csvData.cdaReference) dataToInterpolate.cdaReference = csvData.cdaReference;
            if (csvData.lapNumber) dataToInterpolate.lapNumber = csvData.lapNumber;

            const interpolated = interpolateAllData(csvData.timestamps, dataToInterpolate);

            // Replace with interpolated data
            csvData.timestamps = interpolated.timestamps;
            csvData.velocity = interpolated.velocity;
            csvData.power = interpolated.power;
            csvData.airSpeed = interpolated.airSpeed;
            csvData.windAngle = interpolated.windAngle;
            csvData.altitude = interpolated.altitude;
            csvData.positionLat = interpolated.positionLat;
            csvData.positionLong = interpolated.positionLong;
            if (interpolated.temperature) csvData.temperature = interpolated.temperature;
            if (interpolated.humidity) csvData.humidity = interpolated.humidity;
            if (interpolated.pressure) csvData.pressure = interpolated.pressure;
            if (interpolated.cdaReference) csvData.cdaReference = interpolated.cdaReference;
            if (interpolated.lapNumber) csvData.lapNumber = interpolated.lapNumber;

            console.log(`Interpolated to ${csvData.timestamps.length} data points at 1Hz`);
        }

        // Create a unified result structure similar to FIT file processing
        showLoading('Creating data structure...');

        // Calculate distance from GPS coordinates (used in initializeSection3Csv)
        const _distance = calculateDistanceArray(csvData.positionLat, csvData.positionLong);
        void _distance; // Reserved for future use

        // Create wind speed array from air speed (wind magnitude is already air speed)
        // Wind speed in this context is the environmental wind, which we'll calculate later
        const _windSpeed = new Array(csvData.timestamps.length).fill(0);
        void _windSpeed; // Reserved for future use

        // Create a mock result structure that mirrors FIT file result
        const result = {
            fit_data: null, // No FIT data for CSV files
            parsing_statistics: {
                has_power_data: csvData.power.some(p => !isNaN(p) && p > 0),
                has_gps_data: csvData.positionLat.some(lat => !isNaN(lat)),
                has_altitude_data: csvData.altitude.some(alt => !isNaN(alt)),
                has_air_speed_data: csvData.airSpeed.some(as => !isNaN(as) && as > 0),
                data_points: csvData.timestamps.length,
            },
            laps: csvData.hasLapData ? generateLapsFromCsv(csvData) : [],
        };

        currentFitResult = result;
        currentLaps = result.laps;

        hideLoading();
        await displayCsvResults(csvData, result);

        // Activate section 2 (parameters) and section 3 (map/laps)
        // CSV files work just like FIT files - both sections are active after loading
        activateSection(2);

        // Initialize and activate section 3 if we have laps
        if (result.laps.length > 0) {
            console.log('📍 Activating section 3 for CSV lap analysis...');
            activateSection(3);
            setTimeout(() => {
                initializeSection3Csv(csvData, result);
                console.log('✅ Section 3 initialized for CSV');
            }, 100);
        }

    } catch (err) {
        hideLoading();
        console.error('Error processing CSV file:', err);
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

        ${elevationCorrectionEnabled && selectedDEMFile ? `
        <div style="margin-top: 1.5rem; padding: 1rem; background: #e8f5e9; border-left: 4px solid #4caf50; border-radius: 4px;">
            <h4 style="margin: 0 0 0.5rem 0; color: #2d7a52;">📊 Elevation Correction Applied</h4>
            <p style="margin: 0 0 0.5rem 0; color: #2d7a52;"><strong>DEM file:</strong> ${selectedDEMFile.name}</p>
            <p style="margin: 0 0 0.5rem 0; color: #2d7a52;">
                <strong>Successfully corrected:</strong> ${(100 - elevationErrorRate * 100).toFixed(1)}%
            </p>
            ${elevationErrorRate > 0.01 ? `
            <p style="margin: 0; color: #f57c00; font-weight: 500;">
                ⚠️ ${(elevationErrorRate * 100).toFixed(1)}% of points used GPS fallback (DEM lookup failed)
            </p>
            ` : ''}
        </div>
        ` : ''}
    `;

    results.classList.remove('hidden');

    // Store data for section 3
    currentFitResult = result;
    currentFitData = result.fit_data;
    currentLaps = laps;

    // Initialize analysis parameters component immediately
    isLoadingParameters = true; // Prevent saving during initialization
    initializeAnalysisParameters();

    // Try to load saved parameters for this file
    if (currentFileHash && parametersComponent) {
        const savedParameters = await parameterStorage.loadParameters(currentFileHash);
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
                console.log('📍 GPS data detected - auto-rho enabled by default');
            }

            parametersComponent.setParameters(smartDefaults);
            console.log(`📊 Set air_speed_offset default to ${defaultAirSpeedOffset}s (hasAirSpeed: ${hasAirSpeed})`);
        }
    }

    isLoadingParameters = false; // Re-enable saving after load complete

    // Update previousAutoLapDetection to match loaded parameters
    previousAutoLapDetection = currentParameters?.auto_lap_detection || 'None';
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
    if (isCalculatingAutoRho) {
        console.log('⏭️  Auto-rho calculation already in progress, skipping\n');
        return null;
    }

    isCalculatingAutoRho = true;

    console.log('\n╔═══════════════════════════════════════════════════════════════╗');
    console.log('║  🌦️  AUTO RHO CALCULATION STARTED                            ║');
    console.log('╚═══════════════════════════════════════════════════════════════╝\n');

    if (!currentFitData || !parametersComponent) {
        console.warn('❌ Cannot calculate auto rho: missing FIT data or parameters component');
        console.log('  - currentFitData:', !!currentFitData);
        console.log('  - parametersComponent:', !!parametersComponent);
        isCalculatingAutoRho = false;
        return null;
    }

    const params = parametersComponent.getParameters();

    // Check if auto-calculate is enabled
    if (!params.auto_calculate_rho) {
        console.log('⏭️  Auto-calculate disabled, skipping\n');
        isCalculatingAutoRho = false;
        return null;
    }

    console.log('✅ Auto-calculate enabled, proceeding...\n');

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
            console.log('🔍 Map trim sliders not found, using section 3 sliders...');
        } else {
            console.log('🔍 Using map trim sliders (relative to filtered lap data)...');
        }

        console.log('  - trimStartSlider exists:', !!trimStartSlider);
        console.log('  - trimEndSlider exists:', !!trimEndSlider);

        if (!trimStartSlider || !trimEndSlider) {
            console.warn('❌ No trim sliders found - cannot calculate auto rho');
            console.log('  This usually means the UI is not ready yet.');
            console.log('  Will retry when sliders are available.\n');
            isCalculatingAutoRho = false;
            return null;
        }

        const trimStart = parseInt(trimStartSlider.value);
        const trimEnd = parseInt(trimEndSlider.value);

        console.log('📊 Trim region values:', {
            start: trimStart,
            end: trimEnd,
            dataPointsInRange: trimEnd - trimStart + 1
        });
        console.log('');

        // Show loading state
        showLoading('Fetching weather data...');

        try {
            // Calculate GPS metadata from trim region
            // Use filtered lap data (only selected laps), not the full FIT data
            if (!filteredLapData) {
                console.warn('❌ No filtered lap data available - cannot calculate auto rho');
                console.log('  This usually means laps have not been selected yet.\n');
                hideLoading();
                isCalculatingAutoRho = false;
                return null;
            }

            console.log('🗺️  Calculating GPS metadata from trim region...');
            console.log('  Using filtered lap data with', filteredLapData.timestamps.length, 'data points');

            const metadata = calculateTrimRegionMetadata(
                filteredLapData,
                trimStart,
                trimEnd
            );

            console.log('═══════════════════════════════════════════════════════');
            console.log('📍 TRIM REGION METADATA');
            console.log('═══════════════════════════════════════════════════════');
            console.log('  Location:', formatCoordinates(metadata.avgLat, metadata.avgLon));
            console.log('  Coordinates:', `${metadata.avgLat}, ${metadata.avgLon}`);
            console.log('  Date/Time:', metadata.middleDate.toISOString());
            console.log('  Valid GPS Points:', metadata.dataPointCount);
            console.log('  Trim Range:', `${trimStart} to ${trimEnd}`);
            console.log('═══════════════════════════════════════════════════════\n');

            // Generate query key (rounded to hour precision to match API granularity)
            const queryKey = `${metadata.avgLat.toFixed(6)}_${metadata.avgLon.toFixed(6)}_${metadata.middleDate.toISOString().substring(0, 13)}`;

            // Check if query has actually changed
            if (lastWeatherQueryKey === queryKey) {
                console.log('⏭️  Query unchanged from last calculation, using cached rho');
                console.log('  Query key:', queryKey);
                hideLoading();
                isCalculatingAutoRho = false;
                return params.rho; // Return current rho value
            }

            console.log('🔄 Query changed, fetching new weather data');
            console.log('  Previous:', lastWeatherQueryKey || 'none');
            console.log('  Current:', queryKey);
            console.log('');

            // Update last query key
            lastWeatherQueryKey = queryKey;

            // Initialize weather services
            const weatherCache = new WeatherCache();
            const weatherAPI = new WeatherAPI();

            // Get weather data (from cache or API)
            console.log('🔄 Fetching weather data (checking cache first)...\n');
            let weatherEntry: WeatherCacheEntry = await weatherCache.getWeatherData(metadata, weatherAPI);

            // Check if cached entry has wind data - if not, re-fetch from API
            if (weatherEntry.source === 'cache' &&
                (weatherEntry.data.windSpeed === undefined || weatherEntry.data.windDirection === undefined)) {
                console.log('⚠️  Cached entry missing wind data, re-fetching from API...');
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
            console.log('═══════════════════════════════════════════════════════');
            console.log('🧮 CALCULATING AIR DENSITY');
            console.log('═══════════════════════════════════════════════════════');
            console.log('  Input:');
            console.log('    - Temperature:', weatherEntry.data.temperature, '°C');
            console.log('    - Pressure:', weatherEntry.data.pressure, 'hPa');
            console.log('    - Dew Point:', weatherEntry.data.dewPoint, '°C');

            const rhoRaw = AirDensityCalculator.calculate_air_density(
                weatherEntry.data.temperature,
                weatherEntry.data.pressure,
                weatherEntry.data.dewPoint
            );

            // Round to 4 decimal places for practical use
            const rho = parseFloat(rhoRaw.toFixed(4));

            console.log('  Output:');
            console.log('    - Air Density (ρ):', rho, 'kg/m³');
            console.log('    - Wind Speed:', weatherEntry.data.windSpeed, 'm/s');
            console.log('    - Wind Direction:', weatherEntry.data.windDirection, '°');
            console.log('    - Source:', weatherEntry.source === 'cache' ? '💾 Cache' : '⬇️ API');
            console.log('═══════════════════════════════════════════════════════\n');

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

            console.log('╔═══════════════════════════════════════════════════════════════╗');
            console.log('║  ✅ AUTO RHO CALCULATION COMPLETED SUCCESSFULLY              ║');
            console.log('║  Final ρ: ' + rho.toFixed(3) + ' kg/m³                                     ║');
            console.log('╚═══════════════════════════════════════════════════════════════╝\n');

            hideLoading();
            isCalculatingAutoRho = false;
            return rho;

        } catch (error) {
            hideLoading();

            if (error instanceof WeatherAPIError) {
                console.error('Weather API error:', error.message, error.code);

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
                console.error('Failed to calculate auto rho:', error);
                const errorMsg = error instanceof Error ? error.message : 'Unknown error';
                showNotification(`Auto-rho calculation failed: ${errorMsg}`, 'error');
            }

            isCalculatingAutoRho = false;
            return null;
        }

    } catch (error) {
        hideLoading();
        console.error('Unexpected error in calculateAutoRho:', error);
        showNotification('Failed to calculate air density. Using manual value.', 'error');
        isCalculatingAutoRho = false;
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
    console.error('Failed to initialize application:', err);
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
    if (!mapVisualization || !currentFitData) return;

    const sliderControls = document.getElementById('gpsGateSliderControls');
    const gateSlider = document.getElementById('gpsGateSlider') as HTMLInputElement;
    const gateValue = document.getElementById('gpsGateValue') as HTMLInputElement;
    const gatePositionInfo = document.getElementById('gpsGatePositionInfo');

    if (!sliderControls || !gateSlider || !gateValue) {
        console.warn('GPS lap detection slider controls not found in DOM');
        return;
    }

    // Calculate the duration of selected data
    const timeRange = getSelectedDataTimeRange();
    const { duration } = timeRange;

    // Set slider max to duration in seconds
    const maxSeconds = Math.floor(duration);
    if (maxSeconds <= 0) {
        console.warn('Invalid duration for GPS lap detection:', maxSeconds);
        return;
    }

    gateSlider.max = String(maxSeconds);
    gateValue.max = String(maxSeconds);

    // Show slider controls
    sliderControls.style.display = 'block';

    // Load saved gate position or use default
    let initialOffset = 5; // Default 5 seconds
    if (currentFileHash) {
        try {
            const savedMarker = await parameterStorage.loadGpsMarkerSettings(currentFileHash, selectedLaps);
            if (savedMarker && savedMarker.gateTimeOffset !== undefined) {
                initialOffset = savedMarker.gateTimeOffset;
                console.log('Loading saved GPS gate time offset:', initialOffset);
            }
        } catch (err) {
            console.error('Failed to load saved GPS marker settings:', err);
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

        const lat = currentFitData!.position_lat[gateIndex];
        const lon = currentFitData!.position_long[gateIndex];

        if (lat && lon && lat !== 0 && lon !== 0) {
            // Update position info display
            if (gatePositionInfo) {
                gatePositionInfo.textContent = `Position: ${lat.toFixed(5)}, ${lon.toFixed(5)}`;
            }

            // Show marker on map
            mapVisualization?.setGpsMarker(lat, lon);

            // Save settings
            if (currentFileHash) {
                try {
                    await parameterStorage.saveGpsMarkerSettings(currentFileHash, selectedLaps, {
                        gateTimeOffset: timeOffset
                    });
                } catch (err) {
                    console.error('Failed to save GPS marker settings:', err);
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
        console.log('GPS lap detection slider handlers initialized');
    }

    // Initial detection with loaded/default offset
    updateGatePosition(initialOffset);
}

/**
 * Get the time range of currently selected data (from selected FIT laps)
 */
function getSelectedDataTimeRange(): { startTime: number; endTime: number; duration: number } {
    if (!currentFitData) {
        return { startTime: 0, endTime: 0, duration: 0 };
    }

    const timestamps = Array.from(currentFitData.timestamps) as number[];

    if (selectedLaps.length === 0 || currentLaps.length === 0) {
        // No laps selected, use full data range
        const startTime = timestamps[0] || 0;
        const endTime = timestamps[timestamps.length - 1] || 0;
        return { startTime, endTime, duration: endTime - startTime };
    }

    // Get time range from selected FIT laps
    const selectedLapData = selectedLaps.map(lapNumber => currentLaps[lapNumber - 1]).filter(Boolean);
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
    if (!currentFitData) return null;

    const timestamps = Array.from(currentFitData.timestamps) as number[];
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
    if (!currentFitData) return;

    // Calculate trim indices from selected FIT laps' time ranges
    let trimStart = 0;
    let trimEnd = currentFitData.timestamps.length - 1;

    if (selectedLaps.length > 0 && currentLaps.length > 0) {
        // Get time ranges for selected FIT laps
        const selectedLapData = selectedLaps.map(lapNumber => currentLaps[lapNumber - 1]);
        const allTimestamps = Array.from(currentFitData.timestamps) as number[];

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
            console.log(`GPS lap detection trim region: ${trimStart} to ${trimEnd} (${indicesInSelectedLaps.length} points from ${selectedLaps.length} FIT laps)`);
        }
    }

    // Get detection mode, defaulting to GPS based lap splitting (not None since we're running detection)
    const detectionMode = currentParameters?.auto_lap_detection;
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
        Array.from(currentFitData.position_lat),
        Array.from(currentFitData.position_long),
        Array.from(currentFitData.timestamps),
        Array.from(currentFitData.distance),
        config
    );

    gpsLapDetectionResult = detector.detectLaps();
    gpsDetectedLaps = gpsLapDetectionResult.detectedLaps;

    console.log(`Detected ${gpsDetectedLaps.length} laps:`, gpsDetectedLaps);

    // Show detected laps on map
    if (mapVisualization && gpsLapDetectionResult) {
        mapVisualization.showDetectedLaps(
            gpsLapDetectionResult.detectedLaps,
            gpsLapDetectionResult.passings
        );
    }

    // Update UI
    updateGpsDetectedLapsUI();

    // Auto-select all laps initially
    gpsSelectedLaps = gpsDetectedLaps.map(lap => lap.lapNumber);
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

    if (gpsDetectedLaps.length === 0) {
        lapsInfo.style.display = 'none';
        return;
    }

    lapsInfo.style.display = 'block';
    lapCountSpan.textContent = gpsDetectedLaps.length.toString();

    // Populate lap list
    lapList.innerHTML = gpsDetectedLaps.map(lap => `
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
    gpsSelectedLaps = Array.from(checkboxes).map(cb => {
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

    console.log('GPS selected laps:', gpsSelectedLaps);
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
    if (!mapVisualization || !currentFitData) return;

    const sliderControls = document.getElementById('oabGateSliderControls');
    const gateASlider = document.getElementById('oabGateASlider') as HTMLInputElement;
    const gateAValue = document.getElementById('oabGateAValue') as HTMLInputElement;
    const gateAInfo = document.getElementById('oabGateAInfo');
    const gateBSlider = document.getElementById('oabGateBSlider') as HTMLInputElement;
    const gateBValue = document.getElementById('oabGateBValue') as HTMLInputElement;
    const gateBInfo = document.getElementById('oabGateBInfo');

    if (!sliderControls || !gateASlider || !gateAValue || !gateBSlider || !gateBValue) {
        console.warn('Out and Back slider controls not found in DOM');
        return;
    }

    // Calculate the duration of selected data
    const timeRange = getSelectedDataTimeRange();
    const { duration } = timeRange;

    // Set slider max to duration in seconds
    const maxSeconds = Math.floor(duration);
    if (maxSeconds <= 0) {
        console.warn('Invalid duration for Out and Back detection:', maxSeconds);
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
    if (currentFileHash) {
        try {
            const savedMarkers = await parameterStorage.loadOutAndBackMarkerSettings(currentFileHash, selectedLaps);
            if (savedMarkers && savedMarkers.gateATimeOffset !== undefined && savedMarkers.gateBTimeOffset !== undefined) {
                initialOffsetA = savedMarkers.gateATimeOffset;
                initialOffsetB = savedMarkers.gateBTimeOffset;
                console.log('Loading saved Out and Back gate time offsets:', { A: initialOffsetA, B: initialOffsetB });
            }
        } catch (err) {
            console.error('Failed to load saved Out and Back marker settings:', err);
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

        const lat = currentFitData!.position_lat[gateIndex];
        const lon = currentFitData!.position_long[gateIndex];

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
        if (currentFileHash) {
            try {
                await parameterStorage.saveOutAndBackMarkerSettings(currentFileHash, selectedLaps, {
                    gateATimeOffset: offsetA,
                    gateBTimeOffset: offsetB
                });
            } catch (err) {
                console.error('Failed to save Out and Back marker settings:', err);
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
        console.log('Out and Back slider handlers initialized');
    }

    // Initial detection with loaded/default offsets
    updateGates();
}

/**
 * Run Out and Back detection algorithm
 */
function runOutAndBackDetection(markerALat: number, markerALon: number, markerBLat: number, markerBLon: number) {
    if (!currentFitData) return;

    // Calculate trim indices from selected FIT laps' time ranges
    let trimStart = 0;
    let trimEnd = currentFitData.timestamps.length - 1;

    if (selectedLaps.length > 0 && currentLaps.length > 0) {
        const selectedLapData = selectedLaps.map(lapNumber => currentLaps[lapNumber - 1]);
        const allTimestamps = Array.from(currentFitData.timestamps) as number[];

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
            console.log(`Out and Back trim region: ${trimStart} to ${trimEnd}`);
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
        Array.from(currentFitData.position_lat),
        Array.from(currentFitData.position_long),
        Array.from(currentFitData.timestamps),
        Array.from(currentFitData.distance),
        config
    );

    outAndBackResult = detector.detectSections();
    outAndBackSections = outAndBackResult.detectedSections;

    console.log(`Detected ${outAndBackSections.length} out-and-back sections:`, outAndBackSections);

    // Show detected sections on map
    if (mapVisualization && outAndBackResult) {
        mapVisualization.showOutAndBackSections(
            outAndBackResult.detectedSections,
            outAndBackResult.passingsA,
            outAndBackResult.passingsB
        );
    }

    // Update UI
    updateOutAndBackSectionsUI();

    // Auto-select all sections initially
    outAndBackSelectedSections = outAndBackSections.map(s => s.sectionNumber);
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

    if (outAndBackSections.length === 0) {
        sectionsInfo.style.display = 'none';
        return;
    }

    sectionsInfo.style.display = 'block';
    sectionCountSpan.textContent = outAndBackSections.length.toString();

    // Populate section list
    sectionList.innerHTML = outAndBackSections.map(section => `
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
    outAndBackSelectedSections = Array.from(checkboxes).map(cb => {
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

    console.log('Out and Back selected sections:', outAndBackSelectedSections);
    updateAnalyzeButton();
}

/**
 * Update Out and Back slider visibility based on FIT lap selection
 */
function updateOutAndBackButtonState() {
    const sliderControls = document.getElementById('oabGateSliderControls');

    const lapDetectionMode = currentParameters?.auto_lap_detection || 'None';

    if (lapDetectionMode !== 'GPS based out and back') {
        if (sliderControls) sliderControls.style.display = 'none';
        return;
    }

    if (selectedLaps.length > 0) {
        // FIT laps are selected - setup and show slider controls
        setupOutAndBackDetection();
    } else {
        // No FIT laps selected - hide slider controls
        if (sliderControls) sliderControls.style.display = 'none';

        // Clear any existing detection when FIT laps are deselected
        if (outAndBackSections.length > 0) {
            outAndBackSections = [];
            outAndBackSelectedSections = [];
            outAndBackResult = null;
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

    const lapDetectionMode = currentParameters?.auto_lap_detection || 'None';
    const isGpsLapMode = lapDetectionMode === 'GPS based lap splitting';

    if (!isGpsLapMode) {
        // GPS lap detection is not enabled
        if (sliderControls) sliderControls.style.display = 'none';
        return;
    }

    if (selectedLaps.length > 0) {
        // FIT laps are selected - setup and show slider controls
        setupGpsLapDetection();
    } else {
        // No FIT laps selected - hide slider controls
        if (sliderControls) sliderControls.style.display = 'none';

        // Clear any existing GPS lap detection when FIT laps are deselected
        if (gpsDetectedLaps.length > 0) {
            gpsDetectedLaps = [];
            gpsSelectedLaps = [];
            gpsLapDetectionResult = null;
            mapVisualization?.clearDetectedLaps();
            mapVisualization?.clearGpsMarker();
            updateGpsDetectedLapsUI();
        }
    }
}

function updateSelectedLaps() {
    const checkboxes = document.querySelectorAll('.lap-checkbox:checked') as NodeListOf<HTMLInputElement>;
    selectedLaps = Array.from(checkboxes).map(cb => {
        const item = cb.closest('.lap-checkbox-item');
        return item ? parseInt(item.getAttribute('data-lap') || '0') : 0;
    }).filter(lap => lap > 0);

    // Update map visualization
    if (mapVisualization) {
        mapVisualization.setSelectedLaps(selectedLaps);
    }

    // Update GPS marker button state based on FIT lap selection
    updateGpsMarkerButtonState();

    // Update Out and Back button state based on FIT lap selection
    updateOutAndBackButtonState();

    // Show/hide trim controls based on lap selection
    const mapTrimControls = document.getElementById('mapTrimControls');
    if (mapTrimControls) {
        if (selectedLaps.length > 0) {
            mapTrimControls.style.display = 'flex';
            // Calculate total duration of selected laps
            initializeMapTrimControlsForSelectedLaps();

            // Trigger auto-rho calculation when laps are selected (trim sliders now available)
            if (currentParameters?.auto_calculate_rho && !isCalculatingAutoRho) {
                setTimeout(() => {
                    calculateAutoRho().catch(err => {
                        console.error('Auto-rho calculation error on lap selection:', err);
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

    if (!currentFitResult || !currentLaps || selectedLaps.length === 0) {
        return;
    }

    // Get selected lap data
    const selectedLapData = selectedLaps.map(lapNumber => currentLaps[lapNumber - 1]);

    // Get data from unified structure (works for both FIT and CSV)
    const fitData = currentFitData || currentFitResult.fit_data;
    if (!fitData) {
        console.error('No fit data available for map trim controls');
        return;
    }

    const allTimestamps = fitData.timestamps;
    const allPositionLat = fitData.position_lat;
    const allPositionLong = fitData.position_long;

    const hasGpsData = currentFitResult.parsing_statistics?.has_gps_data ?? false;

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
    filteredLapData = {
        position_lat: filteredLapPositionLat,
        position_long: filteredLapPositionLong,
        timestamps: filteredLapTimestamps
    };

    // Initialize the controls with correct data length
    initializeMapTrimControls(dataLength);

    // Try to load saved lap settings for this file and lap combination
    let savedSettings: LapSettings | null = null;
    if (currentFileHash) {
        try {
            savedSettings = await parameterStorage.loadLapSettings(currentFileHash, selectedLaps);
            if (savedSettings) {
                // Use saved trim values
                presetTrimStart = savedSettings.trimStart;
                presetTrimEnd = savedSettings.trimEnd;
            } else {
                // Set preset values to defaults
                presetTrimStart = 0;
                presetTrimEnd = dataLength - 1;
            }
        } catch (err) {
            console.error('Failed to load lap settings:', err);
            // Fallback to defaults
            presetTrimStart = 0;
            presetTrimEnd = dataLength - 1;
        }
    } else {
        // No file hash, use defaults
        presetTrimStart = 0;
        presetTrimEnd = dataLength - 1;
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
        newMapTrimStartSlider.value = presetTrimStart.toString();
        newMapTrimStartValue.value = presetTrimStart.toString();
        newMapTrimEndSlider.value = presetTrimEnd.toString();
        newMapTrimEndValue.value = presetTrimEnd.toString();

        // Set map markers with loaded/default trim values
        if (mapVisualization && savedSettings && presetTrimStart !== null && presetTrimEnd !== null) {
            console.log('Setting map trim markers to loaded settings:', { trimStart: presetTrimStart, trimEnd: presetTrimEnd });
            const trimStartVal = presetTrimStart;
            const trimEndVal = presetTrimEnd;
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
            presetTrimStart = value;

            // Update map markers immediately (before analyze) - use filtered lap GPS data
            if (mapVisualization) {
                const trimEnd = presetTrimEnd ?? dataLength - 1;
                mapVisualization.fitBoundsToTrimRegion(value, trimEnd, filteredLapPositionLat, filteredLapPositionLong);
            }

            // Save map trim settings
            saveMapTrimSettings();
        });

        newMapTrimEndSlider.addEventListener('input', () => {
            const value = parseInt(newMapTrimEndSlider.value);
            newMapTrimEndValue.value = value.toString();
            presetTrimEnd = value;

            // Update map markers immediately (before analyze) - use filtered lap GPS data
            if (mapVisualization) {
                mapVisualization.fitBoundsToTrimRegion(presetTrimStart, value, filteredLapPositionLat, filteredLapPositionLong);
            }

            // Save map trim settings
            saveMapTrimSettings();
        });

        newMapTrimStartValue.addEventListener('change', () => {
            const value = parseInt(newMapTrimStartValue.value);
            if (!isNaN(value)) {
                const trimEnd = presetTrimEnd ?? dataLength - 1;
                const clamped = Math.max(0, Math.min(value, trimEnd - 30));
                newMapTrimStartSlider.value = clamped.toString();
                newMapTrimStartValue.value = clamped.toString();
                presetTrimStart = clamped;

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
                const clamped = Math.max(presetTrimStart + 30, Math.min(value, dataLength - 1));
                newMapTrimEndSlider.value = clamped.toString();
                newMapTrimEndValue.value = clamped.toString();
                presetTrimEnd = clamped;

                // Update map markers immediately (before analyze) - use filtered lap GPS data
                if (mapVisualization) {
                    mapVisualization.fitBoundsToTrimRegion(presetTrimStart, clamped, filteredLapPositionLat, filteredLapPositionLong);
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
                if (currentParameters?.auto_calculate_rho && !isCalculatingAutoRho) {
                    calculateAutoRho().catch(err => {
                        console.error('Auto-rho calculation error on map trim change:', err);
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

        // Initialize currentParameters with the default values from the component
        currentParameters = parametersComponent.getParameters();

        // Update analyze button with the default parameters
        updateAnalyzeButton();
    } catch (error) {
        console.error('Error initializing analysis parameters:', error);
    }
}

function handleParametersChange(parameters: AnalysisParameters) {
    const previousLapDetectionMode = previousAutoLapDetection;
    currentParameters = parameters;

    // Check if auto_lap_detection changed and Section 3 needs to be re-rendered
    const lapDetectionChanged = parameters.auto_lap_detection !== previousLapDetectionMode;
    previousAutoLapDetection = parameters.auto_lap_detection;

    // Don't save if we're currently loading parameters from storage
    if (isLoadingParameters) {
        // Still need to update previous value when loading
        return;
    }

    // If lap detection mode changed, re-initialize Section 3 to show/hide GPS panel
    if (lapDetectionChanged && currentFitData && currentLaps.length > 0) {
        console.log(`Auto lap detection changed: ${previousLapDetectionMode} -> ${parameters.auto_lap_detection}`);
        // Reset GPS lap detection state when mode changes
        gpsLapDetectionResult = null;
        gpsDetectedLaps = [];
        gpsSelectedLaps = [];
        // Re-initialize Section 3 to show/hide GPS lap detection panel
        initializeSection3();
        // Continue to save parameters below (don't return early)
    }

    // Save parameters to IndexedDB for this file
    if (!currentFileHash) {
        console.error('❌ Cannot save: currentFileHash is null/undefined');
        return;
    }

    if (!selectedFile) {
        console.error('❌ Cannot save: selectedFile is null/undefined');
        return;
    }

    parameterStorage.saveParameters(currentFileHash, parameters, selectedFile.name)
        .then(() => {
        })
        .catch(err => {
            console.error('❌ Failed to save parameters:', err);
        });

    // Update wind indicator on map if wind parameters are set
    if (mapVisualization && currentParameters) {
        if (currentParameters.wind_speed !== null && currentParameters.wind_speed !== undefined &&
            currentParameters.wind_direction !== null && currentParameters.wind_direction !== undefined) {
            mapVisualization.showWindIndicator(
                currentParameters.wind_speed,
                currentParameters.wind_direction,
                currentParameters.wind_speed_unit
            );
        } else {
            mapVisualization.hideWindIndicator();
        }
    }

    // Trigger auto-rho calculation if checkbox was just enabled
    // or if auto-calculate is already enabled (parameters changed)
    // BUT skip if we're already calculating (prevents infinite loop)
    if (parameters.auto_calculate_rho && currentFitData && !isCalculatingAutoRho) {
        // Small delay to ensure UI is updated
        setTimeout(() => {
            calculateAutoRho().catch(err => {
                console.error('Auto-rho calculation error:', err);
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
    if (!analysisSection || !currentFitData || !currentLaps.length) return;

    // Reset handler initialization flags since HTML is being recreated
    gpsLapHandlersInitialized = false;
    outAndBackHandlersInitialized = false;

    const hasGpsData = currentFitResult?.parsing_statistics?.has_gps_data ?? false;
    const lapDetectionMode = currentParameters?.auto_lap_detection || 'None';
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
                        ${currentLaps.map((lap: any, index: number) => `
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
                mapVisualization.setData(currentFitData, currentLaps);
                console.log('Map initialized with GPS data');

                // Setup GPS lap detection if enabled
                if (showGpsLapDetection) {
                    setupGpsLapDetection();
                }

                // Setup Out and Back detection if enabled
                if (showOutAndBack) {
                    setupOutAndBackDetection();
                }
            } else {
                console.log('No GPS data - skipping map initialization');
            }

            // Always setup lap selection handlers (FIT laps always shown)
            setupLapSelectionHandlers();
            setupAnalyzeButton();

            console.log('Section 3 initialized (GPS:', hasGpsData, ', GPS Lap Detection:', showGpsLapDetection, ', Out and Back:', showOutAndBack, ')');
        } catch (error) {
            console.error('Error initializing section 3:', error);
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
        const lapDetectionMode = currentParameters?.auto_lap_detection || 'None';
        const isGpsLapMode = lapDetectionMode === 'GPS based lap splitting';
        const isOutAndBackMode = lapDetectionMode === 'GPS based out and back';

        // Check which lap/section selection to use
        let hasSelectedLaps: boolean;
        let lapCount: number;
        let hasDetectedItems: boolean;

        if (isOutAndBackMode) {
            hasSelectedLaps = outAndBackSelectedSections.length > 0;
            lapCount = outAndBackSelectedSections.length;
            hasDetectedItems = outAndBackSections.length > 0;
        } else if (isGpsLapMode) {
            hasSelectedLaps = gpsSelectedLaps.length > 0;
            lapCount = gpsSelectedLaps.length;
            hasDetectedItems = gpsDetectedLaps.length > 0;
        } else {
            hasSelectedLaps = selectedLaps.length > 0;
            lapCount = selectedLaps.length;
            hasDetectedItems = true;
        }

        const hasValidParameters = parametersComponent ? parametersComponent.isValid() : false;

        analyzeBtn.disabled = !hasSelectedLaps || !hasValidParameters || !hasDetectedItems;

        if (isOutAndBackMode && outAndBackSections.length === 0) {
            analyzeBtn.textContent = 'Set GPS Gates to Detect Sections';
        } else if (isGpsLapMode && gpsDetectedLaps.length === 0) {
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
    const lapDetectionMode = currentParameters?.auto_lap_detection || 'None';
    const isGpsLapMode = lapDetectionMode === 'GPS based lap splitting';
    const isOutAndBackMode = lapDetectionMode === 'GPS based out and back';

    // Check which lap/section selection to use
    let effectiveSelectedItems: number[];
    if (isOutAndBackMode) {
        effectiveSelectedItems = outAndBackSelectedSections;
    } else if (isGpsLapMode) {
        effectiveSelectedItems = gpsSelectedLaps;
    } else {
        effectiveSelectedItems = selectedLaps;
    }

    if (!currentParameters || effectiveSelectedItems.length === 0) {
        alert(isOutAndBackMode ? 'Please select sections and set parameters first.' : 'Please select laps and set parameters first.');
        return;
    }

    if (!currentFitData) {
        alert('No FIT data available for analysis.');
        return;
    }

    // For GPS lap mode, validate we have detected laps
    if (isGpsLapMode && gpsDetectedLaps.length === 0) {
        alert('Please set a GPS gate to detect laps first.');
        return;
    }

    // For Out and Back mode, validate we have detected sections
    if (isOutAndBackMode && outAndBackSections.length === 0) {
        alert('Please set both GPS gates to detect sections first.');
        return;
    }

    // Note: Auto-rho will be triggered AFTER VE analysis when trim sliders are created
    // (trim sliders don't exist yet at this point)

    try {
        showLoading('Preparing data for Virtual Elevation analysis...');

        // Determine data ranges based on mode
        let selectedLapData: any[];
        let selectedLapIndexRanges: Array<{ startIdx: number; endIdx: number }> | null = null;
        let selectedOutAndBackSections: OutAndBackSection[] | null = null;

        if (isOutAndBackMode) {
            // Out and Back mode: use detected section index ranges
            selectedOutAndBackSections = outAndBackSections.filter(section =>
                outAndBackSelectedSections.includes(section.sectionNumber)
            );
            // For VE analysis, we'll process outbound and inbound separately
            // Create ranges for combined outbound+inbound data
            selectedLapIndexRanges = [];
            selectedOutAndBackSections.forEach(section => {
                selectedLapIndexRanges!.push({
                    startIdx: section.outboundStartIdx,
                    endIdx: section.outboundEndIdx
                });
                selectedLapIndexRanges!.push({
                    startIdx: section.inboundStartIdx,
                    endIdx: section.inboundEndIdx
                });
            });
            selectedLapData = selectedOutAndBackSections;
            console.log('Out and Back mode - selected sections:', selectedOutAndBackSections);
        } else if (isGpsLapMode) {
            // GPS lap mode: use detected lap index ranges
            const selectedGpsLaps = gpsDetectedLaps.filter(lap =>
                gpsSelectedLaps.includes(lap.lapNumber)
            );
            selectedLapIndexRanges = selectedGpsLaps.map(lap => ({
                startIdx: lap.startIdx,
                endIdx: lap.endIdx
            }));
            // Create synthetic lap data for logging
            selectedLapData = selectedGpsLaps;
            console.log('GPS lap mode - selected lap index ranges:', selectedLapIndexRanges);
        } else {
            // Normal mode: use FIT lap time ranges
            selectedLapData = effectiveSelectedItems.map(lapNumber => currentLaps[lapNumber - 1]);
            console.log('Normal mode - selected lap data:', selectedLapData);
        }

        // Debug: Check the full result structure
        console.log('currentFitResult structure:', currentFitResult);
        console.log('currentFitResult keys:', currentFitResult ? Object.keys(currentFitResult) : 'null');

        // Get unified data structure (works for both FIT and CSV)
        if (!currentFitResult) {
            throw new Error('No data available for analysis');
        }

        // Use currentFitData which is either:
        // - WASM FitData object (from FIT file)
        // - JavaScript object with same structure (from CSV file)
        const fitData = currentFitData || currentFitResult.fit_data;
        if (!fitData) {
            throw new Error('No analysis data available');
        }

        // Access data directly as properties (Float64Arrays), not as functions
        const allTimestamps = fitData.timestamps;
        const allPower = fitData.power;
        const allVelocity = fitData.velocity;
        const allPositionLat = fitData.position_lat;
        const allPositionLong = fitData.position_long;
        const allAltitude = fitData.altitude;
        const allDistance = fitData.distance;
        // Process wind data: consolidate air_speed and wind_speed into single apparent velocity field
        const hasAirSpeed = fitData.air_speed && (Array.from(fitData.air_speed) as number[]).some((v: number) => !isNaN(v) && v !== 0);
        const hasWindSpeed = fitData.wind_speed && (Array.from(fitData.wind_speed) as number[]).some((v: number) => !isNaN(v) && v !== 0);
        const hasWindYaw = fitData.wind_yaw && (Array.from(fitData.wind_yaw) as number[]).some((yaw: number) => !isNaN(yaw) && yaw !== 0);

        let allWindSpeed: any;
        let defaultAirSpeedOffset: number;

        // Simplify: Always triangulate using yaw (forcing yaw=0 if not present gives same result as no triangulation)
        if (hasAirSpeed) {
            console.log('🌬️ Found air speed data, using it as apparent wind speed');
            const rawYaw = fitData.wind_yaw || new Array(fitData.air_speed.length).fill(0);
            allWindSpeed = (Array.from(fitData.air_speed) as number[]).map((magnitude: number, i: number) => {
                const yaw = rawYaw[i] || 0;
                return Math.cos(yaw * Math.PI / 180) * magnitude;
            });
            defaultAirSpeedOffset = 2; // air_speed columns default to 2s offset
        } else if (hasWindSpeed) {
            if (hasWindYaw) {
                console.log('🌬️ Found wind speed with yaw, triangulating for apparent wind speed');
            } else {
                console.log('🌬️ Found wind speed without yaw, using it as apparent wind speed');
            }
            const rawYaw = fitData.wind_yaw || new Array(fitData.wind_speed.length).fill(0);
            allWindSpeed = (Array.from(fitData.wind_speed) as number[]).map((magnitude: number, i: number) => {
                const yaw = rawYaw[i] || 0;
                return Math.cos(yaw * Math.PI / 180) * magnitude;
            });
            defaultAirSpeedOffset = 0; // wind_speed columns default to 0s offset
        } else {
            console.log('🌬️ No air/wind speed data found, using constant wind as source');
            allWindSpeed = new Array(fitData.timestamps.length).fill(0);
            defaultAirSpeedOffset = 0;
        }

        const allAirDensity = fitData.air_density_data || [];
        const allTemperature = fitData.temperature || [];

        // Check speed source
        const hasRoadSpeed = fitData.road_speed && (Array.from(fitData.road_speed) as number[]).some((v: number) => !isNaN(v) && v !== 0);
        const hasEnhancedSpeed = (Array.from(allVelocity) as number[]).some((v: number) => !isNaN(v) && v !== 0);
        if (hasRoadSpeed && hasEnhancedSpeed) {
            console.log('🚴 Found enhanced speed and road speed, prefer road speed');
        }

        // Filter data points based on mode
        let selectedLapTimeRanges: Array<{ start: number; end: number }> | null = null;
        if (!isGpsLapMode) {
            selectedLapTimeRanges = selectedLapData.map(lap => ({
                start: lap.start_time,
                end: lap.end_time
            }));
        }

        // Filter data points by selected lap ranges (time or index based)
        let filteredTimestamps: number[] = [];
        let filteredPower: number[] = [];
        let filteredVelocity: number[] = [];
        let filteredPositionLat: number[] = [];
        let filteredPositionLong: number[] = [];
        let filteredAltitude: number[] = [];
        let filteredDistance: number[] = [];
        let filteredWindSpeed: number[] = [];
        let filteredAirDensity: number[] = [];
        let filteredTemperature: number[] = [];

        for (let i = 0; i < allTimestamps.length; i++) {
            let isInSelectedLap: boolean;

            if ((isGpsLapMode || isOutAndBackMode) && selectedLapIndexRanges) {
                // GPS lap mode or Out and Back mode: check if index falls within any selected index range
                isInSelectedLap = selectedLapIndexRanges.some(range =>
                    i >= range.startIdx && i <= range.endIdx
                );
            } else if (selectedLapTimeRanges) {
                // Normal mode: check timestamp
                const timestamp = allTimestamps[i];
                isInSelectedLap = selectedLapTimeRanges.some(range =>
                    timestamp >= range.start && timestamp <= range.end
                );
            } else {
                isInSelectedLap = false;
            }

            if (isInSelectedLap) {
                filteredTimestamps.push(allTimestamps[i]);
                filteredPower.push(allPower[i]);
                filteredVelocity.push(allVelocity[i]);
                filteredPositionLat.push(allPositionLat[i]);
                filteredPositionLong.push(allPositionLong[i]);
                filteredAltitude.push(allAltitude[i]);
                filteredDistance.push(allDistance[i]);
                filteredWindSpeed.push(allWindSpeed[i]);
                filteredAirDensity.push(allAirDensity[i] || 0);
                filteredTemperature.push(allTemperature[i] || 0);
            }
        }

        if (filteredTimestamps.length === 0) {
            throw new Error('No valid data points found in selected laps');
        }

        // Check if we have sufficient power data
        const powerDataPoints = filteredPower.filter(p => p > 0).length;
        if (powerDataPoints < filteredTimestamps.length * 0.5) {
            console.warn(`Only ${powerDataPoints}/${filteredTimestamps.length} records have power data`);
        }

        showLoading('Running Virtual Elevation calculation...');

        // Check for per-datapoint air density (priority: FIT file column > environmental calculation > Weather API)
        currentRhoArray = null; // Reset global rho array

        // PRIORITY 1: Use air_density from FIT file if available
        const hasAirDensityData = filteredAirDensity.length > 0 &&
            filteredAirDensity.some(rho => !isNaN(rho) && rho > 0);

        if (hasAirDensityData) {
            console.log('💨 Found air density data, using it for calculations');
            currentRhoArray = filteredAirDensity;
        }
        // PRIORITY 2: Calculate from environmental data if available
        else {
            const hasEnvironmentalData = fitData.temperature && fitData.humidity && fitData.pressure;
            if (hasEnvironmentalData) {
                const fullRhoArray = calculateRhoArrayFromFitData(fitData);

                if (fullRhoArray) {
                    // Filter rho array to match selected laps (using same logic as main filter)
                    currentRhoArray = [];
                    for (let i = 0; i < allTimestamps.length; i++) {
                        let isInSelectedLap: boolean;
                        if (isGpsLapMode && selectedLapIndexRanges) {
                            isInSelectedLap = selectedLapIndexRanges.some(range =>
                                i >= range.startIdx && i <= range.endIdx
                            );
                        } else if (selectedLapTimeRanges) {
                            const timestamp = allTimestamps[i];
                            isInSelectedLap = selectedLapTimeRanges.some(range =>
                                timestamp >= range.start && timestamp <= range.end
                            );
                        } else {
                            isInSelectedLap = false;
                        }
                        if (isInSelectedLap) {
                            currentRhoArray.push(fullRhoArray[i]);
                        }
                    }
                    console.log('💨 Calculated air density from environmental data');
                }
            } else {
                console.log('💨 No air density found, using constant value from weather API');
            }
        }

        // Create Virtual Elevation calculator with filtered data
        // Use the rho array version if we have per-datapoint rho from CSV
        const calculator = currentRhoArray
            ? create_ve_calculator_with_rho_array(
                new Float64Array(filteredTimestamps),
                new Float64Array(filteredPower),
                new Float64Array(filteredVelocity),
                new Float64Array(filteredPositionLat),
                new Float64Array(filteredPositionLong),
                new Float64Array(filteredAltitude),
                new Float64Array(filteredDistance),
                new Float64Array(filteredWindSpeed),
                new Float64Array(currentRhoArray),
                // Parameters
                currentParameters!.system_mass,
                currentParameters!.rho,
                currentParameters!.eta,
                currentParameters!.cda,
                currentParameters!.crr,
                currentParameters!.cda_min,
                currentParameters!.cda_max,
                currentParameters!.crr_min,
                currentParameters!.crr_max,
                currentParameters!.wind_speed,
                currentParameters!.wind_direction,
                currentParameters!.velodrome
            )
            : create_ve_calculator(
                new Float64Array(filteredTimestamps),
                new Float64Array(filteredPower),
                new Float64Array(filteredVelocity),
                new Float64Array(filteredPositionLat),
                new Float64Array(filteredPositionLong),
                new Float64Array(filteredAltitude),
                new Float64Array(filteredDistance),
                new Float64Array(filteredWindSpeed),
                // Parameters
                currentParameters!.system_mass,
                currentParameters!.rho,
                currentParameters!.eta,
                currentParameters!.cda,
                currentParameters!.crr,
                currentParameters!.cda_min,
                currentParameters!.cda_max,
                currentParameters!.crr_min,
                currentParameters!.crr_max,
                currentParameters!.wind_speed,
                currentParameters!.wind_direction,
                currentParameters!.velodrome
            );

        // Use provided CdA and Crr values, or defaults for optimization
        const cda = currentParameters!.cda ?? 0.3; // Use middle of range if optimizing
        const crr = currentParameters!.crr ?? 0.008; // Use middle of range if optimizing

        // Initial trim values - full dataset
        const trimStart = 0;
        const trimEnd = filteredTimestamps.length - 1;

        const result = calculator.calculate_virtual_elevation(cda, crr, trimStart, trimEnd);

        // If data has CdA reference data, filter it for the selected laps
        // (validation will be calculated dynamically when plots update)
        let filteredCdaReference: number[] | null = null;
        if (fitData.cda_reference) {
            console.log('📊 Data has CdA reference - will enable validation tab');

            // Filter CdA reference to match selected laps (using same logic as main filter)
            const fullCdaReference = fitData.cda_reference;
            filteredCdaReference = [];
            for (let i = 0; i < allTimestamps.length; i++) {
                let isInSelectedLap: boolean;
                if (isGpsLapMode && selectedLapIndexRanges) {
                    isInSelectedLap = selectedLapIndexRanges.some(range =>
                        i >= range.startIdx && i <= range.endIdx
                    );
                } else if (selectedLapTimeRanges) {
                    const timestamp = allTimestamps[i];
                    isInSelectedLap = selectedLapTimeRanges.some(range =>
                        timestamp >= range.start && timestamp <= range.end
                    );
                } else {
                    isInSelectedLap = false;
                }
                if (isInSelectedLap) {
                    filteredCdaReference.push(fullCdaReference[i]);
                }
            }
        }

        hideLoading();

        // Store filtered position data for map trimming
        filteredVEData = {
            positionLat: filteredPositionLat,
            positionLong: filteredPositionLong
        };

        // Store GPS lap mode state globally for use in VE analysis
        isGpsLapModeActive = isGpsLapMode && selectedLapIndexRanges !== null;
        isOutAndBackModeActive = isOutAndBackMode && selectedOutAndBackSections !== null;
        currentGpsLapIndexRanges = selectedLapIndexRanges;

        // Show VE analysis based on mode
        if (isOutAndBackMode && selectedOutAndBackSections) {
            // Out and Back mode: use special visualization with mirrored inbound
            showOutAndBackVEAnalysis(
                selectedOutAndBackSections,
                currentFitData,
                currentParameters,
                defaultAirSpeedOffset
            );
        } else if (isGpsLapMode && selectedLapIndexRanges) {
            // GPS lap mode: use stacked lap visualization
            showGpsLapVEAnalysis(
                selectedLapIndexRanges,
                currentFitData,
                currentParameters,
                defaultAirSpeedOffset
            );
        } else {
            // Normal mode: use standard VE analysis
            showVirtualElevationAnalysisInline(
                result,
                effectiveSelectedItems,
            filteredTimestamps,
            filteredPower,
            filteredVelocity,
            filteredPositionLat,
            filteredPositionLong,
            filteredAltitude,
            filteredDistance,
            filteredWindSpeed,
            filteredTemperature,
            filteredCdaReference,
            defaultAirSpeedOffset
            );
        }

    } catch (err) {
        console.error('Virtual Elevation analysis failed:', err);
        hideLoading();
        const errorMessage = err instanceof Error ? err.message : 'Unknown error';
        showError(`Virtual Elevation analysis failed: ${errorMessage}`);
    }
}

// ==================== GPS Lap VE Analysis ====================

interface LapVEProfile {
    lapNumber: number;
    distances: number[];      // km, relative to gate crossing (starting at 0)
    virtualElevation: number[];
    actualElevation: number[];
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

    // Extract arrays from fitData
    const allTimestamps = Array.from(fitData.timestamps) as number[];
    const allPower = Array.from(fitData.power) as number[];
    const allVelocity = Array.from(fitData.velocity) as number[];
    const allPositionLat = Array.from(fitData.position_lat) as number[];
    const allPositionLong = Array.from(fitData.position_long) as number[];
    const allAltitude = Array.from(fitData.altitude) as number[];
    const allDistance = Array.from(fitData.distance) as number[];

    // Handle wind/air speed
    const hasAirSpeed = fitData.air_speed && (Array.from(fitData.air_speed) as number[]).some((v: number) => !isNaN(v) && v !== 0);
    const hasWindSpeed = fitData.wind_speed && (Array.from(fitData.wind_speed) as number[]).some((v: number) => !isNaN(v) && v !== 0);

    // Check wind source selection (if UI exists)
    const windSourceRadio = document.querySelector('input[name="windSource"]:checked') as HTMLInputElement;
    const selectedWindSource = windSourceRadio ? windSourceRadio.value : (hasAirSpeed || hasWindSpeed ? 'fit' : 'constant');

    let allWindSpeed: number[];
    const defaultOffset = 2; // Default air speed offset

    if (selectedWindSource === 'constant') {
        // Use constant wind - fill with NaN so calculator uses constant wind settings
        allWindSpeed = new Array(allTimestamps.length).fill(NaN);
        console.log('GPS Lap VE: Using constant wind settings');
    } else if (hasAirSpeed) {
        const rawYaw = fitData.wind_yaw || new Array(fitData.air_speed.length).fill(0);
        let baseWindSpeed = (Array.from(fitData.air_speed) as number[]).map((magnitude: number, i: number) => {
            const yaw = rawYaw[i] || 0;
            return Math.cos(yaw * Math.PI / 180) * magnitude;
        });
        // Apply time offset
        const windSpeedOffset = params?.air_speed_offset ?? defaultOffset;
        baseWindSpeed = applyAirSpeedOffset(baseWindSpeed, windSpeedOffset);
        // Apply calibration if set
        allWindSpeed = airSpeedCalibrationPercent !== 0
            ? baseWindSpeed.map(speed => speed * (1.0 + airSpeedCalibrationPercent / 100.0))
            : baseWindSpeed;
        console.log(`GPS Lap VE: Using FIT air speed data (offset: ${windSpeedOffset}s, calibration: ${airSpeedCalibrationPercent}%)`);
    } else if (hasWindSpeed) {
        const rawYaw = fitData.wind_yaw || new Array(fitData.wind_speed.length).fill(0);
        let baseWindSpeed = (Array.from(fitData.wind_speed) as number[]).map((magnitude: number, i: number) => {
            const yaw = rawYaw[i] || 0;
            return Math.cos(yaw * Math.PI / 180) * magnitude;
        });
        // Apply time offset
        const windSpeedOffset = params?.air_speed_offset ?? defaultOffset;
        baseWindSpeed = applyAirSpeedOffset(baseWindSpeed, windSpeedOffset);
        // Apply calibration if set
        allWindSpeed = airSpeedCalibrationPercent !== 0
            ? baseWindSpeed.map(speed => speed * (1.0 + airSpeedCalibrationPercent / 100.0))
            : baseWindSpeed;
        console.log(`GPS Lap VE: Using FIT wind speed data (offset: ${windSpeedOffset}s, calibration: ${airSpeedCalibrationPercent}%)`);
    } else {
        allWindSpeed = new Array(allTimestamps.length).fill(0);
        console.log('GPS Lap VE: No wind data available');
    }

    // Get CdA and Crr values
    const cda = params.cda ?? 0.3;
    const crr = params.crr ?? 0.008;

    // Calculate VE for each lap
    for (let lapIdx = 0; lapIdx < lapIndexRanges.length; lapIdx++) {
        const range = lapIndexRanges[lapIdx];
        const lapNumber = gpsDetectedLaps[lapIdx]?.lapNumber ?? (lapIdx + 1);

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
            console.warn(`Lap ${lapNumber} has too few data points (${lapTimestamps.length}), skipping`);
            continue;
        }

        // Make distances relative to lap start (0 at gate crossing)
        const startDistance = lapDistance[0];
        const relativeDistances = lapDistance.map(d => (d - startDistance) / 1000); // Convert to km

        // Calculate duration
        const duration = lapTimestamps[lapTimestamps.length - 1] - lapTimestamps[0];
        const totalDistance = relativeDistances[relativeDistances.length - 1];

        try {
            // Create VE calculator for this lap
            const calculator = create_ve_calculator(
                new Float64Array(lapTimestamps),
                new Float64Array(lapPower),
                new Float64Array(lapVelocity),
                new Float64Array(lapPositionLat),
                new Float64Array(lapPositionLong),
                new Float64Array(lapAltitude),
                new Float64Array(lapDistance),
                new Float64Array(lapWindSpeed),
                params.system_mass,
                params.rho,
                params.eta,
                cda,
                crr,
                params.cda_min,
                params.cda_max,
                params.crr_min,
                params.crr_max,
                params.wind_speed,
                params.wind_direction,
                params.velodrome
            );

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
                duration,
                totalDistance
            });

            console.log(`Lap ${lapNumber}: ${totalDistance.toFixed(2)} km, ${duration.toFixed(0)}s, ${veArray.length} points`);

        } catch (err) {
            console.error(`Failed to calculate VE for lap ${lapNumber}:`, err);
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
    // Determine which wind source should be selected
    // If preservedWindSource is provided, use it; otherwise use default based on data availability
    const selectedWindSource = preservedWindSource || (hasWindSpeed ? 'fit' : 'constant');
    // Ensure Plotly is loaded
    const Plotly = await waitForPlotly();

    // Show the VE analysis section
    const veSection = document.getElementById('veAnalysisSection') as HTMLElement;
    if (veSection) {
        veSection.classList.remove('hidden', 'inactive');
    }

    const veAnalysisContent = document.getElementById('veAnalysisContent') as HTMLElement;
    if (!veAnalysisContent) {
        console.error('VE analysis content container not found');
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

                        ${(hasWindSpeed || hasConstantWind) ? `
                        <div class="ve-tab-content" id="wind-tab">
                            <div id="gpsLapWindPlot" class="ve-plot" style="height: 600px;"></div>
                            ${hasWindSpeed ? `
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

                        ${hasWindSpeed ? `
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
    setupGpsLapTabSwitching(lapProfiles, hasWindSpeed, hasConstantWind);

    // Setup wind source radio button listeners
    const windSourceRadios = document.querySelectorAll('input[name="windSource"]');
    windSourceRadios.forEach(radio => {
        radio.addEventListener('change', () => {
            console.log('Wind source changed - triggering GPS lap VE recalculation');
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
            airSpeedCalibrationPercent = value;
            console.log('Air speed calibration changed - triggering GPS lap VE recalculation');
            recalculateGpsLapVE();
        };

        const updateAirSpeedCalibrationFromInput = () => {
            const value = parseFloat(airSpeedCalibrationValue.value);
            if (isNaN(value)) return;
            const clamped = Math.max(-20.0, Math.min(value, 20.0));
            airSpeedCalibrationSlider.value = clamped.toString();
            airSpeedCalibrationValue.value = clamped.toFixed(1);
            airSpeedCalibrationPercent = clamped;
            console.log('Air speed calibration changed - triggering GPS lap VE recalculation');
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
                console.log('Auto-adjust clicked for GPS lap mode');
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

    console.log(`GPS Lap VE plot rendered with ${lapProfiles.length} laps`);
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
function setupGpsLapTabSwitching(lapProfiles: LapVEProfile[], hasWindSpeed: boolean, hasConstantWind: boolean) {
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
            if (tabName === 'wind' && (hasWindSpeed || hasConstantWind)) {
                renderGpsLapWindPlot(lapProfiles);
            } else if (tabName === 'power') {
                renderGpsLapPowerPlot(lapProfiles);
            } else if (tabName === 'vd' && hasWindSpeed) {
                renderGpsLapVdPlot(lapProfiles);
            }
        });
    });
}

/**
 * Recalculate GPS lap VE with updated CdA/Crr values
 */
async function recalculateGpsLapVE() {
    if (!currentFitData || !currentParameters) {
        console.error('Cannot recalculate: missing data or parameters');
        return;
    }

    const cdaValueEl = document.getElementById('cdaValue') as HTMLInputElement;
    const crrValueEl = document.getElementById('crrValue') as HTMLInputElement;

    if (!cdaValueEl || !crrValueEl) return;

    const newCda = parseFloat(cdaValueEl.value);
    const newCrr = parseFloat(crrValueEl.value);

    // Get the selected GPS lap index ranges
    const selectedGpsLaps = gpsDetectedLaps.filter(lap =>
        gpsSelectedLaps.includes(lap.lapNumber)
    );
    const selectedLapIndexRanges = selectedGpsLaps.map(lap => ({
        startIdx: lap.startIdx,
        endIdx: lap.endIdx
    }));

    if (selectedLapIndexRanges.length === 0) {
        console.error('No GPS laps selected for recalculation');
        return;
    }

    // Update parameters with new values
    const updatedParams = { ...currentParameters, cda: newCda, crr: newCrr };

    // Recalculate
    showLoading('Recalculating VE with new parameters...');

    try {
        await showGpsLapVEAnalysis(
            selectedLapIndexRanges,
            currentFitData,
            updatedParams,
            currentParameters.air_speed_offset ?? 2
        );
    } catch (err) {
        console.error('Recalculation failed:', err);
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
        console.error('Failed to save screenshot:', err);
    }
}

/**
 * Render stacked Wind plot for GPS lap mode
 */
function renderGpsLapWindPlot(_lapProfiles: LapVEProfile[]) {
    const Plotly = (window as any).Plotly;
    if (!Plotly) return;

    const plotDiv = document.getElementById('gpsLapWindPlot');
    if (!plotDiv) return;

    // For now, show a placeholder - stacked wind plots will show wind speed per lap
    const layout = {
        title: 'Wind Speed by Lap',
        xaxis: { title: 'Distance (km)' },
        yaxis: { title: 'Wind Speed (m/s)' },
        showlegend: true,
        margin: { t: 40, r: 20, b: 50, l: 60 }
    };

    // TODO: Add stacked wind speed traces per lap
    Plotly.newPlot('gpsLapWindPlot', [], layout, { responsive: true });
}

/**
 * Render stacked Power plot for GPS lap mode
 */
function renderGpsLapPowerPlot(_lapProfiles: LapVEProfile[]) {
    const Plotly = (window as any).Plotly;
    if (!Plotly) return;

    const plotDiv = document.getElementById('gpsLapPowerPlot');
    if (!plotDiv) return;

    // For now, show a placeholder - stacked power plots will show power per lap
    const layout = {
        title: 'Power by Lap',
        xaxis: { title: 'Distance (km)' },
        yaxis: { title: 'Power (W)' },
        showlegend: true,
        margin: { t: 40, r: 20, b: 50, l: 60 }
    };

    // TODO: Add stacked power traces per lap
    Plotly.newPlot('gpsLapPowerPlot', [], layout, { responsive: true });
}

/**
 * Render stacked VD plot for GPS lap mode
 */
function renderGpsLapVdPlot(_lapProfiles: LapVEProfile[]) {
    const Plotly = (window as any).Plotly;
    if (!Plotly) return;

    const plotDiv = document.getElementById('gpsLapVdPlot');
    if (!plotDiv) return;

    // For now, show a placeholder - stacked VD plots will show virtual distance per lap
    const layout = {
        title: 'Virtual Distance by Lap',
        xaxis: { title: 'Distance (km)' },
        yaxis: { title: 'Virtual Distance (km)' },
        showlegend: true,
        margin: { t: 40, r: 20, b: 50, l: 60 }
    };

    // TODO: Add stacked VD traces per lap
    Plotly.newPlot('gpsLapVdPlot', [], layout, { responsive: true });
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
    // Store analyzed laps globally for save functionality
    currentAnalyzedLaps = analyzedLaps;
    // Store filtered data globally for save functionality
    currentFilteredData = { power, velocity, temperature, timestamps };
    // Store CdA reference data globally (will be used for dynamic validation)
    currentCdaReference = cdaReference;

    // Check if wind_speed data is available (not all zeros/NaN)
    const hasWindSpeed = windSpeed.some(val => !isNaN(val) && val !== 0);
    const hasConstantWind = currentParameters.wind_speed !== undefined && currentParameters.wind_speed !== 0 &&
                            currentParameters.wind_direction !== undefined;

    console.log('Wind data availability:', {
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
        console.log('Found veSection, removing hidden/inactive classes');
        veSection.classList.remove('hidden', 'inactive');
        console.log('veSection classes after removal:', veSection.className);
    } else {
        console.error('veAnalysisSection element not found in DOM');
        return;
    }

    // Get the VE analysis content container
    const veAnalysisContent = document.getElementById('veAnalysisContent') as HTMLElement;
    if (!veAnalysisContent) {
        console.error('VE analysis content container not found');
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
                        <input type="range" id="trimStartSlider" min="0" max="${timestamps.length - 30}" value="${presetTrimStart}" class="ve-slider">
                        <input type="number" id="trimStartValue" value="${presetTrimStart}" min="0" max="${timestamps.length - 30}" class="ve-value-input">
                    </div>

                    <div class="ve-control-group">
                        <label>Trim End (seconds):</label>
                        <input type="range" id="trimEndSlider" min="30" max="${timestamps.length - 1}" value="${presetTrimEnd ?? timestamps.length - 1}" class="ve-slider">
                        <input type="number" id="trimEndValue" value="${presetTrimEnd ?? timestamps.length - 1}" min="30" max="${timestamps.length - 1}" class="ve-value-input">
                    </div>

                    <div class="ve-control-group">
                        <label>CdA (Drag Coefficient × Area):</label>
                        <input type="range" id="cdaSlider" min="${currentParameters.cda_min}" max="${currentParameters.cda_max}" value="${currentParameters.cda || 0.3}" step="0.001" class="ve-slider">
                        <input type="number" id="cdaValue" value="${(currentParameters.cda || 0.3).toFixed(3)}" min="${currentParameters.cda_min}" max="${currentParameters.cda_max}" step="0.001" class="ve-value-input">
                    </div>

                    <div class="ve-control-group">
                        <label>Crr (Rolling Resistance):</label>
                        <input type="range" id="crrSlider" min="${currentParameters.crr_min}" max="${currentParameters.crr_max}" value="${currentParameters.crr || 0.008}" step="0.0001" class="ve-slider">
                        <input type="number" id="crrValue" value="${(currentParameters.crr || 0.008).toFixed(4)}" min="${currentParameters.crr_min}" max="${currentParameters.crr_max}" step="0.0001" class="ve-value-input">
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
                            <input type="range" id="airSpeedOffsetSlider" min="-10" max="10" step="1" value="${currentParameters?.air_speed_offset ?? defaultAirSpeedOffset}"
                                   style="width: 100%;" />
                            <input type="number" id="airSpeedOffsetValue" value="${currentParameters?.air_speed_offset ?? defaultAirSpeedOffset}" step="1" min="-10" max="10"
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

    // Try to load saved lap settings for this file and lap combination
    let savedSettings: LapSettings | null = null;
    if (currentFileHash) {
        try {
            savedSettings = await parameterStorage.loadLapSettings(currentFileHash, analyzedLaps);
            if (savedSettings) {
                // Update preset values that will be used when rendering
                presetTrimStart = savedSettings.trimStart;
                presetTrimEnd = savedSettings.trimEnd;

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
                        airSpeedCalibrationPercent = savedAirSpeedCalibration;
                    }

                    // Trigger an update to re-render with saved values
                    if (cdaSlider) cdaSlider.dispatchEvent(new Event('input'));
                }, 100);
            }
        } catch (err) {
            console.error('Failed to load lap settings:', err);
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
                    createWindSpeedPlot(timestamps, velocity, windSpeed, distance,trimStart, trimEnd, defaultAirSpeedOffset);
                }, 100);
            } else if (tabName === 'power') {
                // Create speed & power plot
                setTimeout(() => {
                    createSpeedPowerPlot(timestamps, velocity, power, trimStart, trimEnd);
                }, 100);
            } else if (tabName === 'vd') {
                // Create virtual distance plot
                setTimeout(() => {
                    createVirtualDistancePlot(timestamps, velocity, windSpeed, distance,trimStart, trimEnd);
                }, 100);
            } else if (tabName === 've') {
                // Resize VE plots when switching back
                setTimeout(async () => {
                    try {
                        const Plotly = await waitForPlotly();
                        Plotly.Plots.resize('vePlot');
                        Plotly.Plots.resize('veResidualsPlot');
                    } catch (error) {
                        console.error('Failed to resize plots:', error);
                    }
                }, 100);
            }
        });
    });

    // Set up sliders with real-time updates
    setupVESliders(timestamps, power, velocity, positionLat, positionLong, altitude, distance, windSpeed, defaultAirSpeedOffset);

    // Initial plot rendering (with delay to ensure Plotly is loaded)
    // Use preset trim values if they were set before clicking analyze
    const initialTrimStart = presetTrimStart;
    const initialTrimEnd = presetTrimEnd ?? timestamps.length - 1;
    console.log('Using preset trim values for initial render:', {
        trimStart: initialTrimStart,
        trimEnd: initialTrimEnd
    });
    setTimeout(() => {
        updateVEPlots(timestamps, power, velocity, positionLat, positionLong, altitude, distance, windSpeed,initialTrimStart, initialTrimEnd);

        // CdA validation plots will be rendered dynamically by updateVEPlots if CdA reference exists

        // Update map markers with preset trim values after analyze
        if (mapVisualization && filteredVEData) {
            console.log('Setting map trim markers to preset values after analyze');
            mapVisualization.fitBoundsToTrimRegion(initialTrimStart, initialTrimEnd, filteredVEData.positionLat, filteredVEData.positionLong);
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
    if (!selectedFile) {
        console.error('Cannot save: missing file');
        alert('Cannot save screenshot: missing file data.');
        return;
    }

    const lapCombo = currentAnalyzedLaps.length === 0 ? 'all' : currentAnalyzedLaps.join('-');
    const saveBtn = document.getElementById('saveScreenshot') as HTMLButtonElement;
    if (!saveBtn) return;

    const originalText = saveBtn.textContent;

    try {
        saveBtn.disabled = true;
        saveBtn.textContent = 'Saving...';

        await resultsStorage.saveScreenshot(selectedFile.name, lapCombo);

        saveBtn.textContent = '✓ Saved';
        setTimeout(() => {
            saveBtn.disabled = false;
            saveBtn.textContent = originalText || 'Save Screenshot';
        }, 2000);
    } catch (error) {
        console.error('❌ Failed to save screenshot:', error);
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
    if (!selectedFile || !currentParameters || !currentVEResult) {
        console.error('Cannot store: missing required data');
        alert('Cannot store result: missing analysis data. Please run analysis first.');
        return;
    }

    // Get filtered data arrays (already filtered by selected laps)
    if (!currentFilteredData) {
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

        if (isGpsLapModeActive) {
            // GPS lap mode - use full data range and get CdA/Crr from sliders
            trimStart = 0;
            trimEnd = currentFilteredData.power.length - 1;
            const cdaSlider = document.getElementById('cdaSlider') as HTMLInputElement;
            const crrSlider = document.getElementById('crrSlider') as HTMLInputElement;
            cda = cdaSlider ? parseFloat(cdaSlider.value) : currentParameters.cda ?? 0.3;
            crr = crrSlider ? parseFloat(crrSlider.value) : currentParameters.crr ?? 0.005;
        } else {
            // Normal mode - get trim values from sliders
            const trimStartSlider = document.getElementById('trimStartSlider') as HTMLInputElement;
            const trimEndSlider = document.getElementById('trimEndSlider') as HTMLInputElement;
            const cdaSlider = document.getElementById('cdaSlider') as HTMLInputElement;
            const crrSlider = document.getElementById('crrSlider') as HTMLInputElement;

            if (!trimStartSlider || !trimEndSlider || !cdaSlider || !crrSlider) {
                console.error('Cannot store: UI elements not found');
                return;
            }

            trimStart = parseInt(trimStartSlider.value);
            trimEnd = parseInt(trimEndSlider.value);
            cda = parseFloat(cdaSlider.value);
            crr = parseFloat(crrSlider.value);
        }

        const filteredPower = currentFilteredData.power;
        const filteredVelocity = currentFilteredData.velocity;
        const filteredTemperature = currentFilteredData.temperature;
        const filteredTimestamps = currentFilteredData.timestamps;

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
            fileName: selectedFile.name,
            laps: currentAnalyzedLaps,
            trimStart: trimStart,
            trimEnd: trimEnd,
            cda: cda,
            crr: crr,
            airSpeedCalibration: airSpeedCalibrationPercent !== 0 ? airSpeedCalibrationPercent : undefined,
            windSource: currentWindSource,
            parameters: currentParameters,
            result: currentVEResult,
            timestamp: new Date(),
            recordingDate: recordingDate,
            avgPower: avgPower,
            avgSpeed: avgSpeed,
            avgTemperature: avgTemperature,
            notes: notes,
            isGpsLapMode: isGpsLapModeActive  // Track if this was GPS lap mode
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
        console.error('❌ Failed to store result:', error);
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
        console.error('❌ Failed to export results:', error);
        alert('Failed to export results. See console for details.');

        exportBtn.disabled = false;
        exportBtn.textContent = originalText || 'Export all results to CSV';
    }
}

// Helper function to save current lap settings to IndexedDB
async function saveCurrentLapSettings() {
    if (!currentFileHash || !selectedFile) return;

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
        airSpeedCalibration: airSpeedCalibrationPercent !== 0 ? airSpeedCalibrationPercent : undefined
    };

    try {
        await parameterStorage.saveLapSettings(currentFileHash, selectedLaps, settings);
    } catch (err) {
        console.error('Failed to save lap settings:', err);
    }
}

// Helper function to save map trim settings (before VE analysis is opened)
async function saveMapTrimSettings() {

    if (!currentFileHash || !selectedFile) {
        console.warn('⚠️ Cannot save: missing fileHash or selectedFile');
        return;
    }

    const settings: LapSettings = {
        trimStart: presetTrimStart,
        trimEnd: presetTrimEnd ?? 0,
        cda: null, // CdA/Crr not set yet
        crr: null
    };

    try {
        await parameterStorage.saveLapSettings(currentFileHash, selectedLaps, settings);
    } catch (err) {
        console.error('❌ Failed to save map trim settings:', err);
    }
}

function setupVESliders(timestamps: number[], power: number[], velocity: number[], positionLat: number[], positionLong: number[], altitude: number[], distance: number[], windSpeed: number[], defaultAirSpeedOffset: number) {
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
        console.log('Trim Start changed:', {
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

        updateVEPlots(timestamps, power, velocity, positionLat, positionLong, altitude, distance, windSpeed,value, trimEnd);

        // Update other plots if they're visible
        const windTab = document.getElementById('wind-tab');
        if (windTab && windTab.classList.contains('active')) {
            createWindSpeedPlot(timestamps, velocity, windSpeed, distance,value, trimEnd, defaultAirSpeedOffset);
        }
        const powerTab = document.getElementById('power-tab');
        if (powerTab && powerTab.classList.contains('active')) {
            createSpeedPowerPlot(timestamps, velocity, power, value, trimEnd);
        }
        const vdTab = document.getElementById('vd-tab');
        if (vdTab && vdTab.classList.contains('active')) {
            createVirtualDistancePlot(timestamps, velocity, windSpeed, distance,value, trimEnd);
        }

        // Auto-zoom map to trim region
        if (mapVisualization && filteredVEData) {
            mapVisualization.fitBoundsToTrimRegion(value, trimEnd, filteredVEData.positionLat, filteredVEData.positionLong);
        }

        // Save lap settings
        saveCurrentLapSettings();
    };

    const updateTrimEnd = () => {
        const value = parseInt(trimEndSlider.value);
        trimEndValue.value = value.toString();

        // Ensure trim end > trim start + 30
        const trimStart = parseInt(trimStartSlider.value);
        console.log('Trim End changed:', {
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

        updateVEPlots(timestamps, power, velocity, positionLat, positionLong, altitude, distance, windSpeed,trimStart, value);

        // Update other plots if they're visible
        const windTab = document.getElementById('wind-tab');
        if (windTab && windTab.classList.contains('active')) {
            createWindSpeedPlot(timestamps, velocity, windSpeed, distance,trimStart, value, defaultAirSpeedOffset);
        }
        const powerTab = document.getElementById('power-tab');
        if (powerTab && powerTab.classList.contains('active')) {
            createSpeedPowerPlot(timestamps, velocity, power, trimStart, value);
        }
        const vdTab = document.getElementById('vd-tab');
        if (vdTab && vdTab.classList.contains('active')) {
            createVirtualDistancePlot(timestamps, velocity, windSpeed, distance,trimStart, value);
        }

        // Auto-zoom map to trim region
        if (mapVisualization && filteredVEData) {
            mapVisualization.fitBoundsToTrimRegion(trimStart, value, filteredVEData.positionLat, filteredVEData.positionLong);
        }

        // Save lap settings
        saveCurrentLapSettings();
    };

    const updateCdA = () => {
        const value = parseFloat(cdaSlider.value);
        cdaValue.value = value.toFixed(3);

        const trimStart = parseInt(trimStartSlider.value);
        const trimEnd = parseInt(trimEndSlider.value);
        updateVEPlots(timestamps, power, velocity, positionLat, positionLong, altitude, distance, windSpeed,trimStart, trimEnd);

        // Save lap settings
        saveCurrentLapSettings();
    };

    const updateCrr = () => {
        const value = parseFloat(crrSlider.value);
        crrValue.value = value.toFixed(4);

        const trimStart = parseInt(trimStartSlider.value);
        const trimEnd = parseInt(trimEndSlider.value);
        updateVEPlots(timestamps, power, velocity, positionLat, positionLong, altitude, distance, windSpeed,trimStart, trimEnd);

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

        updateVEPlots(timestamps, power, velocity, positionLat, positionLong, altitude, distance, windSpeed,clamped, trimEnd);

        // Update wind speed plot if it's visible
        const windTab = document.getElementById('wind-tab');
        if (windTab && windTab.classList.contains('active')) {
            createWindSpeedPlot(timestamps, velocity, windSpeed, distance,clamped, trimEnd, defaultAirSpeedOffset);
        }

        // Update power plot if it's visible
        const powerTab = document.getElementById('power-tab');
        if (powerTab && powerTab.classList.contains('active')) {
            createSpeedPowerPlot(timestamps, velocity, power, clamped, trimEnd);
        }

        // Update VD plot if it's visible
        const vdTab = document.getElementById('vd-tab');
        if (vdTab && vdTab.classList.contains('active')) {
            createVirtualDistancePlot(timestamps, velocity, windSpeed, distance,clamped, trimEnd);
        }

        if (mapVisualization && filteredVEData) {
            mapVisualization.fitBoundsToTrimRegion(clamped, trimEnd, filteredVEData.positionLat, filteredVEData.positionLong);
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

        updateVEPlots(timestamps, power, velocity, positionLat, positionLong, altitude, distance, windSpeed,trimStart, clamped);

        // Update wind speed plot if it's visible
        const windTab = document.getElementById('wind-tab');
        if (windTab && windTab.classList.contains('active')) {
            createWindSpeedPlot(timestamps, velocity, windSpeed, distance,trimStart, clamped, defaultAirSpeedOffset);
        }

        // Update power plot if it's visible
        const powerTab = document.getElementById('power-tab');
        if (powerTab && powerTab.classList.contains('active')) {
            createSpeedPowerPlot(timestamps, velocity, power, trimStart, clamped);
        }

        // Update VD plot if it's visible
        const vdTab = document.getElementById('vd-tab');
        if (vdTab && vdTab.classList.contains('active')) {
            createVirtualDistancePlot(timestamps, velocity, windSpeed, distance,trimStart, clamped);
        }

        if (mapVisualization && filteredVEData) {
            mapVisualization.fitBoundsToTrimRegion(trimStart, clamped, filteredVEData.positionLat, filteredVEData.positionLong);
        }

        // Save lap settings
        saveCurrentLapSettings();
    };

    const updateCdAFromInput = () => {
        const value = parseFloat(cdaValue.value);
        if (isNaN(value)) return;

        const clamped = Math.max(currentParameters.cda_min, Math.min(value, currentParameters.cda_max));

        cdaSlider.value = clamped.toString();
        cdaValue.value = clamped.toFixed(3);

        const trimStart = parseInt(trimStartSlider.value);
        const trimEnd = parseInt(trimEndSlider.value);
        updateVEPlots(timestamps, power, velocity, positionLat, positionLong, altitude, distance, windSpeed,trimStart, trimEnd);

        // Save lap settings
        saveCurrentLapSettings();
    };

    const updateCrrFromInput = () => {
        const value = parseFloat(crrValue.value);
        if (isNaN(value)) return;

        const clamped = Math.max(currentParameters.crr_min, Math.min(value, currentParameters.crr_max));

        crrSlider.value = clamped.toString();
        crrValue.value = clamped.toFixed(4);

        const trimStart = parseInt(trimStartSlider.value);
        const trimEnd = parseInt(trimEndSlider.value);
        updateVEPlots(timestamps, power, velocity, positionLat, positionLong, altitude, distance, windSpeed,trimStart, trimEnd);

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
            if (currentParameters?.auto_calculate_rho && !isCalculatingAutoRho) {
                calculateAutoRho().catch(err => {
                    console.error('Auto-rho calculation error on trim change:', err);
                });
            }
        }, 500); // Wait 500ms after last slider change
    };

    trimStartSlider.addEventListener('input', triggerAutoRhoOnTrimChange);
    trimEndSlider.addEventListener('input', triggerAutoRhoOnTrimChange);

    // Also trigger auto-rho immediately after VE analysis completes (if enabled)
    if (currentParameters?.auto_calculate_rho && !isCalculatingAutoRho) {
        setTimeout(() => {
            calculateAutoRho().catch(err => {
                console.error('Auto-rho initial calculation error:', err);
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
            console.log('Wind source changed to:', windSource);

            const trimStart = parseInt(trimStartSlider.value);
            const trimEnd = parseInt(trimEndSlider.value);

            // Update VE calculation with new wind source
            updateVEPlotsWithWindSource(timestamps, power, velocity, positionLat, positionLong, altitude, distance, windSpeed, trimStart, trimEnd, windSource);
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
            airSpeedCalibrationPercent = value;

            const trimStart = parseInt(trimStartSlider.value);
            const trimEnd = parseInt(trimEndSlider.value);

            // Trigger full recalculation (which will apply calibration when creating calculator)
            updateVEPlots(timestamps, power, velocity, positionLat, positionLong, altitude, distance, windSpeed,trimStart, trimEnd);

            // Update VD tab if visible
            const vdTab = document.getElementById('vd-tab');
            if (vdTab && vdTab.classList.contains('active')) {
                createVirtualDistancePlot(timestamps, velocity, windSpeed, distance,trimStart, trimEnd);
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
            airSpeedCalibrationPercent = clamped;

            const trimStart = parseInt(trimStartSlider.value);
            const trimEnd = parseInt(trimEndSlider.value);

            // Trigger full recalculation
            updateVEPlots(timestamps, power, velocity, positionLat, positionLong, altitude, distance, windSpeed,trimStart, trimEnd);

            // Update VD tab if visible
            const vdTab = document.getElementById('vd-tab');
            if (vdTab && vdTab.classList.contains('active')) {
                createVirtualDistancePlot(timestamps, velocity, windSpeed, distance,trimStart, trimEnd);
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
                    airSpeedCalibrationPercent = clampedPercent;

                    // Trigger recalculation
                    updateVEPlots(timestamps, power, velocity, positionLat, positionLong, altitude, distance, windSpeed,trimStart, trimEnd);

                    // Update VD tab if visible
                    const vdTab = document.getElementById('vd-tab');
                    if (vdTab && vdTab.classList.contains('active')) {
                        createVirtualDistancePlot(timestamps, velocity, windSpeed, distance,trimStart, trimEnd);
                    }

                    // Save settings
                    saveCurrentLapSettings();

                    console.log(`Auto-adjusted air speed calibration to ${clampedPercent.toFixed(1)}%`);
                } else {
                    console.warn('Cannot auto-adjust: no air speed data available');
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
            if (parametersComponent && currentParameters) {
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
            updateVEPlots(timestamps, power, velocity, positionLat, positionLong, altitude, distance, windSpeed,trimStart, trimEnd);

            // Update wind plot if visible
            const windTab = document.getElementById('wind-tab');
            if (windTab && windTab.classList.contains('active')) {
                createWindSpeedPlot(timestamps, velocity, windSpeed, distance,trimStart, trimEnd, defaultAirSpeedOffset);
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
            if (parametersComponent && currentParameters) {
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
            updateVEPlots(timestamps, power, velocity, positionLat, positionLong, altitude, distance, windSpeed,trimStart, trimEnd);

            // Update wind plot if visible
            const windTab = document.getElementById('wind-tab');
            if (windTab && windTab.classList.contains('active')) {
                createWindSpeedPlot(timestamps, velocity, windSpeed, distance,trimStart, trimEnd, defaultAirSpeedOffset);
            }

            // Save settings
            saveCurrentLapSettings();
        };

        airSpeedOffsetSlider.addEventListener('input', updateAirSpeedOffset);
        airSpeedOffsetValue.addEventListener('change', updateAirSpeedOffsetFromInput);

        // Calculate initial error metric
        const trimStart = parseInt(trimStartSlider.value);
        const trimEnd = parseInt(trimEndSlider.value);
        const initialOffset = currentParameters?.air_speed_offset ?? defaultAirSpeedOffset;
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

    console.log('Map trim controls lookup:', {
        mapTrimControls: !!mapTrimControls,
        mapTrimStartSlider: !!mapTrimStartSlider,
        mapTrimEndSlider: !!mapTrimEndSlider,
        mapTrimStartValue: !!mapTrimStartValue,
        mapTrimEndValue: !!mapTrimEndValue
    });

    if (mapTrimControls && mapTrimStartSlider && mapTrimEndSlider && mapTrimStartValue && mapTrimEndValue) {
        console.log('Showing map trim controls');
        // Show the map trim controls
        mapTrimControls.style.display = 'flex';

        // Set same ranges and initial values as main controls (preserve preset values from section 3)
        mapTrimStartSlider.min = '0';
        mapTrimStartSlider.max = (timestamps.length - 30).toString();
        mapTrimStartSlider.value = presetTrimStart.toString();
        mapTrimStartValue.value = presetTrimStart.toString();
        mapTrimStartValue.min = '0';
        mapTrimStartValue.max = (timestamps.length - 30).toString();

        const initialTrimEnd = presetTrimEnd ?? timestamps.length - 1;
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
function applyAirSpeedOffset(airSpeed: number[], offsetSeconds: number): number[] {
    if (offsetSeconds === 0 || airSpeed.length === 0) {
        return airSpeed;
    }

    const offsetIndices = Math.round(offsetSeconds); // Assuming 1Hz sampling rate
    const result = new Array(airSpeed.length);

    for (let i = 0; i < airSpeed.length; i++) {
        const sourceIndex = i + offsetIndices;
        if (sourceIndex >= 0 && sourceIndex < airSpeed.length) {
            result[i] = airSpeed[sourceIndex];
        } else {
            result[i] = NaN; // Out of bounds
        }
    }

    return result;
}

/**
 * Calculate synchronization error metric between ground speed and air speed
 * Returns sum of absolute differences (lower is better)
 */
function calculateAirSpeedSyncError(
    groundSpeed: number[],
    airSpeed: number[],
    offsetSeconds: number,
    trimStart: number,
    trimEnd: number
): number {
    // Apply offset to air speed
    const offsetAirSpeed = applyAirSpeedOffset(airSpeed, offsetSeconds);

    let sumAbsDiff = 0;
    let validCount = 0;

    for (let i = trimStart; i <= trimEnd && i < groundSpeed.length; i++) {
        const ground = groundSpeed[i];
        const air = offsetAirSpeed[i];

        // Only include valid data points where both speeds are available
        if (!isNaN(ground) && !isNaN(air) && ground > 0 && air > 0) {
            sumAbsDiff += Math.abs(air - ground);
            validCount++;
        }
    }

    // Return average absolute difference (normalized by count)
    return validCount > 0 ? sumAbsDiff / validCount : NaN;
}

function updateVEPlots(timestamps: number[], power: number[], velocity: number[], positionLat: number[], positionLong: number[], altitude: number[], distance: number[], windSpeed: number[], trimStart: number, trimEnd: number) {
    // Check which wind source is currently selected
    const windSourceRadio = document.querySelector('input[name="windSource"]:checked') as HTMLInputElement;
    const windSource = windSourceRadio ? windSourceRadio.value : 'fit';

    console.log('updateVEPlots: Using wind source:', windSource);

    // Use the wind source specific function
    updateVEPlotsWithWindSource(timestamps, power, velocity, positionLat, positionLong, altitude, distance, windSpeed, trimStart, trimEnd, windSource);
}

async function updateVEPlotsWithWindSource(timestamps: number[], power: number[], velocity: number[], positionLat: number[], positionLong: number[], altitude: number[], distance: number[], windSpeed: number[], trimStart: number, trimEnd: number, windSource: string) {
    const cdaSlider = document.getElementById('cdaSlider') as HTMLInputElement;
    const crrSlider = document.getElementById('crrSlider') as HTMLInputElement;

    const cda = parseFloat(cdaSlider.value);
    const crr = parseFloat(crrSlider.value);

    try {
        // GPS Lap Mode: Calculate VE for each lap separately and show stacked plot
        if (isGpsLapModeActive && currentGpsLapIndexRanges && currentFitData) {
            await updateGpsLapVEPlots(cda, crr, windSource);
            return;
        }

        if (windSource === 'compare') {
            // Compare both methods - create two calculators
            if (!currentParameters) return;

            // Calculator 1: Use constant wind
            const constantWindSpeed = new Array(windSpeed.length).fill(NaN);
            const calculator1 = create_ve_calculator(
                new Float64Array(timestamps),
                new Float64Array(power),
                new Float64Array(velocity),
                new Float64Array(positionLat),
                new Float64Array(positionLong),
                new Float64Array(altitude),
                new Float64Array(distance),
                new Float64Array(constantWindSpeed),
                currentParameters.system_mass,
                currentParameters.rho,
                currentParameters.eta,
                cda,
                crr,
                currentParameters.cda_min,
                currentParameters.cda_max,
                currentParameters.crr_min,
                currentParameters.crr_max,
                currentParameters.wind_speed,
                currentParameters.wind_direction,
                currentParameters.velodrome
            );

            // Calculator 2: Use FIT file wind data
            // Apply time offset first (to sync with ground speed)
            const defaultOffset = 2;
            const windSpeedOffset = currentParameters?.air_speed_offset ?? defaultOffset;
            const offsetWindSpeed = applyAirSpeedOffset(windSpeed, windSpeedOffset);

            // Then apply calibration if set
            const calibratedWindSpeed = airSpeedCalibrationPercent !== 0
                ? offsetWindSpeed.map(speed => speed * (1.0 + airSpeedCalibrationPercent / 100.0))
                : offsetWindSpeed;

            const calculator2 = create_ve_calculator(
                new Float64Array(timestamps),
                new Float64Array(power),
                new Float64Array(velocity),
                new Float64Array(positionLat),
                new Float64Array(positionLong),
                new Float64Array(altitude),
                new Float64Array(distance),
                new Float64Array(calibratedWindSpeed),
                currentParameters.system_mass,
                currentParameters.rho,
                currentParameters.eta,
                cda,
                crr,
                currentParameters.cda_min,
                currentParameters.cda_max,
                currentParameters.crr_min,
                currentParameters.crr_max,
                currentParameters.wind_speed,
                currentParameters.wind_direction,
                currentParameters.velodrome
            );

            // Store calculator2 globally for air speed calibration (it has the air_speed data)
            _veCalculator = calculator2;

            const result1 = calculator1.calculate_virtual_elevation(cda, crr, trimStart, trimEnd);
            const result2 = calculator2.calculate_virtual_elevation(cda, crr, trimStart, trimEnd);

            // Store first result globally for save functionality (use constant wind result)
            currentVEResult = {
                virtual_elevation: Array.from(result1.virtual_elevation),
                virtual_slope: Array.from(result1.virtual_slope || []),
                acceleration: Array.from(result1.acceleration || []),
                effective_wind: Array.from(result1.effective_wind || []),
                apparent_velocity: Array.from(result1.apparent_velocity || []),
                r2: result1.r2 || 0,
                rmse: result1.rmse || 0,
                ve_elevation_diff: result1.ve_elevation_diff || 0,
                actual_elevation_diff: result1.actual_elevation_diff || 0
            };
            currentWindSource = 'compare';

            // Update metrics to show both
            updateVEMetricsComparison(result1, result2);

            // Use zero altitude for plotting if velodrome mode is enabled
            const plotAltitude = currentParameters.velodrome
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
                console.log('Using constant wind - wind_speed array filled with NaN');
                console.log('Wind speed param:', currentParameters.wind_speed ?? 0, 'Wind direction:', currentParameters.wind_direction ?? 0);
            } else {
                // Use FIT file wind data
                // Apply time offset first (to sync with ground speed)
                const windSpeedOffset = currentParameters?.air_speed_offset ?? defaultAirSpeedOffset;
                useWindSpeed = applyAirSpeedOffset(windSpeed, windSpeedOffset);
                console.log('Using FIT wind data with offset:', windSpeedOffset, 'seconds');
                console.log('Sample offset wind_speed values:', useWindSpeed.slice(0, 5));
                console.log('Non-zero wind_speed count:', useWindSpeed.filter(v => !isNaN(v) && v !== 0).length);
            }

            // Debug altitude data AND velodrome parameter before passing to calculator
            console.log('Altitude data being passed to calculator:', {
                length: altitude.length,
                allZeros: altitude.every(v => v === 0),
                allNaN: altitude.every(v => isNaN(v)),
                samples: [altitude[0], altitude[Math.floor(altitude.length/2)], altitude[altitude.length-1]],
                trimStartValue: altitude[trimStart],
                trimEndValue: altitude[trimEnd],
                expectedDiff: altitude[trimEnd] - altitude[trimStart]
            });
            console.log('VELODROME PARAMETER:', currentParameters.velodrome, 'Type:', typeof currentParameters.velodrome);

            // Apply wind speed calibration if set (after offset)
            const calibratedWindSpeed = airSpeedCalibrationPercent !== 0
                ? useWindSpeed.map(speed => speed * (1.0 + airSpeedCalibrationPercent / 100.0))
                : useWindSpeed;

            // Use rho array version if we have per-datapoint rho
            const calculator = currentRhoArray
                ? create_ve_calculator_with_rho_array(
                    new Float64Array(timestamps),
                    new Float64Array(power),
                    new Float64Array(velocity),
                    new Float64Array(positionLat),
                    new Float64Array(positionLong),
                    new Float64Array(altitude),
                    new Float64Array(distance),
                    new Float64Array(calibratedWindSpeed),
                    new Float64Array(currentRhoArray),
                    currentParameters!.system_mass,
                    currentParameters!.rho,
                    currentParameters!.eta,
                    cda,
                    crr,
                    currentParameters!.cda_min,
                    currentParameters!.cda_max,
                    currentParameters!.crr_min,
                    currentParameters!.crr_max,
                    currentParameters!.wind_speed,
                    currentParameters!.wind_direction,
                    currentParameters!.velodrome
                )
                : create_ve_calculator(
                    new Float64Array(timestamps),
                    new Float64Array(power),
                    new Float64Array(velocity),
                    new Float64Array(positionLat),
                    new Float64Array(positionLong),
                    new Float64Array(altitude),
                    new Float64Array(distance),
                    new Float64Array(calibratedWindSpeed),
                    currentParameters!.system_mass,
                    currentParameters!.rho,
                    currentParameters!.eta,
                    cda,
                    crr,
                    currentParameters!.cda_min,
                    currentParameters!.cda_max,
                    currentParameters!.crr_min,
                    currentParameters!.crr_max,
                    currentParameters!.wind_speed,
                    currentParameters!.wind_direction,
                    currentParameters!.velodrome
                );

            // Store calculator globally for air speed calibration
            _veCalculator = calculator;

            const result = calculator.calculate_virtual_elevation(cda, crr, trimStart, trimEnd);

            console.log('VE calculation result:', {
                r2: result.r2,
                rmse: result.rmse,
                veGain: result.ve_elevation_diff,
                actualGain: result.actual_elevation_diff,
                windSource: windSource
            });

            // Store result globally for save functionality
            currentVEResult = result;
            currentWindSource = windSource as 'constant' | 'fit' | 'compare' | 'none';

            // Update metrics
            updateVEMetrics(result);

            // Use zero altitude for plotting if velodrome mode is enabled
            const plotAltitude = currentParameters.velodrome
                ? new Array(altitude.length).fill(0)
                : altitude;

            // Create plots with Plotly.js
            createVirtualElevationPlots(trimStart, trimEnd, result.virtual_elevation, plotAltitude);

            // Update CdA validation plots if CdA reference data is available
            if (currentCdaReference) {
                await updateCdaValidationPlots(
                    timestamps, power, velocity, positionLat, positionLong, altitude, distance,
                    calibratedWindSpeed,
                    cda, crr, trimStart, trimEnd, result
                );
            }
        }

    } catch (error) {
        console.error('Error updating VE plots with wind source:', error);
    }
}

/**
 * Update VE plots for GPS lap mode - calculates VE for each lap and shows stacked plot
 */
async function updateGpsLapVEPlots(cda: number, crr: number, _windSource: string) {
    if (!currentFitData || !currentGpsLapIndexRanges || !currentParameters) {
        console.error('Missing data for GPS lap VE update');
        return;
    }

    const Plotly = await waitForPlotly();

    // Extract arrays from currentFitData
    const allTimestamps = Array.from(currentFitData.timestamps) as number[];
    const allPower = Array.from(currentFitData.power) as number[];
    const allVelocity = Array.from(currentFitData.velocity) as number[];
    const allPositionLat = Array.from(currentFitData.position_lat) as number[];
    const allPositionLong = Array.from(currentFitData.position_long) as number[];
    const allAltitude = Array.from(currentFitData.altitude) as number[];
    const allDistance = Array.from(currentFitData.distance) as number[];

    // Handle wind/air speed
    const hasAirSpeed = currentFitData.air_speed && Array.from(currentFitData.air_speed).some((v: number) => !isNaN(v) && v !== 0);
    const hasWindSpeed = currentFitData.wind_speed && Array.from(currentFitData.wind_speed).some((v: number) => !isNaN(v) && v !== 0);
    let allWindSpeed: number[];

    if (hasAirSpeed) {
        const rawYaw = currentFitData.wind_yaw || new Array(currentFitData.air_speed.length).fill(0);
        allWindSpeed = Array.from(currentFitData.air_speed).map((magnitude: number, i: number) => {
            const yaw = rawYaw[i] || 0;
            return Math.cos(yaw * Math.PI / 180) * magnitude;
        });
    } else if (hasWindSpeed) {
        const rawYaw = currentFitData.wind_yaw || new Array(currentFitData.wind_speed.length).fill(0);
        allWindSpeed = Array.from(currentFitData.wind_speed).map((magnitude: number, i: number) => {
            const yaw = rawYaw[i] || 0;
            return Math.cos(yaw * Math.PI / 180) * magnitude;
        });
    } else {
        allWindSpeed = new Array(allTimestamps.length).fill(0);
    }

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
    for (let lapIdx = 0; lapIdx < currentGpsLapIndexRanges.length; lapIdx++) {
        const range = currentGpsLapIndexRanges[lapIdx];
        const lapNumber = gpsDetectedLaps[lapIdx]?.lapNumber ?? (lapIdx + 1);

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
            console.warn(`Lap ${lapNumber} has too few data points (${lapTimestamps.length}), skipping`);
            continue;
        }

        // Make distances relative to lap start (0 at gate crossing)
        const startDistance = lapDistance[0];
        const relativeDistances = lapDistance.map(d => (d - startDistance) / 1000); // Convert to km

        // Calculate duration
        const duration = lapTimestamps[lapTimestamps.length - 1] - lapTimestamps[0];
        const totalDistance = relativeDistances[relativeDistances.length - 1];

        try {
            // Create VE calculator for this lap
            const calculator = create_ve_calculator(
                lapTimestamps,
                lapPower,
                lapVelocity,
                lapPositionLat,
                lapPositionLong,
                lapAltitude,
                lapDistance,
                lapWindSpeed,
                currentParameters.system_mass,
                currentParameters.rho,
                currentParameters.eta,
                cda,
                crr,
                currentParameters.cda_min,
                currentParameters.cda_max,
                currentParameters.crr_min,
                currentParameters.crr_max,
                currentParameters.wind_speed,
                currentParameters.wind_direction,
                currentParameters.velodrome
            );

            // Calculate VE for full lap
            const result = calculator.calculate_virtual_elevation(cda, crr, 0, lapTimestamps.length - 1);

            // Extract VE values
            const veArray = Array.from(result.virtual_elevation as Float64Array);

            // Get actual elevation (use zeros for velodrome mode)
            const actualElevation = currentParameters.velodrome
                ? new Array(lapAltitude.length).fill(0)
                : lapAltitude;

            lapVEProfiles.push({
                lapNumber,
                distances: relativeDistances,
                virtualElevation: veArray,
                actualElevation: actualElevation,
                duration,
                totalDistance
            });

        } catch (err) {
            console.error(`Failed to calculate VE for lap ${lapNumber}:`, err);
        }
    }

    if (lapVEProfiles.length === 0) {
        console.error('No valid laps to display');
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
    currentVEResult = {
        r2: stats.meanR2,
        rmse: stats.meanRMSE,
        ve_elevation_diff: stats.avgVeGain,
        actual_elevation_diff: stats.avgActualGain,
        virtual_elevation: new Float64Array(combinedVE),
        virtual_distance_air: 0,
        virtual_distance_ground: 0,
        vd_difference_percent: 0
    };
    currentWindSource = 'none';  // GPS lap mode doesn't use wind tabs

    // Store filtered data globally for save functionality (combine all lap data)
    const combinedPower: number[] = [];
    const combinedVelocity: number[] = [];
    const combinedTimestamps: number[] = [];
    const combinedTemperature: number[] = [];

    for (const range of currentGpsLapIndexRanges!) {
        for (let i = range.startIdx; i <= range.endIdx && i < allTimestamps.length; i++) {
            combinedPower.push(allPower[i]);
            combinedVelocity.push(allVelocity[i]);
            combinedTimestamps.push(allTimestamps[i]);
            // Temperature may not exist
            if (currentFitData.temperature) {
                combinedTemperature.push(currentFitData.temperature[i] || 0);
            }
        }
    }
    currentFilteredData = {
        power: combinedPower,
        velocity: combinedVelocity,
        timestamps: combinedTimestamps,
        temperature: combinedTemperature
    };

    // Store analyzed laps (GPS lap numbers)
    currentAnalyzedLaps = lapVEProfiles.map(lap => lap.lapNumber);

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

    console.log(`GPS Lap VE plots updated with ${lapVEProfiles.length} laps, CdA=${cda.toFixed(3)}, Crr=${crr.toFixed(4)}`);
}

// ==================== Out and Back VE Analysis ====================

interface OutAndBackVEProfile {
    sectionNumber: number;
    outboundDistances: number[];      // km, relative to gate A
    outboundVE: number[];
    outboundActualElevation: number[];
    inboundDistances: number[];       // km, relative to gate B (will be mirrored)
    inboundVE: number[];
    inboundActualElevation: number[];
    outboundDuration: number;
    inboundDuration: number;
    totalDistance: number;
}

// Store Out and Back profiles globally for recalculation
let currentOutAndBackProfiles: OutAndBackVEProfile[] = [];
let currentOutAndBackSections: OutAndBackSection[] = [];

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

    currentOutAndBackSections = sections;
    const profiles: OutAndBackVEProfile[] = [];

    // Extract arrays from fitData
    const allTimestamps = Array.from(fitData.timestamps) as number[];
    const allPower = Array.from(fitData.power) as number[];
    const allVelocity = Array.from(fitData.velocity) as number[];
    const allPositionLat = Array.from(fitData.position_lat) as number[];
    const allPositionLong = Array.from(fitData.position_long) as number[];
    const allAltitude = Array.from(fitData.altitude) as number[];
    const allDistance = Array.from(fitData.distance) as number[];

    // Handle wind/air speed
    const hasAirSpeed = fitData.air_speed && Array.from(fitData.air_speed).some((v: number) => !isNaN(v) && v !== 0);
    const hasWindSpeed = fitData.wind_speed && Array.from(fitData.wind_speed).some((v: number) => !isNaN(v) && v !== 0);

    // Check wind source selection (if UI exists)
    const windSourceRadio = document.querySelector('input[name="windSource"]:checked') as HTMLInputElement;
    const selectedWindSource = windSourceRadio ? windSourceRadio.value : (hasAirSpeed || hasWindSpeed ? 'fit' : 'constant');

    let allWindSpeed: number[];

    if (selectedWindSource === 'constant') {
        // Use constant wind - fill with NaN so calculator uses constant wind settings
        allWindSpeed = new Array(allTimestamps.length).fill(NaN);
        console.log('Out and Back VE: Using constant wind settings');
    } else if (hasAirSpeed) {
        const rawYaw = fitData.wind_yaw || new Array(fitData.air_speed.length).fill(0);
        let baseWindSpeed = Array.from(fitData.air_speed).map((magnitude: number, i: number) => {
            const yaw = rawYaw[i] || 0;
            return Math.cos(yaw * Math.PI / 180) * magnitude;
        });
        // Apply time offset
        const windSpeedOffset = params?.air_speed_offset ?? defaultAirSpeedOffset;
        baseWindSpeed = applyAirSpeedOffset(baseWindSpeed, windSpeedOffset);
        // Apply calibration if set
        allWindSpeed = airSpeedCalibrationPercent !== 0
            ? baseWindSpeed.map(speed => speed * (1.0 + airSpeedCalibrationPercent / 100.0))
            : baseWindSpeed;
        console.log(`Out and Back VE: Using FIT air speed data (offset: ${windSpeedOffset}s, calibration: ${airSpeedCalibrationPercent}%)`);
    } else if (hasWindSpeed) {
        const rawYaw = fitData.wind_yaw || new Array(fitData.wind_speed.length).fill(0);
        let baseWindSpeed = Array.from(fitData.wind_speed).map((magnitude: number, i: number) => {
            const yaw = rawYaw[i] || 0;
            return Math.cos(yaw * Math.PI / 180) * magnitude;
        });
        // Apply time offset
        const windSpeedOffset = params?.air_speed_offset ?? defaultAirSpeedOffset;
        baseWindSpeed = applyAirSpeedOffset(baseWindSpeed, windSpeedOffset);
        // Apply calibration if set
        allWindSpeed = airSpeedCalibrationPercent !== 0
            ? baseWindSpeed.map(speed => speed * (1.0 + airSpeedCalibrationPercent / 100.0))
            : baseWindSpeed;
        console.log(`Out and Back VE: Using FIT wind speed data (offset: ${windSpeedOffset}s, calibration: ${airSpeedCalibrationPercent}%)`);
    } else {
        allWindSpeed = new Array(allTimestamps.length).fill(0);
        console.log('Out and Back VE: No wind data available');
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
            inboundDistances: [],
            inboundVE: [],
            inboundActualElevation: [],
            outboundDuration: section.outboundDuration,
            inboundDuration: section.inboundDuration,
            totalDistance: section.totalDistance
        };

        // Process outbound segment (A → B)
        try {
            const outboundData = extractSegmentData(
                section.outboundStartIdx, section.outboundEndIdx,
                allTimestamps, allPower, allVelocity, allPositionLat, allPositionLong,
                allAltitude, allDistance, allWindSpeed
            );

            if (outboundData.timestamps.length >= 10) {
                const calculator = create_ve_calculator(
                    new Float64Array(outboundData.timestamps),
                    new Float64Array(outboundData.power),
                    new Float64Array(outboundData.velocity),
                    new Float64Array(outboundData.positionLat),
                    new Float64Array(outboundData.positionLong),
                    new Float64Array(outboundData.altitude),
                    new Float64Array(outboundData.distance),
                    new Float64Array(outboundData.windSpeed),
                    params.system_mass, params.rho, params.eta,
                    cda, crr, params.cda_min, params.cda_max, params.crr_min, params.crr_max,
                    params.wind_speed, params.wind_direction, params.velodrome
                );

                const result = calculator.calculate_virtual_elevation(cda, crr, 0, outboundData.timestamps.length - 1);
                const veArray = Array.from(result.virtual_elevation as Float64Array);

                // Make distances relative to start
                const startDist = outboundData.distance[0];
                profile.outboundDistances = outboundData.distance.map(d => (d - startDist) / 1000);
                profile.outboundVE = veArray;
                profile.outboundActualElevation = params.velodrome
                    ? new Array(outboundData.altitude.length).fill(0)
                    : [...outboundData.altitude];
            }
        } catch (err) {
            console.error(`Failed to calculate outbound VE for section ${section.sectionNumber}:`, err);
        }

        // Process inbound segment (B → A)
        try {
            const inboundData = extractSegmentData(
                section.inboundStartIdx, section.inboundEndIdx,
                allTimestamps, allPower, allVelocity, allPositionLat, allPositionLong,
                allAltitude, allDistance, allWindSpeed
            );

            if (inboundData.timestamps.length >= 10) {
                const calculator = create_ve_calculator(
                    new Float64Array(inboundData.timestamps),
                    new Float64Array(inboundData.power),
                    new Float64Array(inboundData.velocity),
                    new Float64Array(inboundData.positionLat),
                    new Float64Array(inboundData.positionLong),
                    new Float64Array(inboundData.altitude),
                    new Float64Array(inboundData.distance),
                    new Float64Array(inboundData.windSpeed),
                    params.system_mass, params.rho, params.eta,
                    cda, crr, params.cda_min, params.cda_max, params.crr_min, params.crr_max,
                    params.wind_speed, params.wind_direction, params.velodrome
                );

                const result = calculator.calculate_virtual_elevation(cda, crr, 0, inboundData.timestamps.length - 1);
                const veArray = Array.from(result.virtual_elevation as Float64Array);

                // Make distances relative to start
                const startDist = inboundData.distance[0];
                profile.inboundDistances = inboundData.distance.map(d => (d - startDist) / 1000);
                profile.inboundVE = veArray;
                profile.inboundActualElevation = params.velodrome
                    ? new Array(inboundData.altitude.length).fill(0)
                    : [...inboundData.altitude];
            }
        } catch (err) {
            console.error(`Failed to calculate inbound VE for section ${section.sectionNumber}:`, err);
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

    currentOutAndBackProfiles = profiles;

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
function extractSegmentData(
    startIdx: number, endIdx: number,
    allTimestamps: number[], allPower: number[], allVelocity: number[],
    allPositionLat: number[], allPositionLong: number[],
    allAltitude: number[], allDistance: number[], allWindSpeed: number[]
): {
    timestamps: number[]; power: number[]; velocity: number[];
    positionLat: number[]; positionLong: number[];
    altitude: number[]; distance: number[]; windSpeed: number[];
} {
    const timestamps: number[] = [];
    const power: number[] = [];
    const velocity: number[] = [];
    const positionLat: number[] = [];
    const positionLong: number[] = [];
    const altitude: number[] = [];
    const distance: number[] = [];
    const windSpeed: number[] = [];

    for (let i = startIdx; i <= endIdx && i < allTimestamps.length; i++) {
        timestamps.push(allTimestamps[i]);
        power.push(allPower[i]);
        velocity.push(allVelocity[i]);
        positionLat.push(allPositionLat[i]);
        positionLong.push(allPositionLong[i]);
        altitude.push(allAltitude[i]);
        distance.push(allDistance[i]);
        windSpeed.push(allWindSpeed[i]);
    }

    return { timestamps, power, velocity, positionLat, positionLong, altitude, distance, windSpeed };
}

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
    // Determine which wind source should be selected
    // If preservedWindSource is provided, use it; otherwise use default based on data availability
    const selectedWindSource = preservedWindSource || (hasWindSpeed ? 'fit' : 'constant');

    const Plotly = await waitForPlotly();

    // Show the VE analysis section
    const veSection = document.getElementById('veAnalysisSection') as HTMLElement;
    if (veSection) {
        veSection.classList.remove('hidden', 'inactive');
    }

    const veAnalysisContent = document.getElementById('veAnalysisContent') as HTMLElement;
    if (!veAnalysisContent) {
        console.error('VE analysis content container not found');
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

                        ${(hasWindSpeed || hasConstantWind) ? `
                        <div class="ve-tab-content" id="wind-tab">
                            <div id="oabWindPlot" class="ve-plot" style="height: 600px;"></div>
                            ${hasWindSpeed ? `
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

                        ${hasWindSpeed ? `
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
    setupOutAndBackTabSwitching(profiles, hasWindSpeed, hasConstantWind);

    // Setup wind source radio button listeners
    const windSourceRadios = document.querySelectorAll('input[name="windSource"]');
    windSourceRadios.forEach(radio => {
        radio.addEventListener('change', () => {
            console.log('Wind source changed - triggering Out and Back VE recalculation');
            const cda = parseFloat((document.getElementById('cdaValue') as HTMLInputElement)?.value || '0.3');
            const crr = parseFloat((document.getElementById('crrValue') as HTMLInputElement)?.value || '0.008');
            updateOutAndBackVEPlots(cda, crr);
        });
    });

    // Setup air speed calibration listeners
    const airSpeedCalibrationSlider = document.getElementById('airSpeedCalibrationSlider') as HTMLInputElement;
    const airSpeedCalibrationValueEl = document.getElementById('airSpeedCalibrationValue') as HTMLInputElement;

    if (airSpeedCalibrationSlider && airSpeedCalibrationValueEl) {
        const updateAirSpeedCalibration = () => {
            const value = parseFloat(airSpeedCalibrationSlider.value);
            airSpeedCalibrationValueEl.value = value.toFixed(1);
            airSpeedCalibrationPercent = value;
            console.log('Air speed calibration changed - triggering Out and Back VE recalculation');
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
            airSpeedCalibrationPercent = clamped;
            console.log('Air speed calibration changed - triggering Out and Back VE recalculation');
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
                console.log('Auto-adjust clicked for Out and Back mode');
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
function setupOutAndBackTabSwitching(profiles: OutAndBackVEProfile[], hasWindSpeed: boolean, hasConstantWind: boolean) {
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
            if (tabName === 'wind' && (hasWindSpeed || hasConstantWind)) {
                renderOutAndBackWindPlot(profiles);
            } else if (tabName === 'power') {
                renderOutAndBackPowerPlot(profiles);
            } else if (tabName === 'vd' && hasWindSpeed) {
                renderOutAndBackVdPlot(profiles);
            }
        });
    });
}

/**
 * Render stacked Wind plot for Out and Back mode
 */
function renderOutAndBackWindPlot(_profiles: OutAndBackVEProfile[]) {
    const Plotly = (window as any).Plotly;
    if (!Plotly) return;

    const plotDiv = document.getElementById('oabWindPlot');
    if (!plotDiv) return;

    // Placeholder for stacked wind plots
    const layout = {
        title: 'Wind Speed by Section',
        xaxis: { title: 'Distance (km)' },
        yaxis: { title: 'Wind Speed (m/s)' },
        showlegend: true,
        margin: { t: 40, r: 20, b: 50, l: 60 }
    };

    Plotly.newPlot('oabWindPlot', [], layout, { responsive: true });
}

/**
 * Render stacked Power plot for Out and Back mode
 */
function renderOutAndBackPowerPlot(_profiles: OutAndBackVEProfile[]) {
    const Plotly = (window as any).Plotly;
    if (!Plotly) return;

    const plotDiv = document.getElementById('oabPowerPlot');
    if (!plotDiv) return;

    // Placeholder for stacked power plots
    const layout = {
        title: 'Power by Section',
        xaxis: { title: 'Distance (km)' },
        yaxis: { title: 'Power (W)' },
        showlegend: true,
        margin: { t: 40, r: 20, b: 50, l: 60 }
    };

    Plotly.newPlot('oabPowerPlot', [], layout, { responsive: true });
}

/**
 * Render stacked VD plot for Out and Back mode
 */
function renderOutAndBackVdPlot(_profiles: OutAndBackVEProfile[]) {
    const Plotly = (window as any).Plotly;
    if (!Plotly) return;

    const plotDiv = document.getElementById('oabVdPlot');
    if (!plotDiv) return;

    // Placeholder for stacked VD plots
    const layout = {
        title: 'Virtual Distance by Section',
        xaxis: { title: 'Distance (km)' },
        yaxis: { title: 'Virtual Distance (km)' },
        showlegend: true,
        margin: { t: 40, r: 20, b: 50, l: 60 }
    };

    Plotly.newPlot('oabVdPlot', [], layout, { responsive: true });
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
        console.error('Failed to save screenshot:', err);
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
    if (!currentFitData || !currentOutAndBackSections || currentOutAndBackSections.length === 0 || !currentParameters) {
        console.error('Missing data for Out and Back VE update');
        return;
    }

    const Plotly = await waitForPlotly();

    // Recalculate VE for all sections
    const profiles: OutAndBackVEProfile[] = [];

    // Extract arrays from currentFitData
    const allTimestamps = Array.from(currentFitData.timestamps) as number[];
    const allPower = Array.from(currentFitData.power) as number[];
    const allVelocity = Array.from(currentFitData.velocity) as number[];
    const allPositionLat = Array.from(currentFitData.position_lat) as number[];
    const allPositionLong = Array.from(currentFitData.position_long) as number[];
    const allAltitude = Array.from(currentFitData.altitude) as number[];
    const allDistance = Array.from(currentFitData.distance) as number[];

    // Handle wind/air speed - check wind source selection
    const hasAirSpeed = currentFitData.air_speed && Array.from(currentFitData.air_speed).some((v: number) => !isNaN(v) && v !== 0);
    const hasWindSpeed = currentFitData.wind_speed && Array.from(currentFitData.wind_speed).some((v: number) => !isNaN(v) && v !== 0);

    // Check wind source selection
    const windSourceRadio = document.querySelector('input[name="windSource"]:checked') as HTMLInputElement;
    const selectedWindSource = windSourceRadio ? windSourceRadio.value : (hasAirSpeed || hasWindSpeed ? 'fit' : 'constant');

    let allWindSpeed: number[];

    if (selectedWindSource === 'constant') {
        // Use constant wind - fill with NaN so calculator uses constant wind settings
        allWindSpeed = new Array(allTimestamps.length).fill(NaN);
        console.log('Out and Back VE update: Using constant wind settings');
    } else if (hasAirSpeed) {
        const rawYaw = currentFitData.wind_yaw || new Array(currentFitData.air_speed.length).fill(0);
        let baseWindSpeed = Array.from(currentFitData.air_speed).map((magnitude: number, i: number) => {
            const yaw = rawYaw[i] || 0;
            return Math.cos(yaw * Math.PI / 180) * magnitude;
        });
        // Apply time offset
        const windSpeedOffset = currentParameters?.air_speed_offset ?? 2;
        baseWindSpeed = applyAirSpeedOffset(baseWindSpeed, windSpeedOffset);
        // Apply calibration if set
        allWindSpeed = airSpeedCalibrationPercent !== 0
            ? baseWindSpeed.map(speed => speed * (1.0 + airSpeedCalibrationPercent / 100.0))
            : baseWindSpeed;
        console.log(`Out and Back VE update: Using FIT air speed data (calibration: ${airSpeedCalibrationPercent}%)`);
    } else if (hasWindSpeed) {
        const rawYaw = currentFitData.wind_yaw || new Array(currentFitData.wind_speed.length).fill(0);
        let baseWindSpeed = Array.from(currentFitData.wind_speed).map((magnitude: number, i: number) => {
            const yaw = rawYaw[i] || 0;
            return Math.cos(yaw * Math.PI / 180) * magnitude;
        });
        // Apply time offset
        const windSpeedOffset = currentParameters?.air_speed_offset ?? 2;
        baseWindSpeed = applyAirSpeedOffset(baseWindSpeed, windSpeedOffset);
        // Apply calibration if set
        allWindSpeed = airSpeedCalibrationPercent !== 0
            ? baseWindSpeed.map(speed => speed * (1.0 + airSpeedCalibrationPercent / 100.0))
            : baseWindSpeed;
        console.log(`Out and Back VE update: Using FIT wind speed data (calibration: ${airSpeedCalibrationPercent}%)`);
    } else {
        allWindSpeed = new Array(allTimestamps.length).fill(0);
        console.log('Out and Back VE update: No wind data available');
    }

    for (const section of currentOutAndBackSections) {
        const profile: OutAndBackVEProfile = {
            sectionNumber: section.sectionNumber,
            outboundDistances: [],
            outboundVE: [],
            outboundActualElevation: [],
            inboundDistances: [],
            inboundVE: [],
            inboundActualElevation: [],
            outboundDuration: section.outboundDuration,
            inboundDuration: section.inboundDuration,
            totalDistance: section.totalDistance
        };

        // Process outbound
        try {
            const outboundData = extractSegmentData(
                section.outboundStartIdx, section.outboundEndIdx,
                allTimestamps, allPower, allVelocity, allPositionLat, allPositionLong,
                allAltitude, allDistance, allWindSpeed
            );

            if (outboundData.timestamps.length >= 10) {
                const calculator = create_ve_calculator(
                    new Float64Array(outboundData.timestamps), new Float64Array(outboundData.power), new Float64Array(outboundData.velocity),
                    new Float64Array(outboundData.positionLat), new Float64Array(outboundData.positionLong), new Float64Array(outboundData.altitude),
                    new Float64Array(outboundData.distance), new Float64Array(outboundData.windSpeed),
                    currentParameters.system_mass, currentParameters.rho, currentParameters.eta,
                    cda, crr, currentParameters.cda_min, currentParameters.cda_max,
                    currentParameters.crr_min, currentParameters.crr_max,
                    currentParameters.wind_speed, currentParameters.wind_direction, currentParameters.velodrome
                );

                const result = calculator.calculate_virtual_elevation(cda, crr, 0, outboundData.timestamps.length - 1);
                const veArray = Array.from(result.virtual_elevation as Float64Array);

                const startDist = outboundData.distance[0];
                profile.outboundDistances = outboundData.distance.map(d => (d - startDist) / 1000);
                profile.outboundVE = veArray;
                profile.outboundActualElevation = currentParameters.velodrome
                    ? new Array(outboundData.altitude.length).fill(0)
                    : [...outboundData.altitude];
            }
        } catch (err) {
            console.error(`Failed to calculate outbound VE for section ${section.sectionNumber}:`, err);
        }

        // Process inbound
        try {
            const inboundData = extractSegmentData(
                section.inboundStartIdx, section.inboundEndIdx,
                allTimestamps, allPower, allVelocity, allPositionLat, allPositionLong,
                allAltitude, allDistance, allWindSpeed
            );

            if (inboundData.timestamps.length >= 10) {
                const calculator = create_ve_calculator(
                    new Float64Array(inboundData.timestamps), new Float64Array(inboundData.power), new Float64Array(inboundData.velocity),
                    new Float64Array(inboundData.positionLat), new Float64Array(inboundData.positionLong), new Float64Array(inboundData.altitude),
                    new Float64Array(inboundData.distance), new Float64Array(inboundData.windSpeed),
                    currentParameters.system_mass, currentParameters.rho, currentParameters.eta,
                    cda, crr, currentParameters.cda_min, currentParameters.cda_max,
                    currentParameters.crr_min, currentParameters.crr_max,
                    currentParameters.wind_speed, currentParameters.wind_direction, currentParameters.velodrome
                );

                const result = calculator.calculate_virtual_elevation(cda, crr, 0, inboundData.timestamps.length - 1);
                const veArray = Array.from(result.virtual_elevation as Float64Array);

                const startDist = inboundData.distance[0];
                profile.inboundDistances = inboundData.distance.map(d => (d - startDist) / 1000);
                profile.inboundVE = veArray;
                profile.inboundActualElevation = currentParameters.velodrome
                    ? new Array(inboundData.altitude.length).fill(0)
                    : [...inboundData.altitude];
            }
        } catch (err) {
            console.error(`Failed to calculate inbound VE for section ${section.sectionNumber}:`, err);
        }

        if (profile.outboundVE.length > 0 || profile.inboundVE.length > 0) {
            profiles.push(profile);
        }
    }

    if (profiles.length === 0) {
        console.error('No valid sections to display');
        return;
    }

    currentOutAndBackProfiles = profiles;

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

    console.log(`Out and Back VE plots updated with ${profiles.length} sections, CdA=${cda.toFixed(3)}, Crr=${crr.toFixed(4)}`);
}

async function createVirtualElevationPlots(trimStart: number, trimEnd: number, virtualElevation: number[], actualElevation: number[]) {
    console.log('Creating VE plots:', {
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
        console.error('Failed to load Plotly:', error);
        // Show error message in plot divs
        const vePlotDiv = document.getElementById('vePlot');
        const residualsPlotDiv = document.getElementById('veResidualsPlot');
        if (vePlotDiv) vePlotDiv.innerHTML = '<p style="text-align: center; padding: 50px; color: #e74c3c;">Plotly failed to load. Please check your internet connection.</p>';
        if (residualsPlotDiv) residualsPlotDiv.innerHTML = '<p style="text-align: center; padding: 50px; color: #e74c3c;">Plotly failed to load. Please check your internet connection.</p>';
        return;
    }

    // Calculate context range (+/- 5s, but limited by actual trim)
    const contextBefore = Math.min(trimStart, 5);
    const contextAfter = Math.min(virtualElevation.length - 1 - trimEnd, 5);

    // Extended range including context
    const extendedStart = trimStart - contextBefore;
    const extendedEnd = trimEnd + 1 + contextAfter; // +1 because trimEnd is now inclusive

    // Create distance array for x-axis (simplified as time points)
    const timePoints = Array.from({length: trimEnd - trimStart + 1}, (_, i) => i + trimStart);
    // Include boundary points to avoid gaps
    const timePointsBefore = contextBefore > 0 ? Array.from({length: contextBefore + 1}, (_, i) => i + extendedStart) : [];
    const timePointsAfter = contextAfter > 0 ? Array.from({length: contextAfter + 1}, (_, i) => i + trimEnd) : [];

    // Trim the data arrays - trimEnd is inclusive, so slice to trimEnd + 1
    const trimmedVirtualElevation = virtualElevation.slice(trimStart, trimEnd + 1);
    const trimmedActualElevation = actualElevation.slice(trimStart, trimEnd + 1);

    // Context data (before and after) - include boundary points
    const contextVirtualBefore = contextBefore > 0 ? virtualElevation.slice(extendedStart, trimStart + 1) : [];
    const contextActualBefore = contextBefore > 0 ? actualElevation.slice(extendedStart, trimStart + 1) : [];
    const contextVirtualAfter = contextAfter > 0 ? virtualElevation.slice(trimEnd, extendedEnd) : [];
    const contextActualAfter = contextAfter > 0 ? actualElevation.slice(trimEnd, extendedEnd) : [];

    // Offset virtual elevation to start at the same point as actual elevation
    const veOffset = trimmedActualElevation[0] - trimmedVirtualElevation[0];
    const offsetVirtualElevation = Array.from(trimmedVirtualElevation).map(ve => ve + veOffset);
    const offsetContextVirtualBefore = Array.from(contextVirtualBefore).map(ve => ve + veOffset);
    const offsetContextVirtualAfter = Array.from(contextVirtualAfter).map(ve => ve + veOffset);

    // Create elevation profile plot
    const elevationPlotData = [];

    // Add context before trim (low opacity)
    if (contextBefore > 0) {
        elevationPlotData.push({
            x: timePointsBefore,
            y: offsetContextVirtualBefore,
            type: 'scatter',
            mode: 'lines',
            name: 'VE (trimmed)',
            line: { color: '#4363d8', width: 2 },
            opacity: 0.2,
            showlegend: false
        });
        elevationPlotData.push({
            x: timePointsBefore,
            y: Array.from(contextActualBefore),
            type: 'scatter',
            mode: 'lines',
            name: 'Actual (trimmed)',
            line: { color: '#000000', width: 2 },
            opacity: 0.2,
            showlegend: false
        });
    }

    // Main trimmed data (full opacity)
    elevationPlotData.push({
        x: timePoints,
        y: offsetVirtualElevation,
        type: 'scatter',
        mode: 'lines',
        name: 'Virtual Elevation',
        line: { color: '#4363d8', width: 2 }
    });
    elevationPlotData.push({
        x: timePoints,
        y: trimmedActualElevation,
        type: 'scatter',
        mode: 'lines',
        name: 'Actual Elevation',
        line: { color: '#000000', width: 2 }
    });

    // Add context after trim (low opacity)
    if (contextAfter > 0) {
        elevationPlotData.push({
            x: timePointsAfter,
            y: offsetContextVirtualAfter,
            type: 'scatter',
            mode: 'lines',
            name: 'VE (trimmed)',
            line: { color: '#4363d8', width: 2 },
            opacity: 0.2,
            showlegend: false
        });
        elevationPlotData.push({
            x: timePointsAfter,
            y: Array.from(contextActualAfter),
            type: 'scatter',
            mode: 'lines',
            name: 'Actual (trimmed)',
            line: { color: '#000000', width: 2 },
            opacity: 0.2,
            showlegend: false
        });
    }

    // Calculate shared x-axis range (trim region + context)
    const xMin = extendedStart;
    const xMax = extendedEnd - 1;

    // Get current CdA and Crr values for annotation
    const cdaSlider = document.getElementById('cdaSlider') as HTMLInputElement;
    const crrSlider = document.getElementById('crrSlider') as HTMLInputElement;
    const cdaValue = cdaSlider ? parseFloat(cdaSlider.value).toFixed(3) : '0.300';
    const crrValue = crrSlider ? parseFloat(crrSlider.value).toFixed(4) : '0.0050';

    // Find optimal annotation position to avoid blocking plot content and legend
    const findOptimalAnnotationPosition = (elevationData: number[], timeData: number[]): { x: number, y: number, xanchor: string, yanchor: string } => {
        if (elevationData.length === 0) {
            return { x: 0.98, y: 0.98, xanchor: 'right', yanchor: 'top' };
        }

        const minElev = Math.min(...elevationData);
        const maxElev = Math.max(...elevationData);
        const elevRange = maxElev - minElev;
        const minTime = Math.min(...timeData);
        const maxTime = Math.max(...timeData);
        const timeRange = maxTime - minTime;

        // Define 3 corner regions (excluding top-left where legend is)
        // Each corner is 30% of the range from edges
        const corners = [
            { name: 'top-right', x: 0.98, y: 0.98, xanchor: 'right', yanchor: 'top',
              timeMin: minTime + 0.7 * timeRange, timeMax: maxTime,
              elevMin: minElev + 0.7 * elevRange, elevMax: maxElev },
            { name: 'bottom-right', x: 0.98, y: 0.02, xanchor: 'right', yanchor: 'bottom',
              timeMin: minTime + 0.7 * timeRange, timeMax: maxTime,
              elevMin: minElev, elevMax: minElev + 0.3 * elevRange },
            { name: 'bottom-left', x: 0.02, y: 0.02, xanchor: 'left', yanchor: 'bottom',
              timeMin: minTime, timeMax: minTime + 0.3 * timeRange,
              elevMin: minElev, elevMax: minElev + 0.3 * elevRange }
            // Top-left excluded because legend is there
        ];

        // Count data points in each corner region
        const cornerScores = corners.map(corner => {
            let pointsInCorner = 0;
            for (let i = 0; i < elevationData.length; i++) {
                if (timeData[i] >= corner.timeMin && timeData[i] <= corner.timeMax &&
                    elevationData[i] >= corner.elevMin && elevationData[i] <= corner.elevMax) {
                    pointsInCorner++;
                }
            }
            return { ...corner, score: pointsInCorner };
        });

        // Find corner with fewest data points
        const bestCorner = cornerScores.reduce((best, current) =>
            current.score < best.score ? current : best
        );

        return {
            x: bestCorner.x,
            y: bestCorner.y,
            xanchor: bestCorner.xanchor,
            yanchor: bestCorner.yanchor
        };
    };

    // Combine all elevation data for analysis (prioritize main data over context)
    const allElevationData = [...offsetVirtualElevation, ...trimmedActualElevation];
    const allTimeData = [...timePoints, ...timePoints];
    const annotationPos = findOptimalAnnotationPosition(allElevationData, allTimeData);

    const elevationPlotLayout = {
        title: {
            text: 'Virtual vs Actual Elevation Profile',
            font: { size: 14 }
        },
        xaxis: {
            title: '',  // Remove x-axis title from top plot
            showgrid: true,
            gridcolor: '#e0e0e0',
            showticklabels: false,  // Hide x-axis labels on top plot
            range: [xMin, xMax]  // Fixed range to match residuals plot
        },
        yaxis: {
            title: 'Elevation (m)',
            showgrid: true,
            gridcolor: '#e0e0e0'
        },
        legend: {
            x: 0.02,
            y: 0.98,
            bgcolor: 'rgba(255,255,255,0.8)'
        },
        shapes: [
            // Trim start vertical line
            {
                type: 'line',
                x0: trimStart,
                x1: trimStart,
                y0: 0,
                y1: 1,
                yref: 'paper',
                line: {
                    color: 'rgba(100, 100, 100, 0.3)',
                    width: 1.5,
                    dash: 'dash'
                }
            },
            // Trim end vertical line
            {
                type: 'line',
                x0: trimEnd,
                x1: trimEnd,
                y0: 0,
                y1: 1,
                yref: 'paper',
                line: {
                    color: 'rgba(100, 100, 100, 0.3)',
                    width: 1.5,
                    dash: 'dash'
                }
            }
        ],
        annotations: [{
            text: `CdA: ${cdaValue}<br>Crr: ${crrValue}`,
            xref: 'paper',
            yref: 'paper',
            x: annotationPos.x,
            y: annotationPos.y,
            xanchor: annotationPos.xanchor as 'left' | 'right',
            yanchor: annotationPos.yanchor as 'top' | 'bottom',
            showarrow: false,
            bgcolor: 'rgba(255,255,255,0.9)',
            bordercolor: '#4363d8',
            borderwidth: 1,
            borderpad: 6,
            font: {
                size: 12,
                family: 'monospace',
                color: '#2d3748'
            }
        }],
        margin: { l: 60, r: 20, t: 40, b: 5 },  // Reduced bottom margin
        height: 350,  // Fixed height for alignment
        plot_bgcolor: '#fafafa',
        paper_bgcolor: 'white'
    };

    // Create residuals plot (using offset virtual elevation)
    const residuals = offsetVirtualElevation.map((ve, i) => ve - trimmedActualElevation[i]);
    const residualsBefore = contextBefore > 0 ? offsetContextVirtualBefore.map((ve, i) => ve - contextActualBefore[i]) : [];
    const residualsAfter = contextAfter > 0 ? offsetContextVirtualAfter.map((ve, i) => ve - contextActualAfter[i]) : [];

    const residualsPlotData = [];

    // Add context before trim (low opacity)
    if (contextBefore > 0) {
        residualsPlotData.push({
            x: timePointsBefore,
            y: residualsBefore,
            type: 'scatter',
            mode: 'lines',
            name: 'Residuals (trimmed)',
            line: { color: '#4363d8', width: 2 },
            opacity: 0.2,
            showlegend: false
        });
    }

    // Main residuals (full opacity)
    residualsPlotData.push({
        x: timePoints,
        y: residuals,
        type: 'scatter',
        mode: 'lines',
        name: 'VE - Actual',
        line: { color: '#4363d8', width: 2 }
    });

    // Add context after trim (low opacity)
    if (contextAfter > 0) {
        residualsPlotData.push({
            x: timePointsAfter,
            y: residualsAfter,
            type: 'scatter',
            mode: 'lines',
            name: 'Residuals (trimmed)',
            line: { color: '#4363d8', width: 2 },
            opacity: 0.2,
            showlegend: false
        });
    }

    // Zero line
    const allTimePoints = [...timePointsBefore, ...timePoints, ...timePointsAfter];
    if (allTimePoints.length > 0) {
        residualsPlotData.push({
            x: [allTimePoints[0], allTimePoints[allTimePoints.length - 1]],
            y: [0, 0],
            type: 'scatter',
            mode: 'lines',
            name: 'Zero Line',
            line: { color: '#7f8c8d', width: 1, dash: 'dash' },
            showlegend: false
        });
    }

    const residualsPlotLayout = {
        title: {
            text: 'Residuals (Virtual - Actual Elevation)',
            font: { size: 12 }  // Smaller title
        },
        xaxis: {
            title: 'Time (seconds)',
            showgrid: true,
            gridcolor: '#e0e0e0',
            range: [xMin, xMax]  // Same range as elevation plot
        },
        yaxis: {
            title: 'Residuals (m)',  // Shortened title
            showgrid: true,
            gridcolor: '#e0e0e0',
            zeroline: true,
            zerolinecolor: '#7f8c8d',
            zerolinewidth: 1
        },
        legend: {
            x: 0.02,
            y: 0.98,
            bgcolor: 'rgba(255,255,255,0.8)'
        },
        shapes: [
            // Trim start vertical line
            {
                type: 'line',
                x0: trimStart,
                x1: trimStart,
                y0: 0,
                y1: 1,
                yref: 'paper',
                line: {
                    color: 'rgba(100, 100, 100, 0.3)',
                    width: 1.5,
                    dash: 'dash'
                }
            },
            // Trim end vertical line
            {
                type: 'line',
                x0: trimEnd,
                x1: trimEnd,
                y0: 0,
                y1: 1,
                yref: 'paper',
                line: {
                    color: 'rgba(100, 100, 100, 0.3)',
                    width: 1.5,
                    dash: 'dash'
                }
            }
        ],
        margin: { l: 60, r: 20, t: 30, b: 60 },  // Adjusted margins
        height: 200,  // Fixed height for alignment
        plot_bgcolor: '#fafafa',
        paper_bgcolor: 'white'
    };

    // Common plot configuration
    const config = {
        responsive: true,
        displayModeBar: true,
        modeBarButtonsToRemove: ['pan2d', 'lasso2d', 'select2d'],
        displaylogo: false
    };

    // Create the plots
    try {
        const vePlotDiv = document.getElementById('vePlot');
        const residualsPlotDiv = document.getElementById('veResidualsPlot');

        console.log('Plot divs found:', { vePlot: !!vePlotDiv, residualsPlot: !!residualsPlotDiv });
        console.log('Plot data:', {
            elevationPoints: elevationPlotData[0].x.length,
            residualsPoints: residualsPlotData[0].x.length,
            sampleVirtualElevation: trimmedVirtualElevation.slice(0, 5),
            sampleActualElevation: trimmedActualElevation.slice(0, 5)
        });

        if (vePlotDiv && residualsPlotDiv) {
            console.log('Creating elevation plot...');
            await Plotly.newPlot(vePlotDiv, elevationPlotData, elevationPlotLayout, config);
            console.log('Elevation plot created');

            console.log('Creating residuals plot...');
            await Plotly.newPlot(residualsPlotDiv, residualsPlotData, residualsPlotLayout, config);
            console.log('Residuals plot created');

            // Link the x-axes so they zoom/pan together (with guards to prevent infinite loops)
            let isRelayoutInProgress = false;

            vePlotDiv.on('plotly_relayout', (eventData: any) => {
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

            residualsPlotDiv.on('plotly_relayout', (eventData: any) => {
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
            console.error('Plot divs not found!');
        }
    } catch (error) {
        console.error('Error creating plots:', error);
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
    if (!currentCdaReference || !currentParameters) return;

    // Calculate average CdA from reference data for the TRIMMED region (for metrics display)
    const trimmedCdaRef = currentCdaReference.slice(trimStart, trimEnd + 1);
    const validCda = trimmedCdaRef.filter(c => !isNaN(c));
    if (validCda.length === 0) return;

    const avgCdaRef = validCda.reduce((sum, c) => sum + c, 0) / validCda.length;

    // Create calculator for reference CdA calculation
    // Uses SAME air speed/wind data as the slider CdA calculation
    const refCalculator = currentRhoArray
        ? create_ve_calculator_with_rho_array(
            timestamps, power, velocity, positionLat, positionLong, altitude, distance,
            windSpeed,
            new Float64Array(currentRhoArray),
            currentParameters.system_mass, currentParameters.rho, currentParameters.eta,
            currentParameters.cda, crrOptimized,
            currentParameters.cda_min, currentParameters.cda_max,
            currentParameters.crr_min, currentParameters.crr_max,
            currentParameters.wind_speed, currentParameters.wind_direction, currentParameters.velodrome
        )
        : create_ve_calculator(
            timestamps, power, velocity, positionLat, positionLong, altitude, distance,
            windSpeed,
            currentParameters.system_mass, currentParameters.rho, currentParameters.eta,
            currentParameters.cda, crrOptimized,
            currentParameters.cda_min, currentParameters.cda_max,
            currentParameters.crr_min, currentParameters.crr_max,
            currentParameters.wind_speed, currentParameters.wind_direction, currentParameters.velodrome
        );

    // Calculate VE with per-datapoint CdA reference array
    // Pre-process: Replace any NaN values with the average to avoid using default 0.3
    const cleanedCdaRef = currentCdaReference.map(cda => isNaN(cda) ? avgCdaRef : cda);
    const cdaRefArray = new Float64Array(cleanedCdaRef);

    // Debug: Verify we're using per-datapoint CdA, not average
    const nanCount = currentCdaReference.filter(c => isNaN(c)).length;
    console.log('CdA Array Debug:', {
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
        console.error('Error calculating VE with CdA array - WASM method may not exist yet:', error);
        console.error('Please rebuild WASM with: ./build.sh or wasm-pack build backend --target web --out-dir ../frontend/wasm');
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

    console.log('Before offset:', {
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
    console.log('VE Profile Comparison:', {
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

async function createVirtualElevationPlotsComparison(trimStart: number, trimEnd: number, virtualElevation1: number[], virtualElevation2: number[], actualElevation: number[]) {
    // Wait for Plotly to load
    let Plotly;
    try {
        Plotly = await waitForPlotly();
    } catch (error) {
        console.error('Failed to load Plotly:', error);
        const vePlotDiv = document.getElementById('vePlot');
        const residualsPlotDiv = document.getElementById('veResidualsPlot');
        if (vePlotDiv) vePlotDiv.innerHTML = '<p style="text-align: center; padding: 50px; color: #e74c3c;">Plotly failed to load. Please check your internet connection.</p>';
        if (residualsPlotDiv) residualsPlotDiv.innerHTML = '<p style="text-align: center; padding: 50px; color: #e74c3c;">Plotly failed to load. Please check your internet connection.</p>';
        return;
    }

    // Create distance array for x-axis
    const timePoints = Array.from({length: trimEnd - trimStart}, (_, i) => i + trimStart);

    // Trim the data arrays
    const trimmedVirtualElevation1 = virtualElevation1.slice(trimStart, trimEnd);
    const trimmedVirtualElevation2 = virtualElevation2.slice(trimStart, trimEnd);
    const trimmedActualElevation = actualElevation.slice(trimStart, trimEnd);

    // Apply offset to both VE curves to start at the same point as actual elevation
    const veOffset1 = trimmedActualElevation[0] - trimmedVirtualElevation1[0];
    const offsetVirtualElevation1 = Array.from(trimmedVirtualElevation1).map(ve => ve + veOffset1);

    const veOffset2 = trimmedActualElevation[0] - trimmedVirtualElevation2[0];
    const offsetVirtualElevation2 = Array.from(trimmedVirtualElevation2).map(ve => ve + veOffset2);

    // Calculate residuals for both
    const residuals1 = offsetVirtualElevation1.map((ve, i) => ve - trimmedActualElevation[i]);
    const residuals2 = offsetVirtualElevation2.map((ve, i) => ve - trimmedActualElevation[i]);

    // Plot 1: Virtual Elevation Profile (comparison)
    const veTrace2 = {
        x: timePoints,
        y: offsetVirtualElevation2,
        type: 'scatter',
        mode: 'lines',
        name: 'VE (FIT Air Speed)',
        line: { color: '#4363d8', width: 2 }
    };

    const actualTrace = {
        x: timePoints,
        y: Array.from(trimmedActualElevation),
        type: 'scatter',
        mode: 'lines',
        name: 'Actual Elevation',
        line: { color: '#000000', width: 2 }
    };

    const veTrace1 = {
        x: timePoints,
        y: offsetVirtualElevation1,
        type: 'scatter',
        mode: 'lines',
        name: 'VE (Constant Wind)',
        line: { color: '#a9a9a9', width: 2 }
    };

    const veLayout = {
        title: 'Virtual Elevation Comparison',
        xaxis: { title: 'Time Point' },
        yaxis: { title: 'Elevation (m)' },
        showlegend: true,
        hovermode: 'closest'
    };

    Plotly.newPlot('vePlot', [veTrace2, actualTrace, veTrace1], veLayout, {responsive: true});

    // Plot 2: Residuals comparison
    const residualsTrace2 = {
        x: timePoints,
        y: residuals2,
        type: 'scatter',
        mode: 'lines',
        name: 'Residuals (FIT Air Speed)',
        line: { color: '#4363d8', width: 2 }
    };

    const residualsTrace1 = {
        x: timePoints,
        y: residuals1,
        type: 'scatter',
        mode: 'lines',
        name: 'Residuals (Constant Wind)',
        line: { color: '#a9a9a9', width: 2 }
    };

    const zeroLine = {
        x: timePoints,
        y: new Array(timePoints.length).fill(0),
        type: 'scatter',
        mode: 'lines',
        name: 'Zero',
        line: { color: '#95a5a6', width: 1, dash: 'dash' }
    };

    const residualsLayout = {
        title: 'Residuals Comparison (Virtual - Actual)',
        xaxis: { title: 'Time Point' },
        yaxis: { title: 'Residual (m)' },
        showlegend: true,
        hovermode: 'closest'
    };

    Plotly.newPlot('veResidualsPlot', [residualsTrace2, residualsTrace1, zeroLine], residualsLayout, {responsive: true});
}

async function createWindSpeedPlot(timestamps: number[], velocity: number[], windSpeed: number[], distance: number[], trimStart: number, trimEnd: number, defaultAirSpeedOffset: number = 0) {
    // Wait for Plotly to load
    let Plotly;
    try {
        Plotly = await waitForPlotly();
    } catch (error) {
        console.error('Failed to load Plotly:', error);
        const windPlotDiv = document.getElementById('windSpeedPlot');
        if (windPlotDiv) windPlotDiv.innerHTML = '<p style="text-align: center; padding: 50px; color: #e74c3c;">Plotly failed to load. Please check your internet connection.</p>';
        return;
    }

    // Calculate effective wind from constant wind parameters
    const hasWindSpeed = windSpeed.some(val => !isNaN(val) && val !== 0);
    const hasConstantWind = currentParameters.wind_speed !== undefined && currentParameters.wind_speed !== 0 &&
                            currentParameters.wind_direction !== undefined;

    // Calculate context range (+/- 5s, but limited by actual trim)
    const contextBefore = Math.min(trimStart, 5);
    const contextAfter = Math.min(velocity.length - trimEnd, 5);

    // Extended range including context
    const extendedStart = trimStart - contextBefore;
    const extendedEnd = trimEnd + contextAfter;

    // Convert velocity to km/h
    const groundSpeedKmh = velocity.map(v => v * 3.6);

    // Calculate constant wind apparent speed if configured
    let constantWindApparent: number[] = [];
    if (hasConstantWind) {
        const windSpeedMs = currentParameters.wind_speed || 0;
        const windDirection = currentParameters.wind_direction || 0;

        // Get rider bearings from filtered VE data (matches the Rust calculation)
        let riderBearings: number[] = [];
        if (filteredVEData && filteredVEData.positionLat.length > 0) {
            // Calculate bearing for each point based on GPS movement
            riderBearings = new Array(filteredVEData.positionLat.length).fill(0);

            for (let i = 1; i < filteredVEData.positionLat.length; i++) {
                const lat1 = filteredVEData.positionLat[i - 1] * Math.PI / 180;
                const lat2 = filteredVEData.positionLat[i] * Math.PI / 180;
                const lon1 = filteredVEData.positionLong[i - 1] * Math.PI / 180;
                const lon2 = filteredVEData.positionLong[i] * Math.PI / 180;

                const dLon = lon2 - lon1;
                const y = Math.sin(dLon) * Math.cos(lat2);
                const x = Math.cos(lat1) * Math.sin(lat2) - Math.sin(lat1) * Math.cos(lat2) * Math.cos(dLon);
                let bearing = Math.atan2(y, x) * 180 / Math.PI;
                bearing = (bearing + 360) % 360; // Normalize to 0-360

                riderBearings[i] = bearing;
            }
            // Fill first point with second point's bearing
            if (riderBearings.length > 1) {
                riderBearings[0] = riderBearings[1];
            }
        }

        constantWindApparent = velocity.map((v, i) => {
            // Use calculated bearing if available, otherwise default to 0
            const bearing = riderBearings.length > i ? riderBearings[i] : 0;

            // Calculate angle difference between wind and rider direction
            // Wind direction: direction wind is COMING FROM (meteorological convention)
            // Rider bearing: direction rider is MOVING TOWARDS
            let angleDiff = Math.abs(windDirection - bearing);

            // Normalize to 0-180 degrees (shortest angle)
            if (angleDiff > 180) {
                angleDiff = 360 - angleDiff;
            }

            // Calculate effective wind component
            // angle_diff = 0°   -> headwind (full resistance) -> cos(0) = +1
            // angle_diff = 90°  -> crosswind (no effect) -> cos(90) = 0
            // angle_diff = 180° -> tailwind (full assistance) -> cos(180) = -1
            const effectiveWind = windSpeedMs * Math.cos(angleDiff * Math.PI / 180);

            return (v + effectiveWind) * 3.6; // Convert to km/h
        });
    }

    // Calculate FIT wind speed in km/h (with offset applied)
    const windSpeedOffset = currentParameters?.air_speed_offset ?? defaultAirSpeedOffset;
    const offsetWindSpeed = hasWindSpeed ? applyAirSpeedOffset(windSpeed, windSpeedOffset) : windSpeed;
    const windSpeedKmh = hasWindSpeed ? offsetWindSpeed.map(v => isNaN(v) ? null : v * 3.6) : [];

    // Use time (seconds) instead of distance for x-axis
    const timeSeconds = timestamps.map((t, i) => i);
    const timePointsBefore = contextBefore > 0 ? Array.from({length: contextBefore + 1}, (_, i) => i + extendedStart) : [];
    const timePointsMain = Array.from({length: trimEnd - trimStart + 1}, (_, i) => i + trimStart);
    const timePointsAfter = contextAfter > 0 ? Array.from({length: contextAfter + 1}, (_, i) => i + trimEnd) : [];

    // Prepare traces with context (low opacity before/after)
    const traces: any[] = [];

    // Add context before trim (low opacity) for all traces
    if (contextBefore > 0) {
        // Ground speed context
        traces.push({
            x: timePointsBefore,
            y: groundSpeedKmh.slice(extendedStart, trimStart + 1),
            type: 'scatter',
            mode: 'lines',
            name: 'Ground Speed (trimmed)',
            line: { color: '#000000', width: 2 },
            opacity: 0.2,
            showlegend: false
        });

        // FIT wind speed context
        if (hasWindSpeed) {
            traces.push({
                x: timePointsBefore,
                y: windSpeedKmh.slice(extendedStart, trimStart + 1),
                type: 'scatter',
                mode: 'lines',
                name: 'Apparent (FIT Air) (trimmed)',
                line: { color: '#4363d8', width: 2 },
                opacity: 0.2,
                showlegend: false
            });
        }

        // Constant wind context
        if (hasConstantWind) {
            traces.push({
                x: timePointsBefore,
                y: constantWindApparent.slice(extendedStart, trimStart + 1),
                type: 'scatter',
                mode: 'lines',
                name: 'Apparent (Constant Wind) (trimmed)',
                line: { color: '#a9a9a9', width: 2 },
                opacity: 0.2,
                showlegend: false
            });
        }
    }

    // Main trimmed data (full opacity)
    // Ground speed
    traces.push({
        x: timePointsMain,
        y: groundSpeedKmh.slice(trimStart, trimEnd + 1), // +1 for inclusive trimEnd
        type: 'scatter',
        mode: 'lines',
        name: 'Ground Speed',
        line: { color: '#000000', width: 2 }
    });

    // FIT wind speed
    if (hasWindSpeed) {
        traces.push({
            x: timePointsMain,
            y: windSpeedKmh.slice(trimStart, trimEnd + 1), // +1 for inclusive trimEnd
            type: 'scatter',
            mode: 'lines',
            name: 'Apparent (FIT Air)',
            line: { color: '#4363d8', width: 2 }
        });
    }

    // Constant wind
    if (hasConstantWind) {
        traces.push({
            x: timePointsMain,
            y: constantWindApparent.slice(trimStart, trimEnd + 1), // +1 for inclusive trimEnd
            type: 'scatter',
            mode: 'lines',
            name: 'Apparent (Constant Wind)',
            line: { color: '#a9a9a9', width: 2 }
        });
    }

    // Add context after trim (low opacity) for all traces
    if (contextAfter > 0) {
        // Ground speed context
        traces.push({
            x: timePointsAfter,
            y: groundSpeedKmh.slice(trimEnd, extendedEnd), // trimEnd not trimEnd-1 since we want data after
            type: 'scatter',
            mode: 'lines',
            name: 'Ground Speed (trimmed)',
            line: { color: '#000000', width: 2 },
            opacity: 0.2,
            showlegend: false
        });

        // FIT wind speed context
        if (hasWindSpeed) {
            traces.push({
                x: timePointsAfter,
                y: windSpeedKmh.slice(trimEnd, extendedEnd),
                type: 'scatter',
                mode: 'lines',
                name: 'Apparent (FIT Air) (trimmed)',
                line: { color: '#4363d8', width: 2 },
                opacity: 0.2,
                showlegend: false
            });
        }

        // Constant wind context
        if (hasConstantWind) {
            traces.push({
                x: timePointsAfter,
                y: constantWindApparent.slice(trimEnd, extendedEnd),
                type: 'scatter',
                mode: 'lines',
                name: 'Apparent (Constant Wind) (trimmed)',
                line: { color: '#a9a9a9', width: 2 },
                opacity: 0.2,
                showlegend: false
            });
        }
    }

    // Calculate x-axis range to show trim region +/- context (already calculated above)
    const xMin = trimStart - contextBefore;
    const xMax = trimEnd + contextAfter;

    const layout = {
        title: {
            text: 'Wind Speed Analysis',
            font: { size: 14 }
        },
        xaxis: {
            title: 'Time (seconds)',
            showgrid: true,
            gridcolor: '#e0e0e0',
            range: [xMin, xMax]
        },
        yaxis: {
            title: 'Speed (km/h)',
            showgrid: true,
            gridcolor: '#e0e0e0'
        },
        legend: {
            x: 0.02,
            y: 0.98,
            bgcolor: 'rgba(255,255,255,0.8)'
        },
        shapes: [
            // Trim start vertical line
            {
                type: 'line',
                x0: trimStart,
                x1: trimStart,
                y0: 0,
                y1: 1,
                yref: 'paper',
                line: {
                    color: 'rgba(100, 100, 100, 0.3)',
                    width: 1.5,
                    dash: 'dash'
                }
            },
            // Trim end vertical line
            {
                type: 'line',
                x0: trimEnd,
                x1: trimEnd,
                y0: 0,
                y1: 1,
                yref: 'paper',
                line: {
                    color: 'rgba(100, 100, 100, 0.3)',
                    width: 1.5,
                    dash: 'dash'
                }
            }
        ],
        margin: { l: 60, r: 20, t: 40, b: 60 },
        plot_bgcolor: '#fafafa',
        paper_bgcolor: 'white'
    };

    Plotly.newPlot('windSpeedPlot', traces, layout, {responsive: true});
}

async function createSpeedPowerPlot(timestamps: number[], velocity: number[], power: number[], trimStart: number, trimEnd: number) {
    // Wait for Plotly to load
    let Plotly;
    try {
        Plotly = await waitForPlotly();
    } catch (error) {
        console.error('Failed to load Plotly:', error);
        const plotDiv = document.getElementById('speedPowerPlot');
        if (plotDiv) plotDiv.innerHTML = '<p style="text-align: center; padding: 50px; color: #e74c3c;">Plotly failed to load. Please check your internet connection.</p>';
        return;
    }

    // Calculate context range (+/- 5s, but limited by actual trim)
    const contextBefore = Math.min(trimStart, 5);
    const contextAfter = Math.min(velocity.length - 1 - trimEnd, 5);

    // Extended range including context
    const extendedStart = trimStart - contextBefore;
    const extendedEnd = trimEnd + 1 + contextAfter; // +1 because trimEnd is now inclusive

    // Convert velocity to km/h
    const speedKmh = velocity.map(v => v * 3.6);

    // Use time (seconds) for x-axis
    const timeSeconds = timestamps.map((t, i) => i);
    const timePointsBefore = contextBefore > 0 ? Array.from({length: contextBefore + 1}, (_, i) => i + extendedStart) : [];
    const timePointsMain = Array.from({length: trimEnd - trimStart + 1}, (_, i) => i + trimStart);
    const timePointsAfter = contextAfter > 0 ? Array.from({length: contextAfter + 1}, (_, i) => i + trimEnd) : [];

    // Prepare traces with context (low opacity before/after)
    const traces: any[] = [];

    // Add context before trim (low opacity)
    if (contextBefore > 0) {
        // Speed context
        traces.push({
            x: timePointsBefore,
            y: speedKmh.slice(extendedStart, trimStart + 1),
            type: 'scatter',
            mode: 'lines',
            name: 'Speed (trimmed)',
            line: { color: '#000000', width: 2 },
            opacity: 0.2,
            showlegend: false,
            yaxis: 'y'
        });

        // Power context
        traces.push({
            x: timePointsBefore,
            y: power.slice(extendedStart, trimStart + 1),
            type: 'scatter',
            mode: 'lines',
            name: 'Power (trimmed)',
            line: { color: '#4363d8', width: 2 },
            opacity: 0.2,
            showlegend: false,
            yaxis: 'y2'
        });
    }

    // Main trimmed data (full opacity)
    // Speed (black, left y-axis)
    traces.push({
        x: timePointsMain,
        y: speedKmh.slice(trimStart, trimEnd + 1), // +1 for inclusive trimEnd
        type: 'scatter',
        mode: 'lines',
        name: 'Speed',
        line: { color: '#000000', width: 2 },
        yaxis: 'y'
    });

    // Power (blue, right y-axis)
    traces.push({
        x: timePointsMain,
        y: power.slice(trimStart, trimEnd + 1), // +1 for inclusive trimEnd
        type: 'scatter',
        mode: 'lines',
        name: 'Power',
        line: { color: '#4363d8', width: 2 },
        yaxis: 'y2'
    });

    // Add context after trim (low opacity)
    if (contextAfter > 0) {
        // Speed context
        traces.push({
            x: timePointsAfter,
            y: speedKmh.slice(trimEnd, extendedEnd), // trimEnd not trimEnd-1 since we want data after
            type: 'scatter',
            mode: 'lines',
            name: 'Speed (trimmed)',
            line: { color: '#000000', width: 2 },
            opacity: 0.2,
            showlegend: false,
            yaxis: 'y'
        });

        // Power context
        traces.push({
            x: timePointsAfter,
            y: power.slice(trimEnd, extendedEnd),
            type: 'scatter',
            mode: 'lines',
            name: 'Power (trimmed)',
            line: { color: '#4363d8', width: 2 },
            opacity: 0.2,
            showlegend: false,
            yaxis: 'y2'
        });
    }

    const layout = {
        title: {
            text: 'Speed & Power',
            font: { size: 14 }
        },
        xaxis: {
            title: 'Time (seconds)',
            showgrid: true,
            gridcolor: '#e0e0e0',
            range: [extendedStart, extendedEnd - 1]
        },
        yaxis: {
            title: 'Speed (km/h)',
            titlefont: { color: '#000000' },
            tickfont: { color: '#000000' },
            showgrid: true,
            gridcolor: '#e0e0e0'
        },
        yaxis2: {
            title: 'Power (W)',
            titlefont: { color: '#4363d8' },
            tickfont: { color: '#4363d8' },
            overlaying: 'y',
            side: 'right',
            showgrid: false
        },
        legend: {
            x: 0.02,
            y: 0.98,
            bgcolor: 'rgba(255,255,255,0.8)'
        },
        shapes: [
            // Trim start vertical line
            {
                type: 'line',
                x0: trimStart,
                x1: trimStart,
                y0: 0,
                y1: 1,
                yref: 'paper',
                line: {
                    color: 'rgba(100, 100, 100, 0.3)',
                    width: 1.5,
                    dash: 'dash'
                }
            },
            // Trim end vertical line
            {
                type: 'line',
                x0: trimEnd,
                x1: trimEnd,
                y0: 0,
                y1: 1,
                yref: 'paper',
                line: {
                    color: 'rgba(100, 100, 100, 0.3)',
                    width: 1.5,
                    dash: 'dash'
                }
            }
        ],
        margin: { l: 60, r: 60, t: 40, b: 60 },
        plot_bgcolor: '#fafafa',
        paper_bgcolor: 'white'
    };

    Plotly.newPlot('speedPowerPlot', traces, layout, {responsive: true});
}

async function createVirtualDistancePlot(timestamps: number[], velocity: number[], windSpeed: number[], distance: number[], trimStart: number, trimEnd: number) {
    // Wait for Plotly to load
    let Plotly;
    try {
        Plotly = await waitForPlotly();
    } catch (error) {
        console.error('Failed to load Plotly:', error);
        const plotDiv = document.getElementById('vdPlot');
        if (plotDiv) plotDiv.innerHTML = '<p style="text-align: center; padding: 50px; color: #e74c3c;">Plotly failed to load. Please check your internet connection.</p>';
        return;
    }

    // Calculate context range (+/- 5s, but limited by actual trim)
    const contextBefore = Math.min(trimStart, 5);
    const contextAfter = Math.min(velocity.length - 1 - trimEnd, 5);

    // Extended range including context
    const extendedStart = trimStart - contextBefore;
    const extendedEnd = trimEnd + 1 + contextAfter;

    // Apply wind speed calibration
    const calibratedWindSpeed = airSpeedCalibrationPercent !== 0
        ? windSpeed.map(speed => speed * (1.0 + airSpeedCalibrationPercent / 100.0))
        : windSpeed;

    // Calculate cumulative virtual distances starting from trimStart (both start at 0)
    const vdAir: number[] = new Array(timestamps.length).fill(0);
    const vdGround: number[] = new Array(timestamps.length).fill(0);

    // Calculate from trim start onwards
    for (let i = trimStart + 1; i < timestamps.length; i++) {
        const dt = timestamps[i] - timestamps[i - 1];

        // Wind speed is already apparent velocity - just apply calibration
        const apparentSpeed = (!isNaN(calibratedWindSpeed[i])) ? calibratedWindSpeed[i] : 0;
        const windDist = (apparentSpeed > 0 ? apparentSpeed : 0) * dt;
        vdAir[i] = vdAir[i - 1] + windDist;

        // Ground speed VD (cumulative)
        const groundSpeedVal = (!isNaN(velocity[i]) && velocity[i] > 0) ? velocity[i] : 0;
        const groundDist = groundSpeedVal * dt;
        vdGround[i] = vdGround[i - 1] + groundDist;
    }

    // Convert to kilometers
    const vdAirKm = vdAir.map(d => d / 1000);
    const vdGroundKm = vdGround.map(d => d / 1000);

    // Use time (seconds) for x-axis
    const timeSeconds = timestamps.map((t, i) => i);
    const timePointsBefore = contextBefore > 0 ? Array.from({length: contextBefore + 1}, (_, i) => i + extendedStart) : [];
    const timePointsMain = Array.from({length: trimEnd - trimStart + 1}, (_, i) => i + trimStart);
    const timePointsAfter = contextAfter > 0 ? Array.from({length: contextAfter + 1}, (_, i) => i + trimEnd) : [];

    // Prepare traces with context (low opacity before/after)
    const traces: any[] = [];

    // Add context before trim (low opacity)
    if (contextBefore > 0) {
        // VD Air context
        traces.push({
            x: timePointsBefore,
            y: vdAirKm.slice(extendedStart, trimStart + 1),
            type: 'scatter',
            mode: 'lines',
            name: 'VD Air (trimmed)',
            line: { color: '#4363d8', width: 2 },
            opacity: 0.2,
            showlegend: false
        });

        // VD Ground context
        traces.push({
            x: timePointsBefore,
            y: vdGroundKm.slice(extendedStart, trimStart + 1),
            type: 'scatter',
            mode: 'lines',
            name: 'VD Ground (trimmed)',
            line: { color: '#000000', width: 2 },
            opacity: 0.2,
            showlegend: false
        });
    }

    // Main trimmed data (full opacity)
    // VD from Air Speed (blue)
    traces.push({
        x: timePointsMain,
        y: vdAirKm.slice(trimStart, trimEnd + 1),
        type: 'scatter',
        mode: 'lines',
        name: 'VD from Air Speed',
        line: { color: '#4363d8', width: 2 }
    });

    // VD from Ground Speed (black)
    traces.push({
        x: timePointsMain,
        y: vdGroundKm.slice(trimStart, trimEnd + 1),
        type: 'scatter',
        mode: 'lines',
        name: 'VD from Ground Speed',
        line: { color: '#000000', width: 2 }
    });

    // Add context after trim (low opacity)
    if (contextAfter > 0) {
        // VD Air context
        traces.push({
            x: timePointsAfter,
            y: vdAirKm.slice(trimEnd, extendedEnd),
            type: 'scatter',
            mode: 'lines',
            name: 'VD Air (trimmed)',
            line: { color: '#4363d8', width: 2 },
            opacity: 0.2,
            showlegend: false
        });

        // VD Ground context
        traces.push({
            x: timePointsAfter,
            y: vdGroundKm.slice(trimEnd, extendedEnd),
            type: 'scatter',
            mode: 'lines',
            name: 'VD Ground (trimmed)',
            line: { color: '#000000', width: 2 },
            opacity: 0.2,
            showlegend: false
        });
    }

    const layout = {
        title: {
            text: 'Virtual Distance: Air Speed vs Ground Speed',
            font: { size: 14 }
        },
        xaxis: {
            title: 'Time (seconds)',
            showgrid: true,
            gridcolor: '#e0e0e0',
            range: [extendedStart, extendedEnd - 1]
        },
        yaxis: {
            title: 'Cumulative Distance (km)',
            showgrid: true,
            gridcolor: '#e0e0e0'
        },
        legend: {
            x: 0.02,
            y: 0.98,
            bgcolor: 'rgba(255,255,255,0.8)'
        },
        shapes: [
            // Trim start vertical line
            {
                type: 'line',
                x0: trimStart,
                x1: trimStart,
                y0: 0,
                y1: 1,
                yref: 'paper',
                line: {
                    color: 'rgba(100, 100, 100, 0.3)',
                    width: 1.5,
                    dash: 'dash'
                }
            },
            // Trim end vertical line
            {
                type: 'line',
                x0: trimEnd,
                x1: trimEnd,
                y0: 0,
                y1: 1,
                yref: 'paper',
                line: {
                    color: 'rgba(100, 100, 100, 0.3)',
                    width: 1.5,
                    dash: 'dash'
                }
            }
        ],
        margin: { l: 60, r: 60, t: 40, b: 60 },
        plot_bgcolor: '#fafafa',
        paper_bgcolor: 'white'
    };

    Plotly.newPlot('vdPlot', traces, layout, {responsive: true});
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
            console.error('Failed to clear storage:', err);
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