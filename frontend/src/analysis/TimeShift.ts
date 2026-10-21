/**
 * Moving a channel by a lag in SECONDS, on the recording's own timestamps.
 *
 * WHY. FIT files are not resampled on load, so a sample is not a second:
 * smart recording spaces samples 1–8 s apart and auto-pause leaves gaps of
 * minutes. The barometer lag, the air-speed offset and the timing sweep used
 * to move a channel by whole SAMPLES and call it seconds — on a smart-recorded
 * ride a "+2 s" lag moved the channel 2–16 s, and near a pause it pulled in a
 * sample from the other side of it. The VE step uses each sample's real
 * duration (`step_seconds`, virtual_elevation.rs); the lags now do too.
 *
 * THE RULE. Sample i takes the value of the sample whose timestamp is nearest
 * to `t[i] + lag`, searched only within i's RUN — the stretch of recording
 * between two gaps, split exactly where the VE step splits (a step that is
 * not positive, or `MAX_STEP_SECONDS` or longer). A target before the run's
 * first sample or after its last is OUTSIDE the run; what the caller does
 * there is its edge policy (`clamp` to the run's end sample, or `nan`). An
 * exact tie between two samples goes to the earlier one.
 *
 * WHOLE SECONDS ONLY. The lag is rounded to the nearest second, and the value
 * is a recorded sample, never an interpolation: interpolating smooths the
 * channel, and the smoother channel scores better whatever the true lag (the
 * trap the air-speed lag fell into once). On a strictly 1 Hz recording the
 * nearest sample to `t[i] + n` is sample i + n, so this is exactly the old
 * whole-sample shift, bit for bit.
 *
 * RESOLUTION. Picking recorded samples cannot resolve a lag finer than the
 * recording does: on samples 2–5 s apart, neighbouring whole-second shifts
 * often read the same samples, so a lag comes out right to about a second
 * (an air-speed lag of 4 s scored best at 3 s on such a grid, where counting
 * samples read 1 s). Interpolating would sharpen that, but on an irregular
 * grid it would smooth every shift except 0 s — which always lands on a
 * sample — and tilt every comparison against the unshifted channel.
 */

/**
 * A step this long or longer is a recording gap, not riding. Mirrors
 * `MAX_STEP_SECONDS` in virtual_elevation.rs, which zeroes the VE step there.
 */
export const MAX_STEP_SECONDS = 10;

/** What a target outside its run reads: the run's end sample, or NaN. */
export type ShiftEdge = "clamp" | "nan";

/**
 * Whether the step from sample `i - 1` to sample `i` is ridden (same run).
 * Shared with the VE kernel's gap rule.
 */
function sameRun(timestamps: ArrayLike<number>, i: number): boolean {
	const dt = timestamps[i] - timestamps[i - 1];
	return dt > 0 && dt < MAX_STEP_SECONDS;
}

/**
 * For every sample, the index it reads under a lag of `lagSeconds`, or -1
 * when the target falls outside its run and `edge` is `nan`.
 *
 * Throws when `timestamps` is shorter than `length`: a channel without the
 * times it was recorded at cannot be moved by seconds, and silently moving it
 * by samples is the bug this module exists to remove.
 */
export function shiftIndices(
	timestamps: ArrayLike<number>,
	length: number,
	lagSeconds: number,
	edge: ShiftEdge,
): Int32Array {
	if (timestamps.length < length) {
		throw new Error(
			`shiftIndices: ${timestamps.length} timestamps for ${length} samples`,
		);
	}
	const lag = Math.round(lagSeconds);
	const out = new Int32Array(length);
	let runStart = 0;
	while (runStart < length) {
		let runEnd = runStart;
		while (runEnd + 1 < length && sameRun(timestamps, runEnd + 1)) {
			runEnd++;
		}
		const first = timestamps[runStart];
		const last = timestamps[runEnd];
		// Targets rise with i inside a run, so the nearest sample only ever
		// moves forward: one pointer serves the whole run.
		let j = runStart;
		for (let i = runStart; i <= runEnd; i++) {
			const target = timestamps[i] + lag;
			if (target < first || target > last) {
				out[i] = edge === "nan" ? -1 : target < first ? runStart : runEnd;
				continue;
			}
			while (
				j < runEnd &&
				Math.abs(timestamps[j + 1] - target) < Math.abs(timestamps[j] - target)
			) {
				j++;
			}
			out[i] = j;
		}
		runStart = runEnd + 1;
	}
	return out;
}

/**
 * `values` moved by `lagSeconds` (+s: the channel is LATE by s, so sample i
 * reads the value recorded s seconds after it). Returns `values` itself when
 * the rounded lag is zero or the channel is empty, so identity-keyed memos
 * downstream stay valid.
 */
export function shiftByTime(
	values: number[],
	timestamps: ArrayLike<number>,
	lagSeconds: number,
	edge: ShiftEdge,
): number[] {
	if (Math.round(lagSeconds) === 0 || values.length === 0) {
		return values;
	}
	const indices = shiftIndices(timestamps, values.length, lagSeconds, edge);
	const out = new Array<number>(values.length);
	for (let i = 0; i < values.length; i++) {
		const k = indices[i];
		out[i] = k < 0 ? NaN : values[k];
	}
	return out;
}
