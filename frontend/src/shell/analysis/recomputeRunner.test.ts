/* @vitest-environment jsdom */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { AppState } from "../../state/AppState";
import * as recomputeRunnerModule from "./recomputeRunner";
import {
	RECOMPUTE_DEBOUNCE_MS,
	type RecomputeMode,
	cancelActiveRecompute,
	configureRecomputeRunner,
	scheduleRecompute,
} from "./recomputeRunner";

const ALL_MODES: RecomputeMode[] = ["standard", "gps-lap", "out-and-back"];

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

	it("debounce schedules only the latest recompute within one window", async () => {
		const calls: number[] = [];

		scheduleRecompute({
			mode: "out-and-back",
			run: () => {
				calls.push(1);
			},
		});
		vi.advanceTimersByTime(RECOMPUTE_DEBOUNCE_MS - 1);

		scheduleRecompute({
			mode: "out-and-back",
			run: () => {
				calls.push(2);
			},
		});
		vi.advanceTimersByTime(RECOMPUTE_DEBOUNCE_MS);
		await Promise.resolve();

		expect(calls).toEqual([2]);
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

		vi.advanceTimersByTime(RECOMPUTE_DEBOUNCE_MS);

		scheduleRecompute({
			mode: "gps-lap",
			run: () => {
				secondRan = true;
			},
		});

		vi.advanceTimersByTime(RECOMPUTE_DEBOUNCE_MS);
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

		vi.advanceTimersByTime(RECOMPUTE_DEBOUNCE_MS);
		await Promise.resolve();
		expect(appState.recomputeStatus).toBe("running");

		scheduleRecompute({ mode: "gps-lap", run: () => {} });
		expect(appState.recomputeStatus).toBe("handoff");

		vi.advanceTimersByTime(RECOMPUTE_DEBOUNCE_MS);
		await Promise.resolve();
		expect(appState.recomputeStatus).toBe("running");

		releaseFirst();
		await Promise.resolve();
	});

	it("latest completion returns status to idle", async () => {
		const appState = new AppState();
		configureRecomputeRunner(appState);

		scheduleRecompute({ mode: "standard", run: () => {} });

		vi.advanceTimersByTime(RECOMPUTE_DEBOUNCE_MS);
		await Promise.resolve();

		vi.advanceTimersByTime(300);
		await Promise.resolve();

		expect(appState.recomputeStatus).toBe("idle");
	});

	// D-15: every mode debounces through the same constant. Written against the
	// exported constant so plan 04 (D-16) can ratify a different value without
	// touching this test. Non-vacuous against the table it replaced: standard and
	// gps-lap were 0 ms (they would have run before RECOMPUTE_DEBOUNCE_MS - 1) and
	// out-and-back was 200 ms (it would not have run by RECOMPUTE_DEBOUNCE_MS).
	it.each(ALL_MODES)(
		"%s debounces on the one uniform constant, not a per-mode value",
		async (mode) => {
			let runs = 0;

			scheduleRecompute({
				mode,
				run: () => {
					runs += 1;
				},
			});

			vi.advanceTimersByTime(RECOMPUTE_DEBOUNCE_MS - 1);
			await Promise.resolve();
			expect(runs).toBe(0);

			vi.advanceTimersByTime(1);
			await Promise.resolve();
			expect(runs).toBe(1);
		},
	);

	it("no longer exports a per-mode debounce table", () => {
		const exportedNames = Object.keys(recomputeRunnerModule);

		expect(exportedNames).toContain("RECOMPUTE_DEBOUNCE_MS");
		expect(exportedNames).not.toContain("HEAVY_RECOMPUTE_DEBOUNCE_MS");
		expect(exportedNames).not.toContain("STANDARD_RECOMPUTE_DEBOUNCE_MS");
		expect(exportedNames).not.toContain("GPS_LAP_RECOMPUTE_DEBOUNCE_MS");
	});
});
