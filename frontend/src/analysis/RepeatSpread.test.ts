import { describe, expect, test } from "vitest";
import {
	COASTING_POWER_W,
	computePowerIndependent,
	computeRepeatSpread,
	isCoastingLeg,
	repeatStat,
	REPEAT_SPREAD_NONE_REASON,
	REPEAT_SPREAD_SINGLE_REASON,
	computeSensitivities,
	tiltReference,
	tQuantile975,
	UNSTABLE_CORRELATION,
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

describe("tQuantile975", () => {
	test("table values and the large-df approximation", () => {
		expect(tQuantile975(2)).toBe(4.303);
		expect(tQuantile975(30)).toBe(2.042);
		expect(tQuantile975(60)).toBeCloseTo(2.0003, 2);
		expect(tQuantile975(0)).toBeNaN();
	});
});

/**
 * One leg into a headwind or with a tailwind: the air speed, and so the drag
 * per metre, differs between the two legs of an out-and-back while rolling
 * loss per metre does not — what lets a pair tell the two apart. (Speed
 * variation within one leg alone barely does: both losses still grow with
 * distance, and |r| stays near 1.)
 */
function pacedLeg(wind: number): RepeatLeg {
	const n = 300;
	const a = new Float64Array(n);
	const f = new Float64Array(n);
	for (let i = 1; i < n; i++) {
		const v = 10 + 2 * Math.sin(i / 25);
		a[i] = a[i - 1] + (1.2 * (v + wind) * (v + wind) * v) / (2 * 80 * 9.807);
		f[i] = f[i - 1] + v;
	}
	return {
		veProfile: (cda, crr) =>
			Float64Array.from({ length: n }, (_, i) => -cda * a[i] - crr * f[i]),
		elevation: Float64Array.from(
			{ length: n },
			(_, i) => -0.3 * a[i] - 0.004 * f[i] + 0.01 * Math.sin(i),
		),
	};
}

describe("instability flag", () => {
	test("a repeat with almost no speed variation is flagged by its correlation", () => {
		// Speed barely varies: a and f nearly proportional, |r| → 1.
		const n = 300;
		const a = Float64Array.from(
			{ length: n },
			(_, i) => i * (0.6 + 1e-3 * Math.sin(i / 13)),
		);
		const f = Float64Array.from({ length: n }, (_, i) => i * 10);
		const nearFlat: RepeatLeg = {
			veProfile: (cda, crr) =>
				Float64Array.from({ length: n }, (_, i) => -cda * a[i] - crr * f[i]),
			elevation: Float64Array.from(
				{ length: n },
				(_, i) => -0.3 * a[i] - 0.004 * f[i] + 0.05 * Math.sin(i / 20),
			),
		};
		const result = computeRepeatSpread([unit("Lap 1", [nearFlat])], 0.004);
		const fit = result.units[0];
		expect(Math.abs(fit.correlation)).toBeGreaterThanOrEqual(
			UNSTABLE_CORRELATION,
		);
		expect(fit.unstable).toMatch(/correlated/);
		// The fixed-Crr column is still there to read instead.
		expect(Number.isFinite(fit.cdaAtFixedCrr)).toBe(true);
	});

	test("a well-separated repeat is not flagged; one past the Crr bound is", () => {
		const good = computeRepeatSpread(
			[unit("Section 1", [pacedLeg(4), pacedLeg(-4)])],
			0.004,
			{
				cdaBounds: [0.15, 0.5],
				crrBounds: [0.0015, 0.03],
			},
		);
		expect(Math.abs(good.units[0].correlation)).toBeLessThan(
			UNSTABLE_CORRELATION,
		);
		expect(good.units[0].unstable).toBeNull();

		const beyond = computeRepeatSpread(
			[unit("Lap 1", [leg(300, 0, 0.3, 0.04)])],
			0.004,
			{
				crrBounds: [0.0015, 0.03],
			},
		);
		expect(beyond.units[0].unstable).toMatch(/Crr at or beyond its bounds/);
	});
});

describe("95 % range", () => {
	test("is the estimate ± t(0.975, G − 1) × the clustered SE", () => {
		const units = [0, 1, 2, 3].map((j) =>
			unit(`Lap ${j + 1}`, [leg(400, j * 5, 0.3, 0.004, randomWalk(j + 3))]),
		);
		const pooled = computeRepeatSpread(units, 0.004).pooled!;
		const t = tQuantile975(3);
		expect(pooled.range95!.cda[0]).toBeCloseTo(
			pooled.cda - t * pooled.clusteredSe!.cda,
			12,
		);
		expect(pooled.range95!.crr[1]).toBeCloseTo(
			pooled.crr + t * pooled.clusteredSe!.crr,
			12,
		);
	});

	test("absent with one repeat", () => {
		const pooled = computeRepeatSpread(
			[unit("Lap 1", [leg(200, 0, 0.3, 0.004)])],
			0.004,
		).pooled!;
		expect(pooled.range95).toBeNull();
	});
});

describe("sensitivities", () => {
	test("a reference rise ramps each leg by distance, reversed on the way back", () => {
		const base = leg(100, 0, 0.3, 0.004);
		const out = {
			...base,
			distance: Float64Array.from({ length: 100 }, (_, i) => i * i),
		};
		const back = { ...out, riseSign: -1 as const };
		const [tilted] = tiltReference([unit("Section 1", [out, back])], 0.5);
		const end = 99;
		expect(tilted.legs[0].elevation![end] - out.elevation![end]).toBeCloseTo(
			0.5,
			12,
		);
		expect(tilted.legs[1].elevation![end] - back.elevation![end]).toBeCloseTo(
			-0.5,
			12,
		);
		// By distance, not by sample: halfway in samples is a quarter of the way.
		expect(tilted.legs[0].elevation![50] - out.elevation![50]).toBeCloseTo(
			(0.5 * 2500) / 9801,
			12,
		);
	});

	test("rows are refit minus base; an unchanged input moves nothing", () => {
		const units = [
			unit("Lap 1", [leg(300, 0, 0.3, 0.004)]),
			unit("Lap 2", [leg(300, 4, 0.3, 0.004)]),
		];
		const base = computeRepeatSpread(units, 0.004);
		const [same, raised] = computeSensitivities(base, [
			{ label: "same", units },
			{ label: "rise", units: tiltReference(units, 0.5) },
		]);
		expect(same.dCda).toBe(0);
		expect(same.dCrr).toBe(0);
		expect(Math.abs(raised.dCda) + Math.abs(raised.dCrr)).toBeGreaterThan(0);
	});
});

describe("power-independent CdA (J3)", () => {
	const MASS = 85;
	const G = 9.807;
	const RHO = 1.2;

	/**
	 * A physical leg at 1 s steps: speed `v(i)`, recorded power `power(i)`,
	 * and VE whose power term is scaled by `eta` — the reference is the road
	 * a power meter with eta = 1 would reconstruct for (cda, crr). Drag is
	 * spent at the air speed `air(i)` (default: no wind, air = ground speed);
	 * the height step stays slope·ground speed, as in the kernel.
	 */
	function physicalLeg(
		n: number,
		v: (i: number) => number,
		power: (i: number) => number,
		cda: number,
		crr: number,
		eta: number,
		air: (i: number) => number = v,
	): RepeatLeg {
		const speed = Float64Array.from({ length: n }, (_, i) => v(i));
		const airSpeed = Float64Array.from({ length: n }, (_, i) => air(i));
		const watts = Float64Array.from({ length: n }, (_, i) => power(i));
		const profile = (c: number, r: number, scale: number) => {
			const out = new Float64Array(n);
			for (let i = 1; i < n; i++) {
				const s = speed[i];
				const va = airSpeed[i];
				const accel = speed[i] - speed[i - 1];
				const slope =
					(scale * watts[i]) / (MASS * G * s) -
					(c * RHO * va * va) / (2 * MASS * G) -
					r -
					accel / G;
				out[i] = out[i - 1] + slope * s;
			}
			return out;
		};
		return {
			veProfile: (c, r) => profile(c, r, eta),
			elevation: profile(cda, crr, 1),
			power: watts,
			speed,
			airSpeed,
			rho: RHO,
		};
	}

	/** A constant headwind on the descents (m/s); 0 is no wind. */
	const HEADWIND = 3;

	/** Three climbs at different power and three coasting descents. */
	function hillSession(eta: number, headwind = 0): RepeatUnitInput[] {
		return [0, 1, 2].flatMap((j) => [
			unit(`Up ${j}`, [
				physicalLeg(
					200,
					(i) => 5 + j + 0.5 * Math.sin(i / 13),
					(i) => 180 + 60 * j + 20 * Math.sin(i / 7),
					0.3,
					0.004,
					eta,
				),
			]),
			unit(`Down ${j}`, [
				physicalLeg(
					90,
					(i) => 9 + 4 * (1 - Math.exp(-i / 20)),
					(i) => (i % 30 === 0 ? 150 : 0),
					0.3,
					0.004,
					eta,
					(i) => 9 + 4 * (1 - Math.exp(-i / 20)) + headwind,
				),
			]),
		]);
	}

	test("a leg coasts when most of it is under the power threshold", () => {
		const legOf = (under: number) => ({
			...leg(100, 0, 0.3, 0.004),
			power: Float64Array.from({ length: 100 }, (_, i) =>
				i < under ? COASTING_POWER_W - 1 : 200,
			),
		});
		expect(isCoastingLeg(legOf(70))).toBe(true);
		expect(isCoastingLeg(legOf(60))).toBe(false);
		expect(isCoastingLeg(leg(100, 0, 0.3, 0.004))).toBe(false);
	});

	test("not available without a coasting leg", () => {
		const units = hillSession(1).filter((u) => u.key.startsWith("Up"));
		expect(
			computePowerIndependent(units, computeRepeatSpread(units, 0.004), MASS),
		).toBeNull();
	});

	test("k comes from the coasting legs' drag-weighted speed and density", () => {
		const units = hillSession(1);
		const result = computePowerIndependent(
			units,
			computeRepeatSpread(units, 0.004),
			MASS,
		)!;
		const down = units[1].legs[0].speed!;
		const sum = (p: number) => down.reduce((a, v) => a + v ** p, 0);
		const weighted = Math.sqrt(sum(3) / sum(1));
		// Above the plain mean: the descent starts slow.
		expect(weighted).toBeGreaterThan(sum(1) / down.length);
		expect(result.speed).toBeCloseTo(weighted, 12);
		expect(result.k).toBeCloseTo(
			(2 * MASS * G) / (RHO * weighted * weighted),
			12,
		);
		expect(result.coastingLegs).toBe(3);
		expect(result.totalLegs).toBe(6);
		// Noise-free: the fit recovers the truth, and so does the sum.
		expect(result.pooled!.value).toBeCloseTo(0.3 + result.k * 0.004, 6);
	});

	test("a 1 % power error moves CdA + k·Crr far less than CdA", () => {
		const fitAt = (eta: number) => {
			const units = hillSession(eta);
			const spread = computeRepeatSpread(units, 0.004);
			return {
				cda: spread.pooled!.cda,
				sum: computePowerIndependent(units, spread, MASS)!.pooled!.value,
			};
		};
		const base = fitAt(1);
		const high = fitAt(1.01);
		const dCda = high.cda - base.cda;
		expect(Math.abs(dCda)).toBeGreaterThan(0.002);
		expect(Math.abs(high.sum - base.sum)).toBeLessThan(0.25 * Math.abs(dCda));
	});

	test("k comes from the coasting legs' air speed when there is wind", () => {
		const units = hillSession(1, HEADWIND);
		const result = computePowerIndependent(
			units,
			computeRepeatSpread(units, 0.004),
			MASS,
		)!;
		let groundSum = 0;
		let dragSum = 0;
		let cubeSum = 0;
		for (const u of units.filter((u) => u.key.startsWith("Down"))) {
			const leg = u.legs[0];
			leg.speed!.forEach((vg, i) => {
				const va = leg.airSpeed![i];
				groundSum += vg;
				dragSum += va * va * vg;
				cubeSum += vg * vg * vg;
			});
		}
		const weighted = Math.sqrt(dragSum / groundSum);
		expect(result.speed).toBeCloseTo(weighted, 12);
		expect(result.k).toBeCloseTo(
			(2 * MASS * G) / (RHO * weighted * weighted),
			12,
		);
		const groundK = (2 * MASS * G * groundSum) / (RHO * cubeSum);
		expect(result.k / groundK).toBeLessThan(0.8);
	});

	test("with a headwind, a 1 % power error still leaves CdA + k·Crr flat", () => {
		const fitAt = (eta: number) => {
			const units = hillSession(eta, HEADWIND);
			const spread = computeRepeatSpread(units, 0.004);
			return {
				cda: spread.pooled!.cda,
				sum: computePowerIndependent(units, spread, MASS)!.pooled!.value,
			};
		};
		const base = fitAt(1);
		const high = fitAt(1.01);
		const dCda = high.cda - base.cda;
		const dSum = high.sum - base.sum;
		expect(Math.abs(dCda)).toBeGreaterThan(0.002);
		// Measured: |ΔSum| ≈ 0.011·|ΔCdA| with k from the air speed, ≈ 0.53·|ΔCdA|
		// with k from the ground speed. The bound sits well between the two.
		expect(Math.abs(dSum)).toBeLessThan(0.05 * Math.abs(dCda));
	});

	test("the combination's clustered SE uses the CdA–Crr covariance", () => {
		const units = hillSession(1).map((u, j) => ({
			...u,
			legs: u.legs.map((l) => ({
				...l,
				elevation: l.elevation!.map(
					(h, i) => h + (i === 0 ? 0 : 0.05 * Math.sin(i / 9 + j)),
				),
			})),
		}));
		const spread = computeRepeatSpread(units, 0.004);
		const result = computePowerIndependent(units, spread, MASS)!;
		const pooled = spread.pooled!;
		const se = pooled.clusteredSe!;
		expect(result.pooled!.clusteredSe).toBeCloseTo(
			Math.sqrt(
				se.cda ** 2 +
					result.k ** 2 * se.crr ** 2 +
					2 * result.k * pooled.clusteredCov,
			),
			12,
		);
		// CdA and Crr trade off: their covariance is negative.
		expect(pooled.clusteredCov).toBeLessThan(0);
		// Only repeats with a coasting leg count for the SD.
		expect(result.repeats.combined.n).toBe(3);
	});
});
