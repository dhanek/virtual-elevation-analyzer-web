/**
 * THE mode-agnostic VE update primitive (D-01, ROADMAP SC#1).
 *
 * All three modes compute through this one function. Adding a wind-, elevation-
 * or rho-shaped parameter here reaches Standard, GPS-lap and out-and-back by
 * construction, without editing a mode file — which is the omission class that
 * produced the 2026-04-19 bug, where a parameter reached one of three paths.
 *
 * What this owns, and owns exactly once per update:
 *   - `resolveWindSeries` over the FULL series (D-05). This is the only place
 *     the air-speed offset and the calibration multiplier are applied anywhere
 *     in the update path. Because `applyAirSpeedOffset` shifts by ARRAY INDEX,
 *     resolving before any slicing is what makes the multi-lap offset-ordering
 *     defect structurally impossible (D-19, change-list entry c).
 *   - `resolveElevationProfile` over the FULL series (D-06 / D-18). Before this,
 *     the GPS modes read raw altitude, so the elevation-smoothing toggle burned
 *     a recompute and returned identical numbers — a control that lied.
 *   - the rho array (D-06). The primitive OWNS this resolution per update: it
 *     resolves the full-activity series here and slices it per segment. There
 *     is deliberately no caching layer here, and none should be added: the
 *     former write-only AppState field was deleted on 2026-08-22 by maintainer
 *     ruling, because nothing ever read it back, because `resolveRhoArray`
 *     recomputes correctly on every update, and because storing it again would
 *     introduce an invalidation question that would need its own guard.
 *   - the tab-active check, which after this plan exists in exactly ONE place
 *     in the update path rather than at six call sites (D-14).
 *
 * Rendering and mode statistics are INJECTED as `ModeUpdateCallbacks`, exactly
 * the way `createModeRenderCallbacks` is injected at `analyzeOrchestrator.ts`.
 * Nothing here reads a slider, constructs a figure, or knows which mode it is
 * serving; the differences stay named at the handler seam (D-02).
 */
import { getNormalizedActivityArrays } from "../../analysis/ActivityArrayCache";
import { resolveAppliedCrr } from "../../analysis/CrrTemperatureCorrection";
import { extractSegmentData } from "../../analysis/SegmentExtractor";
import { buildSegmentSupplementarySeries } from "../../analysis/SegmentSupplementarySeries";
import { createVeCalculator } from "../../analysis/VeCalculatorFactory";
import { resolveWindSeries } from "../../analysis/WindSourceResolver";
import type {
	AnalysisModeHandler,
	ModeAggregateStats,
	ModeSegment,
	ModeUpdateCallbacks,
	ResolvedUpdateInputs,
	SegmentVeProfile,
} from "../../modes/analysis/types";
import type { ActivityDataLike, AppState, WindSource } from "../../state/AppState";
import type { NormalizedActivityArrays } from "../../analysis/ActivityArrayCache";
import type { VEAnalysisResult } from "../../utils/ResultsStorage";
import { log } from "../../utils/log";
import { resolveElevationProfile } from "./elevationProfileResolver";
import { resolveRhoArray } from "./rhoArrayResolver";

/** Segments shorter than this are skipped, matching both reference paths. */
const MIN_SEGMENT_SAMPLES = 10;

export interface UpdateModeVEPlotsArgs {
	appState: AppState;
	handler: AnalysisModeHandler;
	callbacks: ModeUpdateCallbacks;
	windSource: WindSource;
	cda: number;
	/** The raw 22 °C-referenced slider value. */
	crr: number;
	/**
	 * Optional override, so the Standard binder can attach the DOM-sourced
	 * `trim` to the handler's segments. When absent the primitive asks the
	 * handler.
	 */
	segments?: ModeSegment[];
	/** Injectable so node tests can force the rho-absent case. */
	resolveRho?: (
		fitData: ActivityDataLike,
		normalized: NormalizedActivityArrays,
	) => number[] | null;
	/** Injectable so node tests can drive tab laziness without a document. */
	isTabActive?: (tabId: string) => boolean;
}

export interface ModeUpdateOutcome {
	inputs: ResolvedUpdateInputs;
	profiles: SegmentVeProfile[];
	aggregate: ModeAggregateStats;
}

/**
 * The ONE tab-active check in the update path (D-14).
 *
 * Guarded so the primitive stays callable from node, which is what lets the
 * golden harness assert real numbers against it with no browser environment.
 *
 * Exported because Standard's `compare` branch used to import it rather than
 * carry a second copy of the class-name check. Plan 07-04 folded that branch
 * into this primitive, so the export currently has no production consumer — it
 * is kept as the ONE definition any future caller must import, which is what
 * D-14 exists to enforce.
 */
export function isVeTabActive(tabId: string): boolean {
	if (typeof document === "undefined") {
		return false;
	}
	return (
		document
			.getElementById(tabId)
			?.classList.contains("ve-tab-content--active") ?? false
	);
}

export async function updateModeVEPlots(
	args: UpdateModeVEPlotsArgs,
): Promise<ModeUpdateOutcome | null> {
	const { appState, handler, callbacks } = args;
	const fitData = appState.currentFitData;
	const params = appState.currentParameters;

	if (!fitData || !params) {
		log.error("Missing data for VE update");
		return null;
	}

	const normalized = getNormalizedActivityArrays(fitData);

	// (1) Wind, ONCE per leg, over the full series. Offset and calibration happen
	//     here and nowhere else in the update path.
	//
	//     COMPARE RESOLVES TWICE, and asks for the two CONCRETE sources by name
	//     (D-07/D-20, plan 07-04 ruling 1). `resolveWindSeries` collapses
	//     'compare' to 'fit' before it does anything else, and that collapse is
	//     deliberately left in place: seven other callers pass a wind source
	//     through it and every one of them wants a SINGLE USABLE series — the
	//     auto-calibration helper in particular would compute a meaningless
	//     percentage from the all-NaN constant series. Un-collapsing at the
	//     resolver would change what all of them receive. Asking here for 'fit'
	//     and then for 'constant' reproduces both existing behaviours exactly,
	//     with no blast radius outside this function.
	const isCompare = args.windSource === "compare";

	const wind = resolveWindSeries({
		fitData,
		windSource: isCompare ? "fit" : args.windSource,
		params,
		airSpeedCalibrationPercent: appState.airSpeedCalibrationPercent,
	});

	const compareWind = isCompare
		? resolveWindSeries({
				fitData,
				windSource: "constant",
				params,
				airSpeedCalibrationPercent: appState.airSpeedCalibrationPercent,
			})
		: null;

	// (2) Elevation, ONCE, full length. The smoothing toggle now reaches every
	//     mode rather than only the analyze path.
	const elevation = resolveElevationProfile(
		appState,
		fitData,
		normalized.altitude,
	);

	// (3) Rho, ONCE per update, full length. Sliced per segment below, at the
	//     `segmentRho` line inside the segment loop.
	const resolveRho = args.resolveRho ?? resolveRhoArray;
	const rhoArray = resolveRho(fitData, normalized);

	// (4) The slider Crr is 22 °C-referenced; the physics uses the corrected
	//     value when the correction is enabled.
	const appliedCrr = resolveAppliedCrr(params, args.crr);

	const inputs: ResolvedUpdateInputs = {
		normalized,
		wind,
		compareWind,
		altitude: elevation.altitude,
		rhoArray,
		params,
		cda: args.cda,
		crr: args.crr,
		appliedCrr,
		windSource: args.windSource,
	};

	const segments = args.segments ?? handler.getUpdateSegments(appState);
	const profiles: SegmentVeProfile[] = [];

	for (const segment of segments) {
		const slice = extractSegmentData({
			startIdx: segment.range.startIdx,
			endIdx: segment.range.endIdx,
			allTimestamps: normalized.timestamps,
			allPower: normalized.power,
			allVelocity: normalized.velocity,
			allPositionLat: normalized.positionLat,
			allPositionLong: normalized.positionLong,
			// Altitude comes from the RESOLVED profile, not the raw arrays --
			// this is what makes the smoothing toggle real in the GPS modes.
			allAltitude: elevation.altitude,
			allDistance: normalized.distance,
			// Wind comes from the RESOLVED series, already offset and calibrated
			// on the full activity.
			allWindSpeed: wind.windSpeed,
		});

		if (slice.timestamps.length < MIN_SEGMENT_SAMPLES) {
			log.warn(
				`Lap ${segment.label} has too few data points (${slice.timestamps.length}), skipping`,
			);
			continue;
		}

		// Full-activity indices this segment consumed, in order.
		const indices: number[] = [];
		for (
			let i = segment.range.startIdx;
			i <= segment.range.endIdx && i < normalized.timestamps.length;
			i++
		) {
			indices.push(i);
		}

		const segmentRho = rhoArray ? indices.map((i) => rhoArray[i]) : null;

		try {
			const supplementarySeries = buildSegmentSupplementarySeries({
				timestamps: slice.timestamps,
				power: slice.power,
				velocity: slice.velocity,
				positionLat: slice.positionLat,
				positionLong: slice.positionLong,
				distance: slice.distance,
				windSpeed: slice.windSpeed,
				params,
				selectedWindSource: wind.selectedWindSource,
			});

			const calculator = createVeCalculator({
				timestamps: slice.timestamps,
				power: slice.power,
				velocity: slice.velocity,
				positionLat: slice.positionLat,
				positionLong: slice.positionLong,
				altitude: slice.altitude,
				distance: slice.distance,
				windSpeed: slice.windSpeed,
				rhoArray: segmentRho,
				params,
				cda: args.cda,
				crr: appliedCrr,
			});

			const trimStart = segment.trim?.start ?? 0;
			const trimEnd = segment.trim?.end ?? slice.timestamps.length - 1;

			const result = calculator.calculate_virtual_elevation(
				args.cda,
				appliedCrr,
				trimStart,
				trimEnd,
			) as VEAnalysisResult;

			// THE SECOND CALCULATOR (D-07/D-20). Identical inputs — same rho
			// slice, same resolved altitude, same cda/crr, same trim — except the
			// wind series, which is exactly the one difference Standard's
			// pre-refactor compare branch made between its two calculators. Built
			// through `createVeCalculator` like every other calculator in the app,
			// so two per segment does not cost a second WASM entry point
			// (Phase 8 D-04).
			let virtualElevationCompare: number[] | null = null;
			let resultCompare: VEAnalysisResult | null = null;
			if (compareWind) {
				const compareCalculator = createVeCalculator({
					timestamps: slice.timestamps,
					power: slice.power,
					velocity: slice.velocity,
					positionLat: slice.positionLat,
					positionLong: slice.positionLong,
					altitude: slice.altitude,
					distance: slice.distance,
					windSpeed: indices.map((i) => compareWind.windSpeed[i]),
					rhoArray: segmentRho,
					params,
					cda: args.cda,
					crr: appliedCrr,
				});
				resultCompare = compareCalculator.calculate_virtual_elevation(
					args.cda,
					appliedCrr,
					trimStart,
					trimEnd,
				) as VEAnalysisResult;
				virtualElevationCompare = Array.from(
					resultCompare.virtual_elevation as Float64Array,
				);
			}

			profiles.push({
				segment,
				indices,
				distancesKm: supplementarySeries.distancesKm,
				timeIndices: slice.timestamps.map((_, i) => i),
				virtualElevation: Array.from(
					result.virtual_elevation as Float64Array,
				),
				virtualElevationCompare,
				resultCompare,
				actualElevation: params.velodrome
					? new Array(slice.altitude.length).fill(0)
					: slice.altitude,
				supplementarySeries,
				result,
			});
		} catch (err) {
			log.error(`Failed to calculate VE for ${segment.label}:`, err);
		}
	}

	if (profiles.length === 0) {
		log.error("No valid segments to display");
		return null;
	}

	const aggregate = callbacks.aggregate(profiles);

	// The summarize seam owns the AppState result writes for every mode. This
	// is what gives out-and-back its Store Result / Export CSV fix (D-17a, N-1).
	handler.summarize(appState, profiles, aggregate, inputs);

	const isTabActive = args.isTabActive ?? isVeTabActive;

	await callbacks.renderVe(profiles, aggregate);
	await callbacks.renderMetrics(aggregate);

	if (isTabActive("wind-tab")) {
		await callbacks.renderWind(profiles);
	}
	if (isTabActive("power-tab")) {
		await callbacks.renderPower(profiles);
	}
	if (isTabActive("vd-tab")) {
		await callbacks.renderVd(profiles);
	}

	log.debug(
		`VE plots updated with ${profiles.length} segments, CdA=${args.cda.toFixed(3)}, Crr=${args.crr.toFixed(4)}`,
	);

	return { inputs, profiles, aggregate };
}
