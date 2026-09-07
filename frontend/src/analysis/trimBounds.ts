/**
 * THE TRIM WINDOW IS STORED PER LAP KEY; THE SELECTION IT IS LOADED AGAINST CAN
 * BE A DIFFERENT LENGTH. This is the trim analogue of F17-01, which
 * `sliderBounds.ts` records for Crr/CdA: a `range` input SANITIZES a value
 * outside its `min`/`max`, and a `number` input does not. So an unclamped stored
 * trim paints the two faces of one window differently — the slider at its
 * clamped edge, the number box at the raw stored figure — and the two disagree
 * until the user touches one.
 *
 * Two writers put a window under a key that a differently-sized selection can
 * read back:
 *
 *   - `saveCurrentMultiSegmentSettings` writes a hardcoded `{0, 0}` keyed by
 *     `currentAnalyzedLaps`, which `segmentSummary.ts` documents as the
 *     SELECTION in the segment modes. So a GPS-lap or out-and-back analysis of
 *     laps 10+12 stores `{0, 0}` under `10-12`, and Standard on the same
 *     selection reads an end of 0 against a slider whose `min` is 30.
 *   - anything that stores a window for one selection which is later read for a
 *     shorter one, whether through the map-trim path or a record written by an
 *     earlier version of the app.
 *
 * Clamping at the LOAD site closes both without asking every writer to agree,
 * which is why it lives here rather than beside either of them.
 */

/**
 * The narrowest trim window the app will hold, in samples. The sliders' own
 * `min`/`max` bound each EDGE against the extremes; this floor is what keeps the
 * two edges apart, and it is the same constant the trim binders enforce between
 * them.
 */
export const MIN_TRIM_WINDOW_SAMPLES = 30;

export interface TrimWindow {
	start: number;
	end: number;
}

/**
 * Fit a stored trim window to a selection of `sampleCount` samples.
 *
 * `end` is settled first and `start` is then fitted behind it, because the end
 * is the edge the selection length actually bounds — fitting the start first
 * would measure the floor against an end that has not been corrected yet.
 *
 * A selection shorter than the floor cannot hold one, so the window spans the
 * whole selection instead of going negative. That is the same result the
 * sliders' own `min`/`max` would produce, which is the property that keeps the
 * slider and its number box showing one value.
 */
export function clampTrimWindow(
	stored: { start: number; end: number | null },
	sampleCount: number,
): TrimWindow {
	const last = sampleCount - 1;

	// `Math.min` LAST, deliberately: on a selection too short to hold the floor
	// the `Math.max` lifts the end above `last`, and only a trailing `Math.min`
	// brings it back. Swapping them would return a window past the end of the
	// selection on exactly the case this guards.
	const end = Math.min(
		Math.max(Math.floor(stored.end ?? last), MIN_TRIM_WINDOW_SAMPLES),
		last,
	);

	const start = Math.min(
		Math.max(Math.floor(stored.start), 0),
		Math.max(end - MIN_TRIM_WINDOW_SAMPLES, 0),
	);

	return { start, end };
}
