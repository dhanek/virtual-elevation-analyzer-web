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

export function crrTempControlsMarkup(params: AnalysisParameters): string {
	const enabled = params.crr_temp_correction === true;
	const ambient = params.ambient_temp_c ?? null;
	const sensitivity = params.tire_sensitivity ?? DEFAULT_TIRE_SENSITIVITY;

	const option = (value: TireSensitivity, label: string) =>
		`<option value="${value}" ${sensitivity === value ? "selected" : ""}>${label}</option>`;

	return `
        <div class="ve-control-group" id="crrTempControls">
            <label class="ve-radio-label" title="Crr slider values are referenced to 22 °C (BRR lab temperature). When enabled, the VE physics uses the Crr corrected to the session's ambient temperature.">
                <input type="checkbox" id="crrTempToggle" ${enabled ? "checked" : ""} style="margin-right: 0.5rem; accent-color: #4363d8; cursor: pointer;">
                <span>Temperature-correct Crr (referenced to 22 °C)</span>
            </label>
            <div id="crrTempFields" style="${enabled ? "" : "display: none;"} margin-top: 0.25rem;">
                <div style="display: flex; gap: 0.5rem; align-items: center;">
                    <label for="crrTempAmbient" style="white-space: nowrap;">Ambient (°C):</label>
                    <input type="number" id="crrTempAmbient" min="-10" max="50" step="0.5"
                           value="${ambient !== null ? ambient : ""}" placeholder="e.g. 18"
                           title="Ambient air temperature during the session. Head-unit temperature is device temperature (sun-soaked, lagged) - prefer a manual ambient value."
                           style="width: 70px;">
                    <select id="crrTempSensitivity" title="Tire temperature sensitivity. High s correlates with natural-rubber-rich compounds and thick tread." style="flex: 1;">
                        ${option("stiff", "Stiff (s=0.5)")}
                        ${option("typical", "Typical (s=0.8)")}
                        ${option("supple", "Supple race (s=1.0)")}
                    </select>
                </div>
                <div id="crrTempReadout" style="font-size: 0.85em; color: #555; margin-top: 0.25rem;"></div>
                <div style="font-size: 0.8em; color: #888; margin-top: 0.25rem;">
                    Valid ~5–40 °C, tire at steady state. Not worth enabling when compared sessions are within ±3 °C.
                </div>
            </div>
        </div>
    `;
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

export function bindCrrTempControls(binding: CrrTempControlsBinding): void {
	const toggle = document.getElementById("crrTempToggle") as HTMLInputElement;
	const fields = document.getElementById("crrTempFields") as HTMLElement;
	const ambient = document.getElementById(
		"crrTempAmbient",
	) as HTMLInputElement;
	const sensitivity = document.getElementById(
		"crrTempSensitivity",
	) as HTMLSelectElement;

	if (!toggle || !fields || !ambient || !sensitivity) return;

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
				update.ambient_temp_c = weatherTemp;
				ambient.value = weatherTemp.toString();
			}
		}

		fields.style.display = toggle.checked ? "" : "none";
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
}
