/**
 * THE Convergence-tab renderer, shared by all three modes.
 *
 * One div id (`convergencePlot`) in all three templates, one renderer here:
 * the pane is aggregate-only and mode-independent — unlike `vePlot` /
 * `gpsLapVePlot` there is nothing per-mode to draw — so each mode's
 * `renderConvergence` callback is a one-line delegation to this function.
 *
 * THE SURFACE CACHE, and what it exists for. The closure-error grid is by far
 * the most expensive thing the app computes (~70 ms for six GPS laps at the
 * default 41×41 — `npm run profile:convergence`), and the interaction that
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
	chooseGridSteps,
	gridAxis,
	poolClosureSurface,
	type ClosureSurfaceResult,
	type SegmentGain,
} from "../../analysis/ClosureSurface";
import type { ConvergenceUpdateInput } from "../../modes/analysis/types";
import { buildClosureContourFigure } from "../../plots/ConvergencePlotBuilders";
import { log } from "../../utils/log";
import { waitForPlotly } from "./plotlyLoader";
import { requestModeUpdate } from "./requestModeUpdate";

interface CachedGains {
	gainsSignature: string;
	/** Segments that produced a usable grid, in prepared order. */
	kept: Array<{ key: string; gains: Float64Array }>;
	cdaValues: number[];
	crrValues: number[];
	gridSteps: number;
}

interface CachedPool {
	signature: string;
	surface: ClosureSurfaceResult;
	segmentCount: number;
}

let cachedGains: CachedGains | null = null;
let cachedPool: CachedPool | null = null;

/** Test seam. */
export function resetConvergenceSurfaceCache(): void {
	cachedGains = null;
	cachedPool = null;
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
	const container = document.getElementById("convergencePlot");
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
			kept.push({ key: segment.key, gains });
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

	if (!cachedPool || cachedPool.signature !== input.signature) {
		// Matching by key rather than by position: `gainsSignature` includes
		// the segment identities, so an equal signature means the same
		// segments — the lookup only re-attaches each grid to its CURRENT
		// target, which is the one thing a source switch changes.
		const targetByKey = new Map(
			input.segments.map((segment) => [segment.key, segment.closureTarget]),
		);
		const segmentGains: SegmentGain[] = cachedGains.kept.map((entry) => ({
			gains: entry.gains,
			target: targetByKey.get(entry.key) ?? 0,
		}));

		cachedPool = {
			signature: input.signature,
			surface: poolClosureSurface(
				segmentGains,
				cachedGains.cdaValues,
				cachedGains.crrValues,
			),
			segmentCount: segmentGains.length,
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
		"convergencePlot",
		figure.data,
		figure.layout,
		figure.config,
	);
}
