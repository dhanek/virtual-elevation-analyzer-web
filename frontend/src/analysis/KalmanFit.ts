/**
 * The Kalman error-model fit (TODO J6): CdA and Crr with honest standard
 * errors from a state-space model of what the residuals actually do — a
 * random walk per leg, a terrain error shared at the same road position,
 * and detected jumps turned into free steps. The model and the fit live in
 * Rust (`kalman_fit.rs`, `kalman_design.rs`); this file turns the Repeats
 * tab's legs into its input and its JSON back into types and words.
 *
 * Every leg is linearised exactly as the per-lap fits are (`legParts`, three
 * probes of the real calculator), so Crr is in SLIDER space here too.
 *
 * Spec: docs/superpowers/specs/2026-10-26-kalman-shared-terrain-jumps-design.md
 */
import type { WindDataSource } from "./WindSourceResolver";
import type { WindEntry } from "./WindHeightTransfer";
import { legParts, type RepeatUnitInput } from "./RepeatSpread";

export type AirSpeedSource =
	"measured" | "modelled" | "entered" | "groundSpeed";

/** The rider and slider values the braking pre-mask's coasting physics uses. */
export interface KalmanPhysics {
	mass: number;
	eta: number;
	cda: number;
	crr: number;
}

/** One leg as `fit_selection_json` takes it (Rust `LegInput`). */
export interface KalmanLegInput {
	label: string;
	session: number;
	timestamps: number[];
	power: number[];
	speed: number[];
	airSpeed: number[];
	rho: number;
	distance: number[];
	lat: number[];
	lon: number[];
	elevation: number[];
	y: number[];
	columns: number[][];
}

export interface KalmanSelectionInput {
	names: string[];
	legs: KalmanLegInput[];
	physics: KalmanPhysics;
	options: {
		gridM: number;
		airSpeed: AirSpeedSource;
		fixedCda: number | null;
		jumps: boolean;
	};
}

interface KalmanJump {
	leg: number;
	label: string;
	/** Road position (m) and distance into the leg (m). */
	pos: number;
	distance: number;
	/** Step size (m) in the direction the leg was ridden. */
	size: number;
	t: number;
	/** In the fit, or flagged but left out. */
	fitted: boolean;
	/** Left out after a test against the final fit: it moves nothing. */
	movesNothing: boolean;
}

interface KalmanFitSummary {
	names: string[];
	beta: number[];
	se: number[];
	cov: number[][];
	noise: {
		qPer5m: number;
		s2: number;
		ell: number;
		r: number;
		terrainByDirection: boolean;
		atBound: string[];
	};
	jumps: KalmanJump[];
	warnings: string[];
	cdaCrrCorrelation: number | null;
	speedContrast: number | null;
	legs: number;
	observations: number;
}

interface KalmanLegResiduals {
	label: string;
	pos: number[];
	/** y − Xβ: each clean stretch centred on its own fitted offset. */
	residual: number[];
	stretch: number[];
	/** Road-position spans the pre-masks cut out. */
	masked: [number, number][];
}

export interface KalmanOutput {
	status: "ok" | "refused";
	reason: string | null;
	coupled: [string, string] | null;
	fit: KalmanFitSummary | null;
	residuals: KalmanLegResiduals[];
	closedLoop: boolean;
	loopLength: number | null;
	sessions: {
		session: number;
		status: string;
		reason: string | null;
		fit: KalmanFitSummary | null;
	}[];
	sessionZ: { name: string; first: number; second: number; z: number }[];
	/** Legs left out for having no observation on the road grid. */
	droppedLegs: string[];
}

const toArray = (series: ArrayLike<number> | undefined | null): number[] =>
	series ? Array.from(series) : [];

/**
 * The fit's input from the Repeats tab's units: every leg with an elevation
 * profile, linearised; a section's legs listed one by one. Null below two
 * legs — the fit would refuse (`tooFewLegs`) anyway.
 */
export function buildKalmanSelection(
	units: readonly RepeatUnitInput[],
	physics: KalmanPhysics,
	airSpeed: AirSpeedSource,
): KalmanSelectionInput | null {
	const legs: KalmanLegInput[] = [];
	for (const unit of units) {
		unit.legs.forEach((leg, i) => {
			const parts = legParts(leg);
			if (!parts || !leg.elevation) {
				return;
			}
			const n = parts.y.length;
			const label =
				unit.legs.length > 1 ? `${unit.label} · leg ${i + 1}` : unit.label;
			const gps =
				leg.lat && leg.lon && leg.lat.length === n && leg.lon.length === n;
			legs.push({
				label,
				session: 0,
				timestamps: leg.timestamps
					? toArray(leg.timestamps)
					: Array.from({ length: n }, (_, k) => k),
				power: toArray(leg.power),
				speed: toArray(leg.speed),
				airSpeed: toArray(leg.airSpeed ?? leg.speed),
				rho: leg.rho ?? 1.225,
				distance: leg.distance
					? toArray(leg.distance)
					: Array.from({ length: n }, (_, k) => k),
				lat: gps ? toArray(leg.lat) : [],
				lon: gps ? toArray(leg.lon) : [],
				elevation: toArray(leg.elevation),
				y: toArray(parts.y),
				columns: [toArray(parts.a), toArray(parts.f)],
			});
		});
	}
	if (legs.length < 2) {
		return null;
	}
	return {
		names: ["CdA", "Crr"],
		legs,
		physics,
		options: { gridM: 5, airSpeed, fixedCda: null, jumps: true },
	};
}

/**
 * Where the fit's air speed comes from (it never refuses on this; it names
 * the source in a warning).
 */
export function airSpeedSource(
	dataSource: WindDataSource,
	params: { wind_speed?: number | null; wind_entry?: WindEntry },
): AirSpeedSource {
	switch (dataSource) {
		case "air_speed":
		case "wind_speed":
			return "measured";
		case "none":
			return "groundSpeed";
		case "constant":
			if (!Number.isFinite(params.wind_speed)) {
				return "groundSpeed";
			}
			return params.wind_entry === "weather" ? "modelled" : "entered";
	}
}

export function parseKalmanOutput(json: string): KalmanOutput {
	return JSON.parse(json) as KalmanOutput;
}

/** The named fallback (spec §4) in words. */
export function kalmanReasonText(
	reason: string | null,
	coupled: [string, string] | null,
	droppedLegs: readonly string[] = [],
): string {
	switch (reason) {
		case "tooFewLegs":
			return droppedLegs.length > 0
				? `Needs 2 or more legs with clean observations on a common road; none on it: ${droppedLegs.join(", ")}.`
				: "Needs 2 or more legs with an elevation profile.";
		case "tooFewObservations":
			return "Too few clean observations after the braking, corner and lap-button cuts.";
		case "notIdentified":
			return coupled
				? `Cannot tell ${coupled[0]} and ${coupled[1]} apart on this selection.`
				: "The fit is not identified on this selection.";
		default:
			return reason ? `Refused: ${reason}.` : "Refused.";
	}
}

/** One warning code (Rust `Warning`) in words. */
export function kalmanWarningText(code: string): string {
	const [name, value] = code.split(":");
	switch (name) {
		case "noCommonRoad":
			return "No two legs share 300 m of road: the terrain error is not shared.";
		case "noiseAtBound": {
			const which = (value ?? "").split(",").filter(Boolean);
			const upper = which.filter((w) => w !== "r");
			if (upper.length > 0) {
				return `Noise at its upper bound (${upper.join(", ")}): the residuals vary more than the model allows — often a coarse DEM — so the SEs may be too small. Compare them with the spread across repeats.`;
			}
			return "White noise at its 1 cm floor.";
		}
		case "tooManyDisturbances":
			return "Too many disturbances: the jump stage stopped at its limit (2 per leg).";
		case "weakSpeedContrast":
			return `Speed contrast ${Number(value).toFixed(2)} (under 0.15): CdA is weakly separated from Crr — ride two speeds, or fix CdA.`;
		case "noWind":
			return "No wind used: air speed is ground speed alone. Unmodelled wind dilutes CdA, so it may read low.";
		case "enteredWind":
			return "Air speed from the wind you entered, not a sensor: unmodelled wind dilutes CdA, so it may read low.";
		case "modelledWind":
			return "Air speed from the weather model (Open-Meteo), not a sensor: unmodelled wind dilutes CdA, so it may read low.";
		default:
			return code;
	}
}
