/**
 * The one place that decides whether a closure ridge supports an optimum.
 *
 * TWO CALLERS TRACE A RIDGE, AND THEY MUST AGREE ABOUT IT. `AutoConverge`
 * traces one by bisecting Crr at 41 sampled CdA values; `ClosureSurface`
 * reads one straight off the pooled lattice, a Crr per CdA column. Different
 * machinery, same question afterwards — is this valley curved enough to name
 * a point on it, and which point? They answered it separately, and drifted:
 * the solver filtered the columns whose Crr had clamped to a bound and the
 * surface did not, so a selection the solver refused as `underdetermined`
 * still drew a confident marker on the plot.
 *
 * WHY THE CLAMPED COLUMNS MUST GO. Where the valley leaves the Crr bounds the
 * best in-bounds Crr sits on the boundary and the error climbs steeply — a
 * property of the box, not curvature of the valley. Counting those columns
 * lets a perfectly degenerate selection (near-identical laps) look determined
 * whenever its ridge exits the bounds, which for realistic bounds is always.
 * That artefact is exactly what the flatness test exists to reject.
 *
 * The caller keeps its own tracing and its own reporting; all that arrives
 * here is one error per column and whether that column is really on the
 * ridge.
 */

/** One traced ridge column: its pooled closure error, and whether it counts. */
export interface RidgeColumn {
	/** Pooled closure error at this column's best Crr, metres. */
	error: number;
	/**
	 * False when this column's Crr sits at a bound — the lattice edge for a
	 * gridded ridge, a clamped bisection for a solved one. Those columns are
	 * excluded from both the flatness test and the argmin.
	 */
	onRidge: boolean;
}

/**
 * Below this along-ridge error spread (metres) the valley floor is flat and no
 * optimum is reported. Barometric closure noise is of order a metre per run;
 * an optimum separated from the rest of the ridge by less than half that is
 * noise, not signal.
 */
export const RIDGE_FLATNESS_FLOOR_M = 0.5;

/**
 * Fewer on-ridge columns than this and there is no ridge left to judge: the
 * spread would be measured over a handful of columns, or none at all.
 */
export const MIN_ON_RIDGE_COLUMNS = 5;

export const RIDGE_FLAT_REASON =
	"The ridge is flat — closure error alone cannot separate CdA from " +
	"Crr for this selection. Analyse two or more runs at different speeds.";

export const RIDGE_OUTSIDE_BOUNDS_REASON =
	"The closure valley lies almost entirely outside the CdA/Crr " +
	"bounds — widen them, or analyse a different selection.";

export type RidgeVerdict =
	/** The ridge has curvature; `bestIndex` is its argmin among the on-ridge columns. */
	| { status: "ok"; bestIndex: number; reason: null }
	/** No optimum can be named; `reason` is in words fit for the sidebar and the plot. */
	| { status: "underdetermined"; bestIndex: -1; reason: string };

export interface JudgeRidgeOptions {
	/** Override `RIDGE_FLATNESS_FLOOR_M` (tests, and the caller's own option). */
	ridgeFlatnessFloorM?: number;
	/**
	 * Override `RIDGE_FLAT_REASON` — the profile-spread callers judge a
	 * different metric and owe the sidebar words that name it.
	 */
	flatReason?: string;
}

/**
 * Does this ridge support an optimum, and where?
 *
 * A caller that has its own, better-refined answer for *where* (a sub-cell
 * argmin over the whole surface, say) is free to use only the status and
 * ignore `bestIndex` — the verdict is the part that has to be shared.
 */
export function judgeRidge(
	columns: readonly RidgeColumn[],
	options?: JudgeRidgeOptions,
): RidgeVerdict {
	const refused = (reason: string): RidgeVerdict => ({
		status: "underdetermined",
		bestIndex: -1,
		reason,
	});

	const onRidge: number[] = [];
	for (const [index, column] of columns.entries()) {
		if (column.onRidge) {
			onRidge.push(index);
		}
	}
	if (onRidge.length < MIN_ON_RIDGE_COLUMNS) {
		return refused(RIDGE_OUTSIDE_BOUNDS_REASON);
	}

	let lowest = onRidge[0];
	let highest = onRidge[0];
	for (const index of onRidge) {
		if (columns[index].error < columns[lowest].error) {
			lowest = index;
		}
		if (columns[index].error > columns[highest].error) {
			highest = index;
		}
	}

	const floor = options?.ridgeFlatnessFloorM ?? RIDGE_FLATNESS_FLOOR_M;
	const spread = columns[highest].error - columns[lowest].error;
	if (!(spread >= floor)) {
		return refused(options?.flatReason ?? RIDGE_FLAT_REASON);
	}

	return { status: "ok", bestIndex: lowest, reason: null };
}
