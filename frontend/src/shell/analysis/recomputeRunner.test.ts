/* @vitest-environment jsdom */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { AppState } from "../../state/AppState";
import {
	HEAVY_RECOMPUTE_DEBOUNCE_MS,
	STANDARD_RECOMPUTE_DEBOUNCE_MS,
	cancelActiveRecompute,
	configureRecomputeRunner,
	scheduleRecompute,
} from "./recomputeRunner";

describe("recomputeRunner", () => {
	beforeEach(() => {
		vi.useFakeTimers();
		document.body.replaceChildren();

		const root = document.createElement("div");
		root.id = "veAnalysisContent";
		const controls = document.createElement("div");
		controls.className = "ve-controls";
		root.appendChild(controls);
		document.body.appendChild(root);

		configureRecomputeRunner(new AppState());
	});

	afterEach(() => {
		cancelActiveRecompute("mode-switch");
		vi.useRealTimers();
		vi.restoreAllMocks();
		document.body.replaceChildren();
	});

	it("debounce schedules only latest recompute within 200ms window", async () => {
		const calls: number[] = [];

		scheduleRecompute({
			mode: "out-and-back",
			run: () => {
				calls.push(1);
			},
		});
		vi.advanceTimersByTime(150);

		scheduleRecompute({
			mode: "out-and-back",
			run: () => {
				calls.push(2);
			},
		});
		vi.advanceTimersByTime(HEAVY_RECOMPUTE_DEBOUNCE_MS);
		await Promise.resolve();

		expect(calls).toEqual([2]);
	});

	it("gps-lap mode uses zero debounce so it updates live during a drag", async () => {
		const calls: number[] = [];

		scheduleRecompute({
			mode: "gps-lap",
			run: () => {
				calls.push(1);
			},
		});
		vi.advanceTimersByTime(0);
		await Promise.resolve();

		// Fires immediately like standard mode — not deferred to slider release.
		expect(calls).toEqual([1]);
	});

	it("latest-input-wins ignores stale completion token", async () => {
		const appState = new AppState();
		configureRecomputeRunner(appState);

		let resolveFirst!: () => void;
		const firstDone = new Promise<void>((resolve) => {
			resolveFirst = () => resolve();
		});

		let secondRan = false;

		scheduleRecompute({
			mode: "gps-lap",
			run: async () => {
				await firstDone;
			},
		});

		vi.advanceTimersByTime(HEAVY_RECOMPUTE_DEBOUNCE_MS);

		scheduleRecompute({
			mode: "gps-lap",
			run: () => {
				secondRan = true;
			},
		});

		vi.advanceTimersByTime(HEAVY_RECOMPUTE_DEBOUNCE_MS);
		await Promise.resolve();
		expect(secondRan).toBe(true);

		resolveFirst();
		vi.advanceTimersByTime(300);
		await Promise.resolve();

		expect(appState.recomputeStatus).toBe("idle");
	});

	it("new input during running transitions status handoff then running for latest token", async () => {
		const appState = new AppState();
		configureRecomputeRunner(appState);

		let releaseFirst!: () => void;
		const firstRun = new Promise<void>((resolve) => {
			releaseFirst = () => resolve();
		});

		scheduleRecompute({
			mode: "gps-lap",
			run: async () => {
				await firstRun;
			},
		});

		vi.advanceTimersByTime(HEAVY_RECOMPUTE_DEBOUNCE_MS);
		await Promise.resolve();
		expect(appState.recomputeStatus).toBe("running");

		scheduleRecompute({ mode: "gps-lap", run: () => {} });
		expect(appState.recomputeStatus).toBe("handoff");

		vi.advanceTimersByTime(HEAVY_RECOMPUTE_DEBOUNCE_MS);
		await Promise.resolve();
		expect(appState.recomputeStatus).toBe("running");

		releaseFirst();
		await Promise.resolve();
	});

	it("latest completion returns status to idle", async () => {
		const appState = new AppState();
		configureRecomputeRunner(appState);

		scheduleRecompute({ mode: "standard", run: () => {} });

		vi.advanceTimersByTime(STANDARD_RECOMPUTE_DEBOUNCE_MS);
		await Promise.resolve();

		vi.advanceTimersByTime(300);
		await Promise.resolve();

		expect(appState.recomputeStatus).toBe("idle");
	});

	it("standard mode uses zero debounce while heavy modes use 200ms", async () => {
		let standardCalls = 0;
		let heavyCalls = 0;

		scheduleRecompute({
			mode: "standard",
			run: () => {
				standardCalls += 1;
			},
		});
		vi.advanceTimersByTime(0);
		await Promise.resolve();

		scheduleRecompute({
			mode: "out-and-back",
			run: () => {
				heavyCalls += 1;
			},
		});
		vi.advanceTimersByTime(199);
		await Promise.resolve();

		expect(standardCalls).toBe(1);
		expect(heavyCalls).toBe(0);

		vi.advanceTimersByTime(1);
		await Promise.resolve();

		expect(heavyCalls).toBe(1);
	});
});
