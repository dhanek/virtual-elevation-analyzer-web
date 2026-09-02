/**
 * The pure middle of Store Result (Convergence plan, C5): everything between
 * "the DOM has been read" and "the record is written", extracted verbatim
 * from `handleStoreResult` so the headless API can build the SAME
 * `SaveResultData` — and therefore the same CSV row — without a document.
 *
 * `handleStoreResult` still owns the DOM: the notes dialog, the slider reads,
 * the button states and the alerts. This function owns the invariants, each
 * of which is attached to a named past defect (CR-02, WR-02, entry (h), the
 * NaN-timestamp RangeError) — lift them intact or re-ship the defect.
 */
import { resolveAppliedCrr } from '../../analysis/CrrTemperatureCorrection';
import type { AppState } from '../../state/AppState';
import type { SaveResultData } from '../../utils/ResultsStorage';

export function calculateAverage(values: number[], excludeZero: boolean = false): number {
    const validValues = values.filter(v => !isNaN(v) && (excludeZero ? v !== 0 : true));
    if (validValues.length === 0) return 0;
    const sum = validValues.reduce((acc, val) => acc + val, 0);
    return sum / validValues.length;
}

export interface BuildSaveResultDataInput {
    appState: AppState;
    fileName: string;
    notes: string;
    /** Slider values (Crr 22 °C-referenced), read by the caller. */
    cda: number;
    crr: number;
    /** The trim the user chose — RECORDED, not used to slice (CR-02). */
    trimStart: number;
    trimEnd: number;
    now: Date;
}

export type BuildSaveResultDataOutcome =
    | { ok: true; data: SaveResultData }
    | { ok: false; alertMessage: string; logMessage: string };

export function buildSaveResultData(
    input: BuildSaveResultDataInput,
): BuildSaveResultDataOutcome {
    const { appState, cda, crr, trimStart, trimEnd } = input;
    const params = appState.currentParameters;
    const result = appState.currentVEResult;

    if (!params || !result) {
        return {
            ok: false,
            alertMessage: 'missing analysis data. Please run analysis first.',
            logMessage: 'missing required data',
        };
    }
    if (!appState.currentFilteredData || appState.currentFilteredData.power.length === 0) {
        return {
            ok: false,
            alertMessage: 'no analysed samples. Please run analysis first.',
            logMessage: 'no analysed samples',
        };
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
    // every CSV ride go through those.
    // ABSENT, not 0, when the ride carries no usable reading: a stored 0 is
    // indistinguishable from a genuine 0 °C ride.
    const hasAnyTemperature = trimmedTemperature.some(Number.isFinite);
    const avgTemperature = hasAnyTemperature
        ? calculateAverage(trimmedTemperature, true)
        : undefined;

    // The FIRST ANALYSED SAMPLE, not `filteredTimestamps[trimStart]` —
    // indexing with a slider value read the wrong space, and when the two
    // diverged the lookup was `undefined` and `new Date(NaN).toISOString()`
    // threw.
    const firstTimestamp = filteredTimestamps[0];
    if (!Number.isFinite(firstTimestamp)) {
        return {
            ok: false,
            alertMessage:
                'the analysed samples have no usable ' +
                'timestamp. Please re-run the analysis.',
            logMessage: `first analysed timestamp is ${firstTimestamp}.`,
        };
    }
    const recordingDate = new Date(firstTimestamp * 1000).toISOString().split('T')[0];

    // Crr from the slider is 22 °C-referenced; record the temperature-
    // corrected value actually used in the physics alongside it.
    const tempCorrectionActive =
        params.crr_temp_correction === true &&
        params.ambient_temp_c !== null &&
        params.ambient_temp_c !== undefined;

    const data: SaveResultData = {
        fileName: input.fileName,
        // WHAT THE USER SELECTED, in all three modes (WR-02).
        laps: appState.currentAnalyzedLaps,
        // WHICH OF THEM THE NUMBERS IN THIS ROW DESCRIBE. `?? undefined`,
        // never `?? appState.currentAnalyzedLaps`: before the first recompute
        // the coverage is genuinely unknown, and claiming full coverage there
        // would be exactly the fabrication this column exists to prevent.
        lapsCovered: appState.currentCoveredItems ?? undefined,
        trimStart: trimStart,
        trimEnd: trimEnd,
        cda: cda,
        crr: crr,
        crrApplied: tempCorrectionActive
            ? resolveAppliedCrr(params, crr)
            : undefined,
        ambientTemp: tempCorrectionActive
            ? (params.ambient_temp_c ?? undefined)
            : undefined,
        tireSensitivity: tempCorrectionActive
            ? (params.tire_sensitivity ?? 'typical')
            : undefined,
        airSpeedCalibration: appState.airSpeedCalibrationPercent !== 0 ? appState.airSpeedCalibrationPercent : undefined,
        windSource: appState.currentWindSource,
        parameters: params,
        result: result,
        // Entry (h): the per-segment virtual distances the VD header is
        // showing, written by the same `summarize` seam that wrote
        // `currentVEResult`.
        virtualDistances: appState.currentVirtualDistances,
        timestamp: input.now,
        recordingDate: recordingDate,
        avgPower: avgPower,
        avgSpeed: avgSpeed,
        avgTemperature: avgTemperature,
        notes: input.notes,
        isGpsLapMode: appState.isGpsLapModeActive,
    };

    return { ok: true, data };
}
