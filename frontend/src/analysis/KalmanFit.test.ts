import { describe, expect, it } from "vitest";
import {
	airSpeedSource,
	buildKalmanSelection,
	kalmanReasonText,
	kalmanWarningText,
	parseKalmanOutput,
} from "./KalmanFit";
import type { RepeatLeg, RepeatUnitInput } from "./RepeatSpread";

/** A leg whose VE is exactly linear: b − CdA·a − Crr·f, f in slider space. */
function leg(
	n: number,
	shift: number,
	extra: Partial<RepeatLeg> = {},
): RepeatLeg {
	const b = Float64Array.from({ length: n }, (_, i) => 0.01 * i + shift);
	const a = Float64Array.from({ length: n }, (_, i) => 0.002 * i);
	const f = Float64Array.from({ length: n }, (_, i) => 5 * i);
	return {
		veProfile: (cda, crr) =>
			Float64Array.from(
				{ length: n },
				(_, i) => b[i] - cda * a[i] - crr * f[i],
			),
		elevation: Float64Array.from({ length: n }, (_, i) => 0.009 * i),
		distance: Float64Array.from({ length: n }, (_, i) => 5 * i),
		speed: new Float64Array(n).fill(5),
		airSpeed: new Float64Array(n).fill(6),
		power: new Float64Array(n).fill(200),
		rho: 1.2,
		timestamps: Float64Array.from({ length: n }, (_, i) => i),
		lat: new Float64Array(n).fill(51),
		lon: Float64Array.from({ length: n }, (_, i) => 7 + i * 1e-4),
		...extra,
	};
}

const physics = { mass: 85, eta: 0.98, cda: 0.3, crr: 0.004 };

describe("buildKalmanSelection", () => {
	it("linearises every leg into y, the CdA column and the slider-space Crr column", () => {
		const units: RepeatUnitInput[] = [
			{ key: "lap-1", label: "Lap 1", legs: [leg(10, 0)] },
			{
				key: "section-2",
				label: "Section 2",
				legs: [leg(10, 0.5), leg(10, 0.2)],
			},
		];
		const selection = buildKalmanSelection(units, physics, "measured");
		expect(selection).not.toBeNull();
		const s = selection!;
		expect(s.names).toEqual(["CdA", "Crr"]);
		expect(s.legs.map((l) => l.label)).toEqual([
			"Lap 1",
			"Section 2 · leg 1",
			"Section 2 · leg 2",
		]);
		const first = s.legs[0];
		expect(first.y[3]).toBeCloseTo(0.03 - 0.027, 12);
		expect(first.columns[0][3]).toBeCloseTo(0.006, 12);
		expect(first.columns[1][3]).toBeCloseTo(15, 12);
		expect(first.airSpeed[0]).toBe(6);
		expect(first.lat).toHaveLength(10);
		expect(s.physics).toEqual(physics);
		expect(s.options.airSpeed).toBe("measured");
	});

	it("leaves out a leg without an elevation profile, and returns null below two legs", () => {
		const units: RepeatUnitInput[] = [
			{ key: "lap-1", label: "Lap 1", legs: [leg(10, 0)] },
			{ key: "lap-2", label: "Lap 2", legs: [leg(10, 0, { elevation: null })] },
		];
		expect(buildKalmanSelection(units, physics, "measured")).toBeNull();
	});

	it("sends no GPS when a leg has none, so every leg falls back to distance", () => {
		const units: RepeatUnitInput[] = [
			{
				key: "lap-1",
				label: "Lap 1",
				legs: [leg(10, 0, { lat: undefined, lon: undefined })],
			},
			{ key: "lap-2", label: "Lap 2", legs: [leg(10, 0)] },
		];
		const s = buildKalmanSelection(units, physics, "measured")!;
		expect(s.legs[0].lat).toEqual([]);
		expect(s.legs[1].lat).toHaveLength(10);
	});
});

describe("airSpeedSource", () => {
	it("maps the wind resolution to what the fit allows", () => {
		expect(airSpeedSource("air_speed")).toBe("measured");
		expect(airSpeedSource("wind_speed")).toBe("measured");
		expect(airSpeedSource("constant")).toBe("modelled");
		expect(airSpeedSource("none")).toBe("groundSpeed");
	});
});

describe("texts", () => {
	it("names every refusal", () => {
		for (const reason of [
			"tooFewLegs",
			"tooFewObservations",
			"cdaNeedsAirspeed",
			"notIdentified",
		]) {
			expect(kalmanReasonText(reason, null)).not.toMatch(/undefined/);
		}
		expect(kalmanReasonText("notIdentified", ["CdA", "Crr"])).toContain(
			"CdA and Crr",
		);
	});

	it("names every warning", () => {
		expect(kalmanWarningText("noiseAtBound:q,s2,r")).toContain(
			"upper bound (q, s2)",
		);
		expect(kalmanWarningText("noiseAtBound:r")).toContain("1 cm floor");
		expect(kalmanWarningText("weakSpeedContrast:0.081")).toContain("0.08");
		expect(kalmanWarningText("noCommonRoad")).toMatch(/road/);
		expect(kalmanWarningText("tooManyDisturbances")).toMatch(/disturbances/);
		expect(kalmanWarningText("modelledWind")).toMatch(/weather/);
	});
});

describe("parseKalmanOutput", () => {
	it("reads the WASM JSON", () => {
		const out = parseKalmanOutput(
			JSON.stringify({
				status: "refused",
				reason: "tooFewLegs",
				coupled: null,
				fit: null,
				residuals: [],
				closedLoop: false,
				loopLength: null,
				sessions: [],
				sessionZ: [],
			}),
		);
		expect(out.status).toBe("refused");
		expect(out.reason).toBe("tooFewLegs");
	});
});
