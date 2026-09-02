import {
	isClosureTargetPinned,
	toElevationDiffSource,
	type ElevationDiffSource,
} from "../../analysis/ClosureTarget";
import type { AnalysisParameters } from "../../components/AnalysisParameters";
import type { AnalysisModeId } from "../../modes/analysis/types";
import { log } from "../../utils/log";

/**
 * Shared "Closure target" control block (phase 2 of the Convergence plan),
 * rendered under the auto-converge locks in all three VE mode sidebars.
 *
 * The block takes the mode id for two things. It words the MANUAL field:
 * out-and-back's typed number is one leg's gate-to-gate difference (the
 * inbound leg negates it — `resolveClosureTarget`), which is a different claim
 * from a window start-to-end difference, and telling the user "0 for a lap"
 * there would be wrong on any sloping course. And in GPS-lap mode it PINS the
 * block (`isClosureTargetPinned`): every GPS lap starts and ends at the gate,
 * so the radio is locked on Manual, the Δh input reads 0 and is disabled, and
 * the info button says why. The binder attaches nothing there — the pinned
 * selection is applied by `resolveClosureSelection` on the compute side and
 * never written to the persisted parameters, so the user's choice for the
 * other modes survives a visit to GPS laps.
 *
 * The radio picks where the REFERENCE elevation difference comes from — the
 * number the Convergence tab's closure error and the auto-converge solve
 * measure `ve_gain` against. It changes no VE trace and no r²/RMSE; those
 * stay on the analysis profile. Persisted on `AnalysisParameters`
 * (`elevation_diff_source`, `manual_elevation_diff_m`) through the same
 * `mergeAnalysisParameters` route as the Crr-temperature block.
 */

const ELEVATION_DIFF_INFO_BASE =
	"Where the closure target — the elevation difference the Convergence tab " +
	"and Auto-converge measure the VE gain against — comes from.&#10;&#10;" +
	"DEM: the terrain elevation (when DEM data is loaded; otherwise the " +
	"analysis profile). Barometer: the FIT file's raw altitude channel. " +
	"Manual: a value you enter.&#10;&#10;";

const ELEVATION_DIFF_INFO_TAIL =
	"The VE plots and r²/RMSE always use the analysis elevation profile; " +
	"this only changes what the closure is measured against.";

/**
 * Out-and-back needs its own manual sentence: the typed number is one leg's
 * difference, not the section's closure, and 0 is the wrong default advice on a
 * sloping course. Every other mode keeps the lap wording.
 */
const ELEVATION_DIFF_INFO_MANUAL: Record<"outAndBack" | "other", string> = {
	outAndBack:
		"A manual value is the elevation gained on the OUTBOUND leg, gate to " +
		"gate; the return leg takes its negation automatically. 0 only when " +
		"the two gates sit at the same height.&#10;&#10;",
	other:
		"A manual value is the difference from the window's start to its end — " +
		"0 for a lap that finishes where it began.&#10;&#10;",
};

const ELEVATION_DIFF_INFO_PINNED =
	"Where the closure target — the elevation difference the Convergence tab " +
	"and Auto-converge measure the VE gain against — comes from.&#10;&#10;" +
	"In GPS lap mode every lap starts and ends at the gate, so the elevation " +
	"difference is assumed to be zero and the target is fixed at Manual, " +
	"0 m. DEM and Barometer are not offered: they would only add gate " +
	"slack and barometric drift to a difference that is zero by " +
	"construction.&#10;&#10;";

/** The status line under the pinned block, GPS-lap mode only. */
export const ELEVATION_DIFF_PINNED_STATUS =
	"GPS laps start and end at the gate — closure target fixed at 0 m.";

function infoTooltip(mode?: AnalysisModeId): string {
	if (isClosureTargetPinned(mode)) {
		return ELEVATION_DIFF_INFO_PINNED + ELEVATION_DIFF_INFO_TAIL;
	}
	return (
		ELEVATION_DIFF_INFO_BASE +
		ELEVATION_DIFF_INFO_MANUAL[mode === "outAndBack" ? "outAndBack" : "other"] +
		ELEVATION_DIFF_INFO_TAIL
	);
}

/** The manual row's label and input tooltip, which differ the same way. */
export function manualFieldText(mode?: AnalysisModeId): {
	label: string;
	title: string;
} {
	if (isClosureTargetPinned(mode)) {
		return {
			label: "Δ elevation (m):",
			title:
				"Fixed at 0 in GPS lap mode: every lap starts and ends at the gate.",
		};
	}
	return mode === "outAndBack"
		? {
				label: "Δ elevation, outbound (m):",
				title:
					"Elevation gained on the outbound leg, gate to gate, in metres. " +
					"The inbound leg uses the same number negated. 0 when both gates " +
					"sit at the same height.",
			}
		: {
				label: "Δ elevation (m):",
				title:
					"Elevation difference from window start to window end, in metres. " +
					"0 when the ride returns to its start elevation.",
			};
}

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
	mode?: AnalysisModeId,
): string {
	const pinned = isClosureTargetPinned(mode);
	const source: ElevationDiffSource = pinned
		? "manual"
		: (params.elevation_diff_source ?? "dem");
	const manual = pinned ? 0 : (params.manual_elevation_diff_m ?? null);
	const manualField = manualFieldText(mode);
	const disabled = pinned ? " disabled" : "";

	const radio = (value: ElevationDiffSource, label: string) => `
                <label class="ve-radio-label">
                    <input type="radio" name="elevationDiffSource" value="${value}" ${source === value ? "checked" : ""}${disabled}>
                    <span>${label}</span>
                </label>`;

	return `
        <div class="ve-control-group elevation-diff-controls" id="elevationDiffControls"${pinned ? ' data-pinned="true"' : ""}>
            <label>Closure target
                <span class="crr-temp-controls__info" title="${infoTooltip(mode)}">i</span>
            </label>
            <div class="ve-radio-group elevation-diff-controls__radios">
                ${radio("dem", "DEM")}
                ${radio("barometer", "Barometer")}
                ${radio("manual", "Manual")}
            </div>
            <div id="elevationDiffManualRow" class="elevation-diff-controls__manual${source === "manual" ? "" : " elevation-diff-controls__manual--hidden"}">
                <label for="elevationDiffManual">${manualField.label}</label>
                <input type="number" id="elevationDiffManual" step="0.1"
                       value="${manual !== null ? manual : ""}" placeholder="0.0"
                       title="${manualField.title}"${disabled}>
            </div>
            <div id="elevationDiffStatus" class="elevation-diff-controls__status">${pinned ? ELEVATION_DIFF_PINNED_STATUS : ""}</div>
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

	// A pinned block (GPS-lap mode) is rendered locked on Manual 0 with its
	// status already written; there is nothing to listen for, and syncing the
	// status from the radio would blank the explanation.
	if (
		document
			.getElementById("elevationDiffControls")
			?.getAttribute("data-pinned") === "true"
	) {
		return true;
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
