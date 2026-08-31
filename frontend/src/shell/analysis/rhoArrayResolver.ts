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

/**
 * The same series, sliced onto ONE analyze selection.
 *
 * Standard's analyze leg builds its calculator over the concatenated,
 * deduplicated selection rather than over a full-activity range, so it cannot
 * reuse `updateModeVEPlots`' per-segment `indices.map(...)` slice. It was
 * therefore left with no `rhoArray` at all when the two GPS legs were fixed,
 * which meant the placeholder fit integrated a constant `params.rho` while the
 * update a macrotask later integrated the real per-point series — and, since
 * that paint now also writes the R²/RMSE/VE/Actual header, the wrong numbers
 * were on screen until the kick landed, or permanently on any path where the
 * scheduled pass never reaches `renderVe`.
 *
 * `expectedLength` is the calculator's other series' length. Anything else
 * means the selection and the density series are not in the same index space,
 * and a short or hole-punched array under the calculator is a worse bug than a
 * constant one — the same rule `resolvePlaceholderWindSpeed` applies to wind.
 */
export function resolveSelectionRhoArray(
	fitData: ActivityDataLike,
	selectedIndices: number[],
	expectedLength: number,
): number[] | null {
	const all = resolveRhoArray(fitData);
	if (!all) {
		return null;
	}

	const sliced: number[] = [];
	for (const index of selectedIndices) {
		if (index < 0 || index >= all.length) {
			log.warn(
				`Air density series (${all.length}) does not span selection index ${index}; using constant rho`,
			);
			return null;
		}
		sliced.push(all[index]);
	}

	// An empty selection is "the whole activity", which is what the unsliced
	// series already is.
	const selection = selectedIndices.length === 0 ? all : sliced;
	if (selection.length !== expectedLength) {
		log.warn(
			`Air density series (${selection.length}) does not match the analysed selection (${expectedLength}); using constant rho`,
		);
		return null;
	}
	return selection;
}
