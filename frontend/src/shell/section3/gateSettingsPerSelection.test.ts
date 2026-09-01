/**
 * @vitest-environment jsdom
 *
 * GATES BELONG TO A `(file, FIT lap selection)` PAIR, so changing the selection
 * changes which gate applies.
 *
 * `ParameterStorage.loadGpsMarkerSettings` and its out-and-back twin are keyed
 * on `(fileHash, selectedLaps)`. The FIT selection is therefore not merely the
 * WINDOW the gate offset is measured in — it is part of the gate's identity, and
 * the same slider position means a different saved setting for a different set
 * of laps.
 *
 * Two defects came out of missing that, both introduced with the re-detect
 * wiring:
 *
 *  1. The redetect closure re-used the slider's current value against the new
 *     window instead of loading the gate saved for the new selection. Since
 *     `findDataIndexAtTimeOffset` (`section3Orchestration.ts:751`) returns the
 *     globally nearest index rather than refusing, an offset past the end of a
 *     narrowed window resolved to unrelated geography — and `slider.max` was
 *     left at the old duration, so a widened window could not be reached at all.
 *
 *  2. Worse, and silent: the save at the foot of the gate handler reads
 *     `appState.selectedLaps` AT CALL TIME. A pass triggered by a selection
 *     change therefore wrote the OUTGOING combination's offsets under the
 *     INCOMING combination's key, destroying the gate the user had saved for
 *     those laps before they had touched anything.
 *
 * The binders are driven directly here. The thing under test is what each one
 * does when its published re-detect closure is called, and that closure is the
 * binder's own — a fixture that supplied its own would be testing itself.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { bindGpsDetection } from "./bindGpsDetection";
import { bindOutAndBackDetection } from "./bindOutAndBackDetection";
import type { AppState } from "../../state/AppState";

const SAMPLE_COUNT = 400;

/** The gate markup each binder looks for, plus both modes' in one page. */
function setupDom() {
	document.body.innerHTML = `
        <div id="gpsGateSliderControls" class="hidden"></div>
        <input id="gpsGateSlider" type="range" min="0" max="100" value="0">
        <input id="gpsGateValue" type="number" value="0">
        <div id="gpsGatePositionInfo"></div>

        <div id="oabGateSliderControls" class="hidden"></div>
        <input id="oabGateASlider" type="range" min="0" max="100" value="0">
        <input id="oabGateAValue" type="number" value="0">
        <div id="oabGateAInfo"></div>
        <input id="oabGateBSlider" type="range" min="0" max="100" value="0">
        <input id="oabGateBValue" type="number" value="0">
        <div id="oabGateBInfo"></div>
    `;
}

function makeAppState(): AppState {
	const timestamps = Array.from({ length: SAMPLE_COUNT }, (_, i) => i);
	return {
		currentFileHash: "hash-1",
		selectedLaps: [1],
		currentFitData: {
			timestamps,
			// Non-zero and distinct, so the binders' `lat && lon && !== 0` guard
			// passes and detection is actually reached.
			position_lat: timestamps.map((i) => 52.5 + i / 100000),
			position_long: timestamps.map((i) => 13.4 + i / 100000),
		},
	} as unknown as AppState;
}

const map = {
	setGpsMarker: () => {},
	setGpsMarkerA: () => {},
	setGpsMarkerB: () => {},
} as never;

/**
 * A window whose length follows `selectedLaps`, the way the real
 * `getSelectedDataTimeRange` does: one lap is 20 s of the ride, two are 300 s.
 */
function timeRangeFor(appState: AppState) {
	return () => {
		const duration = appState.selectedLaps.length > 1 ? 300 : 20;
		return { startTime: 0, endTime: duration, duration };
	};
}

const el = (id: string) => document.getElementById(id) as HTMLInputElement;

describe("the GPS gate follows the FIT lap selection", () => {
	let appState: AppState;
	let saveGpsMarkerSettings: ReturnType<typeof vi.fn>;
	let loadGpsMarkerSettings: ReturnType<typeof vi.fn>;
	let runGpsLapDetection: ReturnType<typeof vi.fn>;
	let redetect: () => void;

	/** Gates saved per selection key, exactly as ParameterStorage keys them. */
	const saved = new Map<string, number>();
	const key = (laps: number[]) => laps.join(",");

	beforeEach(async () => {
		setupDom();
		saved.clear();
		appState = makeAppState();

		loadGpsMarkerSettings = vi.fn(async (_hash: string, laps: number[]) => {
			const offset = saved.get(key(laps));
			return offset === undefined ? null : { gateTimeOffset: offset };
		});
		saveGpsMarkerSettings = vi.fn(
			async (_hash: string, laps: number[], settings: { gateTimeOffset: number }) => {
				saved.set(key(laps), settings.gateTimeOffset);
			},
		);
		runGpsLapDetection = vi.fn();

		saved.set("1", 8);
		saved.set("1,2", 250);

		await bindGpsDetection(
			appState,
			{ loadGpsMarkerSettings, saveGpsMarkerSettings } as never,
			map,
			{
				getSelectedDataTimeRange: timeRangeFor(appState),
				findDataIndexAtTimeOffset: (offset: number) => offset,
				runGpsLapDetection,
				registerRedetect: (fn) => {
					redetect = fn;
				},
			},
		);
	});

	/** Let the closure's own async load settle. */
	const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

	it("starts on the gate saved for the laps that are selected", () => {
		expect(el("gpsGateSlider").value).toBe("8");
	});

	it("loads the OTHER selection's gate when the selection changes", async () => {
		appState.selectedLaps = [1, 2];
		redetect();
		await settle();

		// 250 s is meaningless in the 20 s window this started in and would have
		// resolved to a sample outside it; in the 300 s window it is the gate the
		// user actually set for these two laps.
		expect(loadGpsMarkerSettings).toHaveBeenLastCalledWith("hash-1", [1, 2]);
		expect(el("gpsGateSlider").value).toBe("250");
		expect(el("gpsGateSlider").max).toBe("300");
	});

	it("clamps into a narrowed window rather than resolving outside it", async () => {
		// Back to one lap, whose saved gate is 8 s — but pretend the user had
		// nothing saved there, so the default has to survive the narrow window.
		saved.delete("1");
		appState.selectedLaps = [1];
		redetect();
		await settle();

		const offset = Number(el("gpsGateSlider").value);
		expect(offset).toBeGreaterThanOrEqual(0);
		expect(offset).toBeLessThanOrEqual(20);
		expect(el("gpsGateSlider").max).toBe("20");
	});

	it("does not write the outgoing gate under the incoming selection's key", async () => {
		appState.selectedLaps = [1, 2];
		redetect();
		await settle();

		// THE SILENT ONE. A save here would have stored 8 — the single-lap gate —
		// against the two-lap key and lost the 250 the user had set.
		expect(saveGpsMarkerSettings).not.toHaveBeenCalled();
		expect(saved.get("1,2")).toBe(250);
	});

	it("still saves when the user moves the gate themselves", async () => {
		const slider = el("gpsGateSlider");
		slider.value = "12";
		slider.dispatchEvent(new Event("input"));
		await settle();

		expect(saveGpsMarkerSettings).toHaveBeenCalledWith("hash-1", [1], {
			gateTimeOffset: 12,
		});
	});

	it("re-runs detection after loading the new selection's gate", async () => {
		runGpsLapDetection.mockClear();
		appState.selectedLaps = [1, 2];
		redetect();
		await settle();

		expect(runGpsLapDetection).toHaveBeenCalled();
	});
});

describe("the out-and-back gates follow the FIT lap selection", () => {
	let appState: AppState;
	let saveOutAndBackMarkerSettings: ReturnType<typeof vi.fn>;
	let loadOutAndBackMarkerSettings: ReturnType<typeof vi.fn>;
	let runOutAndBackDetection: ReturnType<typeof vi.fn>;
	let redetect: () => void;

	const saved = new Map<string, { gateATimeOffset: number; gateBTimeOffset: number }>();
	const key = (laps: number[]) => laps.join(",");

	beforeEach(async () => {
		setupDom();
		saved.clear();
		appState = makeAppState();

		loadOutAndBackMarkerSettings = vi.fn(
			async (_hash: string, laps: number[]) => saved.get(key(laps)) ?? null,
		);
		saveOutAndBackMarkerSettings = vi.fn(
			async (
				_hash: string,
				laps: number[],
				settings: { gateATimeOffset: number; gateBTimeOffset: number },
			) => {
				saved.set(key(laps), settings);
			},
		);
		runOutAndBackDetection = vi.fn();

		saved.set("1", { gateATimeOffset: 3, gateBTimeOffset: 15 });
		saved.set("1,2", { gateATimeOffset: 40, gateBTimeOffset: 280 });

		await bindOutAndBackDetection(
			appState,
			{ loadOutAndBackMarkerSettings, saveOutAndBackMarkerSettings } as never,
			map,
			{
				getSelectedDataTimeRange: timeRangeFor(appState),
				findDataIndexAtTimeOffset: (offset: number) => offset,
				runOutAndBackDetection,
				registerRedetect: (fn) => {
					redetect = fn;
				},
			},
		);
	});

	const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

	it("starts on the gates saved for the laps that are selected", () => {
		expect(el("oabGateASlider").value).toBe("3");
		expect(el("oabGateBSlider").value).toBe("15");
	});

	it("loads the OTHER selection's gates when the selection changes", async () => {
		appState.selectedLaps = [1, 2];
		redetect();
		await settle();

		expect(loadOutAndBackMarkerSettings).toHaveBeenLastCalledWith("hash-1", [1, 2]);
		expect(el("oabGateASlider").value).toBe("40");
		expect(el("oabGateBSlider").value).toBe("280");
		expect(el("oabGateBSlider").max).toBe("300");
	});

	it("keeps A strictly before B when a narrowed window squeezes them", async () => {
		saved.set("1", { gateATimeOffset: 100, gateBTimeOffset: 200 });
		appState.selectedLaps = [1];
		redetect();
		await settle();

		const a = Number(el("oabGateASlider").value);
		const b = Number(el("oabGateBSlider").value);
		expect(a).toBeLessThan(b);
		expect(b).toBeLessThanOrEqual(20);
	});

	it("does not write the outgoing gates under the incoming selection's key", async () => {
		appState.selectedLaps = [1, 2];
		redetect();
		await settle();

		expect(saveOutAndBackMarkerSettings).not.toHaveBeenCalled();
		expect(saved.get("1,2")).toEqual({ gateATimeOffset: 40, gateBTimeOffset: 280 });
	});

	it("still saves when the user moves a gate themselves", async () => {
		const slider = el("oabGateASlider");
		slider.value = "7";
		slider.dispatchEvent(new Event("input"));
		await settle();

		expect(saveOutAndBackMarkerSettings).toHaveBeenCalled();
	});
});
