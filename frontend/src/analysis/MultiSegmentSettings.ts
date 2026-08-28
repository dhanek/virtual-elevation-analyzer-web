import type { AnalysisParameters } from "../components/AnalysisParameters";
import type { LapSettings, ParameterStorage } from "../utils/ParameterStorage";
import type { AppState } from "../state/AppState";
import type { getNormalizedActivityArrays } from "./ActivityArrayCache";
import type { resolveWindSeries } from "./WindSourceResolver";
import type { extractSegmentData } from "./SegmentExtractor";

import { DEFAULT_AIR_SPEED_CALIBRATION_PERCENT } from "./AirSpeedCalibration";
import { log } from "../utils/log";

type GetNormalizedActivityArraysFn = typeof getNormalizedActivityArrays;
type ResolveWindSeriesFn = typeof resolveWindSeries;
type ExtractSegmentDataFn = typeof extractSegmentData;

export interface ResolvedMultiSegmentSettings {
	params: AnalysisParameters;
	airSpeedCalibrationPercent: number;
}

interface ResolveMultiSegmentSettingsInput {
	currentAnalyzedItems: number[];
	nextAnalyzedItems: number[];
	params: AnalysisParameters;
	currentAirSpeedCalibrationPercent: number;
	savedSettings?: Pick<
		LapSettings,
		"cda" | "crr" | "airSpeedCalibration"
	> | null;
}

export function resolveMultiSegmentSettings(
	input: ResolveMultiSegmentSettingsInput,
): ResolvedMultiSegmentSettings {
	if (sameSelection(input.currentAnalyzedItems, input.nextAnalyzedItems)) {
		return {
			params: input.params,
			airSpeedCalibrationPercent: input.currentAirSpeedCalibrationPercent,
		};
	}

	return {
		params: {
			...input.params,
			cda: input.savedSettings?.cda ?? input.params.cda,
			crr: input.savedSettings?.crr ?? input.params.crr,
		},
		airSpeedCalibrationPercent:
			input.savedSettings?.airSpeedCalibration ??
			DEFAULT_AIR_SPEED_CALIBRATION_PERCENT,
	};
}

export function sameSelection(left: number[], right: number[]): boolean {
	return (
		left.length === right.length &&
		left.every((value, index) => value === right[index])
	);
}

export async function resolveMultiSegmentAnalysisParams(
	appState: AppState,
	parameterStorage: ParameterStorage,
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

	const resolved = resolveMultiSegmentSettings({
		currentAnalyzedItems: reuseCurrentSettings
			? appState.currentAnalyzedLaps
			: [],
		nextAnalyzedItems: analyzedItems,
		params,
		currentAirSpeedCalibrationPercent: appState.airSpeedCalibrationPercent,
		savedSettings,
	});

	appState.currentAnalyzedLaps = analyzedItems;
	// The new selection has produced nothing yet, so it covers nothing yet
	// (WR-01). Without this reset the PREVIOUS analysis's surviving items would
	// ride along until the first recompute, and Store Result pressed in between
	// would persist them as this analysis's coverage.
	appState.currentCoveredItems = null;
	appState.airSpeedCalibrationPercent = resolved.airSpeedCalibrationPercent;
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
	const settings: LapSettings = {
		trimStart: 0,
		trimEnd: 0,
		cda: Number.isFinite(parsedCda) ? parsedCda : null,
		crr: Number.isFinite(parsedCrr) ? parsedCrr : null,
		airSpeedCalibration:
			appState.airSpeedCalibrationPercent !== 0
				? appState.airSpeedCalibrationPercent
				: undefined,
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
		.map((segment) => ({
			timestamps: segment.timestamps,
			groundSpeed: segment.velocity,
			apparentSpeed: segment.windSpeed,
		}));
}
