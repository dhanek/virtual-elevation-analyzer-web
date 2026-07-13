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
import { describe, it, expect, beforeEach } from "vitest";
import { saveCurrentLapSettings } from "./storageHandlers";
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
