import { resolveDisplayCrr } from '../../analysis/unsetParameterFallbacks';
import { AppState } from '../../state/AppState';
import { openResultsModal, type StoredResultKey } from '../dom/resultsModal';
import { log } from '../../utils/log';
import {
    ResultsStorage,
    type StoredVEResult,
} from '../../utils/ResultsStorage';
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
/**
 * SINGLE-FLIGHT. The Store button is deliberately not disabled until after the
 * notes dialog resolves — that is what lets a cancel leave it untouched — so
 * without this flag a second click opened a second dialog while the first was
 * still up, and the result was stored twice.
 */
let storeInFlight = false;

export async function handleStoreResult(
    appState: AppState,
    resultsStorage: ResultsStorage
) {
    if (storeInFlight) {
        return;
    }
    if (!appState.selectedFile || !appState.currentParameters || !appState.currentVEResult) {
        log.error('Cannot store: missing required data');
        alert('Cannot store result: missing analysis data. Please run analysis first.');
        return;
    }

    // EMPTY counts as absent. `buildFilteredDataFromProfiles` returns empty
    // arrays unconditionally when `currentFitData` is falsy
    // (`segmentSummary.ts:77-80`), and both segment-mode branches below then
    // compute `trimEnd = 0 - 1 = -1`, slice nothing, and hand
    // `new Date(undefined * 1000)` to `.toISOString()` — a RangeError caught by
    // the outer catch and reported as the generic "Failed to store result",
    // which says nothing about the real cause.
    if (!appState.currentFilteredData || appState.currentFilteredData.power.length === 0) {
        alert('Cannot store result: no analysed samples. Please run analysis first.');
        return;
    }

    const storeBtn = document.getElementById('storeResult') as HTMLButtonElement;
    if (!storeBtn) return;

    const originalText = storeBtn.textContent;

    storeInFlight = true;
    try {
        const notes = await showNotesDialog();

        // DISMISSED — store nothing and touch nothing.
        //
        // Returning before the button is disabled and relabelled is deliberate:
        // there is no "Cancelled" state to show because nothing was started.
        // The button is still reading its original label at this point, so the
        // user simply gets their panel back.
        if (notes === null) {
            return;
        }

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
            crr = crrSlider ? parseFloat(crrSlider.value) : resolveDisplayCrr(appState.currentParameters.crr);
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

        // CR-02. THE WINDOW IS THE WHOLE OF `currentFilteredData`, in every mode.
        //
        // It used to be `slice(trimStart, trimEnd + 1)` with the SLIDER values,
        // which are analyze-selection indices — a different space from what
        // `standardMode.summarize` writes here on every update. `summarize`
        // stores the concatenation of the SURVIVING segments, and
        // `mapTrimToSegments` drops any segment the trim window leaves under
        // MIN_TRIMMED_SEGMENT_SAMPLES, so narrowing a 3-lap selection onto lap 3
        // shrank this array to ~300 samples while `trimStart` stayed ~700. The
        // slice returned `[]`, every average came out 0, and
        // `filteredTimestamps[700]` was `undefined` — `new Date(NaN)` threw and
        // surfaced as the generic "Failed to store result".
        //
        // Deriving the window from the space actually being read removes the
        // mismatch instead of detecting it: Standard's profiles are ALREADY
        // trim-mapped by the time they land here, so what is on screen IS this
        // concatenation. That is exactly how both segment modes have always
        // treated it (`:126-127`, `:169-170`) — Standard was the odd one out.
        //
        // The slider values are still RECORDED as `trimStart` / `trimEnd`: they
        // are the trim the user chose, the stored rows and the CSV export carry
        // them, and reducing them to 0 / length-1 would empty that column.
        const trimmedPower = filteredPower;
        const trimmedVelocity = filteredVelocity;
        const trimmedTemperature = filteredTemperature;

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
        // ABSENT, not 0, when the ride carries no usable reading. `calculateAverage`
        // returns 0 for an all-NaN array, and a stored 0 is indistinguishable from
        // a genuine 0 °C ride — the same confusion the NaN marker exists to avoid.
        const hasAnyTemperature = trimmedTemperature.some(Number.isFinite);
        const avgTemperature = hasAnyTemperature
            ? calculateAverage(trimmedTemperature, true)
            : undefined;

        // The FIRST ANALYSED SAMPLE, not `filteredTimestamps[trimStart]`.
        //
        // Same reasoning as the window above: indexing this array with a slider
        // value read it in the wrong space, and when the two diverged far enough
        // the lookup was `undefined` and `new Date(NaN).toISOString()` threw.
        // Index 0 is the first sample actually on screen, which is what the
        // segment modes have always recorded.
        //
        // The emptiness guard at the top of this function has already
        // established `length > 0`, so this only has to reject a non-finite
        // reading rather than an out-of-range index.
        const firstTimestamp = filteredTimestamps[0];
        if (!Number.isFinite(firstTimestamp)) {
            log.error(
                `Cannot store: first analysed timestamp is ${firstTimestamp}.`,
            );
            alert(
                'Cannot store result: the analysed samples have no usable ' +
                'timestamp. Please re-run the analysis.',
            );
            return;
        }
        const recordingDate = new Date(firstTimestamp * 1000).toISOString().split('T')[0];

        // Crr from the slider is 22 °C-referenced; record the temperature-
        // corrected value actually used in the physics alongside it.
        const tempCorrectionActive =
            appState.currentParameters.crr_temp_correction === true &&
            appState.currentParameters.ambient_temp_c !== null &&
            appState.currentParameters.ambient_temp_c !== undefined;

        const saveData = {
            fileName: appState.selectedFile.name,
            // WHAT THE USER SELECTED, in all three modes (WR-02). Standard used
            // to write the selection while the two segment modes wrote whatever
            // survived, so the same drop produced `laps: [1,2,3]` here and
            // `laps: [3]` there — one column, two meanings, and nothing saying
            // which. It is the selection everywhere now.
            laps: appState.currentAnalyzedLaps,
            // WHICH OF THEM THE NUMBERS IN THIS ROW DESCRIBE. `avgPower`,
            // `avgSpeed`, `avgTemperature`, `result` and `virtualDistances` all
            // come from the SURVIVING profiles, so a dropped lap silently
            // narrowed them with no column to say so.
            //
            // `?? undefined`, never `?? appState.currentAnalyzedLaps`: before the
            // first recompute the coverage is genuinely unknown, and claiming
            // full coverage there would be exactly the fabrication this column
            // exists to prevent.
            lapsCovered: appState.currentCoveredItems ?? undefined,
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
    } finally {
        storeInFlight = false;
    }
}

/**
 * What the results view needs from storage, and nothing else.
 *
 * `ResultsStorage` satisfies this structurally, so callers pass the real one —
 * but the view is handed only these two. Giving it the class would put
 * `clearAllResults` and `deleteDatabase` within reach of a surface whose job is
 * to delete ONE row, and it is what lets the entry point be driven in a test
 * with no IndexedDB at all.
 */
export interface ResultsViewStorage {
    getAllResults: () => Promise<StoredVEResult[]>;
    deleteResult: (key: StoredResultKey) => Promise<void>;
}

/**
 * Handle a Show All Results click, from either entry point.
 */
export async function handleShowAllResults(
    resultsStorage: ResultsViewStorage
) {
    await openResultsModal({
        getAllResults: () => resultsStorage.getAllResults(),
        deleteResult: key => resultsStorage.deleteResult(key),
    });
}

/**
 * Wire the APP-FOOTER entry point — the one that works before any file is
 * loaded.
 *
 * The stored results are global; nothing about them depends on the ride
 * currently open. The sidebar button stays as the convenient path right after
 * Store Result, and both call the same handler, so the two entry points cannot
 * drift.
 *
 * `button` is nullable because `initializeApplication` resolves its DOM with
 * `getElementById` and a cast: a renamed or removed element arrives here as
 * `null` rather than as a type error, and must not take app startup down.
 */
export function bindShowAllResultsButton(
    button: HTMLElement | null,
    resultsStorage: ResultsViewStorage
): void {
    if (!button) {
        log.warn('Show All Results button not found; the footer entry point is unbound');
        return;
    }

    button.addEventListener('click', () => {
        void handleShowAllResults(resultsStorage);
    });
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

/**
 * Ask for the note to file the result under.
 *
 * Resolves the note, or `null` if the user DISMISSED the dialog — Cancel,
 * Escape, or a backdrop click. The distinction is load-bearing: this used to
 * resolve `''` for a dismissal, which is indistinguishable from pressing OK
 * with an empty field, so `handleStoreResult` stored the result anyway. Cancel
 * flashed "✓ Stored" and put a row in the CSV export.
 */
export function showNotesDialog(): Promise<string | null> {
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

        // QUERIED WITHIN THIS DIALOG, not by id off the document.
        //
        // The ids are fixed, and `getElementById` returns the FIRST match — so
        // a second dialog opened while the first was up bound its listeners to
        // the FIRST dialog's buttons and read the FIRST dialog's input. One
        // click on the visible OK then resolved both promises. Scoping the
        // lookups makes two dialogs incapable of sharing controls, which the
        // single-flight guard above makes unreachable anyway; both are kept
        // because the guard is a policy and this is a structural impossibility.
        const input = dialog.querySelector('#notesInput') as HTMLInputElement | null;
        const okBtn = dialog.querySelector('#notesOkBtn') as HTMLButtonElement | null;
        const cancelBtn = dialog.querySelector('#notesCancelBtn') as HTMLButtonElement | null;

        // IDEMPOTENT. `removeChild` on an already-removed node throws, and this
        // executor's throw rejects showNotesDialog() straight into
        // handleStoreResult's generic catch — so a second activation (OK after
        // Enter, Escape after Cancel) used to surface as "Failed to store
        // result" with the dialog gone and nothing stored.
        let done = false;
        const cleanup = (notes: string | null) => {
            if (done) return;
            done = true;
            // Paired with the listener below. A document-level listener outlives
            // the nodes it was opened for, so leaving it attached would leak one
            // per Store Result for the lifetime of the session.
            document.removeEventListener('keydown', onKeyDown);
            overlay.remove();
            dialog.remove();
            resolve(notes);
        };

        // ON THE DOCUMENT, not on the input.
        //
        // `keydown` rather than `keypress` because keypress does not fire for
        // non-printing keys, which made the Escape branch unreachable. But
        // fixing that on the INPUT only moved the problem: the listener then saw
        // Escape solely while the text field held focus, so clicking the
        // backdrop once left this modal with no keyboard dismissal at all.
        //
        // Enter stays input-scoped in spirit — it means "accept what I typed" —
        // but reading the value here costs nothing and keeps one handler.
        const onKeyDown = (e: KeyboardEvent) => {
            if (e.key === 'Escape') cleanup(null);
            else if (e.key === 'Enter') cleanup(input?.value.trim() ?? '');
        };

        input?.focus();

        okBtn?.addEventListener('click', () => cleanup(input?.value.trim() ?? ''));
        cancelBtn?.addEventListener('click', () => cleanup(null));
        // Clicking the backdrop is the other ordinary way out of a modal. It
        // cancels rather than accepts: a stray click outside the box is not an
        // expression of intent to save what is in it.
        overlay.addEventListener('click', () => cleanup(null));
        document.addEventListener('keydown', onKeyDown);
    });
}
