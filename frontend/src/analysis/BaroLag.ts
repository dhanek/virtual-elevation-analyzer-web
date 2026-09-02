/**
 * Barometric-altitude latency correction.
 *
 * Barometer-driven altimeters record late: on a Garmin Edge 520 the altitude
 * channel arrives ~2 s after the power/speed channels (measured two
 * independent ways on real rides — pairing VE(t) against altitude(t+lag)
 * minimises at +2.0 s, and the reading keeps settling for seconds after every
 * stop). The correction reads the channel `lagSeconds` LATER, the same sign
 * convention as `applyAirSpeedOffset` (WindSourceResolver.ts): positive lag =
 * the sensor is late = the true value for sample i was recorded at i + lag.
 *
 * Two deliberate differences from `applyAirSpeedOffset`:
 * - Out-of-range reads CLAMP to the first/last sample instead of returning
 *   NaN. Closure targets and the metrics window read single endpoint samples
 *   (`channel[trimEnd] - channel[trimStart]`), so a NaN tail would poison the
 *   target whenever the trim reaches the end of the ride; holding the final
 *   reading for ~2 samples is a bounded, honest error.
 * - Zero lag returns the INPUT ARRAY ITSELF, not a copy — downstream memos
 *   (the mean-elevation cache in updateGpsLap) key on array identity.
 *
 * Like `applyAirSpeedOffset`, the shift is a whole-sample index offset
 * (`Math.round(lagSeconds)`) assuming the FIT file's 1 Hz recording rate.
 */
export function applyBaroLag(
	altitude: number[],
	lagSeconds: number,
): number[] {
	const shift = Math.round(lagSeconds);
	if (shift === 0 || altitude.length === 0) {
		return altitude;
	}

	const last = altitude.length - 1;
	const result = new Array<number>(altitude.length);
	for (let i = 0; i <= last; i++) {
		result[i] = altitude[Math.min(Math.max(i + shift, 0), last)];
	}
	return result;
}
