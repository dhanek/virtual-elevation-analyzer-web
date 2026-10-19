/**
 * Timing checks (TODO J4): is power, or GPS position, out of step with speed?
 *
 * Each channel is shifted by whole seconds, −3 … +3, and every shift is
 * SCORED OUT OF SAMPLE: each lap (or out-and-back section) is predicted by a
 * fit to the others (`heldOutScore`). In-sample RMS would reward any shift
 * that lets the fit chase one lap's noise; a held-out lap does not.
 *
 * Whole seconds only. A fractional shift has to interpolate, which smooths
 * the channel, and the smoother channel scores better whatever the true lag
 * — the trap the air-speed lag fell into before.
 *
 * The result is REPORTED, never applied: like the barometer lag, a timing
 * fix is the rider's decision, made with the curve in front of them.
 */
import {
	computeRepeatSpread,
	heldOutScore,
	type RepeatUnitInput,
} from "./RepeatSpread";

export const TIMING_SHIFTS = [-3, -2, -1, 0, 1, 2, 3] as const;

/**
 * The best shift must beat 0 s by at least this much pooled held-out RMS, AND
 * on every held-out repeat, to count as an optimum. Pooled RMS alone lets one
 * badly fitting lap carry the verdict: on the reference ride's three loop
 * laps (RMS ≈ 2.6 m) a +1 s power shift scored 7 cm better pooled while not
 * helping every lap. Requiring all of them is what a timing error — the same
 * in every lap — would do.
 */
const TIMING_MIN_GAIN_M = 0.005;

export interface TimingShiftInput {
	shift: number;
	units: readonly RepeatUnitInput[];
}

interface TimingRow {
	shift: number;
	/** Held-out RMS (m); NaN where not estimable. */
	heldOutRms: number;
	/** Each held-out repeat's own RMS, in repeat order. */
	perRepeatRms: number[];
	/** The pooled fit over all laps at this shift. */
	cda: number;
	crr: number;
}

type TimingVerdict =
	| { kind: "best"; shift: number; gainM: number }
	| { kind: "zero" }
	| {
			kind: "flat";
			shift: number;
			gainM: number;
			/** Held-out repeats the shift improves, of `repeats`. */
			better: number;
			repeats: number;
	  }
	| { kind: "edge"; shift: number }
	| { kind: "not-estimable" };

export interface TimingResult {
	rows: TimingRow[];
	verdict: TimingVerdict;
}

export function computeTimingSweep(
	shifts: readonly TimingShiftInput[],
	fixedCrr: number,
): TimingResult {
	const rows = shifts.map(({ shift, units }): TimingRow => {
		const score = heldOutScore(units);
		const pooled = computeRepeatSpread(units, fixedCrr).pooled;
		return {
			shift,
			heldOutRms: score ? score.rms : NaN,
			perRepeatRms: score ? score.perRepeatRms : [],
			cda: pooled?.cda ?? NaN,
			crr: pooled?.crr ?? NaN,
		};
	});
	return { rows, verdict: judge(rows) };
}

function judge(rows: readonly TimingRow[]): TimingVerdict {
	const zero = rows.find((row) => row.shift === 0);
	if (
		!zero ||
		!Number.isFinite(zero.heldOutRms) ||
		rows.some((row) => !Number.isFinite(row.heldOutRms))
	) {
		return { kind: "not-estimable" };
	}
	const best = rows.reduce((a, b) => (b.heldOutRms < a.heldOutRms ? b : a));
	const edge = Math.max(...rows.map((row) => Math.abs(row.shift)));
	const gainM = zero.heldOutRms - best.heldOutRms;
	// Ties go to 0 s: a shift has to earn its place.
	if (best.shift === 0 || zero.heldOutRms <= best.heldOutRms) {
		return { kind: "zero" };
	}
	const repeats = zero.perRepeatRms.length;
	const better = best.perRepeatRms.filter(
		(rms, i) => rms < zero.perRepeatRms[i],
	).length;
	if (gainM < TIMING_MIN_GAIN_M || better < repeats) {
		return { kind: "flat", shift: best.shift, gainM, better, repeats };
	}
	if (Math.abs(best.shift) === edge) {
		return { kind: "edge", shift: best.shift };
	}
	return { kind: "best", shift: best.shift, gainM };
}
