/**
 * The Kalman fit (TODO J6) on the REAL WASM: the Repeats tab's legs through
 * `prepareSegments` → `buildRepeatUnits` → `buildKalmanSelection` →
 * `fit_selection_json`, its named refusals, and the spec's performance bound
 * (acceptance test 7: 18 legs × 200 points in under a second).
 */
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { beforeAll, describe, expect, it } from "vitest";
import {
	fit_selection_json,
	initSync,
} from "@wasm/virtual_elevation_analyzer.js";
import { resolveAppliedCrr } from "../../analysis/CrrTemperatureCorrection";
import {
	buildKalmanSelection,
	type KalmanLegInput,
	type KalmanSelectionInput,
	parseKalmanOutput,
} from "../../analysis/KalmanFit";
import type { AnalysisParameters } from "../../components/AnalysisParameters";
import type { ModeSegment } from "../../modes/analysis/types";
import { buildRepeatUnits, prepareSegments } from "./segmentPreparation";

const WASM_PATH = fileURLToPath(
	new URL("../../../pkg/virtual_elevation_analyzer_bg.wasm", import.meta.url),
);
const built = existsSync(WASM_PATH);

const LAP = 300;
const COUNT = 4 * LAP;

/**
 * Four laps of the same 2.7 km road (the GPS repeats every lap), paced
 * differently, over a rolling profile.
 */
function ride() {
	const timestamps: number[] = [];
	const power: number[] = [];
	const velocity: number[] = [];
	const altitude: number[] = [];
	const distance: number[] = [];
	let d = 0;
	for (let i = 0; i < COUNT; i++) {
		const lap = Math.floor(i / LAP);
		const v = 9 + lap * 0.8 + 1.5 * Math.sin(i / 23);
		d += v;
		timestamps.push(i);
		velocity.push(v);
		power.push(180 + lap * 30 + 60 * Math.sin(i / 17));
		altitude.push(100 + 6 * Math.sin((2 * Math.PI * (i % LAP)) / LAP));
		distance.push(d);
	}
	// Each lap rides the same straight line: position from the lap's own
	// distance, so laps paced differently still meet at the same places.
	const lapStart = timestamps.map((i) => distance[Math.floor(i / LAP) * LAP]);
	const along = distance.map((x, i) => x - lapStart[i]);
	return {
		timestamps,
		power,
		velocity,
		positionLat: along.map((x) => 45 + x / 111_320),
		positionLong: along.map(() => 8),
		altitude,
		distance,
		temperature: timestamps.map(() => 15),
	};
}

const PARAMS = {
	system_mass: 80,
	rho: 1.2,
	eta: 0.98,
	velodrome: false,
	cda: 0.3,
	crr: 0.005,
	crr_temp_correction: true,
	ambient_temp_c: 8,
} as AnalysisParameters;

function prepare(segments: ModeSegment[]) {
	const normalized = ride();
	return prepareSegments({
		segments,
		normalized: normalized as any,
		altitude: normalized.altitude,
		wind: {
			windSpeed: normalized.timestamps.map(() => 0),
			selectedWindSource: "constant",
		} as any,
		compareWind: null,
		rhoArray: null,
		params: PARAMS,
		cda: 0.3,
		appliedCrr: resolveAppliedCrr(PARAMS, 0.005),
		closure: {
			source: "manual" as const,
			demAltitude: null,
			baroAltitude: null,
			manualDiffMetres: 0,
		},
	});
}

const LAPS: ModeSegment[] = [0, 1, 2, 3].map((lap) => ({
	key: `lap-${lap + 1}`,
	label: `Lap ${lap + 1}`,
	itemNumber: lap + 1,
	range: { startIdx: lap * LAP, endIdx: lap * LAP + LAP - 1 },
	trim: { start: 5, end: LAP - 6 },
}));

const PHYSICS = { mass: 80, eta: 0.98, cda: 0.3, crr: 0.005 };

/** SplitMix64 → standard normal, for the synthetic selection. */
function rng(seed: number) {
	let s = BigInt(seed);
	const mask = (1n << 64n) - 1n;
	const next = () => {
		s = (s + 0x9e3779b97f4a7c15n) & mask;
		let z = s;
		z = ((z ^ (z >> 30n)) * 0xbf58476d1ce4e5b9n) & mask;
		z = ((z ^ (z >> 27n)) * 0x94d049bb133111ebn) & mask;
		return Number((z ^ (z >> 31n)) >> 11n) / 2 ** 53;
	};
	return () => {
		const u = Math.max(next(), 1e-300);
		return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * next());
	};
}

/**
 * Eighteen 1 km legs up and down the same road, 200 samples each, built
 * from the error model itself (CdA 0.30, Crr 0.004): a random walk per leg,
 * a terrain error shared at each road position, and a 1 m step in one leg.
 */
function eighteenLegs(): KalmanSelectionInput {
	const normal = rng(18);
	const n = 200;
	const terrain = new Array<number>(n);
	terrain[0] = 0.07 * normal();
	const phi = Math.exp(-5 / 100);
	for (let k = 1; k < n; k++) {
		terrain[k] =
			phi * terrain[k - 1] + 0.07 * Math.sqrt(1 - phi * phi) * normal();
	}
	const legs: KalmanLegInput[] = [];
	for (let l = 0; l < 18; l++) {
		const up = l % 2 === 0;
		const speed2 = up ? 30 : 200;
		let w = 0;
		let a = 0;
		let f = 0;
		const leg: KalmanLegInput = {
			label: `Leg ${l + 1}`,
			session: 0,
			timestamps: [],
			power: [],
			speed: [],
			airSpeed: [],
			rho: 1.2,
			distance: [],
			lat: [],
			lon: [],
			elevation: [],
			y: [],
			columns: [[], []],
		};
		for (let k = 0; k < n; k++) {
			if (k > 0) {
				w += 0.02 * normal();
				a += (5 * 0.5 * 1.2 * speed2) / (85 * 9.807);
				f += 5;
			}
			const g = up ? k : n - 1 - k;
			const step = l === 7 && k >= 120 ? 1.0 : 0;
			leg.timestamps.push(k);
			leg.speed.push(5);
			leg.airSpeed.push(5);
			// Enough power to hold 5 m/s: never braking.
			leg.power.push(300);
			leg.distance.push(5 * k);
			leg.lat.push(51 + (5 * g) / 111_320);
			leg.lon.push(7);
			leg.elevation.push(0);
			leg.y.push(
				0.3 * a +
					0.004 * f +
					0.2 * l +
					w +
					terrain[g] +
					step +
					0.014 * normal(),
			);
			leg.columns[0].push(a);
			leg.columns[1].push(f);
		}
		legs.push(leg);
	}
	return {
		names: ["CdA", "Crr"],
		legs,
		physics: { mass: 85, eta: 1, cda: 0.3, crr: 0.004 },
		options: { gridM: 5, airSpeed: "measured", fixedCda: null, jumps: true },
	};
}

describe.skipIf(!built)("Kalman fit on the real WASM", () => {
	beforeAll(() => {
		initSync({ module: readFileSync(WASM_PATH) });
	});

	it("fits the Repeats tab's laps end to end", () => {
		const units = buildRepeatUnits(prepare(LAPS), PARAMS);
		const selection = buildKalmanSelection(units, PHYSICS, "measured");
		expect(selection).not.toBeNull();
		const out = parseKalmanOutput(
			fit_selection_json(JSON.stringify(selection)),
		);
		expect(out.status).toBe("ok");
		const fit = out.fit!;
		expect(fit.names).toEqual(["CdA", "Crr"]);
		expect(fit.legs).toBe(4);
		for (const v of [...fit.beta, ...fit.se]) {
			expect(Number.isFinite(v)).toBe(true);
		}
		expect(out.residuals).toHaveLength(4);
		// One road axis: every lap's positions sit on the same 0–2.7 km.
		for (const leg of out.residuals) {
			expect(leg.pos.length).toBeGreaterThan(50);
			expect(Math.min(...leg.pos)).toBeGreaterThanOrEqual(0);
			expect(Math.max(...leg.pos)).toBeLessThan(3200);
		}
		expect(fit.warnings).not.toContain("noCommonRoad");
	});

	it("refuses a free CdA without measured air speed, by name", () => {
		const units = buildRepeatUnits(prepare(LAPS), PARAMS);
		const selection = buildKalmanSelection(units, PHYSICS, "groundSpeed")!;
		const out = parseKalmanOutput(
			fit_selection_json(JSON.stringify(selection)),
		);
		expect(out.status).toBe("refused");
		expect(out.reason).toBe("cdaNeedsAirspeed");
	});

	it("refuses one leg, by name", () => {
		const selection = eighteenLegs();
		selection.legs = selection.legs.slice(0, 1);
		const out = parseKalmanOutput(
			fit_selection_json(JSON.stringify(selection)),
		);
		expect(out.reason).toBe("tooFewLegs");
	});

	it("fits 18 legs × 200 points in under a second (spec test 7)", () => {
		const input = JSON.stringify(eighteenLegs());
		// Once untimed: the first call pays the engine's tier-up of the module.
		fit_selection_json(input);
		const start = performance.now();
		const out = parseKalmanOutput(fit_selection_json(input));
		const took = performance.now() - start;
		expect(out.status).toBe("ok");
		const fit = out.fit!;
		expect(fit.legs).toBe(18);
		expect(fit.beta[0]).toBeGreaterThan(0.3 - 4 * fit.se[0]);
		expect(fit.beta[0]).toBeLessThan(0.3 + 4 * fit.se[0]);
		expect(fit.jumps.some((j) => j.leg === 7 && j.fitted)).toBe(true);
		expect(
			took,
			`18 legs × 200 points took ${took.toFixed(0)} ms`,
		).toBeLessThan(1000);
	});
});
