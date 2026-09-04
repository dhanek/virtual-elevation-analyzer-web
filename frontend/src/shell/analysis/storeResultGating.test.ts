/**
 * @vitest-environment jsdom
 */
import { describe, expect, it, beforeEach } from "vitest";
import { AppState } from "../../state/AppState";
import { applyVeStatus } from "../../state/veStatus";

describe("Store Result gating", () => {
	beforeEach(() => {
		document.body.innerHTML = `<button id="storeResult"></button>`;
	});

	it("disables the button while a pass is in flight", () => {
		const appState = new AppState();
		applyVeStatus(appState, "computing");
		const button = document.getElementById("storeResult") as HTMLButtonElement;
		expect(button.disabled).toBe(true);
	});

	it("re-enables it once the pass lands", () => {
		const appState = new AppState();
		applyVeStatus(appState, "computing");
		applyVeStatus(appState, "ready");
		const button = document.getElementById("storeResult") as HTMLButtonElement;
		expect(button.disabled).toBe(false);
	});
});
