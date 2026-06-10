/**
 * Tire temperature compensation for Crr.
 *
 * Model: exponential decay with a high-temperature floor, anchored at 22 °C
 * (BRR's standard lab test temperature), with a tire-sensitivity exponent s.
 * Derived from Escape Collective / Tom Anhalt / bicyclerollingresistance.com
 * data; see docs/superpowers/specs/2026-06-10-crr-temperature-compensation-design.md.
 *
 * Validity: ambient ~5–40 °C, tire at steady state (10+ min riding).
 */

export type TireSensitivity = "stiff" | "typical" | "supple";

export const TIRE_SENSITIVITY_PRESETS: Record<TireSensitivity, number> = {
	stiff: 0.5, // e.g. Conti GP 5000 S TR, Michelin Power Road TLR
	typical: 0.8, // default; GP Urban, Pro One V-Guard, Corsa Speed
	supple: 1.0, // e.g. Pirelli P Zero TLR Race (EC reference)
};

export const DEFAULT_TIRE_SENSITIVITY: TireSensitivity = "typical";

/** Anchor temperature in °C (BRR lab test temperature). */
export const CRR_TEMP_ANCHOR_C = 22;

/** Soft validity range of the model in °C. */
export const CRR_TEMP_VALID_MIN_C = 5;
export const CRR_TEMP_VALID_MAX_C = 40;

function baseCurve(tempC: number): number {
	return 1.095 * Math.exp(-0.07 * tempC) + 0.763;
}

/**
 * Multiplicative Crr correction factor for ambient temperature tempC and
 * tire-sensitivity exponent s. factor(22, s) = 1 for any s.
 */
export function crrTempFactor(tempC: number, s: number): number {
	// Keep the explicit anchor division: documents the 22 °C reference and
	// stays correct if the curve coefficients change.
	return Math.pow(baseCurve(tempC) / baseCurve(CRR_TEMP_ANCHOR_C), s);
}

/** Convert a 22 °C-referenced Crr to the Crr at ambient temperature tempC. */
export function applyCrrTempCorrection(
	crr22: number,
	tempC: number,
	s: number,
): number {
	return crr22 * crrTempFactor(tempC, s);
}

/**
 * Subset of AnalysisParameters consumed by the correction. Structural typing
 * keeps this module free of UI imports.
 */
export interface CrrTempCorrectionParams {
	crr_temp_correction?: boolean;
	ambient_temp_c?: number | null;
	tire_sensitivity?: TireSensitivity;
}

/**
 * Resolve the Crr actually used in the VE physics. The slider value is the
 * 22 °C-referenced Crr; when the correction is enabled and an ambient
 * temperature is set, scale it to the session temperature. Otherwise return
 * it unchanged (correction is opt-in and never applied silently).
 */
export function resolveAppliedCrr(
	params: CrrTempCorrectionParams,
	crr: number,
): number {
	if (!params.crr_temp_correction) return crr;
	const tempC = params.ambient_temp_c;
	if (tempC === null || tempC === undefined || Number.isNaN(tempC)) return crr;
	const s =
		TIRE_SENSITIVITY_PRESETS[
			params.tire_sensitivity ?? DEFAULT_TIRE_SENSITIVITY
		];
	return applyCrrTempCorrection(crr, tempC, s);
}
