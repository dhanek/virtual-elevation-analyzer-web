import { describe, expect, test } from "vitest";
import type { RepeatUnitInput } from "./RepeatSpread";
import {
	computeTimingSweep,
	TIMING_SHIFTS,
	type TimingShiftInput,
} from "./TimingSweep";

/**
 * A synthetic ride whose POWER is recorded `lag` samples late: the "true"
 * VE uses power[i], the recorded channel holds it at i + lag. Shifting the
 * recorded channel by +lag (the air-speed-offset convention) restores it.
 */
const N = 400;

function lapSeries(seed: number) {
	const v: number[] = [];
	const p: number[] = [];
	for (let i = 0; i < N; i++) {
		v.push(9 + 2 * Math.sin((i + seed * 31) / 17));
		// Sharp power surges: a timing error shows up in every lap.
		p.push(200 + 150 * Math.sign(Math.sin((i + seed * 13) / 9)));
	}
	return { v, p };
}

function unitsAt(shift: number, lag: number): RepeatUnitInput[] {
	return [0, 1, 2, 3].map((seed) => {
		const { v, p } = lapSeries(seed);
		const recorded = p.map((_, i) => p[Math.max(0, i - lag)]);
		const used = recorded.map(
			(_, i) => recorded[Math.min(N - 1, Math.max(0, i + shift))],
		);
		// VE step = (η·P/(v·m·g) − CdA·ρv²/(2mg) − Crr)·v.
		const terms = (power: number[]) => {
			const b = new Float64Array(N);
			const a = new Float64Array(N);
			const f = new Float64Array(N);
			for (let i = 1; i < N; i++) {
				b[i] = b[i - 1] + (0.97 * power[i]) / (80 * 9.807);
				a[i] = a[i - 1] + (1.2 * v[i] ** 3) / (2 * 80 * 9.807);
				f[i] = f[i - 1] + v[i];
			}
			return { b, a, f };
		};
		const truth = terms(p);
		const model = terms(used);
		const elevation = Float64Array.from(
			{ length: N },
			(_, i) => truth.b[i] - 0.3 * truth.a[i] - 0.005 * truth.f[i],
		);
		return {
			key: `lap-${seed}`,
			label: `Lap ${seed + 1}`,
			legs: [
				{
					veProfile: (cda: number, crr: number) =>
						Float64Array.from(
							{ length: N },
							(_, i) => model.b[i] - cda * model.a[i] - crr * model.f[i],
						),
					elevation,
				},
			],
		};
	});
}

const sweep = (lag: number): TimingShiftInput[] =>
	TIMING_SHIFTS.map((shift) => ({ shift, units: unitsAt(shift, lag) }));

describe("computeTimingSweep", () => {
	test("finds a 2 s power lag, scored out of sample", () => {
		const result = computeTimingSweep(sweep(2), 0.005);
		expect(result.verdict).toMatchObject({ kind: "best", shift: 2 });
		// Not zero: the edge samples repeat, as the app's shift does.
		const at = (shift: number) =>
			result.rows.find((r) => r.shift === shift)!.heldOutRms;
		expect(at(2)).toBeLessThan(at(0) / 10);
	});

	test("a channel in sync scores best at 0 s", () => {
		expect(computeTimingSweep(sweep(0), 0.005).verdict).toEqual({
			kind: "zero",
		});
	});

	test("a lag beyond the sweep is reported as an edge, not an optimum", () => {
		expect(computeTimingSweep(sweep(5), 0.005).verdict).toMatchObject({
			kind: "edge",
			shift: 3,
		});
	});

	test("one lap: not estimable", () => {
		const one = TIMING_SHIFTS.map((shift) => ({
			shift,
			units: unitsAt(shift, 2).slice(0, 1),
		}));
		expect(computeTimingSweep(one, 0.005).verdict).toEqual({
			kind: "not-estimable",
		});
	});

	test("a shift that does not help every lap is not an optimum", () => {
		// Lap 1's profile gets worse at +1 s, the others better.
		const rows = sweep(1).map(({ shift, units }) => ({
			shift,
			units: units.map((unit, j) =>
				j === 0 && shift === 1
					? {
							...unit,
							legs: unit.legs.map((leg) => ({
								...leg,
								elevation: leg.elevation!.map(
									(h, i) => h + 0.5 * Math.sin(i / 3),
								),
							})),
						}
					: unit,
			),
		}));
		expect(computeTimingSweep(rows, 0.005).verdict).toMatchObject({
			kind: "flat",
			shift: 1,
			better: 3,
			repeats: 4,
		});
	});

	test("a shift that scores a different set of laps is never an optimum", () => {
		// At +2 s (the true lag) one lap drops out: its reference is gone.
		const rows = sweep(2).map(({ shift, units }) => ({
			shift,
			units:
				shift === 2
					? units.map((unit, j) =>
							j === 3
								? {
										...unit,
										legs: unit.legs.map((leg) => ({ ...leg, elevation: null })),
									}
								: unit,
						)
					: units,
		}));
		expect(computeTimingSweep(rows, 0.005).verdict).toMatchObject({
			kind: "flat",
			shift: 2,
		});
	});
});
