/**
 * The closure target's leg wiring, driven through the REAL `prepareSegments`.
 *
 * Only the WASM-backed calculator is mocked — a node test cannot instantiate
 * it — so `resolveClosureTarget` and the segment loop that feeds it are the
 * genuine ones. That is what makes this a guard rather than a mirror: delete
 * the `legDirection` line in `prepareSegments` and these fail.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../analysis/VeCalculatorFactory", () => ({
	createVeCalculator: () => ({
		calculate_virtual_elevation: () => ({}),
		ve_gain: () => 0,
		ve_gain_grid: () => new Float64Array(0),
	}),
}));

import type { ModeSegment } from "../../modes/analysis/types";
import type { AnalysisParameters } from "../../components/AnalysisParameters";
import { prepareSegments, type ClosureResolution } from "./segmentPreparation";

const SAMPLE_COUNT = 60;
const MANUAL_DIFF_M = 4.2;

/** A steady climb, so the channel-backed targets are unmistakably signed. */
const ALTITUDE = Array.from({ length: SAMPLE_COUNT }, (_, i) => 100 + i * 0.5);

function makeNormalized() {
	const timestamps = Array.from({ length: SAMPLE_COUNT }, (_, i) => i);
	return {
		timestamps,
		power: timestamps.map(() => 200),
		velocity: timestamps.map(() => 10),
		positionLat: timestamps.map((i) => 45 + i * 1e-5),
		positionLong: timestamps.map((i) => -30 + i * 1e-5),
		altitude: [...ALTITUDE],
		distance: timestamps.map((i) => i * 10),
		temperature: timestamps.map(() => 20),
	} as any;
}

function makeParams(): AnalysisParameters {
	return {
		system_mass: 80,
		rho: 1.2,
		eta: 0.98,
		velodrome: false,
		cda: 0.3,
		crr: 0.005,
	} as AnalysisParameters;
}

/** The two legs of one section, over disjoint halves of the activity. */
const OUT_AND_BACK_SEGMENTS: ModeSegment[] = [
	{
		key: "s1-out",
		label: "Section 1 outbound",
		legDirection: "outbound",
		range: { startIdx: 0, endIdx: 29 },
	},
	{
		key: "s1-in",
		label: "Section 1 inbound",
		legDirection: "inbound",
		range: { startIdx: 30, endIdx: 59 },
	},
];

/** The same two windows with no direction, as a lap mode would present them. */
const LAP_SEGMENTS: ModeSegment[] = OUT_AND_BACK_SEGMENTS.map(
	({ legDirection: _legDirection, ...segment }) => segment,
);

function prepare(
	segments: ModeSegment[],
	closure: Partial<ClosureResolution> = {},
) {
	return prepareSegments({
		segments,
		normalized: makeNormalized(),
		altitude: [...ALTITUDE],
		wind: {
			windSpeed: Array.from({ length: SAMPLE_COUNT }, () => 0),
			selectedWindSource: "constant",
		} as any,
		compareWind: null,
		rhoArray: null,
		params: makeParams(),
		cda: 0.3,
		appliedCrr: 0.005,
		closure: {
			source: "manual",
			demAltitude: null,
			baroAltitude: null,
			manualDiffMetres: MANUAL_DIFF_M,
			...closure,
		},
	});
}

beforeEach(() => {
	vi.restoreAllMocks();
});

describe("prepareSegments: the manual closure target across an out-and-back", () => {
	it("gives the two legs of a section equal and opposite targets", () => {
		const prepared = prepare(OUT_AND_BACK_SEGMENTS);

		expect(prepared).toHaveLength(2);
		expect(prepared[0].closureTarget).toBe(MANUAL_DIFF_M);
		expect(prepared[1].closureTarget).toBe(-MANUAL_DIFF_M);
	});

	it("leaves an undirected segment on the typed number, so the lap modes cannot move", () => {
		const prepared = prepare(LAP_SEGMENTS);

		expect(prepared.map((p) => p.closureTarget)).toEqual([
			MANUAL_DIFF_M,
			MANUAL_DIFF_M,
		]);
	});

	it("does not negate a channel-backed target — its own window supplies the sign", () => {
		// Both legs climb here, because this fixture is a monotonic ramp rather
		// than a real retrace. The point is that the leg direction did not
		// touch the number: negating on top of the window would be a second,
		// cancelling sign flip.
		const prepared = prepare(OUT_AND_BACK_SEGMENTS, { source: "dem" });
		const undirected = prepare(LAP_SEGMENTS, { source: "dem" });

		expect(prepared.map((p) => p.closureTarget)).toEqual(
			undirected.map((p) => p.closureTarget),
		);
		expect(prepared[0].closureTarget).toBeGreaterThan(0);
	});
});
