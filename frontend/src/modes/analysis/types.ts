import type { AnalysisParameters } from "../../components/AnalysisParameters";
import type {
	ActivityDataLike,
	ActivityLapLike,
	AppState,
	LapIndexRange,
} from "../../state/AppState";
import type {
	DetectedLap,
	OutAndBackSection,
} from "../../utils/GpsLapDetection";

export type AnalysisModeId = "standard" | "gpsLap" | "outAndBack";

export interface TimeRange {
	start: number;
	end: number;
}

export type AnalysisSelectionEntry =
	| ActivityLapLike
	| DetectedLap
	| OutAndBackSection;

export interface PreparedAnalysisSelection {
	mode: AnalysisModeId;
	selectedItems: number[];
	selectedEntries: AnalysisSelectionEntry[];
	indexRanges: LapIndexRange[] | null;
	timeRanges: TimeRange[] | null;
	outAndBackSections: OutAndBackSection[] | null;
	emptySelectionMessage: string;
}

export interface FilteredAnalysisPayload {
	timestamps: number[];
	power: number[];
	velocity: number[];
	positionLat: number[];
	positionLong: number[];
	altitude: number[];
	distance: number[];
	windSpeed: number[];
	temperature: number[];
	cdaReference: number[] | null;
}

export interface StandardRenderArgs extends FilteredAnalysisPayload {
	initialResult: any;
	analyzedLaps: number[];
	selectedIndices: number[];
	defaultAirSpeedOffset: number;
}

export interface ModeRenderCallbacks {
	standard(args: StandardRenderArgs): Promise<void> | void;
	gpsLap(args: {
		lapIndexRanges: LapIndexRange[];
		fitData: ActivityDataLike;
		params: AnalysisParameters;
		defaultAirSpeedOffset: number;
	}): Promise<void> | void;
	outAndBack(args: {
		sections: OutAndBackSection[];
		fitData: ActivityDataLike;
		params: AnalysisParameters;
		defaultAirSpeedOffset: number;
	}): Promise<void> | void;
}

export interface ModeRenderArgs {
	appState: AppState;
	selection: PreparedAnalysisSelection;
	fitData: ActivityDataLike;
	params: AnalysisParameters;
	defaultAirSpeedOffset: number;
	initialResult: any;
	filteredData: FilteredAnalysisPayload;
	selectedIndices: number[];
	callbacks: ModeRenderCallbacks;
}

export interface AnalysisModeHandler {
	id: AnalysisModeId;
	getSelectedItems(appState: AppState): number[];
	validate(appState: AppState): string | null;
	prepareSelection(appState: AppState): PreparedAnalysisSelection;
	syncState(appState: AppState, selection: PreparedAnalysisSelection): void;
	render(args: ModeRenderArgs): Promise<void> | void;
}
