import type { AnalysisParameters } from "../components/AnalysisParameters";
import type { LapSettings, ParameterStorage } from "../utils/ParameterStorage";
import type { AppState } from "../state/AppState";
import type { AnalysisModeId } from "../modes/analysis/types";
import type { getNormalizedActivityArrays } from "./ActivityArrayCache";
import type { resolveWindSeries } from "./WindSourceResolver";
import type { extractSegmentData } from "./SegmentExtractor";

import { log } from "../utils/log";
import {
	resolveSelectionCalibration,
	type CalibrationSource,
} from "./RideCalibration";

type GetNormalizedActivityArraysFn = typeof getNormalizedActivityArrays;
type ResolveWindSeriesFn = typeof resolveWindSeries;
type ExtractSegmentDataFn = typeof extractSegmentData;

export interface ResolvedMultiSegmentSettings {
	params: AnalysisParameters;
}

interface ResolveMultiSegmentSettingsInput {
	currentAnalyzedItems: number[];
	nextAnalyzedItems: number[];
	params: AnalysisParameters;
	savedSettings?: Pick<LapSettings, "cda" | "crr"> | null;
}

/**
 * CdA and Crr for the next analyzed selection. The calibration is not here:
 * it belongs to the ride, not to the lap settings
 * (`resolveSelectionAirSpeedCalibration`).
 */
export function resolveMultiSegmentSettings(
	input: ResolveMultiSegmentSettingsInput,
): ResolvedMultiSegmentSettings {
	if (sameSelection(input.currentAnalyzedItems, input.nextAnalyzedItems)) {
		return { params: input.params };
	}

	return {
		params: {
			...input.params,
			cda: input.savedSettings?.cda ?? input.params.cda,
			crr: input.savedSettings?.crr ?? input.params.crr,
		},
	};
}

export function sameSelection(left: number[], right: number[]): boolean {
	return (
		left.length === right.length &&
		left.every((value, index) => value === right[index])
	);
}

/**
 * The calibration a selection analyzes with: its own override, else the
 * file's ride value, else 0 (`resolveSelectionCalibration`). Written into
 * `appState` with its source, so the control can say which it is and a later
 * change is stored to the same place. Without a stored file there is nothing
 * to read, and the value in memory stays.
 */
async function resolveSelectionAirSpeedCalibration(
	appState: AppState,
	parameterStorage: ParameterStorage,
	mode: AnalysisModeId,
	analyzedItems: number[],
): Promise<void> {
	if (!appState.currentFileHash) return;
	const stored = await parameterStorage.loadAirSpeedCalibration(
		appState.currentFileHash,
		mode,
		analyzedItems,
	);
	const resolved = resolveSelectionCalibration(stored.ride, stored.override);
	appState.rideAirSpeedCalibrationPercent = stored.ride ?? 0;
	appState.airSpeedCalibrationPercent = resolved.percent;
	appState.airSpeedCalibrationSource = resolved.source;
}

/**
 * Store a calibration change (slider, number box, Auto Adjust) where the
 * current selection takes it from (D1): the ride value, which every selection
 * without an override follows, or this exact selection's override.
 */
export async function persistAirSpeedCalibration(
	appState: AppState,
	parameterStorage: ParameterStorage,
	mode: AnalysisModeId,
): Promise<void> {
	if (!appState.currentFileHash) return;
	const percent = appState.airSpeedCalibrationPercent;
	try {
		if (appState.airSpeedCalibrationSource === "selection") {
			if (appState.currentAnalyzedLaps.length === 0) return;
			await parameterStorage.saveAirSpeedCalibrationOverride(
				appState.currentFileHash,
				mode,
				appState.currentAnalyzedLaps,
				percent,
			);
		} else {
			appState.rideAirSpeedCalibrationPercent = percent;
			await parameterStorage.saveRideAirSpeedCalibration(
				appState.currentFileHash,
				percent,
			);
		}
	} catch (err) {
		log.error("Failed to save the air speed calibration:", err);
	}
}

/**
 * The "this selection only" switch. On: the selection keeps the value it has
 * now as its own override. Off ("Use ride value"): the override is removed and
 * the selection takes the ride value again, so its VE changes.
 */
export async function setAirSpeedCalibrationScope(
	appState: AppState,
	parameterStorage: ParameterStorage,
	mode: AnalysisModeId,
	scope: CalibrationSource,
): Promise<void> {
	appState.airSpeedCalibrationSource = scope;
	if (scope === "ride") {
		appState.airSpeedCalibrationPercent =
			appState.rideAirSpeedCalibrationPercent;
	}
	if (!appState.currentFileHash || appState.currentAnalyzedLaps.length === 0)
		return;
	try {
		await parameterStorage.saveAirSpeedCalibrationOverride(
			appState.currentFileHash,
			mode,
			appState.currentAnalyzedLaps,
			scope === "selection" ? appState.airSpeedCalibrationPercent : null,
		);
	} catch (err) {
		log.error("Failed to save the air speed calibration scope:", err);
	}
}

export async function resolveMultiSegmentAnalysisParams(
	appState: AppState,
	parameterStorage: ParameterStorage,
	mode: AnalysisModeId,
	analyzedItems: number[],
	params: AnalysisParameters,
	reuseCurrentSettings: boolean = false,
): Promise<AnalysisParameters> {
	const savedSettings = appState.currentFileHash
		? await parameterStorage.loadLapSettings(
				appState.currentFileHash,
				analyzedItems,
			)
		: null;

	const sameAsCurrent =
		reuseCurrentSettings &&
		sameSelection(appState.currentAnalyzedLaps, analyzedItems);
	const resolved = resolveMultiSegmentSettings({
		currentAnalyzedItems: reuseCurrentSettings
			? appState.currentAnalyzedLaps
			: [],
		nextAnalyzedItems: analyzedItems,
		params,
		savedSettings,
	});
	if (!sameAsCurrent) {
		await resolveSelectionAirSpeedCalibration(
			appState,
			parameterStorage,
			mode,
			analyzedItems,
		);
	}

	appState.currentAnalyzedLaps = analyzedItems;
	// The new selection has produced nothing yet, so it covers nothing yet
	// (WR-01). Without this reset the PREVIOUS analysis's surviving items would
	// ride along until the first recompute, and Store Result pressed in between
	// would persist them as this analysis's coverage.
	appState.currentCoveredItems = null;
	return resolved.params;
}

export async function saveCurrentMultiSegmentSettings(
	appState: AppState,
	parameterStorage: ParameterStorage,
): Promise<void> {
	if (
		!appState.currentFileHash ||
		!appState.selectedFile ||
		appState.currentAnalyzedLaps.length === 0
	) {
		return;
	}

	const cdaValueEl = document.getElementById(
		"cdaValue",
	) as HTMLInputElement | null;
	const crrValueEl = document.getElementById(
		"crrValue",
	) as HTMLInputElement | null;
	if (!cdaValueEl || !crrValueEl) {
		return;
	}

	const parsedCda = parseFloat(cdaValueEl.value);
	const parsedCrr = parseFloat(crrValueEl.value);
	// No calibration here: a settings save used to pin the current percent onto
	// the selection, which is what kept a later calibration from reaching it.
	const settings: LapSettings = {
		trimStart: 0,
		trimEnd: 0,
		cda: Number.isFinite(parsedCda) ? parsedCda : null,
		crr: Number.isFinite(parsedCrr) ? parsedCrr : null,
	};

	try {
		await parameterStorage.saveLapSettings(
			appState.currentFileHash,
			appState.currentAnalyzedLaps,
			settings,
		);
	} catch (err) {
		log.error("Failed to save multi-segment settings:", err);
	}
}

export async function saveMapTrimSettings(
	appState: AppState,
	parameterStorage: ParameterStorage,
): Promise<void> {
	if (!appState.currentFileHash || !appState.selectedFile) {
		log.warn("Cannot save: missing fileHash or appState.selectedFile");
		return;
	}

	const settings: LapSettings = {
		trimStart: appState.presetTrimStart,
		trimEnd: appState.presetTrimEnd ?? 0,
		cda: null, // CdA/Crr not set yet
		crr: null,
	};

	try {
		await parameterStorage.saveLapSettings(
			appState.currentFileHash,
			appState.selectedLaps,
			settings,
		);
	} catch (err) {
		log.error("Failed to save map trim settings:", err);
	}
}

interface AutoCalibrationSegment {
	timestamps: number[];
	groundSpeed: number[];
	apparentSpeed: number[];
}

export function buildAutoCalibrationSegmentsFromRanges(
	appState: AppState,
	indexRanges: Array<{ startIdx: number; endIdx: number }>,
	getNormalizedActivityArraysFn: GetNormalizedActivityArraysFn,
	resolveWindSeriesFn: ResolveWindSeriesFn,
	extractSegmentDataFn: ExtractSegmentDataFn,
): AutoCalibrationSegment[] {
	if (!appState.currentFitData) {
		return [];
	}

	const normalizedArrays = getNormalizedActivityArraysFn(
		appState.currentFitData,
	);
	const uncalibratedWindSpeed = resolveWindSeriesFn({
		fitData: appState.currentFitData,
		windSource: "fit",
		applyOffset: false,
		airSpeedCalibrationPercent: 0,
	}).windSpeed;

	return indexRanges
		.map((range) =>
			extractSegmentDataFn({
				startIdx: range.startIdx,
				endIdx: range.endIdx,
				allTimestamps: normalizedArrays.timestamps,
				allPower: normalizedArrays.power,
				allVelocity: normalizedArrays.velocity,
				allPositionLat: normalizedArrays.positionLat,
				allPositionLong: normalizedArrays.positionLong,
				allAltitude: normalizedArrays.altitude,
				allDistance: normalizedArrays.distance,
				allWindSpeed: uncalibratedWindSpeed,
			}),
		)
		.filter((segment) => segment.timestamps.length > 1)
		.map((segment): AutoCalibrationSegment => ({
			timestamps: segment.timestamps,
			groundSpeed: segment.velocity,
			apparentSpeed: segment.windSpeed,
		}));
}
