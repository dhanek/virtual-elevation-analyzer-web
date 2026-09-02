/**
 * Standard's headline aggregate, extracted verbatim from
 * `bindStandardSliders`' callbacks factory (Convergence plan, C4).
 *
 * WHY IT IS A MODULE: `aggregate.r2/rmse/veGain/actualGain` BECOME
 * `appState.currentVEResult` through `buildCombinedSegmentResult`
 * (`segmentSummary.ts`), and therefore the CSV cells. The headless API must
 * produce the same headline numbers as the screen, and the only way that is
 * true by construction — rather than by a test that happens to pass — is for
 * both to call the same function.
 *
 * D-09 entry (g): under D-19 Option B the headline r²/RMSE are the MEAN of
 * the per-lap fits, not one fit over the concatenated selection. The
 * maintainer accepted this deliberately, so that Standard reports the same
 * way the two segment modes already do.
 */
import type {
	ModeAggregateStats,
	SegmentVeProfile,
} from "../../modes/analysis/types";

export function computeStandardAggregate(
	profiles: SegmentVeProfile[],
): ModeAggregateStats {
	const count = profiles.length;
	const compareResults = profiles
		.map((p) => p.resultCompare)
		.filter((result): result is NonNullable<typeof result> => result !== null);

	return {
		r2: profiles.reduce((sum, p) => sum + p.result.r2, 0) / count,
		rmse: profiles.reduce((sum, p) => sum + p.result.rmse, 0) / count,
		veGain:
			profiles.reduce((sum, p) => sum + p.result.ve_elevation_diff, 0) /
			count,
		actualGain:
			profiles.reduce((sum, p) => sum + p.result.actual_elevation_diff, 0) /
			count,
		segmentCount: count,
		// The constant-wind leg's own per-lap means, kept SEPARATE here
		// (07-04 ruling 2). `renderMetrics` is what folds the two together
		// for Standard's spans, because Standard's averaging is pre-phase
		// behaviour that is deliberately not being changed.
		compare:
			compareResults.length > 0
				? {
						r2:
							compareResults.reduce((sum, r) => sum + r.r2, 0) /
							compareResults.length,
						rmse:
							compareResults.reduce((sum, r) => sum + r.rmse, 0) /
							compareResults.length,
						veGain:
							compareResults.reduce(
								(sum, r) => sum + r.ve_elevation_diff,
								0,
							) / compareResults.length,
						actualGain:
							compareResults.reduce(
								(sum, r) => sum + r.actual_elevation_diff,
								0,
							) / compareResults.length,
					}
				: undefined,
	};
}
