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
	/**
	 * Travelled distance over the window, rebased to 0 (same length as
	 * `elevation`). Optional: only the reference-rise sensitivity reads it,
	 * and without it the ramp is spread by sample instead.
	 */
	distance?: Float64Array;
	/**
	 * +1 for a lap or an outbound leg, −1 for an inbound leg: an error in the
	 * reference's rise along the road shows up reversed when the road is
	 * ridden back. Absent means +1.
	 */
	riseSign?: 1 | -1;
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
	/**
	 * Correlation of the free fit's CdA and Crr estimates, −a·f / √(a·a f·f):
	 * how far this repeat's speed profile lets it tell drag from rolling
	 * resistance at all. Depends on the design only, not on the residuals.
	 */
	correlation: number;
	/** Why the free fit should not be trusted on its own; null when it can. */
	unstable: string | null;
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
	/**
	 * Estimate ± t(0.975, df) × clustered SE; null with the clustered SE. A
	 * rough range at low df: the SE itself rests on G repeats.
	 */
	range95: { cda: [number, number]; crr: [number, number] } | null;
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

/**
 * |corr(CdA, Crr)| at or above this marks a repeat's free fit unstable.
 *
 * At |r| = 0.99 the variance of each estimate is inflated 1 / (1 − r²) ≈ 50×
 * over what an uncorrelated design would give from the same residuals: the
 * repeat has almost no speed variation to tell drag from rolling resistance,
 * so noise slides the pair along the ridge. Measured on the reference ride
 * (2026-10-19): the six single laps (Standard and GPS-lap mode) sat at
 * |r| 0.993–1.000 and their free fits were erratic (CdA −0.25 to 0.69); the
 * five out-and-back sections sat at 0.930–0.985 and theirs stayed within
 * 0.30–0.41. Within one leg both losses grow with distance whatever the
 * pacing; what separates them is a change in AIR speed relative to ground
 * speed — the head- and tailwind legs of a pair.
 */
export const UNSTABLE_CORRELATION = 0.99;

/**
 * A free Crr this close to a bound (as a fraction of the bound range) counts
 * as "at" the bound.
 */
const BOUND_MARGIN = 0.02;

export interface RepeatSpreadOptions {
	/** The slider bounds: a free fit at or beyond them is flagged. */
	cdaBounds?: readonly [number, number];
	crrBounds?: readonly [number, number];
}

/** Two-sided 97.5 % Student-t quantiles, df 1–30. */
const T_975 = [
	12.706, 4.303, 3.182, 2.776, 2.571, 2.447, 2.365, 2.306, 2.262, 2.228, 2.201,
	2.179, 2.16, 2.145, 2.131, 2.12, 2.11, 2.101, 2.093, 2.086, 2.08, 2.074,
	2.069, 2.064, 2.06, 2.056, 2.052, 2.048, 2.045, 2.042,
];

/**
 * t(0.975, df): the table to df 30, then the first Cornish–Fisher term
 * z + (z³ + z) / (4·df), within 0.002 of the exact value from there on.
 */
export function tQuantile975(df: number): number {
	if (!(df >= 1)) {
		return NaN;
	}
	if (df <= T_975.length) {
		return T_975[Math.floor(df) - 1];
	}
	const z = 1.959964;
	return z + (z * z * z + z) / (4 * df);
}

function outside(
	value: number,
	bounds: readonly [number, number] | undefined,
): boolean {
	if (!bounds) {
		return false;
	}
	const margin = BOUND_MARGIN * (bounds[1] - bounds[0]);
	return value <= bounds[0] + margin || value >= bounds[1] - margin;
}

function unstableReason(
	cda: number,
	crr: number,
	correlation: number,
	options: RepeatSpreadOptions,
): string | null {
	const reasons: string[] = [];
	if (outside(crr, options.crrBounds)) {
		reasons.push("Crr at or beyond its bounds");
	}
	if (outside(cda, options.cdaBounds)) {
		reasons.push("CdA at or beyond its bounds");
	}
	if (Math.abs(correlation) >= UNSTABLE_CORRELATION) {
		reasons.push(`CdA and Crr ${Math.abs(correlation).toFixed(3)} correlated`);
	}
	return reasons.length > 0 ? reasons.join("; ") : null;
}

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
): {
	cda: number;
	crr: number;
	inverse: number[][];
	correlation: number;
} | null {
	const s = sumsOf(legs, fixedCrr);
	if (fixedCrr !== null) {
		if (!(s.aa > 0)) {
			return null;
		}
		return {
			cda: s.ay / s.aa,
			crr: fixedCrr,
			inverse: [[1 / s.aa]],
			correlation: NaN,
		};
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
		correlation: -s.af / Math.sqrt(s.aa * s.ff),
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

	const t = tQuantile975(clusters - 1);
	const range = (value: number, se: number): [number, number] => [
		value - t * se,
		value + t * se,
	];
	return {
		cda,
		crr,
		rms: Math.sqrt(ssr / samplesOf(all)),
		naiveSe,
		clusteredSe,
		clusters,
		df: Math.max(0, clusters - 1),
		range95: clusteredSe
			? {
					cda: range(cda, clusteredSe.cda),
					crr: range(crr, clusteredSe.crr),
				}
			: null,
	};
}

/**
 * Fit every repeat alone (free, and CdA-only at `fixedCrr`), the spread
 * across them, and the pooled fit with both error bars.
 */
export function computeRepeatSpread(
	units: readonly RepeatUnitInput[],
	fixedCrr: number,
	options: RepeatSpreadOptions = {},
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
			correlation: NaN,
			unstable: null,
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
			correlation: free ? free.correlation : NaN,
			unstable: free
				? unstableReason(free.cda, free.crr, free.correlation, options)
				: null,
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

/** One sensitivity: the units refitted with a single assumed input moved. */
export interface SensitivityInput {
	label: string;
	units: readonly RepeatUnitInput[];
}

export interface SensitivityRow {
	label: string;
	/** Pooled free fit, perturbed minus base; NaN where either is missing. */
	dCda: number;
	dCrr: number;
	/** Pooled CdA at the fixed Crr, perturbed minus base. */
	dCdaAtFixedCrr: number;
}

/**
 * How far the POOLED fits move when one assumed input moves. Each row is a
 * full refit of its own units; rows are never combined (TODO J5: these are
 * sensitivities, not measured uncertainties, and they are not independent).
 */
export function computeSensitivities(
	base: RepeatSpreadResult,
	inputs: readonly SensitivityInput[],
): SensitivityRow[] {
	return inputs.map(({ label, units }) => {
		const moved = computeRepeatSpread(units, base.fixedCrr);
		const delta = (a: number | undefined, b: number | undefined) =>
			a !== undefined && b !== undefined ? a - b : NaN;
		return {
			label,
			dCda: delta(moved.pooled?.cda, base.pooled?.cda),
			dCrr: delta(moved.pooled?.crr, base.pooled?.crr),
			dCdaAtFixedCrr: delta(moved.pooledFixed?.cda, base.pooledFixed?.cda),
		};
	});
}

/**
 * The units with every leg's reference profile tilted by `riseM` over the
 * leg: a ramp from 0 at the window start to `riseM · riseSign` at its end,
 * spread by distance (by sample without one) — a reference whose net rise
 * is off by `riseM`, the DEM-rise sensitivity of TODO J5.
 */
export function tiltReference(
	units: readonly RepeatUnitInput[],
	riseM: number,
): RepeatUnitInput[] {
	return units.map((unit): RepeatUnitInput => ({
		...unit,
		legs: unit.legs.map((leg): RepeatLeg => {
			const h = leg.elevation;
			if (!h || h.length < 2) {
				return leg;
			}
			const d = leg.distance;
			const span = d && d.length === h.length ? d[d.length - 1] : NaN;
			const byDistance = Number.isFinite(span) && span > 0;
			const rise = riseM * (leg.riseSign ?? 1);
			const tilted = new Float64Array(h.length);
			for (let i = 0; i < h.length; i++) {
				const fraction = byDistance ? d![i] / span : i / (h.length - 1);
				tilted[i] = h[i] + rise * fraction;
			}
			return { ...leg, elevation: tilted };
		}),
	}));
}

/**
 * Out-of-sample score of a set of repeats: each usable repeat in turn is
 * held out, the pooled free fit is made on the others, and the held-out
 * repeat's anchored profile residual is taken at those values. The score is
 * the RMS over every held-out sample — a number in-sample RMS cannot fake,
 * because a shift that only lets the fit chase one lap's noise does not
 * carry to the next lap. Null with fewer than two usable repeats, or when a
 * fit on the others is singular.
 */
export function heldOutScore(
	units: readonly RepeatUnitInput[],
): { rms: number; repeats: number; perRepeatRms: number[] } | null {
	const usable: LegParts[][] = [];
	for (const unit of units) {
		const parts = unit.legs.map(legParts);
		if (parts.length > 0 && parts.every((p) => p !== null)) {
			usable.push(parts as LegParts[]);
		}
	}
	if (usable.length < 2) {
		return null;
	}
	let ssr = 0;
	let samples = 0;
	const perRepeatRms: number[] = [];
	for (let h = 0; h < usable.length; h++) {
		const others = usable.filter((_, i) => i !== h).flat();
		const fit = solve(others, null);
		if (!fit) {
			return null;
		}
		const own = ssrOf(usable[h], fit.cda, fit.crr);
		ssr += own;
		samples += samplesOf(usable[h]);
		perRepeatRms.push(Math.sqrt(own / samplesOf(usable[h])));
	}
	return {
		rms: Math.sqrt(ssr / samples),
		repeats: usable.length,
		perRepeatRms,
	};
}
