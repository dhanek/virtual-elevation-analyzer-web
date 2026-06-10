/**
 * Gateway for merging analysis-parameter fields from UI written outside the
 * AnalysisParameters form (e.g. the Crr temperature controls in the GPS-lap
 * and out-and-back sidebars).
 *
 * The AnalysisParametersComponent keeps a private copy of the parameters and
 * rebuilds from it on every form input, so writes that bypass the component
 * get silently reverted by the next form edit. Routing merges through the
 * component (configured by the analyze orchestrator) keeps the copies in sync.
 */
import type { AnalysisParameters } from "../../components/AnalysisParameters";

type ParameterMergeHandler = (fields: Partial<AnalysisParameters>) => void;

let mergeHandler: ParameterMergeHandler | null = null;

export function configureParameterMerge(
	handler: ParameterMergeHandler | null,
): void {
	mergeHandler = handler;
}

/**
 * Merge fields into the analysis parameters via the configured handler.
 * Returns false when no handler is configured; callers fall back to their
 * local update path.
 */
export function mergeAnalysisParameters(
	fields: Partial<AnalysisParameters>,
): boolean {
	if (!mergeHandler) return false;
	mergeHandler(fields);
	return true;
}
