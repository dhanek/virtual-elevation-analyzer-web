/**
 * Where the closure target comes from — the reference elevation difference a
 * segment's VE gain is measured against on the Convergence tab and in the
 * auto-converge solve.
 *
 * THE PHASE-2 SEAM, now filled in. The Rust side returns raw VE gains
 * (`ve_gain`, `ve_gain_grid`) and never sees a target, so this function is the
 * single place the elevation-difference source enters the closure computation.
 * The surface cache keys the POOLED surface on the targets and the raw gains
 * on the physics alone (`buildConvergenceUpdateInput`), so switching sources
 * re-pools the cached gains without recomputing any grid.
 *
 * The three sources:
 *   - `'dem'` (default): the DEM elevation channel when one is loaded
 *     (`demAltitude`), else the segment's RESOLVED altitude profile — which is
 *     exactly phase 1's behaviour, so a ride with no DEM data changes nothing.
 *   - `'barometer'`: the raw FIT altitude channel (`barometricAltitude`),
 *     regardless of which display profile the analysis runs on.
 *   - `'manual'`: a user-entered difference in metres, taken verbatim — the
 *     user asserted the number, so neither the velodrome flag nor channel
 *     usability second-guesses it. An unset/non-finite value means 0. The one
 *     thing that does touch it is the leg direction: see below.
 *
 * MANUAL DESCRIBES THE OUTBOUND LEG. An out-and-back section is two segments
 * over the same ground in opposite directions, so one elevation difference
 * describes both: `+manual` outbound, `-manual` inbound. Without the negation a
 * single typed number claims both legs climbed, which no real course does — and
 * it would disagree with the channel-backed sources, which already come out with
 * opposite signs simply because each leg's target is measured over its own
 * window. `legDirection` is undefined in every other mode (a lap has no
 * direction), where the sign is `+1` and behaviour is unchanged.
 *
 * The channel-backed sources reproduce the branches of `calculate_metrics`
 * (`backend/src/virtual_elevation.rs`) so target and gain always describe the
 * same window:
 *   - velodrome, or an empty / all-NaN / all-zero channel → 0
 *   - a window rejected by the metrics clamp (span below two samples) → 0
 *   - otherwise `channel[trimEnd] - channel[trimStart]`, trim clamped
 */

export type ElevationDiffSource = "dem" | "barometer" | "manual";

export const ELEVATION_DIFF_SOURCES: readonly ElevationDiffSource[] = [
	"dem",
	"barometer",
	"manual",
];

/**
 * Validates rather than casts, the `toWindSource` convention
 * (`shell/dom/windSource.ts`): an unknown string is `null`, never silently
 * some default.
 */
export function toElevationDiffSource(value: string): ElevationDiffSource | null {
	return (ELEVATION_DIFF_SOURCES as readonly string[]).includes(value)
		? (value as ElevationDiffSource)
		: null;
}

export interface ClosureTargetInput {
	source: ElevationDiffSource;
	/** The segment's RESOLVED altitude profile (segment-local). */
	altitude: ArrayLike<number>;
	/**
	 * The DEM elevation channel (segment-local), when a DEM profile is
	 * loaded. `'dem'` falls back to `altitude` without it — phase 1's rule.
	 */
	demAltitude?: ArrayLike<number> | null;
	/** The raw barometric channel (segment-local), for `'barometer'`. */
	barometricAltitude?: ArrayLike<number> | null;
	/**
	 * A user-entered difference in metres, for `'manual'`. Describes the
	 * OUTBOUND leg when `legDirection` says the segment has one.
	 */
	manualDiffMetres?: number | null;
	/**
	 * The out-and-back leg this segment is (`ModeSegment.legDirection`).
	 * Undefined outside out-and-back mode. Read by `'manual'` only.
	 */
	legDirection?: "outbound" | "inbound";
	velodrome: boolean;
	/** Segment-local trim window, clamped here exactly as the solver clamps. */
	trimStart: number;
	trimEnd: number;
}

export function resolveClosureTarget(input: ClosureTargetInput): number {
	if (input.source === "manual") {
		const manual = input.manualDiffMetres;
		if (typeof manual !== "number" || !Number.isFinite(manual)) {
			return 0;
		}
		// `-0` for an inbound leg with a 0 difference would be a pointless way
		// to differ from every other zero this module returns.
		return input.legDirection === "inbound" && manual !== 0 ? -manual : manual;
	}

	const channel =
		input.source === "barometer"
			? (input.barometricAltitude ?? input.altitude)
			: (input.demAltitude ?? input.altitude);

	if (input.velodrome || !hasUsableAltitude(channel)) {
		return 0;
	}

	// Mirrors `metrics_window`'s usable-altitude branch: clamp the end to the
	// profile, the start to the end, and report 0 for a window the metrics
	// reject (fewer than three samples, or a span below two).
	const length = channel.length;
	if (length < 3) {
		return 0;
	}
	const end = Math.min(Math.trunc(input.trimEnd), length - 1);
	const start = Math.min(Math.trunc(input.trimStart), end);
	if (end <= start || end - start < 2) {
		return 0;
	}
	return channel[end] - channel[start];
}

/**
 * `calculate_metrics`' usability rule: the channel counts only when it is
 * non-empty and neither all-NaN nor all-zero.
 */
export function hasUsableAltitude(altitude: ArrayLike<number>): boolean {
	if (altitude.length === 0) {
		return false;
	}
	let allNan = true;
	let allZero = true;
	for (let i = 0; i < altitude.length; i++) {
		const value = altitude[i];
		if (!Number.isNaN(value)) {
			allNan = false;
		}
		if (value !== 0) {
			allZero = false;
		}
		if (!allNan && !allZero) {
			return true;
		}
	}
	return false;
}
