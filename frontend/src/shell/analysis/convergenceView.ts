/**
 * THE Convergence-tab renderer, shared by all three modes.
 *
 * One div id (`convergencePlot`) in all three templates, one renderer here:
 * the pane is aggregate-only and mode-independent — unlike `vePlot` /
 * `gpsLapVePlot` there is nothing per-mode to draw — so each mode's
 * `renderConvergence` callback is a one-line delegation to this function.
 *
 * THE SURFACE CACHE, and what it exists for. The closure-error grid is by far
 * the most expensive thing the app computes (~430 ms for six GPS laps at the
 * default 100×100 — `npm run profile:convergence`), and the interaction that
 * fires updates most often is exactly the one that must NOT recompute it: a
 * CdA/Crr drag. Since phase 2 the cache has TWO levels, matching the two
 * signatures `buildConvergenceUpdateInput` builds:
 *
 *   - the RAW GAIN GRIDS, keyed on `gainsSignature` — everything that changes
 *     what Rust computes (segments, trims, wind source, calibration, elevation
 *     profile, rho, parameters, grid bounds) and deliberately NOT CdA/Crr and
 *     NOT the closure targets;
 *   - the POOLED SURFACE, keyed on `signature` = gains + targets.
 *
 * So a CdA/Crr drag hits both levels and only moves the marker; switching the
 * elevation-difference source (phase 2's radio) re-pools the cached grids
 * without recomputing any of them; a trim or wind change misses both and
 * recomputes. There is no teardown hook on purpose: equal signatures imply an
 * identical surface, so a stale entry can never be wrongly reused, and one
 * cached surface is a few hundred kilobytes at most.
 *
 * TAB ACTIVATION cannot draw from a closure the way Wind/Power/VD do: if the
 * tab was inactive during the last pass, the primitive's lazy gate (D-14)
 * skipped the grid and there is nothing to draw from. So the tab's render-map
 * entry is `requestConvergenceRedraw`, which asks the funnel for a normal
 * pass; with the pane now active the gate lets the grid through, and the
 * cache keeps the cost to pooling + drawing when the physics is unchanged.
 */
import {
	DEFAULT_CLOSURE_BAND_TOLERANCE_M,
	chooseGridSteps,
	closureBand,
	gridAxis,
	poolClosureSurface,
	surfaceFromZ,
	type ClosureBand,
	type ClosureSurfaceResult,
	type SegmentGain,
} from "../../analysis/ClosureSurface";
import {
	anchoredSpreadEvaluator,
	commonDistanceGrid,
	PROFILE_FLAT_REASON,
	PROFILE_FLATNESS_FLOOR_M,
	resampleProfile,
	type ProfileBasisSegment,
} from "../../analysis/ProfileSpread";
import type {
	ConvergenceMetric,
	PowerMoves,
} from "../../plots/ConvergencePlotBuilders";
import type { ConvergenceUpdateInput } from "../../modes/analysis/types";
import { buildClosureContourFigure } from "../../plots/ConvergencePlotBuilders";
import { log } from "../../utils/log";
import { renderConvergenceBandReadout } from "./convergenceBandReadout";
import { CONVERGENCE_PLOT_ID } from "./convergenceTab";
import { waitForPlotly } from "./plotlyLoader";
import { requestModeUpdate } from "./requestModeUpdate";

/** Power ±1 %, as drivetrain-efficiency multipliers (TODO J1). */
const POWER_SCALES = { down: 0.99, up: 1.01 } as const;
type PowerSide = keyof typeof POWER_SCALES;

/** One segment's shift under each power scale; null when unavailable. */
type PowerShifts = Record<PowerSide, number> | null;

interface CachedGains {
	gainsSignature: string;
	/**
	 * Segments that produced a usable grid, in prepared order, with how far
	 * their closure gain moves at power −1 % / +1 % (a constant per segment:
	 * power enters the VE step only through η·P).
	 */
	kept: Array<{ key: string; gains: Float64Array; powerGain: PowerShifts }>;
	cdaValues: number[];
	crrValues: number[];
	gridSteps: number;
}

interface CachedPool {
	signature: string;
	surface: ClosureSurfaceResult;
	/** The tolerance band around `surface.best`; derived, so cached with it. */
	band: ClosureBand | null;
	segmentCount: number;
	/** What `surface.z` measures — drives the figure's labels. */
	metric: ConvergenceMetric;
	/** Where the optimum lands at power −1 % / +1 %; null where it does not. */
	powerMoves: PowerMoves | null;
}

/**
 * THE PROFILE BASIS — the third cache level, keyed like the raw gains.
 *
 * Profile mode draws the anchored spread surface (`anchoredSpreadEvaluator`),
 * which needs three exact WASM profiles per segment (probe + one secant step
 * per axis) resampled onto a common distance grid. Those depend on exactly
 * what the raw gain grids depend on — the physics, never CdA/Crr or the
 * targets — so they share `gainsSignature`, are built lazily on the first
 * profile-mode pool, and survive target/source switches the way the gains
 * do. `basis: null` records that this selection cannot support a profile
 * surface (no usable distance channel), so the fallback is not re-probed
 * every pass.
 */
interface CachedProfileBasis {
	gainsSignature: string;
	basis: {
		grid: Float64Array;
		/** Probe point, slider space. */
		cda0: number;
		crr0: number;
		segments: Array<{
			key: string;
			group: string;
			p0: Float64Array;
			jc: Float64Array;
			jr: Float64Array;
			/** p0's shift at power −1 % / +1 %, resampled; null: unavailable. */
			powerProfile: Record<PowerSide, Float64Array> | null;
		}>;
	} | null;
}

let cachedGains: CachedGains | null = null;
let cachedPool: CachedPool | null = null;
let cachedProfileBasis: CachedProfileBasis | null = null;

/**
 * The optimum of each power-moved surface, or null when the base surface has
 * no optimum to move from or a moved one has none.
 */
function powerMovesFrom(
	base: ClosureSurfaceResult,
	movedSurface: (side: PowerSide) => ClosureSurfaceResult,
): PowerMoves | null {
	if (!base.best) {
		return null;
	}
	const down = movedSurface("down").best;
	const up = movedSurface("up").best;
	if (!down || !up) {
		return null;
	}
	return {
		down: { cda: down.cda, crr: down.crr },
		up: { cda: up.cda, crr: up.crr },
	};
}

/** Test seam. */
export function resetConvergenceSurfaceCache(): void {
	cachedGains = null;
	cachedPool = null;
	cachedProfileBasis = null;
}

/** Distance-grid resolution of the profile basis, the solver's number. */
const PROFILE_SURFACE_GRID_POINTS = 200;

function buildProfileBasis(
	input: ConvergenceUpdateInput,
): CachedProfileBasis["basis"] {
	const eligible = input.segments.filter(
		(segment) =>
			segment.veProfile &&
			segment.profileDistance &&
			segment.profileDistance.length >= 2,
	);
	if (eligible.length === 0) {
		return null;
	}
	const grid = commonDistanceGrid(
		eligible.map((segment) => segment.profileDistance as Float64Array),
		PROFILE_SURFACE_GRID_POINTS,
	);
	if (!grid) {
		return null;
	}

	// Probe at the bounds centre, secant steps of a quarter-range. The VE
	// step is affine in (CdA, Crr), so the secants are the same wherever
	// they are taken; a wide step keeps them clear of rounding.
	const cda0 = 0.5 * (input.cdaMin + input.cdaMax);
	const crr0 = 0.5 * (input.crrMin + input.crrMax);
	const cdaStep = 0.25 * (input.cdaMax - input.cdaMin);
	const crrStep = (input.crrMax - input.crrMin) / 4;

	const segments: NonNullable<CachedProfileBasis["basis"]>["segments"] = [];
	for (const segment of eligible) {
		const distance = segment.profileDistance as Float64Array;
		const veProfile = segment.veProfile as (
			cda: number,
			crrApplied: number,
		) => Float64Array;
		const p0 = veProfile(cda0, crr0 * input.crrScale);
		if (p0.length !== distance.length) {
			log.warn(
				`Convergence: segment ${segment.key} profile/distance length mismatch, skipping`,
			);
			continue;
		}
		const pc = veProfile(cda0 + cdaStep, crr0 * input.crrScale);
		const pr = veProfile(cda0, (crr0 + crrStep) * input.crrScale);
		const jc = new Float64Array(p0.length);
		const jr = new Float64Array(p0.length);
		for (let i = 0; i < p0.length; i++) {
			jc[i] = (pc[i] - p0[i]) / cdaStep;
			jr[i] = (pr[i] - p0[i]) / crrStep;
		}
		const down = segment.powerShift?.(POWER_SCALES.down);
		const up = segment.powerShift?.(POWER_SCALES.up);
		segments.push({
			key: segment.key,
			group: segment.profileGroup ?? "",
			p0: resampleProfile(distance, p0, grid),
			jc: resampleProfile(distance, jc, grid),
			jr: resampleProfile(distance, jr, grid),
			powerProfile:
				down && up && down.profile.length === distance.length
					? {
							down: resampleProfile(distance, down.profile, grid),
							up: resampleProfile(distance, up.profile, grid),
						}
					: null,
		});
	}
	if (segments.length === 0) {
		return null;
	}
	return { grid, cda0, crr0, segments };
}

/**
 * The Convergence tab's activation callback, one shared definition for all
 * five render-map registration sites.
 */
export function requestConvergenceRedraw(): void {
	requestModeUpdate("convergence");
}

export async function renderConvergenceView(
	input: ConvergenceUpdateInput,
): Promise<void> {
	if (typeof document === "undefined") {
		return;
	}
	const container = document.getElementById(CONVERGENCE_PLOT_ID);
	if (!container) {
		return;
	}

	if (!cachedGains || cachedGains.gainsSignature !== input.gainsSignature) {
		const totalWindowSamples = input.segments.reduce(
			(sum, segment) => sum + segment.windowSamples,
			0,
		);
		const gridSteps = chooseGridSteps(totalWindowSamples);

		const kept: CachedGains["kept"] = [];
		for (const segment of input.segments) {
			// The grid is evaluated in APPLIED-Crr space (`crrScale`, the
			// temperature-correction multiplier) while the axis is labelled in
			// raw slider values — so the error shown at (CdA, Crr) is exactly
			// the closure the VE tab would report with the sliders there.
			const gains = segment.veGainGrid(
				input.cdaMin,
				input.cdaMax,
				gridSteps,
				input.crrMin * input.crrScale,
				input.crrMax * input.crrScale,
				gridSteps,
			);
			if (gains.length !== gridSteps * gridSteps) {
				// ve_gain_grid returns empty for a degenerate trim window; such
				// a segment has no closure to contribute.
				log.warn(
					`Convergence: segment ${segment.key} returned a degenerate grid, skipping`,
				);
				continue;
			}
			const down = segment.powerShift?.(POWER_SCALES.down);
			const up = segment.powerShift?.(POWER_SCALES.up);
			kept.push({
				key: segment.key,
				gains,
				powerGain: down && up ? { down: down.gain, up: up.gain } : null,
			});
		}

		cachedGains = {
			gainsSignature: input.gainsSignature,
			kept,
			cdaValues: gridAxis(input.cdaMin, input.cdaMax, gridSteps),
			crrValues: gridAxis(input.crrMin, input.crrMax, gridSteps),
			gridSteps,
		};
		// The pool is derived from the gains; a fresh grid always re-pools.
		cachedPool = null;
	}

	// Profile mode's basis rides the gains signature (see CachedProfileBasis)
	// and is probed lazily — a session that never ticks the box never pays.
	if (
		input.profileMode &&
		(!cachedProfileBasis ||
			cachedProfileBasis.gainsSignature !== input.gainsSignature)
	) {
		cachedProfileBasis = {
			gainsSignature: input.gainsSignature,
			basis: buildProfileBasis(input),
		};
		if (!cachedProfileBasis.basis) {
			log.warn(
				"Convergence: no segment can support the profile-spread surface " +
					"(missing distance data) — falling back to the closure surface",
			);
		}
	}

	if (!cachedPool || cachedPool.signature !== input.signature) {
		// Matching by key rather than by position: `gainsSignature` includes
		// the segment identities, so an equal signature means the same
		// segments — the lookup only re-attaches each grid to its CURRENT
		// target, which is the one thing a source switch changes.
		const targetByKey = new Map(
			input.segments.map((segment) => [segment.key, segment.closureTarget]),
		);

		let surface: ClosureSurfaceResult;
		let segmentCount: number;
		let metric: ConvergenceMetric;
		let powerMoves: PowerMoves | null = null;
		const basis = input.profileMode ? cachedProfileBasis?.basis : null;
		if (basis) {
			// The anchored spread surface: one quadratic form, evaluated at
			// every cell — resolution costs microseconds here, the WASM cost
			// was paid once in the basis.
			const targeted: ProfileBasisSegment[] = basis.segments.map(
				(entry): ProfileBasisSegment => ({
					p0: entry.p0,
					jc: entry.jc,
					jr: entry.jr,
					group: entry.group,
					target: targetByKey.get(entry.key) ?? 0,
				}),
			);
			const spreadAt = anchoredSpreadEvaluator(
				targeted,
				basis.grid,
				basis.cda0,
				basis.crr0,
			);
			const z = cachedGains.crrValues.map((crr) =>
				cachedGains!.cdaValues.map((cda) => spreadAt(cda, crr)),
			);
			const profileSurface = (
				segments: ProfileBasisSegment[],
			): ClosureSurfaceResult => {
				const at = anchoredSpreadEvaluator(
					segments,
					basis.grid,
					basis.cda0,
					basis.crr0,
				);
				const zz = cachedGains!.crrValues.map((crr) =>
					cachedGains!.cdaValues.map((cda) => at(cda, crr)),
				);
				return surfaceFromZ(
					zz,
					cachedGains!.cdaValues,
					cachedGains!.crrValues,
					{
						ridgeFlatnessFloorM: PROFILE_FLATNESS_FLOOR_M,
						flatReason: PROFILE_FLAT_REASON,
					},
				);
			};
			surface = surfaceFromZ(z, cachedGains.cdaValues, cachedGains.crrValues, {
				ridgeFlatnessFloorM: PROFILE_FLATNESS_FLOOR_M,
				flatReason: PROFILE_FLAT_REASON,
			});
			segmentCount = targeted.length;
			metric = "profileSpread";
			// Power ±1 %: the same surface with every profile moved by its
			// power shift. Every segment must have one, or the markers would
			// describe a different selection.
			powerMoves = basis.segments.every((entry) => entry.powerProfile)
				? powerMovesFrom(surface, (side) =>
						profileSurface(
							basis.segments.map((entry, i): ProfileBasisSegment => ({
								...targeted[i],
								p0: entry.p0.map((v, j) => v + entry.powerProfile![side][j]),
							})),
						),
					)
				: null;
		} else {
			const segmentGains: SegmentGain[] = cachedGains.kept.map(
				(entry): SegmentGain => ({
					gains: entry.gains,
					target: targetByKey.get(entry.key) ?? 0,
				}),
			);
			surface = poolClosureSurface(
				segmentGains,
				cachedGains.cdaValues,
				cachedGains.crrValues,
			);
			segmentCount = segmentGains.length;
			metric = "closure";
			// Power ±1 %: a gain that rises by δ against a fixed target is the
			// same error as the old gain against target − δ, so the cached
			// grids are re-pooled, not recomputed.
			const kept = cachedGains.kept;
			powerMoves = kept.every((entry) => entry.powerGain)
				? powerMovesFrom(surface, (side) =>
						poolClosureSurface(
							kept.map((entry, i): SegmentGain => ({
								gains: entry.gains,
								target: segmentGains[i].target - entry.powerGain![side],
							})),
							cachedGains!.cdaValues,
							cachedGains!.crrValues,
						),
					)
				: null;
		}

		cachedPool = {
			signature: input.signature,
			surface,
			band: closureBand(
				surface,
				cachedGains.cdaValues,
				cachedGains.crrValues,
				DEFAULT_CLOSURE_BAND_TOLERANCE_M,
			),
			segmentCount,
			metric,
			powerMoves,
		};
	}

	const figure = buildClosureContourFigure({
		surface: cachedPool.surface,
		cdaValues: cachedGains.cdaValues,
		crrValues: cachedGains.crrValues,
		marker: { cda: input.cda, crr: input.crr },
		segmentCount: cachedPool.segmentCount,
		gridSteps: cachedGains.gridSteps,
		targetLabel: input.targetLabel,
		band: cachedPool.band,
		metric: cachedPool.metric,
		powerMoves: cachedPool.powerMoves,
	});

	// Written from the same pooled surface the map is drawn from, before the
	// (async) Plotly draw so the numbers never lag the picture.
	renderConvergenceBandReadout({
		band: cachedPool.band,
		toleranceM: DEFAULT_CLOSURE_BAND_TOLERANCE_M,
		metric: cachedPool.metric,
		powerMoves: cachedPool.powerMoves,
		clipped: cachedPool.surface.clipped,
	});

	const Plotly = (await waitForPlotly()) as {
		react: (
			id: string,
			data: unknown,
			layout: unknown,
			config: unknown,
		) => Promise<unknown>;
	};
	await Plotly.react(
		CONVERGENCE_PLOT_ID,
		figure.data,
		figure.layout,
		figure.config,
	);
}
