/**
 * @vitest-environment jsdom
 */
import { describe, expect, it, beforeEach, afterEach, vi } from "vitest";
import { AppState } from "../../state/AppState";
import { applyVeStatus, type VeStatus } from "../../state/veStatus";
import { handleStoreResult } from "./storageHandlers";
import type { ResultsStorage } from "../../utils/ResultsStorage";

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

/**
 * The button being disabled (above) is not the only line of defence — a click
 * that lands between `applyVeStatus` disabling the button and the browser
 * actually honouring that, or a stale click already queued, still calls
 * `handleStoreResult` directly. `currentVEResult` can hold a STALE non-null
 * value through the whole `idle`/`computing`/`error` window (it is only
 * overwritten once a pass actually lands), so the first guard in
 * `handleStoreResult` (`!appState.currentVEResult`) does not catch this case —
 * the status check has to.
 */
describe("handleStoreResult refuses a stale result when the status is not ready", () => {
	beforeEach(() => {
		document.body.innerHTML = `<button id="storeResult"></button>`;
	});

	afterEach(() => {
		vi.restoreAllMocks();
	});

	it.each<VeStatus>(["idle", "computing", "error"])(
		"does not store and alerts when veStatus is '%s' despite a stale currentVEResult",
		async (status) => {
			const appState = new AppState();
			appState.selectedFile = {} as unknown as AppState["selectedFile"];
			appState.currentParameters =
				{} as unknown as AppState["currentParameters"];
			// Stale from a PREVIOUS ready pass — this is what the first guard
			// (`!appState.currentVEResult`) cannot see through.
			appState.currentVEResult = {
				cda: 0.25,
			} as unknown as AppState["currentVEResult"];
			// Also stale-but-populated, so this case is caught ONLY by the
			// veStatus check below, not by the separate nullity/emptiness guard
			// on currentFilteredData.
			appState.currentFilteredData = {
				power: [250, 250],
				velocity: [10, 10],
				temperature: [20, 20],
				timestamps: [86_400, 86_401],
			} as unknown as AppState["currentFilteredData"];
			applyVeStatus(appState, status);

			const saved: Record<string, unknown>[] = [];
			const storage = {
				saveResult: async (data: Record<string, unknown>) => {
					saved.push(data);
				},
			} as unknown as ResultsStorage;

			const alertSpy = vi.spyOn(window, "alert").mockImplementation(() => {});

			await handleStoreResult(appState, storage);

			expect(saved).toHaveLength(0);
			expect(alertSpy).toHaveBeenCalledTimes(1);
		},
	);
});
