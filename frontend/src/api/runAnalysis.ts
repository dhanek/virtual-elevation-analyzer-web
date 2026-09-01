/**
 * THE headless entry into the physics primitive (Convergence plan, C7).
 *
 * `updateModeVEPlots` has exactly TWO importers, and this is the second:
 * `shell/analysis/requestModeUpdate.ts` is the only module in the BROWSER
 * update path (its funnel invariant), and this function is the only HEADLESS
 * caller — one funnel per surface, which is the property the original
 * single-caller sentence was protecting. The funnel itself cannot serve here:
 * it reads the CdA/Crr sliders and the trim sliders from the DOM and gates on
 * `isVeSectionVisible`. `entryPoints.test.ts` turns the two-importer rule
 * from prose into a checked property.
 */
import type { ModeUpdateOutcome } from "../shell/analysis/updateModeVEPlots";
import { updateModeVEPlots } from "../shell/analysis/updateModeVEPlots";
import { buildRunState } from "./buildRunState";
import { createHeadlessCallbacks } from "./headlessCallbacks";
import type { LoadedRunActivity } from "./loadActivity";
import { RUN_SCHEMA_VERSION, type RunConfig, type RunResult } from "./schema";
import { serializeRunResult } from "./serializeResult";

export interface RunAnalysisArgs {
	/** A config `validateRunConfig` has already accepted. */
	config: RunConfig;
	activity: LoadedRunActivity;
}

export interface RunAnalysisSuccess {
	result: RunResult;
	/** The raw outcome, for callers (tests) that assert on profiles. */
	outcome: ModeUpdateOutcome;
}

export async function runAnalysis(
	args: RunAnalysisArgs,
): Promise<RunAnalysisSuccess | { result: RunResult; outcome: null }> {
	const { config, activity } = args;
	const started = Date.now();

	const state = buildRunState(config, activity);

	const outcome = await updateModeVEPlots({
		appState: state.appState,
		handler: state.handler,
		makeCallbacks: () =>
			createHeadlessCallbacks(state.appState, config.mode),
		windSource: state.windSource,
		cda: config.inputs.cda,
		crr: config.inputs.crr,
		segments: state.segments,
		resolveRho: state.resolveRho,
		isTabActive: () => false,
	});

	if (!outcome) {
		return {
			result: {
				schemaVersion: RUN_SCHEMA_VERSION,
				ok: false,
				error: {
					code: "no-valid-segments",
					message:
						"no segment survived preparation — every one was shorter than " +
						"the minimum, trimmed away, or failed its calculator",
				},
				warnings: [],
			},
			outcome: null,
		};
	}

	const result = serializeRunResult({
		config,
		appState: state.appState,
		outcome,
		windSource: state.windSource,
		selectedItems: state.selectedItems,
		recordedTrim: state.recordedTrim,
		fileName: config.output?.fileName ?? activity.fileName,
		recordCount: activity.recordCount,
		wallClockMs: Date.now() - started,
	});

	return { result, outcome };
}
