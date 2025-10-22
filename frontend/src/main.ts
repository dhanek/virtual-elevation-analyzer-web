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
let veCalculator: any = null; // VE calculator instance for air speed calibration
let airSpeedCalibrationPercent: number = 0; // Air speed calibration percentage (-20 to +20)
let resultsStorage: ResultsStorage = new ResultsStorage();

// DEM-related state
let demManager: DEMManager = new DEMManager();
let elevationCache: ElevationProfileCache = new ElevationProfileCache();
let selectedDEMFile: File | null = null;
let elevationCorrectionEnabled: boolean = false;
let elevationErrorRate: number = 0;

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
        await handleDEMFileSelection(target.files[0]);
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
        await handleDEMFileSelection(files[0]);
    }
});

clearDemButton.addEventListener('click', () => {
    clearDEMFile();
});

correctElevationCheckbox.addEventListener('change', (event) => {
    elevationCorrectionEnabled = (event.target as HTMLInputElement).checked;
});

// DEM file handling functions
async function handleDEMFileSelection(file: File): Promise<void> {
    try {
        showLoading('Loading DEM file...');

        // Load DEM file
        await demManager.loadDEMFile(file);
        selectedDEMFile = file;

        // Update UI
        demFileInfo.classList.remove('hidden');
        demFileName.textContent = file.name;

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
        console.log('DEM file loaded successfully:', file.name);
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
                            selectedFile.name,
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
function initializeSection3Csv(csvData: GibliCsvData, result: any) {
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

        // Calculate distance from GPS coordinates
        const distance = calculateDistanceArray(csvData.positionLat, csvData.positionLong);

        // Create wind speed array from air speed (wind magnitude is already air speed)
        // Wind speed in this context is the environmental wind, which we'll calculate later
        const windSpeed = new Array(csvData.timestamps.length).fill(0);

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

            // Auto-enable velodrome mode if no GPS data
            if (!result.parsing_statistics.has_gps_data) {
                parametersComponent.setParameters({ velodrome: true });
            }
            // Auto-enable auto-rho if HAS GPS data
            else if (result.parsing_statistics.has_gps_data) {
                parametersComponent.setParameters({ auto_calculate_rho: true });
                console.log('📍 GPS data detected - auto-rho enabled by default');
            }
        }
    }

    isLoadingParameters = false; // Re-enable saving after load complete
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
    viewportAdapter.onViewportChange((viewportInfo) => {

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
        if (mapVisualization && savedSettings) {
            console.log('Setting map trim markers to loaded settings:', { trimStart: presetTrimStart, trimEnd: presetTrimEnd });
            setTimeout(() => {
                if (mapVisualization) {
                    mapVisualization.fitBoundsToTrimRegion(presetTrimStart, presetTrimEnd, filteredLapPositionLat, filteredLapPositionLong);
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
    currentParameters = parameters;

    // Don't save if we're currently loading parameters from storage
    if (isLoadingParameters) {
        return;
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
            const trimStart = parseInt(trimStartSlider.value);
            const trimEnd = parseInt(trimEndSlider.value);

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

    const hasGpsData = currentFitResult?.parsing_statistics?.has_gps_data ?? false;

    // Update the analysis section with map and lap selection (map only if GPS available)
    const analysisHtml = `
        <div class="analysis-layout">
            <div class="analysis-sidebar">
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
            } else {
                console.log('No GPS data - skipping map initialization');
            }

            setupLapSelectionHandlers();
            setupAnalyzeButton();

            console.log('Section 3 initialized (GPS:', hasGpsData, ')');
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
        const hasSelectedLaps = selectedLaps.length > 0;
        const hasValidParameters = parametersComponent ? parametersComponent.isValid() : false;

        analyzeBtn.disabled = !hasSelectedLaps || !hasValidParameters;

        if (!hasSelectedLaps) {
            analyzeBtn.textContent = 'Select Laps to Analyze';
        } else if (!hasValidParameters) {
            analyzeBtn.textContent = 'Check Parameters Above';
        } else {
            analyzeBtn.textContent = `Analyze ${selectedLaps.length} Selected Lap${selectedLaps.length > 1 ? 's' : ''}`;
        }
    }
}

async function handleAnalyze() {
    if (!currentParameters || selectedLaps.length === 0) {
        alert('Please select laps and set parameters first.');
        return;
    }

    if (!currentFitData || !currentLaps) {
        alert('No FIT data available for analysis.');
        return;
    }

    // Note: Auto-rho will be triggered AFTER VE analysis when trim sliders are created
    // (trim sliders don't exist yet at this point)

    try {
        showLoading('Preparing data for Virtual Elevation analysis...');

        // Collect data from selected laps
        // Convert 1-based lap numbers to 0-based array indices
        const selectedLapData = selectedLaps.map(lapNumber => currentLaps[lapNumber - 1]);
        console.log('Selected lap data structure:', selectedLapData);

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
        const allAirSpeed = fitData.air_speed;
        const allWindSpeed = fitData.wind_speed;
        const allTemperature = fitData.temperature || [];

        console.log('Data arrays accessed successfully:', {
            timestamps: allTimestamps.length,
            power: allPower.length,
            velocity: allVelocity.length,
            position_lat: allPositionLat.length
        });

        console.log('Total FIT records available:', allTimestamps.length);

        // Filter data points to only include those within selected lap time ranges
        // WASM lap objects - access properties directly, not as functions
        const selectedLapTimeRanges = selectedLapData.map(lap => ({
            start: lap.start_time,    // Direct property access
            end: lap.end_time         // Direct property access
        }));
        console.log('Selected lap time ranges:', selectedLapTimeRanges);

        // Debug: Check the timestamp filtering
        console.log('All timestamps range:', {
            first: allTimestamps[0],
            last: allTimestamps[allTimestamps.length - 1],
            total: allTimestamps.length
        });
        console.log('Selected lap time ranges:', selectedLapTimeRanges);

        // Filter data points by selected lap time ranges
        let filteredTimestamps: number[] = [];
        let filteredPower: number[] = [];
        let filteredVelocity: number[] = [];
        let filteredPositionLat: number[] = [];
        let filteredPositionLong: number[] = [];
        let filteredAltitude: number[] = [];
        let filteredDistance: number[] = [];
        let filteredAirSpeed: number[] = [];
        let filteredWindSpeed: number[] = [];
        let filteredTemperature: number[] = [];

        for (let i = 0; i < allTimestamps.length; i++) {
            const timestamp = allTimestamps[i];

            // Check if this timestamp falls within any selected lap time range
            const isInSelectedLap = selectedLapTimeRanges.some(range =>
                timestamp >= range.start && timestamp <= range.end
            );

            if (isInSelectedLap) {
                filteredTimestamps.push(timestamp);
                filteredPower.push(allPower[i]);
                filteredVelocity.push(allVelocity[i]);
                filteredPositionLat.push(allPositionLat[i]);
                filteredPositionLong.push(allPositionLong[i]);
                filteredAltitude.push(allAltitude[i]);
                filteredDistance.push(allDistance[i]);
                filteredAirSpeed.push(allAirSpeed[i]);
                filteredWindSpeed.push(allWindSpeed[i]);
                filteredTemperature.push(allTemperature[i] || 0);
            }
        }


        console.log('Lap selection filtering complete:', {
            selectedLaps: selectedLaps,
            totalDataPoints: filteredTimestamps.length,
            firstTimestamp: filteredTimestamps[0],
            lastTimestamp: filteredTimestamps[filteredTimestamps.length - 1],
            lapTimeRanges: selectedLapTimeRanges
        });

        if (filteredTimestamps.length === 0) {
            throw new Error('No valid data points found in selected laps');
        }

        // Check if we have sufficient power data
        const powerDataPoints = filteredPower.filter(p => p > 0).length;
        if (powerDataPoints < filteredTimestamps.length * 0.5) {
            console.warn(`Only ${powerDataPoints}/${filteredTimestamps.length} records have power data`);
        }

        showLoading('Running Virtual Elevation calculation...');

        // Check if data has environmental data for per-datapoint rho (works for both FIT and CSV)
        currentRhoArray = null; // Reset global rho array
        const hasEnvironmentalData = fitData.temperature && fitData.humidity && fitData.pressure;
        if (hasEnvironmentalData) {
            console.log('📊 Data has environmental data - calculating per-datapoint rho');
            const fullRhoArray = calculateRhoArrayFromFitData(fitData);

            if (fullRhoArray) {
                // Filter rho array to match selected laps (same filtering as other data)
                currentRhoArray = [];
                for (let i = 0; i < allTimestamps.length; i++) {
                    const timestamp = allTimestamps[i];
                    const isInSelectedLap = selectedLapTimeRanges.some(range =>
                        timestamp >= range.start && timestamp <= range.end
                    );
                    if (isInSelectedLap) {
                        currentRhoArray.push(fullRhoArray[i]);
                    }
                }

                console.log('📊 Filtered rho array for VE calculation:', {
                    fullLength: fullRhoArray.length,
                    filteredLength: currentRhoArray.length,
                    sampleValues: currentRhoArray.slice(0, 5)
                });
            }
        }

        // Create Virtual Elevation calculator with filtered data
        // Use the rho array version if we have per-datapoint rho from CSV
        const calculator = currentRhoArray
            ? create_ve_calculator_with_rho_array(
                filteredTimestamps,
                filteredPower,
                filteredVelocity,
                filteredPositionLat,
                filteredPositionLong,
                filteredAltitude,
                filteredDistance,
                filteredAirSpeed,
                filteredWindSpeed,
                new Float64Array(currentRhoArray),
                // Parameters
                currentParameters.system_mass,
                currentParameters.rho,
                currentParameters.eta,
                currentParameters.cda,
                currentParameters.crr,
                currentParameters.cda_min,
                currentParameters.cda_max,
                currentParameters.crr_min,
                currentParameters.crr_max,
                currentParameters.wind_speed,
                currentParameters.wind_direction,
                currentParameters.velodrome
            )
            : create_ve_calculator(
                filteredTimestamps,
                filteredPower,
                filteredVelocity,
                filteredPositionLat,
                filteredPositionLong,
                filteredAltitude,
                filteredDistance,
                filteredAirSpeed,
                filteredWindSpeed,
                // Parameters
                currentParameters.system_mass,
                currentParameters.rho,
                currentParameters.eta,
                currentParameters.cda,
                currentParameters.crr,
                currentParameters.cda_min,
                currentParameters.cda_max,
                currentParameters.crr_min,
                currentParameters.crr_max,
                currentParameters.wind_speed,
                currentParameters.wind_direction,
                currentParameters.velodrome
            );

        // Use provided CdA and Crr values, or defaults for optimization
        const cda = currentParameters.cda ?? 0.3; // Use middle of range if optimizing
        const crr = currentParameters.crr ?? 0.008; // Use middle of range if optimizing

        // Initial trim values - full dataset
        const trimStart = 0;
        const trimEnd = filteredTimestamps.length - 1;

        const result = calculator.calculate_virtual_elevation(cda, crr, trimStart, trimEnd);

        // If data has CdA reference data, filter it for the selected laps
        // (validation will be calculated dynamically when plots update)
        let filteredCdaReference: number[] | null = null;
        if (fitData.cda_reference) {
            console.log('📊 Data has CdA reference - will enable validation tab');

            // Filter CdA reference to match selected laps
            const fullCdaReference = fitData.cda_reference;
            filteredCdaReference = [];
            for (let i = 0; i < allTimestamps.length; i++) {
                const timestamp = allTimestamps[i];
                const isInSelectedLap = selectedLapTimeRanges.some(range =>
                    timestamp >= range.start && timestamp <= range.end
                );
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

        // Show the Virtual Elevation analysis interface inline
        showVirtualElevationAnalysisInline(
            result,
            selectedLaps,
            filteredTimestamps,
            filteredPower,
            filteredVelocity,
            filteredPositionLat,
            filteredPositionLong,
            filteredAltitude,
            filteredDistance,
            filteredAirSpeed,
            filteredWindSpeed,
            filteredTemperature,
            filteredCdaReference
        );

    } catch (err) {
        console.error('Virtual Elevation analysis failed:', err);
        hideLoading();
        const errorMessage = err instanceof Error ? err.message : 'Unknown error';
        showError(`Virtual Elevation analysis failed: ${errorMessage}`);
    }
}


async function showVirtualElevationAnalysisInline(initialResult: any, analyzedLaps: number[], timestamps: number[], power: number[], velocity: number[], positionLat: number[], positionLong: number[], altitude: number[], distance: number[], airSpeed: number[], windSpeed: number[], temperature: number[] = [], cdaReference: number[] | null = null) {
    // Store analyzed laps globally for save functionality
    currentAnalyzedLaps = analyzedLaps;
    // Store filtered data globally for save functionality
    currentFilteredData = { power, velocity, temperature, timestamps };
    // Store CdA reference data globally (will be used for dynamic validation)
    currentCdaReference = cdaReference;

    // Check if air_speed data is available (not all zeros/NaN)
    const hasAirSpeed = airSpeed.some(val => !isNaN(val) && val !== 0);
    const hasConstantWind = currentParameters.wind_speed !== undefined && currentParameters.wind_speed !== 0 &&
                            currentParameters.wind_direction !== undefined;

    console.log('Wind data availability:', { hasAirSpeed, hasConstantWind });

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

                ${(hasAirSpeed || hasConstantWind) ? `
                <div class="ve-wind-source">
                    <h4>Wind Source</h4>
                    <div class="ve-radio-group">
                        <label class="ve-radio-label">
                            <input type="radio" name="windSource" value="constant" ${!hasAirSpeed ? 'checked' : ''}>
                            <span>Use constant wind settings</span>
                        </label>
                        ${hasAirSpeed ? `
                        <label class="ve-radio-label">
                            <input type="radio" name="windSource" value="fit" ${hasAirSpeed ? 'checked' : ''}>
                            <span>Use FIT file air speed</span>
                        </label>
                        <label class="ve-radio-label">
                            <input type="radio" name="windSource" value="compare">
                            <span>Compare both methods</span>
                        </label>
                        ` : ''}
                    </div>
                </div>
                ` : ''}

                ${hasAirSpeed ? `
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
                    ${(hasAirSpeed || hasConstantWind) ? `
                    <button class="ve-tab-button" data-tab="wind">Wind</button>
                    ` : ''}
                    <button class="ve-tab-button" data-tab="power">Power</button>
                    ${hasAirSpeed ? `
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

                ${(hasAirSpeed || hasConstantWind) ? `
                <div class="ve-tab-content" id="wind-tab">
                    <div id="windSpeedPlot" class="ve-plot" style="height: 600px;"></div>

                    ${hasAirSpeed ? `
                    <div class="ve-parameter" style="margin-top: 1.5rem; padding: 1rem; border: 1px solid #ddd; border-radius: 4px; background: #f9f9f9;">
                        <h4 style="margin: 0 0 1rem 0; font-size: 1rem; font-weight: 500;">Air Speed Time Offset</h4>
                        <div style="display: grid; grid-template-columns: 1fr auto auto; gap: 0.5rem; align-items: center; margin-bottom: 0.5rem;">
                            <input type="range" id="airSpeedOffsetSlider" min="-10" max="10" step="1" value="${currentParameters?.air_speed_offset ?? 2}"
                                   style="width: 100%;" />
                            <input type="number" id="airSpeedOffsetValue" value="${currentParameters?.air_speed_offset ?? 2}" step="1" min="-10" max="10"
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

                ${hasAirSpeed ? `
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
    await initializeVEAnalysis(timestamps, power, velocity, positionLat, positionLong, altitude, distance, airSpeed, windSpeed, analyzedLaps);

    // Scroll to the VE analysis section
    veSection.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

async function initializeVEAnalysis(timestamps: number[], power: number[], velocity: number[], positionLat: number[], positionLong: number[], altitude: number[], distance: number[], airSpeed: number[], windSpeed: number[], analyzedLaps: number[]) {

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
                    createWindSpeedPlot(timestamps, velocity, airSpeed, distance, trimStart, trimEnd);
                }, 100);
            } else if (tabName === 'power') {
                // Create speed & power plot
                setTimeout(() => {
                    createSpeedPowerPlot(timestamps, velocity, power, trimStart, trimEnd);
                }, 100);
            } else if (tabName === 'vd') {
                // Create virtual distance plot
                setTimeout(() => {
                    createVirtualDistancePlot(timestamps, velocity, airSpeed, distance, trimStart, trimEnd);
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
    setupVESliders(timestamps, power, velocity, positionLat, positionLong, altitude, distance, airSpeed, windSpeed);

    // Initial plot rendering (with delay to ensure Plotly is loaded)
    // Use preset trim values if they were set before clicking analyze
    const initialTrimStart = presetTrimStart;
    const initialTrimEnd = presetTrimEnd ?? timestamps.length - 1;
    console.log('Using preset trim values for initial render:', {
        trimStart: initialTrimStart,
        trimEnd: initialTrimEnd
    });
    setTimeout(() => {
        updateVEPlots(timestamps, power, velocity, positionLat, positionLong, altitude, distance, airSpeed, windSpeed, initialTrimStart, initialTrimEnd);

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

    const trimStartSlider = document.getElementById('trimStartSlider') as HTMLInputElement;
    const trimEndSlider = document.getElementById('trimEndSlider') as HTMLInputElement;
    const cdaSlider = document.getElementById('cdaSlider') as HTMLInputElement;
    const crrSlider = document.getElementById('crrSlider') as HTMLInputElement;

    if (!trimStartSlider || !trimEndSlider || !cdaSlider || !crrSlider) {
        console.error('Cannot store: UI elements not found');
        return;
    }

    const storeBtn = document.getElementById('storeResult') as HTMLButtonElement;
    if (!storeBtn) return;

    const originalText = storeBtn.textContent;

    try {
        // Show notes dialog first
        const notes = await showNotesDialog();

        const trimStart = parseInt(trimStartSlider.value);
        const trimEnd = parseInt(trimEndSlider.value);

        // Get filtered data arrays (already filtered by selected laps)
        if (!currentFilteredData) {
            alert('Cannot store result: filtered data not available. Please run analysis first.');
            return;
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
            cda: parseFloat(cdaSlider.value),
            crr: parseFloat(crrSlider.value),
            airSpeedCalibration: airSpeedCalibrationPercent !== 0 ? airSpeedCalibrationPercent : undefined,
            windSource: currentWindSource,
            parameters: currentParameters,
            result: currentVEResult,
            timestamp: new Date(),
            recordingDate: recordingDate,
            avgPower: avgPower,
            avgSpeed: avgSpeed,
            avgTemperature: avgTemperature,
            notes: notes
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

function setupVESliders(timestamps: number[], power: number[], velocity: number[], positionLat: number[], positionLong: number[], altitude: number[], distance: number[], airSpeed: number[], windSpeed: number[]) {
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

        updateVEPlots(timestamps, power, velocity, positionLat, positionLong, altitude, distance, airSpeed, windSpeed, value, trimEnd);

        // Update other plots if they're visible
        const windTab = document.getElementById('wind-tab');
        if (windTab && windTab.classList.contains('active')) {
            createWindSpeedPlot(timestamps, velocity, airSpeed, distance, value, trimEnd);
        }
        const powerTab = document.getElementById('power-tab');
        if (powerTab && powerTab.classList.contains('active')) {
            createSpeedPowerPlot(timestamps, velocity, power, value, trimEnd);
        }
        const vdTab = document.getElementById('vd-tab');
        if (vdTab && vdTab.classList.contains('active')) {
            createVirtualDistancePlot(timestamps, velocity, airSpeed, distance, value, trimEnd);
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

        updateVEPlots(timestamps, power, velocity, positionLat, positionLong, altitude, distance, airSpeed, windSpeed, trimStart, value);

        // Update other plots if they're visible
        const windTab = document.getElementById('wind-tab');
        if (windTab && windTab.classList.contains('active')) {
            createWindSpeedPlot(timestamps, velocity, airSpeed, distance, trimStart, value);
        }
        const powerTab = document.getElementById('power-tab');
        if (powerTab && powerTab.classList.contains('active')) {
            createSpeedPowerPlot(timestamps, velocity, power, trimStart, value);
        }
        const vdTab = document.getElementById('vd-tab');
        if (vdTab && vdTab.classList.contains('active')) {
            createVirtualDistancePlot(timestamps, velocity, airSpeed, distance, trimStart, value);
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
        updateVEPlots(timestamps, power, velocity, positionLat, positionLong, altitude, distance, airSpeed, windSpeed, trimStart, trimEnd);

        // Save lap settings
        saveCurrentLapSettings();
    };

    const updateCrr = () => {
        const value = parseFloat(crrSlider.value);
        crrValue.value = value.toFixed(4);

        const trimStart = parseInt(trimStartSlider.value);
        const trimEnd = parseInt(trimEndSlider.value);
        updateVEPlots(timestamps, power, velocity, positionLat, positionLong, altitude, distance, airSpeed, windSpeed, trimStart, trimEnd);

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

        updateVEPlots(timestamps, power, velocity, positionLat, positionLong, altitude, distance, airSpeed, windSpeed, clamped, trimEnd);

        // Update wind speed plot if it's visible
        const windTab = document.getElementById('wind-tab');
        if (windTab && windTab.classList.contains('active')) {
            createWindSpeedPlot(timestamps, velocity, airSpeed, distance, clamped, trimEnd);
        }

        // Update power plot if it's visible
        const powerTab = document.getElementById('power-tab');
        if (powerTab && powerTab.classList.contains('active')) {
            createSpeedPowerPlot(timestamps, velocity, power, clamped, trimEnd);
        }

        // Update VD plot if it's visible
        const vdTab = document.getElementById('vd-tab');
        if (vdTab && vdTab.classList.contains('active')) {
            createVirtualDistancePlot(timestamps, velocity, airSpeed, distance, clamped, trimEnd);
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

        updateVEPlots(timestamps, power, velocity, positionLat, positionLong, altitude, distance, airSpeed, windSpeed, trimStart, clamped);

        // Update wind speed plot if it's visible
        const windTab = document.getElementById('wind-tab');
        if (windTab && windTab.classList.contains('active')) {
            createWindSpeedPlot(timestamps, velocity, airSpeed, distance, trimStart, clamped);
        }

        // Update power plot if it's visible
        const powerTab = document.getElementById('power-tab');
        if (powerTab && powerTab.classList.contains('active')) {
            createSpeedPowerPlot(timestamps, velocity, power, trimStart, clamped);
        }

        // Update VD plot if it's visible
        const vdTab = document.getElementById('vd-tab');
        if (vdTab && vdTab.classList.contains('active')) {
            createVirtualDistancePlot(timestamps, velocity, airSpeed, distance, trimStart, clamped);
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
        updateVEPlots(timestamps, power, velocity, positionLat, positionLong, altitude, distance, airSpeed, windSpeed, trimStart, trimEnd);

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
        updateVEPlots(timestamps, power, velocity, positionLat, positionLong, altitude, distance, airSpeed, windSpeed, trimStart, trimEnd);

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
            updateVEPlotsWithWindSource(timestamps, power, velocity, positionLat, positionLong, altitude, distance, airSpeed, windSpeed, trimStart, trimEnd, windSource);
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
            updateVEPlots(timestamps, power, velocity, positionLat, positionLong, altitude, distance, airSpeed, windSpeed, trimStart, trimEnd);

            // Update VD tab if visible
            const vdTab = document.getElementById('vd-tab');
            if (vdTab && vdTab.classList.contains('active')) {
                createVirtualDistancePlot(timestamps, velocity, airSpeed, distance, trimStart, trimEnd);
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
            updateVEPlots(timestamps, power, velocity, positionLat, positionLong, altitude, distance, airSpeed, windSpeed, trimStart, trimEnd);

            // Update VD tab if visible
            const vdTab = document.getElementById('vd-tab');
            if (vdTab && vdTab.classList.contains('active')) {
                createVirtualDistancePlot(timestamps, velocity, airSpeed, distance, trimStart, trimEnd);
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
                        // Air speed (no calibration)
                        const airSpeedVal = (!isNaN(airSpeed[i]) && airSpeed[i] > 0) ? airSpeed[i] : 0;
                        vdAirUncalibrated += airSpeedVal * dt;

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
                    updateVEPlots(timestamps, power, velocity, positionLat, positionLong, altitude, distance, airSpeed, windSpeed, trimStart, trimEnd);

                    // Update VD tab if visible
                    const vdTab = document.getElementById('vd-tab');
                    if (vdTab && vdTab.classList.contains('active')) {
                        createVirtualDistancePlot(timestamps, velocity, airSpeed, distance, trimStart, trimEnd);
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
            const errorMetric = calculateAirSpeedSyncError(velocity, airSpeed, value, trimStart, trimEnd);
            if (airSpeedOffsetErrorMetric && !isNaN(errorMetric)) {
                airSpeedOffsetErrorMetric.textContent = errorMetric.toFixed(2);
            }

            // Trigger full recalculation with new offset
            updateVEPlots(timestamps, power, velocity, positionLat, positionLong, altitude, distance, airSpeed, windSpeed, trimStart, trimEnd);

            // Update wind plot if visible
            const windTab = document.getElementById('wind-tab');
            if (windTab && windTab.classList.contains('active')) {
                createWindSpeedPlot(timestamps, velocity, airSpeed, distance, trimStart, trimEnd);
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
            const errorMetric = calculateAirSpeedSyncError(velocity, airSpeed, clamped, trimStart, trimEnd);
            if (airSpeedOffsetErrorMetric && !isNaN(errorMetric)) {
                airSpeedOffsetErrorMetric.textContent = errorMetric.toFixed(2);
            }

            // Trigger full recalculation
            updateVEPlots(timestamps, power, velocity, positionLat, positionLong, altitude, distance, airSpeed, windSpeed, trimStart, trimEnd);

            // Update wind plot if visible
            const windTab = document.getElementById('wind-tab');
            if (windTab && windTab.classList.contains('active')) {
                createWindSpeedPlot(timestamps, velocity, airSpeed, distance, trimStart, trimEnd);
            }

            // Save settings
            saveCurrentLapSettings();
        };

        airSpeedOffsetSlider.addEventListener('input', updateAirSpeedOffset);
        airSpeedOffsetValue.addEventListener('change', updateAirSpeedOffsetFromInput);

        // Calculate initial error metric
        const trimStart = parseInt(trimStartSlider.value);
        const trimEnd = parseInt(trimEndSlider.value);
        const initialOffset = currentParameters?.air_speed_offset ?? 2;
        const initialError = calculateAirSpeedSyncError(velocity, airSpeed, initialOffset, trimStart, trimEnd);
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

function updateVEPlots(timestamps: number[], power: number[], velocity: number[], positionLat: number[], positionLong: number[], altitude: number[], distance: number[], airSpeed: number[], windSpeed: number[], trimStart: number, trimEnd: number) {
    // Check which wind source is currently selected
    const windSourceRadio = document.querySelector('input[name="windSource"]:checked') as HTMLInputElement;
    const windSource = windSourceRadio ? windSourceRadio.value : 'fit';

    console.log('updateVEPlots: Using wind source:', windSource);

    // Use the wind source specific function
    updateVEPlotsWithWindSource(timestamps, power, velocity, positionLat, positionLong, altitude, distance, airSpeed, windSpeed, trimStart, trimEnd, windSource);
}

async function updateVEPlotsWithWindSource(timestamps: number[], power: number[], velocity: number[], positionLat: number[], positionLong: number[], altitude: number[], distance: number[], airSpeed: number[], windSpeed: number[], trimStart: number, trimEnd: number, windSource: string) {
    const cdaSlider = document.getElementById('cdaSlider') as HTMLInputElement;
    const crrSlider = document.getElementById('crrSlider') as HTMLInputElement;

    const cda = parseFloat(cdaSlider.value);
    const crr = parseFloat(crrSlider.value);

    try {
        if (windSource === 'compare') {
            // Compare both methods - create two calculators

            // Calculator 1: Use constant wind
            const constantWindAirSpeed = new Array(airSpeed.length).fill(NaN);
            const constantWindSpeed = new Array(windSpeed.length).fill(NaN);
            const calculator1 = create_ve_calculator(
                timestamps,
                power,
                velocity,
                positionLat,
                positionLong,
                altitude,
                distance,
                constantWindAirSpeed,
                constantWindSpeed,
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

            // Calculator 2: Use FIT file air speed
            // Apply air speed time offset first (to sync with ground speed)
            const airSpeedOffset = currentParameters?.air_speed_offset ?? 2;
            const offsetAirSpeed = applyAirSpeedOffset(airSpeed, airSpeedOffset);

            // Then apply air speed calibration if set
            const calibratedAirSpeed = airSpeedCalibrationPercent !== 0
                ? offsetAirSpeed.map(speed => speed * (1.0 + airSpeedCalibrationPercent / 100.0))
                : offsetAirSpeed;

            const calculator2 = create_ve_calculator(
                timestamps,
                power,
                velocity,
                positionLat,
                positionLong,
                altitude,
                distance,
                calibratedAirSpeed,
                windSpeed,
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
            veCalculator = calculator2;

            const result1 = calculator1.calculate_virtual_elevation(cda, crr, trimStart, trimEnd);
            const result2 = calculator2.calculate_virtual_elevation(cda, crr, trimStart, trimEnd);

            // Store first result globally for save functionality (use constant wind result)
            currentVEResult = result1;
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
            let useAirSpeed: number[];
            let useWindSpeed: number[];

            if (windSource === 'constant') {
                // Use constant wind - set air_speed to NaN to force fallback to constant wind
                // If no constant wind is configured, it will use 0
                useAirSpeed = new Array(airSpeed.length).fill(NaN);
                useWindSpeed = new Array(windSpeed.length).fill(NaN);
                console.log('Using constant wind - air_speed and wind_speed arrays filled with NaN');
                console.log('Wind speed param:', currentParameters.wind_speed ?? 0, 'Wind direction:', currentParameters.wind_direction ?? 0);
            } else {
                // Use FIT file air speed
                // Apply time offset first
                const airSpeedOffset = currentParameters?.air_speed_offset ?? 2;
                useAirSpeed = applyAirSpeedOffset(airSpeed, airSpeedOffset);
                useWindSpeed = windSpeed;
                console.log('Using FIT air speed with offset:', airSpeedOffset, 'seconds');
                console.log('Sample offset air_speed values:', useAirSpeed.slice(0, 5));
                console.log('Non-zero air_speed count:', useAirSpeed.filter(v => !isNaN(v) && v !== 0).length);
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

            // Apply air speed calibration if set (after offset)
            const calibratedAirSpeed = airSpeedCalibrationPercent !== 0
                ? useAirSpeed.map(speed => speed * (1.0 + airSpeedCalibrationPercent / 100.0))
                : useAirSpeed;

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
                    new Float64Array(calibratedAirSpeed),
                    new Float64Array(useWindSpeed),
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
                    new Float64Array(calibratedAirSpeed),
                    new Float64Array(useWindSpeed),
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
            veCalculator = calculator;

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
                    calibratedAirSpeed, useWindSpeed,
                    cda, crr, trimStart, trimEnd, result
                );
            }
        }

    } catch (error) {
        console.error('Error updating VE plots with wind source:', error);
    }
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
    airSpeed: number[],
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
            airSpeed, windSpeed,
            new Float64Array(currentRhoArray),
            currentParameters.system_mass, currentParameters.rho, currentParameters.eta,
            currentParameters.cda, crrOptimized,
            currentParameters.cda_min, currentParameters.cda_max,
            currentParameters.crr_min, currentParameters.crr_max,
            currentParameters.wind_speed, currentParameters.wind_direction, currentParameters.velodrome
        )
        : create_ve_calculator(
            timestamps, power, velocity, positionLat, positionLong, altitude, distance,
            airSpeed, windSpeed,
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

async function createWindSpeedPlot(timestamps: number[], velocity: number[], airSpeed: number[], distance: number[], trimStart: number, trimEnd: number) {
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
    const hasAirSpeed = airSpeed.some(val => !isNaN(val) && val !== 0);
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

    // Calculate FIT air speed in km/h (with offset applied)
    const airSpeedOffset = currentParameters?.air_speed_offset ?? 2;
    const offsetAirSpeed = hasAirSpeed ? applyAirSpeedOffset(airSpeed, airSpeedOffset) : airSpeed;
    const airSpeedKmh = hasAirSpeed ? offsetAirSpeed.map(v => isNaN(v) ? null : v * 3.6) : [];

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

        // FIT air speed context
        if (hasAirSpeed) {
            traces.push({
                x: timePointsBefore,
                y: airSpeedKmh.slice(extendedStart, trimStart + 1),
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

    // FIT air speed
    if (hasAirSpeed) {
        traces.push({
            x: timePointsMain,
            y: airSpeedKmh.slice(trimStart, trimEnd + 1), // +1 for inclusive trimEnd
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

        // FIT air speed context
        if (hasAirSpeed) {
            traces.push({
                x: timePointsAfter,
                y: airSpeedKmh.slice(trimEnd, extendedEnd),
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

async function createVirtualDistancePlot(timestamps: number[], velocity: number[], airSpeed: number[], distance: number[], trimStart: number, trimEnd: number) {
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

    // Apply air speed calibration
    const calibratedAirSpeed = airSpeedCalibrationPercent !== 0
        ? airSpeed.map(speed => speed * (1.0 + airSpeedCalibrationPercent / 100.0))
        : airSpeed;

    // Calculate cumulative virtual distances starting from trimStart (both start at 0)
    const vdAir: number[] = new Array(timestamps.length).fill(0);
    const vdGround: number[] = new Array(timestamps.length).fill(0);

    // Calculate from trim start onwards
    for (let i = trimStart + 1; i < timestamps.length; i++) {
        const dt = timestamps[i] - timestamps[i - 1];

        // Air speed VD (cumulative with calibration)
        const airSpeedVal = (!isNaN(calibratedAirSpeed[i]) && calibratedAirSpeed[i] > 0) ? calibratedAirSpeed[i] : 0;
        const airDist = airSpeedVal * dt;
        vdAir[i] = vdAir[i - 1] + airDist;

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