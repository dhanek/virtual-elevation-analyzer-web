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
	hasUsableDistance,
	resolvePlaceholderWindSpeed,
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
		referenceElevation: null,
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

/**
 * The same fixture, but carrying a real per-segment distance channel:
 * `buildRelativeDistanceSeries` zeroes each segment at its own first sample, so
 * every lap here runs 0.00, 0.10, 0.20 ... km regardless of where it sat in the
 * ride. That restart is exactly what the cumulative axis has to undo.
 */
function profileWithDistance(
	key: string,
	startIdx: number,
	endIdx: number,
	metresPerSample = 100,
): SegmentVeProfile {
	const base = profile(key, startIdx, endIdx);
	return {
		...base,
		supplementarySeries: {
			...base.supplementarySeries,
			distancesKm: base.indices.map((_, i) => (i * metresPerSample) / 1000),
		},
	};
}

describe("stitchStandardProfiles: the cumulative distance axis", () => {
	const normalized = {
		timestamps: Array.from({ length: 40 }, (_, i) => i * 2),
		velocity: Array.from({ length: 40 }, (_, i) => i),
	};

	it("carries the running total across lap boundaries instead of restarting", () => {
		// Two ten-sample laps, 100 m apart: each segment's own channel runs
		// 0.0..0.9 km. A bare concatenation would read 0.0..0.9, 0.0..0.9 and the
		// axis would jump backwards at index 10 -- the defect the maintainer's
		// ruling (2026-08-31) is about.
		const stitched = stitchStandardProfiles(
			[profileWithDistance("lap1", 0, 9), profileWithDistance("lap2", 9, 18)],
			normalized,
		);

		expect(stitched.cumulativeDistanceKm).toHaveLength(20);
		expect(stitched.cumulativeDistanceKm[0]).toBeCloseTo(0);
		expect(stitched.cumulativeDistanceKm[9]).toBeCloseTo(0.9);
		// The second lap CONTINUES from where the first ended.
		expect(stitched.cumulativeDistanceKm[10]).toBeCloseTo(0.9);
		expect(stitched.cumulativeDistanceKm[19]).toBeCloseTo(1.8);
	});

	it("never goes backwards, whatever the laps' recorded odometer said", () => {
		// Non-contiguous laps chosen deliberately: the raw FIT odometer for
		// lap3 starts far after lap1's, and picking them in this order is exactly
		// where the recorded channel is non-monotonic.
		const stitched = stitchStandardProfiles(
			[profileWithDistance("lap3", 18, 27), profileWithDistance("lap1", 0, 9)],
			normalized,
		);

		const km = stitched.cumulativeDistanceKm;
		for (let i = 1; i < km.length; i += 1) {
			expect(km[i]).toBeGreaterThanOrEqual(km[i - 1]);
		}
	});

	it("stays the same length as the other series when a segment carries no distance", () => {
		// A short or missing channel must contribute its own EXTENT, not fewer
		// samples -- the same rule the compare leg follows. A shortened array
		// would slide every later sample onto the wrong x position.
		const stitched = stitchStandardProfiles(
			[profile("lap1", 0, 9), profileWithDistance("lap2", 9, 18)],
			normalized,
		);

		expect(stitched.cumulativeDistanceKm).toHaveLength(stitched.length);
		expect(stitched.cumulativeDistanceKm.every(Number.isFinite)).toBe(true);
		// The distance-less segment advanced the total by nothing, so the segment
		// after it starts at zero rather than at an invented offset.
		expect(stitched.cumulativeDistanceKm[10]).toBeCloseTo(0);
	});

	/**
	 * A distance channel SHORTER than the VE series it accompanies.
	 *
	 * The padding rule above ("contributes its own extent, and zero length")
	 * was applied to the samples but not to the running total: the offset
	 * advanced by `segmentKm[segmentKm.length - 1]`, the end of the ARRAY, while
	 * the loop that placed the samples walked `virtualElevation.length`. For a
	 * short channel those are different distances, and the disagreement is
	 * exactly the non-monotonic axis the padding exists to prevent: the padded
	 * tail sits back at the segment's own origin while every later segment is
	 * pushed past it, right where the trim lines are drawn.
	 */
	it("does not advance the total past the samples it actually placed", () => {
		const short = profileWithDistance("lap1", 0, 9);
		// Six of ten samples carry a distance; the VE series keeps all ten.
		short.supplementarySeries.distancesKm =
			short.supplementarySeries.distancesKm.slice(0, 6);

		const stitched = stitchStandardProfiles(
			[short, profileWithDistance("lap2", 9, 18)],
			normalized,
		);

		const km = stitched.cumulativeDistanceKm;
		expect(km).toHaveLength(stitched.length);
		expect(km.every(Number.isFinite)).toBe(true);
		for (let i = 1; i < km.length; i += 1) {
			expect(km[i]).toBeGreaterThanOrEqual(km[i - 1]);
		}
		// The tail holds the last distance the channel actually reported (0.5 km
		// at sample 5) instead of dropping back to the segment's origin, and the
		// next segment continues from there.
		expect(km[5]).toBeCloseTo(0.5);
		expect(km[9]).toBeCloseTo(0.5);
		expect(km[10]).toBeCloseTo(0.5);
	});

	it("reports a usable distance axis only when the selection actually moved", () => {
		expect(
			hasUsableDistance(
				stitchStandardProfiles([profileWithDistance("lap1", 0, 9)], normalized),
			),
		).toBe(true);

		// No distance channel at all: the series is flat at zero, and an axis
		// whose every tick reads 0.00 km is worse than no switch.
		expect(
			hasUsableDistance(
				stitchStandardProfiles([profile("lap1", 0, 9)], normalized),
			),
		).toBe(false);

		expect(
			hasUsableDistance(stitchStandardProfiles([], normalized)),
		).toBe(false);
	});
});

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

describe("resolvePlaceholderWindSpeed", () => {
	// The FIT air-speed channel exactly as recorded: no offset, no calibration.
	const RAW = [10, 11, 12, 13];
	// The same channel after resolveWindSeries -- shifted by the offset and
	// scaled by the calibration. Deliberately unlike RAW at every index.
	const RESOLVED = [20, 21, 22, 23];

	it("hands the placeholder calculator the resolved series under FIT wind", () => {
		// The plots drawn immediately below the placeholder read the resolved
		// series, so a calculator fed the raw one fits a wind the panel never
		// shows. Phase 7 recorded this as unobservable because a synthetic
		// slider `input` replaces the paint at once -- unobservable is not the
		// same as correct, and nothing stops a future caller reading the result.
		expect(resolvePlaceholderWindSpeed("fit", RAW, RESOLVED)).toEqual(RESOLVED);
	});

	it("keeps the NaN fill when the wind is not from the FIT file", () => {
		// Constant wind is derived inside the calculator from the params, so the
		// per-sample channel must stay absent rather than carry a series.
		const filled = resolvePlaceholderWindSpeed("constant", RAW, RESOLVED);

		expect(filled).toHaveLength(RAW.length);
		expect(filled.every((value) => Number.isNaN(value))).toBe(true);
	});

	it("falls back to the raw series when the resolved one is unusable", () => {
		// resolveSelectionWindSeries returns [] with no loaded fitData, and slices
		// to the selection otherwise. A short array under the calculator would be
		// a length bug, which is worse than an un-offset one.
		expect(resolvePlaceholderWindSpeed("fit", RAW, [])).toEqual(RAW);
		expect(resolvePlaceholderWindSpeed("fit", RAW, [20, 21])).toEqual(RAW);
	});
});

describe("stitchStandardProfiles: the reference elevation channel", () => {
	const normalized = {
		timestamps: Array.from({ length: 40 }, (_, i) => i),
		velocity: Array.from({ length: 40 }, () => 10),
	};

	function withReference(
		base: SegmentVeProfile,
		series: number[],
	): SegmentVeProfile {
		return {
			...base,
			referenceElevation: { label: "Barometer", series },
		};
	}

	it("stitches the reference across segments, keeping the label", () => {
		const first = withReference(profile("s1", 0, 2), [50, 51, 52]);
		const second = withReference(profile("s2", 10, 12), [60, 61, 62]);

		const stitched = stitchStandardProfiles([first, second], normalized);

		expect(stitched.referenceElevation).not.toBeNull();
		expect(stitched.referenceElevation!.label).toBe("Barometer");
		expect(stitched.referenceElevation!.series).toEqual([
			50, 51, 52, 60, 61, 62,
		]);
	});

	it("NaN-pads a segment without a reference rather than shortening the axis", () => {
		const first = withReference(profile("s1", 0, 2), [50, 51, 52]);
		const second = profile("s2", 10, 12);

		const stitched = stitchStandardProfiles([first, second], normalized);

		const series = stitched.referenceElevation!.series;
		expect(series).toHaveLength(6);
		expect(series.slice(0, 3)).toEqual([50, 51, 52]);
		expect(series.slice(3).every((value) => Number.isNaN(value))).toBe(true);
	});

	it("stays null when no profile carries one — the phase-1 series exactly", () => {
		const stitched = stitchStandardProfiles(
			[profile("s1", 0, 2), profile("s2", 10, 12)],
			normalized,
		);

		expect(stitched.referenceElevation).toBeNull();
	});
});
