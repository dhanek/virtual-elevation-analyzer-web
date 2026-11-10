/**
 * Air-speed sensor shadowing: something in front of the sensor (hands or
 * forearms on the bars) deflects the flow, so it reads LOW while power and
 * ground speed are unchanged. Neither the scale fit nor the VE/CdA path can
 * tell that from a real drop in air speed, so the samples are found here and
 * masked before either sees them.
 *
 * Detector: for every sliding one-circuit window,
 *
 *     D = Σ v³ / Σ (va² · v)
 *
 * which is CdA(air speed) / CdA(ground speed) for that window — power cancels,
 * and so does the sensor scale k once D is taken relative to the median over
 * the selection. Over a whole circuit the wind's along-track component mostly
 * cancels too, so steady wind keeps D/median within about ±10 % (5–95 % of
 * windows: ±9–12 % on the 8 outdoor-velodrome sessions). The two known shadow
 * events read +46 % and +75 %. A window more than `SHADOW_THRESHOLD` above the
 * median is flagged.
 *
 * Origin and evidence: TODO.md, "Mask air-speed sensor shadowing", and
 * `vw-demo/analysis/shadow_20261014/shadow_scan.py`.
 *
 * Rides with no whole circuit (out-and-back, open road) have no window to
 * compare and are not checked: the result says so rather than claiming clean.
 */
import {
	fitSharedScale,
	headingFromGps,
	slidingCircuitWindows,
} from "./HeadingCalibration";
import {
	buildHeadingCalibrationSegments,
	type CalibrationSourceArrays,
	type CalibrationSourceSegment,
} from "./headingCalibrationSegments";

/** D / median − 1 above which a one-circuit window is shadowed. */
export const SHADOW_THRESHOLD = 0.25;
/** Below this many windows the median is not a reference worth comparing to. */
const MIN_WINDOWS = 20;
/** Same floor as the scale fit (`HEADING_FIT_MIN_VELOCITY`): the sensor is censored below it. */
const MIN_VELOCITY = 5.0;

export interface ShadowSegmentInput {
	label: string;
	timestamps: ArrayLike<number>;
	velocity: ArrayLike<number>;
	/** Offset-aligned air speed. Its scale does not matter: D is relative to the median. */
	airSpeed: ArrayLike<number>;
	positionLat: ArrayLike<number>;
	positionLong: ArrayLike<number>;
}

export interface ShadowEvent {
	/** Which input segment, by position. */
	segment: number;
	label: string;
	/** First and last masked sample, indices into that segment's arrays. */
	startIdx: number;
	endIdx: number;
	/** Recorded seconds the event spans (last − first timestamp). */
	seconds: number;
	/** The largest D / median − 1 among the event's windows. */
	peakExcess: number;
}

export type ShadowDetection =
	| {
			checked: true;
			/** Per input segment; true = shadowed, keep out of the fit. */
			masks: boolean[][];
			events: ShadowEvent[];
			windows: number;
			/** Median D over every window: the selection's own CdA(air) / CdA(ground). */
			median: number;
	  }
	| {
			checked: false;
			reason: "tooFewWindows";
			windows: number;
			masks: boolean[][];
			events: [];
	  };

interface Window {
	segment: number;
	startIdx: number;
	endIdx: number;
	ratio: number;
}

export function detectSensorShadow(
	segments: ShadowSegmentInput[],
): ShadowDetection {
	const masks = segments.map((s) =>
		new Array<boolean>(s.timestamps.length).fill(false),
	);
	const windows: Window[] = [];
	segments.forEach((segment, index) => {
		for (const w of slidingCircuitWindows(segment)) {
			const ratio = windowRatio(segment, w.startIdx, w.endIdx);
			if (ratio !== null) windows.push({ segment: index, ...w, ratio });
		}
	});
	if (windows.length < MIN_WINDOWS) {
		return {
			checked: false,
			reason: "tooFewWindows",
			windows: windows.length,
			masks,
			events: [],
		};
	}

	const median = medianOf(windows.map((w) => w.ratio));
	const excess = new Map<string, number>();
	for (const w of windows) {
		const over = w.ratio / median - 1;
		if (over <= SHADOW_THRESHOLD) continue;
		const mask = masks[w.segment];
		for (let i = w.startIdx; i <= w.endIdx; i++) {
			mask[i] = true;
			const key = `${w.segment}:${i}`;
			excess.set(key, Math.max(excess.get(key) ?? 0, over));
		}
	}

	const events: ShadowEvent[] = [];
	masks.forEach((mask, segment) => {
		const ts = segments[segment].timestamps;
		let i = 0;
		while (i < mask.length) {
			if (!mask[i]) {
				i++;
				continue;
			}
			let j = i;
			let peak = 0;
			while (j < mask.length && mask[j]) {
				peak = Math.max(peak, excess.get(`${segment}:${j}`) ?? 0);
				j++;
			}
			events.push({
				segment,
				label: segments[segment].label,
				startIdx: i,
				endIdx: j - 1,
				seconds: ts[j - 1] - ts[i],
				peakExcess: peak,
			});
			i = j;
		}
	});

	return { checked: true, masks, events, windows: windows.length, median };
}

/** D for one window, or null when any sample in it is not usable. */
function windowRatio(
	segment: ShadowSegmentInput,
	start: number,
	end: number,
): number | null {
	let num = 0;
	let den = 0;
	for (let i = start; i <= end; i++) {
		const v = segment.velocity[i];
		const va = segment.airSpeed[i];
		if (
			!Number.isFinite(v) ||
			!Number.isFinite(va) ||
			v <= MIN_VELOCITY ||
			va <= 0
		)
			return null;
		num += v * v * v;
		den += va * va * v;
	}
	return den > 0 ? num / den : null;
}

function medianOf(values: number[]): number {
	const sorted = [...values].sort((a, b) => a - b);
	const mid = sorted.length >> 1;
	return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

export interface ShadowCorrection {
	/** The input series with every shadowed sample of every segment replaced; a copy, never the input. */
	windSpeed: number[];
	detection: ShadowDetection;
}

const DEG = Math.PI / 180;

/**
 * The VE/CdA half: shadowed samples can NOT simply be dropped, because the VE
 * integral needs every second for closure. Each is replaced by what the
 * sensor would have read unshadowed, from that segment's own heading fit over
 * its UNshadowed samples:
 *
 *     va = v / scale + a·cos θ + b·sin θ
 *
 * — ground speed plus the fitted wind, in the series' own (measured) units, so
 * the calibration percent and the wind height factor downstream treat it like
 * any other sample. When the segment cannot be fitted (too few points, or its
 * headings do not sweep a loop) the fallback is ground speed scaled by the
 * selection's median D, which is the same ratio with the wind left out.
 *
 * `windSpeed` is the FULL-activity series the update path already resolved
 * (offset-aligned, calibrated); segments are cut from it exactly as Auto
 * Adjust cuts them (`buildHeadingCalibrationSegments`).
 */
export function correctSensorShadow(
	segments: CalibrationSourceSegment[],
	arrays: CalibrationSourceArrays,
	windSpeed: ArrayLike<number>,
): ShadowCorrection {
	const cut = buildHeadingCalibrationSegments(segments, arrays, windSpeed);
	const detection = detectSensorShadow(cut);
	const out = Array.from(windSpeed);
	if (!detection.checked || detection.events.length === 0)
		return { windSpeed: out, detection };

	const fallbackRatio = 1 / Math.sqrt(detection.median);
	cut.forEach((segment, index) => {
		const shadow = detection.masks[index];
		if (!shadow.some(Boolean)) return;
		const heading = headingFromGps(
			segment.positionLat,
			segment.positionLong,
			segment.timestamps,
		);
		const mask = Array.from(
			segment.velocity,
			(v, i) =>
				!shadow[i] &&
				Number.isFinite(v) &&
				v > MIN_VELOCITY &&
				Number.isFinite(segment.airSpeed[i]) &&
				segment.airSpeed[i] > 0 &&
				Number.isFinite(heading[i]),
		);
		const fit = fitSharedScale([
			{
				velocity: segment.velocity,
				airSpeed: segment.airSpeed,
				headingDeg: heading,
				mask,
			},
		]);
		const range = segments[index].range;
		const start = range.startIdx + (segments[index].trim?.start ?? 0);
		for (let i = 0; i < shadow.length; i++) {
			if (!shadow[i]) continue;
			const v = segment.velocity[i];
			const theta = heading[i] * DEG;
			out[start + i] =
				fit.ok && Number.isFinite(theta)
					? v / fit.scale +
						fit.coefficients[0].a * Math.cos(theta) +
						fit.coefficients[0].b * Math.sin(theta)
					: v * fallbackRatio;
		}
	});
	return { windSpeed: out, detection };
}
