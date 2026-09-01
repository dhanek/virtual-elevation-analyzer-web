/**
 * The CdA/Crr-INDEPENDENT front half of a VE update pass, extracted from
 * `updateModeVEPlots`' segment loop (Convergence plan, task A7).
 *
 * Everything here — slicing, the supplementary series, the rho slice, the
 * calculator construction, the trim clamp, the closure target — depends on the
 * selection and the resolved inputs but NOT on the CdA/Crr values a pass runs
 * at. Splitting it out is what lets three consumers share one preparation:
 *
 *   1. the update pass itself (`calculate_virtual_elevation` per segment);
 *   2. the Convergence tab's closure-error grid (`ve_gain_grid` per segment);
 *   3. the auto-converge solve, which bisects `ve_gain` across ALL prepared
 *      segments before the pass's CdA/Crr are even final.
 *
 * `createVeCalculator` takes `cda`/`crr`, but those only land in the WASM-side
 * `VEParameters` record — the physics reads the ARGUMENTS of
 * `calculate_virtual_elevation` / `ve_gain` (`virtual_elevation.rs`), so a
 * calculator prepared here serves every CdA/Crr the consumers try.
 *
 * Behaviour is lifted verbatim: the same `MIN_SEGMENT_SAMPLES` skip with the
 * same warning, and the same "Failed to calculate VE for <label>" error when a
 * segment's preparation throws (the update pass logs the identical message for
 * a failure in its half, so the observable logging is unchanged).
 */
import type { NormalizedActivityArrays } from "../../analysis/ActivityArrayCache";
import type { AutoConvergeSegment } from "../../analysis/AutoConverge";
import { resolveAppliedCrr } from "../../analysis/CrrTemperatureCorrection";
import {
	resolveClosureTarget,
	type ElevationDiffSource,
} from "../../analysis/ClosureTarget";
import { extractSegmentData } from "../../analysis/SegmentExtractor";
import { buildSegmentSupplementarySeries } from "../../analysis/SegmentSupplementarySeries";
import { createVeCalculator } from "../../analysis/VeCalculatorFactory";
import type { WindSeriesResolution } from "../../analysis/WindSourceResolver";
import type { AnalysisParameters } from "../../components/AnalysisParameters";
import type {
	ConvergenceUpdateInput,
	ModeSegment,
} from "../../modes/analysis/types";
import type { WindSource } from "../../state/AppState";
import { log } from "../../utils/log";

/** Segments shorter than this are skipped, matching both reference paths. */
export const MIN_SEGMENT_SAMPLES = 10;

export interface PreparedSegment {
	segment: ModeSegment;
	/** Full-activity indices this segment consumed, in order. */
	indices: number[];
	slice: ReturnType<typeof extractSegmentData>;
	supplementarySeries: ReturnType<typeof buildSegmentSupplementarySeries>;
	calculator: ReturnType<typeof createVeCalculator>;
	/** Present iff the pass runs under `compare` (D-07/D-20). */
	compareCalculator: ReturnType<typeof createVeCalculator> | null;
	/** Segment-local trim window, defaulted to the full extent. */
	trimStart: number;
	trimEnd: number;
	/**
	 * The reference elevation difference over the trim window
	 * (`resolveClosureTarget`, per the selected elevation-difference source) —
	 * what a closure-error consumer subtracts from `ve_gain`.
	 */
	closureTarget: number;
}

export interface PrepareSegmentsArgs {
	segments: ModeSegment[];
	normalized: NormalizedActivityArrays;
	/** The RESOLVED elevation profile, full length (D-06/D-18). */
	altitude: number[];
	/** The RESOLVED primary wind series, full length (D-05). */
	wind: WindSeriesResolution;
	/** The constant-wind series when the pass runs under `compare`. */
	compareWind: WindSeriesResolution | null;
	/** Full-activity rho series, or null for the constant-rho path. */
	rhoArray: number[] | null;
	params: AnalysisParameters;
	/** Stored in the calculator's VEParameters only — see the header. */
	cda: number;
	appliedCrr: number;
	/** Where each segment's closure target comes from (phase 2). */
	closure: ClosureResolution;
}

export interface ClosureResolution {
	source: ElevationDiffSource;
	/**
	 * Full-length DEM elevation channel when one is loaded
	 * (`resolveClosureDemAltitude`); null falls back to the resolved profile.
	 */
	demAltitude: number[] | null;
	/**
	 * Full-length lag-corrected barometric channel for the 'barometer' source
	 * (`resolveClosureBaroAltitude`); null falls back to the raw normalized
	 * channel.
	 */
	baroAltitude: number[] | null;
	manualDiffMetres: number | null;
}

export function prepareSegments(args: PrepareSegmentsArgs): PreparedSegment[] {
	const {
		segments,
		normalized,
		altitude,
		wind,
		compareWind,
		rhoArray,
		params,
		closure,
	} = args;
	const prepared: PreparedSegment[] = [];

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
			allAltitude: altitude,
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
				crr: args.appliedCrr,
			});

			// THE SECOND CALCULATOR (D-07/D-20). Identical inputs — same rho
			// slice, same resolved altitude, same cda/crr, same trim — except
			// the wind series, which is exactly the one difference Standard's
			// pre-refactor compare branch made between its two calculators.
			// Built through `createVeCalculator` like every other calculator in
			// the app, so two per segment does not cost a second WASM entry
			// point (Phase 8 D-04).
			const compareCalculator = compareWind
				? createVeCalculator({
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
						crr: args.appliedCrr,
					})
				: null;

			const trimStart = segment.trim?.start ?? 0;
			const trimEnd = segment.trim?.end ?? slice.timestamps.length - 1;

			prepared.push({
				segment,
				indices,
				slice,
				supplementarySeries,
				calculator,
				compareCalculator,
				trimStart,
				trimEnd,
				// Only the channel the source reads is sliced; 'dem' with no
				// DEM loaded passes nothing extra and falls back to the
				// resolved profile inside `resolveClosureTarget` (phase 1's
				// behaviour, byte for byte).
				closureTarget: resolveClosureTarget({
					source: closure.source,
					altitude: slice.altitude,
					demAltitude:
						closure.source === "dem" && closure.demAltitude
							? indices.map((i) => closure.demAltitude![i])
							: null,
					barometricAltitude:
						closure.source === "barometer"
							? indices.map(
									(i) =>
										(closure.baroAltitude ?? normalized.altitude)[i],
								)
							: null,
					manualDiffMetres: closure.manualDiffMetres,
					velodrome: params.velodrome,
					trimStart,
					trimEnd,
				}),
			});
		} catch (err) {
			log.error(`Failed to calculate VE for ${segment.label}:`, err);
		}
	}

	return prepared;
}

export interface BuildConvergenceUpdateInputArgs {
	prepared: PreparedSegment[];
	params: AnalysisParameters;
	windSource: WindSource;
	airSpeedCalibrationPercent: number;
	activeDisplayProfile: string | null | undefined;
	rhoArray: number[] | null;
	cda: number;
	crr: number;
	appliedCrr: number;
	/** The elevation-difference source the targets were resolved from. */
	targetSource: ElevationDiffSource;
	/**
	 * Honest on-screen name for the source — the caller knows whether 'dem'
	 * actually found a DEM channel or fell back to the analysis profile.
	 */
	targetLabel: string;
}

/**
 * Wraps the prepared segments for `renderConvergence`, and builds the TWO
 * surface-cache signatures.
 *
 * BOTH SIGNATURES EXCLUDE CdA AND Crr BY DESIGN: those are the marker, not the
 * surface, and including them would recompute the grid on every drag — the
 * exact thing the cache exists to prevent.
 *
 * `gainsSignature` keys the raw per-segment gain grids and carries everything
 * that changes what Rust computes: segment identity/ranges/trims, wind source,
 * calibration, elevation profile, a cheap rho fingerprint, the physics
 * parameters, the temperature-correction scale and the grid bounds.
 * `signature` keys the POOLED surface and adds the closure targets (and hence
 * the elevation-difference source): switching sources re-pools the cached
 * gains without recomputing any grid, which is what phase 2's radio buys.
 * Over-invalidation is merely slow once; under-invalidation is a map that
 * silently describes a fit the user has already changed.
 */
export function buildConvergenceUpdateInput(
	args: BuildConvergenceUpdateInputArgs,
): ConvergenceUpdateInput {
	const { prepared, params, rhoArray } = args;
	const cdaMin = params.cda_min ?? 0.15;
	const cdaMax = params.cda_max ?? 0.5;
	const crrMin = params.crr_min ?? 0.0015;
	const crrMax = params.crr_max ?? 0.03;
	// `applyCrrTempCorrection` is a pure scaling of Crr, so one factor turns
	// the whole slider-value axis into applied-Crr space.
	const crrScale = args.crr !== 0 ? args.appliedCrr / args.crr : 1;

	let rhoSum = 0;
	if (rhoArray) {
		for (const value of rhoArray) {
			rhoSum += value;
		}
	}

	const gainsSignature = JSON.stringify({
		segments: prepared.map((p) => [
			p.segment.key,
			p.segment.range.startIdx,
			p.segment.range.endIdx,
			p.trimStart,
			p.trimEnd,
		]),
		windSource: args.windSource,
		calibration: args.airSpeedCalibrationPercent,
		profile: args.activeDisplayProfile ?? null,
		rho: rhoArray ? [rhoArray.length, rhoSum] : null,
		physics: [
			params.system_mass,
			params.rho,
			params.eta,
			params.velodrome,
			params.wind_speed ?? null,
			params.wind_direction ?? null,
			params.air_speed_offset ?? null,
			params.wind_height_factor ?? null,
		],
		crrScale,
		bounds: [cdaMin, cdaMax, crrMin, crrMax],
	});
	const signature = JSON.stringify({
		gains: gainsSignature,
		targets: prepared.map((p) => p.closureTarget),
	});

	return {
		segments: prepared.map((p) => ({
			key: p.segment.key,
			windowSamples: Math.max(0, p.trimEnd - p.trimStart),
			closureTarget: p.closureTarget,
			veGainGrid: (gCdaMin, gCdaMax, cdaSteps, gCrrMin, gCrrMax, crrSteps) =>
				p.calculator.ve_gain_grid(
					gCdaMin,
					gCdaMax,
					cdaSteps,
					gCrrMin,
					gCrrMax,
					crrSteps,
					p.trimStart,
					p.trimEnd,
				),
		})),
		cda: args.cda,
		crr: args.crr,
		cdaMin,
		cdaMax,
		crrMin,
		crrMax,
		crrScale,
		signature,
		gainsSignature,
		targetSource: args.targetSource,
		targetLabel: args.targetLabel,
	};
}

/**
 * Wraps the prepared segments for the auto-converge solver
 * (`resolveAutoConvergedControls`). The closures speak SLIDER-value Crr and
 * fold the temperature correction in per call via `resolveAppliedCrr` — exact,
 * with no scaling assumption — so the solver's answer is directly a slider
 * value. The weight is the trimmed segment distance, the stationarity weight
 * of the pooled residual (`AutoConverge.ts` header).
 */
export function buildAutoConvergeSegments(
	prepared: PreparedSegment[],
	params: AnalysisParameters,
): AutoConvergeSegment[] {
	return prepared.map((p) => {
		const distance = p.slice.distance;
		const travelled =
			(distance?.[p.trimEnd] ?? NaN) - (distance?.[p.trimStart] ?? NaN);
		return {
			veGain: (cda, crr) =>
				p.calculator.ve_gain(
					cda,
					resolveAppliedCrr(params, crr),
					p.trimStart,
					p.trimEnd,
				),
			target: p.closureTarget,
			weight:
				Number.isFinite(travelled) && travelled > 0
					? travelled
					: Math.max(1, p.trimEnd - p.trimStart),
		};
	});
}
