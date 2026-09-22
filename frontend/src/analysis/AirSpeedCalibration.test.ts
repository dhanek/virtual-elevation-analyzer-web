import { describe, expect, it } from "vitest";
import {
	AIR_SPEED_CALIBRATION_MAX_PERCENT,
	AIR_SPEED_CALIBRATION_MIN_PERCENT,
	calculateAutoAirSpeedCalibration,
	calculateAutoAirSpeedCalibrationPercent,
	calibrationEligibility,
	calibrationSeries,
	type AutoCalibrationInput,
	type AutoCalibrationOutcome,
	type HeadingCalibrationSegment,
} from "./AirSpeedCalibration";
import { applyAirSpeedOffset } from "./WindSourceResolver";
import {
	syntheticTrack,
	type TrackOptions,
} from "./__fixtures__/syntheticTrack";

describe("calculateAutoAirSpeedCalibrationPercent", () => {
	it("calculates calibration for a single segment", () => {
		const calibration = calculateAutoAirSpeedCalibrationPercent([
			{
				timestamps: [0, 1, 2, 3],
				groundSpeed: [11, 11, 11, 11],
				apparentSpeed: [10, 10, 10, 10],
			},
		]);

		expect(calibration).toBeCloseTo(10, 6);
	});

	it("stacks multiple segments when calculating calibration", () => {
		const calibration = calculateAutoAirSpeedCalibrationPercent([
			{
				timestamps: [0, 1, 2],
				groundSpeed: [11, 11, 11],
				apparentSpeed: [10, 10, 10],
			},
			{
				timestamps: [0, 2, 4],
				groundSpeed: [22, 22, 22],
				apparentSpeed: [20, 20, 20],
			},
		]);

		expect(calibration).toBeCloseTo(10, 6);
	});

	it("ignores invalid time deltas and returns null when no usable air distance exists", () => {
		const calibration = calculateAutoAirSpeedCalibrationPercent([
			{
				timestamps: [0, 10, 20],
				groundSpeed: [11, 11, 11],
				apparentSpeed: [10, 10, 10],
			},
			{
				timestamps: [0, 1],
				groundSpeed: [11, 11],
				apparentSpeed: [0, 0],
			},
		]);

		expect(calibration).toBeNull();
	});

	it("respects start and end indices for trimmed standard-mode calculations", () => {
		const calibration = calculateAutoAirSpeedCalibrationPercent([
			{
				timestamps: [0, 1, 2, 3],
				groundSpeed: [5, 11, 11, 5],
				apparentSpeed: [5, 10, 10, 5],
				startIndex: 1,
				endIndex: 2,
			},
		]);

		expect(calibration).toBeCloseTo(10, 6);
	});

	it("clamps extreme suggestions to configured bounds", () => {
		const high = calculateAutoAirSpeedCalibrationPercent([
			{
				timestamps: [0, 1],
				groundSpeed: [30, 30],
				apparentSpeed: [10, 10],
			},
		]);
		const low = calculateAutoAirSpeedCalibrationPercent([
			{
				timestamps: [0, 1],
				groundSpeed: [1, 1],
				apparentSpeed: [10, 10],
			},
		]);

		expect(high).toBe(AIR_SPEED_CALIBRATION_MAX_PERCENT);
		expect(low).toBe(AIR_SPEED_CALIBRATION_MIN_PERCENT);
	});
});

function lap(
	options: TrackOptions,
	label = "Lap 1",
): HeadingCalibrationSegment {
	const track = syntheticTrack(options);
	return { label, ...track };
}

function vdOf(segments: HeadingCalibrationSegment[]) {
	return segments.map((s) => ({
		timestamps: s.timestamps,
		groundSpeed: s.velocity,
		apparentSpeed: s.airSpeed,
	}));
}

function run(segments: HeadingCalibrationSegment[], measuredAirSpeed = true) {
	return calculateAutoAirSpeedCalibration({
		measuredAirSpeed,
		headingSegments: segments,
		vdSegments: vdOf(segments),
	});
}

function sinusoid(outcome: AutoCalibrationOutcome) {
	if (outcome.method !== "sinusoid") throw new Error(JSON.stringify(outcome));
	return outcome;
}

const kinds = (outcome: AutoCalibrationOutcome) =>
	outcome.method === "sinusoid" ? outcome.warnings.map((w) => w.kind) : [];

describe("calculateAutoAirSpeedCalibration", () => {
	it("fits a clean oval with no warnings", () => {
		const outcome = sinusoid(run([lap({ circuits: 6.5, scale: 1.08 })]));
		expect(outcome.percent).toBeCloseTo(8, 6);
		expect(outcome.circuits).toBe(6);
		expect(outcome.perSegment[0].windSpeed).toBeCloseTo(2, 6);
		expect(outcome.perSegment[0].windDirDeg).toBeCloseTo(247, 4);
		expect(outcome.warnings).toEqual([]);
	});

	it("falls back to today's distance ratio, unchanged, without measured air speed", () => {
		const segments = [lap({ circuits: 6.5, scale: 1.08 })];
		expect(run(segments, false)).toEqual({
			method: "vdRatio",
			percent: calculateAutoAirSpeedCalibrationPercent(vdOf(segments)),
			fallback: "noMeasuredAirSpeed",
		});
	});

	it("R10: returns an explicit none when the distance ratio has no answer either", () => {
		expect(
			calculateAutoAirSpeedCalibration({
				measuredAirSpeed: false,
				headingSegments: [],
				vdSegments: [],
			}),
		).toEqual({ method: "none", reason: "noMeasuredAirSpeed" });
	});

	it("R6: falls back when no segment has a usable fix", () => {
		const outcome = run([lap({ circuits: 6.5, zeroFixAt: () => true })]);
		expect(outcome).toMatchObject({
			method: "vdRatio",
			fallback: "noUsablePositions",
		});
	});

	it("finding 3: an EMPTY selection reports 'no complete circuit', not 'no usable positions'", () => {
		// `[].every(...)` is vacuously true, so before the fix this took the same
		// branch as R6 above and reported "no usable GPS positions" for a
		// selection that has no segments at all -- a different claim from "nothing
		// was selected". With no segments there is also no virtual distance to
		// fall back on (R10's path), so the honest report is an explicit `none`
		// with the existing `noWholeCircuit` reason ("the selection holds no
		// complete circuit").
		const outcome = run([]);
		expect(outcome).toEqual({ method: "none", reason: "noWholeCircuit" });
	});

	it("R3: falls back for an open arc, a spiral and a figure-eight", () => {
		expect(run([lap({ circuits: 0.8 })])).toMatchObject({
			fallback: "noWholeCircuit",
		});
		expect(
			run([lap({ shape: "spiral", circuits: 7.2, growthMeters: 5 })]),
		).toMatchObject({ fallback: "notClosed" });
		expect(run([lap({ shape: "figureEight", circuits: 3 })])).toMatchObject({
			fallback: "reversal",
		});
	});

	it("excludes samples under 5 m/s", () => {
		const outcome = sinusoid(
			run([
				lap({
					circuits: 7.5,
					scale: 1.08,
					speed: (_f, i) => (i < 40 ? 3 : 10),
					gust: (i) => (i < 40 ? 25 : 0),
				}),
			]),
		);
		expect(outcome.percent).toBeCloseTo(8, 6);
	});

	it("a four-second ease-off does not destroy the circuit", () => {
		const outcome = sinusoid(
			run([
				lap({
					circuits: 1,
					scale: 1.08,
					speed: (_f, i) => (i >= 20 && i < 24 ? 4 : 10),
					gust: (i) => (i >= 20 && i < 24 ? 25 : 0),
				}),
			]),
		);
		expect(outcome.circuits).toBe(1);
		expect(outcome.percent).toBeCloseTo(8, 6);
	});

	it("R1: pools laps with opposite winds, heading-correlated pace and irregular timing", () => {
		const outcome = sinusoid(
			run([
				lap(
					{
						circuits: 6.5,
						scale: 1.08,
						wind: () => ({ speed: 3, from: 0 }),
						speed: (f) => 10 + 2 * Math.cos(2 * Math.PI * f),
					},
					"Lap 2",
				),
				lap(
					{
						circuits: 6.5,
						scale: 1.08,
						wind: () => ({ speed: 3, from: 180 }),
						speed: (f) => 9 + 3 * Math.sin(2 * Math.PI * f),
						dt: (i) => (i % 3 === 0 ? 2 : 1),
					},
					"Lap 4",
				),
			]),
		);
		expect(outcome.percent).toBeCloseTo(8, 6);
		expect(kinds(outcome)).not.toContain("segmentSpread");
		expect(outcome.perSegment[0].windDirDeg).toBeCloseTo(0, 3);
		expect(outcome.perSegment[1].windDirDeg).toBeCloseTo(180, 3);
	});

	it("R5: recovers the scale only once a 2 s air-speed lag is aligned", () => {
		const raw = lap({
			circuits: 8,
			scale: 1.08,
			delaySamples: 2,
			speed: (f) => 10 + 3 * Math.cos(2 * Math.PI * f),
			wind: () => ({ speed: 3, from: 90 }),
		});
		const unaligned = sinusoid(run([raw]));
		const aligned = sinusoid(
			run([
				{ ...raw, airSpeed: applyAirSpeedOffset(Array.from(raw.airSpeed), 2) },
			]),
		);
		expect(aligned.percent).toBeCloseTo(8, 6);
		expect(Math.abs(unaligned.percent - 8)).toBeGreaterThan(0.1);
	});

	it("warns gusty for the segment it measured, on the applied model", () => {
		const outcome = sinusoid(
			run([
				lap(
					{
						circuits: 6.5,
						scale: 1.08,
						gust: (i) => 1.2 * Math.sin((2 * Math.PI * i) / 40),
					},
					"Lap 3",
				),
			]),
		);
		expect(outcome.warnings).toContainEqual(
			expect.objectContaining({ kind: "gusty", label: "Lap 3" }),
		);
	});

	it("reports stability unavailable for a pooled single-circuit lap, not for the well-sampled one", () => {
		const outcome = sinusoid(
			run([
				lap({ circuits: 6.5, scale: 1.08 }, "Lap 2"),
				lap({ circuits: 1.2, scale: 1.08 }, "Lap 3"),
			]),
		);
		expect(outcome.warnings).toContainEqual({
			kind: "stationarityUnavailable",
			label: "Lap 3",
		});
		expect(outcome.warnings).not.toContainEqual(
			expect.objectContaining({
				kind: "stationarityUnavailable",
				label: "Lap 2",
			}),
		);
	});

	it("R4: warns when the wind reverses within a lap", () => {
		const outcome = sinusoid(
			run([
				lap({
					circuits: 8.5,
					wind: (i) => ({ speed: 2, from: i < 192 ? 0 : 180 }),
				}),
			]),
		);
		expect(kinds(outcome)).toContain("windChanged");
	});

	it("warns on a short selection", () => {
		expect(kinds(run([lap({ circuits: 4.5, scale: 1.08 })]))).toContain(
			"fewCircuits",
		);
	});

	it("lists each lap and warns when laps disagree", () => {
		const outcome = sinusoid(
			run([
				lap({ circuits: 6.5, scale: 1.04 }, "Lap 1"),
				lap({ circuits: 6.5, scale: 1.12 }, "Lap 2"),
			]),
		);
		expect(outcome.perSegment.map((s) => s.percent)).toEqual([
			expect.closeTo(4, 6),
			expect.closeTo(12, 6),
		]);
		expect(outcome.warnings).toContainEqual({
			kind: "segmentSpread",
			spreadPercent: expect.closeTo(8, 6),
		});
	});

	it("keeps pooling when one lap has no complete circuit, and says so in its row", () => {
		const outcome = sinusoid(
			run([
				lap({ circuits: 6.5, scale: 1.08 }, "Lap 2"),
				lap({ circuits: 0.5 }, "Lap 3"),
			]),
		);
		expect(outcome.percent).toBeCloseTo(8, 6);
		expect(outcome.perSegment[1]).toEqual({
			label: "Lap 3",
			percent: null,
			circuits: 0,
			refusal: "noWholeCircuit",
		});
	});

	it("clamps to the control's range and says so", () => {
		const outcome = sinusoid(run([lap({ circuits: 6.5, scale: 1.3 })]));
		expect(outcome.percent).toBe(20);
		expect(outcome.warnings).toContainEqual({
			kind: "clamped",
			unclampedPercent: expect.closeTo(30, 6),
		});
	});
});

describe("calibrationEligibility", () => {
	const probeAndRun = (input: AutoCalibrationInput) => ({
		probe: calibrationEligibility(input),
		outcome: calculateAutoAirSpeedCalibration(input),
	});

	it("reports the circuit count the full run reaches", () => {
		const { probe, outcome } = probeAndRun({
			measuredAirSpeed: true,
			headingSegments: [lap({ circuits: 3 })],
			vdSegments: [],
		});
		if (outcome.method !== "sinusoid")
			throw new Error("expected a heading fit");
		expect(probe).toEqual({ method: "sinusoid", circuits: outcome.circuits });
	});

	it("names the same refusal the report would show, without a channel", () => {
		const { probe, outcome } = probeAndRun({
			measuredAirSpeed: false,
			headingSegments: [lap({ circuits: 3 })],
			vdSegments: [],
		});
		expect(probe).toEqual({ method: "vdRatio", reason: "noMeasuredAirSpeed" });
		expect(outcome.method).not.toBe("sinusoid");
	});

	it("names the geometry refusal on an open arc", () => {
		const { probe } = probeAndRun({
			measuredAirSpeed: true,
			headingSegments: [lap({ circuits: 0.5 })],
			vdSegments: [],
		});
		expect(probe).toEqual({ method: "vdRatio", reason: "noWholeCircuit" });
	});
});

describe("calibrationSeries", () => {
	it("leaves the fit's residuals orthogonal to its basis (least squares)", () => {
		// A true scale away from 1 is load-bearing: a wrong speed term such as
		// `v * scale` in place of `v / scale` is numerically invisible at
		// scale === 1, which is the fixture default (see the vacuity check in
		// the task report).
		const segment = lap({ circuits: 3, scale: 1.08 });
		const outcome = sinusoid(run([segment]));
		expect(Math.abs(outcome.scale - 1)).toBeGreaterThan(0.01);
		const row = outcome.perSegment[0];
		if (!row.coefficients)
			throw new Error("expected coefficients on a fitted lap");
		const series = calibrationSeries(segment, row.coefficients, outcome.scale);

		expect(series.residual.length).toBeGreaterThan(50);
		// Every emitted sample is one the fit actually used.
		expect(series.headingDeg.every((h) => h >= 0 && h <= 360)).toBe(true);
		expect(series.residual.every(Number.isFinite)).toBe(true);

		// Least squares leaves the residual orthogonal to every column of its
		// design matrix (velocity, cos heading, sin heading). A wrong speed
		// term breaks the velocity orthogonality specifically, without needing
		// a second, independent fit to compare against.
		const n = series.residual.length;
		let dotVelocity = 0;
		let dotCos = 0;
		let dotSin = 0;
		for (let i = 0; i < n; i++) {
			const radians = series.headingDeg[i] * (Math.PI / 180);
			dotVelocity += series.residual[i] * series.velocity[i];
			dotCos += series.residual[i] * Math.cos(radians);
			dotSin += series.residual[i] * Math.sin(radians);
		}
		expect(dotVelocity / n).toBeCloseTo(0, 9);
		expect(dotCos / n).toBeCloseTo(0, 9);
		expect(dotSin / n).toBeCloseTo(0, 9);
	});

	it("emits only the samples inside the counted circuit window", () => {
		const segment = lap({ circuits: 1.6 });
		const outcome = sinusoid(run([segment]));
		const row = outcome.perSegment[0];
		if (!row.coefficients) throw new Error("expected coefficients");

		const series = calibrationSeries(segment, row.coefficients, outcome.scale);
		// A 1.6-turn run counts one circuit, so the trailing 0.6 turn is outside
		// the window and must not be plotted.
		expect(series.headingDeg.length).toBeLessThan(segment.timestamps.length);
	});
});
