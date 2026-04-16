import { AppState } from '../../state/AppState';
import { ParameterStorage } from '../../utils/ParameterStorage';
import { MapVisualization } from '../../components/MapVisualization';
import { log } from '../../utils/log';

export interface GpsDetectionCallbacks {
    getSelectedDataTimeRange: () => { startTime: number; endTime: number; duration: number };
    findDataIndexAtTimeOffset: (timeOffset: number, startTime: number) => number | null;
    runGpsLapDetection: (markerLat: number, markerLon: number, markerIndex: number) => void;
}

/**
 * Bind GPS lap detection slider and input events.
 * Extracted from setupGpsLapDetection in main.ts.
 *
 * @param appState - The application state
 * @param parameterStorage - Service for persisting marker settings
 * @param mapVisualization - Leaflet map wrapper
 * @param callbacks - Callbacks for time range, indexing, and running detection
 */
export async function bindGpsDetection(
    appState: AppState,
    parameterStorage: ParameterStorage,
    mapVisualization: MapVisualization | null,
    callbacks: GpsDetectionCallbacks
): Promise<void> {
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
    const timeRange = callbacks.getSelectedDataTimeRange();
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
        const currentTimeRange = callbacks.getSelectedDataTimeRange();
        // Find the data index for this time offset
        const gateIndex = callbacks.findDataIndexAtTimeOffset(timeOffset, currentTimeRange.startTime);
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
            callbacks.runGpsLapDetection(lat, lon, gateIndex);
        }
    };

    gateSlider.oninput = () => {
        gateValue.value = gateSlider.value;
        void updateGatePosition(parseInt(gateSlider.value));
    };

    gateValue.onchange = () => {
        const maxSecondsNow = parseInt(gateSlider.max);
        const val = Math.max(0, Math.min(parseInt(gateValue.value) || 0, maxSecondsNow));
        gateValue.value = String(val);
        gateSlider.value = String(val);
        void updateGatePosition(val);
    };

    // Initial detection with loaded/default offset
    void updateGatePosition(initialOffset);
}
