/**
 * Repeat-based spread (TODO J2): each lap — or each out-and-back section,
 * its two legs together — fitted ON ITS OWN, and the scatter across them.
 *
 * WHY. A profile fit's own standard error assumes independent 1 s residuals.
 * They are not: VE residuals wander along the road (wind, terrain error,
 * drafting), so the naive error bar comes out 10–40× smaller than the
 * lap-to-lap scatter of the same estimate. Independent repeats solved alone
 * are the honest, cheap measure: the SD across them, with n and its degrees
 * of freedom. One repeat has no spread — that is "not estimable", never 0.
 *
 * THE FIT. Each leg's VE, rebased to 0 at its window start, is EXACTLY linear
 * in (CdA, Crr) since #31 (the slope has no sin(atan) and both enter it
 * linearly):
 *
 *     VE(CdA, Crr) = b − CdA·a − Crr·f
 *
 * so three probes of the real calculator give b, a and f, and the fit that
 * minimises the anchored profile RMS the VE tab shows,
 *
 *     Σ (VE − h)²,   h = reference elevation rebased to 0 at the window start
 *
 * is a closed-form least-squares problem in y = b − h ≈ CdA·a + Crr·f. The
 * RMS reported is over the same samples as the VE tab's RMSE (the anchor
 * sample included), so a lap's row and the VE tab agree at the same sliders.
 * Crr is in SLIDER space: the probes go through the caller's temperature
 * correction, which is a pure multiplier and keeps the model linear.
 *
 * THE POOLED FIT next to it is the same objective over every leg at once,
 * shown with two error bars: the naive one (σ²·(XᵀX)⁻¹, i.i.d. residuals)
 * and the repeat-clustered sandwich, whose middle sums each repeat's score
 * Xᵀe as one unit and so lets residuals inside a repeat correlate freely. On
 * the three hill rides (6 legs each) the clustered SE landed at 75–95 % of
 * the leave-one-leg-out jackknife while the naive SE was 10–14× too small.
 * The pooled fit is a readout; the sliders and auto-converge never read it.
 */

/** One leg of a repeat: its VE probe and reference profile over the window. */
export interface RepeatLeg {
	/**
	 * The window's VE at (CdA, SLIDER-space Crr), rebased to 0 at the window
	 * start. Probed three times; must be linear in both arguments.
	 */
	veProfile(cda: number, crr: number): Float64Array;
	/**
	 * Reference elevation over the same window, rebased to 0 at its start;
	 * null when the leg has no usable profile to fit against.
	 */
	elevation: Float64Array | null;
}

export interface RepeatUnitInput {
	key: string;
	label: string;
	legs: RepeatLeg[];
}

type RepeatUnitStatus = "ok" | "no-profile" | "singular";

export interface RepeatUnitFit {
	key: string;
	label: string;
	status: RepeatUnitStatus;
	/** Window samples the RMS is taken over (all legs). */
	samples: number;
	/** Free fit: both parameters from this repeat alone. NaN unless ok. */
	cda: number;
	crr: number;
	/** Anchored profile RMS at the free fit, metres. */
	rms: number;
	/** CdA-only fit at the fixed Crr (the comparison-testing variant). */
	cdaAtFixedCrr: number;
	rmsAtFixedCrr: number;
}

/** Mean and repeat-to-repeat SD of one estimate. */
export interface RepeatStat {
	mean: number;
	/** Sample SD (n − 1); null when n < 2 — not estimable, never 0. */
	sd: number | null;
	n: number;
	/** Degrees of freedom of the SD: n − 1. */
	df: number;
}

export interface PooledFit {
	cda: number;
	/** The fitted Crr, or the fixed one for the CdA-only fit. */
	crr: number;
	rms: number;
	/** i.i.d. standard errors; NaN for a parameter that was held fixed. */
	naiveSe: { cda: number; crr: number };
	/** Repeat-clustered SE; null when fewer than two repeats. */
	clusteredSe: { cda: number; crr: number } | null;
	/** Repeats the clustered SE is built from, and its df (G − 1). */
	clusters: number;
	df: number;
}

export interface RepeatSpreadResult {
	units: RepeatUnitFit[];
	/** The Crr the CdA-only variant holds fixed (slider space). */
	fixedCrr: number;
	free: { cda: RepeatStat; crr: RepeatStat };
	fixed: { cda: RepeatStat };
	/** Null when no repeat is usable. */
	pooled: PooledFit | null;
	pooledFixed: PooledFit | null;
	/** Set when the spread cannot be estimated (fewer than two usable repeats). */
	notEstimableReason: string | null;
}

export const REPEAT_SPREAD_SINGLE_REASON =
	"Repeat spread not estimable: one repeat has no spread. Select two or more laps (or out-and-back sections).";
export const REPEAT_SPREAD_NONE_REASON =
	"Repeat spread not estimable: no selected repeat has a usable elevation profile to fit against.";

/** Below this relative determinant a repeat cannot separate CdA from Crr. */
const SINGULAR_RELATIVE_DETERMINANT = 1e-10;

/** b, a, f and the target over one leg's window (`y = b − h`). */
interface LegParts {
	y: Float64Array;
	a: Float64Array;
	f: Float64Array;
}

function legParts(leg: RepeatLeg): LegParts | null {
	const h = leg.elevation;
	if (!h || h.length < 2) {
		return null;
	}
	const b = leg.veProfile(0, 0);
	const cdaProbe = leg.veProfile(1, 0);
	const crrProbe = leg.veProfile(0, 1);
	const n = h.length;
	if (b.length !== n || cdaProbe.length !== n || crrProbe.length !== n) {
		return null;
	}
	const y = new Float64Array(n);
	const a = new Float64Array(n);
	const f = new Float64Array(n);
	for (let i = 0; i < n; i++) {
		y[i] = b[i] - h[i];
		a[i] = b[i] - cdaProbe[i];
		f[i] = b[i] - crrProbe[i];
		if (
			!Number.isFinite(y[i]) ||
			!Number.isFinite(a[i]) ||
			!Number.isFinite(f[i])
		) {
			return null;
		}
	}
	return { y, a, f };
}

/** Sums over a set of legs; `fixedCrr` null fits both, a number CdA only. */
interface Sums {
	aa: number;
	af: number;
	ff: number;
	ay: number;
	fy: number;
}

function sumsOf(legs: readonly LegParts[], fixedCrr: number | null): Sums {
	const s: Sums = { aa: 0, af: 0, ff: 0, ay: 0, fy: 0 };
	for (const { y, a, f } of legs) {
		for (let i = 0; i < y.length; i++) {
			const target = fixedCrr === null ? y[i] : y[i] - fixedCrr * f[i];
			s.aa += a[i] * a[i];
			s.af += a[i] * f[i];
			s.ff += f[i] * f[i];
			s.ay += a[i] * target;
			s.fy += f[i] * target;
		}
	}
	return s;
}

/** Least squares over `legs`; null when singular. */
function solve(
	legs: readonly LegParts[],
	fixedCrr: number | null,
): { cda: number; crr: number; inverse: number[][] } | null {
	const s = sumsOf(legs, fixedCrr);
	if (fixedCrr !== null) {
		if (!(s.aa > 0)) {
			return null;
		}
		return { cda: s.ay / s.aa, crr: fixedCrr, inverse: [[1 / s.aa]] };
	}
	const det = s.aa * s.ff - s.af * s.af;
	if (!(det > SINGULAR_RELATIVE_DETERMINANT * s.aa * s.ff)) {
		return null;
	}
	return {
		cda: (s.ff * s.ay - s.af * s.fy) / det,
		crr: (s.aa * s.fy - s.af * s.ay) / det,
		inverse: [
			[s.ff / det, -s.af / det],
			[-s.af / det, s.aa / det],
		],
	};
}

function residual(
	parts: LegParts,
	i: number,
	cda: number,
	crr: number,
): number {
	return parts.y[i] - cda * parts.a[i] - crr * parts.f[i];
}

function ssrOf(legs: readonly LegParts[], cda: number, crr: number): number {
	let ssr = 0;
	for (const parts of legs) {
		for (let i = 0; i < parts.y.length; i++) {
			const r = residual(parts, i, cda, crr);
			ssr += r * r;
		}
	}
	return ssr;
}

function samplesOf(legs: readonly LegParts[]): number {
	return legs.reduce((sum, parts) => sum + parts.y.length, 0);
}

export function repeatStat(values: readonly number[]): RepeatStat {
	const n = values.length;
	const mean = n > 0 ? values.reduce((sum, v) => sum + v, 0) / n : NaN;
	if (n < 2) {
		return { mean, sd: null, n, df: Math.max(0, n - 1) };
	}
	const ss = values.reduce((sum, v) => sum + (v - mean) * (v - mean), 0);
	return { mean, sd: Math.sqrt(ss / (n - 1)), n, df: n - 1 };
}

/**
 * The pooled fit over every usable repeat, with its naive and its
 * repeat-clustered standard errors (`fixedCrr` holds Crr, CdA-only).
 */
function pooledFit(
	repeats: readonly (readonly LegParts[])[],
	fixedCrr: number | null,
): PooledFit | null {
	const all = repeats.flat();
	const solved = solve(all, fixedCrr);
	if (!solved) {
		return null;
	}
	const { cda, crr, inverse } = solved;
	const p = fixedCrr === null ? 2 : 1;
	const ssr = ssrOf(all, cda, crr);
	// The anchor sample of each leg is identically zero in y, a and f: it
	// carries no information and does not count as an observation.
	const observations = samplesOf(all) - all.length;
	const sigma2 = observations > p ? ssr / (observations - p) : NaN;
	const naiveSe = {
		cda: Math.sqrt(sigma2 * inverse[0][0]),
		crr: p === 2 ? Math.sqrt(sigma2 * inverse[1][1]) : NaN,
	};

	const clusters = repeats.length;
	let clusteredSe: PooledFit["clusteredSe"] = null;
	if (clusters >= 2) {
		// Meat: Σ_g u_g u_gᵀ with u_g = X_gᵀ e_g, one score per repeat.
		const meat = Array.from({ length: p }, () => new Array<number>(p).fill(0));
		for (const repeat of repeats) {
			const u = new Array<number>(p).fill(0);
			for (const parts of repeat) {
				for (let i = 0; i < parts.y.length; i++) {
					const r = residual(parts, i, cda, crr);
					u[0] += parts.a[i] * r;
					if (p === 2) {
						u[1] += parts.f[i] * r;
					}
				}
			}
			for (let j = 0; j < p; j++) {
				for (let k = 0; k < p; k++) {
					meat[j][k] += u[j] * u[k];
				}
			}
		}
		// Bread · meat · bread, with the G / (G − 1) small-sample factor.
		const scale = clusters / (clusters - 1);
		const cov = (j: number, k: number): number => {
			let sum = 0;
			for (let m = 0; m < p; m++) {
				for (let q = 0; q < p; q++) {
					sum += inverse[j][m] * meat[m][q] * inverse[q][k];
				}
			}
			return scale * sum;
		};
		clusteredSe = {
			cda: Math.sqrt(cov(0, 0)),
			crr: p === 2 ? Math.sqrt(cov(1, 1)) : NaN,
		};
	}

	return {
		cda,
		crr,
		rms: Math.sqrt(ssr / samplesOf(all)),
		naiveSe,
		clusteredSe,
		clusters,
		df: Math.max(0, clusters - 1),
	};
}

/**
 * Fit every repeat alone (free, and CdA-only at `fixedCrr`), the spread
 * across them, and the pooled fit with both error bars.
 */
export function computeRepeatSpread(
	units: readonly RepeatUnitInput[],
	fixedCrr: number,
): RepeatSpreadResult {
	const fits: RepeatUnitFit[] = [];
	const usable: LegParts[][] = [];
	for (const unit of units) {
		const parts = unit.legs.map(legParts);
		const blank: RepeatUnitFit = {
			key: unit.key,
			label: unit.label,
			status: "no-profile",
			samples: 0,
			cda: NaN,
			crr: NaN,
			rms: NaN,
			cdaAtFixedCrr: NaN,
			rmsAtFixedCrr: NaN,
		};
		if (parts.length === 0 || parts.some((p) => p === null)) {
			fits.push(blank);
			continue;
		}
		const legs = parts as LegParts[];
		const samples = samplesOf(legs);
		const fixed = solve(legs, fixedCrr);
		const free = solve(legs, null);
		if (!fixed) {
			fits.push({ ...blank, status: "singular", samples });
			continue;
		}
		usable.push(legs);
		fits.push({
			key: unit.key,
			label: unit.label,
			status: free ? "ok" : "singular",
			samples,
			cda: free ? free.cda : NaN,
			crr: free ? free.crr : NaN,
			rms: free ? Math.sqrt(ssrOf(legs, free.cda, free.crr) / samples) : NaN,
			cdaAtFixedCrr: fixed.cda,
			rmsAtFixedCrr: Math.sqrt(ssrOf(legs, fixed.cda, fixedCrr) / samples),
		});
	}

	const freeFits = fits.filter((fit) => fit.status === "ok");
	const fixedFits = fits.filter((fit) => Number.isFinite(fit.cdaAtFixedCrr));
	return {
		units: fits,
		fixedCrr,
		free: {
			cda: repeatStat(freeFits.map((fit) => fit.cda)),
			crr: repeatStat(freeFits.map((fit) => fit.crr)),
		},
		fixed: { cda: repeatStat(fixedFits.map((fit) => fit.cdaAtFixedCrr)) },
		pooled: usable.length > 0 ? pooledFit(usable, null) : null,
		pooledFixed: usable.length > 0 ? pooledFit(usable, fixedCrr) : null,
		notEstimableReason:
			usable.length === 0
				? REPEAT_SPREAD_NONE_REASON
				: usable.length < 2
					? REPEAT_SPREAD_SINGLE_REASON
					: null,
	};
}
