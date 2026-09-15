import {
	circuitWindows,
	fitSharedScale,
	gustIndex,
	headingFromGps,
	isValidFix,
	windStationarity,
	type CircuitWindows,
	type HeadingFitRefusal,
	type ScaleFitSegment,
	type WindowRefusal,
} from "./HeadingCalibration";

export const DEFAULT_AIR_SPEED_CALIBRATION_PERCENT = 0.0;
export const AIR_SPEED_CALIBRATION_MIN_PERCENT = -20.0;
export const AIR_SPEED_CALIBRATION_MAX_PERCENT = 20.0;
export const AIR_SPEED_CALIBRATION_STEP_PERCENT = 0.1;
const MAX_VALID_VIRTUAL_DISTANCE_DELTA_SECONDS = 10;

export interface AutoCalibrationSegment {
	timestamps: ArrayLike<number>;
	groundSpeed: ArrayLike<number>;
	apparentSpeed: ArrayLike<number>;
	startIndex?: number;
	endIndex?: number;
}

export function clampAirSpeedCalibrationPercent(value: number): number {
	return Math.max(
		AIR_SPEED_CALIBRATION_MIN_PERCENT,
		Math.min(value, AIR_SPEED_CALIBRATION_MAX_PERCENT),
	);
}

export function formatAirSpeedCalibrationPercent(
	value: number | null | undefined,
): string {
	return clampAirSpeedCalibrationPercent(
		value ?? DEFAULT_AIR_SPEED_CALIBRATION_PERCENT,
	).toFixed(1);
}

export function calculateAutoAirSpeedCalibrationPercent(
	segments: AutoCalibrationSegment[],
): number | null {
	let virtualDistanceAir = 0;
	let virtualDistanceGround = 0;

	for (const segment of segments) {
		const timestamps = Array.from(segment.timestamps);
		const groundSpeed = Array.from(segment.groundSpeed);
		const apparentSpeed = Array.from(segment.apparentSpeed);
		const maxIndex =
			Math.min(timestamps.length, groundSpeed.length, apparentSpeed.length) - 1;

		if (maxIndex < 1) {
			continue;
		}

		const startIndex = Math.max(0, Math.min(segment.startIndex ?? 0, maxIndex));
		const endIndex = Math.max(
			startIndex,
			Math.min(segment.endIndex ?? maxIndex, maxIndex),
		);

		for (let index = startIndex + 1; index <= endIndex; index++) {
			const dt = timestamps[index] - timestamps[index - 1];
			if (dt <= 0 || dt >= MAX_VALID_VIRTUAL_DISTANCE_DELTA_SECONDS) {
				continue;
			}

			const airSpeed = apparentSpeed[index];
			if (Number.isFinite(airSpeed) && airSpeed > 0) {
				virtualDistanceAir += airSpeed * dt;
			}

			const speed = groundSpeed[index];
			if (Number.isFinite(speed) && speed > 0) {
				virtualDistanceGround += speed * dt;
			}
		}
	}

	if (virtualDistanceAir <= 0) {
		return null;
	}

	const calibrationMultiplier = virtualDistanceGround / virtualDistanceAir;
	return clampAirSpeedCalibrationPercent((calibrationMultiplier - 1) * 100);
}

/** Notes §16.0: the aerometer emits nothing below ≈2.5 m/s; samples under 5 m/s are censored in these sessions. */
const HEADING_FIT_MIN_VELOCITY = 5.0;
/**
 * Top tercile of the time-aware gust index over the 30 gated velodrome work
 * laps. PROVISIONAL at 0.04 (the r5 sample-count estimator's cut, 0.0407);
 * Task 6c re-derives it with this implementation and replaces this value. A
 * heuristic flag, not an error bar (review R9).
 */
const GUST_INDEX_WARN = 0.04;
/** m/s, as a vector (notes §4, §12.3; review R4). */
const WIND_CHANGE_WARN = 0.5;
/** Notes §3 and §17.2: fewer complete circuits repeat worse. A repeatability hint, not an accuracy bound. */
const MIN_RECOMMENDED_CIRCUITS = 6;
/** Percentage points between segments' own fits (notes §3; k depends on position, §6.3). */
const SEGMENT_SPREAD_WARN_PERCENT = 1.0;

export interface HeadingCalibrationSegment {
	label: string;
	timestamps: ArrayLike<number>;
	velocity: ArrayLike<number>;
	/** Offset-aligned, calibration percent 0 (D6). */
	airSpeed: ArrayLike<number>;
	positionLat: ArrayLike<number>;
	positionLong: ArrayLike<number>;
}

export interface AutoCalibrationInput {
	/** True only for a measured `air_speed` channel (D1). */
	measuredAirSpeed: boolean;
	headingSegments: HeadingCalibrationSegment[];
	/** Exactly the input the distance ratio received before this feature; its numbers must not move. */
	vdSegments: AutoCalibrationSegment[];
}

type CalibrationRefusal =
	| "noMeasuredAirSpeed"
	| "noUsablePositions"
	| WindowRefusal
	| HeadingFitRefusal["reason"];

interface SegmentCalibration {
	label: string;
	/** This segment's own fit, unclamped; null when it could not be fitted. */
	percent: number | null;
	circuits: number;
	/** From the applied joint model. */
	windSpeed?: number;
	windDirDeg?: number;
	refusal?: CalibrationRefusal;
}

type CalibrationWarning =
	| { kind: "gusty"; label: string; gustIndex: number }
	| { kind: "gustUnavailable"; label: string }
	| { kind: "windChanged"; label: string; vectorChange: number }
	| { kind: "stationarityUnavailable"; label: string }
	| { kind: "fewCircuits"; circuits: number }
	| { kind: "segmentSpread"; spreadPercent: number }
	| { kind: "clamped"; unclampedPercent: number };

export type AutoCalibrationOutcome =
	| {
			method: "sinusoid";
			percent: number;
			circuits: number;
			perSegment: SegmentCalibration[];
			warnings: CalibrationWarning[];
	  }
	| { method: "vdRatio"; percent: number; fallback: CalibrationRefusal }
	| { method: "none"; reason: CalibrationRefusal };

interface PreparedSegment {
	label: string;
	timestamps: number[];
	hasUsableFix: boolean;
	windows: CircuitWindows;
	fit: ScaleFitSegment;
}

function prepareSegment(segment: HeadingCalibrationSegment): PreparedSegment {
	const length = Math.min(
		segment.timestamps.length,
		segment.velocity.length,
		segment.airSpeed.length,
		segment.positionLat.length,
		segment.positionLong.length,
	);
	const take = (values: ArrayLike<number>) =>
		Array.prototype.slice.call(values, 0, length) as number[];
	const timestamps = take(segment.timestamps);
	const velocity = take(segment.velocity);
	const airSpeed = take(segment.airSpeed);
	const lat = take(segment.positionLat);
	const lon = take(segment.positionLong);
	const heading = headingFromGps(lat, lon, timestamps);
	const usable = velocity.map(
		(v, i) =>
			Number.isFinite(v) &&
			v > HEADING_FIT_MIN_VELOCITY &&
			Number.isFinite(airSpeed[i]) &&
			airSpeed[i] > 0 &&
			Number.isFinite(heading[i]),
	);
	const windows = circuitWindows({
		timestamps,
		positionLat: lat,
		positionLong: lon,
		usable,
	});
	return {
		label: segment.label,
		timestamps,
		hasUsableFix: lat.some((la, i) => isValidFix(la, lon[i])),
		windows,
		fit: { velocity, airSpeed, headingDeg: heading, mask: windows.mask },
	};
}

export function calculateAutoAirSpeedCalibration(
	input: AutoCalibrationInput,
): AutoCalibrationOutcome {
	const fallback = (reason: CalibrationRefusal): AutoCalibrationOutcome => {
		const percent = calculateAutoAirSpeedCalibrationPercent(input.vdSegments);
		return percent === null
			? { method: "none", reason }
			: { method: "vdRatio", percent, fallback: reason };
	};

	if (!input.measuredAirSpeed) return fallback("noMeasuredAirSpeed");
	const prepared = input.headingSegments.map(prepareSegment);
	if (prepared.every((p) => !p.hasUsableFix))
		return fallback("noUsablePositions");

	const rows: SegmentCalibration[] = [];
	const pool: Array<{ row: SegmentCalibration; segment: PreparedSegment }> = [];
	for (const segment of prepared) {
		const base = {
			label: segment.label,
			percent: null,
			circuits: segment.windows.circuits,
		};
		if (!segment.hasUsableFix) {
			rows.push({ ...base, circuits: 0, refusal: "noUsablePositions" });
			continue;
		}
		if (segment.windows.refusal) {
			rows.push({ ...base, refusal: segment.windows.refusal });
			continue;
		}
		const own = fitSharedScale([segment.fit]);
		if (!own.ok) {
			rows.push({ ...base, refusal: own.reason });
			continue;
		}
		const row: SegmentCalibration = { ...base, percent: (own.scale - 1) * 100 };
		rows.push(row);
		pool.push({ row, segment });
	}

	if (pool.length === 0) {
		return fallback(rows.find((r) => r.refusal)?.refusal ?? "noWholeCircuit");
	}
	const joint = fitSharedScale(pool.map((p) => p.segment.fit));
	if (!joint.ok) return fallback(joint.reason);

	const warnings: CalibrationWarning[] = [];
	let circuits = 0;
	pool.forEach(({ row, segment }, l) => {
		row.windSpeed = joint.winds[l].windSpeed;
		row.windDirDeg = joint.winds[l].windDirDeg;
		circuits += segment.windows.circuits;

		const gust = gustIndex(
			joint.residuals[l],
			segment.fit.airSpeed,
			segment.timestamps,
		);
		if (!gust.available)
			warnings.push({ kind: "gustUnavailable", label: row.label });
		else if (gust.value > GUST_INDEX_WARN)
			warnings.push({ kind: "gusty", label: row.label, gustIndex: gust.value });

		const stability = windStationarity(segment.fit, segment.timestamps);
		if (!stability.available) {
			if (segment.windows.circuits >= 2)
				warnings.push({ kind: "stationarityUnavailable", label: row.label });
		} else if (stability.vectorChange > WIND_CHANGE_WARN) {
			warnings.push({
				kind: "windChanged",
				label: row.label,
				vectorChange: stability.vectorChange,
			});
		}
	});

	if (circuits < MIN_RECOMMENDED_CIRCUITS)
		warnings.push({ kind: "fewCircuits", circuits });
	const fitted = pool.map((p) => p.row.percent as number);
	if (fitted.length >= 2) {
		const spreadPercent = Math.max(...fitted) - Math.min(...fitted);
		if (spreadPercent > SEGMENT_SPREAD_WARN_PERCENT)
			warnings.push({ kind: "segmentSpread", spreadPercent });
	}
	const unclampedPercent = (joint.scale - 1) * 100;
	const percent = clampAirSpeedCalibrationPercent(unclampedPercent);
	if (percent !== unclampedPercent)
		warnings.push({ kind: "clamped", unclampedPercent });

	return { method: "sinusoid", percent, circuits, perSegment: rows, warnings };
}
