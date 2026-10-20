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

/**
 * A reference that barely rises or falls cannot time anything: shifting it
 * moves next to nothing, and what the sweep then scores is noise — which
 * sample the rebase anchors on, the barometer's 0.2 m steps. On the
 * reference ACE ride (flat 2.7 km laps, 1.4–3.4 m per lap) the position row
 * read "best at −1 s, 21.9 cm better, on every lap"; a constant altitude
 * scores every shift the same, and ±5 s smoothing removes the optimum. Seven
 * flat ACE air-speed rides span 0.8–3.4 m per lap with best shifts of every
 * sign; the hill repeats span 32.6–34.6 m. Below this median relief (max −
 * min of the reference within a repeat), the row reads too flat to time.
 */
export const TIMING_MIN_RELIEF_M = 5;

export interface TimingShiftInput {
	shift: number;
	units: readonly RepeatUnitInput[];
}

interface TimingRow {
	shift: number;
	/** Held-out RMS (m); NaN where not estimable. */
	heldOutRms: number;
	/** Each held-out repeat's own RMS, keyed by repeat. */
	perRepeatRms: Map<string, number>;
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
	/** The reference's median relief per repeat (m) is too small to time. */
	| { kind: "flat-reference"; reliefM: number }
	| { kind: "not-estimable" };

export interface TimingResult {
	rows: TimingRow[];
	verdict: TimingVerdict;
}

export function computeTimingSweep(
	shifts: readonly TimingShiftInput[],
	fixedCrr: number,
	/**
	 * Judge the shifted channel against the reference's relief at 0 s: set
	 * where the reference itself is what moves (the position row).
	 */
	options: { requireRelief?: boolean } = {},
): TimingResult {
	const rows = shifts.map(({ shift, units }): TimingRow => {
		const score = heldOutScore(units);
		const pooled = computeRepeatSpread(units, fixedCrr).pooled;
		return {
			shift,
			heldOutRms: score ? score.rms : NaN,
			perRepeatRms: score ? score.perRepeatRms : new Map(),
			cda: pooled?.cda ?? NaN,
			crr: pooled?.crr ?? NaN,
		};
	});
	const verdict = judge(rows);
	if (options.requireRelief && verdict.kind !== "not-estimable") {
		const zero = shifts.find(({ shift }) => shift === 0);
		const reliefM = zero ? medianRelief(zero.units) : NaN;
		if (!(reliefM >= TIMING_MIN_RELIEF_M)) {
			return { rows, verdict: { kind: "flat-reference", reliefM } };
		}
	}
	return { rows, verdict };
}

/** Median over repeats of the largest max − min of any leg's reference. */
function medianRelief(units: readonly RepeatUnitInput[]): number {
	const reliefs: number[] = [];
	for (const unit of units) {
		let relief = NaN;
		for (const { elevation } of unit.legs) {
			if (!elevation || elevation.length === 0) {
				continue;
			}
			let lo = Infinity;
			let hi = -Infinity;
			for (const h of elevation) {
				lo = Math.min(lo, h);
				hi = Math.max(hi, h);
			}
			relief = Number.isFinite(relief) ? Math.max(relief, hi - lo) : hi - lo;
		}
		if (Number.isFinite(relief)) {
			reliefs.push(relief);
		}
	}
	if (reliefs.length === 0) {
		return NaN;
	}
	reliefs.sort((a, b) => a - b);
	const mid = Math.floor(reliefs.length / 2);
	return reliefs.length % 2
		? reliefs[mid]
		: (reliefs[mid - 1] + reliefs[mid]) / 2;
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
	// Compared lap by lap BY KEY: a shift can make a lap unusable (its
	// reference or power runs off the data), and a positional comparison
	// would then pit one lap against another. A shift that does not score
	// the same laps as 0 s cannot be called better on every lap.
	const repeats = zero.perRepeatRms.size;
	let better = 0;
	for (const [key, rms] of best.perRepeatRms) {
		const atZero = zero.perRepeatRms.get(key);
		if (atZero !== undefined && rms < atZero) {
			better++;
		}
	}
	if (best.perRepeatRms.size !== repeats) {
		better = Math.min(better, repeats - 1);
	}
	if (gainM < TIMING_MIN_GAIN_M || better < repeats) {
		return { kind: "flat", shift: best.shift, gainM, better, repeats };
	}
	if (Math.abs(best.shift) === edge) {
		return { kind: "edge", shift: best.shift };
	}
	return { kind: "best", shift: best.shift, gainM };
}
