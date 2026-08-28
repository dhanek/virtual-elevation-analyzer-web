/**
 * Stitched ↔ Stacked lap-view toggle controller.
 *
 * When an ordinary (non-GPS) analysis is run with 2+ selected laps, the results
 * screen offers a segmented control to switch between:
 *   - "Stitched": the standard renderer (all laps concatenated into one VE curve)
 *   - "Stacked":  the GPS-lap overlay renderer (each lap reset to 0 km, overlaid)
 *
 * The orchestrator configures this controller with two closures that each
 * (re-)render the corresponding view. The renderers ask this module whether the
 * toggle is active and, if so, emit its markup and bind its handlers. The module
 * owns the active-view state so switching is a single, well-bounded operation.
 */
import { log } from "../../utils/log";

export type LapViewMode = "stitched" | "stacked";

interface LapViewToggleContext {
	renderStitched: () => Promise<void> | void;
	renderStacked: () => Promise<void> | void;
}

let context: LapViewToggleContext | null = null;
let mode: LapViewMode = "stitched";
let switching = false;

/**
 * Enable the toggle for the current analysis. Called by the orchestrator when
 * the standard path runs with 2+ laps. Resets the active view to "stitched".
 */
export function configureLapViewToggle(ctx: LapViewToggleContext): void {
	context = ctx;
	mode = "stitched";
}

/** Disable the toggle (single-lap or GPS-based analyses). */
export function clearLapViewToggle(): void {
	context = null;
	mode = "stitched";
}

export function isLapViewToggleActive(): boolean {
	return context !== null;
}

export function getLapViewMode(): LapViewMode {
	return mode;
}

/**
 * Markup for the segmented control. Returns an empty string when the toggle is
 * not active, so renderers can interpolate it unconditionally. `activeMode` is
 * the view the calling renderer is painting (so the correct button is lit even
 * before the module's `mode` is updated).
 */
export function lapViewToggleMarkup(activeMode: LapViewMode): string {
	if (!isLapViewToggleActive()) {
		return "";
	}
	return `
        <div class="lap-view-toggle" id="lapViewToggle" role="group" aria-label="Combine laps">
            <span class="lap-view-toggle-label">Combine laps:</span>
            <button type="button" class="lap-view-toggle-btn ${activeMode === "stitched" ? "lap-view-toggle-btn--active" : ""}" data-view="stitched">Stitched</button>
            <button type="button" class="lap-view-toggle-btn ${activeMode === "stacked" ? "lap-view-toggle-btn--active" : ""}" data-view="stacked">Stacked</button>
        </div>
    `;
}

/**
 * Bind click handlers to the rendered control. Safe to call when the control is
 * absent (no-op). Called by each renderer after it writes its template.
 */
export function bindLapViewToggle(): void {
	const container = document.getElementById("lapViewToggle");
	if (!container) {
		return;
	}

	const buttons = container.querySelectorAll(
		".lap-view-toggle-btn",
	) as NodeListOf<HTMLButtonElement>;

	buttons.forEach((button) => {
		button.addEventListener("click", () => {
			const target = button.dataset.view as LapViewMode | undefined;
			if (target && target !== mode) {
				void switchLapView(target);
			}
		});
	});
}

async function switchLapView(target: LapViewMode): Promise<void> {
	if (!context || switching) {
		return;
	}
	switching = true;
	mode = target;
	try {
		if (target === "stacked") {
			await context.renderStacked();
		} else {
			await context.renderStitched();
		}
	} catch (err) {
		log.error("Failed to switch lap view:", err);
	} finally {
		switching = false;
	}
}
