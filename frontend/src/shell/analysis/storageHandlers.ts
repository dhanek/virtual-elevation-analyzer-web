import { AppState } from '../../state/AppState';
import { log } from '../../utils/log';
import { ResultsStorage } from '../../utils/ResultsStorage';
import { ParameterStorage, LapSettings } from '../../utils/ParameterStorage';
import { resolveAppliedCrr } from '../../analysis/CrrTemperatureCorrection';

/**
 * Save current lap settings to IndexedDB.
 */
export async function saveCurrentLapSettings(
    appState: AppState,
    parameterStorage: ParameterStorage
) {
    if (!appState.currentFileHash || !appState.selectedFile) return;

    // Key the save by the laps the VE view (and its sliders) actually belong
    // to — NOT the live checkbox selection. Between a lap-checkbox switch and
    // the next analyze, appState.selectedLaps already points at the new lap
    // while the sliders still hold the previous lap's trim values; saving
    // under the selection key would poison the new lap's stored settings
    // (stale trim loaded on the next analyze). No analysis yet → nothing to save.
    if (appState.currentAnalyzedLaps.length === 0) return;

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
        await parameterStorage.saveLapSettings(appState.currentFileHash, appState.currentAnalyzedLaps, settings);
    } catch (err) {
        log.error('Failed to save lap settings:', err);
    }
}

/**
 * Handle Save Screenshot button click.
 * Extracted from main.ts.
 */
export async function handleSaveScreenshot(
    appState: AppState,
    resultsStorage: ResultsStorage
) {
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

/**
 * Handle Store Result button click.
 * Extracted from main.ts.
 */
export async function handleStoreResult(
    appState: AppState,
    resultsStorage: ResultsStorage
) {
    if (!appState.selectedFile || !appState.currentParameters || !appState.currentVEResult) {
        log.error('Cannot store: missing required data');
        alert('Cannot store result: missing analysis data. Please run analysis first.');
        return;
    }

    if (!appState.currentFilteredData) {
        alert('Cannot store result: filtered data not available. Please run analysis first.');
        return;
    }

    const storeBtn = document.getElementById('storeResult') as HTMLButtonElement;
    if (!storeBtn) return;

    const originalText = storeBtn.textContent;

    try {
        const notes = await showNotesDialog();

        let trimStart: number;
        let trimEnd: number;
        let cda: number;
        let crr: number;

        if (appState.isGpsLapModeActive) {
            trimStart = 0;
            trimEnd = appState.currentFilteredData.power.length - 1;
            const cdaSlider = document.getElementById('cdaSlider') as HTMLInputElement;
            const crrSlider = document.getElementById('crrSlider') as HTMLInputElement;
            cda = cdaSlider ? parseFloat(cdaSlider.value) : appState.currentParameters.cda ?? 0.3;
            crr = crrSlider ? parseFloat(crrSlider.value) : appState.currentParameters.crr ?? 0.005;
        } else {
            const trimStartSlider = document.getElementById('trimStartSlider') as HTMLInputElement;
            const trimEndSlider = document.getElementById('trimEndSlider') as HTMLInputElement;
            const cdaSlider = document.getElementById('cdaSlider') as HTMLInputElement;
            const crrSlider = document.getElementById('crrSlider') as HTMLInputElement;

            if (!cdaSlider || !crrSlider) {
                log.error('Cannot store: UI elements not found');
                return;
            }

            if (trimStartSlider && trimEndSlider) {
                trimStart = parseInt(trimStartSlider.value);
                trimEnd = parseInt(trimEndSlider.value);
            } else {
                // D-09 entry (u), N-1. A TRIM WINDOW IS NOT UNIVERSAL, and this
                // branch used to assume it was: it required `#trimStartSlider` and
                // `#trimEndSlider`, which only Standard's template renders
                // (`renderStandardVe.ts:303,308`). Out-and-back sets
                // `isGpsLapModeActive = false` (`outAndBackMode.ts:44`) so it lands
                // here, found neither slider, logged 'Cannot store: UI elements not
                // found' and returned — Store Result persisted NOTHING at all, and
                // Export CSV therefore had nothing of that ride to export.
                //
                // The window is the whole analysed selection, which is exactly what
                // the GPS-lap branch above computes at `:119-120` for the same
                // reason: a segment mode has no trim control, so what is on screen
                // IS the full `currentFilteredData` that `segmentSummary`'s
                // `buildFilteredDataFromProfiles` concatenated from the surviving
                // legs. Deriving it any other way would let the two segment modes
                // disagree, which is the drift `segmentSummary.ts` exists to stop.
                //
                // DO NOT "fix" this by setting `isGpsLapModeActive` in
                // `outAndBackMode.syncState` instead. That field means "the GPS-lap
                // overlay is on screen" and `requestModeUpdate.ts:188` routes the
                // whole update to the gpsLap handler on it; flipping it would send
                // out-and-back's recomputes to the wrong mode.
                trimStart = 0;
                trimEnd = appState.currentFilteredData.power.length - 1;
            }

            cda = parseFloat(cdaSlider.value);
            crr = parseFloat(crrSlider.value);
        }

        const filteredPower = appState.currentFilteredData.power;
        const filteredVelocity = appState.currentFilteredData.velocity;
        const filteredTemperature = appState.currentFilteredData.temperature;
        const filteredTimestamps = appState.currentFilteredData.timestamps;

        const trimmedPower = filteredPower.slice(trimStart, trimEnd + 1);
        const trimmedVelocity = filteredVelocity.slice(trimStart, trimEnd + 1);
        const trimmedTemperature = filteredTemperature.slice(trimStart, trimEnd + 1);

        const avgPower = calculateAverage(trimmedPower, false);
        const avgSpeed = calculateAverage(trimmedVelocity, false) * 3.6;
        // STILL zero-skipping, deliberately. `buildFilteredDataFromProfiles`
        // now marks a missing reading as NaN (which `calculateAverage` drops
        // anyway), so for the two segment modes this flag could be dropped —
        // but `prepareAnalysisPayload.ts:88` and `ActivityLoader.ts:242` still
        // fabricate a 0 for a missing sample, and Standard's analyze path and
        // every CSV ride go through those. Turning the zero-skip off before
        // they are fixed too would drag Standard's stored avgTemperature toward
        // 0 rather than away from it. Cost of leaving it on: a genuine 0 °C
        // sample is excluded from the mean.
        const avgTemperature = calculateAverage(trimmedTemperature, true);

        const firstTimestamp = filteredTimestamps[trimStart];
        const recordingDate = new Date(firstTimestamp * 1000).toISOString().split('T')[0];

        // Crr from the slider is 22 °C-referenced; record the temperature-
        // corrected value actually used in the physics alongside it.
        const tempCorrectionActive =
            appState.currentParameters.crr_temp_correction === true &&
            appState.currentParameters.ambient_temp_c !== null &&
            appState.currentParameters.ambient_temp_c !== undefined;

        const saveData = {
            fileName: appState.selectedFile.name,
            laps: appState.currentAnalyzedLaps,
            trimStart: trimStart,
            trimEnd: trimEnd,
            cda: cda,
            crr: crr,
            crrApplied: tempCorrectionActive
                ? resolveAppliedCrr(appState.currentParameters, crr)
                : undefined,
            ambientTemp: tempCorrectionActive
                ? (appState.currentParameters.ambient_temp_c ?? undefined)
                : undefined,
            tireSensitivity: tempCorrectionActive
                ? (appState.currentParameters.tire_sensitivity ?? 'typical')
                : undefined,
            airSpeedCalibration: appState.airSpeedCalibrationPercent !== 0 ? appState.airSpeedCalibrationPercent : undefined,
            windSource: appState.currentWindSource,
            parameters: appState.currentParameters,
            result: appState.currentVEResult,
            // Entry (h): the per-segment virtual distances the VD header is
            // showing, written by the same `summarize` seam that wrote
            // `currentVEResult`. Multi-lap Standard used to persist nothing but
            // the combined result's zeros here.
            virtualDistances: appState.currentVirtualDistances,
            timestamp: new Date(),
            recordingDate: recordingDate,
            avgPower: avgPower,
            avgSpeed: avgSpeed,
            avgTemperature: avgTemperature,
            notes: notes,
            isGpsLapMode: appState.isGpsLapModeActive
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

/**
 * Handle Export All Results button click.
 * Extracted from main.ts.
 */
export async function handleExportAllResults(
    resultsStorage: ResultsStorage
) {
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
            exportBtn.textContent = originalText || 'Export All Results to CSV';
        }, 2000);
    } catch (error) {
        log.error('❌ Failed to export results:', error);
        alert('Failed to export results. See console for details.');

        exportBtn.disabled = false;
        exportBtn.textContent = originalText || 'Export All Results to CSV';
    }
}

function calculateAverage(values: number[], excludeZero: boolean = false): number {
    const validValues = values.filter(v => !isNaN(v) && (excludeZero ? v !== 0 : true));
    if (validValues.length === 0) return 0;
    const sum = validValues.reduce((acc, val) => acc + val, 0);
    return sum / validValues.length;
}

function showNotesDialog(): Promise<string> {
    return new Promise((resolve) => {
        const dialog = document.createElement('div');
        dialog.className = 'notes-dialog';

        dialog.innerHTML = `
            <h3 class="notes-dialog__title">Add Notes</h3>
            <input type="text" id="notesInput" placeholder="e.g., test_config_A" class="notes-dialog__input">
            <div class="notes-dialog__actions">
                <button id="notesCancelBtn" class="notes-dialog__button notes-dialog__button--cancel">Cancel</button>
                <button id="notesOkBtn" class="notes-dialog__button notes-dialog__button--ok">OK</button>
            </div>
        `;

        const overlay = document.createElement('div');
        overlay.className = 'notes-dialog__overlay';

        document.body.appendChild(overlay);
        document.body.appendChild(dialog);

        const input = document.getElementById('notesInput') as HTMLInputElement | null;
        const okBtn = document.getElementById('notesOkBtn') as HTMLButtonElement | null;
        const cancelBtn = document.getElementById('notesCancelBtn') as HTMLButtonElement | null;

        // IDEMPOTENT. `removeChild` on an already-removed node throws, and this
        // executor's throw rejects showNotesDialog() straight into
        // handleStoreResult's generic catch — so a second activation (OK after
        // Enter, Escape after Cancel) used to surface as "Failed to store
        // result" with the dialog gone and nothing stored.
        let done = false;
        const cleanup = (notes: string) => {
            if (done) return;
            done = true;
            overlay.remove();
            dialog.remove();
            resolve(notes);
        };

        input?.focus();

        okBtn?.addEventListener('click', () => cleanup(input?.value.trim() ?? ''));
        cancelBtn?.addEventListener('click', () => cleanup(''));
        // `keydown`, NOT `keypress`: keypress does not fire for non-printing
        // keys, so the Escape branch was unreachable and this modal overlay had
        // no keyboard dismissal at all.
        input?.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') cleanup(input.value.trim());
            else if (e.key === 'Escape') cleanup('');
        });
    });
}
