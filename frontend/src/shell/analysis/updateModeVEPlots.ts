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
 *
 * TWO CALLERS, ONE PER SURFACE: `requestModeUpdate` (browser) and
 * `src/api/runAnalysis.ts` (headless). `entryPoints.test.ts` pins the pair —
 * a third importer is a review conversation, not a convenience.
 */
import { getNormalizedActivityArrays } from "../../analysis/ActivityArrayCache";
import {
	AUTO_CONVERGE_DEFAULT,
	resolveAutoConvergedControls,
	type AutoConvergeResolution,
} from "../../analysis/AutoConverge";
import { resolveAppliedCrr } from "../../analysis/CrrTemperatureCorrection";
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
import {
	isClosureTargetPinned,
	resolveClosureSelection,
} from "../../analysis/ClosureTarget";
import {
	resolveClosureBaroAltitude,
	resolveClosureDemAltitude,
	resolveElevationProfile,
	resolveReferenceElevation,
} from "./elevationProfileResolver";
import type { ModeUpdateContext } from "./modeUpdateCallbacks";
import { resolveRhoArray } from "./rhoArrayResolver";
import {
	buildAutoConvergeSegments,
	buildConvergenceUpdateInput,
	prepareSegments,
} from "./segmentPreparation";

export interface UpdateModeVEPlotsArgs {
	appState: AppState;
	handler: AnalysisModeHandler;
	/**
	 * Builds the callbacks AT PASS TIME from the resolved control values (D4).
	 * A plain callbacks object captured at request time cannot work under
	 * auto-converge — the driven CdA/Crr are only known inside the pass, after
	 * the segments are prepared — and it outlived panel teardown, pointing at
	 * renderers whose panel was gone. Returning null aborts the pass cleanly.
	 */
	makeCallbacks: (context: ModeUpdateContext) => ModeUpdateCallbacks | null;
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
	/**
	 * What auto-converge did to this pass's CdA/Crr ('idle' when off). The
	 * funnel reads it to write driven values back into the sliders
	 * (`drivenControls.ts`); the primitive itself never touches the DOM.
	 */
	autoConverge: AutoConvergeResolution;
}

/**
 * The ONE tab-active check in the update path (D-14).
 *
 * Guarded so the primitive stays callable from node, which is what lets the
 * golden harness assert real numbers against it with no browser environment.
 *
 * NOT exported. Standard's `compare` branch used to import it rather than carry
 * a second copy of the class-name check; plan 07-04 folded that branch into this
 * primitive, and the export then had no consumer anywhere in `src/`. Keeping it
 * exported "as the ONE definition a future caller must import" made the D-14
 * claim an assertion rather than a checked property — an unused export is not
 * evidence of anything. Module-private makes it enforceable now: a second copy
 * of this check cannot be written without either importing nothing (and being
 * visibly a second copy) or re-exporting this one deliberately.
 *
 * `args.isTabActive` remains the injection point for tests.
 */
function isVeTabActive(tabId: string): boolean {
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
	const { appState, handler } = args;
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

	// (2b) The NON-master channel, ONCE per pass, full length — sliced per
	//      segment below exactly as `actualElevation` is. Null on single-channel
	//      rides and under velodrome; nothing downstream but the plots reads it.
	const referenceElevation = resolveReferenceElevation(
		appState,
		elevation.profile,
		normalized.altitude.length,
	);

	// (3) Rho, ONCE per update, full length. Sliced per segment below, at the
	//     `segmentRho` line inside the segment loop.
	const resolveRho = args.resolveRho ?? resolveRhoArray;
	const rhoArray = resolveRho(fitData, normalized);

	const segments = args.segments ?? handler.getUpdateSegments(appState);

	// The CdA/Crr-independent front half of the loop lives in
	// `segmentPreparation.ts` so the Convergence grid and the auto-converge
	// solve can reuse one preparation. Skips and preparation failures are
	// logged there with the messages this loop used to emit.
	// (3b) The closure target's source (phase 2), ONCE per pass. GPS-lap mode
	//      pins it to manual 0 — every lap starts and ends at the gate — and
	//      the other modes read the persisted choice, validated rather than
	//      cast (`resolveClosureSelection`). The default 'dem' with no DEM
	//      loaded falls back to the resolved profile and reproduces phase 1
	//      byte for byte.
	const closureSelection = resolveClosureSelection(handler.id, params);
	const closureSource = closureSelection.source;
	const closureDemAltitude =
		closureSource === "dem"
			? resolveClosureDemAltitude(appState, normalized.altitude.length)
			: null;
	const closure = {
		source: closureSource,
		demAltitude: closureDemAltitude,
		baroAltitude:
			closureSource === "barometer"
				? resolveClosureBaroAltitude(appState, normalized.altitude)
				: null,
		manualDiffMetres: closureSelection.manualDiffMetres,
	};

	const prepared = prepareSegments({
		segments,
		normalized,
		altitude: elevation.altitude,
		wind,
		compareWind,
		rhoArray,
		params,
		cda: args.cda,
		appliedCrr: resolveAppliedCrr(params, args.crr),
		closure,
	});

	// (4) AUTO-CONVERGE (confirmed semantics: a locked slider is DRIVEN along
	//     the closure ridge, not frozen). Resolved HERE, not in the funnel,
	//     because the per-segment calculators only exist after preparation.
	//     Idle — off, or nothing locked — passes the slider values through
	//     byte for byte. The funnel writes any driven value back to the DOM
	//     from the outcome (`drivenControls.ts`); this function still never
	//     touches an element.
	const autoConverge = resolveAutoConvergedControls({
		state: appState.autoConverge ?? AUTO_CONVERGE_DEFAULT,
		cda: args.cda,
		crr: args.crr,
		segments: buildAutoConvergeSegments(prepared, params),
		bounds: {
			cdaMin: params.cda_min ?? 0.15,
			cdaMax: params.cda_max ?? 0.5,
			crrMin: params.crr_min ?? 0.0015,
			crrMax: params.crr_max ?? 0.03,
		},
	});
	const cda = autoConverge.cda;
	const crr = autoConverge.crr;

	// (5) The slider Crr is 22 °C-referenced; the physics uses the corrected
	//     value when the correction is enabled.
	const appliedCrr = resolveAppliedCrr(params, crr);

	const inputs: ResolvedUpdateInputs = {
		normalized,
		wind,
		compareWind,
		altitude: elevation.altitude,
		rhoArray,
		params,
		cda,
		crr,
		appliedCrr,
		windSource: args.windSource,
	};

	const profiles: SegmentVeProfile[] = [];

	for (const prep of prepared) {
		const { segment, slice, indices, supplementarySeries } = prep;
		try {
			const result = prep.calculator.calculate_virtual_elevation(
				cda,
				appliedCrr,
				prep.trimStart,
				prep.trimEnd,
			) as VEAnalysisResult;

			// The compare calculator is the SECOND calculator of D-07/D-20 —
			// see `prepareSegments` for why it exists and how it differs.
			let virtualElevationCompare: number[] | null = null;
			let resultCompare: VEAnalysisResult | null = null;
			if (prep.compareCalculator) {
				resultCompare = prep.compareCalculator.calculate_virtual_elevation(
					cda,
					appliedCrr,
					prep.trimStart,
					prep.trimEnd,
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
				referenceElevation: referenceElevation
					? {
							label: referenceElevation.label,
							series: indices.map((i) => referenceElevation.series[i]),
						}
					: null,
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

	// Resolved AT PASS TIME from the registry (D4): a panel torn down between
	// arming and firing yields null here instead of a live callbacks object
	// aimed at renderers whose panel is gone.
	const callbacks = args.makeCallbacks({
		windSource: args.windSource,
		cda,
		crr,
		appliedCrr,
	});
	if (!callbacks) {
		log.error("No update callbacks available for this mode");
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
	if (isTabActive("convergence-tab")) {
		// The closure-error grid is the most expensive thing the app computes,
		// so this gate matters more than any of the three above it. The surface
		// cache in convergenceView keeps a pass with unchanged physics to
		// pooling + drawing; the signature is built here from the resolved
		// inputs because only this function has all of them in one place.
		await callbacks.renderConvergence(
			buildConvergenceUpdateInput({
				prepared,
				params,
				windSource: args.windSource,
				airSpeedCalibrationPercent: appState.airSpeedCalibrationPercent,
				activeDisplayProfile: appState.activeDisplayProfile,
				rhoArray,
				cda,
				crr,
				appliedCrr,
				targetSource: closureSource,
				// 'dem' with no DEM channel loaded fell back to the resolved
				// profile — say so rather than let the title claim DEM.
				targetLabel: isClosureTargetPinned(handler.id)
					? "lap closure (0 m)"
					: closureSource === "manual"
						? "manual Δh"
						: closureSource === "barometer"
							? "barometer"
							: closureDemAltitude
								? "DEM"
								: "analysis profile (no DEM loaded)",
			}),
		);
	}

	log.debug(
		`VE plots updated with ${profiles.length} segments, CdA=${cda.toFixed(3)}, Crr=${crr.toFixed(4)}`,
	);

	return { inputs, profiles, aggregate, autoConverge };
}
