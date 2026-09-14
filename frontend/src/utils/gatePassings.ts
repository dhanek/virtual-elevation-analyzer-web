/**
 * Gate passings — the part both GPS detectors share: smoothed bearings, the
 * samples near a gate, and those samples grouped into one passing per visit.
 * `GpsLapDetector` and `OutAndBackDetector` differ only in how they pair the
 * passings this module produces.
 */

import { calculateDistance } from "./GeoCalculations";

const FULL_CIRCLE_DEGREES = 360;
const HALF_CIRCLE_DEGREES = 180;
const MIN_VALID_LATITUDE = -90;
const MAX_VALID_LATITUDE = 90;
const MIN_VALID_LONGITUDE = -180;
const MAX_VALID_LONGITUDE = 180;
const PASSING_CLUSTER_GAP_POINTS = 5;

/**
 * An approach and a departure further apart than this, within one visit to the
 * gate, mean the rider turned around inside the gate radius.
 */
const TURNAROUND_ANGLE_DEGREES = 90;

export interface PassingPoint {
	index: number; // Index in the data array
	distance: number; // Distance to marker in meters
	direction: number; // Smoothed bearing at this point (0-360)
	timestamp: number; // Unix timestamp
	lat: number; // GPS latitude
	lon: number; // GPS longitude
}

/**
 * An inclusive index range detection may use. Detection runs inside each
 * window on its own, so nothing it builds can span the gap between two.
 */
export interface IndexWindow {
	startIdx: number;
	endIdx: number;
}

export interface TrackArrays {
	positionLat: number[];
	positionLon: number[];
	timestamps: number[];
}

export function circularAngleDifference(
	angle1: number,
	angle2: number,
): number {
	const diff = Math.abs(angle1 - angle2);
	return Math.min(diff, FULL_CIRCLE_DEGREES - diff);
}

export function bearingToCompassDirection(bearing: number): string {
	const directions = ["N", "NE", "E", "SE", "S", "SW", "W", "NW"];
	const index = Math.round(bearing / 45) % 8;
	return directions[index];
}

/** Bearing between two GPS points, degrees 0-360 with 0 = North. */
function calculateBearing(
	lat1: number,
	lon1: number,
	lat2: number,
	lon2: number,
): number {
	const lat1Rad = (lat1 * Math.PI) / HALF_CIRCLE_DEGREES;
	const lat2Rad = (lat2 * Math.PI) / HALF_CIRCLE_DEGREES;
	const lon1Rad = (lon1 * Math.PI) / HALF_CIRCLE_DEGREES;
	const lon2Rad = (lon2 * Math.PI) / HALF_CIRCLE_DEGREES;

	const y = Math.sin(lon2Rad - lon1Rad) * Math.cos(lat2Rad);
	const x =
		Math.cos(lat1Rad) * Math.sin(lat2Rad) -
		Math.sin(lat1Rad) * Math.cos(lat2Rad) * Math.cos(lon2Rad - lon1Rad);

	const bearing = (Math.atan2(y, x) * HALF_CIRCLE_DEGREES) / Math.PI;
	return (bearing + FULL_CIRCLE_DEGREES) % FULL_CIRCLE_DEGREES;
}

/**
 * Smoothed bearings for the entire track using a window, which reduces noise
 * in GPS bearing data.
 */
export function calculateSmoothedBearings(
	track: TrackArrays,
	windowSize: number,
): number[] {
	const { positionLat, positionLon } = track;
	const bearings: number[] = [];
	const len = positionLat.length;

	for (let i = 0; i < len; i++) {
		let bearing: number;

		if (i < windowSize) {
			// First points: use forward-looking window
			if (i + windowSize < len) {
				bearing = calculateBearing(
					positionLat[i],
					positionLon[i],
					positionLat[i + windowSize],
					positionLon[i + windowSize],
				);
			} else if (i + 1 < len) {
				bearing = calculateBearing(
					positionLat[i],
					positionLon[i],
					positionLat[i + 1],
					positionLon[i + 1],
				);
			} else {
				bearing = bearings.length > 0 ? bearings[bearings.length - 1] : 0;
			}
		} else if (i >= len - windowSize) {
			// Last points: use backward-looking window
			bearing = calculateBearing(
				positionLat[i - windowSize],
				positionLon[i - windowSize],
				positionLat[i],
				positionLon[i],
			);
		} else {
			// Middle points: use centered window
			const halfWindow = Math.floor(windowSize / 2);
			bearing = calculateBearing(
				positionLat[i - halfWindow],
				positionLon[i - halfWindow],
				positionLat[i + halfWindow],
				positionLon[i + halfWindow],
			);
		}

		bearings.push(bearing);
	}

	return bearings;
}

function isValidCoordinate(lat: number, lon: number): boolean {
	if (isNaN(lat) || isNaN(lon)) return false;
	if (lat === 0 && lon === 0) return false;
	if (lat < MIN_VALID_LATITUDE || lat > MAX_VALID_LATITUDE) return false;
	if (lon < MIN_VALID_LONGITUDE || lon > MAX_VALID_LONGITUDE) return false;
	return true;
}

/** Every sample of one window within `proximityThreshold` metres of a gate. */
function findSamplesNearGate(
	track: TrackArrays,
	bearings: number[],
	markerLat: number,
	markerLon: number,
	window: IndexWindow,
	proximityThreshold: number,
): PassingPoint[] {
	const samples: PassingPoint[] = [];
	const last = Math.min(window.endIdx, track.positionLat.length - 1);

	for (let i = Math.max(0, window.startIdx); i <= last; i++) {
		const lat = track.positionLat[i];
		const lon = track.positionLon[i];
		if (!isValidCoordinate(lat, lon)) continue;

		const dist = calculateDistance(markerLat, markerLon, lat, lon);
		if (dist < proximityThreshold) {
			samples.push({
				index: i,
				distance: dist,
				direction: bearings[i] || 0,
				timestamp: track.timestamps[i],
				lat,
				lon,
			});
		}
	}

	return samples;
}

/**
 * One visit to the gate, reduced to its closest sample.
 *
 * A visit whose approach and departure point opposite ways is a U-turn inside
 * the gate radius — the natural place to put an out-and-back turnaround gate.
 * It yields TWO passings at the closest sample, arriving and leaving, so the
 * outbound leg ends and the inbound leg begins at the turn. Collapsed into one,
 * its bearing was whatever the rider pointed at mid-turn, and the detector went
 * looking for a second, reversed passing that never came.
 */
function visitToPassings(visit: PassingPoint[]): PassingPoint[] {
	const closest = visit.reduce((min, p) =>
		p.distance < min.distance ? p : min,
	);
	const arriving = visit[0].direction;
	const leaving = visit[visit.length - 1].direction;

	if (circularAngleDifference(arriving, leaving) > TURNAROUND_ANGLE_DEGREES) {
		return [
			{ ...closest, direction: arriving },
			{ ...closest, direction: leaving },
		];
	}
	return [closest];
}

/**
 * The passings of one gate within one window, in track order. Samples no more
 * than PASSING_CLUSTER_GAP_POINTS apart belong to the same visit.
 */
export function findGatePassings(
	track: TrackArrays,
	bearings: number[],
	markerLat: number,
	markerLon: number,
	window: IndexWindow,
	proximityThreshold: number,
): PassingPoint[] {
	const samples = findSamplesNearGate(
		track,
		bearings,
		markerLat,
		markerLon,
		window,
		proximityThreshold,
	);

	const passings: PassingPoint[] = [];
	let visit: PassingPoint[] = [];
	for (const sample of samples) {
		if (
			visit.length > 0 &&
			sample.index - visit[visit.length - 1].index > PASSING_CLUSTER_GAP_POINTS
		) {
			passings.push(...visitToPassings(visit));
			visit = [];
		}
		visit.push(sample);
	}
	if (visit.length > 0) passings.push(...visitToPassings(visit));

	return passings;
}
