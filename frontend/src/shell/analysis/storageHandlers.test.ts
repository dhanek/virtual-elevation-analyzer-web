/**
 * @vitest-environment jsdom
 *
 * Regression tests for the stale-trim poisoning bug: saveCurrentLapSettings
 * must key saves by appState.currentAnalyzedLaps (the laps the VE view's
 * sliders actually belong to), never by appState.selectedLaps (the live
 * checkbox selection). Between a lap-checkbox switch and the next analyze the
 * two diverge, and a save triggered in that window (e.g. auto-rho ->
 * handleParametersChange -> synthetic trim-slider "input") used to persist the
 * previous lap's trim values under the newly selected lap's key.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import { saveCurrentLapSettings, showNotesDialog } from "./storageHandlers";
import type { AppState } from "../../state/AppState";
import type { ParameterStorage, LapSettings } from "../../utils/ParameterStorage";

function addInput(id: string, value: string): void {
	const el = document.createElement("input");
	el.id = id;
	el.value = value;
	document.body.appendChild(el);
}

interface SaveCall {
	fileHash: string;
	laps: number[];
	settings: LapSettings;
}

function makeParameterStorageStub(calls: SaveCall[]): ParameterStorage {
	return {
		saveLapSettings: async (
			fileHash: string,
			laps: number[],
			settings: LapSettings,
		) => {
			calls.push({ fileHash, laps, settings });
		},
	} as unknown as ParameterStorage;
}

function makeAppStateStub(overrides: Partial<AppState>): AppState {
	return {
		currentFileHash: "hash-abc",
		selectedFile: {},
		selectedLaps: [],
		currentAnalyzedLaps: [],
		airSpeedCalibrationPercent: 0,
		...overrides,
	} as unknown as AppState;
}

describe("saveCurrentLapSettings", () => {
	beforeEach(() => {
		document.body.innerHTML = "";
	});

	it("saves under the analyzed-laps key, not the pending checkbox selection", async () => {
		// VE view still shows lap 1's sliders (analyzed lap = [1])
		addInput("trimStartSlider", "120");
		addInput("trimEndSlider", "900");
		addInput("cdaSlider", "0.28");
		addInput("crrSlider", "0.004");

		// User has switched the checkbox selection to lap 2, not yet re-analyzed
		const appState = makeAppStateStub({
			selectedLaps: [2],
			currentAnalyzedLaps: [1],
		});

		const calls: SaveCall[] = [];
		await saveCurrentLapSettings(appState, makeParameterStorageStub(calls));

		expect(calls).toHaveLength(1);
		// The sliders belong to lap 1, so the settings must land under lap 1.
		expect(calls[0].laps).toEqual([1]);
		expect(calls[0].settings.trimStart).toBe(120);
		expect(calls[0].settings.trimEnd).toBe(900);
	});

	it("does not save when no analysis has been run yet", async () => {
		addInput("trimStartSlider", "0");
		addInput("trimEndSlider", "500");
		addInput("cdaSlider", "0.3");
		addInput("crrSlider", "0.005");

		const appState = makeAppStateStub({
			selectedLaps: [2],
			currentAnalyzedLaps: [],
		});

		const calls: SaveCall[] = [];
		await saveCurrentLapSettings(appState, makeParameterStorageStub(calls));

		expect(calls).toHaveLength(0);
	});

	it("saves normally when selection and analyzed laps agree", async () => {
		addInput("trimStartSlider", "30");
		addInput("trimEndSlider", "600");
		addInput("cdaSlider", "0.31");
		addInput("crrSlider", "0.0045");

		const appState = makeAppStateStub({
			selectedLaps: [3],
			currentAnalyzedLaps: [3],
			airSpeedCalibrationPercent: 1.5,
		});

		const calls: SaveCall[] = [];
		await saveCurrentLapSettings(appState, makeParameterStorageStub(calls));

		expect(calls).toHaveLength(1);
		expect(calls[0].fileHash).toBe("hash-abc");
		expect(calls[0].laps).toEqual([3]);
		expect(calls[0].settings).toEqual({
			trimStart: 30,
			trimEnd: 600,
			cda: 0.31,
			crr: 0.0045,
			airSpeedCalibration: 1.5,
		});
	});
});

/**
 * WR-09. The dialog is a MODAL OVERLAY, so the two ordinary ways out of a modal
 * have to work: Escape, and clicking the backdrop.
 *
 * Escape used to be bound to the INPUT, which meant it only fired while the
 * text field held focus — click the backdrop once and the modal had no keyboard
 * dismissal at all. The backdrop itself was inert.
 */
describe("showNotesDialog", () => {
	beforeEach(() => {
		document.body.replaceChildren();
	});

	function dialogIsOpen(): boolean {
		return !!document.querySelector(".notes-dialog");
	}

	it("resolves empty on Escape pressed outside the input", async () => {
		const notes = showNotesDialog();
		expect(dialogIsOpen()).toBe(true);

		// Focus deliberately NOT in the input — this is the case the old
		// input-scoped listener could not see.
		(document.querySelector(".notes-dialog__overlay") as HTMLElement).focus();
		document.dispatchEvent(
			new KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
		);

		await expect(notes).resolves.toBe("");
		expect(dialogIsOpen()).toBe(false);
	});

	it("resolves empty when the backdrop is clicked", async () => {
		const notes = showNotesDialog();

		(document.querySelector(".notes-dialog__overlay") as HTMLElement).click();

		await expect(notes).resolves.toBe("");
		expect(dialogIsOpen()).toBe(false);
	});

	it("still resolves the typed value on OK", async () => {
		const notes = showNotesDialog();

		const input = document.getElementById("notesInput") as HTMLInputElement;
		input.value = "  test_config_A  ";
		(document.getElementById("notesOkBtn") as HTMLButtonElement).click();

		await expect(notes).resolves.toBe("test_config_A");
	});

	/**
	 * A document-level listener outlives the node it was opened for, so it has
	 * to come off on the way out — otherwise every Store Result leaks one and
	 * they accumulate for the session.
	 */
	it("removes its document keydown listener on close", async () => {
		const removed: string[] = [];
		const realRemove = document.removeEventListener.bind(document);
		vi.spyOn(document, "removeEventListener").mockImplementation(
			(type, listener, options) => {
				removed.push(type);
				return realRemove(type, listener, options);
			},
		);

		const notes = showNotesDialog();
		(document.getElementById("notesCancelBtn") as HTMLButtonElement).click();
		await notes;

		expect(removed).toContain("keydown");
		vi.restoreAllMocks();
	});
});
