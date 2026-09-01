import {
	toElevationDiffSource,
	type ElevationDiffSource,
} from "../../analysis/ClosureTarget";
import type { AnalysisParameters } from "../../components/AnalysisParameters";
import { log } from "../../utils/log";

/**
 * Shared "Closure target" control block (phase 2 of the Convergence plan),
 * rendered under the auto-converge locks in all three VE mode sidebars.
 *
 * The radio picks where the REFERENCE elevation difference comes from — the
 * number the Convergence tab's closure error and the auto-converge solve
 * measure `ve_gain` against. It changes no VE trace and no r²/RMSE; those
 * stay on the analysis profile. Persisted on `AnalysisParameters`
 * (`elevation_diff_source`, `manual_elevation_diff_m`) through the same
 * `mergeAnalysisParameters` route as the Crr-temperature block.
 */

const ELEVATION_DIFF_INFO_TOOLTIP =
	"Where the closure target — the elevation difference the Convergence tab " +
	"and Auto-converge measure the VE gain against — comes from.&#10;&#10;" +
	"DEM: the terrain elevation (when DEM data is loaded; otherwise the " +
	"analysis profile). Barometer: the FIT file's raw altitude channel. " +
	"Manual: a value you enter — 0 for a lap or out-and-back that starts and " +
	"ends at the same spot.&#10;&#10;" +
	"The VE plots and r²/RMSE always use the analysis elevation profile; " +
	"this only changes what the closure is measured against.";

export function elevationDiffStatusText(
	source: ElevationDiffSource,
	demAvailable: boolean,
): string {
	if (source === "dem" && !demAvailable) {
		return "No DEM elevation loaded — the analysis profile supplies the target.";
	}
	return "";
}

export function elevationDiffControlsMarkup(
	params: AnalysisParameters,
): string {
	const source = params.elevation_diff_source ?? "dem";
	const manual = params.manual_elevation_diff_m ?? null;

	const radio = (value: ElevationDiffSource, label: string) => `
                <label class="ve-radio-label">
                    <input type="radio" name="elevationDiffSource" value="${value}" ${source === value ? "checked" : ""}>
                    <span>${label}</span>
                </label>`;

	return `
        <div class="ve-control-group elevation-diff-controls" id="elevationDiffControls">
            <label>Closure target
                <span class="crr-temp-controls__info" title="${ELEVATION_DIFF_INFO_TOOLTIP}">i</span>
            </label>
            <div class="ve-radio-group elevation-diff-controls__radios">
                ${radio("dem", "DEM")}
                ${radio("barometer", "Barometer")}
                ${radio("manual", "Manual")}
            </div>
            <div id="elevationDiffManualRow" class="elevation-diff-controls__manual${source === "manual" ? "" : " elevation-diff-controls__manual--hidden"}">
                <label for="elevationDiffManual">Δ elevation (m):</label>
                <input type="number" id="elevationDiffManual" step="0.1"
                       value="${manual !== null ? manual : ""}" placeholder="0.0"
                       title="Elevation difference from window start to window end, in metres. 0 when the ride returns to its start elevation.">
            </div>
            <div id="elevationDiffStatus" class="elevation-diff-controls__status"></div>
        </div>
    `;
}

/** The checked radio's source, validated rather than cast. */
export function getSelectedElevationDiffSource(): ElevationDiffSource {
	const checked = document.querySelector(
		'input[name="elevationDiffSource"]:checked',
	) as HTMLInputElement | null;
	const source = toElevationDiffSource(checked?.value ?? "dem");
	if (source === null) {
		log.error(
			`Unknown elevation-difference source "${checked?.value}" on the checked radio; falling back to "dem".`,
		);
		return "dem";
	}
	return source;
}

export interface ElevationDiffControlsBinding {
	/** Current analysis parameters (read live, not captured). */
	getParams: () => AnalysisParameters | null;
	/** Persist the changed fields (`mergeAnalysisParameters` route). */
	setParams: (fields: Partial<AnalysisParameters>) => void;
	/** Trigger the mode's VE recompute. */
	onChange: () => void;
}

/**
 * RETURNS whether the block was actually bound, so `bindModeControls` can
 * report this row as bound or skipped from what happened here (the
 * `bindCrrTempControls` convention).
 */
export function bindElevationDiffControls(
	binding: ElevationDiffControlsBinding,
	demAvailable: boolean,
): boolean {
	const radios = document.querySelectorAll<HTMLInputElement>(
		'input[name="elevationDiffSource"]',
	);
	const manualRow = document.getElementById("elevationDiffManualRow");
	const manualInput = document.getElementById(
		"elevationDiffManual",
	) as HTMLInputElement | null;
	const status = document.getElementById("elevationDiffStatus");

	if (radios.length === 0 || !manualRow || !manualInput || !status) {
		return false;
	}

	const sync = (source: ElevationDiffSource) => {
		manualRow.classList.toggle(
			"elevation-diff-controls__manual--hidden",
			source !== "manual",
		);
		status.textContent = elevationDiffStatusText(source, demAvailable);
	};
	sync(getSelectedElevationDiffSource());

	radios.forEach((radio) => {
		radio.addEventListener("change", () => {
			const source = getSelectedElevationDiffSource();
			sync(source);
			binding.setParams({ elevation_diff_source: source });
			binding.onChange();
		});
	});

	manualInput.addEventListener("change", () => {
		const parsed = parseFloat(manualInput.value);
		binding.setParams({
			manual_elevation_diff_m: Number.isNaN(parsed) ? null : parsed,
		});
		binding.onChange();
	});

	return true;
}
