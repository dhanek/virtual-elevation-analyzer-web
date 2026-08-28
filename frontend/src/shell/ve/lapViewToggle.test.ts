/**
 * @vitest-environment jsdom
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import {
	bindLapViewToggle,
	clearLapViewToggle,
	configureLapViewToggle,
	getLapViewMode,
	isLapViewToggleActive,
	lapViewToggleMarkup,
} from "./lapViewToggle";

afterEach(() => {
	clearLapViewToggle();
	document.body.innerHTML = "";
});

describe("lapViewToggle", () => {
	it("is inactive and emits no markup until configured", () => {
		expect(isLapViewToggleActive()).toBe(false);
		expect(lapViewToggleMarkup("stitched")).toBe("");
	});

	it("activates with stitched as the default mode once configured", () => {
		configureLapViewToggle({
			renderStitched: () => {},
			renderStacked: () => {},
		});
		expect(isLapViewToggleActive()).toBe(true);
		expect(getLapViewMode()).toBe("stitched");
		expect(lapViewToggleMarkup("stitched")).toContain("lap-view-toggle");
	});

	it("clearing disables the toggle and blanks the markup again", () => {
		configureLapViewToggle({
			renderStitched: () => {},
			renderStacked: () => {},
		});
		clearLapViewToggle();
		expect(isLapViewToggleActive()).toBe(false);
		expect(lapViewToggleMarkup("stacked")).toBe("");
	});

	it("lights the active button for the rendering view", () => {
		configureLapViewToggle({
			renderStitched: () => {},
			renderStacked: () => {},
		});
		document.body.innerHTML = lapViewToggleMarkup("stacked");
		const stitchedBtn = document.querySelector('[data-view="stitched"]')!;
		const stackedBtn = document.querySelector('[data-view="stacked"]')!;
		expect(stackedBtn.classList.contains("lap-view-toggle-btn--active")).toBe(true);
		expect(stitchedBtn.classList.contains("lap-view-toggle-btn--active")).toBe(false);
	});

	it("invokes renderStacked when the user picks the stacked button", async () => {
		const renderStacked = vi.fn();
		configureLapViewToggle({ renderStitched: () => {}, renderStacked });

		document.body.innerHTML = lapViewToggleMarkup("stitched");
		bindLapViewToggle();

		const stackedBtn = document.querySelector(
			'[data-view="stacked"]',
		) as HTMLButtonElement;
		stackedBtn.click();
		await Promise.resolve();

		expect(renderStacked).toHaveBeenCalledOnce();
		expect(getLapViewMode()).toBe("stacked");
	});

	it("ignores clicks on the already-active view", async () => {
		const renderStitched = vi.fn();
		configureLapViewToggle({ renderStitched, renderStacked: () => {} });

		document.body.innerHTML = lapViewToggleMarkup("stitched");
		bindLapViewToggle();

		const stitchedBtn = document.querySelector(
			'[data-view="stitched"]',
		) as HTMLButtonElement;
		stitchedBtn.click();
		await Promise.resolve();

		expect(renderStitched).not.toHaveBeenCalled();
		expect(getLapViewMode()).toBe("stitched");
	});
});
