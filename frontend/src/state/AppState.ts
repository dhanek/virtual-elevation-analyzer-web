import type { AnalysisParameters } from "../components/AnalysisParameters";
import type {
	DetectedLap,
	GpsLapDetectionResult,
	OutAndBackResult,
	OutAndBackSection,
} from "../utils/GpsLapDetection";
import type { DEMSourceResult } from "../utils/MultiDEMManager";
import type { DEMSourceType } from "../utils/RemoteDEMConfig";
import type { VEAnalysisResult } from "../utils/ResultsStorage";
import type {
	FitData,
	LapData,
	ParsingStatistics,
} from "@wasm/virtual_elevation_analyzer.js";

export type WindSource = "constant" | "fit" | "compare" | "none";
export type ActivitySource = "fit" | "csv";
export type ActivityArray = number[] | Float64Array;

export interface ActivityData {
	timestamps: ActivityArray;
	position_lat: ActivityArray;
	position_long: ActivityArray;
	altitude: ActivityArray;
	velocity: ActivityArray;
	power: ActivityArray;
	air_speed: ActivityArray;
	distance: ActivityArray;
	wind_speed: ActivityArray;
	wind_yaw: ActivityArray;
	air_density_data: ActivityArray;
	road_speed: ActivityArray;
	temperature: ActivityArray;
	battery_soc: ActivityArray;
	heart_rate: ActivityArray;
	cadence: ActivityArray;
	record_count: number;
	humidity?: number[];
	pressure?: number[];
	cda_reference?: number[];
}

export interface ActivityLap {
	start_time: number;
	end_time: number;
	total_elapsed_time: number;
	total_distance: number;
	avg_power: number;
	avg_speed: number;
	max_speed?: number;
	start_position_lat: number;
	start_position_long: number;
	start_index?: number;
	end_index?: number;
	lap_number?: number;
}

export interface ActivityParsingStatistics {
	has_power_data: boolean;
	has_gps_data: boolean;
	has_altitude_data?: boolean;
	has_air_speed_data?: boolean;
	data_points?: number;
	file_size?: number;
	record_count?: number;
	lap_count?: number;
	duration_seconds?: number;
	total_distance_m?: number;
	avg_speed_ms?: number;
	max_speed_ms?: number;
	avg_power?: number;
	max_power?: number;
}

export interface ActivityResult {
	fit_data: ActivityDataLike | null;
	laps: ActivityLapLike[];
	parsing_statistics: ActivityParsingStatisticsLike;
}

export interface LoadedActivity {
	source: ActivitySource;
	file: File | null;
	fileHash: string | null;
	data: ActivityDataLike | null;
	laps: ActivityLapLike[];
	parsingStatistics: ActivityParsingStatisticsLike;
	result: ActivityResult;
}

export interface SelectedSlice {
	startIdx: number;
	endIdx: number;
	timestamps: number[];
	power: number[];
	velocity: number[];
	positionLat: number[];
	positionLong: number[];
	altitude: number[];
	distance: number[];
	windSpeed: number[];
}

export interface FilteredLapData {
	position_lat: number[];
	position_long: number[];
	timestamps: number[];
}

export interface FilteredVEData {
	positionLat: number[];
	positionLong: number[];
}

export interface FilteredAnalysisData {
	power: number[];
	velocity: number[];
	temperature: number[];
	timestamps: number[];
}

export interface LapIndexRange {
	startIdx: number;
	endIdx: number;
}

export type ActivityDataLike =
	| (FitData & {
			humidity?: number[];
			pressure?: number[];
			cda_reference?: number[];
	  })
	| ActivityData;
export type ActivityLapLike = LapData | ActivityLap;
export type ActivityParsingStatisticsLike =
	| ParsingStatistics
	| ActivityParsingStatistics;

export interface ActivityState {
	selectedFile: File | null;
	currentFileHash: string | null;
	loadedActivity: LoadedActivity | null;
	currentFitData: ActivityDataLike | null;
	currentFitResult: ActivityResult | null;
	currentLaps: ActivityLapLike[];
	currentCdaReference: number[] | null;
	currentRhoArray: number[] | null;
}

export interface SelectionState {
	selectedLaps: number[];
	filteredLapData: FilteredLapData | null;
	filteredVEData: FilteredVEData | null;
	presetTrimStart: number;
	presetTrimEnd: number | null;
	currentAnalyzedLaps: number[];
	currentFilteredData: FilteredAnalysisData | null;
	currentGpsLapIndexRanges: LapIndexRange[] | null;
	gpsSelectedLaps: number[];
	outAndBackSelectedSections: number[];
	currentOutAndBackSections: OutAndBackSection[];
}

export interface AnalysisState {
	currentParameters: AnalysisParameters | null;
	currentVEResult: VEAnalysisResult | null;
	currentWindSource: WindSource;
	airSpeedCalibrationPercent: number;
	recomputeStatus: "idle" | "running" | "handoff";
	isCalculatingAutoRho: boolean;
	isLoadingParameters: boolean;
	lastWeatherQueryKey: string | null;
}

export interface DemState {
	selectedDEMFile: File | null;
	elevationCorrectionEnabled: boolean;
	elevationErrorRate: number;
	remoteDEMSources: DEMSourceType[];
	remoteDEMResults: Map<DEMSourceType, DEMSourceResult> | null;
}

export interface UiState {
	gpsLapDetectionResult: GpsLapDetectionResult | null;
	gpsDetectedLaps: DetectedLap[];
	isGpsLapModeActive: boolean;
	previousAutoLapDetection: string;
	outAndBackResult: OutAndBackResult | null;
	outAndBackSections: OutAndBackSection[];
}

export function createLoadedActivity(input: {
	source: ActivitySource;
	file: File | null;
	fileHash: string | null;
	result: ActivityResult;
}): LoadedActivity {
	return {
		source: input.source,
		file: input.file,
		fileHash: input.fileHash,
		data: input.result.fit_data,
		laps: input.result.laps,
		parsingStatistics: input.result.parsing_statistics,
		result: input.result,
	};
}

export class AppState {
	readonly activity: ActivityState = {
		selectedFile: null,
		currentFileHash: null,
		loadedActivity: null,
		currentFitData: null,
		currentFitResult: null,
		currentLaps: [],
		currentCdaReference: null,
		currentRhoArray: null,
	};

	readonly selection: SelectionState = {
		selectedLaps: [],
		filteredLapData: null,
		filteredVEData: null,
		presetTrimStart: 0,
		presetTrimEnd: null,
		currentAnalyzedLaps: [],
		currentFilteredData: null,
		currentGpsLapIndexRanges: null,
		gpsSelectedLaps: [],
		outAndBackSelectedSections: [],
		currentOutAndBackSections: [],
	};

	readonly analysis: AnalysisState = {
		currentParameters: null,
		currentVEResult: null,
		currentWindSource: "none",
		airSpeedCalibrationPercent: 0,
		recomputeStatus: "idle",
		isCalculatingAutoRho: false,
		isLoadingParameters: false,
		lastWeatherQueryKey: null,
	};

	readonly dem: DemState = {
		selectedDEMFile: null,
		elevationCorrectionEnabled: false,
		elevationErrorRate: 0,
		remoteDEMSources: [],
		remoteDEMResults: null,
	};

	readonly ui: UiState = {
		gpsLapDetectionResult: null,
		gpsDetectedLaps: [],
		isGpsLapModeActive: false,
		previousAutoLapDetection: "None",
		outAndBackResult: null,
		outAndBackSections: [],
	};

	setLoadedActivity(activity: LoadedActivity | null): void {
		this.activity.loadedActivity = activity;
		this.activity.currentFitData = activity?.data ?? null;
		this.activity.currentFitResult = activity?.result ?? null;
		this.activity.currentLaps = activity?.laps ?? [];
	}

	get selectedFile(): File | null {
		return this.activity.selectedFile;
	}

	set selectedFile(file: File | null) {
		this.activity.selectedFile = file;
		if (this.activity.loadedActivity) {
			this.activity.loadedActivity.file = file;
		}
	}

	get currentFileHash(): string | null {
		return this.activity.currentFileHash;
	}

	set currentFileHash(fileHash: string | null) {
		this.activity.currentFileHash = fileHash;
		if (this.activity.loadedActivity) {
			this.activity.loadedActivity.fileHash = fileHash;
		}
	}

	get currentFitData(): ActivityDataLike | null {
		return this.activity.currentFitData;
	}

	set currentFitData(fitData: ActivityDataLike | null) {
		this.activity.currentFitData = fitData;
		if (this.activity.loadedActivity) {
			this.activity.loadedActivity.data = fitData;
			this.activity.loadedActivity.result.fit_data = fitData;
		}
	}

	get currentFitResult(): ActivityResult | null {
		return this.activity.currentFitResult;
	}

	set currentFitResult(result: ActivityResult | null) {
		this.activity.currentFitResult = result;
		this.activity.currentFitData = result?.fit_data ?? null;
		this.activity.currentLaps = result?.laps ?? [];
		if (this.activity.loadedActivity && result) {
			this.activity.loadedActivity.result = result;
			this.activity.loadedActivity.data = result.fit_data;
			this.activity.loadedActivity.laps = result.laps;
			this.activity.loadedActivity.parsingStatistics =
				result.parsing_statistics;
		}
	}

	get currentLaps(): ActivityLapLike[] {
		return this.activity.currentLaps;
	}

	set currentLaps(laps: ActivityLapLike[]) {
		this.activity.currentLaps = laps;
		if (this.activity.loadedActivity) {
			this.activity.loadedActivity.laps = laps;
			this.activity.loadedActivity.result.laps = laps;
		}
	}

	get currentCdaReference(): number[] | null {
		return this.activity.currentCdaReference;
	}

	set currentCdaReference(cdaReference: number[] | null) {
		this.activity.currentCdaReference = cdaReference;
	}

	get currentRhoArray(): number[] | null {
		return this.activity.currentRhoArray;
	}

	set currentRhoArray(rhoArray: number[] | null) {
		this.activity.currentRhoArray = rhoArray;
	}

	get filteredLapData(): FilteredLapData | null {
		return this.selection.filteredLapData;
	}

	set filteredLapData(filteredLapData: FilteredLapData | null) {
		this.selection.filteredLapData = filteredLapData;
	}

	get isCalculatingAutoRho(): boolean {
		return this.analysis.isCalculatingAutoRho;
	}

	set isCalculatingAutoRho(isCalculating: boolean) {
		this.analysis.isCalculatingAutoRho = isCalculating;
	}

	get lastWeatherQueryKey(): string | null {
		return this.analysis.lastWeatherQueryKey;
	}

	set lastWeatherQueryKey(queryKey: string | null) {
		this.analysis.lastWeatherQueryKey = queryKey;
	}

	get selectedLaps(): number[] {
		return this.selection.selectedLaps;
	}

	set selectedLaps(selectedLaps: number[]) {
		this.selection.selectedLaps = selectedLaps;
	}

	get currentParameters(): AnalysisParameters | null {
		return this.analysis.currentParameters;
	}

	set currentParameters(parameters: AnalysisParameters | null) {
		this.analysis.currentParameters = parameters;
	}

	get filteredVEData(): FilteredVEData | null {
		return this.selection.filteredVEData;
	}

	set filteredVEData(filteredVEData: FilteredVEData | null) {
		this.selection.filteredVEData = filteredVEData;
	}

	get presetTrimStart(): number {
		return this.selection.presetTrimStart;
	}

	set presetTrimStart(trimStart: number) {
		this.selection.presetTrimStart = trimStart;
	}

	get presetTrimEnd(): number | null {
		return this.selection.presetTrimEnd;
	}

	set presetTrimEnd(trimEnd: number | null) {
		this.selection.presetTrimEnd = trimEnd;
	}

	get isLoadingParameters(): boolean {
		return this.analysis.isLoadingParameters;
	}

	set isLoadingParameters(isLoading: boolean) {
		this.analysis.isLoadingParameters = isLoading;
	}

	get currentVEResult(): VEAnalysisResult | null {
		return this.analysis.currentVEResult;
	}

	set currentVEResult(result: VEAnalysisResult | null) {
		this.analysis.currentVEResult = result;
	}

	get currentWindSource(): WindSource {
		return this.analysis.currentWindSource;
	}

	set currentWindSource(windSource: WindSource) {
		this.analysis.currentWindSource = windSource;
	}

	get recomputeStatus(): "idle" | "running" | "handoff" {
		return this.analysis.recomputeStatus;
	}

	set recomputeStatus(status: "idle" | "running" | "handoff") {
		this.analysis.recomputeStatus = status;
	}

	get currentAnalyzedLaps(): number[] {
		return this.selection.currentAnalyzedLaps;
	}

	set currentAnalyzedLaps(analyzedLaps: number[]) {
		this.selection.currentAnalyzedLaps = analyzedLaps;
	}

	get currentFilteredData(): FilteredAnalysisData | null {
		return this.selection.currentFilteredData;
	}

	set currentFilteredData(filteredData: FilteredAnalysisData | null) {
		this.selection.currentFilteredData = filteredData;
	}

	get airSpeedCalibrationPercent(): number {
		return this.analysis.airSpeedCalibrationPercent;
	}

	set airSpeedCalibrationPercent(calibrationPercent: number) {
		this.analysis.airSpeedCalibrationPercent = calibrationPercent;
	}

	get gpsLapDetectionResult(): GpsLapDetectionResult | null {
		return this.ui.gpsLapDetectionResult;
	}

	set gpsLapDetectionResult(result: GpsLapDetectionResult | null) {
		this.ui.gpsLapDetectionResult = result;
	}

	get gpsDetectedLaps(): DetectedLap[] {
		return this.ui.gpsDetectedLaps;
	}

	set gpsDetectedLaps(laps: DetectedLap[]) {
		this.ui.gpsDetectedLaps = laps;
	}

	get gpsSelectedLaps(): number[] {
		return this.selection.gpsSelectedLaps;
	}

	set gpsSelectedLaps(laps: number[]) {
		this.selection.gpsSelectedLaps = laps;
	}

	get isGpsLapModeActive(): boolean {
		return this.ui.isGpsLapModeActive;
	}

	set isGpsLapModeActive(isActive: boolean) {
		this.ui.isGpsLapModeActive = isActive;
	}

	get currentGpsLapIndexRanges(): LapIndexRange[] | null {
		return this.selection.currentGpsLapIndexRanges;
	}

	set currentGpsLapIndexRanges(indexRanges: LapIndexRange[] | null) {
		this.selection.currentGpsLapIndexRanges = indexRanges;
	}

	get previousAutoLapDetection(): string {
		return this.ui.previousAutoLapDetection;
	}

	set previousAutoLapDetection(value: string) {
		this.ui.previousAutoLapDetection = value;
	}

	get outAndBackResult(): OutAndBackResult | null {
		return this.ui.outAndBackResult;
	}

	set outAndBackResult(result: OutAndBackResult | null) {
		this.ui.outAndBackResult = result;
	}

	get outAndBackSections(): OutAndBackSection[] {
		return this.ui.outAndBackSections;
	}

	set outAndBackSections(sections: OutAndBackSection[]) {
		this.ui.outAndBackSections = sections;
	}

	get outAndBackSelectedSections(): number[] {
		return this.selection.outAndBackSelectedSections;
	}

	set outAndBackSelectedSections(sectionNumbers: number[]) {
		this.selection.outAndBackSelectedSections = sectionNumbers;
	}

	get currentOutAndBackSections(): OutAndBackSection[] {
		return this.selection.currentOutAndBackSections;
	}

	set currentOutAndBackSections(sections: OutAndBackSection[]) {
		this.selection.currentOutAndBackSections = sections;
	}

	get selectedDEMFile(): File | null {
		return this.dem.selectedDEMFile;
	}

	set selectedDEMFile(file: File | null) {
		this.dem.selectedDEMFile = file;
	}

	get elevationCorrectionEnabled(): boolean {
		return this.dem.elevationCorrectionEnabled;
	}

	set elevationCorrectionEnabled(isEnabled: boolean) {
		this.dem.elevationCorrectionEnabled = isEnabled;
	}

	get elevationErrorRate(): number {
		return this.dem.elevationErrorRate;
	}

	set elevationErrorRate(errorRate: number) {
		this.dem.elevationErrorRate = errorRate;
	}

	get remoteDEMSources(): DEMSourceType[] {
		return this.dem.remoteDEMSources;
	}

	set remoteDEMSources(sources: DEMSourceType[]) {
		this.dem.remoteDEMSources = sources;
	}

	get remoteDEMResults(): Map<DEMSourceType, DEMSourceResult> | null {
		return this.dem.remoteDEMResults;
	}

	set remoteDEMResults(results: Map<DEMSourceType, DEMSourceResult> | null) {
		this.dem.remoteDEMResults = results;
	}
}
