import { DataProtection } from './utils/DataProtection';
import { FitFileProcessor } from './components/FitFileProcessor';
import { MapVisualization } from './components/MapVisualization';
import { AnalysisParametersComponent, AnalysisParameters } from './components/AnalysisParameters';
import { ViewportAdapter } from './utils/ViewportAdapter';
import init, { create_ve_calculator } from '../pkg/virtual_elevation_analyzer.js';

// Plotly.js type declaration
declare const Plotly: any;

// Helper function to dynamically load and wait for Plotly
function waitForPlotly(): Promise<any> {
    return new Promise((resolve, reject) => {
        // Check if already loaded
        if (typeof (window as any).Plotly !== 'undefined') {
            console.log('Plotly already loaded');
            resolve((window as any).Plotly);
            return;
        }

        console.log('Loading Plotly dynamically...');

        // Load Plotly script dynamically
        const script = document.createElement('script');
        script.src = 'https://cdn.plot.ly/plotly-basic-2.27.0.min.js'; // Use basic bundle (no eval required)
        script.async = false;
        script.crossOrigin = 'anonymous';

        script.onload = () => {
            console.log('Plotly script loaded successfully');
            // Give it a moment to initialize
            setTimeout(() => {
                if (typeof (window as any).Plotly !== 'undefined') {
                    console.log('Plotly is now available');
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

        console.log('Appending Plotly script to document head');
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

let selectedFile: File | null = null;
let fitProcessor: FitFileProcessor | null = null;
let mapVisualization: MapVisualization | null = null;
let parametersComponent: AnalysisParametersComponent | null = null;
let viewportAdapter: ViewportAdapter;
let currentFitData: any = null;
let currentFitResult: any = null;
let currentLaps: any[] = [];
let selectedLaps: number[] = [];
let currentParameters: AnalysisParameters | null = null;
let filteredVEData: { positionLat: number[], positionLong: number[] } | null = null;
let mapTrimControlsInitialized = false;
let presetTrimStart: number = 0;
let presetTrimEnd: number | null = null;

// Initialize FIT processor
async function initializeFitProcessor() {
    try {
        showLoading('Initializing WebAssembly module...');

        // Initialize the Virtual Elevation WASM module
        await init();
        console.log('Virtual Elevation WASM module initialized');

        fitProcessor = new FitFileProcessor();
        await fitProcessor.initialize();
        console.log('FIT processor initialized successfully');
        hideLoading();
        hideError();
    } catch (err) {
        console.error('Failed to initialize FIT processor:', err);
        hideLoading();
        const errorMessage = err instanceof Error ? err.message : 'Unknown error';
        showError(`Failed to initialize WASM module: ${errorMessage}. Check browser console for details.`);
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

// File validation and display
function handleFileSelection(file: File) {
    // Validate file type and size
    if (!DataProtection.validateFileType(file)) {
        showError('Please select a valid FIT file (.fit extension, under 50MB)');
        return;
    }

    selectedFile = file;
    displayFileInfo(file);
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
        showLoading('Reading FIT file...');

        // Additional validation
        const isValidMagicNumber = await DataProtection.validateFitMagicNumber(selectedFile);
        if (!isValidMagicNumber) {
            showError('Invalid FIT file format. Please select a valid FIT file.');
            hideLoading();
            return;
        }

        showLoading('Parsing FIT data...');

        const result = await fitProcessor.processFitFile(selectedFile);

        hideLoading();
        displayResults(result);

        // Activate section 2 (parameters) and 3 (lap selection) after successful file analysis
        activateSection(2);

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
});

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
function displayResults(result: any) {
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
    `;

    results.classList.remove('hidden');

    // Store data for section 3
    currentFitResult = result;
    currentFitData = result.fit_data;
    currentLaps = laps;

    // Initialize analysis parameters component immediately
    initializeAnalysisParameters();

    // Auto-enable velodrome mode if no GPS data (do this AFTER parameters component is initialized)
    if (!result.parsing_statistics.has_gps_data && parametersComponent) {
        console.log('No GPS data found - auto-enabling velodrome mode');
        parametersComponent.setParameters({ velodrome: true });
    }
}

// Generate record table rows
function generateRecordTableRows(fitData: any): string {
    const timestamps = fitData.timestamps;
    const lats = fitData.position_lat;
    const longs = fitData.position_long;
    const cadences = fitData.cadence;
    const distances = fitData.distance;
    const powers = fitData.power;
    const speeds = fitData.velocity; // Enhanced speed
    const altitudes = fitData.altitude; // Enhanced altitude
    const windSpeeds = fitData.wind_speed;
    const airSpeeds = fitData.air_speed;

    // Show first 10 records
    const recordCount = Math.min(10, timestamps.length);
    let rows = '';

    for (let i = 0; i < recordCount; i++) {
        const time = new Date(timestamps[i] * 1000).toLocaleTimeString();
        const distance = distances[i] ? distances[i].toFixed(2) : 'N/A';
        const speed = speeds[i] && speeds[i] > 0 ? (speeds[i] * 3.6).toFixed(1) : 'N/A'; // Convert m/s to km/h
        const power = powers[i] && powers[i] > 0 ? powers[i].toFixed(0) : 'N/A';
        const altitude = altitudes[i] && altitudes[i] !== 0 ? altitudes[i].toFixed(1) : 'N/A';
        const lat = lats[i] && lats[i] !== 0 ? lats[i].toFixed(6) : 'N/A';
        const long = longs[i] && longs[i] !== 0 ? longs[i].toFixed(6) : 'N/A';
        const cadence = cadences[i] && cadences[i] > 0 ? cadences[i].toFixed(0) : 'N/A';
        const airSpeed = airSpeeds[i] && airSpeeds[i] !== 0 ? airSpeeds[i].toFixed(2) : 'N/A';
        const windSpeed = windSpeeds[i] && windSpeeds[i] !== 0 ? windSpeeds[i].toFixed(2) : 'N/A';

        rows += `
            <tr>
                <td>${time}</td>
                <td>${distance}</td>
                <td>${speed}</td>
                <td>${power}</td>
                <td>${altitude}</td>
                <td>${lat}</td>
                <td>${long}</td>
                <td>${cadence}</td>
                <td>${airSpeed}</td>
                <td>${windSpeed}</td>
            </tr>
        `;
    }

    return rows;
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
        console.log('Viewport changed:', viewportInfo);

        // Update CSS custom properties for sidebar width
        const sidebarWidth = viewportAdapter.getOptimalSidebarWidth();
        document.documentElement.style.setProperty('--sidebar-width', `${sidebarWidth}px`);

        // Trigger map resize if map exists
        if (mapVisualization && mapVisualization.hasGpsData()) {
            // Map libraries usually need a resize trigger when container dimensions change
            mapVisualization.resizeMap();
            console.log('Triggered map resize for new viewport');
        }
    });

    // Log initial viewport info
    const initialViewport = viewportAdapter.getViewportInfo();
    console.log('Initial viewport setup:', {
        category: initialViewport.category,
        dimensions: `${initialViewport.width}x${initialViewport.height}`,
        mapHeight: document.documentElement.style.getPropertyValue('--map-height'),
        contentWidth: document.documentElement.style.getPropertyValue('--content-max-width'),
        sidebarWidth: document.documentElement.style.getPropertyValue('--sidebar-width')
    });

    // Initialize FIT processor
    await initializeFitProcessor();
}

// Initialize the application
initializeApplication();

// Map visualization and lap selection functions
async function initializeMapVisualization(result: any) {
    try {
        currentFitResult = result;
        currentFitData = result.fit_data;
        currentLaps = result.laps;
        selectedLaps = [];

        // Initialize map visualization
        mapVisualization = new MapVisualization('mapView');
        await mapVisualization.initialize();

        // Set data
        mapVisualization.setData(currentFitData, currentLaps);

        // Setup lap selection event handlers
        setupLapSelectionHandlers();

        console.log('Map initialized with data:', {
            records: currentFitData.timestamps.length,
            laps: currentLaps.length,
            hasGPS: mapVisualization.hasGpsData()
        });

    } catch (error) {
        console.error('Error initializing map:', error);
        const mapContainer = document.getElementById('mapView');
        if (mapContainer) {
            mapContainer.innerHTML = '<div class="no-gps-message">Error loading map visualization</div>';
        }
    }
}

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

    console.log('Map trim controls initialized with lap data length:', dataLength);
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

    console.log('Selected laps:', selectedLaps);

    // Show/hide trim controls based on lap selection
    const mapTrimControls = document.getElementById('mapTrimControls');
    if (mapTrimControls) {
        if (selectedLaps.length > 0) {
            mapTrimControls.style.display = 'flex';
            // Calculate total duration of selected laps
            initializeMapTrimControlsForSelectedLaps();
        } else {
            mapTrimControls.style.display = 'none';
        }
    }

    // Update analyze button in section 3
    updateAnalyzeButton();
}

function initializeMapTrimControlsForSelectedLaps() {
    if (!currentFitResult || !currentLaps || selectedLaps.length === 0) return;

    // Get selected lap data
    const selectedLapData = selectedLaps.map(lapNumber => currentLaps[lapNumber - 1]);
    const fitData = currentFitResult.fit_data;
    const allTimestamps = fitData.timestamps;
    const hasGpsData = currentFitResult.parsing_statistics?.has_gps_data ?? false;

    // Get time ranges for selected laps
    const selectedLapTimeRanges = selectedLapData.map(lap => ({
        start: lap.start_time,
        end: lap.end_time
    }));

    // Filter GPS data for selected laps (if available)
    const filteredLapPositionLat: number[] = [];
    const filteredLapPositionLong: number[] = [];

    let dataLength = 0;

    if (hasGpsData) {
        const allPositionLat = fitData.position_lat;
        const allPositionLong = fitData.position_long;

        for (let i = 0; i < allTimestamps.length; i++) {
            const timestamp = allTimestamps[i];
            const isInSelectedLap = selectedLapTimeRanges.some(range =>
                timestamp >= range.start && timestamp <= range.end
            );
            if (isInSelectedLap) {
                filteredLapPositionLat.push(allPositionLat[i]);
                filteredLapPositionLong.push(allPositionLong[i]);
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
                dataLength++;
            }
        }
    }

    console.log('Initializing map trim controls for selected laps:', {
        selectedLaps,
        dataLength,
        hasGpsData,
        filteredGPSPoints: hasGpsData ? filteredLapPositionLat.length : 'N/A'
    });

    // Initialize the controls with correct data length
    initializeMapTrimControls(dataLength);

    // Set preset values to defaults
    presetTrimStart = 0;
    presetTrimEnd = dataLength - 1;

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

        // Add new listeners
        newMapTrimStartSlider.addEventListener('input', () => {
            const value = parseInt(newMapTrimStartSlider.value);
            newMapTrimStartValue.value = value.toString();
            presetTrimStart = value;
            console.log('Preset trim start:', presetTrimStart);

            // Update map markers immediately (before analyze) - use filtered lap GPS data
            if (mapVisualization) {
                const trimEnd = presetTrimEnd ?? dataLength - 1;
                mapVisualization.fitBoundsToTrimRegion(value, trimEnd, filteredLapPositionLat, filteredLapPositionLong);
            }
        });

        newMapTrimEndSlider.addEventListener('input', () => {
            const value = parseInt(newMapTrimEndSlider.value);
            newMapTrimEndValue.value = value.toString();
            presetTrimEnd = value;
            console.log('Preset trim end:', presetTrimEnd);

            // Update map markers immediately (before analyze) - use filtered lap GPS data
            if (mapVisualization) {
                mapVisualization.fitBoundsToTrimRegion(presetTrimStart, value, filteredLapPositionLat, filteredLapPositionLong);
            }
        });

        newMapTrimStartValue.addEventListener('change', () => {
            const value = parseInt(newMapTrimStartValue.value);
            if (!isNaN(value)) {
                const trimEnd = presetTrimEnd ?? dataLength - 1;
                const clamped = Math.max(0, Math.min(value, trimEnd - 30));
                newMapTrimStartSlider.value = clamped.toString();
                newMapTrimStartValue.value = clamped.toString();
                presetTrimStart = clamped;
                console.log('Preset trim start (text input):', presetTrimStart);

                // Update map markers immediately (before analyze) - use filtered lap GPS data
                if (mapVisualization) {
                    mapVisualization.fitBoundsToTrimRegion(clamped, trimEnd, filteredLapPositionLat, filteredLapPositionLong);
                }
            }
        });

        newMapTrimEndValue.addEventListener('change', () => {
            const value = parseInt(newMapTrimEndValue.value);
            if (!isNaN(value)) {
                const clamped = Math.max(presetTrimStart + 30, Math.min(value, dataLength - 1));
                newMapTrimEndSlider.value = clamped.toString();
                newMapTrimEndValue.value = clamped.toString();
                presetTrimEnd = clamped;
                console.log('Preset trim end (text input):', presetTrimEnd);

                // Update map markers immediately (before analyze) - use filtered lap GPS data
                if (mapVisualization) {
                    mapVisualization.fitBoundsToTrimRegion(presetTrimStart, clamped, filteredLapPositionLat, filteredLapPositionLong);
                }
            }
        });
    }

    mapTrimControlsInitialized = true;
}

// Analysis parameters initialization
function initializeAnalysisParameters() {
    try {
        parametersComponent = new AnalysisParametersComponent('analysisParameters', handleParametersChange);

        // Initialize currentParameters with the default values from the component
        currentParameters = parametersComponent.getParameters();
        console.log('Analysis parameters component initialized with defaults:', currentParameters);

        // Update analyze button with the default parameters
        updateAnalyzeButton();
    } catch (error) {
        console.error('Error initializing analysis parameters:', error);
    }
}

function handleParametersChange(parameters: AnalysisParameters) {
    currentParameters = parameters;
    console.log('Parameters updated:', parameters);

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

    // If VE analysis is already visible, recalculate when parameters change
    const veSection = document.getElementById('veSection');
    if (veSection && !veSection.classList.contains('hidden')) {
        console.log('VE analysis visible - recalculating with new parameters');
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

    try {
        showLoading('Preparing data for Virtual Elevation analysis...');

        // Collect data from selected laps
        // Convert 1-based lap numbers to 0-based array indices
        const selectedLapData = selectedLaps.map(lapNumber => currentLaps[lapNumber - 1]);
        console.log('Selected lap data structure:', selectedLapData);

        // Debug: Check the full result structure
        console.log('currentFitResult structure:', currentFitResult);
        console.log('currentFitResult keys:', currentFitResult ? Object.keys(currentFitResult) : 'null');

        // Use the fit_data WASM object which contains all the data arrays
        if (!currentFitResult || !currentFitResult.fit_data) {
            throw new Error('No FIT data available');
        }

        const fitData = currentFitResult.fit_data;

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

        // Create Virtual Elevation calculator with filtered data
        const calculator = create_ve_calculator(
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

        hideLoading();

        // Store filtered position data for map trimming
        filteredVEData = {
            positionLat: filteredPositionLat,
            positionLong: filteredPositionLong
        };

        // Show the Virtual Elevation analysis interface inline
        showVirtualElevationAnalysisInline(result, selectedLaps, filteredTimestamps, filteredPower, filteredVelocity, filteredPositionLat, filteredPositionLong, filteredAltitude, filteredDistance, filteredAirSpeed, filteredWindSpeed);

    } catch (err) {
        console.error('Virtual Elevation analysis failed:', err);
        hideLoading();
        const errorMessage = err instanceof Error ? err.message : 'Unknown error';
        showError(`Virtual Elevation analysis failed: ${errorMessage}`);
    }
}


function showVirtualElevationAnalysisInline(initialResult: any, analyzedLaps: number[], timestamps: number[], power: number[], velocity: number[], positionLat: number[], positionLong: number[], altitude: number[], distance: number[], airSpeed: number[], windSpeed: number[]) {
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
                        </div>
                    </div>

                    <div class="ve-sidebar-footer">
                        <button id="saveVeResults" class="primary-btn" style="width: 100%;">Save Results</button>
                    </div>
                </div>

                <!-- Plots Main Area -->
                <div class="ve-plots-main">
                    <div class="ve-plots">
                <div class="ve-tabs">
                    <button class="ve-tab-button active" data-tab="ve">VE</button>
                    ${(hasAirSpeed || hasConstantWind) ? `
                    <button class="ve-tab-button" data-tab="wind">Wind</button>
                    ` : ''}
                    <button class="ve-tab-button" data-tab="power">Power</button>
                </div>

                <div class="ve-tab-content active" id="ve-tab">
                    <div class="ve-metrics-compact">
                        R²:<span id="r2Value">${initialResult.r2.toFixed(4)}</span> |
                        RMSE:<span id="rmseValue">${initialResult.rmse.toFixed(2)}m</span> |
                        VE:<span id="veGainValue">${initialResult.ve_elevation_diff.toFixed(1)}m</span> |
                        Actual:<span id="actualGainValue">${initialResult.actual_elevation_diff.toFixed(1)}m</span>
                    </div>
                    <div id="vePlot" class="ve-plot" style="margin-bottom: 0; height: 380px;"></div>
                    <div id="veResidualsPlot" class="ve-plot" style="margin-top: 0; height: 220px;"></div>
                </div>

                ${(hasAirSpeed || hasConstantWind) ? `
                <div class="ve-tab-content" id="wind-tab">
                    <div id="windSpeedPlot" class="ve-plot" style="height: 600px;"></div>
                </div>
                ` : ''}

                <div class="ve-tab-content" id="power-tab">
                    <div id="speedPowerPlot" class="ve-plot" style="height: 600px;"></div>
                </div>
                    </div>
                </div>
            </div>
        </div>
    `;

    // Initialize the VE analysis interface
    initializeVEAnalysis(timestamps, power, velocity, positionLat, positionLong, altitude, distance, airSpeed, windSpeed, analyzedLaps);

    // Scroll to the VE analysis section
    veSection.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

function initializeVEAnalysis(timestamps: number[], power: number[], velocity: number[], positionLat: number[], positionLong: number[], altitude: number[], distance: number[], airSpeed: number[], windSpeed: number[], analyzedLaps: number[]) {
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

        // Update map markers with preset trim values after analyze
        if (mapVisualization && filteredVEData) {
            console.log('Setting map trim markers to preset values after analyze');
            mapVisualization.fitBoundsToTrimRegion(initialTrimStart, initialTrimEnd, filteredVEData.positionLat, filteredVEData.positionLong);
        }
    }, 500);
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

        // Auto-zoom map to trim region
        if (mapVisualization && filteredVEData) {
            mapVisualization.fitBoundsToTrimRegion(value, trimEnd, filteredVEData.positionLat, filteredVEData.positionLong);
        }
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

        // Auto-zoom map to trim region
        if (mapVisualization && filteredVEData) {
            mapVisualization.fitBoundsToTrimRegion(trimStart, value, filteredVEData.positionLat, filteredVEData.positionLong);
        }
    };

    const updateCdA = () => {
        const value = parseFloat(cdaSlider.value);
        cdaValue.value = value.toFixed(3);

        const trimStart = parseInt(trimStartSlider.value);
        const trimEnd = parseInt(trimEndSlider.value);
        updateVEPlots(timestamps, power, velocity, positionLat, positionLong, altitude, distance, airSpeed, windSpeed, trimStart, trimEnd);
    };

    const updateCrr = () => {
        const value = parseFloat(crrSlider.value);
        crrValue.value = value.toFixed(4);

        const trimStart = parseInt(trimStartSlider.value);
        const trimEnd = parseInt(trimEndSlider.value);
        updateVEPlots(timestamps, power, velocity, positionLat, positionLong, altitude, distance, airSpeed, windSpeed, trimStart, trimEnd);
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

        if (mapVisualization && filteredVEData) {
            mapVisualization.fitBoundsToTrimRegion(clamped, trimEnd, filteredVEData.positionLat, filteredVEData.positionLong);
        }
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

        if (mapVisualization && filteredVEData) {
            mapVisualization.fitBoundsToTrimRegion(trimStart, clamped, filteredVEData.positionLat, filteredVEData.positionLong);
        }
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
    };

    // Add event listeners for sliders
    trimStartSlider.addEventListener('input', updateTrimStart);
    trimEndSlider.addEventListener('input', updateTrimEnd);
    cdaSlider.addEventListener('input', updateCdA);
    crrSlider.addEventListener('input', updateCrr);

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

function updateVEPlots(timestamps: number[], power: number[], velocity: number[], positionLat: number[], positionLong: number[], altitude: number[], distance: number[], airSpeed: number[], windSpeed: number[], trimStart: number, trimEnd: number) {
    // Check which wind source is currently selected
    const windSourceRadio = document.querySelector('input[name="windSource"]:checked') as HTMLInputElement;
    const windSource = windSourceRadio ? windSourceRadio.value : 'fit';

    console.log('updateVEPlots: Using wind source:', windSource);

    // Use the wind source specific function
    updateVEPlotsWithWindSource(timestamps, power, velocity, positionLat, positionLong, altitude, distance, airSpeed, windSpeed, trimStart, trimEnd, windSource);
}

function updateVEPlotsWithWindSource(timestamps: number[], power: number[], velocity: number[], positionLat: number[], positionLong: number[], altitude: number[], distance: number[], airSpeed: number[], windSpeed: number[], trimStart: number, trimEnd: number, windSource: string) {
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
            const calculator2 = create_ve_calculator(
                timestamps,
                power,
                velocity,
                positionLat,
                positionLong,
                altitude,
                distance,
                airSpeed,
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

            const result1 = calculator1.calculate_virtual_elevation(cda, crr, trimStart, trimEnd);
            const result2 = calculator2.calculate_virtual_elevation(cda, crr, trimStart, trimEnd);

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
                useAirSpeed = airSpeed;
                useWindSpeed = windSpeed;
                console.log('Using FIT air speed - length:', useAirSpeed.length);
                console.log('Sample air_speed values:', useAirSpeed.slice(0, 5));
                console.log('Non-zero air_speed count:', airSpeed.filter(v => !isNaN(v) && v !== 0).length);
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

            const calculator = create_ve_calculator(
                timestamps,
                power,
                velocity,
                positionLat,
                positionLong,
                altitude,
                distance,
                useAirSpeed,
                useWindSpeed,
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

            const result = calculator.calculate_virtual_elevation(cda, crr, trimStart, trimEnd);

            console.log('VE calculation result:', {
                r2: result.r2,
                rmse: result.rmse,
                veGain: result.ve_elevation_diff,
                actualGain: result.actual_elevation_diff,
                windSource: windSource
            });

            // Update metrics
            updateVEMetrics(result);

            // Use zero altitude for plotting if velodrome mode is enabled
            const plotAltitude = currentParameters.velodrome
                ? new Array(altitude.length).fill(0)
                : altitude;

            // Create plots with Plotly.js
            createVirtualElevationPlots(trimStart, trimEnd, result.virtual_elevation, plotAltitude);
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
        annotations: [{
            text: `CdA: ${cdaValue}<br>Crr: ${crrValue}`,
            xref: 'paper',
            yref: 'paper',
            x: 0.98,
            y: 0.98,
            xanchor: 'right',
            yanchor: 'top',
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

function updateVEMetrics(result: any) {
    const r2Value = document.getElementById('r2Value') as HTMLSpanElement;
    const rmseValue = document.getElementById('rmseValue') as HTMLSpanElement;
    const veGainValue = document.getElementById('veGainValue') as HTMLSpanElement;
    const actualGainValue = document.getElementById('actualGainValue') as HTMLSpanElement;

    if (r2Value) r2Value.textContent = result.r2.toFixed(4);
    if (rmseValue) rmseValue.textContent = result.rmse.toFixed(2) + ' m';
    if (veGainValue) veGainValue.textContent = result.ve_elevation_diff.toFixed(1) + ' m';
    if (actualGainValue) actualGainValue.textContent = result.actual_elevation_diff.toFixed(1) + ' m';
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

        constantWindApparent = velocity.map((v, i) => {
            // Calculate bearing from GPS points
            let bearing = 0;
            if (i > 0 && i < velocity.length) {
                // Simple bearing calculation would go here
                // For now, using simplified approach
                bearing = 0;
            }

            // Calculate effective headwind/tailwind component
            const windAngle = (windDirection - bearing) * Math.PI / 180;
            const effectiveWind = windSpeedMs * Math.cos(windAngle);

            return (v + effectiveWind) * 3.6; // Convert to km/h
        });
    }

    // Calculate FIT air speed in km/h
    const airSpeedKmh = hasAirSpeed ? airSpeed.map(v => isNaN(v) ? null : v * 3.6) : [];

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
            gridcolor: '#e0e0e0'
            // No explicit range - let Plotly auto-scale to show all data (context included)
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
            gridcolor: '#e0e0e0'
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
        margin: { l: 60, r: 60, t: 40, b: 60 },
        plot_bgcolor: '#fafafa',
        paper_bgcolor: 'white'
    };

    Plotly.newPlot('speedPowerPlot', traces, layout, {responsive: true});
}

// Clean up on page unload
window.addEventListener('beforeunload', () => {
    if (mapVisualization) {
        mapVisualization.destroy();
    }
    DataProtection.secureMemoryWipe();
});