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
 * laps. Re-derived 2026-09-16 (Task 6c) with this implementation: 33rd/67th
 * percentile 0.0256 / 0.0421 (cut used here, rounded); tercile mean
 * |k - session mean| 0.96 / 0.82 / 1.79 pp (low/mid/high), Pearson
 * r = 0.31 against that error — consistent with the r5 estimator's reference
 * (0.79 / 0.81 / 1.81 pp, r = 0.31). A heuristic flag, not an error bar
 * (review R9).
 */
const GUST_INDEX_WARN = 0.042;
/** m/s, as a vector (notes §4, §12.3; review R4). */
const WIND_CHANGE_WARN = 0.5;
/** Notes §3 and §17.2: fewer complete circuits repeat worse. A repeatability hint, not an accuracy bound. */
const MIN_RECOMMENDED_CIRCUITS = 6;
/** Percentage points between segments' own fits (notes §3; k depends on position, §6.3). */
const SEGMENT_SPREAD_WARN_PERCENT = 1.0;
/** `HeadingCalibration.ts` keeps its own copy private; this module needs the same conversion for `calibrationSeries`. */
const DEG = Math.PI / 180;

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
	/**
	 * True for EITHER measured wind channel — a native `air_speed` field, or
	 * `wind_speed`/`wind_yaw` (D1). Set from the RESOLVED `dataSource` of
	 * `resolveWindSeries`, never from a raw FIT field: both channels arrive
	 * here as the same longitudinal, offset-aligned series.
	 */
	measuredAirSpeed: boolean;
	headingSegments: HeadingCalibrationSegment[];
	/** Exactly the input the distance ratio received before this feature; its numbers must not move. */
	vdSegments: AutoCalibrationSegment[];
}

export type CalibrationRefusal =
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
	/**
	 * The joint model's wind coefficients for this lap, in measured air-speed
	 * units. Present exactly when the lap was fitted. `calibrationSeries` needs
	 * these to redraw the model without refitting.
	 */
	coefficients?: { a: number; b: number };
	refusal?: CalibrationRefusal;
}

export type CalibrationWarning =
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
			/**
			 * The joint fit's UNCLAMPED scale (va_true = scale · va_meas).
			 * `percent` may have been clamped for the control; this is what the
			 * model was drawn with, so the plot must use it.
			 */
			scale: number;
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

export interface CalibrationSeries {
	label: string;
	/** Fitted samples only, in sample order. */
	headingDeg: number[];
	/**
	 * Ground speed at each fitted sample, same order and length as the other
	 * series. Not needed by the Task 4 figure builder, but kept here — for the
	 * orthogonality guard below and for future views — rather than making a
	 * caller re-derive it from `windComponent` and `airSpeed`.
	 */
	velocity: number[];
	/** va_meas − v / scale: measured air speed with the speed term removed. */
	windComponent: number[];
	/** a·cos θ + b·sin θ, the fitted wind model at that heading. */
	model: number[];
	/** windComponent − model; equals the fit's own residual for that sample. */
	residual: number[];
}

/**
 * The series the Calibration tab plots, derived from a fit that has already
 * run. NOT a second fit: `coefficients` and `scale` come from the outcome, and
 * everything here is arithmetic on them.
 *
 * It goes through `prepareSegment` rather than cutting the samples itself, so
 * the plotted population is exactly the fitted one — same 5 m/s floor, same
 * circuit window, same heading derivation. A view that re-derived that cut
 * could silently draw a different set of samples than the fit saw.
 */
export function calibrationSeries(
	segment: HeadingCalibrationSegment,
	coefficients: { a: number; b: number },
	scale: number,
): CalibrationSeries {
	const prepared = prepareSegment(segment);
	const { velocity, airSpeed, headingDeg, mask } = prepared.fit;
	const length = Math.min(
		velocity.length,
		airSpeed.length,
		headingDeg.length,
		mask.length,
	);
	const out: CalibrationSeries = {
		label: segment.label,
		headingDeg: [],
		velocity: [],
		windComponent: [],
		model: [],
		residual: [],
	};
	for (let i = 0; i < length; i++) {
		const v = velocity[i];
		const va = airSpeed[i];
		const theta = headingDeg[i];
		if (mask[i] !== true) continue;
		if (!Number.isFinite(v) || !Number.isFinite(va) || !Number.isFinite(theta))
			continue;
		const radians = theta * DEG;
		const windComponent = va - v / scale;
		const model =
			coefficients.a * Math.cos(radians) + coefficients.b * Math.sin(radians);
		out.headingDeg.push(theta);
		out.velocity.push(v);
		out.windComponent.push(windComponent);
		out.model.push(model);
		out.residual.push(windComponent - model);
	}
	return out;
}

export type CalibrationEligibility =
	| { method: "sinusoid"; circuits: number }
	| { method: "vdRatio"; reason: CalibrationRefusal };

/**
 * The GEOMETRY half of the gate, without the fit — cheap enough to run on every
 * selection change so the button can say which method the selection is eligible
 * for before it is clicked.
 *
 * It deliberately cannot promise the heading fit will RUN: `headingCoverage`
 * and `degenerate` are properties of the solve, not of the geometry, so a
 * selection can pass here and still fall back. The caller's wording must say
 * "available", never "will run".
 */
export function calibrationEligibility(
	input: AutoCalibrationInput,
): CalibrationEligibility {
	if (!input.measuredAirSpeed)
		return { method: "vdRatio", reason: "noMeasuredAirSpeed" };
	if (input.headingSegments.length === 0)
		return { method: "vdRatio", reason: "noWholeCircuit" };

	const prepared = input.headingSegments.map(prepareSegment);
	if (prepared.every((p) => !p.hasUsableFix))
		return { method: "vdRatio", reason: "noUsablePositions" };

	let circuits = 0;
	let firstRefusal: CalibrationRefusal | null = null;
	for (const segment of prepared) {
		if (!segment.hasUsableFix) {
			firstRefusal ??= "noUsablePositions";
			continue;
		}
		if (segment.windows.refusal) {
			firstRefusal ??= segment.windows.refusal;
			continue;
		}
		circuits += segment.windows.circuits;
	}
	return circuits > 0
		? { method: "sinusoid", circuits }
		: { method: "vdRatio", reason: firstRefusal ?? "noWholeCircuit" };
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
	// An EMPTY selection satisfies `.every(...)` below vacuously — no segment is
	// usable because there are no segments — which reported "no usable GPS
	// positions" for what is really "nothing was selected" (finding 3). Give it
	// its own honest reason rather than falling into that vacuous truth.
	if (input.headingSegments.length === 0) return fallback("noWholeCircuit");
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
		row.coefficients = joint.coefficients[l];
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

	return {
		method: "sinusoid",
		percent,
		scale: joint.scale,
		circuits,
		perSegment: rows,
		warnings,
	};
}
