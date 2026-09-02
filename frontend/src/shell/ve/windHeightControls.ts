import type { AnalysisParameters } from "../../components/AnalysisParameters";
import {
	DEFAULT_WIND_HEIGHT_FACTOR,
	LEGACY_WIND_HEIGHT_FACTOR,
	WIND_HEIGHT_FACTOR_MAX,
	WIND_HEIGHT_FACTOR_MIN,
	WIND_HEIGHT_FITTED_MAX,
	WIND_HEIGHT_FITTED_MIN,
	WIND_HEIGHT_PERCENT_MAX,
	WIND_HEIGHT_PERCENT_MIN,
	WIND_HEIGHT_PERCENT_STEP,
	factorToPercent,
	percentToFactor,
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
type WindHeightPrompt = "manual" | "unknown" | "unrepresentable" | null;

/**
 * Can the control actually render this factor? (WR-07)
 *
 * Storage never narrows a persisted value (D-03), so a factor outside 0-1 loads
 * intact and reaches the physics intact. The range element cannot follow it: its
 * thumb pins at the bound. Left unsaid, that produced three disagreeing views —
 * slider at 100, number at 150, readout at 150% — and the first touch of the
 * thumb committed the narrowing over a value the user never chose to change.
 * Saying it is the fix; clamping storage would be the bug.
 */
function isUnrepresentableFactor(factor: number): boolean {
	return factor < WIND_HEIGHT_FACTOR_MIN || factor > WIND_HEIGHT_FACTOR_MAX;
}

function windHeightPrompt(params: AnalysisParameters): WindHeightPrompt {
	// Checked FIRST: an unrepresentable factor is about to be destroyed by the
	// next gesture, which outranks a prompt about how the wind was measured.
	if (isUnrepresentableFactor(resolveWindHeightFactor(params))) {
		return "unrepresentable";
	}
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
	// No usable constant wind is configured, so there is nothing to report.
	// `Number.isFinite` also rejects NaN and the infinities, which the earlier
	// guard did not: +/-Infinity reached `toFixed` and printed "Infinity m/s"
	// (IN-02). The null/undefined arms stay because `Number.isFinite` is typed
	// `(value: unknown) => boolean` and so narrows nothing on its own.
	if (raw === null || raw === undefined || !Number.isFinite(raw)) return "";

	const factor = resolveWindHeightFactor(params);
	const applied = resolveAppliedWindSpeed(params, raw);
	if (applied === null) return "";

	// D-b: percent, not a ×factor. The control speaks the same units, so the two
	// cannot drift apart in the user's head.
	let text = `Rider-height wind: ${applied.toFixed(2)} m/s (${factorToPercent(factor)}% of ${raw.toFixed(2)} m/s at 10 m)`;

	const prompt = windHeightPrompt(params);
	if (prompt === "unrepresentable") {
		// Names the stored value, says why the slider disagrees, and warns what
		// the next gesture costs — in that order, because the warning is the
		// part that has to arrive before the user drags.
		text +=
			` — this analysis was saved at ${factorToPercent(factor)}%, outside the 0–100% the slider covers,` +
			" so the slider cannot show it and is parked at its limit;" +
			" the stored value is what the physics uses, and moving the slider will replace it.";
		return text;
	}
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
		text += ` — outside the ${factorToPercent(WIND_HEIGHT_FITTED_MIN)}–${factorToPercent(WIND_HEIGHT_FITTED_MAX)}% fitted range, measured at a single open venue`;
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
	"The fitted exposure range is 40–65%, measured at a single open venue — 50% is a " +
	"defensible default, not a constant. Sheltered courses will differ.&#10;&#10;" +
	"Tuning this alongside CdA is not identifiable on arbitrary rides: more wind scaling " +
	"can be compensated by less CdA to fit the same power balance. Set it from how the " +
	"wind was measured, not by whichever value flattens the curve.";

/**
 * Whether the height factor has any job under the given wind source.
 *
 * The factor transfers a wind reported at the model's 10 m reference height
 * down to the rider (D-03/D-04), so it is meaningful exactly when the wind
 * series is *modelled* from that reference:
 *
 * - "constant" — a weather-API or hand-entered wind. The whole point of k.
 * - "compare"  — resolves a constant-wind branch alongside the FIT branch, so
 *   the factor stays live. Hiding on "not constant" would be wrong here.
 * - "fit"      — the recorded air speed is already measured at the rider
 *   (D-01), so there is no height to transfer from and the control is inert:
 *   visible, draggable, and unable to change a number.
 *
 * Anything else (no radios rendered at all, an unrecognised value) is treated
 * as "no transfer applies", matching getSelectedWindSource's "fit" fallback.
 */
export function windHeightAppliesTo(
	windSource: string | null | undefined,
): boolean {
	return windSource === "constant" || windSource === "compare";
}

/**
 * Show or hide the control block to match the selected wind source.
 *
 * VISIBILITY ONLY, and that is a load-bearing claim rather than a comment: the
 * element stays in the DOM with both inputs holding their values, and
 * `wind_height_factor` lives in AnalysisParameters. Every consumer reads the
 * model — resolveWindHeightFactor(params), and through it the single
 * effectiveWindSpeed hoist in VeCalculatorFactory.createVeCalculator — and
 * nothing outside this module's own handlers reads `#windHeightSlider`. So a
 * hidden control changes nothing that is computed, and toggling the source back
 * and forth returns the same k that was there before.
 *
 * Called from bindWindSourceRadios (shell/dom/windSource.ts) so that all three
 * sidebars get it from the one binder they already share, at bind time and on
 * every change, rather than from three parallel handlers.
 */
export function syncWindHeightControlsVisibility(
	windSource: string | null | undefined,
): void {
	const controls = document.getElementById("windHeightControls");
	if (!controls) return;
	controls.hidden = !windHeightAppliesTo(windSource);
}

/**
 * The control block's markup, for the sidebars to interpolate.
 *
 * T-08-02: every interpolated value is a number produced by toFixed or one of
 * the exported numeric constants, plus the readout string this module builds
 * from those same numbers. No user-controlled string reaches the template.
 *
 * `windSource` is optional and only decides the block's INITIAL hidden state.
 * bindWindSourceRadios re-syncs it the moment it binds, so a caller that omits
 * it still ends up correct — it just risks one frame of a visible control on
 * paths that await between innerHTML and the bind (Standard awaits
 * initializeVEAnalysis). Passing it is the difference between no flash and a
 * flash, never between right and wrong.
 */
export function windHeightControlsMarkup(
	params: AnalysisParameters,
	windSource?: string | null,
): string {
	// D-b: the CONTROL is in percent, the MODEL stays a 0-1 factor. Every
	// crossing goes through factorToPercent/percentToFactor.
	const percent = factorToPercent(resolveWindHeightFactor(params));
	// D-02: bounds come from the constants, never re-literalled here.
	const min = WIND_HEIGHT_PERCENT_MIN;
	const max = WIND_HEIGHT_PERCENT_MAX;
	const step = WIND_HEIGHT_PERCENT_STEP;
	// Undefined means "the caller has not decided" — stay visible and let the
	// bind-time sync settle it. An explicit source hides immediately.
	const hidden =
		windSource !== undefined && windSource !== null
			? !windHeightAppliesTo(windSource)
			: false;

	return `
        <div class="ve-control-group wind-height-controls" id="windHeightControls"${hidden ? " hidden" : ""}>
            <label class="wind-height-controls__label" for="windHeightSlider">
                Wind height factor (k):
                <span id="windHeightInfo" class="wind-height-controls__info" title="${WIND_HEIGHT_INFO_TOOLTIP}">i</span>
            </label>
            <div class="wind-height-controls__row">
                <input type="range" id="windHeightSlider" min="${min}" max="${max}" value="${percent}" step="${step}" class="ve-slider">
                <input type="number" id="windHeightValue" value="${percent}" min="${min}" max="${max}" step="${step}" class="ve-value-input">
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
/**
 * May a weather fill WRITE the wind, or does the current one belong to the user?
 *
 * Maintainer ruling (D-a, 2026-08-30): reopening a previously analysed file must
 * restore the exact conditions it was analysed under — the wind, its provenance
 * and the height factor. Auto-rho re-runs on load
 * (`fileLoadOrchestration.ts:389`, `bindStandardSliders.ts:632`, neither
 * suppressed by `isLoadingParameters`), and it used to assign the API's wind
 * unconditionally. Protecting only the FACTOR was never enough: a replaced wind
 * re-fits the stored analysis just as surely as a re-seeded k.
 *
 * The rule is provenance, not value:
 *   - no wind yet        -> the API fills it, and `syncWindHeightFromWeather`
 *                           claims provenance and seeds k;
 *   - "weather"          -> the API wrote it, so a fresh fetch may refresh it;
 *   - "manual"/"unknown" -> the user's number, or a legacy one that D-07 says
 *                           must reproduce as stored. Never overwritten.
 *
 * Provenance is never INFERRED here, for the same reason it is not inferred in
 * `syncWindHeightFromWeather`: `rho_source` survives every form edit, so a
 * weather-fill-then-hand-type sequence would read back as "weather" and clobber
 * a typed number — the D-05 harm.
 */
export function weatherMayFillWind(params: AnalysisParameters): boolean {
	const current = params.wind_speed;
	// Nothing to protect. `Number.isFinite` so a NaN left by a failed parse
	// counts as absent rather than freezing the field forever.
	if (current === null || current === undefined || !Number.isFinite(current)) {
		return true;
	}
	return params.wind_entry === "weather";
}

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

export interface WindHeightControlsBinding {
	/** Current analysis parameters (read live, not captured). */
	getParams: () => AnalysisParameters | null;
	/** Persist the changed fields (mode-specific storage path). */
	setParams: (fields: Partial<AnalysisParameters>) => void;
	/** Trigger the mode's VE recompute. */
	onChange: () => void;
}

/**
 * Node-identity guard for the additive #wind_speed / #wind_direction refresh
 * listeners.
 *
 * Deliberately NOT a module-level boolean. #wind_speed survives a *sidebar*
 * re-render, but it does not survive a file load: initializeAnalysisParameters()
 * (analyzeOrchestrator.ts:126) is called from fileLoadOrchestration.ts:442 and
 * demHandlers.ts:253, each constructing a new AnalysisParametersComponent whose
 * render() assigns this.container.innerHTML, destroying and recreating
 * #wind_speed / #wind_direction. A boolean would latch on the first bind and
 * leave every subsequent file's fresh nodes unbound, so from the second file
 * load onward the D-05 warning would not appear when the user types a wind.
 * A WeakSet keyed on the element handles both directions — same node, skip; new
 * node, bind — and detached nodes stay garbage-collectable.
 */
const windFieldBindings = new WeakMap<Element, WindHeightControlsBinding>();

/**
 * Attach the readout refresh to one wind field, keeping it pointed at the
 * CURRENT binding (WR-06).
 *
 * The map does both jobs the WeakSet did one of. Membership still answers "has
 * this node been bound?", so a listener is attached exactly once per node; the
 * VALUE is overwritten on every call, so the listener — which reads the binding
 * back out of the map rather than closing over it — follows the latest one. The
 * WeakSet version froze the first binding's `getParams` onto the node, which was
 * latent only because all three modes happen to pass an identical closure.
 */
function bindWindFieldRefresh(
	id: string,
	binding: WindHeightControlsBinding,
): void {
	const field = document.getElementById(id);
	if (!field) return;

	const alreadyBound = windFieldBindings.has(field);
	windFieldBindings.set(field, binding);
	if (alreadyBound) return;

	field.addEventListener("input", () =>
		refreshWindHeightReadout(windFieldBindings.get(field)?.getParams() ?? null),
	);
}

/**
 * Write the readout text into the live DOM and toggle its warning modifier.
 *
 * The modifier is driven by the predicate, never by string-matching the text.
 * textContent, never innerHTML (T-08-02).
 *
 * Text only, deliberately: this is what the live-drag path needs. See
 * refreshWindHeightReadout for why the two are separate.
 */
function refreshWindHeightText(params: AnalysisParameters): void {
	const readout = document.getElementById("windHeightReadout");
	if (!readout) return;
	readout.textContent = formatWindHeightReadout(params);
	readout.classList.toggle(
		"wind-height-controls__readout--warning",
		windHeightReadoutIsWarning(params),
	);
}

/**
 * Bring the whole control — both inputs and the readout — back in step with the
 * model. Call this after ANY write to `wind_height_factor` that did not come
 * from the control's own handlers.
 *
 * CR-01: `wind_height_factor` has three writers, and only the slider handlers
 * used to update `#windHeightSlider` / `#windHeightValue`. `markManualWindEntry`
 * (D-05) and the auto-rho weather sync write the model only, so the control was
 * left displaying a factor the physics had already stopped using. That is not
 * cosmetic: the readout tells the user to "set the factor", so they drag — and
 * the drag starts from the stale value and commits it, height-transferring a
 * wind they typed by hand. Exactly the D-05 harm markManualWindEntry prevents.
 *
 * `syncCrrTempAmbientFromWeather` mirrors its value into the live input for the
 * same reason; this follows that precedent.
 *
 * NOT used by the live-drag handler — mid-drag the model still holds the old
 * factor, so writing the inputs from it would snap the slider back under the
 * user's cursor. That path calls refreshWindHeightText instead.
 */
export function refreshWindHeightReadout(
	params: AnalysisParameters | null,
): void {
	if (!params) return;

	const percent = String(factorToPercent(resolveWindHeightFactor(params)));
	const slider = document.getElementById(
		"windHeightSlider",
	) as HTMLInputElement | null;
	const valueInput = document.getElementById(
		"windHeightValue",
	) as HTMLInputElement | null;
	if (slider) slider.value = percent;
	if (valueInput) valueInput.value = percent;

	refreshWindHeightText(params);
}

/**
 * RETURNS whether the block was actually bound, so `bindModeControls` can report
 * this row as bound or skipped from what happened here rather than from a second
 * copy of these element lookups.
 */
export function bindWindHeightControls(
	binding: WindHeightControlsBinding,
): boolean {
	const slider = document.getElementById(
		"windHeightSlider",
	) as HTMLInputElement | null;
	const valueInput = document.getElementById(
		"windHeightValue",
	) as HTMLInputElement | null;
	// The sidebar may not be rendered in this mode.
	if (!slider || !valueInput) return false;

	const initial = String(
		factorToPercent(resolveWindHeightFactor(binding.getParams() ?? {})),
	);
	slider.value = initial;
	valueInput.value = initial;
	refreshWindHeightReadout(binding.getParams());

	/**
	 * Write the factor to the model, bring the control back in step with it, and
	 * ask for a recompute.
	 *
	 * `resyncInputs` is false on the LIVE-DRAG path and true everywhere else.
	 * That is the whole of CR-01's caveat: the full refresh writes
	 * `#windHeightSlider` from the model, so calling it while the thumb is under
	 * the user's cursor would rewrite the element being dragged. The recompute
	 * itself is unconditional — it is not what CR-01 was protecting against.
	 */
	const commit = (factor: number, resyncInputs = true) => {
		binding.setParams({ wind_height_factor: factor });
		const params = binding.getParams();
		if (resyncInputs) {
			refreshWindHeightReadout(params);
		} else if (params) {
			refreshWindHeightText(params);
		}
		binding.onChange();
	};

	/**
	 * A drag recomputes live, at the same cadence as every other slider.
	 *
	 * `syncRangeAndNumber` — the shared helper behind the CdA, Crr, trim,
	 * calibration and offset rows — binds a range on `input` and a number on
	 * `change`, and this row now does exactly that. It used to commit on
	 * `change` alone, so k was the one slider in the panel that moved the plots
	 * only on release; the maintainer reported the two side by side on
	 * 2026-08-05.
	 *
	 * The original "a live drag must not fire a VE recompute per pixel" comment
	 * predates the funnel. Every request now goes through `requestModeUpdate` ->
	 * `scheduleRecompute`, which is latest-input-wins and cancels an in-flight
	 * run, so a drag ends on one pass over the newest values whichever event
	 * feeds it. k and CdA take the identical route through that funnel — same
	 * `RecomputeMode`, same debounce, same primitive, and under `compare` the
	 * same two-calculator override — so there is no cost difference that could
	 * justify a different cadence for one of them.
	 *
	 * Deliberately NO `change` listener on the slider: `change` fires after the
	 * last `input` of a drag, so a committing one would make k the only row that
	 * recomputes twice for one gesture, and it would be a second entry point to
	 * the model for the same control. Clamping is unnecessary here because the
	 * range element cannot leave its own min/max; the typed number input below
	 * is where an out-of-range value can arrive, and it still clamps.
	 */
	// D-b: both elements carry PERCENT. `commit` takes the 0-1 factor, so every
	// handler converts exactly once, at the boundary.
	slider.addEventListener("input", () => {
		const draggedPercent = parseFloat(slider.value);
		if (Number.isNaN(draggedPercent)) return;
		valueInput.value = String(Math.round(draggedPercent));
		// Commits, so this also clears the D-05 warning and the
		// "unknown"-provenance prompt the moment the thumb moves, automatically,
		// because both live in the readout formatter.
		commit(percentToFactor(draggedPercent), false);
	});

	valueInput.addEventListener("change", () => {
		const parsedPercent = parseFloat(valueInput.value);
		if (Number.isNaN(parsedPercent)) {
			// Restore the model value rather than committing garbage.
			const current = resolveWindHeightFactor(binding.getParams() ?? {});
			valueInput.value = String(factorToPercent(current));
			return;
		}
		// T-08-09: validating a live user gesture at the input boundary. This is
		// not the storage-layer clamp Plan 01 forbids — a persisted value is
		// still never rewritten.
		const clampedPercent = Math.round(
			Math.min(
				WIND_HEIGHT_PERCENT_MAX,
				Math.max(WIND_HEIGHT_PERCENT_MIN, parsedPercent),
			),
		);
		valueInput.value = String(clampedPercent);
		slider.value = String(clampedPercent);
		commit(percentToFactor(clampedPercent));
	});

	// Keep the readout and its prompts current the moment the user types a wind.
	// These are additive listeners; the modes' own handlers use oninput
	// assignment or their own addEventListener, so there is no conflict. Guarded
	// by node identity (see bindWindFieldRefresh above), not by a boolean latch.
	bindWindFieldRefresh("wind_speed", binding);
	bindWindFieldRefresh("wind_direction", binding);

	return true;
}
