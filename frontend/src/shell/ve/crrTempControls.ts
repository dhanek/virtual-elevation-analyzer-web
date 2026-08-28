import type { AnalysisParameters } from "../../components/AnalysisParameters";
import {
	CRR_TEMP_VALID_MAX_C,
	CRR_TEMP_VALID_MIN_C,
	DEFAULT_TIRE_SENSITIVITY,
	TIRE_SENSITIVITY_PRESETS,
	crrTempFactor,
	type TireSensitivity,
} from "../../analysis/CrrTemperatureCorrection";

/**
 * Shared "Temperature-correct Crr" control block rendered under the Crr
 * slider in all three VE mode sidebars (standard, GPS lap, out-and-back).
 *
 * The Crr slider value is the 22 °C-referenced Crr; when the toggle is on,
 * the VE physics uses Crr × factor(T, s). Opt-in, off by default.
 */

export function formatCrrTempReadout(
	params: AnalysisParameters,
	rawCrr: number,
): string {
	if (!params.crr_temp_correction) return "";

	const tempC = params.ambient_temp_c;
	if (tempC === null || tempC === undefined || Number.isNaN(tempC)) {
		return "Enter the ambient temperature to apply the correction.";
	}

	const sensitivity = params.tire_sensitivity ?? DEFAULT_TIRE_SENSITIVITY;
	const factor = crrTempFactor(tempC, TIRE_SENSITIVITY_PRESETS[sensitivity]);
	const applied = rawCrr * factor;
	const outOfRange =
		tempC < CRR_TEMP_VALID_MIN_C || tempC > CRR_TEMP_VALID_MAX_C;

	let text = `Applied Crr @ ${tempC.toFixed(1)} °C: ${applied.toFixed(4)} (×${factor.toFixed(3)})`;
	if (outOfRange) {
		text += ` — outside the ${CRR_TEMP_VALID_MIN_C}–${CRR_TEMP_VALID_MAX_C} °C validity range`;
	}
	return text;
}

const CRR_TEMP_INFO_TOOLTIP =
	"Crr slider values are referenced to 22 °C (BRR lab test temperature). " +
	"When enabled, the VE physics uses the Crr corrected to the ambient temperature " +
	"with the selected tire sensitivity.&#10;&#10;" +
	"Valid ~5–40 °C, tire at steady state (10+ min riding). " +
	"Not worth enabling when compared sessions are within ±3 °C.&#10;&#10;" +
	"Ambient temperature is taken from the Weather API when available and " +
	"can be overwritten manually.";

export function crrTempControlsMarkup(params: AnalysisParameters): string {
	const enabled = params.crr_temp_correction === true;
	const ambient = params.ambient_temp_c ?? null;
	const sensitivity = params.tire_sensitivity ?? DEFAULT_TIRE_SENSITIVITY;

	const option = (value: TireSensitivity, label: string) =>
		`<option value="${value}" ${sensitivity === value ? "selected" : ""}>${label}</option>`;

	return `
        <div class="ve-control-group crr-temp-controls" id="crrTempControls">
            <label class="crr-temp-controls__toggle">
                <input type="checkbox" id="crrTempToggle" ${enabled ? "checked" : ""}>
                Temp-correct Crr
                <span id="crrTempInfo" class="crr-temp-controls__info" title="${CRR_TEMP_INFO_TOOLTIP}">i</span>
            </label>
            <div id="crrTempFields" class="crr-temp-controls__fields${enabled ? "" : " crr-temp-controls__fields--hidden"}">
                <div class="crr-temp-controls__row">
                    <label for="crrTempAmbient">Ambient (°C):</label>
                    <input type="number" id="crrTempAmbient" min="-10" max="50" step="0.5"
                           value="${ambient !== null ? ambient : ""}" placeholder="e.g. 18"
                           title="Ambient air temperature during the session.">
                    <select id="crrTempSensitivity" title="Tire temperature sensitivity (example tires with measured sensitivity). High s correlates with natural-rubber-rich compounds and thick tread.">
                        ${option("stiff", "Conti GP 5000 S TR, Michelin Power Road (0.5)")}
                        ${option("typical", "Vittoria Corsa Speed, Schwalbe Pro One (0.8, use if unsure)")}
                        ${option("supple", "Pirelli P Zero TLR Race (1.0)")}
                    </select>
                </div>
                <div id="crrTempReadout" class="crr-temp-controls__readout"></div>
            </div>
        </div>
    `;
}

/**
 * Sync the ambient temperature from a fresh Weather-API fetch. Returns the
 * parameter fields to merge (empty when the correction is disabled, so a
 * manual workflow is never disturbed) and mirrors the value into the visible
 * input when present.
 */
export function syncCrrTempAmbientFromWeather(
	params: AnalysisParameters,
	weatherTempC: number,
): Partial<AnalysisParameters> {
	if (!params.crr_temp_correction || Number.isNaN(weatherTempC)) return {};

	const rounded = Math.round(weatherTempC * 10) / 10;
	const ambient = document.getElementById(
		"crrTempAmbient",
	) as HTMLInputElement | null;
	if (ambient) {
		ambient.value = rounded.toString();
	}
	return { ambient_temp_c: rounded };
}

export interface CrrTempControlsBinding {
	/** Current analysis parameters (read live, not captured). */
	getParams: () => AnalysisParameters | null;
	/** Persist the changed fields (mode-specific storage path). */
	setParams: (fields: Partial<AnalysisParameters>) => void;
	/** Trigger the mode's VE recompute. */
	onChange: () => void;
}

function currentRawCrr(): number {
	const crrValue = document.getElementById("crrValue") as HTMLInputElement;
	const parsed = parseFloat(crrValue?.value ?? "");
	return Number.isNaN(parsed) ? 0 : parsed;
}

export function refreshCrrTempReadout(params: AnalysisParameters | null): void {
	const readout = document.getElementById("crrTempReadout");
	if (!readout || !params) return;
	readout.textContent = formatCrrTempReadout(params, currentRawCrr());
}

/**
 * RETURNS whether the block was actually bound, so `bindModeControls` can report
 * this row as bound or skipped from what happened here rather than from a second
 * copy of these four element lookups.
 */
export function bindCrrTempControls(
	binding: CrrTempControlsBinding,
): boolean {
	const toggle = document.getElementById("crrTempToggle") as HTMLInputElement;
	const fields = document.getElementById("crrTempFields") as HTMLElement;
	const ambient = document.getElementById(
		"crrTempAmbient",
	) as HTMLInputElement;
	const sensitivity = document.getElementById(
		"crrTempSensitivity",
	) as HTMLSelectElement;

	if (!toggle || !fields || !ambient || !sensitivity) return false;

	refreshCrrTempReadout(binding.getParams());

	toggle.addEventListener("change", () => {
		const params = binding.getParams();
		if (!params) return;

		const update: Partial<AnalysisParameters> = {
			crr_temp_correction: toggle.checked,
		};

		// On first enable, prefill ambient temperature from Weather-API metadata
		// (ambient, unlike the sun-soaked FIT device temperature stream).
		if (toggle.checked && params.ambient_temp_c == null) {
			const weatherTemp = params.weather_metadata?.temperature;
			if (weatherTemp !== undefined && !Number.isNaN(weatherTemp)) {
				const rounded = Math.round(weatherTemp * 10) / 10;
				update.ambient_temp_c = rounded;
				ambient.value = rounded.toString();
			}
		}

		fields.classList.toggle(
			"crr-temp-controls__fields--hidden",
			!toggle.checked,
		);
		binding.setParams(update);
		refreshCrrTempReadout(binding.getParams());
		binding.onChange();
	});

	ambient.addEventListener("change", () => {
		const parsed = parseFloat(ambient.value);
		binding.setParams({
			ambient_temp_c: Number.isNaN(parsed) ? null : parsed,
		});
		refreshCrrTempReadout(binding.getParams());
		binding.onChange();
	});

	sensitivity.addEventListener("change", () => {
		binding.setParams({
			tire_sensitivity: sensitivity.value as TireSensitivity,
		});
		refreshCrrTempReadout(binding.getParams());
		binding.onChange();
	});

	// Keep the readout in sync while the user fits Crr with the slider. These
	// are additive listeners; the modes' own handlers use oninput assignment
	// or their own addEventListener, so there is no conflict.
	const crrSlider = document.getElementById("crrSlider");
	const crrValue = document.getElementById("crrValue");
	crrSlider?.addEventListener("input", () =>
		refreshCrrTempReadout(binding.getParams()),
	);
	crrValue?.addEventListener("change", () =>
		refreshCrrTempReadout(binding.getParams()),
	);

	return true;
}
