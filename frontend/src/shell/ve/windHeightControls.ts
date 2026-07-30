import type { AnalysisParameters } from "../../components/AnalysisParameters";
import {
	DEFAULT_WIND_HEIGHT_FACTOR,
	LEGACY_WIND_HEIGHT_FACTOR,
	WIND_HEIGHT_FACTOR_MAX,
	WIND_HEIGHT_FACTOR_MIN,
	WIND_HEIGHT_FACTOR_STEP,
	WIND_HEIGHT_FITTED_MAX,
	WIND_HEIGHT_FITTED_MIN,
	resolveAppliedWindSpeed,
	resolveWindHeightFactor,
} from "../../analysis/WindHeightTransfer";

/**
 * Shared "Wind height factor" control block rendered under the Crr controls in
 * all three VE mode sidebars (standard, GPS lap, out-and-back).
 *
 * The wind field holds the wind as reported at the model's 10 m reference
 * height (D-03); the VE physics uses wind_speed × k (D-04). It applies to
 * weather-sourced constant wind only, never the FIT sensor channel (D-01),
 * which is already measured at the rider.
 *
 * This module's use of resolveAppliedWindSpeed is display-only: it produces a
 * readout string and nothing else. The physics application point remains the
 * single effectiveWindSpeed hoist in VeCalculatorFactory.createVeCalculator.
 * The transfer is deliberately not re-implemented here — two copies of k × wind
 * would drift apart, so the readout calls the same resolver the physics does.
 */

/**
 * Which prompt, if any, the readout must carry.
 *
 * Both prompts fire on the same structural condition — the factor is still the
 * legacy pass-through 1.0 *and* the wind did not come from the weather API — but
 * they make different claims, so they are separate branches with separate
 * wording. Deriving both the readout text and windHeightReadoutIsWarning from
 * this one helper keeps the visible text and the CSS modifier from diverging.
 *
 * Note this is not a "false alarm" when a user deliberately returns the slider
 * to 1.00: at k = 1.00 the wind genuinely is untransferred, so both wordings
 * still read truthfully. Moving the slider off 1.00 is the single resolution
 * mechanism for both branches, which is why neither branch mutates wind_entry.
 */
type WindHeightPrompt = "manual" | "unknown" | null;

function windHeightPrompt(params: AnalysisParameters): WindHeightPrompt {
	if (resolveWindHeightFactor(params) !== LEGACY_WIND_HEIGHT_FACTOR) {
		return null;
	}
	// D-05: the app does not guess what a hand-typed wind means.
	if (params.wind_entry === "manual") return "manual";
	// D-06 as amended: a record saved before this feature existed.
	if (params.wind_entry === "unknown") return "unknown";
	// A weather-sourced wind at k = 1.00 is a deliberate choice, not an unset
	// factor, so it carries no prompt.
	return null;
}

/**
 * The readout shown next to the k slider: the wind the rider actually feels,
 * the factor that produced it, and the raw 10 m wind it came from.
 *
 * Pure — no DOM. Both prompts live here rather than in the binder so they are
 * assertable without jsdom and so they clear automatically the moment k moves.
 */
export function formatWindHeightReadout(params: AnalysisParameters): string {
	const raw = params.wind_speed;
	// No constant wind is configured, so there is nothing to report.
	if (raw === null || raw === undefined || Number.isNaN(raw)) return "";

	const factor = resolveWindHeightFactor(params);
	const applied = resolveAppliedWindSpeed(params, raw);
	if (applied === null) return "";

	let text = `Rider-height wind: ${applied.toFixed(2)} m/s (×${factor.toFixed(2)} of ${raw.toFixed(2)} m/s at 10 m)`;

	const prompt = windHeightPrompt(params);
	if (prompt === "manual") {
		// D-05: used exactly as typed, and said so out loud.
		text +=
			" — this wind was entered by hand, so it is used exactly as typed with no height transfer;" +
			" set the factor to match how the number was measured (a 10 m forecast, or a reading taken at the rider).";
		return text;
	}
	if (prompt === "unknown") {
		// D-06 amendment: truthful about the uncertainty, and careful not to
		// claim a hand entry that may never have happened.
		text +=
			" — this analysis was saved before the height factor existed, so the wind is used exactly as stored" +
			" and it is not recorded which input wrote it; the factor needs setting.";
		return text;
	}

	// R-02: the fit is single-venue, so the slider deliberately extends past
	// both ends of it. Parallel to the Crr validity-range suffix.
	if (factor < WIND_HEIGHT_FITTED_MIN || factor > WIND_HEIGHT_FITTED_MAX) {
		text += ` — outside the ${WIND_HEIGHT_FITTED_MIN.toFixed(2)}–${WIND_HEIGHT_FITTED_MAX.toFixed(2)} fitted range, measured at a single open venue`;
	}
	return text;
}

/**
 * True when the readout carries either prompt, so the binder can toggle the
 * CSS modifier without string-matching the readout text.
 */
export function windHeightReadoutIsWarning(params: AnalysisParameters): boolean {
	return windHeightPrompt(params) !== null;
}

const WIND_HEIGHT_INFO_TOOLTIP =
	"Weather models report wind at a 10 m reference height, but the rider sits inside " +
	"the surface shear layer, so only a fraction k of that wind actually loads them.&#10;&#10;" +
	"The fitted exposure range is 0.40–0.65, measured at a single open venue — 0.5 is a " +
	"defensible default, not a constant. Sheltered courses will differ.&#10;&#10;" +
	"Tuning this alongside CdA is not identifiable on arbitrary rides: more wind scaling " +
	"can be compensated by less CdA to fit the same power balance. Set it from how the " +
	"wind was measured, not by whichever value flattens the curve.";

/**
 * The control block's markup, for the sidebars to interpolate.
 *
 * T-08-02: every interpolated value is a number produced by toFixed or one of
 * the exported numeric constants, plus the readout string this module builds
 * from those same numbers. No user-controlled string reaches the template.
 */
export function windHeightControlsMarkup(params: AnalysisParameters): string {
	const factor = resolveWindHeightFactor(params).toFixed(2);
	// D-02: bounds come from the constants, never re-literalled here.
	const min = WIND_HEIGHT_FACTOR_MIN;
	const max = WIND_HEIGHT_FACTOR_MAX;
	const step = WIND_HEIGHT_FACTOR_STEP;

	return `
        <div class="ve-control-group wind-height-controls" id="windHeightControls">
            <label class="wind-height-controls__label" for="windHeightSlider">
                Wind height factor (k):
                <span id="windHeightInfo" class="wind-height-controls__info" title="${WIND_HEIGHT_INFO_TOOLTIP}">i</span>
            </label>
            <div class="wind-height-controls__row">
                <input type="range" id="windHeightSlider" min="${min}" max="${max}" value="${factor}" step="${step}" class="ve-slider">
                <input type="number" id="windHeightValue" value="${factor}" min="${min}" max="${max}" step="${step}" class="ve-value-input">
            </div>
            <div id="windHeightReadout" class="wind-height-controls__readout">${formatWindHeightReadout(params)}</div>
        </div>
    `;
}

/**
 * Decide what a fresh Weather-API wind fill should do to the height fields.
 * Returns the fields for the caller to merge rather than writing params here,
 * which keeps the decision pure and testable with no bind() call at all.
 *
 * Three cases:
 * - "weather" → {}. D-06's original job: this is a *refill*, and a trim-slider
 *   move that forces a refetch must not clobber a k the user tuned for their
 *   venue.
 * - "unknown" → {}. The D-06 amendment: a reopened pre-feature record is never
 *   a first fill. Seeding here would re-seed k to 0.5 whenever auto-rho is on,
 *   silently re-fitting an analysis the maintainer has already read
 *   (D-07 / R-04). The record stays at k = 1.0 and keeps prompting; wind_entry
 *   is deliberately left "unknown" so the prompt persists — moving the slider
 *   is what resolves it, exactly as for the D-05 branch.
 * - "manual" or absent → seed. A weather fill arriving after a manual entry
 *   does re-seed k to 0.5, which is correct: the API has just overwritten the
 *   typed number with its own 10 m value.
 *
 * The field is never *inferred* from rho_source or weather_metadata.
 * rho_source is carried over verbatim on every form edit, so a
 * weather-fill-then-hand-type sequence would misclassify as "weather" and
 * re-seed k = 0.5 onto a number the user typed — the exact D-05 harm.
 */
export function syncWindHeightFromWeather(
	params: AnalysisParameters,
): Partial<AnalysisParameters> {
	if (params.wind_entry === "weather") return {};
	if (params.wind_entry === "unknown") return {};
	return {
		wind_entry: "weather",
		wind_height_factor: DEFAULT_WIND_HEIGHT_FACTOR,
	};
}
