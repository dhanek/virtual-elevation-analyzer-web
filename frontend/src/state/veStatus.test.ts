/**
 * @vitest-environment jsdom
 */
import { describe, expect, it, beforeEach } from "vitest";
import { AppState } from "./AppState";
import { applyVeStatus } from "./veStatus";

describe("applyVeStatus", () => {
	beforeEach(() => {
		document.body.innerHTML = "";
	});

	it("starts idle", () => {
		expect(new AppState().veStatus).toBe("idle");
	});

	it("writes the status onto the state", () => {
		const appState = new AppState();
		applyVeStatus(appState, "computing");
		expect(appState.veStatus).toBe("computing");
	});

	it("enables #storeResult only when ready", () => {
		document.body.innerHTML = `<button id="storeResult"></button>`;
		const button = document.getElementById("storeResult") as HTMLButtonElement;
		const appState = new AppState();

		applyVeStatus(appState, "computing");
		expect(button.disabled).toBe(true);

		applyVeStatus(appState, "ready");
		expect(button.disabled).toBe(false);

		applyVeStatus(appState, "error");
		expect(button.disabled).toBe(true);
	});

	it("tolerates a missing button, because the panel may not be mounted", () => {
		const appState = new AppState();
		expect(() => applyVeStatus(appState, "ready")).not.toThrow();
		expect(appState.veStatus).toBe("ready");
	});
});
