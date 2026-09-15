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
