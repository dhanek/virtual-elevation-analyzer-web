import { describe, expect, test } from "vitest";
import {
	computeRepeatSpread,
	repeatStat,
	REPEAT_SPREAD_NONE_REASON,
	REPEAT_SPREAD_SINGLE_REASON,
	type RepeatLeg,
	type RepeatUnitInput,
} from "./RepeatSpread";

/**
 * A synthetic leg whose VE is exactly `b − CdA·a − Crr·f` and whose reference
 * elevation is what (trueCda, trueCrr) would produce, plus `noise`.
 */
function leg(
	n: number,
	seed: number,
	trueCda: number,
	trueCrr: number,
	noise: (i: number) => number = () => 0,
): RepeatLeg {
	const a = new Float64Array(n);
	const f = new Float64Array(n);
	const b = new Float64Array(n);
	for (let i = 1; i < n; i++) {
		// Speed varies along the leg so a and f are not proportional.
		const v = 9 + 3 * Math.sin((i + seed) / 7);
		a[i] = a[i - 1] + (1.2 * v * v * v) / (2 * 80 * 9.807);
		f[i] = f[i - 1] + v;
		b[i] = b[i - 1] + v * (0.03 + 0.01 * Math.cos(i / 11));
	}
	const h = new Float64Array(n);
	for (let i = 0; i < n; i++) {
		h[i] = b[i] - trueCda * a[i] - trueCrr * f[i] + (i === 0 ? 0 : noise(i));
	}
	return {
		veProfile: (cda, crr) => {
			const out = new Float64Array(n);
			for (let i = 0; i < n; i++) {
				out[i] = b[i] - cda * a[i] - crr * f[i];
			}
			return out;
		},
		elevation: h,
	};
}

/** A deterministic random walk (2 cm steps): the correlated-residual shape. */
function randomWalk(seed: number): (i: number) => number {
	let state = seed;
	const walk = [0];
	return (i) => {
		while (walk.length <= i) {
			state = (state * 1103515245 + 12345) % 2147483648;
			walk.push(walk[walk.length - 1] + (state / 2147483648 - 0.5) * 0.04);
		}
		return walk[i];
	};
}

function unit(key: string, legs: RepeatLeg[]): RepeatUnitInput {
	return { key, label: key, legs };
}

describe("repeatStat", () => {
	test("one value has no spread: sd null, never 0", () => {
		expect(repeatStat([0.3])).toEqual({ mean: 0.3, sd: null, n: 1, df: 0 });
	});

	test("sample SD with n − 1", () => {
		const stat = repeatStat([1, 2, 3, 4]);
		expect(stat.mean).toBe(2.5);
		expect(stat.sd).toBeCloseTo(Math.sqrt(5 / 3), 12);
		expect(stat.df).toBe(3);
	});
});

describe("computeRepeatSpread", () => {
	test("noise-free repeats recover the true CdA and Crr exactly", () => {
		const result = computeRepeatSpread(
			[
				unit("Lap 1", [leg(300, 0, 0.3, 0.004)]),
				unit("Lap 2", [leg(300, 5, 0.3, 0.004)]),
			],
			0.004,
		);
		for (const fit of result.units) {
			expect(fit.status).toBe("ok");
			expect(fit.cda).toBeCloseTo(0.3, 9);
			expect(fit.crr).toBeCloseTo(0.004, 11);
			expect(fit.rms).toBeLessThan(1e-9);
			expect(fit.cdaAtFixedCrr).toBeCloseTo(0.3, 9);
		}
		expect(result.free.cda.sd).toBeLessThan(1e-9);
		expect(result.notEstimableReason).toBeNull();
		expect(result.pooled?.cda).toBeCloseTo(0.3, 9);
	});

	test("one repeat: spread not estimable, never zero", () => {
		const result = computeRepeatSpread(
			[unit("Lap 1", [leg(300, 0, 0.3, 0.004, (i) => 0.05 * Math.sin(i))])],
			0.004,
		);
		expect(result.notEstimableReason).toBe(REPEAT_SPREAD_SINGLE_REASON);
		expect(result.free.cda.sd).toBeNull();
		expect(result.fixed.cda.sd).toBeNull();
		expect(result.pooled?.clusteredSe).toBeNull();
		// The lap's own fit is still reported.
		expect(Number.isFinite(result.units[0].cda)).toBe(true);
	});

	test("no usable profile: named, and the unit says why", () => {
		const blind: RepeatLeg = { ...leg(50, 0, 0.3, 0.004), elevation: null };
		const result = computeRepeatSpread(
			[unit("Lap 1", [blind]), unit("Lap 2", [blind])],
			0.004,
		);
		expect(result.notEstimableReason).toBe(REPEAT_SPREAD_NONE_REASON);
		expect(result.units.every((u) => u.status === "no-profile")).toBe(true);
		expect(result.pooled).toBeNull();
	});

	test("the RMS is over every window sample, anchor included (the VE tab's RMSE)", () => {
		const n = 200;
		const noise = (i: number) => (i % 2 === 0 ? 0.1 : -0.1);
		const result = computeRepeatSpread(
			[unit("Lap 1", [leg(n, 0, 0.3, 0.004, noise)])],
			0.004,
		);
		const fit = result.units[0];
		// Recompute the anchored RMS directly at the fitted point.
		const l = leg(n, 0, 0.3, 0.004, noise);
		const ve = l.veProfile(fit.cda, fit.crr);
		let ss = 0;
		for (let i = 0; i < n; i++) {
			ss += (ve[i] - l.elevation![i]) ** 2;
		}
		expect(fit.rms).toBeCloseTo(Math.sqrt(ss / n), 12);
		expect(fit.samples).toBe(n);
	});

	test("the free fit minimises the profile RMS: any nearby point is worse", () => {
		const l = leg(300, 2, 0.31, 0.0045, (i) => 0.2 * Math.sin(i / 30));
		const result = computeRepeatSpread([unit("Lap 1", [l])], 0.004);
		const fit = result.units[0];
		const rmsAt = (cda: number, crr: number) => {
			const ve = l.veProfile(cda, crr);
			let ss = 0;
			for (let i = 0; i < ve.length; i++) {
				ss += (ve[i] - l.elevation![i]) ** 2;
			}
			return Math.sqrt(ss / ve.length);
		};
		for (const [dc, dk] of [
			[0.002, 0],
			[-0.002, 0],
			[0, 0.0001],
			[0, -0.0001],
		]) {
			expect(rmsAt(fit.cda + dc, fit.crr + dk)).toBeGreaterThan(fit.rms);
		}
	});

	test("an out-and-back pair is one repeat: both legs fitted together", () => {
		const out = leg(200, 0, 0.3, 0.004, (i) => 0.1 * Math.sin(i / 9));
		const back = leg(200, 40, 0.3, 0.004, (i) => -0.1 * Math.sin(i / 9));
		const result = computeRepeatSpread([unit("Section 1", [out, back])], 0.004);
		expect(result.units).toHaveLength(1);
		expect(result.units[0].samples).toBe(400);
		expect(result.notEstimableReason).toBe(REPEAT_SPREAD_SINGLE_REASON);
	});

	test("SD across repeats matches the spread of the per-repeat fits", () => {
		const units = [0.29, 0.3, 0.32, 0.31].map((cda, j) =>
			unit(`Lap ${j + 1}`, [leg(300, j * 3, cda, 0.004)]),
		);
		const result = computeRepeatSpread(units, 0.004);
		expect(result.free.cda.n).toBe(4);
		expect(result.free.cda.df).toBe(3);
		expect(result.free.cda.sd).toBeCloseTo(
			repeatStat([0.29, 0.3, 0.32, 0.31]).sd!,
			8,
		);
		expect(result.fixed.cda.mean).toBeCloseTo(0.305, 8);
		expect(result.fixedCrr).toBe(0.004);
	});

	test("correlated residuals: the clustered SE is far larger than the naive SE", () => {
		// Each repeat carries its own random walk (strongly correlated 1 s
		// residuals) — the shape that defeats the i.i.d. error bar.
		const units = [0, 1, 2, 3, 4, 5].map((j) =>
			unit(`Lap ${j + 1}`, [leg(600, j * 7, 0.3, 0.004, randomWalk(j + 1))]),
		);
		const result = computeRepeatSpread(units, 0.004);
		const pooled = result.pooled!;
		expect(pooled.clusters).toBe(6);
		expect(pooled.df).toBe(5);
		expect(pooled.clusteredSe!.cda).toBeGreaterThan(3 * pooled.naiveSe.cda);
		expect(result.pooledFixed!.crr).toBe(0.004);
		expect(Number.isNaN(result.pooledFixed!.naiveSe.crr)).toBe(true);
	});

	test("clustered SE equals the hand-computed sandwich (CdA-only, two repeats)", () => {
		const l1 = leg(100, 0, 0.3, 0.004, (i) => 0.05 * Math.sin(i / 5));
		const l2 = leg(100, 9, 0.3, 0.004, (i) => 0.08 * Math.cos(i / 4));
		const result = computeRepeatSpread(
			[unit("A", [l1]), unit("B", [l2])],
			0.004,
		);
		const parts = [l1, l2].map((l) => {
			const b = l.veProfile(0, 0);
			const a = l.veProfile(1, 0).map((v, i) => b[i] - v);
			const f = l.veProfile(0, 1).map((v, i) => b[i] - v);
			const y = b.map((v, i) => v - l.elevation![i] - 0.004 * f[i]);
			return { a, y };
		});
		let aa = 0;
		let ay = 0;
		for (const { a, y } of parts) {
			for (let i = 0; i < a.length; i++) {
				aa += a[i] * a[i];
				ay += a[i] * y[i];
			}
		}
		const cda = ay / aa;
		let meat = 0;
		for (const { a, y } of parts) {
			let u = 0;
			for (let i = 0; i < a.length; i++) {
				u += a[i] * (y[i] - cda * a[i]);
			}
			meat += u * u;
		}
		const se = Math.sqrt((2 / 1) * (meat / (aa * aa)));
		expect(result.pooledFixed!.cda).toBeCloseTo(cda, 12);
		expect(result.pooledFixed!.clusteredSe!.cda).toBeCloseTo(se, 12);
	});

	test("a repeat that cannot separate CdA from Crr is singular, but still has a fixed-Crr CdA", () => {
		// Constant speed: a and f are proportional, so the free fit is singular.
		const n = 100;
		const a = Float64Array.from({ length: n }, (_, i) => i * 0.01);
		const f = Float64Array.from({ length: n }, (_, i) => i * 10);
		const flat: RepeatLeg = {
			veProfile: (cda, crr) =>
				Float64Array.from({ length: n }, (_, i) => -cda * a[i] - crr * f[i]),
			elevation: Float64Array.from(
				{ length: n },
				(_, i) => -0.3 * a[i] - 0.004 * f[i],
			),
		};
		const result = computeRepeatSpread([unit("Lap 1", [flat])], 0.004);
		expect(result.units[0].status).toBe("singular");
		expect(result.units[0].cdaAtFixedCrr).toBeCloseTo(0.3, 9);
		expect(result.free.cda.n).toBe(0);
	});
});
