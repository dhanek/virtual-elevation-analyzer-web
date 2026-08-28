/**
 * @vitest-environment jsdom
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { AppState } from "../../state/AppState";
import {
	bindElevationSmoothingToggle,
	elevationSmoothingToggleMarkup,
} from "./elevationProfileCycle";

function appStateWithProfiles(
	profile: "dem-raw-nearest" | "dem-interpolated-smoothed-5pt",
): AppState {
	const appState = new AppState();
	appState.demProfilesAvailable = true;
	appState.activeDisplayProfile = profile;
	return appState;
}

afterEach(() => {
	document.body.innerHTML = "";
});

describe("elevationSmoothingToggleMarkup", () => {
	it("renders nothing when DEM profiles are unavailable", () => {
		const appState = new AppState();
		appState.demProfilesAvailable = false;
		expect(elevationSmoothingToggleMarkup(appState)).toBe("");
	});

	it("omits the helper text", () => {
		const html = elevationSmoothingToggleMarkup(
			appStateWithProfiles("dem-interpolated-smoothed-5pt"),
		);
		expect(html).not.toContain("raw DEM");
		expect(html).not.toContain("5-point smoothing");
	});

	it("lights ON when smoothing is the active profile", () => {
		document.body.innerHTML = elevationSmoothingToggleMarkup(
			appStateWithProfiles("dem-interpolated-smoothed-5pt"),
		);
		const on = document.querySelector('[data-smoothing="on"]')!;
		const off = document.querySelector('[data-smoothing="off"]')!;
		expect(on.classList.contains("lap-view-toggle-btn--active")).toBe(true);
		expect(off.classList.contains("lap-view-toggle-btn--active")).toBe(false);
	});

	it("lights OFF when raw is the active profile", () => {
		document.body.innerHTML = elevationSmoothingToggleMarkup(
			appStateWithProfiles("dem-raw-nearest"),
		);
		expect(
			document.querySelector('[data-smoothing="off"]')!.classList.contains("lap-view-toggle-btn--active"),
		).toBe(true);
	});
});

describe("bindElevationSmoothingToggle", () => {
	it("switches the active profile and fires onToggle when a new option is picked", () => {
		const appState = appStateWithProfiles("dem-interpolated-smoothed-5pt");
		document.body.innerHTML = elevationSmoothingToggleMarkup(appState);
		const onToggle = vi.fn();
		bindElevationSmoothingToggle(appState, onToggle);

		(document.querySelector('[data-smoothing="off"]') as HTMLButtonElement).click();

		expect(appState.activeDisplayProfile).toBe("dem-raw-nearest");
		expect(onToggle).toHaveBeenCalledWith(false);
		expect(
			document.querySelector('[data-smoothing="off"]')!.classList.contains("lap-view-toggle-btn--active"),
		).toBe(true);
	});

	it("ignores a click on the already-active option", () => {
		const appState = appStateWithProfiles("dem-interpolated-smoothed-5pt");
		document.body.innerHTML = elevationSmoothingToggleMarkup(appState);
		const onToggle = vi.fn();
		bindElevationSmoothingToggle(appState, onToggle);

		(document.querySelector('[data-smoothing="on"]') as HTMLButtonElement).click();

		expect(onToggle).not.toHaveBeenCalled();
		expect(appState.activeDisplayProfile).toBe("dem-interpolated-smoothed-5pt");
	});
});
