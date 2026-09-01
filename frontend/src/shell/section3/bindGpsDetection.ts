import { AppState } from '../../state/AppState';
import { ParameterStorage } from '../../utils/ParameterStorage';
import { MapVisualization } from '../../components/MapVisualization';
import { log } from '../../utils/log';

export interface GpsDetectionCallbacks {
    getSelectedDataTimeRange: () => { startTime: number; endTime: number; duration: number };
    findDataIndexAtTimeOffset: (timeOffset: number, startTime: number) => number | null;
    runGpsLapDetection: (markerLat: number, markerLon: number, markerIndex: number) => void;
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
 * Bind GPS lap detection slider and input events.
 * Extracted from setupGpsLapDetection in main.ts.
 *
 * @param appState - The application state
 * @param parameterStorage - Service for persisting marker settings
 * @param mapVisualization - Leaflet map wrapper
 * @param callbacks - Callbacks for time range, indexing, and running detection
 */
/** The gate offset a combination with nothing saved starts at. */
const DEFAULT_GATE_OFFSET_SECONDS = 5;

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

    /**
     * Point the slider at the gate belonging to THE CURRENT FIT LAP SELECTION.
     *
     * Gates are stored per `(fileHash, selectedLaps)` — see
     * `ParameterStorage.loadGpsMarkerSettings` — so the selection is part of the
     * key, not just of the window. That makes this the whole of "resolve the
     * gate": read the new window's length, load the offset saved for THIS
     * combination, and clamp it in.
     *
     * Called at bind time and again whenever the FIT selection moves, which is
     * why it is a function rather than the straight-line block it used to be. A
     * selection change is not "the same gate in a different window": it is a
     * different key, and quite possibly a different gate the user set the last
     * time they looked at these laps.
     *
     * `carry` IS WHAT TO USE WHEN THAT KEY HOLDS NOTHING, and the two callers
     * differ. At bind time there is no user intent to preserve, so it is the
     * hard default. On a selection change there is — the gate the user just
     * placed — and resetting to 5 s threw it away: ticking a LATER lap does not
     * move the window's start, so the offset still named the same point on the
     * course, and the reset silently re-cut the ride from somewhere else and
     * took any analysed panel with it. Nothing is persisted on that path, so the
     * value was simply lost.
     *
     * `isSuperseded` guards the await. Two quick checkbox clicks start two of
     * these, and IndexedDB reads are not ordered, so the first can resolve last
     * and write `max`/`value` for a selection that is no longer current. Every
     * write below happens after that check, so a superseded pass writes nothing.
     *
     * Returns false when the selection spans no time, or when it was superseded.
     */
    const resolveGateForSelection = async (
        carry: number | null,
        isSuperseded: () => boolean = () => false,
    ): Promise<boolean> => {
        const maxSeconds = Math.floor(callbacks.getSelectedDataTimeRange().duration);
        if (maxSeconds <= 0) {
            log.warn('Invalid duration for GPS lap detection:', maxSeconds);
            return false;
        }

        let offset = carry ?? DEFAULT_GATE_OFFSET_SECONDS;
        if (appState.currentFileHash) {
            try {
                const savedMarker = await parameterStorage.loadGpsMarkerSettings(appState.currentFileHash, appState.selectedLaps);
                if (savedMarker && savedMarker.gateTimeOffset !== undefined) {
                    offset = savedMarker.gateTimeOffset;
                    log.debug('Loading saved GPS gate time offset:', offset);
                }
            } catch (err) {
                log.error('Failed to load saved GPS marker settings:', err);
            }
        }

        if (isSuperseded()) return false;

        gateSlider.max = String(maxSeconds);
        gateValue.max = String(maxSeconds);
        offset = Math.max(0, Math.min(offset, maxSeconds));
        gateSlider.value = String(offset);
        gateValue.value = String(offset);
        return true;
    };

    if (!(await resolveGateForSelection(null))) return;

    // Show slider controls
    sliderControls.classList.remove('hidden');

    // Helper to update gate position and run detection
    const updateGatePosition = async (timeOffset: number, persist = true) => {
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

            // Save settings — ONLY WHEN THE USER MOVED THE GATE.
            //
            // The key includes `appState.selectedLaps`, read here at call time.
            // A pass triggered by a FIT selection change therefore writes under
            // the NEW combination's key, so persisting there would overwrite
            // whatever gate the user had saved for those laps with the offset
            // carried over from the laps they just left — before they had
            // touched anything. `resolveGateForSelection` has just LOADED that
            // combination's gate; there is nothing to write back.
            if (persist && appState.currentFileHash) {
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

    let redetectToken = 0;
    callbacks.registerRedetect?.(() => {
        const token = ++redetectToken;
        void (async () => {
            const carry = parseInt(gateSlider.value);
            if (!(await resolveGateForSelection(carry, () => token !== redetectToken))) return;
            void updateGatePosition(parseInt(gateSlider.value), false);
        })();
    });

    // Initial detection with the loaded/default offset — only when FIT laps are
    // selected. Detection must not start before the user has chosen which laps
    // to analyze; otherwise the time-range/detection helpers fall back to the
    // full activity and detect over the whole track.
    //
    // Not persisted: this offset was just read out of storage (or is the
    // default for a combination that has none), so writing it back says nothing.
    if (appState.selectedLaps.length > 0) {
        void updateGatePosition(parseInt(gateSlider.value), false);
    }
}
