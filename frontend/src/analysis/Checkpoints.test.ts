import { describe, expect, it } from "vitest";
import {
	checkpointBearings,
	locateCheckpoints,
	medianMarkerX,
	nearestSampleIndex,
	resolveCheckpoint,
	summarizeCheckpoints,
	type CheckpointRowInput,
	type CheckpointTrack,
} from "./Checkpoints";

const CENTER_LAT = 52.53;
const CENTER_LON = 13.45;
const M_PER_DEG_LAT = 111_194.93;
const M_PER_DEG_LON = M_PER_DEG_LAT * Math.cos((CENTER_LAT * Math.PI) / 180);
const RADIUS_M = 100;
const SAMPLES_PER_LAP = 126; // 5 m/s round a 628 m circle

/** `laps` anticlockwise circles, one sample a second; `reverse` rides them clockwise. */
function circleTrack(laps: number, reverse = false): CheckpointTrack {
	const positionLat: number[] = [];
	const positionLon: number[] = [];
	const timestamps: number[] = [];
	for (let i = 0; i < laps * SAMPLES_PER_LAP; i++) {
		const a = ((reverse ? -1 : 1) * 2 * Math.PI * i) / SAMPLES_PER_LAP;
		positionLat.push(CENTER_LAT + (RADIUS_M * Math.sin(a)) / M_PER_DEG_LAT);
		positionLon.push(CENTER_LON + (RADIUS_M * Math.cos(a)) / M_PER_DEG_LON);
		timestamps.push(1000 + i);
	}
	const track = { positionLat, positionLon, timestamps };
	return { ...track, bearings: checkpointBearings(track) };
}

function lapRows(_track: CheckpointTrack, laps: number): CheckpointRowInput[] {
	return Array.from({ length: laps }, (_, lap) => {
		const indices = Array.from(
			{ length: SAMPLES_PER_LAP },
			(_, j) => lap * SAMPLES_PER_LAP + j,
		);
		return {
			label: `Lap ${lap + 1}`,
			indices,
			x: indices.map((_, j) => j * 0.005),
			// A residual that drifts by lap and by position, so every hit is distinct.
			residual: indices.map((_, j) => lap + j / 100),
			directional: true,
		};
	});
}

describe("nearestSampleIndex", () => {
	it("finds the closest timestamp, ties to the earlier sample", () => {
		const ts = [10, 11, 13, 20];
		expect(nearestSampleIndex(ts, 9)).toBe(0);
		expect(nearestSampleIndex(ts, 12)).toBe(1);
		expect(nearestSampleIndex(ts, 12.6)).toBe(2);
		expect(nearestSampleIndex(ts, 99)).toBe(3);
		expect(nearestSampleIndex([], 1)).toBeNull();
	});
});

describe("locateCheckpoints", () => {
	it("finds each lap's passing and reads the residual there", () => {
		const track = circleTrack(3);
		const cp = resolveCheckpoint(track, 1000 + 40)!; // lap 1, sample 40
		const rows = locateCheckpoints(lapRows(track, 3), [cp], track);
		expect(rows.map((r) => r.hits[0]?.index)).toEqual([40, 166, 292]);
		expect(rows[1].hits[0]!.value).toBeCloseTo(1 + 40 / 100, 12);
		expect(rows[2].hits[0]!.x).toBeCloseTo(40 * 0.005, 12);
	});

	it("does not count a passing the other way on a directional row", () => {
		const forward = circleTrack(1);
		const cp = resolveCheckpoint(forward, 1000 + 40)!;
		const backward = circleTrack(1, true);
		const rows = lapRows(backward, 1);
		expect(locateCheckpoints(rows, [cp], backward)[0].hits[0]).toBeNull();

		// An out-and-back leg rides the road both ways: no direction test.
		rows[0].directional = false;
		expect(locateCheckpoints(rows, [cp], backward)[0].hits[0]).not.toBeNull();
	});

	it("reports a lap that never comes near as not passed", () => {
		const track = circleTrack(2);
		const cp = resolveCheckpoint(track, 1000 + 40)!;
		const rows = lapRows(track, 2);
		// Lap 2 cut to its first 10 s: it never reaches sample 40's place.
		rows[1].indices = rows[1].indices.slice(0, 10);
		const located = locateCheckpoints(rows, [cp, null], track);
		expect(located[0].hits[0]).not.toBeNull();
		expect(located[1].hits[0]).toBeNull();
		expect(located[0].hits[1]).toBeNull();
	});

	it("keeps a passing with no reference as NaN, not a number", () => {
		const track = circleTrack(1);
		const cp = resolveCheckpoint(track, 1000 + 40)!;
		const rows = lapRows(track, 1);
		rows[0].residual = rows[0].residual.map(() => NaN);
		const hit = locateCheckpoints(rows, [cp], track)[0].hits[0]!;
		expect(Number.isNaN(hit.value)).toBe(true);
	});
});

describe("summarizeCheckpoints", () => {
	it("gives mean / SD / n per checkpoint and the change between neighbours", () => {
		const track = circleTrack(3);
		const cps = [40, 90].map((j) => resolveCheckpoint(track, 1000 + j));
		const rows = locateCheckpoints(lapRows(track, 3), cps, track);
		const summary = summarizeCheckpoints(rows, 2);
		expect(summary.checkpoints[0].mean).toBeCloseTo(1.4, 12);
		expect(summary.checkpoints[0].sd).toBeCloseTo(1, 12);
		expect(summary.checkpoints[0].n).toBe(3);
		expect(summary.segments).toHaveLength(1);
		for (const delta of summary.segments[0].deltas) {
			expect(delta).toBeCloseTo(0.5, 12);
		}
		expect(summary.segments[0].stat.sd).toBeCloseTo(0, 12);
	});

	it("leaves a missing checkpoint out of the stats and its segment null", () => {
		const track = circleTrack(2);
		const cps = [40, 90].map((j) => resolveCheckpoint(track, 1000 + j));
		const rows = lapRows(track, 2);
		rows[1].indices = rows[1].indices.slice(0, 60);
		const located = locateCheckpoints(rows, cps, track);
		const summary = summarizeCheckpoints(located, 2);
		expect(summary.checkpoints[1].n).toBe(1);
		expect(summary.checkpoints[1].sd).toBeNull();
		expect(summary.segments[0].deltas[1]).toBeNull();
	});
});

describe("medianMarkerX", () => {
	it("is the median of the laps that passed", () => {
		const rows = [0.1, 0.4, 0.2].map((x, i) => ({
			label: `${i}`,
			hits: [{ x, value: 0, index: i }, null],
		}));
		expect(medianMarkerX(rows, 0)).toBeCloseTo(0.2, 12);
		expect(medianMarkerX(rows, 1)).toBeNull();
	});
});
