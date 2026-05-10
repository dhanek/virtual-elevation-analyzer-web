/**
 * Pure analysis payload preparation extracted from handleAnalyze.
 *
 * Per D-05: no AppState mutation, no DOM dependency.
 * The caller syncs rhoArray and other state after getting the result.
 */
import type {
	PreparedAnalysisSelection,
	FilteredAnalysisPayload,
} from "../../modes/analysis/types";
import type { ActivityDataLike, AppState } from "../../state/AppState";
import { resolveElevationProfile } from "./elevationProfileResolver";
import type { AnalysisParameters } from "../../components/AnalysisParameters";
import type { NormalizedActivityArrays } from "../../analysis/ActivityArrayCache";
import { resolveWindSeries } from "../../analysis/WindSourceResolver";
import { collectSelectionIndices } from "../../modes/analysis/AnalysisModes";
import { createVeCalculator } from "../../analysis/VeCalculatorFactory";
import { log } from "../../utils/log";

export interface PayloadPreparationInput {
	appState: AppState;
	fitData: ActivityDataLike;
	selection: PreparedAnalysisSelection;
	params: AnalysisParameters;
	cda: number | null | undefined;
	crr: number | null | undefined;
	getNormalizedActivityArrays: (
		fitData: ActivityDataLike,
	) => NormalizedActivityArrays;
	calculateRhoArray?: (fitData: ActivityDataLike) => number[] | null;
}

export interface PreparedPayload {
	filteredData: FilteredAnalysisPayload;
	initialResult: any;
	selectedIndices: number[];
	defaultAirSpeedOffset: number;
	rhoArray: number[] | null;
}

export function prepareAnalysisPayload(
	input: PayloadPreparationInput,
): PreparedPayload {
	const normalized = input.getNormalizedActivityArrays(input.fitData);

	const resolvedElevationProfile = resolveElevationProfile(
		input.appState,
		input.fitData,
		normalized.altitude,
	);

	const allTimestamps = normalized.timestamps;

	const windResolution = resolveWindSeries({
		fitData: input.fitData,
		windSource: "fit",
		applyOffset: false,
	});
	const { defaultAirSpeedOffset } = windResolution;
	const resolvedWindSpeed = windResolution.windSpeed;

	const selectedIndices = collectSelectionIndices(
		input.selection,
		allTimestamps,
	);

	// Filter arrays by selected indices
	const filteredTimestamps: number[] = [];
	const filteredPower: number[] = [];
	const filteredVelocity: number[] = [];
	const filteredPositionLat: number[] = [];
	const filteredPositionLong: number[] = [];
	const filteredAltitude: number[] = [];
	const filteredDistance: number[] = [];
	const filteredWindSpeed: number[] = [];
	const filteredTemperature: number[] = [];

	for (const index of selectedIndices) {
		filteredTimestamps.push(allTimestamps[index]);
		filteredPower.push(normalized.power[index]);
		filteredVelocity.push(normalized.velocity[index]);
		filteredPositionLat.push(normalized.positionLat[index]);
		filteredPositionLong.push(normalized.positionLong[index]);
		filteredAltitude.push(resolvedElevationProfile.altitude[index]);
		filteredDistance.push(normalized.distance[index]);
		filteredWindSpeed.push(resolvedWindSpeed[index]);
		filteredTemperature.push(normalized.temperature[index] || 0);
	}

	if (filteredTimestamps.length === 0) {
		throw new Error("No valid data points found in selected laps");
	}

	// Handle rho array via injected dependency
	let rhoArray: number[] | null = null;
	if (input.calculateRhoArray) {
		const fullRhoArray = input.calculateRhoArray(input.fitData);
		if (fullRhoArray) {
			rhoArray = selectedIndices.map((index) => fullRhoArray[index]);
			log.debug("Using calculated rho array for VE analysis");
		}
	}

	// Create VE calculator and compute initial result
	const calculator = createVeCalculator({
		timestamps: filteredTimestamps,
		power: filteredPower,
		velocity: filteredVelocity,
		positionLat: filteredPositionLat,
		positionLong: filteredPositionLong,
		altitude: filteredAltitude,
		distance: filteredDistance,
		windSpeed: filteredWindSpeed,
		rhoArray,
		params: input.params,
		cda: input.cda,
		crr: input.crr,
	});

	const effectiveCda = input.cda ?? 0.3;
	const effectiveCrr = input.crr ?? 0.008;
	const initialResult = calculator.calculate_virtual_elevation(
		effectiveCda,
		effectiveCrr,
		0,
		filteredTimestamps.length - 1,
	);

	// Filter CdA reference if available
	let filteredCdaReference: number[] | null = null;
	if (normalized.cdaReference) {
		filteredCdaReference = selectedIndices.map(
			(index) => normalized.cdaReference![index],
		);
	}

	const filteredData: FilteredAnalysisPayload = {
		timestamps: filteredTimestamps,
		power: filteredPower,
		velocity: filteredVelocity,
		positionLat: filteredPositionLat,
		positionLong: filteredPositionLong,
		altitude: filteredAltitude,
		distance: filteredDistance,
		windSpeed: filteredWindSpeed,
		temperature: filteredTemperature,
		cdaReference: filteredCdaReference,
	};

	return {
		filteredData,
		initialResult,
		selectedIndices,
		defaultAirSpeedOffset,
		rhoArray,
	};
}
