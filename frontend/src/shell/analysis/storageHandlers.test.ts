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
import {
	handleStoreResult,
	saveCurrentLapSettings,
	showNotesDialog,
} from "./storageHandlers";
import type { AppState } from "../../state/AppState";
import type { ParameterStorage, LapSettings } from "../../utils/ParameterStorage";
import type { ResultsStorage } from "../../utils/ResultsStorage";

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

	it("reports cancellation on Escape pressed outside the input", async () => {
		const notes = showNotesDialog();
		expect(dialogIsOpen()).toBe(true);

		// Focus deliberately NOT in the input — this is the case the old
		// input-scoped listener could not see.
		(document.querySelector(".notes-dialog__overlay") as HTMLElement).focus();
		document.dispatchEvent(
			new KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
		);

		await expect(notes).resolves.toBeNull();
		expect(dialogIsOpen()).toBe(false);
	});

	it("reports cancellation when the backdrop is clicked", async () => {
		const notes = showNotesDialog();

		(document.querySelector(".notes-dialog__overlay") as HTMLElement).click();

		await expect(notes).resolves.toBeNull();
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

/**
 * CR-02. Two writers put DIFFERENT INDEX SPACES into `currentFilteredData`:
 *
 *   - `renderStandardVe.ts` writes the deduplicated ANALYZE SELECTION, which is
 *     the space the trim sliders address (`trimEndSlider.max = length - 1`);
 *   - `standardMode.summarize` overwrites it on every update with the
 *     concatenation of the SURVIVING segments, and `mapTrimToSegments` drops any
 *     segment the trim window leaves under MIN_TRIMMED_SEGMENT_SAMPLES.
 *
 * Narrow a 3-lap selection onto lap 3 and laps 1-2 leave `profiles` entirely:
 * the array shrinks to ~300 samples while `trimStart` is still ~700. Slicing the
 * new array with the old space's indices returned `[]`, so every average came
 * out 0 and `filteredTimestamps[700]` was `undefined` —
 * `new Date(NaN).toISOString()` threw, surfacing as "Failed to store result".
 *
 * The window is now derived from the space actually being read: what is on
 * screen IS `currentFilteredData`, exactly as both segment modes already treat
 * it. The slider values keep being RECORDED, because the stored `trimStart` /
 * `trimEnd` columns are the user's chosen trim and the CSV export carries them.
 */
describe("handleStoreResult trim window", () => {
	beforeEach(() => {
		document.body.replaceChildren();
	});

	function makeResultsStorageStub(saved: Record<string, unknown>[]) {
		return {
			saveResult: async (data: Record<string, unknown>) => {
				saved.push(data);
			},
		} as unknown as ResultsStorage;
	}

	/** A trim-mapped selection: 300 surviving samples, sliders still on lap 3. */
	function makeTrimmedStandardState(): AppState {
		const SURVIVING = 300;
		return makeAppStateStub({
			currentAnalyzedLaps: [1, 2, 3],
			isGpsLapModeActive: false,
			currentParameters: { crr_temp_correction: false },
			currentVEResult: { cda: 0.25 },
			currentVirtualDistances: [],
			currentWindSource: "none",
			currentFilteredData: {
				power: new Array(SURVIVING).fill(250),
				velocity: new Array(SURVIVING).fill(10),
				temperature: new Array(SURVIVING).fill(20),
				// 1970-01-02, so recordingDate is unambiguous.
				timestamps: Array.from({ length: SURVIVING }, (_, i) => 86_400 + i),
			},
		} as unknown as Partial<AppState>);
	}

	async function storeWithNotes(
		appState: AppState,
		storage: ResultsStorage,
	): Promise<void> {
		const pending = handleStoreResult(appState, storage);
		// The notes dialog opens on a microtask; accept it.
		await Promise.resolve();
		(document.getElementById("notesOkBtn") as HTMLButtonElement).click();
		await pending;
	}

	it("averages over the analysed samples when trim dropped whole laps", async () => {
		const button = document.createElement("button");
		button.id = "storeResult";
		document.body.appendChild(button);
		// Sliders still address the pre-trim selection: 700 > 300 samples.
		addInput("trimStartSlider", "700");
		addInput("trimEndSlider", "1000");
		addInput("cdaSlider", "0.25");
		addInput("crrSlider", "0.005");

		const saved: Record<string, unknown>[] = [];
		await storeWithNotes(makeTrimmedStandardState(), makeResultsStorageStub(saved));

		expect(saved).toHaveLength(1);
		// Averaged over the 300 samples on screen, not over an empty slice.
		expect(saved[0].avgPower).toBe(250);
		expect(saved[0].avgSpeed).toBeCloseTo(36, 5);
		// Derived from the first analysed sample, not from index 700.
		expect(saved[0].recordingDate).toBe("1970-01-02");
	});

	it("still records the slider values the user chose", async () => {
		const button = document.createElement("button");
		button.id = "storeResult";
		document.body.appendChild(button);
		addInput("trimStartSlider", "700");
		addInput("trimEndSlider", "1000");
		addInput("cdaSlider", "0.25");
		addInput("crrSlider", "0.005");

		const saved: Record<string, unknown>[] = [];
		await storeWithNotes(makeTrimmedStandardState(), makeResultsStorageStub(saved));

		expect(saved[0].trimStart).toBe(700);
		expect(saved[0].trimEnd).toBe(1000);
	});
});

/**
 * CANCEL IS NOT "OK WITH NO NOTES".
 *
 * `showNotesDialog` resolved `''` for both, so `handleStoreResult` could not
 * tell them apart and stored the result either way: dismissing the dialog still
 * flashed "✓ Stored" and still put a row in the CSV export. Found in the browser
 * — the Cancel button always behaved this way, and adding Escape and
 * backdrop-click as dismissals widened the surface.
 */
describe("cancelling the notes dialog", () => {
	beforeEach(() => {
		document.body.replaceChildren();
	});

	function makeResultsStorageStub(saved: Record<string, unknown>[]) {
		return {
			saveResult: async (data: Record<string, unknown>) => {
				saved.push(data);
			},
		} as unknown as ResultsStorage;
	}

	function storableState(): AppState {
		return makeAppStateStub({
			currentAnalyzedLaps: [1],
			isGpsLapModeActive: false,
			currentParameters: { crr_temp_correction: false },
			currentVEResult: { cda: 0.25 },
			currentVirtualDistances: [],
			currentWindSource: "none",
			currentFilteredData: {
				power: [250, 250],
				velocity: [10, 10],
				temperature: [20, 20],
				timestamps: [86_400, 86_401],
			},
		} as unknown as Partial<AppState>);
	}

	function setUpStoreDom(): HTMLButtonElement {
		const button = document.createElement("button");
		button.id = "storeResult";
		button.textContent = "Store Result";
		document.body.appendChild(button);
		addInput("trimStartSlider", "0");
		addInput("trimEndSlider", "1");
		addInput("cdaSlider", "0.25");
		addInput("crrSlider", "0.005");
		return button;
	}

	it("distinguishes an empty note from a cancellation", async () => {
		const notes = showNotesDialog();
		(document.getElementById("notesOkBtn") as HTMLButtonElement).click();

		// OK with nothing typed is a real, empty note — not a cancellation.
		await expect(notes).resolves.toBe("");
	});

	it("reports cancellation from the Cancel button", async () => {
		const notes = showNotesDialog();
		(document.getElementById("notesCancelBtn") as HTMLButtonElement).click();

		await expect(notes).resolves.toBeNull();
	});

	it("stores nothing when the dialog is cancelled", async () => {
		setUpStoreDom();
		const saved: Record<string, unknown>[] = [];

		const pending = handleStoreResult(
			storableState(),
			makeResultsStorageStub(saved),
		);
		await Promise.resolve();
		(document.getElementById("notesCancelBtn") as HTMLButtonElement).click();
		await pending;

		expect(saved).toHaveLength(0);
	});

	it("leaves the button alone when the dialog is cancelled", async () => {
		const button = setUpStoreDom();
		const saved: Record<string, unknown>[] = [];

		const pending = handleStoreResult(
			storableState(),
			makeResultsStorageStub(saved),
		);
		await Promise.resolve();
		(document.querySelector(".notes-dialog__overlay") as HTMLElement).click();
		await pending;

		// Not "✓ Stored", and not left disabled mid-flight either.
		expect(button.textContent).toBe("Store Result");
		expect(button.disabled).toBe(false);
	});
});
