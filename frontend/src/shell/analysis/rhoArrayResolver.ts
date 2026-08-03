/**
 * ONE rho resolution, shared by the analyze path and the update path.
 *
 * This logic was inlined as a closure at `analyzeOrchestrator.ts:444-465`, so
 * the analyze path had it and the update path had nothing — updates recomputed
 * VE with no per-point air density at all (D-06, and 07-RESEARCH.md baseline
 * correction 1). Extracting it means the two paths cannot diverge.
 */
import { calculateRhoArrayFromFitData } from "../dem/demHandlers";
import { getNormalizedActivityArrays } from "../../analysis/ActivityArrayCache";
import type { NormalizedActivityArrays } from "../../analysis/ActivityArrayCache";
import type { ActivityDataLike } from "../../state/AppState";
import { log } from "../../utils/log";

export function hasEnvironmentalData(fitData: ActivityDataLike): boolean {
	return !!(fitData.temperature && fitData.humidity && fitData.pressure);
}

/**
 * Resolve the FULL-ACTIVITY air-density series.
 *
 * Preference order, unchanged from the closure this replaces:
 *   1. recorded per-point air density, when any sample is usable;
 *   2. air density computed from temperature/humidity/pressure;
 *   3. null — the calculator then falls back to a constant.
 */
export function resolveRhoArray(
	fitData: ActivityDataLike,
	normalized?: NormalizedActivityArrays,
	environmentalDataPresent?: boolean,
): number[] | null {
	const currentNormalized = normalized ?? getNormalizedActivityArrays(fitData);
	const hasAirDensityData = currentNormalized.airDensity.some(
		(rho) => !isNaN(rho) && rho > 0,
	);
	if (hasAirDensityData) {
		log.debug("💨 Found air density data, using it for calculations");
		return currentNormalized.airDensity;
	}

	const environmental = environmentalDataPresent ?? hasEnvironmentalData(fitData);
	if (environmental) {
		const calculated = calculateRhoArrayFromFitData(fitData);
		if (calculated) {
			log.debug("💨 Calculated air density from environmental data");
		}
		return calculated;
	}

	log.debug("💨 No air density found, using constant value from weather API");
	return null;
}
