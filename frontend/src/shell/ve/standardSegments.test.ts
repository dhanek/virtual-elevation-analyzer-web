/**
 * Guards for the three-index-space reconciliation D-19 Option B forces on
 * Standard. See `standardSegments.ts` for the spaces themselves.
 *
 * These are not call-shape tests: they drive the real functions with real
 * numbers, because the failure mode being guarded is arithmetic (an off-by-one
 * per lap boundary), not a missing call.
 */
import { describe, expect, it } from "vitest";
import type { ModeSegment, SegmentVeProfile } from "../../modes/analysis/types";
import {
	MIN_TRIMMED_SEGMENT_SAMPLES,
	mapTrimToSegments,
	stitchStandardProfiles,
} from "./standardSegments";

function segment(key: string, startIdx: number, endIdx: number): ModeSegment {
	return { key, label: key, range: { startIdx, endIdx } };
}

/**
 * Three ten-sample laps that SHARE their boundary records, exactly as real lap
 * time ranges do: 0..9, 9..18, 18..27. The deduplicated selection is 28 samples
 * long; the segment lengths sum to 30. That two-sample difference is the whole
 * reason `mapTrimToSegments` refuses to do arithmetic in the selection space.
 */
const SHARED_BOUNDARY_SEGMENTS = [
	segment("lap1", 0, 9),
	segment("lap2", 9, 18),
	segment("lap3", 18, 27),
];
const SELECTED_INDICES = Array.from({ length: 28 }, (_, i) => i);

describe("mapTrimToSegments", () => {
	it("maps a full-width window onto every segment's own extent", () => {
		const mapped = mapTrimToSegments(
			SHARED_BOUNDARY_SEGMENTS,
			SELECTED_INDICES,
			0,
			SELECTED_INDICES.length - 1,
		);

		expect(mapped).toHaveLength(3);
		expect(mapped.map(s => s.trim)).toEqual([
			{ start: 0, end: 9 },
			{ start: 0, end: 9 },
			{ start: 0, end: 9 },
		]);
	});

	it("does NOT drift across shared lap boundaries", () => {
		// Selection slot 20 is full-activity index 20, which lives in lap 3
		// (18..27) at local offset 2. Subtracting cumulative SEGMENT lengths
		// instead would place it at 20 - 20 = 0, one lap too early by two
		// samples -- the exact off-by-one this routing exists to prevent.
		const mapped = mapTrimToSegments(SHARED_BOUNDARY_SEGMENTS, SELECTED_INDICES, 20, 27);

		expect(mapped).toHaveLength(1);
		expect(mapped[0].key).toBe("lap3");
		expect(mapped[0].trim).toEqual({ start: 2, end: 9 });
	});

	it("clips a window that starts mid-lap and ends mid-lap", () => {
		const mapped = mapTrimToSegments(SHARED_BOUNDARY_SEGMENTS, SELECTED_INDICES, 5, 22);

		expect(mapped.map(s => s.key)).toEqual(["lap1", "lap2", "lap3"]);
		expect(mapped.map(s => s.trim)).toEqual([
			{ start: 5, end: 9 },
			{ start: 0, end: 9 },
			{ start: 0, end: 4 },
		]);
	});

	it("EXCLUDES a lap the window covers too thinly instead of letting it score zeros", () => {
		// Window 0..10 leaves lap 2 with local samples 0..1 -- two samples, one
		// short of `calculate_metrics`'s min_len of 3, which would return r2 = 0
		// and rmse = 0 and drag the mean of the per-lap fits toward zero.
		expect(MIN_TRIMMED_SEGMENT_SAMPLES).toBe(3);

		const mapped = mapTrimToSegments(SHARED_BOUNDARY_SEGMENTS, SELECTED_INDICES, 0, 10);

		expect(mapped.map(s => s.key)).toEqual(["lap1"]);
		expect(mapped.map(s => s.trim)).toEqual([{ start: 0, end: 9 }]);
	});

	it("drops every segment outside the window and keeps none by accident", () => {
		const mapped = mapTrimToSegments(SHARED_BOUNDARY_SEGMENTS, SELECTED_INDICES, 0, 4);
		expect(mapped.map(s => s.key)).toEqual(["lap1"]);
	});

	it("leaves segments untrimmed when there is no usable index mapping", () => {
		const mapped = mapTrimToSegments(SHARED_BOUNDARY_SEGMENTS, [], 3, 7);
		expect(mapped).toHaveLength(3);
		expect(mapped.every(s => s.trim === undefined)).toBe(true);
	});

	it("tolerates reversed or out-of-range slider values", () => {
		const reversed = mapTrimToSegments(SHARED_BOUNDARY_SEGMENTS, SELECTED_INDICES, 27, 0);
		const clamped = mapTrimToSegments(SHARED_BOUNDARY_SEGMENTS, SELECTED_INDICES, -5, 9999);

		expect(reversed.map(s => s.trim)).toEqual(clamped.map(s => s.trim));
		expect(clamped).toHaveLength(3);
	});
});

function profile(
	key: string,
	startIdx: number,
	endIdx: number,
	trim?: { start: number; end: number },
): SegmentVeProfile {
	const indices = Array.from(
		{ length: endIdx - startIdx + 1 },
		(_, i) => startIdx + i,
	);
	return {
		segment: { key, label: key, range: { startIdx, endIdx }, trim },
		indices,
		distancesKm: indices.map((_, i) => i / 1000),
		timeIndices: indices.map((_, i) => i),
		virtualElevation: indices.map(index => index),
		virtualElevationCompare: null,
		resultCompare: null,
		actualElevation: indices.map(() => 100),
		supplementarySeries: {
			distancesKm: [],
			powerWatts: indices.map(() => 200),
			apparentWindSpeedMps: indices.map(() => 9),
			virtualDistanceAirKm: [],
			virtualDistanceGroundKm: [],
		},
		result: {
			virtual_elevation: new Float64Array(indices.length),
			r2: 0.5,
			rmse: 1,
			ve_elevation_diff: 2,
			actual_elevation_diff: 3,
			virtual_distance_air: 0,
			virtual_distance_ground: 0,
			vd_difference_percent: 0,
		},
	};
}

describe("stitchStandardProfiles", () => {
	const normalized = {
		timestamps: Array.from({ length: 40 }, (_, i) => i * 2),
		velocity: Array.from({ length: 40 }, (_, i) => i),
	};

	it("concatenates in order and reports the STITCHED trim boundaries", () => {
		const profiles = [
			profile("lap1", 0, 9, { start: 4, end: 9 }),
			profile("lap2", 9, 18, { start: 0, end: 6 }),
		];

		const stitched = stitchStandardProfiles(profiles, normalized);

		expect(stitched.length).toBe(20);
		// First segment contributes its own local start; the second is offset by
		// the first segment's FULL length, not by its trimmed length.
		expect(stitched.trimStart).toBe(4);
		expect(stitched.trimEnd).toBe(10 + 6);
		expect(stitched.virtualElevation).toHaveLength(20);
		expect(stitched.velocity).toHaveLength(20);
		// The shared boundary record appears twice, once per lap -- the same
		// convention the two GPS modes already follow.
		expect(stitched.timestamps[9]).toBe(18);
		expect(stitched.timestamps[10]).toBe(18);
	});

	it("defaults an untrimmed segment to its whole extent", () => {
		const stitched = stitchStandardProfiles([profile("lap1", 0, 9)], normalized);

		expect(stitched.trimStart).toBe(0);
		expect(stitched.trimEnd).toBe(9);
	});

	it("returns an empty series rather than throwing when nothing survived", () => {
		const stitched = stitchStandardProfiles([], normalized);

		expect(stitched.length).toBe(0);
		expect(stitched.virtualElevation).toEqual([]);
	});
});
