/**
 * ONE registry of `ModeUpdateCallbacks` factories, keyed by `AnalysisModeId`.
 *
 * This is a RENDERER lookup, not a second mode registry. Mode *behaviour* —
 * validation, selection preparation, `getUpdateSegments`, `summarize` — is
 * resolved in exactly one place, `getAnalysisModeHandler` (`AnalysisModes.ts`),
 * and D-03 keeps it that way. What lives here is the shell-side half that the
 * handler cannot own because it draws figures and writes DOM spans: which plots
 * a mode builds from the primitive's profiles.
 *
 * Each mode registers when its panel renders, because the callbacks close over
 * that render's activity arrays. The factory receives the resolved control
 * values, so a mode can label a plot with the CdA it was drawn at or pick a
 * wind channel from the selected source without re-reading a slider.
 */
import type {
	AnalysisModeId,
	ModeUpdateCallbacks,
} from "../../modes/analysis/types";
import type { WindSource } from "../../state/AppState";

/** The live control values behind one update, resolved once by the funnel. */
export interface ModeUpdateContext {
	windSource: WindSource;
	cda: number;
	/** The raw 22 °C-referenced slider value. */
	crr: number;
	/** The temperature-corrected value the physics actually used. */
	appliedCrr: number;
}

export type ModeUpdateCallbacksFactory = (
	context: ModeUpdateContext,
) => ModeUpdateCallbacks;

const FACTORIES = new Map<AnalysisModeId, ModeUpdateCallbacksFactory>();

export function registerModeUpdateCallbacks(
	id: AnalysisModeId,
	factory: ModeUpdateCallbacksFactory,
): void {
	FACTORIES.set(id, factory);
}

export function getModeUpdateCallbacks(
	id: AnalysisModeId,
	context: ModeUpdateContext,
): ModeUpdateCallbacks | null {
	const factory = FACTORIES.get(id);
	return factory ? factory(context) : null;
}

/**
 * A wind source a mode renders ITSELF, bypassing the primitive.
 *
 * Returns a runner when the mode claims the given source, and null when it does
 * not — in which case the funnel proceeds to the primitive as usual.
 *
 * EXACTLY ONE REGISTRATION EXISTS: Standard's `compare`, which composes its own
 * two calculators because `updateModeVEPlots` has no compare path until plan
 * 07-04 (D-07/D-20). Plan 07-04 deletes both the registration and this registry.
 *
 * It is a property of the SELECTED SOURCE, not of the interaction that changed
 * it. That distinction is the whole defect this seam exists to prevent: when the
 * claim was consulted only from the wind-source radio handler, every OTHER
 * control — k, CdA, Crr, trim — funnelled straight past compare and repainted a
 * single-source figure over it, deleting the constant-wind leg from a plot the
 * user had explicitly asked to compare.
 */
export type ModeWindSourceOverride = (
	windSource: WindSource,
) => (() => Promise<void> | void) | null;

const WIND_SOURCE_OVERRIDES = new Map<AnalysisModeId, ModeWindSourceOverride>();

export function registerModeWindSourceOverride(
	id: AnalysisModeId,
	override: ModeWindSourceOverride,
): void {
	WIND_SOURCE_OVERRIDES.set(id, override);
}

/** The runner for a claimed source, or null when the funnel keeps the update. */
export function getModeWindSourceOverride(
	id: AnalysisModeId,
	windSource: WindSource,
): (() => Promise<void> | void) | null {
	return WIND_SOURCE_OVERRIDES.get(id)?.(windSource) ?? null;
}

/** Test seam — production never unregisters. */
export function clearModeUpdateCallbacks(): void {
	FACTORIES.clear();
	WIND_SOURCE_OVERRIDES.clear();
}
