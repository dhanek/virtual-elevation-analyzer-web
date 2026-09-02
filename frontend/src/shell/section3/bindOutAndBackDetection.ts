import { AppState } from '../../state/AppState';
import { ParameterStorage } from '../../utils/ParameterStorage';
import { MapVisualization } from '../../components/MapVisualization';
import { log } from '../../utils/log';

export interface OutAndBackDetectionCallbacks {
    getSelectedDataTimeRange: () => { startTime: number; endTime: number; duration: number };
    findDataIndexAtTimeOffset: (timeOffset: number, startTime: number) => number | null;
    runOutAndBackDetection: (markerALat: number, markerALon: number, markerBLat: number, markerBLon: number) => void;
    /**
     * Hand the caller a "re-run detection with the gates where they are now"
     * closure.
     *
     * The detection window is scoped to the SELECTED FIT LAPS — both detectors
     * derive `trimStart`/`trimEnd` from `appState.selectedLaps` — but nothing
     * re-ran them when that selection changed, so ticking another lap left the
     * detected list, and the VE panel built from it, describing the old window.
     * The only way to provoke a re-detect was to nudge a gate, which is what
     * this closure does minus the nudge: the offset is re-read from the slider
     * and re-resolved against the CURRENT selection's time range, exactly as
     * `getGatePosition` does for a real drag.
     */
    registerRedetect?: (redetect: () => void) => void;
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

    /**
     * Point both sliders at the gates belonging to THE CURRENT FIT LAP
     * SELECTION. The GPS-lap twin's doc (`bindGpsDetection.ts`) explains why
     * this is a function: gates are stored per `(fileHash, selectedLaps)`, so a
     * selection change is a different KEY and quite possibly a different pair of
     * gates, not the same pair in a resized window.
     *
     * Returns false when the selection spans no time.
     */
    const resolveGatesForSelection = async (
        carry: { a: number; b: number } | null,
        isSuperseded: () => boolean = () => false,
    ): Promise<boolean> => {
        const maxSeconds = Math.floor(callbacks.getSelectedDataTimeRange().duration);
        if (maxSeconds <= 0) {
            log.warn('Invalid duration for Out and Back detection:', maxSeconds);
            return false;
        }

        // Defaults only where there is no user intent to preserve — see the
        // GPS-lap twin for why a selection change carries the current pair
        // instead of resetting to them.
        let offsetA = carry?.a ?? 5;  // Default 5 seconds
        let offsetB = carry?.b ?? Math.min(60, maxSeconds - 5);  // Default 60 seconds or near end
        if (appState.currentFileHash) {
            try {
                const savedMarkers = await parameterStorage.loadOutAndBackMarkerSettings(appState.currentFileHash, appState.selectedLaps);
                if (savedMarkers && savedMarkers.gateATimeOffset !== undefined && savedMarkers.gateBTimeOffset !== undefined) {
                    offsetA = savedMarkers.gateATimeOffset;
                    offsetB = savedMarkers.gateBTimeOffset;
                    log.debug('Loading saved Out and Back gate time offsets:', { A: offsetA, B: offsetB });
                }
            } catch (err) {
                log.error('Failed to load saved Out and Back marker settings:', err);
            }
        }

        if (isSuperseded()) return false;

        gateASlider.max = String(maxSeconds);
        gateAValue.max = String(maxSeconds);
        gateBSlider.max = String(maxSeconds);
        gateBValue.max = String(maxSeconds);

        // Clamp to valid range, A strictly before B.
        offsetA = Math.max(0, Math.min(offsetA, maxSeconds - 1));
        offsetB = Math.max(offsetA + 1, Math.min(offsetB, maxSeconds));
        gateASlider.value = String(offsetA);
        gateAValue.value = String(offsetA);
        gateBSlider.value = String(offsetB);
        gateBValue.value = String(offsetB);
        return true;
    };

    if (!(await resolveGatesForSelection(null))) return;

    // Show slider controls
    sliderControls.classList.remove('hidden');

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
    const updateGates = async (persist = true) => {
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

        // Save settings — ONLY WHEN THE USER MOVED A GATE. The key includes
        // `appState.selectedLaps`, read here at call time, so a pass triggered by
        // a FIT selection change would write the outgoing combination's offsets
        // under the incoming combination's key and destroy the gates the user had
        // saved for those laps. See the GPS-lap twin.
        if (persist && appState.currentFileHash) {
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

    let redetectToken = 0;
    callbacks.registerRedetect?.(() => {
        const token = ++redetectToken;
        void (async () => {
            const carry = {
                a: parseInt(gateASlider.value),
                b: parseInt(gateBSlider.value),
            };
            if (!(await resolveGatesForSelection(carry, () => token !== redetectToken))) return;
            void updateGates(false);
        })();
    });

    // Initial detection with the loaded/default offsets — ONLY WHEN FIT LAPS
    // ARE SELECTED, matching `bindGpsDetection`. Without a selection the
    // time-range helpers fall back to the whole activity, so this detected
    // whole-track sections; and now that `runOutAndBackDetection` auto-selects
    // what it finds, those went straight into `outAndBackSelectedSections` —
    // which is exactly what `analyzeOrchestrator.ts:245` reads for
    // `hasSelectedLaps`, so Analyze came up enabled over the entire ride before
    // the user had chosen anything.
    //
    // Not persisted: the offsets were just read out of storage, so writing them
    // back says nothing.
    if (appState.selectedLaps.length > 0) {
        void updateGates(false);
    }
}
