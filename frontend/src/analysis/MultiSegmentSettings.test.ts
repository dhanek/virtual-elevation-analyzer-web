/**
 * @vitest-environment jsdom
 *
 * jsdom for the two WR-01 cases at the bottom only: `saveCurrentMultiSegmentSettings`
 * reads the live `#cdaValue` / `#crrValue` inputs, and mocking `document` around
 * it would test the mock rather than the function. Everything above is pure and
 * indifferent to the environment.
 */
import { IDBFactory } from "fake-indexeddb";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { AppState } from "../state/AppState";
import { ParameterStorage } from "../utils/ParameterStorage";
import { DEFAULT_PARAMETERS } from "../components/AnalysisParameters";
import {
	resolveMultiSegmentAnalysisParams,
	resolveMultiSegmentSettings,
	sameSelection,
	saveCurrentMultiSegmentSettings,
} from "./MultiSegmentSettings";

describe("sameSelection", () => {
	it("returns true for identical selections", () => {
		expect(sameSelection([1, 2, 4], [1, 2, 4])).toBe(true);
	});

	it("returns false for different selections", () => {
		expect(sameSelection([1, 2], [2, 1])).toBe(false);
		expect(sameSelection([1, 2], [1, 2, 3])).toBe(false);
	});
});

describe("resolveMultiSegmentSettings", () => {
	it("preserves current calibration and params for the same analyzed selection", () => {
		const params = { ...DEFAULT_PARAMETERS, cda: 0.24, crr: 0.0038 };

		const resolved = resolveMultiSegmentSettings({
			currentAnalyzedItems: [2, 3],
			nextAnalyzedItems: [2, 3],
			params,
			currentAirSpeedCalibrationPercent: 6.5,
			savedSettings: {
				cda: 0.3,
				crr: 0.005,
				airSpeedCalibration: 0,
			},
		});

		expect(resolved.params.cda).toBe(0.24);
		expect(resolved.params.crr).toBe(0.0038);
		expect(resolved.airSpeedCalibrationPercent).toBe(6.5);
	});

	it("loads saved cda/crr/calibration when the analyzed selection changes", () => {
		const resolved = resolveMultiSegmentSettings({
			currentAnalyzedItems: [1],
			nextAnalyzedItems: [4, 5],
			params: { ...DEFAULT_PARAMETERS, cda: 0.23, crr: 0.004 },
			currentAirSpeedCalibrationPercent: 8,
			savedSettings: {
				cda: 0.27,
				crr: 0.0033,
				airSpeedCalibration: -4.5,
			},
		});

		expect(resolved.params.cda).toBe(0.27);
		expect(resolved.params.crr).toBe(0.0033);
		expect(resolved.airSpeedCalibrationPercent).toBe(-4.5);
	});

	it("keeps the current calibration when a new selection has no saved settings", () => {
		const resolved = resolveMultiSegmentSettings({
			currentAnalyzedItems: [1, 2],
			nextAnalyzedItems: [7],
			params: { ...DEFAULT_PARAMETERS, cda: 0.21, crr: 0.0042 },
			currentAirSpeedCalibrationPercent: 9,
			savedSettings: null,
		});

		expect(resolved.params.cda).toBe(0.21);
		expect(resolved.params.crr).toBe(0.0042);
		expect(resolved.airSpeedCalibrationPercent).toBe(9);
	});

	it("keeps the current calibration when the saved settings carry none", () => {
		const resolved = resolveMultiSegmentSettings({
			currentAnalyzedItems: [1, 2],
			nextAnalyzedItems: [7],
			params: DEFAULT_PARAMETERS,
			currentAirSpeedCalibrationPercent: 9,
			savedSettings: { cda: 0.3, crr: 0.005 },
		});

		expect(resolved.airSpeedCalibrationPercent).toBe(9);
	});
});

/**
 * WR-01: `currentAnalyzedLaps` IS THE SETTINGS KEY and must not move after
 * analyze.
 *
 * `writeSegmentModeResultState` used to overwrite it with the SURVIVING items,
 * so on any analysis where the primitive dropped a segment the first slider move
 * re-keyed the user's tuned CdA/Crr from the selection to a subset of it — a key
 * `resolveMultiSegmentAnalysisParams` never asks for again. Re-analyzing the
 * same selection then came back with the defaults, silently.
 */
describe("the analyze-time selection is the settings key (WR-01)", () => {
	function makeAppState(): AppState {
		return {
			currentFileHash: "hash-1",
			selectedFile: { name: "ride.fit" } as File,
			currentAnalyzedLaps: [],
			currentCoveredItems: null,
			airSpeedCalibrationPercent: 0,
		} as unknown as AppState;
	}

	function makeStorage() {
		return {
			loadLapSettings: vi.fn(async () => null),
			saveLapSettings: vi.fn(async () => {}),
		} as unknown as ParameterStorage & {
			loadLapSettings: ReturnType<typeof vi.fn>;
			saveLapSettings: ReturnType<typeof vi.fn>;
		};
	}

	it("clears the previous analysis coverage when a new selection is analyzed", async () => {
		const appState = makeAppState();
		appState.currentCoveredItems = [7, 8];

		await resolveMultiSegmentAnalysisParams(
			appState,
			makeStorage(),
			[1, 2, 3, 4],
			{ ...DEFAULT_PARAMETERS },
		);

		expect(appState.currentAnalyzedLaps).toEqual([1, 2, 3, 4]);
		// Nothing has been computed for THIS selection yet, so it covers nothing
		// yet. Leaving [7, 8] here would let a Store Result pressed before the
		// first recompute persist the previous analysis's coverage.
		expect(appState.currentCoveredItems).toBeNull();
	});

	it("saves under the full selection even after a segment was dropped", async () => {
		document.body.innerHTML = `
            <input id="cdaValue" value="0.231">
            <input id="crrValue" value="0.0037">
        `;
		const appState = makeAppState();
		const storage = makeStorage();

		await resolveMultiSegmentAnalysisParams(appState, storage, [1, 2, 3, 4], {
			...DEFAULT_PARAMETERS,
		});
		// Lap 3 fell under MIN_SEGMENT_SAMPLES, or its calculator threw. This is
		// exactly what `writeSegmentModeResultState` now records.
		appState.currentCoveredItems = [1, 2, 4];

		await saveCurrentMultiSegmentSettings(appState, storage);

		expect(storage.saveLapSettings).toHaveBeenCalledTimes(1);
		const [, key, settings] = storage.saveLapSettings.mock.calls[0];
		expect(key).toEqual([1, 2, 3, 4]);
		expect(settings.cda).toBeCloseTo(0.231, 6);
		expect(settings.crr).toBeCloseTo(0.0037, 6);
	});
});

describe("the calibration travels only with a calibration gesture", () => {
	const A = [1];
	const B = [2];
	const C = [3];
	let appState: AppState;
	let storage: ParameterStorage;

	const analyze = async (items: number[]): Promise<number> => {
		await resolveMultiSegmentAnalysisParams(appState, storage, items, {
			...DEFAULT_PARAMETERS,
		});
		return appState.airSpeedCalibrationPercent;
	};

	const calibrate = async (percent: number): Promise<void> => {
		appState.airSpeedCalibrationPercent = percent;
		await saveCurrentMultiSegmentSettings(appState, storage, {
			calibrationChanged: true,
		});
	};

	beforeEach(async () => {
		globalThis.indexedDB = new IDBFactory();
		document.body.innerHTML = `
            <input id="cdaValue" value="0.231">
            <input id="crrValue" value="0.0037">
        `;
		appState = {
			currentFileHash: "hash-1",
			selectedFile: { name: "ride.fit" } as File,
			currentAnalyzedLaps: [],
			currentCoveredItems: null,
			airSpeedCalibrationPercent: 0,
		} as unknown as AppState;
		storage = new ParameterStorage();
		await storage.initialize();
	});

	it("leaves the field out with no option, even at a non-zero value", async () => {
		const stub = {
			saveLapSettings: vi.fn(async () => {}),
		} as unknown as ParameterStorage & {
			saveLapSettings: ReturnType<typeof vi.fn>;
		};
		appState.currentAnalyzedLaps = A;
		appState.airSpeedCalibrationPercent = 5;

		await saveCurrentMultiSegmentSettings(appState, stub);

		expect(stub.saveLapSettings).toHaveBeenCalledTimes(1);
		expect(stub.saveLapSettings.mock.calls[0][2]).not.toHaveProperty(
			"airSpeedCalibration",
		);
	});

	it("carries the value with the option", async () => {
		const stub = {
			saveLapSettings: vi.fn(async () => {}),
		} as unknown as ParameterStorage & {
			saveLapSettings: ReturnType<typeof vi.fn>;
		};
		appState.currentAnalyzedLaps = A;
		appState.airSpeedCalibrationPercent = 5;

		await saveCurrentMultiSegmentSettings(appState, stub, {
			calibrationChanged: true,
		});

		expect(stub.saveLapSettings.mock.calls[0][2].airSpeedCalibration).toBe(5);
	});

	it("does not pin a carried value on a selection that only moved CdA", async () => {
		await analyze(A);
		await calibrate(5);

		await analyze(B);
		await saveCurrentMultiSegmentSettings(appState, storage);

		await analyze(C);
		await calibrate(9);

		expect(await analyze(B)).toBe(9);
		expect(await analyze(A)).toBe(5);
	});

	it("gives a selection tuned to 0 its 0 back", async () => {
		await analyze(A);
		await calibrate(5);

		expect(await analyze(B)).toBe(5);
		await calibrate(0);

		expect(await analyze(A)).toBe(5);
		expect(await analyze(B)).toBe(0);

		// A CdA drag on B must not lose it.
		await saveCurrentMultiSegmentSettings(appState, storage);

		expect(await analyze(A)).toBe(5);
		expect(await analyze(B)).toBe(0);
	});
});
