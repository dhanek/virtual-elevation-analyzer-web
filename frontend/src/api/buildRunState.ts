/**
 * A validated `RunConfig` + a loaded activity → everything one
 * `updateModeVEPlots` call needs (Convergence plan, C6).
 *
 * THE REAL CLASS, THE REAL HELPERS. `new AppState()` constructs cleanly in
 * node (its imports are all `import type`), so the runner uses it rather than
 * a plain-object cast — that cast is a TEST-only property of the golden
 * harness, whose own comment says it exists so a forgotten field fails
 * loudly. And the trim window is applied by `mapTrimToSegments` over
 * `collectSelectionIndices`, the same two calls as the browser funnel: any
 * arithmetic on selection indices here would be the exact drift
 * `standardSegments.ts` documents (1436 vs 1442 samples over seven laps).
 */
import { getNormalizedActivityArrays } from "../analysis/ActivityArrayCache";
import { getDefaultWindSource } from "../analysis/WindSourceResolver";
import type { NormalizedActivityArrays } from "../analysis/ActivityArrayCache";
import {
	DEFAULT_PARAMETERS,
	type AnalysisParameters,
} from "../components/AnalysisParameters";
import {
	collectSelectionIndices,
	getAnalysisModeHandlerById,
} from "../modes/analysis/AnalysisModes";
import type {
	AnalysisModeHandler,
	ModeSegment,
} from "../modes/analysis/types";
import {
	mapTrimToSegments,
	MIN_TRIMMED_SEGMENT_SAMPLES,
} from "../shell/ve/standardSegments";
import { AppState, type ActivityDataLike, type WindSource } from "../state/AppState";
import { normalizeLoadedParameters } from "../utils/ParameterStorage";
import type { LoadedRunActivity } from "./loadActivity";
import type { RunConfig } from "./schema";

export interface RunState {
	appState: AppState;
	handler: AnalysisModeHandler;
	/** Trim-mapped segments, or undefined to let the primitive ask the handler. */
	segments: ModeSegment[] | undefined;
	windSource: WindSource;
	/** Present when the config overrides rho resolution. */
	resolveRho?: (
		fitData: ActivityDataLike,
		normalized: NormalizedActivityArrays,
	) => number[] | null;
	/** What the config selected, for the coverage block. */
	selectedItems: number[];
	/** The trim recorded on the stored row (selection-space, or full extent). */
	recordedTrim: { start: number; end: number };
}

export function buildRunState(
	config: RunConfig,
	activity: LoadedRunActivity,
): RunState {
	const appState = new AppState();
	appState.currentFitData = activity.fitData;
	appState.currentLaps = activity.laps as AppState["currentLaps"];

	// Missing keys fill from the defaults, then the same legacy patcher every
	// stored record goes through — so a config written from an old export gets
	// LEGACY_WIND_HEIGHT_FACTOR rather than silently inheriting today's value.
	const params = normalizeLoadedParameters({
		...DEFAULT_PARAMETERS,
		...(config.parameters ?? {}),
	} as AnalysisParameters);
	if (!params) {
		throw new Error("parameters failed to normalize");
	}
	appState.currentParameters = params;
	appState.airSpeedCalibrationPercent =
		config.inputs.airSpeedCalibrationPercent ?? 0;
	appState.activeDisplayProfile = (config.inputs.elevationProfile ??
		"fit-raw") as AppState["activeDisplayProfile"];

	const handler = getAnalysisModeHandlerById(config.mode);
	let selectedItems: number[] = [];

	const selection = config.selection as unknown as Record<string, unknown>;
	if (config.mode === "standard") {
		if ("timeRanges" in selection) {
			const ranges = selection.timeRanges as Array<{
				start: number;
				end: number;
			}>;
			// Explicit time windows BECOME the lap list — `selectionForLaps`
			// resolves 1-based ordinals over `currentLaps`, so a synthetic list
			// with every "lap" selected expresses an arbitrary window set.
			appState.currentLaps = ranges.map((range) => ({
				start_time: range.start,
				end_time: range.end,
			})) as AppState["currentLaps"];
			selectedItems = ranges.map((_, i) => i + 1);
		} else {
			selectedItems = [...(selection.laps as number[])];
			const known = appState.currentLaps.length;
			for (const lap of selectedItems) {
				if (lap < 1 || lap > known) {
					throw new Error(
						`selection.laps: lap ${lap} is out of range (activity has ${known})`,
					);
				}
			}
		}
		appState.selectedLaps = selectedItems;
		appState.currentAnalyzedLaps = selectedItems;
	} else if (config.mode === "gpsLap") {
		const indexRanges = selection.indexRanges as Array<{
			startIdx: number;
			endIdx: number;
		}>;
		const lapNumbers = (selection.lapNumbers as number[] | undefined) ?? null;
		appState.currentGpsLapIndexRanges = indexRanges;
		appState.currentOverlayLapNumbers = lapNumbers;
		selectedItems = lapNumbers ?? indexRanges.map((_, i) => i + 1);
		appState.currentAnalyzedLaps = selectedItems;
	} else {
		const sections = selection.sections as AppState["outAndBackSections"];
		// The veGolden harness sets this same pair, which is the proven headless
		// route into `resolveActiveOutAndBackSections`.
		appState.outAndBackSections = sections;
		appState.outAndBackSelectedSections = sections.map(
			(section) => section.sectionNumber,
		);
		selectedItems = appState.outAndBackSelectedSections;
		appState.currentAnalyzedLaps = selectedItems;
	}

	const windSource =
		config.inputs.windSource ?? getDefaultWindSource(activity.fitData);

	const rhoArray = config.inputs.rhoArray;
	const resolveRho =
		rhoArray === false
			? () => null
			: Array.isArray(rhoArray)
				? () => rhoArray
				: undefined;

	const { segments, recordedTrim } = applyTrim(config, appState, handler);

	return {
		appState,
		handler,
		segments,
		windSource,
		resolveRho,
		selectedItems,
		recordedTrim,
	};
}

function applyTrim(
	config: RunConfig,
	appState: AppState,
	handler: AnalysisModeHandler,
): {
	segments: ModeSegment[] | undefined;
	recordedTrim: { start: number; end: number };
} {
	const fullExtent = {
		start: 0,
		end: Math.max(0, (appState.currentFitData?.record_count ?? 1) - 1),
	};
	if (!config.trim) {
		return { segments: undefined, recordedTrim: fullExtent };
	}

	const segments = handler.getUpdateSegments(appState);

	if (config.trim.space === "selection") {
		const normalized = getNormalizedActivityArrays(appState.currentFitData!);
		// The UPDATE path's selection, exactly as the funnel maps it
		// (`requestModeUpdate.withTrim`).
		const selectedIndices = collectSelectionIndices(
			(handler.prepareUpdateSelection ?? handler.prepareSelection).call(
				handler,
				appState,
			),
			normalized.timestamps,
		);
		return {
			segments: mapTrimToSegments(
				segments,
				selectedIndices,
				config.trim.start,
				config.trim.end,
			),
			recordedTrim: { start: config.trim.start, end: config.trim.end },
		};
	}

	const byKey = config.trim.bySegmentKey;
	const trimmed: ModeSegment[] = [];
	for (const segment of segments) {
		const window = byKey[segment.key];
		if (!window) {
			trimmed.push(segment);
			continue;
		}
		if (window.end - window.start + 1 < MIN_TRIMMED_SEGMENT_SAMPLES) {
			// Matches `mapTrimToSegments`' drop rule for a window that leaves
			// nothing measurable.
			continue;
		}
		trimmed.push({ ...segment, trim: { ...window } });
	}
	return { segments: trimmed, recordedTrim: fullExtent };
}
