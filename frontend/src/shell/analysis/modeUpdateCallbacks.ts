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
 * Drop every registered factory.
 *
 * NOT a test-only seam, despite what this comment said until GPS-02: production
 * calls it from `setGpsAnalysisMode`'s `tearDownVeAnalysisPanel` on a real
 * Section-3 mode change. Before that it had no production caller at all, so a
 * factory registered by one analyze stayed reachable for the whole session —
 * and after the user switched modes, `resolveActiveModeHandler` could hand the
 * update funnel a renderer belonging to a panel that was no longer on screen.
 */
export function clearModeUpdateCallbacks(): void {
	FACTORIES.clear();
}
