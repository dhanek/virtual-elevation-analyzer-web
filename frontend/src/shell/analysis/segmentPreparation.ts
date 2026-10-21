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
 *      segments before the pass's CdA/Crr are even final;
 *   4. the Repeats tab's per-lap fits (`buildRepeatUnits`).
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
import {
	tiltReference,
	type RepeatLeg,
	type RepeatUnitInput,
	type SensitivityInput,
} from "../../analysis/RepeatSpread";
import type { ElevationDisplayProfile } from "../../analysis/elevationProfiles";
import { extractSegmentData } from "../../analysis/SegmentExtractor";
import type { TimingShiftInput } from "../../analysis/TimingSweep";
import { buildSegmentSupplementarySeries } from "../../analysis/SegmentSupplementarySeries";
import { createVeCalculator } from "../../analysis/VeCalculatorFactory";
import type { WindSeriesResolution } from "../../analysis/WindSourceResolver";
import {
	type AnalysisParameters,
	DEFAULT_PARAMETERS,
} from "../../components/AnalysisParameters";
import type {
	ConvergenceUpdateInput,
	ModeSegment,
	TimingSweepInputs,
} from "../../modes/analysis/types";
import type { WindSource } from "../../state/AppState";
import { log } from "../../utils/log";
import type { SegmentWeatherRecord } from "../../utils/ResultsStorage";
import { segmentWeatherOverride } from "./weatherSeries";

/** Segments shorter than this are skipped, matching both reference paths. */
const MIN_SEGMENT_SAMPLES = 10;

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
	/**
	 * The per-lap weather this segment's calculator was built on, or null when
	 * it ran on the selection-level `params`. Only prepared segments carry one,
	 * so the rows describe what was computed rather than what was selected —
	 * the same rule `lapsCovered` follows.
	 */
	weather: SegmentWeatherRecord | null;
	/**
	 * Mean air density the calculator used over the trim window: the rho
	 * series where one spans the segment, else the segment's `params.rho`
	 * (per-lap weather and `rhoScale` included). Read by the Repeats tab's
	 * power-independent CdA (TODO J3) for k.
	 */
	airDensity: number;
}

/** The slot series `autoRho` fetched, and the rho formula to apply to it. */
interface SegmentWeatherSource {
	series: Parameters<typeof segmentWeatherOverride>[0];
	calcRho: Parameters<typeof segmentWeatherOverride>[4];
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
	/** Per-lap weather; absent or null runs every segment on `params`. */
	weather?: SegmentWeatherSource | null;
	/**
	 * Multiplies every air density the calculators get — the rho series, the
	 * per-lap weather rho and `params.rho` alike. Only the Repeats tab's ±1 %
	 * density sensitivity sets it; absent means 1 and changes nothing.
	 */
	rhoScale?: number;
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

		// COMPLETE OR ABSENT, NEVER PARTIAL.
		//
		// `rhoArray[i]` on an index the series does not reach yields `undefined`,
		// which crosses the WASM boundary as NaN and poisons the whole segment's
		// integration. Nothing upstream rules that out: `resolveRhoArray` accepts
		// a channel on `.some(rho => rho > 0)` and `getNormalizedActivityArrays`
		// converts it without padding, so a device that stopped emitting air
		// density mid-ride yields a series SHORTER than the ride. The rule is
		// stated in full in `gpsModeRealChain.test.ts`, under "the air-density
		// slice under the calculator".
		//
		// A LENGTH/RANGE CHECK, AND ONLY THAT. An interior NaN in an
		// otherwise-full-length channel still reaches the calculator, because
		// `resolveRhoArray` accepts the series on a `.some(...)`; that is
		// pre-existing and out of scope here.
		let segmentRho: number[] | null = null;
		if (rhoArray) {
			const spans = indices.every((i) => i >= 0 && i < rhoArray.length);
			if (spans) {
				const scale = args.rhoScale ?? 1;
				segmentRho = indices.map((i) => rhoArray[i] * scale);
			} else {
				log.warn(
					`Air density series (${rhoArray.length}) does not span ${segment.label}; using constant rho`,
				);
			}
		}

		// PER-LAP WEATHER. `params` describes the selection as a whole; a
		// multi-lap selection spans the gaps between its laps, so one wind for
		// all of them is wrong by however much the wind moved in between —
		// measured at up to 1.20 m/s across a three-hour ride. Each segment is
		// analysed at its own midpoint instead, interpolated from the slot
		// series `autoRho` fetched.
		//
		// Null means "nothing better than the selection value is available"
		// (no series, FIT-sourced wind, unusable timestamps), and the segment
		// then runs on `params` exactly as it did before this existed.
		const weatherOverride = args.weather
			? segmentWeatherOverride(
					args.weather.series,
					slice.timestamps,
					wind.selectedWindSource,
					params,
					args.weather.calcRho,
				)
			: null;
		const weatheredParams = weatherOverride
			? { ...params, ...weatherOverride }
			: params;
		const segmentParams =
			args.rhoScale === undefined
				? weatheredParams
				: { ...weatheredParams, rho: weatheredParams.rho * args.rhoScale };

		try {
			const supplementarySeries = buildSegmentSupplementarySeries({
				timestamps: slice.timestamps,
				power: slice.power,
				velocity: slice.velocity,
				positionLat: slice.positionLat,
				positionLong: slice.positionLong,
				distance: slice.distance,
				windSpeed: slice.windSpeed,
				params: segmentParams,
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
				params: segmentParams,
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
				airDensity: meanAirDensity(
					segmentRho,
					segmentParams.rho,
					trimStart,
					trimEnd,
				),
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
									(i) => (closure.baroAltitude ?? normalized.altitude)[i],
								)
							: null,
					manualDiffMetres: closure.manualDiffMetres,
					// One typed difference describes the OUTBOUND leg; the
					// inbound leg negates it. Undefined outside out-and-back.
					legDirection: segment.legDirection,
					velodrome: params.velodrome,
					trimStart,
					trimEnd,
				}),
				weather: weatherOverride
					? {
							label: segment.label,
							rho: weatherOverride.rho,
							windSpeed: weatherOverride.wind_speed,
							windDirection: weatherOverride.wind_direction,
						}
					: null,
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
	/** Whether the Convergence tab should draw the profile-spread surface. */
	profileMode: boolean;
	/** The elevation-difference source the targets were resolved from. */
	targetSource: ElevationDiffSource;
	/**
	 * Honest on-screen name for the source — the caller knows whether 'dem'
	 * actually found a DEM channel or fell back to the analysis profile.
	 */
	targetLabel: string; /**
	 * The same selection prepared again at efficiency × `etaScale`, for the
	 * ±1 % power markers (TODO J1). Called lazily, only when the view
	 * recomputes its grids. Absent: no markers.
	 */
	prepareWithEtaScale?: (etaScale: number) => PreparedSegment[];
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
	const cdaMin = params.cda_min ?? DEFAULT_PARAMETERS.cda_min;
	const cdaMax = params.cda_max ?? DEFAULT_PARAMETERS.cda_max;
	const crrMin = params.crr_min ?? DEFAULT_PARAMETERS.crr_min;
	const crrMax = params.crr_max ?? DEFAULT_PARAMETERS.crr_max;
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
		// The pooled surface is a different metric per mode; the raw gain
		// grids and the profile basis are both mode-independent.
		profileMode: args.profileMode,
	});

	// One extra preparation per scale, shared by every segment and made only
	// if the view asks (a gains-cache miss).
	const perturbed = new Map<number, Map<string, PreparedSegment>>();
	const preparedAt = (etaScale: number) => {
		let byKey = perturbed.get(etaScale);
		if (!byKey && args.prepareWithEtaScale) {
			byKey = new Map(
				args
					.prepareWithEtaScale(etaScale)
					.map((q): [string, PreparedSegment] => [q.segment.key, q]),
			);
			perturbed.set(etaScale, byKey);
		}
		return byKey;
	};

	return {
		segments: prepared.map((p): ConvergenceUpdateInput["segments"][number] => ({
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
			// Applied-space Crr like veGainGrid — the view folds crrScale in.
			veProfile: (cda, crrApplied) => veProfileWindow(p, cda, crrApplied),
			profileDistance: profileDistanceWindow(
				p.slice.distance,
				p.trimStart,
				p.trimEnd,
			),
			profileGroup: p.segment.legDirection,
			powerShift: args.prepareWithEtaScale
				? (etaScale) => {
						const q = preparedAt(etaScale)?.get(p.segment.key);
						if (!q) {
							return null;
						}
						// Any (CdA, Crr) gives the same difference; (0, 0) is
						// the plainest.
						const base = veProfileWindow(p, 0, 0);
						const moved = veProfileWindow(q, 0, 0);
						if (base.length !== moved.length) {
							return null;
						}
						return {
							gain:
								q.calculator.ve_gain(0, 0, q.trimStart, q.trimEnd) -
								p.calculator.ve_gain(0, 0, p.trimStart, p.trimEnd),
							profile: moved.map((v, i) => v - base[i]),
						};
					}
				: undefined,
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
		profileMode: args.profileMode,
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
			veProfile: (cda, crr) =>
				veProfileWindow(p, cda, resolveAppliedCrr(params, crr)),
			profileDistance: profileDistanceWindow(distance, p.trimStart, p.trimEnd),
			// Out-and-back legs are only comparable within a direction
			// (`ProfileSpread` header); every other mode shares one group.
			profileGroup: p.segment.legDirection,
		};
	});
}

/**
 * The prepared segments as REPEATS for the Repeats tab (`RepeatSpread.ts`):
 * one per lap, and one per out-and-back SECTION with its two legs together —
 * a leg alone is half a repeat, and its VE carries the terrain once where the
 * pair carries it out and back. The probes speak SLIDER-value Crr like the
 * auto-converge closures, and use the primary calculator only (under
 * `compare` the second wind source is a comparison, not a repeat).
 */
export function buildRepeatUnits(
	prepared: PreparedSegment[],
	params: AnalysisParameters,
): RepeatUnitInput[] {
	const units: RepeatUnitInput[] = [];
	const sections = new Map<number, RepeatUnitInput>();
	for (const p of prepared) {
		// The kernel's apparent velocity (wind / air-speed channel), which
		// does not depend on CdA or Crr (any finite pair will do): the speed
		// the VE spends drag at.
		const result = p.calculator.calculate_virtual_elevation(
			0.3,
			0,
			p.trimStart,
			p.trimEnd,
		);
		let air: Float64Array;
		try {
			air = result.apparent_velocity;
		} finally {
			result.free();
		}
		const repeatLeg: RepeatLeg = {
			veProfile: (cda: number, crr: number) =>
				veProfileWindow(p, cda, resolveAppliedCrr(params, crr)),
			elevation: elevationWindow(p, params.velodrome),
			distance: profileDistanceWindow(p.slice.distance, p.trimStart, p.trimEnd),
			riseSign: p.segment.legDirection === "inbound" ? -1 : 1,
			power: seriesWindow(p.slice.power, p.trimStart, p.trimEnd),
			speed: seriesWindow(p.slice.velocity, p.trimStart, p.trimEnd),
			airSpeed: seriesWindow(air, p.trimStart, p.trimEnd),
			rho: p.airDensity,
		};
		const section = p.segment.legDirection ? p.segment.itemNumber : undefined;
		if (section === undefined) {
			units.push({
				key: p.segment.key,
				label: p.segment.label,
				legs: [repeatLeg],
			});
			continue;
		}
		const existing = sections.get(section);
		if (existing) {
			existing.legs.push(repeatLeg);
		} else {
			const unit = {
				key: `section-${section}`,
				label: `Section ${section}`,
				legs: [repeatLeg],
			};
			sections.set(section, unit);
			units.push(unit);
		}
	}
	return units;
}

/**
 * The Repeats tab's systematic-error budget (TODO J5): the same selection
 * prepared again with ONE assumed input moved, through `prepareSegments` and
 * `buildRepeatUnits` like the base pass — a real refit per row, not a
 * derivative. Power moves through the drivetrain efficiency (it multiplies
 * power and nothing else); density through `rhoScale`, so the per-lap
 * weather rho and the rho series move with it. The reference rise needs no
 * calculator: it tilts the profile the fit compares against.
 */
export function buildRepeatSensitivities(
	args: PrepareSegmentsArgs,
	units: RepeatUnitInput[],
): SensitivityInput[] {
	const base = args.params;
	const refit = (
		label: string,
		patch: Partial<AnalysisParameters>,
		rhoScale?: number,
	): SensitivityInput => {
		const params = { ...base, ...patch };
		return {
			label,
			units: buildRepeatUnits(
				prepareSegments({ ...args, params, rhoScale }),
				params,
			),
		};
	};
	return [
		refit("Power +1 %", { eta: base.eta * 1.01 }),
		refit("Power −1 %", { eta: base.eta * 0.99 }),
		refit("Mass +1 kg", { system_mass: base.system_mass + 1 }),
		refit("Mass −1 kg", { system_mass: base.system_mass - 1 }),
		refit("Air density +1 %", {}, 1.01),
		refit("Air density −1 %", {}, 0.99),
		{
			label: "Elevation rise +0.5 m",
			units: tiltReference(units, 0.5),
		},
		{
			label: "Elevation rise −0.5 m",
			units: tiltReference(units, -0.5),
		},
	];
}

/**
 * `series` moved by whole samples on the air-speed offset's convention
 * (`applyAirSpeedOffset`): +s means the channel is LATE by s and sample i
 * takes the value from i + s. The ends repeat the edge value rather than
 * NaN — a NaN power sample would zero its VE step, and a NaN reference
 * sample would drop the lap, so the shifts would compare different laps.
 */
function shiftWholeSamples(series: number[], shift: number): number[] {
	if (shift === 0 || series.length === 0) {
		return series;
	}
	const last = series.length - 1;
	return series.map((_, i) => series[Math.min(last, Math.max(0, i + shift))]);
}

/**
 * The timing sweep's inputs (TODO J4): the selection prepared again with
 * POWER, or POSITION, moved by each whole-second shift, as Repeats units.
 * Speed, air speed and everything else stay put.
 *
 * The position sweep moves latitude/longitude AND the resolved altitude
 * (`args.altitude`) together. Latitude/longitude reach the calculator only
 * through the effective-wind path, so they matter only when some prepared
 * segment has no usable wind series (no finite non-zero sample), a finite
 * non-zero wind speed and a wind direction (its per-lap weather, else
 * `params`), and position samples at all. The row's label follows what
 * really moves: under `fit-raw` it is "Elevation reference" when
 * latitude/longitude do not reach the calculator, "GPS position + elevation
 * reference" when they do; under a DEM profile — sampled at latitude/
 * longitude, so shifting it is shifting position along the road — it is
 * "GPS position".
 *
 * Null when the ride is not sampled at 1 s: a sample shift is then not a
 * second, and the VE step already assumes one second between samples.
 */
export function buildTimingSweepInputs(
	args: PrepareSegmentsArgs,
	shifts: readonly number[],
	elevationProfile: ElevationDisplayProfile,
): TimingSweepInputs | null {
	const t = args.normalized.timestamps;
	const steps: number[] = [];
	for (let i = 1; i < t.length; i++) {
		steps.push(t[i] - t[i - 1]);
	}
	steps.sort((a, b) => a - b);
	const median = steps.length > 0 ? steps[Math.floor(steps.length / 2)] : NaN;
	if (Math.abs(median - 1) > 1e-6) {
		return null;
	}
	const prepareWith = (
		normalized: NormalizedActivityArrays,
		altitude: number[],
	): { prepared: PreparedSegment[]; units: RepeatUnitInput[] } => {
		const prepared = prepareSegments({ ...args, normalized, altitude });
		return { prepared, units: buildRepeatUnits(prepared, args.params) };
	};
	let shiftZeroPosition: PreparedSegment[] = [];
	const position = shifts.map((shift): TimingShiftInput => {
		const { prepared, units } = prepareWith(
			{
				...args.normalized,
				positionLat: shiftWholeSamples(args.normalized.positionLat, shift),
				positionLong: shiftWholeSamples(args.normalized.positionLong, shift),
			},
			shiftWholeSamples(args.altitude, shift),
		);
		if (shift === 0) {
			shiftZeroPosition = prepared;
		}
		return { shift, units };
	});
	const latLonReachKernel = shiftZeroPosition.some((p) => {
		const windSpeed = p.weather?.windSpeed ?? args.params.wind_speed;
		const windDirection =
			p.weather?.windDirection ?? args.params.wind_direction;
		return (
			!p.slice.windSpeed.some((w) => Number.isFinite(w) && w !== 0) &&
			Number.isFinite(windSpeed) &&
			windSpeed !== 0 &&
			windDirection != null &&
			p.slice.positionLat.length > 0 &&
			p.slice.positionLong.length > 0
		);
	});
	const positionLabel =
		elevationProfile !== "fit-raw"
			? "GPS position"
			: latLonReachKernel
				? "GPS position + elevation reference"
				: "Elevation reference";
	return {
		power: shifts.map((shift): TimingShiftInput => ({
			shift,
			units: prepareWith(
				{
					...args.normalized,
					power: shiftWholeSamples(args.normalized.power, shift),
				},
				args.altitude,
			).units,
		})),
		position,
		positionLabel,
	};
}

/** Mean of the rho series over the window, else the constant rho. */
function meanAirDensity(
	series: number[] | null,
	constant: number,
	trimStart: number,
	trimEnd: number,
): number {
	if (series) {
		let sum = 0;
		let n = 0;
		for (let i = trimStart; i <= trimEnd && i < series.length; i++) {
			if (Number.isFinite(series[i]) && series[i] > 0) {
				sum += series[i];
				n++;
			}
		}
		if (n > 0) {
			return sum / n;
		}
	}
	return constant;
}

/** A raw channel over the trim window, not rebased. */
function seriesWindow(
	series: ArrayLike<number>,
	trimStart: number,
	trimEnd: number,
): Float64Array {
	const end = Math.min(trimEnd, series.length - 1);
	const start = Math.min(trimStart, Math.max(0, end));
	const out = new Float64Array(Math.max(0, end - start + 1));
	for (let i = 0; i < out.length; i++) {
		out[i] = series[start + i];
	}
	return out;
}

/**
 * The reference elevation over the same window `veProfileWindow` returns,
 * rebased to 0 at its start — what the VE tab's RMSE compares against: the
 * calculator's altitude, flat under velodrome. Null where that RMSE is not
 * computed either (no usable altitude: empty, all NaN or all zero —
 * `has_usable_altitude`), or where a NaN inside the window would poison it.
 */
function elevationWindow(
	p: PreparedSegment,
	velodrome: boolean | undefined,
): Float64Array | null {
	const altitude = p.slice.altitude;
	if (
		altitude.length === 0 ||
		altitude.every((x) => Number.isNaN(x)) ||
		altitude.every((x) => x === 0)
	) {
		return null;
	}
	const end = Math.min(p.trimEnd, p.slice.timestamps.length - 1);
	const start = Math.min(p.trimStart, Math.max(0, end));
	if (end >= altitude.length) {
		return null;
	}
	const out = new Float64Array(Math.max(0, end - start + 1));
	for (let i = 0; i < out.length; i++) {
		out[i] = velodrome ? 0 : altitude[start + i] - altitude[start];
		if (!Number.isFinite(out[i])) {
			return null;
		}
	}
	return out;
}

/**
 * The window's VE profile at one (CdA, APPLIED-space Crr), rebased to 0 at
 * the window start so runs compare from a common origin.
 * `calculate_virtual_elevation` returns the FULL segment's cumulative
 * profile; the VEResult is freed eagerly — the profile solve and the spread
 * surface evaluate many per pass, too many to leave to GC finalizers.
 */
function veProfileWindow(
	p: PreparedSegment,
	cda: number,
	appliedCrr: number,
): Float64Array {
	const result = p.calculator.calculate_virtual_elevation(
		cda,
		appliedCrr,
		p.trimStart,
		p.trimEnd,
	);
	const full = result.virtual_elevation;
	result.free();
	const end = Math.min(p.trimEnd, full.length - 1);
	const start = Math.min(p.trimStart, Math.max(0, end));
	const out = new Float64Array(Math.max(0, end - start + 1));
	for (let i = 0; i < out.length; i++) {
		out[i] = full[start + i] - full[start];
	}
	return out;
}

/**
 * The window's travelled distance rebased to 0 at the window start, or
 * undefined when the distance channel cannot support a profile comparison
 * (missing, non-finite endpoints, no positive span, or a degenerate window)
 * — `solveBothProfile` turns that absence into its distance refusal.
 */
function profileDistanceWindow(
	distance: ArrayLike<number> | null | undefined,
	trimStart: number,
	trimEnd: number,
): Float64Array | undefined {
	if (!distance) {
		return undefined;
	}
	const end = Math.min(trimEnd, distance.length - 1);
	const start = Math.min(trimStart, Math.max(0, end));
	if (end - start < 1) {
		return undefined;
	}
	const base = distance[start];
	const span = distance[end] - base;
	if (!Number.isFinite(base) || !Number.isFinite(span) || span <= 0) {
		return undefined;
	}
	const out = new Float64Array(end - start + 1);
	for (let i = 0; i < out.length; i++) {
		out[i] = distance[start + i] - base;
	}
	return out;
}
