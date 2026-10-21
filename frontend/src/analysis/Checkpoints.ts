/**
 * Course checkpoints: a few user-picked points on the course, located on every
 * lap by its passing, and VE − reference read there.
 *
 * WHY. One fit per lap hides where the error builds up. On a short hill loop
 * VE can drift a metre above the reference on one climb and recover at the
 * next valley without moving the lap RMSE; read at the hilltops and valleys it
 * shows, and the same checkpoint compared across laps cancels the shared
 * reference error and leaves drift and position changes.
 *
 * A CHECKPOINT IS A PLACE, defined by one sample of the ride: its position and
 * the direction the rider was going there. It is stored as that sample's FIT
 * timestamp, per file — not per lap selection like the gates, because a
 * checkpoint does not cut the selection; it marks the course, and the course
 * does not change when another lap is ticked.
 *
 * A LAP PASSES IT like a gate: within `CHECKPOINT_RADIUS_M`, at the closest
 * sample of the visit (`findGatePassings`), and — except on out-and-back legs,
 * which ride the same road both ways — going the same way (within 90°). The
 * first such passing in the lap counts. A lap without one is "not passed",
 * never a number.
 *
 * THE VALUE is read off the caller's residual series — the series the
 * residual plot draws — at the passing sample. Nothing here knows which
 * reference that is, so the table cannot disagree with the plot.
 */
import {
	calculateSmoothedBearings,
	circularAngleDifference,
	findGatePassings,
	type TrackArrays,
} from "../utils/gatePassings";
import { repeatStat, type RepeatStat } from "./RepeatSpread";

export const MAX_CHECKPOINTS = 4;

/** The gate detectors' radius: a passing is within 20 m of the point. */
const CHECKPOINT_RADIUS_M = 20;

/** The gate detectors' bearing smoothing window, in samples. */
const BEARING_WINDOW_SAMPLES = 5;

/** A passing more than this far off the checkpoint's direction is the other way. */
const SAME_DIRECTION_MAX_DEGREES = 90;

export interface CheckpointPoint {
	lat: number;
	lon: number;
	/** Smoothed bearing at the defining sample, degrees 0–360. */
	bearing: number;
	/** The defining sample's index in the full activity. */
	index: number;
}

export interface CheckpointTrack extends TrackArrays {
	/** Smoothed bearings over the whole track (`checkpointBearings`). */
	bearings: number[];
}

const bearingsCache = new WeakMap<number[], number[]>();

/** The smoothed bearings the gate detectors use, memoised per track. */
export function checkpointBearings(track: TrackArrays): number[] {
	const cached = bearingsCache.get(track.positionLat);
	if (cached) return cached;
	const bearings = calculateSmoothedBearings(track, BEARING_WINDOW_SAMPLES);
	bearingsCache.set(track.positionLat, bearings);
	return bearings;
}

function hasPosition(track: TrackArrays, i: number): boolean {
	const lat = track.positionLat[i];
	const lon = track.positionLon[i];
	return (
		Number.isFinite(lat) && Number.isFinite(lon) && !(lat === 0 && lon === 0)
	);
}

/** Index of the sample whose timestamp is closest to `timestamp`. */
export function nearestSampleIndex(
	timestamps: ArrayLike<number>,
	timestamp: number,
): number | null {
	if (timestamps.length === 0 || !Number.isFinite(timestamp)) return null;
	let lo = 0;
	let hi = timestamps.length - 1;
	while (lo < hi) {
		const mid = (lo + hi) >> 1;
		if (timestamps[mid] < timestamp) lo = mid + 1;
		else hi = mid;
	}
	if (
		lo > 0 &&
		Math.abs(timestamps[lo - 1] - timestamp) <=
			Math.abs(timestamps[lo] - timestamp)
	) {
		return lo - 1;
	}
	return lo;
}

/**
 * The checkpoint a stored timestamp defines, or null when that sample has no
 * position (a checkpoint without a place cannot be passed).
 */
export function resolveCheckpoint(
	track: CheckpointTrack,
	timestamp: number,
): CheckpointPoint | null {
	const index = nearestSampleIndex(track.timestamps, timestamp);
	if (index === null || !hasPosition(track, index)) return null;
	return {
		lat: track.positionLat[index],
		lon: track.positionLon[index],
		bearing: track.bearings[index] ?? 0,
		index,
	};
}

/**
 * One row of the table — a lap, or one leg of an out-and-back section — as
 * the plot draws it.
 */
export interface CheckpointRowInput {
	label: string;
	/** Full-activity sample indices of the row, ascending. */
	indices: number[];
	/** The plot's x coordinate of each sample. */
	x: number[];
	/** VE − reference at each sample, as the residual plot draws it. */
	residual: number[];
	/** Count only passings in the checkpoint's own direction. */
	directional: boolean;
}

interface CheckpointHit {
	x: number;
	/** VE − reference; NaN where the plot has no reference at that sample. */
	value: number;
	/** Full-activity index of the passing sample. */
	index: number;
}

export interface CheckpointRow {
	label: string;
	/** One per checkpoint, in checkpoint order; null = not passed. */
	hits: (CheckpointHit | null)[];
}

/** Position of `index` in an ascending index list, or -1. */
function positionOf(indices: number[], index: number): number {
	let lo = 0;
	let hi = indices.length - 1;
	while (lo <= hi) {
		const mid = (lo + hi) >> 1;
		if (indices[mid] === index) return mid;
		if (indices[mid] < index) lo = mid + 1;
		else hi = mid - 1;
	}
	return -1;
}

function locateOne(
	row: CheckpointRowInput,
	checkpoint: CheckpointPoint,
	track: CheckpointTrack,
): CheckpointHit | null {
	if (row.indices.length === 0) return null;
	const passings = findGatePassings(
		track,
		track.bearings,
		checkpoint.lat,
		checkpoint.lon,
		{
			startIdx: row.indices[0],
			endIdx: row.indices[row.indices.length - 1],
		},
		CHECKPOINT_RADIUS_M,
	);
	for (const passing of passings) {
		if (
			row.directional &&
			circularAngleDifference(passing.direction, checkpoint.bearing) >
				SAME_DIRECTION_MAX_DEGREES
		) {
			continue;
		}
		// The window is the row's span; a row with a hole in it (a Standard
		// lap cut by the trim) can still pass the point where it has no sample.
		const j = positionOf(row.indices, passing.index);
		if (j < 0) continue;
		const value = row.residual[j];
		return {
			x: row.x[j],
			value: Number.isFinite(value) ? value : NaN,
			index: passing.index,
		};
	}
	return null;
}

/** Each row's passing of each checkpoint (null = not passed). */
export function locateCheckpoints(
	rows: readonly CheckpointRowInput[],
	checkpoints: readonly (CheckpointPoint | null)[],
	track: CheckpointTrack,
): CheckpointRow[] {
	return rows.map((row): CheckpointRow => ({
		label: row.label,
		hits: checkpoints.map((checkpoint) =>
			checkpoint ? locateOne(row, checkpoint, track) : null,
		),
	}));
}

export interface CheckpointSummary {
	/** Per checkpoint: mean / SD / n over the rows that passed it with a value. */
	checkpoints: RepeatStat[];
	/**
	 * Per neighbouring pair (CPk → CPk+1): each row's change between the two —
	 * the drift built up on that stretch, null when either is missing — and its
	 * mean / SD / n.
	 */
	segments: { deltas: (number | null)[]; stat: RepeatStat }[];
}

function valueOf(hit: CheckpointHit | null): number | null {
	return hit && Number.isFinite(hit.value) ? hit.value : null;
}

export function summarizeCheckpoints(
	rows: readonly CheckpointRow[],
	checkpointCount: number,
): CheckpointSummary {
	const checkpoints: RepeatStat[] = [];
	for (let k = 0; k < checkpointCount; k++) {
		checkpoints.push(
			repeatStat(
				rows
					.map((row) => valueOf(row.hits[k]))
					.filter((v): v is number => v !== null),
			),
		);
	}
	const segments: CheckpointSummary["segments"] = [];
	for (let k = 0; k + 1 < checkpointCount; k++) {
		const deltas = rows.map((row) => {
			const a = valueOf(row.hits[k]);
			const b = valueOf(row.hits[k + 1]);
			return a === null || b === null ? null : b - a;
		});
		segments.push({
			deltas,
			stat: repeatStat(deltas.filter((d): d is number => d !== null)),
		});
	}
	return { checkpoints, segments };
}

/**
 * Where a stacked plot draws checkpoint k: the median x of the rows that
 * passed it (each lap passes a few metres apart), or null when none did.
 */
export function medianMarkerX(
	rows: readonly CheckpointRow[],
	k: number,
): number | null {
	const xs = rows
		.map((row) => row.hits[k]?.x)
		.filter((x): x is number => x !== undefined && Number.isFinite(x))
		.sort((a, b) => a - b);
	if (xs.length === 0) return null;
	const mid = xs.length >> 1;
	return xs.length % 2 === 1 ? xs[mid] : (xs[mid - 1] + xs[mid]) / 2;
}
