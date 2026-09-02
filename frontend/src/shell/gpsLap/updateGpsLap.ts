/**
 * The GPS-lap half of the mode/renderer seam.
 *
 * This module used to carry two entry points into the update path --
 * `updateGpsLapVEPlots`, which called the primitive directly, and
 * `recalculateGpsLapVE`, which answered a wind-source change by rebuilding the
 * whole sidebar behind a spinner. Plan 07-02 moved their body into
 * `updateModeVEPlots`; plan 07-03 moved their callers onto `requestModeUpdate`.
 * Both are now deleted, and this file no longer imports the primitive at all:
 * `requestModeUpdate.ts` is its only production caller.
 *
 * What is left is the part the funnel genuinely cannot own -- the shape of a
 * LapVEProfile, which stat helpers compute the aggregate, and which four render
 * functions draw it.
 */
import type { AppState } from "../../state/AppState";
import type {
	ModeAggregateStats,
	ModeUpdateCallbacks,
	SegmentVeProfile,
} from "../../modes/analysis/types";
import type { LapVEProfile } from "./types";
import type { GpsLapHeaderStats } from "./gpsLapPlots";
import { getNormalizedActivityArrays } from "../../analysis/ActivityArrayCache";
import {
	computeGpsLapAggregate,
	toGpsLapProfiles,
} from "./gpsLapAggregate";
import {
	renderGpsLapVEPlots,
	renderGpsLapWindPlot,
	renderGpsLapPowerPlot,
	renderGpsLapVdPlot,
	calculateMeanElevationProfile,
	calculateMeanReferenceProfile,
	type MeanReferenceProfile,
} from "./gpsLapPlots";
import { setupTabSwitching } from "../dom/tabs";
import {
	resolveElevationProfile,
	resolveReferenceElevation,
} from "../analysis/elevationProfileResolver";
import {
	renderConvergenceView,
	requestConvergenceRedraw,
} from "../analysis/convergenceView";

/**
 * D2 — the mean elevation profile, cached ACROSS updates.
 *
 * `calculateMeanElevationProfile` reads exactly two things off each lap:
 * `distances` and `actualElevation`. Neither depends on CdA or Crr, so during a
 * slider drag it recomputed an identical answer on every single frame — ~3.7 ms
 * of a ~22 ms update spent reproducing the previous result.
 *
 * The per-instance memo below cannot help: `requestModeUpdate` calls
 * `getModeUpdateCallbacks` on every event, so `createGpsLapUpdateCallbacks` runs
 * fresh per update and its closure dies with it. This cache is therefore
 * module-level, which makes its INVALIDATION the whole safety argument.
 *
 * The key is exact, not a fingerprint. A content hash over the elevation samples
 * would be cheap but could collide, and the failure it would produce is the one
 * this phase has already shipped once (D-06): a toggle that recomputes and
 * returns the previous numbers, i.e. a control that lies. So the key is composed
 * of the identities and values the two arrays are DERIVED from:
 *
 *   - `distances` <- `buildRelativeDistanceSeries(slice.distance)`, a function of
 *     the activity's distance channel and the segment range alone;
 *   - `actualElevation` <- `params.velodrome ? zeros : slice.altitude`, a
 *     function of the RESOLVED elevation array and the segment range.
 *
 * Hence: activity identity, resolved-elevation array identity, the reference
 * channel's array identity (both channels are drawn; the mean of the
 * non-master one is cached here too), the velodrome flag, and the segment
 * ranges. `resolveElevationProfile` returns the array cached on AppState, so
 * its identity is stable while the displayed profile is — and changes the
 * moment the elevation-smoothing toggle selects another one, which is the
 * invalidation `gpsLapMeanElevationCache.test.ts` watches fail.
 */
interface MeanElevationCache {
	fitData: unknown;
	elevation: number[];
	/**
	 * Identity of the FULL-LENGTH non-master channel the per-lap
	 * `referenceElevation` slices were cut from — `resolveReferenceElevation`
	 * hands back identity-stable arrays (the DEM arrays live on AppState, the
	 * lag-corrected barometer comes from a WeakMap memo), so `===` here means
	 * the slices' content cannot have changed either. Null when no reference
	 * exists, which must also match for a hit: a reference appearing or
	 * vanishing (DEM load, velodrome toggle) changes `referenceValue`.
	 */
	reference: number[] | null;
	velodrome: boolean;
	shape: string;
	value: { distances: number[]; elevation: number[] };
	referenceValue: MeanReferenceProfile | null;
}

let meanElevationCache: MeanElevationCache | null = null;

/** Test seam. Production never needs it: every input change is in the key. */
export function resetGpsLapMeanElevationCache(): void {
	meanElevationCache = null;
}

/** O(nLaps), not O(nSamples) — the ranges, not the data they select. */
function segmentShape(profiles: SegmentVeProfile[]): string {
	return profiles
		.map((p) => {
			const { startIdx, endIdx } = p.segment.range;
			const trim = p.segment.trim;
			return `${startIdx}:${endIdx}:${trim ? `${trim.start}-${trim.end}` : ""}`;
		})
		.join(",");
}

/**
 * The header's three numbers, read off the aggregate the primitive computed.
 *
 * This is the D1 anti-drift seam. The primitive calls `aggregate` once, hands
 * that object to `handler.summarize` (which writes the stored result) and to
 * `renderVe` (which paints the header and the plot). Reading the header from the
 * SAME object is what makes "the number above the plot" and "the number in the
 * stored result" the same computation by construction rather than by two
 * implementations that happen to agree today.
 */
function headerStats(aggregate: ModeAggregateStats): GpsLapHeaderStats {
	return {
		meanR2: aggregate.r2,
		meanRMSE: aggregate.rmse,
		// `extra` is optional on the shared type, but GPS-lap's `aggregate` below
		// is its only producer and always writes `closingError`. NaN, not 0, if
		// that ever stops holding: a header reading "NaNm" is a visible defect,
		// while "0.00m" is a plausible lie — and closing error near zero is
		// exactly what a good lap set looks like, so 0 would not be questioned.
		closingError: aggregate.extra?.closingError ?? Number.NaN,
		// The constant leg's same three numbers, shown beside the FIT ones rather
		// than averaged into them (07-04 ruling 2). Absent when the update did
		// not run under `compare`, which is what keeps the single-source header
		// byte-identical to what it was.
		compare: aggregate.compare
			? {
					meanR2: aggregate.compare.r2,
					meanRMSE: aggregate.compare.rmse,
					closingError: aggregate.compare.extra?.closingError ?? Number.NaN,
				}
			: undefined,
	};
}

/**
 * Build the GPS-lap `ModeUpdateCallbacks`.
 *
 * This is the ONLY GPS-lap-specific code left in the update path: the shape of
 * a `LapVEProfile`, which stat helpers compute the aggregate, and which four
 * render functions draw it. The spine — wind, elevation, rho, the segment loop,
 * the tab-active check and the result-state writes — is the primitive's.
 *
 * The mapped profiles and the mean elevation are memoised on the identity of
 * the `profiles` array so `aggregate` and the render callbacks share one
 * computation without depending on the order the primitive calls them in.
 */
export function createGpsLapUpdateCallbacks(
	appState: AppState,
): ModeUpdateCallbacks {
	const normalized = getNormalizedActivityArrays(appState.currentFitData!);

	let memoKey: SegmentVeProfile[] | null = null;
	let memoLaps: LapVEProfile[] = [];
	let memoMean: { distances: number[]; elevation: number[] } = {
		distances: [],
		elevation: [],
	};
	let memoMeanReference: MeanReferenceProfile | null = null;

	/**
	 * The cross-update half of the memo (D2). The per-instance memo above stops
	 * `aggregate` and `renderVe` recomputing within ONE update; this stops the
	 * NEXT update recomputing an answer that cannot have changed.
	 */
	function meanElevationFor(
		profiles: SegmentVeProfile[],
		lapProfiles: LapVEProfile[],
	): { mean: { distances: number[]; elevation: number[] }; reference: MeanReferenceProfile | null } {
		const fitData = appState.currentFitData;
		const resolved = resolveElevationProfile(
			appState,
			fitData!,
			normalized.altitude,
		);
		const elevation = resolved.altitude;
		const reference = resolveReferenceElevation(
			appState,
			resolved.profile,
			normalized.altitude.length,
		)?.series ?? null;
		const velodrome = appState.currentParameters?.velodrome === true;
		const shape = segmentShape(profiles);

		const hit =
			meanElevationCache !== null &&
			meanElevationCache.fitData === fitData &&
			meanElevationCache.elevation === elevation &&
			meanElevationCache.reference === reference &&
			meanElevationCache.velodrome === velodrome &&
			meanElevationCache.shape === shape;

		if (hit) {
			return {
				mean: meanElevationCache!.value,
				reference: meanElevationCache!.referenceValue,
			};
		}

		const value = calculateMeanElevationProfile(lapProfiles);
		const referenceValue = calculateMeanReferenceProfile(lapProfiles);
		meanElevationCache = {
			fitData,
			elevation,
			reference,
			velodrome,
			shape,
			value,
			referenceValue,
		};
		return { mean: value, reference: referenceValue };
	}

	function laps(profiles: SegmentVeProfile[]): LapVEProfile[] {
		if (profiles !== memoKey) {
			memoKey = profiles;
			memoLaps = toGpsLapProfiles(appState, normalized, profiles);
			const means = meanElevationFor(profiles, memoLaps);
			memoMean = means.mean;
			memoMeanReference = means.reference;
		}
		return memoLaps;
	}

	function meanElevation(profiles: SegmentVeProfile[]) {
		laps(profiles);
		return memoMean;
	}

	return {
		aggregate(profiles) {
			// Extracted to `gpsLapAggregate.ts` (C4) so the headless API and
			// this screen compute the aggregate through one function.
			return computeGpsLapAggregate(laps(profiles), meanElevation(profiles));
		},

		renderVe(profiles, aggregate) {
			const lapProfiles = laps(profiles);
			renderGpsLapVEPlots(
				lapProfiles,
				meanElevation(profiles),
				headerStats(aggregate),
				memoMeanReference,
			);
			setupTabSwitching({
				wind: () => renderGpsLapWindPlot(lapProfiles),
				power: () => renderGpsLapPowerPlot(lapProfiles),
				vd: () => renderGpsLapVdPlot(lapProfiles),
				convergence: requestConvergenceRedraw,
			});
		},

		renderWind(profiles) {
			renderGpsLapWindPlot(laps(profiles));
		},

		renderPower(profiles) {
			renderGpsLapPowerPlot(laps(profiles));
		},

		renderVd(profiles) {
			renderGpsLapVdPlot(laps(profiles));
		},

		renderConvergence: renderConvergenceView,

		renderMetrics() {
			// GPS-lap's metric spans and summary table are painted inside
			// `renderGpsLapVEPlots`, from the aggregate `renderVe` hands it --
			// the same object the primitive gave `summarize`. Nothing to do here,
			// and duplicating the write would be a second place for the header to
			// drift from the plot.
		},
	};
}
