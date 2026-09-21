/**
 * Heading-sinusoid air-speed calibration, generalised to several segments:
 *
 *     va_meas(l, i) = c·v(l, i) + a_l·cos θ(l, i) + b_l·sin θ(l, i),   k = 1/c
 *
 * One sensor scale k shared by every segment, one wind vector PER segment
 * (review R1: pooling must not assume the wind was the same on every lap).
 * With one segment this is `fit_heading_wind` (harmonics=1) in
 * `vw-demo/vw/heading_calib.py`, which Task 6a checks to 1e-9.
 *
 * Input contract, and the evidence for each rule:
 * docs/superpowers/plans/2026-09-15-velodrome-auto-calibration.md,
 * "Supported input contract".
 */

const DEG = Math.PI / 180;
const METERS_PER_DEG_LAT = 6_371_000 * DEG;

/** A step longer than this is a gap: no bearing across it, and circuit runs split at it. */
const MAX_SAMPLE_GAP_SECONDS = 3;
const MIN_POINTS = 30;
/** Smallest eigenvalue of the centred (cos θ, sin θ) second moment: ~0.5 on a swept loop, ~0 on a line. */
const MIN_HEADING_COVERAGE = 0.05;
/** Largest |pivot| / smallest |pivot| of the column-scaled normal matrix before the solve is refused. */
const MAX_PIVOT_RATIO = 1e10;

/** Finite, in range, and not the FIT parser's `(0, 0)` missing-position sentinel (`fit_parser.rs:337-338`). */
export function isValidFix(lat: number, lon: number): boolean {
	return (
		Number.isFinite(lat) &&
		Number.isFinite(lon) &&
		Math.abs(lat) <= 90 &&
		Math.abs(lon) <= 180 &&
		!(lat === 0 && lon === 0)
	);
}

function initialBearing(
	lat1: number,
	lon1: number,
	lat2: number,
	lon2: number,
): number {
	if (lat1 === lat2 && lon1 === lon2) return NaN;
	const p1 = lat1 * DEG;
	const p2 = lat2 * DEG;
	const dLon = (lon2 - lon1) * DEG;
	const y = Math.sin(dLon) * Math.cos(p2);
	const x =
		Math.cos(p1) * Math.sin(p2) - Math.sin(p1) * Math.cos(p2) * Math.cos(dLon);
	return Math.atan2(y, x);
}

/**
 * Rider heading, compass degrees. Each valid fix takes the bearing of its step
 * to the next valid fix, or, when that step is a gap or has zero displacement,
 * the bearing of the step into it. Interior points with both neighbours
 * defined are 3-point smoothed on unit vectors. On gap-free data with no
 * repeated fixes this is exactly `heading_from_gps` in the Python reference.
 */
export function headingFromGps(
	lat: ArrayLike<number>,
	lon: ArrayLike<number>,
	timestamps: ArrayLike<number>,
): number[] {
	const n = Math.min(lat.length, lon.length, timestamps.length);
	const bearing = new Array<number>(n).fill(NaN);
	let previous = -1;
	let incoming = NaN;
	for (let i = 0; i < n; i++) {
		if (!isValidFix(lat[i], lon[i]) || !Number.isFinite(timestamps[i]))
			continue;
		if (previous >= 0) {
			const dt = timestamps[i] - timestamps[previous];
			const step =
				dt > 0 && dt <= MAX_SAMPLE_GAP_SECONDS
					? initialBearing(lat[previous], lon[previous], lat[i], lon[i])
					: NaN;
			bearing[previous] = Number.isFinite(step) ? step : incoming;
			incoming = step;
		}
		previous = i;
	}
	if (previous >= 0) bearing[previous] = incoming;

	const heading = new Array<number>(n).fill(NaN);
	for (let i = 0; i < n; i++) {
		if (!Number.isFinite(bearing[i])) continue;
		let c = Math.cos(bearing[i]);
		let s = Math.sin(bearing[i]);
		if (
			i > 0 &&
			i < n - 1 &&
			Number.isFinite(bearing[i - 1]) &&
			Number.isFinite(bearing[i + 1])
		) {
			c += Math.cos(bearing[i - 1]) + Math.cos(bearing[i + 1]);
			s += Math.sin(bearing[i - 1]) + Math.sin(bearing[i + 1]);
		}
		heading[i] = (Math.atan2(s, c) / DEG + 360) % 360;
	}
	return heading;
}

export interface ScaleFitSegment {
	velocity: ArrayLike<number>;
	airSpeed: ArrayLike<number>;
	headingDeg: ArrayLike<number>;
	mask: ArrayLike<boolean>;
}

interface SegmentWind {
	windSpeed: number;
	/** Meteorological "from", degrees 0–360. */
	windDirDeg: number;
}

export interface HeadingFitRefusal {
	ok: false;
	reason: "tooFewPoints" | "headingCoverage" | "degenerate";
	n: number;
}

export interface SharedScaleFit {
	ok: true;
	n: number;
	/** va_true = scale · va_meas. */
	scale: number;
	winds: SegmentWind[];
	/** Per segment, aligned to its input indices; NaN where the sample was not fitted. */
	residuals: number[][];
	residSd: number;
}

function segmentLength(segment: ScaleFitSegment): number {
	return Math.min(
		segment.velocity.length,
		segment.airSpeed.length,
		segment.headingDeg.length,
		segment.mask.length,
	);
}

function fitted(segment: ScaleFitSegment, i: number): boolean {
	const v = segment.velocity[i];
	return (
		segment.mask[i] === true &&
		Number.isFinite(v) &&
		v > 0 &&
		Number.isFinite(segment.airSpeed[i]) &&
		Number.isFinite(segment.headingDeg[i])
	);
}

export function fitSharedScale(
	segments: ScaleFitSegment[],
	minPoints = MIN_POINTS,
): SharedScaleFit | HeadingFitRefusal {
	const L = segments.length;
	const p = 1 + 2 * L;
	const m = Array.from({ length: p }, () => new Array<number>(p).fill(0));
	const r = new Array<number>(p).fill(0);
	let n = 0;
	let emptySegment = L === 0;
	let coverageFails = false;

	for (let l = 0; l < L; l++) {
		const segment = segments[l];
		const ci = 1 + 2 * l;
		const si = 2 + 2 * l;
		const cos: number[] = [];
		const sin: number[] = [];
		for (let i = 0; i < segmentLength(segment); i++) {
			if (!fitted(segment, i)) continue;
			const v = segment.velocity[i];
			const y = segment.airSpeed[i];
			const theta = segment.headingDeg[i] * DEG;
			const c = Math.cos(theta);
			const s = Math.sin(theta);
			cos.push(c);
			sin.push(s);
			m[0][0] += v * v;
			m[0][ci] += v * c;
			m[0][si] += v * s;
			m[ci][ci] += c * c;
			m[ci][si] += c * s;
			m[si][si] += s * s;
			r[0] += v * y;
			r[ci] += c * y;
			r[si] += s * y;
		}
		n += cos.length;
		if (cos.length === 0) emptySegment = true;
		else if (headingCoverage(cos, sin) < MIN_HEADING_COVERAGE)
			coverageFails = true;
		m[ci][0] = m[0][ci];
		m[si][0] = m[0][si];
		m[si][ci] = m[ci][si];
	}

	if (n < minPoints || emptySegment)
		return { ok: false, reason: "tooFewPoints", n };
	if (coverageFails) return { ok: false, reason: "headingCoverage", n };

	const beta = solveNormalEquations(m, r);
	if (!beta || !(beta[0] > 0)) return { ok: false, reason: "degenerate", n };

	const scale = 1 / beta[0];
	const winds = segments.map((_, l): SegmentWind => {
		const a = beta[1 + 2 * l];
		const b = beta[2 + 2 * l];
		return {
			windSpeed: scale * Math.hypot(a, b),
			windDirDeg: wrapDegrees(Math.atan2(b, a) / DEG),
		};
	});

	let sumSq = 0;
	let sum = 0;
	const residuals = segments.map((segment, l) => {
		const out = new Array<number>(segmentLength(segment)).fill(NaN);
		for (let i = 0; i < out.length; i++) {
			if (!fitted(segment, i)) continue;
			const theta = segment.headingDeg[i] * DEG;
			const e =
				segment.airSpeed[i] -
				(beta[0] * segment.velocity[i] +
					beta[1 + 2 * l] * Math.cos(theta) +
					beta[2 + 2 * l] * Math.sin(theta));
			out[i] = e;
			sum += e;
			sumSq += e * e;
		}
		return out;
	});
	const mean = sum / n;

	return {
		ok: true,
		n,
		scale,
		winds,
		residuals,
		residSd: Math.sqrt(Math.max(sumSq / n - mean * mean, 0)),
	};
}

export type Stationarity =
	{ available: true; vectorChange: number } | { available: false };

/**
 * Review R4: refit each half of the segment's fitted TIME span on its own and
 * compare the two wind VECTORS. A half that cannot be fitted makes the check
 * unavailable. It never passes silently.
 */
export function windStationarity(
	segment: ScaleFitSegment,
	timestamps: ArrayLike<number>,
	minPoints = MIN_POINTS,
): Stationarity {
	const length = Math.min(segmentLength(segment), timestamps.length);
	let first = Infinity;
	let last = -Infinity;
	for (let i = 0; i < length; i++) {
		if (!fitted(segment, i) || !Number.isFinite(timestamps[i])) continue;
		first = Math.min(first, timestamps[i]);
		last = Math.max(last, timestamps[i]);
	}
	if (!(last > first)) return { available: false };
	const mid = (first + last) / 2;

	const half = (early: boolean): ScaleFitSegment => ({
		...segment,
		mask: Array.from(
			{ length },
			(_, i) =>
				segment.mask[i] === true &&
				Number.isFinite(timestamps[i]) &&
				(early ? timestamps[i] < mid : timestamps[i] >= mid),
		),
	});
	const a = fitSharedScale([half(true)], minPoints);
	const b = fitSharedScale([half(false)], minPoints);
	if (!a.ok || !b.ok) return { available: false };

	const north = (w: SegmentWind) => w.windSpeed * Math.cos(w.windDirDeg * DEG);
	const east = (w: SegmentWind) => w.windSpeed * Math.sin(w.windDirDeg * DEG);
	return {
		available: true,
		vectorChange: Math.hypot(
			north(a.winds[0]) - north(b.winds[0]),
			east(a.winds[0]) - east(b.winds[0]),
		),
	};
}

/**
 * Degrees, wrapped to [0, 360). Rounds off the sub-microdegree solver noise
 * first: an angle whose true value sits at the 0°/360° seam otherwise wraps
 * unpredictably to whichever side floating-point rounding happens to land on
 * (observed: a wind analytically due north came out as 359.99999999999994,
 * not ~0, purely from how `Math.cos`/`Math.sin` round at the sample's
 * heading values — reproducible, not an artifact of summation order). No
 * real wind direction needs microdegree resolution, so this loses nothing
 * a caller could use.
 */
function wrapDegrees(deg: number): number {
	const rounded = Math.round(deg * 1e6) / 1e6;
	return ((rounded % 360) + 360) % 360;
}

function headingCoverage(cos: number[], sin: number[]): number {
	const n = cos.length;
	let mc = 0;
	let ms = 0;
	for (let i = 0; i < n; i++) {
		mc += cos[i];
		ms += sin[i];
	}
	mc /= n;
	ms /= n;
	let cxx = 0;
	let cyy = 0;
	let cxy = 0;
	for (let i = 0; i < n; i++) {
		const a = cos[i] - mc;
		const b = sin[i] - ms;
		cxx += a * a;
		cyy += b * b;
		cxy += a * b;
	}
	cxx /= n;
	cyy /= n;
	cxy /= n;
	return (cxx + cyy) / 2 - Math.hypot((cxx - cyy) / 2, cxy);
}

/**
 * Column-scaled normal equations, Gaussian elimination with partial pivoting.
 * Null when a diagonal is zero or the pivot ratio exceeds MAX_PIVOT_RATIO.
 * Defensive: no synthetic case in the test suite reaches it past the coverage
 * guard. It exists because a 3×3 system is not well conditioned just by being
 * small (review, *Numerical solve*).
 */
function solveNormalEquations(m: number[][], r: number[]): number[] | null {
	const p = r.length;
	const d = m.map((row, j) => Math.sqrt(row[j]));
	if (d.some((x) => !(x > 0))) return null;
	const a = m.map((row, j) => row.map((value, k) => value / (d[j] * d[k])));
	const b = r.map((value, j) => value / d[j]);

	let maxPivot = 0;
	let minPivot = Infinity;
	for (let col = 0; col < p; col++) {
		let pivot = col;
		for (let row = col + 1; row < p; row++) {
			if (Math.abs(a[row][col]) > Math.abs(a[pivot][col])) pivot = row;
		}
		[a[col], a[pivot]] = [a[pivot], a[col]];
		[b[col], b[pivot]] = [b[pivot], b[col]];
		const size = Math.abs(a[col][col]);
		maxPivot = Math.max(maxPivot, size);
		minPivot = Math.min(minPivot, size);
		if (!(size > 0) || maxPivot / minPivot > MAX_PIVOT_RATIO) return null;
		for (let row = col + 1; row < p; row++) {
			const factor = a[row][col] / a[col][col];
			for (let k = col; k < p; k++) a[row][k] -= factor * a[col][k];
			b[row] -= factor * b[col];
		}
	}

	const x = new Array<number>(p).fill(0);
	for (let row = p - 1; row >= 0; row--) {
		let sum = b[row];
		for (let k = row + 1; k < p; k++) sum -= a[row][k] * x[k];
		x[row] = sum / a[row][row];
	}
	return x.map((value, j) => value / d[j]);
}

/** Window start and its closing crossing may not be further apart than this. */
const MAX_CLOSURE_METERS = 15;
/** Signed track progress may not fall further than this behind its running peak. */
const MAX_BACKTRACK_DEG = 90;
const GUST_HALF_WINDOW_SECONDS = 7.5;

export type WindowRefusal = "noWholeCircuit" | "notClosed" | "reversal";

interface CircuitWindow {
	startIdx: number;
	endIdx: number;
	circuits: number;
	closureMeters: number;
}

export interface CircuitWindows {
	windows: CircuitWindow[];
	mask: boolean[];
	circuits: number;
	refusal?: WindowRefusal;
}

export interface CircuitWindowInput {
	timestamps: ArrayLike<number>;
	positionLat: ArrayLike<number>;
	positionLong: ArrayLike<number>;
	usable: ArrayLike<boolean>;
}

/**
 * Review R3: complete circuits of TRACK AZIMUTH, the validated rule (notes §3,
 * `r5_irregularity.py`), not heading winding. Refused geometries: backtracking
 * (figure-eight, reversal) and a window whose start and closing crossing do not
 * meet (spiral, open arc). See the plan's "Supported input contract".
 *
 * A run is split by GPS alone: an invalid fix, a non-increasing timestamp, or a
 * gap over `MAX_SAMPLE_GAP_SECONDS`. Fit eligibility (`usable`) gates the
 * returned MASK, never the geometry, so a rider easing below the velocity floor
 * — or a pitot reading zero — no longer destroys a circuit whose GPS is
 * continuous.
 */
export function circuitWindows(input: CircuitWindowInput): CircuitWindows {
	const n = Math.min(
		input.timestamps.length,
		input.positionLat.length,
		input.positionLong.length,
		input.usable.length,
	);
	const runs: number[][] = [];
	let run: number[] = [];
	for (let i = 0; i < n; i++) {
		const t = input.timestamps[i];
		if (
			!Number.isFinite(t) ||
			!isValidFix(input.positionLat[i], input.positionLong[i])
		) {
			continue;
		}
		const last = run[run.length - 1];
		if (last !== undefined) {
			const dt = t - input.timestamps[last];
			if (!(dt > 0) || dt > MAX_SAMPLE_GAP_SECONDS) {
				runs.push(run);
				run = [];
			}
		}
		run.push(i);
	}
	if (run.length > 0) runs.push(run);

	const mask = new Array<boolean>(n).fill(false);
	const windows: CircuitWindow[] = [];
	const refusals: WindowRefusal[] = [];
	for (const indices of runs) {
		const result = windowForRun(input, indices);
		if ("refusal" in result) {
			refusals.push(result.refusal);
			continue;
		}
		windows.push(result);
		for (const i of indices) {
			if (
				i >= result.startIdx &&
				i <= result.endIdx &&
				input.usable[i] === true
			)
				mask[i] = true;
		}
	}

	const circuits = windows.reduce((sum, w) => sum + w.circuits, 0);
	if (windows.length > 0) return { windows, mask, circuits };
	const refusal: WindowRefusal = refusals.includes("reversal")
		? "reversal"
		: refusals.includes("notClosed")
			? "notClosed"
			: "noWholeCircuit";
	return { windows, mask, circuits: 0, refusal };
}

/**
 * The sweep is sampled, so the last fraction of a sample is always lost: a lap
 * that closes on its own start still reads a few degrees short of 360. The
 * tolerance is therefore one typical sample's azimuth, which scales with
 * circuit size and speed — 6.3° on a 451 m oval at 10 m/s, 18.8° on a 250 m
 * track at 15 m/s, where a fixed few-degree constant would refuse a complete
 * lap. The MEDIAN, not the mean: the mean is pulled up by the corners (8.0°
 * against 6.3° on the oval) and counts laps that end 11 m open. Not the final
 * step either, which collapses toward zero when the rider coasts to a halt and
 * restores the knife edge on exactly the lap that ends that way. Anything short
 * by more than one sample is an open arc, and the closure check refuses it.
 */
function sweepToleranceDeg(stepDeg: number[], sign: number): number {
	const oriented = stepDeg.map((v) => v * sign).sort((a, b) => a - b);
	return Math.max(0, oriented[oriented.length >> 1]);
}

function windowForRun(
	input: CircuitWindowInput,
	indices: number[],
): CircuitWindow | { refusal: WindowRefusal } {
	if (indices.length < 3) return { refusal: "noWholeCircuit" };
	let minLat = Infinity;
	let maxLat = -Infinity;
	let minLon = Infinity;
	let maxLon = -Infinity;
	for (const i of indices) {
		minLat = Math.min(minLat, input.positionLat[i]);
		maxLat = Math.max(maxLat, input.positionLat[i]);
		minLon = Math.min(minLon, input.positionLong[i]);
		maxLon = Math.max(maxLon, input.positionLong[i]);
	}
	const centerLat = (minLat + maxLat) / 2;
	const centerLon = (minLon + maxLon) / 2;
	const metersPerDegLon = METERS_PER_DEG_LAT * Math.cos(centerLat * DEG);
	const x = indices.map(
		(i) => (input.positionLong[i] - centerLon) * metersPerDegLon,
	);
	const y = indices.map(
		(i) => (input.positionLat[i] - centerLat) * METERS_PER_DEG_LAT,
	);

	const progress = new Array<number>(indices.length).fill(0);
	const stepDeg = new Array<number>(indices.length - 1);
	let previousAz = Math.atan2(x[0], y[0]) / DEG;
	for (let k = 1; k < indices.length; k++) {
		const az = Math.atan2(x[k], y[k]) / DEG;
		const step = ((az - previousAz + 540) % 360) - 180;
		stepDeg[k - 1] = step;
		progress[k] = progress[k - 1] + step;
		previousAz = az;
	}
	const sign = Math.sign(progress[progress.length - 1]);
	if (sign === 0) return { refusal: "noWholeCircuit" };
	const signed = progress.map((value) => value * sign);

	let peak = 0;
	for (const value of signed) {
		peak = Math.max(peak, value);
		if (peak - value > MAX_BACKTRACK_DEG) return { refusal: "reversal" };
	}

	const tolerance = sweepToleranceDeg(stepDeg, sign);
	const circuits = Math.floor((signed[signed.length - 1] + tolerance) / 360);
	if (circuits < 1) return { refusal: "noWholeCircuit" };
	const limit = Math.min(circuits * 360, signed[signed.length - 1]);
	const cross = signed.findIndex((value) => value >= limit);
	const before = cross - 1;
	const fraction = (limit - signed[before]) / (signed[cross] - signed[before]);
	const crossX = x[before] + fraction * (x[cross] - x[before]);
	const crossY = y[before] + fraction * (y[cross] - y[before]);
	const closureMeters = Math.hypot(crossX - x[0], crossY - y[0]);
	if (closureMeters > MAX_CLOSURE_METERS) return { refusal: "notClosed" };

	return {
		startIdx: indices[0],
		endIdx: indices[before],
		circuits,
		closureMeters,
	};
}

export type GustIndex =
	{ available: true; value: number } | { available: false };

/**
 * Notes §17.1, made time-aware (review R7): the sd of the ±7.5 s time-boxcar
 * of the model residual, over mean air speed. Samples are those with a finite
 * residual. Smoothing never crosses a gap longer than MAX_SAMPLE_GAP_SECONDS.
 * Invalid or non-increasing timestamps make it unavailable, never zero.
 */
export function gustIndex(
	residuals: ArrayLike<number>,
	airSpeed: ArrayLike<number>,
	timestamps: ArrayLike<number>,
): GustIndex {
	const idx: number[] = [];
	const length = Math.min(residuals.length, airSpeed.length, timestamps.length);
	for (let i = 0; i < length; i++) {
		if (!Number.isFinite(residuals[i])) continue;
		if (!Number.isFinite(timestamps[i]) || !Number.isFinite(airSpeed[i]))
			return { available: false };
		if (idx.length > 0 && !(timestamps[i] > timestamps[idx[idx.length - 1]]))
			return { available: false };
		idx.push(i);
	}
	if (idx.length === 0) return { available: false };

	const runOf = new Array<number>(idx.length).fill(0);
	for (let k = 1; k < idx.length; k++) {
		const gap =
			timestamps[idx[k]] - timestamps[idx[k - 1]] > MAX_SAMPLE_GAP_SECONDS;
		runOf[k] = runOf[k - 1] + (gap ? 1 : 0);
	}

	const smoothed = new Array<number>(idx.length);
	let sumAir = 0;
	for (let k = 0; k < idx.length; k++) {
		const tk = timestamps[idx[k]];
		let sum = residuals[idx[k]];
		let count = 1;
		for (
			let j = k - 1;
			j >= 0 &&
			runOf[j] === runOf[k] &&
			tk - timestamps[idx[j]] <= GUST_HALF_WINDOW_SECONDS;
			j--
		) {
			sum += residuals[idx[j]];
			count++;
		}
		for (
			let j = k + 1;
			j < idx.length &&
			runOf[j] === runOf[k] &&
			timestamps[idx[j]] - tk <= GUST_HALF_WINDOW_SECONDS;
			j++
		) {
			sum += residuals[idx[j]];
			count++;
		}
		smoothed[k] = sum / count;
		sumAir += airSpeed[idx[k]];
	}

	const mean = smoothed.reduce((a, b) => a + b, 0) / smoothed.length;
	const variance =
		smoothed.reduce((a, b) => a + (b - mean) ** 2, 0) / smoothed.length;
	return {
		available: true,
		value: Math.sqrt(variance) / (sumAir / idx.length),
	};
}
