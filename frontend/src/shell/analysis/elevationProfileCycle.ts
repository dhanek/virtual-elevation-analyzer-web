import type { AppState } from "../../state/AppState";
import {
	nextDemDisplayProfile,
	type ElevationDisplayProfile,
} from "../../analysis/elevationProfiles";

export function toggleDemDisplayProfile(
	appState: AppState,
): ElevationDisplayProfile {
	const next = nextDemDisplayProfile(appState.activeDisplayProfile);
	appState.activeDisplayProfile = next;
	return next;
}

export function setDemDisplayProfileEnabled(
	appState: AppState,
	enabled: boolean,
): ElevationDisplayProfile {
	const next: ElevationDisplayProfile = enabled
		? "dem-interpolated-smoothed-5pt"
		: "dem-raw-nearest";
	appState.activeDisplayProfile = next;
	return next;
}

export function isDemDisplayProfileEnabled(
	profile: ElevationDisplayProfile,
): boolean {
	return profile === "dem-interpolated-smoothed-5pt";
}

export function profileSwitchStateText(
	profile: ElevationDisplayProfile,
): "OFF" | "ON" {
	return isDemDisplayProfileEnabled(profile) ? "ON" : "OFF";
}

export function showProfileSwitchControl(appState: AppState): boolean {
	return appState.demProfilesAvailable;
}

/**
 * Markup for the elevation-smoothing OFF|ON toggle. Reuses the stitched/stacked
 * segmented-control styling for a consistent look. Returns an empty string when
 * DEM profiles are unavailable, so renderers can interpolate it unconditionally.
 */
export function elevationSmoothingToggleMarkup(appState: AppState): string {
	if (!showProfileSwitchControl(appState)) {
		return "";
	}
	const on = isDemDisplayProfileEnabled(appState.activeDisplayProfile);
	return `
        <div class="ve-elevation-profile-switch">
            <label>Elevation profile smoothing</label>
            <div class="lap-view-toggle" id="elevationProfileSwitchToggle" role="group" aria-label="Elevation profile smoothing">
                <button type="button" class="lap-view-toggle-btn ${on ? "" : "active"}" data-smoothing="off">OFF</button>
                <button type="button" class="lap-view-toggle-btn ${on ? "active" : ""}" data-smoothing="on">ON</button>
            </div>
        </div>
    `;
}

/**
 * Bind the elevation-smoothing toggle buttons. On change, updates the active
 * profile and the button styling, then invokes `onToggle` so the caller can
 * recompute its plots. Safe to call when the control is absent (no-op).
 */
export function bindElevationSmoothingToggle(
	appState: AppState,
	onToggle: (enabled: boolean) => void,
): void {
	const container = document.getElementById("elevationProfileSwitchToggle");
	if (!container) {
		return;
	}

	const buttons = container.querySelectorAll(
		".lap-view-toggle-btn",
	) as NodeListOf<HTMLButtonElement>;

	buttons.forEach((button) => {
		button.addEventListener("click", () => {
			const enabled = button.dataset.smoothing === "on";
			if (
				enabled === isDemDisplayProfileEnabled(appState.activeDisplayProfile)
			) {
				return;
			}
			setDemDisplayProfileEnabled(appState, enabled);
			buttons.forEach((b) => b.classList.toggle("active", b === button));
			onToggle(enabled);
		});
	});
}
