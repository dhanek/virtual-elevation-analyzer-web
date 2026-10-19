/**
 * The Repeats tab's fits against the REAL calculator: `buildRepeatUnits`
 * over `prepareSegments`, then `computeRepeatSpread`.
 *
 * What only the real WASM can show: the VE really is linear in (CdA, Crr) —
 * so the closed-form per-lap fit is the true profile-RMS minimum — and the
 * RMS the table reports for a lap is the RMSE the VE tab shows with the
 * sliders at that lap's fitted values, temperature-corrected Crr included.
 */
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { beforeAll, describe, expect, it } from "vitest";
import { initSync } from "@wasm/virtual_elevation_analyzer.js";
import {
	computeRepeatSpread,
	computeSensitivities,
} from "../../analysis/RepeatSpread";
import { resolveAppliedCrr } from "../../analysis/CrrTemperatureCorrection";
import type { AnalysisParameters } from "../../components/AnalysisParameters";
import type { ModeSegment } from "../../modes/analysis/types";
import {
	buildConvergenceUpdateInput,
	buildRepeatSensitivities,
	buildRepeatUnits,
	prepareSegments,
} from "./segmentPreparation";

const WASM_PATH = fileURLToPath(
	new URL("../../../pkg/virtual_elevation_analyzer_bg.wasm", import.meta.url),
);
const built = existsSync(WASM_PATH);

const LAP = 300;
const COUNT = 4 * LAP;

/** Four laps over a rolling road, paced differently, with a little noise. */
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
	return {
		timestamps,
		power,
		velocity,
		positionLat: timestamps.map((i) => 45 + i * 1e-5),
		positionLong: timestamps.map((i) => 8 + i * 1e-5),
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
	// A pure Crr multiplier; the fits must still land in SLIDER space.
	crr_temp_correction: true,
	ambient_temp_c: 8,
} as AnalysisParameters;

function prepareArgs(segments: ModeSegment[]) {
	const normalized = ride();
	return {
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
	};
}

function prepare(segments: ModeSegment[]) {
	return prepareSegments(prepareArgs(segments));
}

const LAPS: ModeSegment[] = [0, 1, 2, 3].map((lap) => ({
	key: `lap-${lap + 1}`,
	label: `Lap ${lap + 1}`,
	itemNumber: lap + 1,
	range: { startIdx: lap * LAP, endIdx: lap * LAP + LAP - 1 },
	trim: { start: 5, end: LAP - 6 },
}));

describe.skipIf(!built)("Repeats tab fits on the real calculator", () => {
	beforeAll(() => {
		initSync({ module: readFileSync(WASM_PATH) });
	});

	it("each lap's RMS is the VE tab's RMSE at that lap's fitted sliders", () => {
		const prepared = prepare(LAPS);
		const result = computeRepeatSpread(
			buildRepeatUnits(prepared, PARAMS),
			0.005,
		);
		expect(result.units).toHaveLength(4);
		result.units.forEach((fit, j) => {
			expect(fit.status).toBe("ok");
			const p = prepared[j];
			const atFit = p.calculator.calculate_virtual_elevation(
				fit.cda,
				resolveAppliedCrr(PARAMS, fit.crr),
				p.trimStart,
				p.trimEnd,
			);
			expect(fit.rms).toBeCloseTo(atFit.rmse, 9);
			// A minimum: nudging either slider makes the VE tab's RMSE worse.
			for (const [dc, dk] of [
				[0.005, 0],
				[-0.005, 0],
				[0, 0.0002],
				[0, -0.0002],
			]) {
				const nudged = p.calculator.calculate_virtual_elevation(
					fit.cda + dc,
					resolveAppliedCrr(PARAMS, fit.crr + dk),
					p.trimStart,
					p.trimEnd,
				);
				expect(nudged.rmse).toBeGreaterThan(fit.rms);
			}
			const atFixed = p.calculator.calculate_virtual_elevation(
				fit.cdaAtFixedCrr,
				resolveAppliedCrr(PARAMS, 0.005),
				p.trimStart,
				p.trimEnd,
			);
			expect(fit.rmsAtFixedCrr).toBeCloseTo(atFixed.rmse, 9);
		});
		expect(result.free.cda.n).toBe(4);
		expect(result.free.cda.df).toBe(3);
		expect(result.free.cda.sd).not.toBeNull();
		expect(result.notEstimableReason).toBeNull();
	});

	it("out-and-back legs of one section form one repeat", () => {
		const legs: ModeSegment[] = [
			{
				key: "s1-out",
				label: "Section 1 outbound",
				itemNumber: 1,
				legDirection: "outbound",
				range: { startIdx: 0, endIdx: LAP - 1 },
			},
			{
				key: "s1-in",
				label: "Section 1 inbound",
				itemNumber: 1,
				legDirection: "inbound",
				range: { startIdx: LAP, endIdx: 2 * LAP - 1 },
			},
			{
				key: "s2-out",
				label: "Section 2 outbound",
				itemNumber: 2,
				legDirection: "outbound",
				range: { startIdx: 2 * LAP, endIdx: 3 * LAP - 1 },
			},
		];
		const units = buildRepeatUnits(prepare(legs), PARAMS);
		expect(units.map((u) => [u.label, u.legs.length])).toEqual([
			["Section 1", 2],
			["Section 2", 1],
		]);
	});

	it("a single lap reports its fit and no spread", () => {
		const result = computeRepeatSpread(
			buildRepeatUnits(prepare(LAPS.slice(0, 1)), PARAMS),
			0.005,
		);
		expect(result.units[0].status).toBe("ok");
		expect(result.free.cda.sd).toBeNull();
		expect(result.notEstimableReason).toMatch(/not estimable/);
	});

	it("sensitivities are real refits: +1 % density is exactly CdA / 1.01", () => {
		const args = prepareArgs(LAPS);
		const units = buildRepeatUnits(prepareSegments(args), PARAMS);
		const base = computeRepeatSpread(units, 0.005);
		const rows = computeSensitivities(
			base,
			buildRepeatSensitivities(args, units),
		);
		const byLabel = new Map(rows.map((row) => [row.label, row]));
		const density = byLabel.get("Air density +1 %")!;
		// CdA enters only as CdA·ρ, so the refit must land on CdA / 1.01.
		expect(density.dCdaAtFixedCrr).toBeCloseTo(
			base.pooledFixed!.cda / 1.01 - base.pooledFixed!.cda,
			9,
		);
		expect(density.dCrr).toBeCloseTo(0, 9);
		// More power at the wheel needs more resistance to explain it.
		expect(byLabel.get("Power +1 %")!.dCdaAtFixedCrr).toBeGreaterThan(0);
		expect(rows).toHaveLength(8);
	});

	it("Convergence power shift: base grid + shift equals the grid recomputed at efficiency × 1.01", () => {
		const args = prepareArgs(LAPS);
		const prepared = prepareSegments(args);
		const withEta = (etaScale: number) =>
			prepareSegments({
				...args,
				params: { ...PARAMS, eta: PARAMS.eta * etaScale },
			});
		const input = buildConvergenceUpdateInput({
			prepared,
			params: PARAMS,
			prepareWithEtaScale: withEta,
			windSource: "constant",
			airSpeedCalibrationPercent: 0,
			activeDisplayProfile: null,
			rhoArray: null,
			cda: 0.3,
			crr: 0.005,
			appliedCrr: resolveAppliedCrr(PARAMS, 0.005),
			profileMode: false,
			targetSource: "manual",
			targetLabel: "manual Δh",
		});
		const moved = withEta(1.01);
		input.segments.forEach((segment, j) => {
			const shift = segment.powerShift!(1.01)!;
			const base = segment.veGainGrid(0.2, 0.4, 5, 0.002, 0.008, 5);
			const q = moved[j];
			const recomputed = q.calculator.ve_gain_grid(
				0.2,
				0.4,
				5,
				0.002,
				0.008,
				5,
				q.trimStart,
				q.trimEnd,
			);
			for (let i = 0; i < base.length; i++) {
				expect(base[i] + shift.gain).toBeCloseTo(recomputed[i], 9);
			}
			expect(shift.gain).toBeGreaterThan(0);
		});
	});
});
