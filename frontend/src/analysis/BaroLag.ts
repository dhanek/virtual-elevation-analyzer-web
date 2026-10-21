import { shiftByTime } from "./TimeShift";

/**
 * Barometric-altitude latency correction.
 *
 * Barometer-driven altimeters record late: on a Garmin Edge 520 the altitude
 * channel arrives ~2 s after the power/speed channels (measured two
 * independent ways on real rides — pairing VE(t) against altitude(t+lag)
 * minimises at +2.0 s, and the reading keeps settling for seconds after every
 * stop). The correction reads the channel `lagSeconds` LATER, the same sign
 * convention as `applyAirSpeedOffset` (WindSourceResolver.ts): positive lag =
 * the sensor is late = the true value for sample i was recorded lag seconds after it.
 *
 * Two deliberate differences from `applyAirSpeedOffset`:
 * - Out-of-range reads CLAMP to the first/last sample of their stretch of
 *   recording instead of returning NaN. Closure targets and the metrics window read single endpoint samples
 *   (`channel[trimEnd] - channel[trimStart]`), so a NaN tail would poison the
 *   target whenever the trim reaches the end of the ride; holding the final
 *   reading for ~2 samples is a bounded, honest error.
 * - Zero lag returns the INPUT ARRAY ITSELF, not a copy — downstream memos
 *   (the mean-elevation cache in updateGpsLap) key on array identity.
 *
 * The lag is in SECONDS, on the recording's own timestamps (`shiftByTime`,
 * TimeShift.ts): sample i reads the sample nearest in time to t[i] + lag,
 * never across a recording gap, and "out of range" means beyond the end of
 * that stretch of recording, where it clamps to the stretch's end sample. On
 * a strictly 1 Hz recording that is the whole-sample shift it always was.
 */
export function applyBaroLag(
	altitude: number[],
	timestamps: ArrayLike<number>,
	lagSeconds: number,
): number[] {
	return shiftByTime(altitude, timestamps, lagSeconds, "clamp");
}
