import { AppState } from '../../state/AppState';
import { ParameterStorage } from '../../utils/ParameterStorage';
import { MapVisualization } from '../../components/MapVisualization';
import { log } from '../../utils/log';

export interface OutAndBackDetectionCallbacks {
    getSelectedDataTimeRange: () => { startTime: number; endTime: number; duration: number };
    findDataIndexAtTimeOffset: (timeOffset: number, startTime: number) => number | null;
    runOutAndBackDetection: (markerALat: number, markerALon: number, markerBLat: number, markerBLon: number) => void;
}

/**
 * Bind Out-and-Back gate slider and input events.
 * Extracted from setupOutAndBackDetection in main.ts.
 *
 * @param appState - The application state
 * @param parameterStorage - Service for persisting marker settings
 * @param mapVisualization - Leaflet map wrapper
 * @param callbacks - Callbacks for time range, indexing, and running detection
 */
export async function bindOutAndBackDetection(
    appState: AppState,
    parameterStorage: ParameterStorage,
    mapVisualization: MapVisualization | null,
    callbacks: OutAndBackDetectionCallbacks
): Promise<void> {
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
    const timeRange = callbacks.getSelectedDataTimeRange();
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

    // Helper to get gate position info from time offset
    const getGatePosition = (timeOffset: number) => {
        const currentTimeRange = callbacks.getSelectedDataTimeRange();
        const gateIndex = callbacks.findDataIndexAtTimeOffset(timeOffset, currentTimeRange.startTime);
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

        // Run detection if both gates are valid
        if (posA && posB) {
            callbacks.runOutAndBackDetection(posA.lat, posA.lon, posB.lat, posB.lon);
        }
    };

    gateASlider.oninput = () => {
        let val = parseInt(gateASlider.value);
        const maxA = parseInt(gateBSlider.value) - 1;
        if (val >= maxA) {
            val = maxA;
            gateASlider.value = String(val);
        }
        gateAValue.value = String(val);
        void updateGates();
    };

    gateAValue.onchange = () => {
        const maxA = parseInt(gateBSlider.value) - 1;
        const val = Math.max(0, Math.min(parseInt(gateAValue.value) || 0, maxA));
        gateAValue.value = String(val);
        gateASlider.value = String(val);
        void updateGates();
    };

    gateBSlider.oninput = () => {
        let val = parseInt(gateBSlider.value);
        const minB = parseInt(gateASlider.value) + 1;
        if (val <= minB) {
            val = minB;
            gateBSlider.value = String(val);
        }
        gateBValue.value = String(val);
        void updateGates();
    };

    gateBValue.onchange = () => {
        const maxSecondsNow = parseInt(gateBSlider.max);
        const minB = parseInt(gateASlider.value) + 1;
        const val = Math.max(minB, Math.min(parseInt(gateBValue.value) || 0, maxSecondsNow));
        gateBValue.value = String(val);
        gateBSlider.value = String(val);
        void updateGates();
    };

    // Initial detection with loaded/defaults
    void updateGates();
}
