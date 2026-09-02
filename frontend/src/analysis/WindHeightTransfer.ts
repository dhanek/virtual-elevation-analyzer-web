/**
 * 10 m → rider wind height transfer.
 *
 * Open-Meteo reports wind at a 10 m reference height. The rider sits at roughly
 * bike height, inside the surface shear layer, so only a fraction k of the
 * reported 10 m wind actually loads them:
 *
 *     head/tail = k × w10 × cos(heading − dir10)
 *
 * k is the per-heading exposure |P| — "fraction of the 10 m wind reaching bike
 * height" — fitted in `vw-demo/analysis/r4/` (`r4_transfer_direct.py`,
 * `r4_venue_map.py`) with a stated physical range of 0.40–0.65. The measured
 * basis, the k-sweep tables and the CdA-ceiling consequence (H-2.1) live in
 * `.planning/phases/06-weather-spike/06-FINDINGS.md`, section
 * "10 m→rider wind height transfer"; probe artifact
 * `vw-demo/out/weather-spike/height_factor_probe.json`.
 *
 * Validity: |P| was fitted at a single open venue. 0.5 is therefore a
 * defensible default and NOT a measured constant — generalising the fit to
 * arbitrary terrain (forest, town, valley) is not validated, and shelter is
 * precisely what makes |P| vary. Sheltered venues will differ.
 *
 * D-01: k applies to weather-sourced constant wind only — never the FIT sensor
 * channel (WindSourceResolver.ts). Sensor air speed is already measured at the
 * rider, and the Rust ignores the constant wind entirely when a sensor series
 * is present.
 * D-09: k scales speed only; wind_direction is never multiplied. Height
 * transfer changes how hard the wind pushes, not where it comes from.
 */

/** D-02: maintainer-requested default — half the 10 m wind reaches the rider. */
export const DEFAULT_WIND_HEIGHT_FACTOR = 0.5;

/**
 * No transfer — the wind is used exactly as reported or typed.
 *
 * D-07: this is the value records saved before this feature load at, so
 * reopening a stored analysis reproduces the result the maintainer already saw
 * instead of quietly re-fitting it. D-05: it is also the value a hand-typed
 * wind is used at, because the app does not guess whether a typed number is a
 * 10 m forecast or an anemometer reading taken at the rider.
 */
export const LEGACY_WIND_HEIGHT_FACTOR = 1.0;

/**
 * Factor bounds. The top of the range, 1.0, means no transfer.
 *
 * D-b (maintainer ruling, 2026-08-30): the floor opened from 0.3 to 0 so the
 * control can span a full 0-100%. 0 is a legitimate setting — a fully sheltered
 * course where no wind reaches the rider — and `resolveWindHeightFactor` honours
 * it; see the guard there for why that had to change with these bounds.
 */
export const WIND_HEIGHT_FACTOR_MIN = 0;
export const WIND_HEIGHT_FACTOR_MAX = 1.0;
export const WIND_HEIGHT_FACTOR_STEP = 0.01;

/**
 * The scale the CONTROL speaks (D-b). Storage stays the 0-1 factor above, so no
 * persisted record changes meaning and no migration is owed — only the numbers
 * on screen move. Every conversion goes through the two helpers below so the
 * rounding rule lives in exactly one place.
 */
export const WIND_HEIGHT_PERCENT_MIN = 0;
export const WIND_HEIGHT_PERCENT_MAX = 100;
export const WIND_HEIGHT_PERCENT_STEP = 1;

/**
 * Stored factor -> displayed percent, and back.
 *
 * Both round. 0.01 steps are not representable in IEEE754, so an unrounded
 * round-trip yields 0.07000000000000001 and a readout of "7.000000000000001%".
 * Rounding at the boundary keeps the stored factor to two decimals and the
 * displayed percent to an integer, which is what makes the two agree.
 */
export function factorToPercent(factor: number): number {
	return Math.round(factor * 100);
}

export function percentToFactor(percent: number): number {
	return Math.round(percent) / 100;
}

/**
 * The fitted |P| range. The slider deliberately extends past both ends: the fit
 * is single-venue, so a sheltered course may genuinely sit below the lower
 * bound, and the user must always be able to ask for no transfer at all.
 */
export const WIND_HEIGHT_FITTED_MIN = 0.4;
export const WIND_HEIGHT_FITTED_MAX = 0.65;

/**
 * Which input last wrote the wind — an observable event, not a claim about what
 * the number means. Deliberately separate from `rho_source`, which answers a
 * different question ("is this still live for this trim region?").
 *
 * D-06, as amended: the enum carries three values, not two. "unknown" is for
 * records saved before this feature, where there is simply no record of which
 * input wrote the wind. Such a record is never treated as a first fill, so a
 * later auto-rho weather fill cannot re-seed k and silently re-fit an analysis
 * the maintainer has already read (D-07 / R-04). Its k stays at 1.0 until the
 * user moves the slider or types a wind.
 *
 * Normalising a legacy record to "manual" instead was rejected: the wind may
 * well have come from the API, so the claim is false and the readout would
 * prompt for a hand entry that never happened. Inferring "weather" from
 * `rho_source` / `weather_metadata` was rejected too — `rho_source` is carried
 * over verbatim on every form edit, so a weather-fill-then-hand-type sequence
 * would misclassify as "weather" and re-seed k = 0.5 onto a number the user
 * typed, which is exactly the D-05 harm. Do not infer provenance anywhere.
 */
export type WindEntry = "weather" | "manual" | "unknown";

/**
 * Subset of AnalysisParameters consumed by the transfer. Structural typing
 * keeps this module free of UI imports.
 */
export interface WindHeightTransferParams {
	wind_height_factor?: number;
	wind_entry?: WindEntry;
}

/**
 * Resolve the height factor actually applied to the wind.
 *
 * Every guard returns LEGACY_WIND_HEIGHT_FACTOR, i.e. today's behaviour, so a
 * missing or corrupt persisted value degrades to "no transfer" rather than
 * pushing NaN wind across the WASM boundary.
 *
 * A valid stored value is returned verbatim and is never narrowed to the
 * slider range: a stored 0.65 is legitimate, and silently rewriting a
 * persisted user choice is the class of bug D-03 exists to avoid.
 */
export function resolveWindHeightFactor(
	params: WindHeightTransferParams,
): number {
	const factor = params.wind_height_factor;
	// D-07: absent factor means a pre-feature record — no transfer.
	if (typeof factor !== "number") return LEGACY_WIND_HEIGHT_FACTOR;
	// A hand-edited or corrupt IndexedDB record must not reach the physics.
	if (!Number.isFinite(factor)) return LEGACY_WIND_HEIGHT_FACTOR;
	// D-b: `<= 0` here, not `< 0`, until the control gained its 0-100% scale.
	// Once 0% is reachable a stored 0 is a CHOICE — "no wind reaches the rider"
	// on a fully sheltered course — and mapping it to 1.0 would have applied the
	// full wind, the exact opposite of what the slider reads. Negative values
	// remain impossible from any input and still degrade to no transfer.
	//
	// Consequence, stated rather than hidden: a pre-existing record storing
	// exactly 0 changes meaning. The UI could never write one (the old floor was
	// 0.3 and the number input clamped to it), so this reaches only a corrupt or
	// hand-edited row.
	if (factor < 0) return LEGACY_WIND_HEIGHT_FACTOR;
	return factor;
}

/**
 * Resolve the wind speed handed to the VE physics: the reported 10 m wind
 * scaled to rider height.
 *
 * At k = 1.0 the result is bit-identical to the pre-feature value, because
 * `x * 1.0 === x` exactly in IEEE754. The parity guarantee is therefore
 * structural, not coincidental — no guard here rounds, defaults or rewrites.
 *
 * D-09: only the magnitude is scaled; callers pass wind_direction through
 * untouched.
 */
export function resolveAppliedWindSpeed(
	params: WindHeightTransferParams,
	windSpeed: number | null,
): number | null {
	// A null wind means "no wind", not "zero after scaling".
	if (windSpeed === null || typeof windSpeed === "undefined") return null;
	// D-07: a non-finite wind is left exactly as it arrived.
	if (!Number.isFinite(windSpeed)) return windSpeed;
	return windSpeed * resolveWindHeightFactor(params);
}
