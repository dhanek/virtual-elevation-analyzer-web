import type { HeadingCalibrationSegment } from "./AirSpeedCalibration";

/** Structural subset of `ModeSegment`: full-activity range, optional segment-local trim. */
export interface CalibrationSourceSegment {
	label: string;
	range: { startIdx: number; endIdx: number };
	trim?: { start: number; end: number };
}

export interface CalibrationSourceArrays {
	timestamps: ArrayLike<number>;
	velocity: ArrayLike<number>;
	positionLat: ArrayLike<number>;
	positionLong: ArrayLike<number>;
}

/**
 * One calibration segment per update segment, cut from FULL-activity arrays by
 * the segment's own range and trim. Review R2: no segment ever spans two laps,
 * so no bearing, circuit or smoothing window can bridge an unselected stretch.
 */
export function buildHeadingCalibrationSegments(
	segments: CalibrationSourceSegment[],
	arrays: CalibrationSourceArrays,
	alignedAirSpeed: ArrayLike<number>,
): HeadingCalibrationSegment[] {
	return segments.map((segment): HeadingCalibrationSegment => {
		const start = segment.range.startIdx + (segment.trim?.start ?? 0);
		const end = segment.trim
			? segment.range.startIdx + segment.trim.end
			: segment.range.endIdx;
		const cut = (values: ArrayLike<number>) =>
			Array.prototype.slice.call(values, start, end + 1) as number[];
		return {
			label: segment.label,
			timestamps: cut(arrays.timestamps),
			velocity: cut(arrays.velocity),
			airSpeed: cut(alignedAirSpeed),
			positionLat: cut(arrays.positionLat),
			positionLong: cut(arrays.positionLong),
		};
	});
}
