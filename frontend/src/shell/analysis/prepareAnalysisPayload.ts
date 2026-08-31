/**
 * Selection filtering for the analyze path. NO PHYSICS.
 *
 * Per D-05: no AppState mutation, no DOM dependency.
 *
 * THIS FUNCTION USED TO RUN A CALCULATOR (WR-4). It integrated the whole
 * CONCATENATED selection in one pass, with no trim window and with the wind
 * source forced to `"fit"` and the offset off, and returned the fit as
 * `initialResult`. Two things consumed it, and neither should have:
 *
 *   - Standard's header spans, which sat directly above a plot drawn from a
 *     DIFFERENT fit -- `initializeVEAnalysis`'s own, trimmed and on the selected
 *     wind source. The spans are filled from that one now, on the same rule the
 *     virtual-distance header already followed.
 *   - `appState.currentVEResult`, assigned for EVERY mode. The GPS panels
 *     display N per-lap fits (2N legs for out-and-back) and never received
 *     `initialResult` at all, so Store Result straight after Analyze persisted
 *     an r2/RMSE no screen had shown.
 *
 * `handler.summarize`, off the shared update primitive, is the one writer of
 * that field now, for all three modes. With the calculator went `rhoArray` and
 * the `calculateRhoArray` injection: nothing outside the deleted calculator read
 * either, and the primitive resolves rho itself per update (D-06).
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

export interface PayloadPreparationInput {
	appState: AppState;
	fitData: ActivityDataLike;
	selection: PreparedAnalysisSelection;
	params: AnalysisParameters;
	getNormalizedActivityArrays: (
		fitData: ActivityDataLike,
	) => NormalizedActivityArrays;
}

export interface PreparedPayload {
	filteredData: FilteredAnalysisPayload;
	selectedIndices: number[];
	defaultAirSpeedOffset: number;
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
		// NaN for "no reading", never `|| 0` (CR-01). `getNormalizedActivityArrays`
		// returns an empty array for a ride with no temperature channel, so `|| 0`
		// pushed a fabricated 0 °C at every index — and it also collapsed a
		// genuine 0 °C onto the same value, so no consumer could tell the two
		// apart. `segmentSummary.ts:154-167` uses NaN as the one marker that says
		// "no reading" without claiming a temperature; this is the analyze path
		// agreeing with it rather than contradicting it.
		const reading = normalized.temperature[index];
		filteredTemperature.push(Number.isFinite(reading) ? reading : Number.NaN);
	}

	if (filteredTimestamps.length === 0) {
		throw new Error("No valid data points found in selected laps");
	}

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
		selectedIndices,
		defaultAirSpeedOffset,
	};
}
