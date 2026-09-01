import type { ActivityDataLike, AppState } from "../../state/AppState";
import { applyBaroLag } from "../../analysis/BaroLag";
import {
	DEM_PROFILE_FALLBACK_ORDER,
	type ElevationDisplayProfile,
	type ReferenceElevationSeries,
} from "../../analysis/elevationProfiles";

export interface ResolvedElevationProfile {
	profile: ElevationDisplayProfile;
	altitude: number[];
}

function hasValidProfile(
	profile: number[] | null,
	expectedLength: number,
): boolean {
	return !!profile && profile.length === expectedLength;
}

/**
 * Identity-stable barometric lag correction (`params.baro_lag_seconds`).
 *
 * Downstream memos key on the ARRAY IDENTITY of what this module returns
 * (updateGpsLap's mean-elevation cache compares `elevation ===`), so the
 * shifted array must stay the same object until the raw channel or the lag
 * actually changes. `appState.fitRawElevation` itself always stays RAW - the
 * lag is applied on the way out, so a lag edit needs no cache invalidation.
 *
 * Only barometric channels come through here: the fit-raw profile and the
 * 'barometer' closure source. DEM profiles are position-derived and are
 * returned untouched by `resolveElevationProfile`.
 */
const baroLagCache = new WeakMap<number[], { lag: number; shifted: number[] }>();

function withBaroLag(raw: number[], lagSeconds: number): number[] {
	if (Math.round(lagSeconds) === 0) {
		return raw;
	}
	const hit = baroLagCache.get(raw);
	if (hit && hit.lag === lagSeconds) {
		return hit.shifted;
	}
	const shifted = applyBaroLag(raw, lagSeconds);
	baroLagCache.set(raw, { lag: lagSeconds, shifted });
	return shifted;
}

function baroLagOf(appState: AppState): number {
	return appState.currentParameters?.baro_lag_seconds ?? 0;
}

export function resolveElevationProfile(
	appState: AppState,
	fitData: ActivityDataLike,
	normalizedAltitude: number[],
): ResolvedElevationProfile {
	const expectedLength = normalizedAltitude.length;

	const fitRaw = appState.fitRawElevation;
	if (hasValidProfile(fitRaw, expectedLength)) {
		// keep valid cached fit raw
	} else {
		appState.fitRawElevation = [...normalizedAltitude];
	}

	const current = appState.activeDisplayProfile;
	if (current === "fit-raw") {
		return {
			profile: "fit-raw",
			altitude: withBaroLag(
				appState.fitRawElevation ?? [...normalizedAltitude],
				baroLagOf(appState),
			),
		};
	}

	const byProfile: Record<ElevationDisplayProfile, number[] | null> = {
		"fit-raw": appState.fitRawElevation,
		"dem-raw-nearest": appState.demRawNearestElevation,
		"dem-interpolated-smoothed-5pt":
			appState.demInterpolatedSmoothed5ptElevation,
	};

	if (hasValidProfile(byProfile[current], expectedLength)) {
		return { profile: current, altitude: byProfile[current]! };
	}

	// fallback order: dem-raw-nearest -> dem-interpolated-smoothed-5pt
	for (const profile of DEM_PROFILE_FALLBACK_ORDER) {
		const candidate = byProfile[profile];
		if (hasValidProfile(candidate, expectedLength)) {
			return { profile, altitude: candidate! };
		}
	}

	return {
		profile: "fit-raw",
		altitude: withBaroLag(
			appState.fitRawElevation ?? Array.from(fitData.altitude),
			baroLagOf(appState),
		),
	};
}

/**
 * The NON-master elevation channel, for drawing beside the resolved profile
 * (both channels are shown by default; the import only decides the master).
 *
 * - master `fit-raw`  -> the best valid DEM channel, in
 *   `DEM_PROFILE_FALLBACK_ORDER` — the same preference the closure fallback
 *   uses, so what is drawn is what a 'dem' target would measure;
 * - master DEM        -> the cached raw FIT barometric channel, lag-corrected
 *   through the same identity-stable memo the master path uses (so downstream
 *   `===` caches keyed on this array stay honest).
 *
 * Returns null when the counterpart channel does not exist at this length —
 * no DEM loaded under a fit-raw master, or a DEM master whose FIT channel was
 * never cached — and under velodrome, where actual elevation is zeroed and a
 * real channel behind it would be noise. Display-only: nothing returned here
 * feeds metrics, closure targets or the physics, which is why this cannot
 * move a golden literal.
 */
export function resolveReferenceElevation(
	appState: AppState,
	masterProfile: ElevationDisplayProfile,
	expectedLength: number,
): ReferenceElevationSeries | null {
	if (appState.currentParameters?.velodrome) {
		return null;
	}

	if (masterProfile === "fit-raw") {
		const byProfile: Record<ElevationDisplayProfile, number[] | null> = {
			"fit-raw": null,
			"dem-raw-nearest": appState.demRawNearestElevation,
			"dem-interpolated-smoothed-5pt":
				appState.demInterpolatedSmoothed5ptElevation,
		};
		for (const profile of DEM_PROFILE_FALLBACK_ORDER) {
			const candidate = byProfile[profile];
			if (hasValidProfile(candidate, expectedLength)) {
				return { label: "DEM", series: candidate! };
			}
		}
		return null;
	}

	// A DEM master. The reference is the true barometric channel, which is
	// ONLY the load-time cache: after a DEM load `set_altitude` has replaced
	// the FIT altitude with DEM values, so falling back to the normalized
	// channel here would draw the DEM against itself and label it Barometer.
	const raw = appState.fitRawElevation;
	if (!hasValidProfile(raw, expectedLength)) {
		return null;
	}
	// Same usability rule as `calculate_metrics` (empty / all-NaN / all-zero
	// altitude is not a channel): the rides that carry no barometer at all
	// would otherwise draw a flat "Barometer" line that measures nothing.
	if (!raw!.some((value) => Number.isFinite(value) && value !== 0)) {
		return null;
	}
	return { label: "Barometer", series: withBaroLag(raw!, baroLagOf(appState)) };
}

/**
 * The raw barometric channel for the 'barometer' closure-target source,
 * lag-corrected. Reads the cached fit-raw channel (which IS the FIT file's
 * barometric altitude) regardless of the active display profile - choosing
 * Barometer while a DEM trace is on screen must still measure the barometer.
 */
export function resolveClosureBaroAltitude(
	appState: AppState,
	normalizedAltitude: number[],
): number[] {
	const raw = hasValidProfile(
		appState.fitRawElevation,
		normalizedAltitude.length,
	)
		? appState.fitRawElevation!
		: normalizedAltitude;
	return withBaroLag(raw, baroLagOf(appState));
}

/**
 * The DEM elevation channel for the closure target ('dem' source, phase 2).
 *
 * Prefers the ACTIVE display profile when it is itself a DEM profile — so the
 * target matches the elevation trace on screen — then falls through
 * `DEM_PROFILE_FALLBACK_ORDER`. Returns null when no valid DEM profile is
 * loaded; the caller then leaves `demAltitude` unset and
 * `resolveClosureTarget` falls back to the resolved analysis profile, which is
 * exactly the phase-1 behaviour.
 */
export function resolveClosureDemAltitude(
	appState: AppState,
	expectedLength: number,
): number[] | null {
	const byProfile: Record<ElevationDisplayProfile, number[] | null> = {
		"fit-raw": null,
		"dem-raw-nearest": appState.demRawNearestElevation,
		"dem-interpolated-smoothed-5pt":
			appState.demInterpolatedSmoothed5ptElevation,
	};

	const active = appState.activeDisplayProfile;
	if (
		active !== "fit-raw" &&
		hasValidProfile(byProfile[active] ?? null, expectedLength)
	) {
		return byProfile[active];
	}

	for (const profile of DEM_PROFILE_FALLBACK_ORDER) {
		const candidate = byProfile[profile] ?? null;
		if (hasValidProfile(candidate, expectedLength)) {
			return candidate;
		}
	}
	return null;
}
