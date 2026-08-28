/* @vitest-environment jsdom */

/**
 * THE SCHEDULER IS A LEADING-EDGE THROTTLE (maintainer ruling, 2026-08-16).
 *
 * It used to be a RESETTING TRAILING DEBOUNCE, and the distinction is the whole
 * point of this file. Under the old implementation `scheduleRecompute` cleared
 * and re-armed its timer on every call, so while a drag produced events closer
 * together than the window, the timer never reached zero and NOT ONE update
 * ran. At 50 ms a normal drag repainted zero times until the finger stopped.
 *
 * The old test asserted "not run at CONSTANT - 1, run at CONSTANT" for a single
 * scheduled event. That is true of a debounce AND of a trailing throttle, so it
 * could not tell them apart, and it never scheduled a SECOND event inside the
 * window -- the only thing that distinguishes them. The tests below drive a
 * simulated drag, which is where the two behaviours differ by a factor of
 * "everything vs nothing".
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { AppState } from "../../state/AppState";
import * as recomputeRunnerModule from "./recomputeRunner";
import {
	RECOMPUTE_THROTTLE_MS,
	resetRecomputeThrottle,
	scheduleRecompute,
} from "./recomputeRunner";

/**
 * READ THE PILL, NOT A MIRROR FIELD.
 *
 * These assertions used to read `appState.recomputeStatus`, which nothing in
 * production ever read back — `setRecomputeStatus` wrote it and then rendered
 * from its own argument. Asserting on it proved only that an unread field held
 * a value. The pill is what the user actually sees, so that is what the
 * serialisation evidence is now anchored to.
 */
function pillState(): "idle" | "running" | "handoff" | "updated" | "absent" {
	const node = document.getElementById("veRecomputeStatus");
	if (!node) return "absent";
	if ((node as HTMLElement).hidden) return "idle";
	switch (node.textContent) {
		case "Recomputing…":
			return "running";
		case "Input updated — running latest values…":
			return "handoff";
		case "Updated":
			return "updated";
		default:
			return "absent";
	}
}

/**
 * WR-11's type half, checked AT THE TYPE LEVEL — the only level where it means
 * anything.
 *
 * This was `expect(Object.keys(module)).not.toContain("RecomputeMode")`, which
 * could never fail: `RecomputeMode` was a TypeScript type, types are erased
 * before runtime, and an erased type is absent from a module namespace whether
 * or not anyone deleted it. The assertion was as green before the deletion as
 * after.
 *
 * `@ts-expect-error` inverts that. It requires the next line to be a type
 * error, so this compiles only while `RecomputeMode` does NOT exist —
 * re-introducing the type makes the directive unused and fails `tsc`.
 */
// @ts-expect-error - RecomputeMode must not exist; re-adding it breaks this line.
export type _RecomputeModeMustNotExist = import("./recomputeRunner").RecomputeMode;

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

		resetRecomputeThrottle();
	});

	afterEach(() => {
		resetRecomputeThrottle();
		vi.useRealTimers();
		vi.restoreAllMocks();
		document.body.replaceChildren();
	});

	it("runs the FIRST event on the next macrotask, not after an interval", async () => {
		let runs = 0;
		scheduleRecompute({
			run: () => {
				runs += 1;
			},
		});

		// The leading edge is deferred by exactly one macrotask, deliberately:
		// running synchronously would execute inside the DOM event handler that
		// asked, before it had applied its own state, and a tab switch would
		// then recompute against the previously active tab.
		await vi.advanceTimersByTimeAsync(0);
		expect(runs).toBe(1);

		// The contrast that matters: a resetting debounce would still be at 0
		// here, and at 0 all the way to the end of the interval.
		expect(RECOMPUTE_THROTTLE_MS).toBeGreaterThan(0);
	});

	it("keeps updating DURING a sustained drag, which the debounce did not", async () => {
		// 60 events, 8 ms apart: a 480 ms drag at the rate a mouse produces.
		// Every one of these arrives inside the previous window, so the old
		// resetting debounce ran ZERO times until the drag stopped.
		let runs = 0;
		const EVENT_SPACING_MS = 8;
		const EVENT_COUNT = 60;

		for (let i = 0; i < EVENT_COUNT; i++) {
			scheduleRecompute({
				run: () => {
					runs += 1;
				},
			});
			await vi.advanceTimersByTimeAsync(EVENT_SPACING_MS);
		}

		const dragMs = EVENT_SPACING_MS * EVENT_COUNT;
		const ceiling = Math.ceil(dragMs / RECOMPUTE_THROTTLE_MS) + 1;

		// The property, stated as the ruling states it: updates happen DURING
		// the drag, at approximately one per interval.
		expect(runs).toBeGreaterThan(1);
		expect(runs).toBeLessThanOrEqual(ceiling);
		// ~1 per interval, not ~1 per event and not zero.
		expect(runs).toBeGreaterThanOrEqual(
			Math.floor(dragMs / RECOMPUTE_THROTTLE_MS) - 1,
		);
	});

	it("coalesces events inside one interval to a single run", async () => {
		const calls: number[] = [];

		// Leading edge consumes the first.
		scheduleRecompute({ run: () => { calls.push(0); } });
		await vi.advanceTimersByTimeAsync(0);
		expect(calls).toEqual([0]);

		// Three more inside the SAME interval yield exactly one further run.
		scheduleRecompute({ run: () => { calls.push(1); } });
		await vi.advanceTimersByTimeAsync(RECOMPUTE_THROTTLE_MS / 4);
		scheduleRecompute({ run: () => { calls.push(2); } });
		await vi.advanceTimersByTimeAsync(RECOMPUTE_THROTTLE_MS / 4);
		scheduleRecompute({ run: () => { calls.push(3); } });

		await vi.advanceTimersByTimeAsync(RECOMPUTE_THROTTLE_MS * 2);

		// And it is the LAST one, not the first of the batch: latest-input-wins.
		expect(calls).toEqual([0, 3]);
	});

	it("always lands the FINAL input, so the plot never settles on a stale value", async () => {
		const values: number[] = [];

		// A drag that stops abruptly. The last event arrives mid-interval, so a
		// pure leading-edge throttle would drop it and leave the plot showing
		// the second-to-last value forever.
		scheduleRecompute({ run: () => { values.push(1); } });
		await vi.advanceTimersByTimeAsync(RECOMPUTE_THROTTLE_MS / 2);
		scheduleRecompute({ run: () => { values.push(2); } });
		await vi.advanceTimersByTimeAsync(RECOMPUTE_THROTTLE_MS / 4);
		scheduleRecompute({ run: () => { values.push(999); } });

		// User lets go. Nothing more is scheduled.
		await vi.advanceTimersByTimeAsync(RECOMPUTE_THROTTLE_MS * 5);

		expect(values[values.length - 1]).toBe(999);
	});

	/**
	 * Found by the suite, not by inspection: three real-timer suites started
	 * failing the moment the throttle shipped, because they reset a mocked clock
	 * between tests and `lastRunStartedAt` was left in the FUTURE. The throttle
	 * then computed `interval - (large negative)` and stalled.
	 *
	 * The same thing happens in production for an NTP step or a manual clock
	 * change, where the stall lasts as long as the jump — so this is a real
	 * defect and not a test artefact to be worked around in the fixtures.
	 */
	it("does not stall when the wall clock jumps backwards", async () => {
		let runs = 0;
		const run = () => {
			runs += 1;
		};

		scheduleRecompute({ run });
		await vi.advanceTimersByTimeAsync(0);
		expect(runs).toBe(1);

		// The clock steps back a minute, mid-gesture.
		vi.setSystemTime(new Date(Date.now() - 60_000));

		scheduleRecompute({ run });
		await vi.advanceTimersByTimeAsync(0);
		expect(runs).toBe(2);
	});

	/**
	 * Latest-input-wins, and the two passes NEVER OVERLAP while doing it.
	 *
	 * This test previously asserted the opposite of its second half: it expected
	 * the replacement to have already run WHILE the first pass was still blocked
	 * (`secondRan` true before `resolveFirst()`). That encoded the concurrency
	 * bug rather than the contract — with a ~45-49 ms cycle against a 20 ms
	 * interval, overlap was the steady state of a gps-lap drag, and two passes
	 * writing AppState and calling `Plotly.react` in nondeterministic order let
	 * the plot and the stored result disagree. The runner now chains passes, so
	 * the replacement waits for the in-flight one and the guarantee it delivers
	 * is the one the name always claimed: the LAST input is what finally lands.
	 */
	it("latest-input-wins, and never runs two passes at once", async () => {
		resetRecomputeThrottle();

		let resolveFirst!: () => void;
		const firstDone = new Promise<void>((resolve) => {
			resolveFirst = () => resolve();
		});

		let firstFinished = false;
		let secondRan = false;
		let secondStartedWhileFirstInFlight = false;

		scheduleRecompute({
			run: async () => {
				await firstDone;
				firstFinished = true;
			},
		});

		await vi.advanceTimersByTimeAsync(RECOMPUTE_THROTTLE_MS);

		scheduleRecompute({
			run: () => {
				secondRan = true;
				if (!firstFinished) {
					secondStartedWhileFirstInFlight = true;
				}
			},
		});

		// The first pass is still blocked, so the replacement is queued, NOT
		// started alongside it.
		await vi.advanceTimersByTimeAsync(RECOMPUTE_THROTTLE_MS);
		expect(secondRan).toBe(false);

		// Releasing the first hands the queue to the replacement.
		resolveFirst();
		await vi.advanceTimersByTimeAsync(300);

		expect(secondRan).toBe(true);
		expect(secondStartedWhileFirstInFlight).toBe(false);
		expect(pillState()).toBe("idle");
	});

	/**
	 * The handoff status, at the only timing where a user can see it.
	 *
	 * Under the throttle, an input that arrives when the interval has ALREADY
	 * elapsed supersedes the in-flight run and starts its replacement in the
	 * same tick, so `handoff` is a zero-duration state — set and immediately
	 * overwritten by `running`. That is correct: the throttle permits the run,
	 * so there is nothing to wait for and nothing to announce.
	 *
	 * The status is only observable when the new input lands INSIDE the window
	 * and the replacement run is therefore deferred, which is the case asserted
	 * here.
	 */
	it("announces handoff while a superseding input waits out the interval", async () => {
		resetRecomputeThrottle();

		let releaseFirst!: () => void;
		const firstRun = new Promise<void>((resolve) => {
			releaseFirst = () => resolve();
		});

		// Leading edge: runs on the next macrotask and blocks on the promise.
		scheduleRecompute({
			run: async () => {
				await firstRun;
			},
		});
		await vi.advanceTimersByTimeAsync(0);
		expect(pillState()).toBe("running");

		// Superseded from INSIDE the window, so the replacement is deferred.
		await vi.advanceTimersByTimeAsync(RECOMPUTE_THROTTLE_MS / 4);
		scheduleRecompute({ run: () => {} });
		expect(pillState()).toBe("handoff");

		// It stays announced for the rest of the window, not for one tick.
		await vi.advanceTimersByTimeAsync(RECOMPUTE_THROTTLE_MS / 4);
		expect(pillState()).toBe("handoff");

		// Still handoff once the window expires: the runner serialises, so the
		// replacement is queued behind the blocked first pass rather than
		// starting next to it. (This assertion read `running` while the passes
		// overlapped — the copy is honest either way, since a superseding input
		// genuinely is still waiting, but it now waits on the pass rather than
		// on the interval.)
		await vi.advanceTimersByTimeAsync(RECOMPUTE_THROTTLE_MS);
		expect(pillState()).toBe("handoff");

		// Releasing the first pass lets the replacement run to completion, which
		// announces "Updated".
		//
		// This assertion read `running` while it was pointed at
		// `appState.recomputeStatus`, and that was the mirror field being wrong
		// rather than the copy being right: the replacement's `run` is
		// synchronous, so within this same tick it starts AND finishes, and
		// `flashUpdatedStatus` writes "Updated" straight to the node without
		// going through `setRecomputeStatus`. The field was therefore left
		// reading "running" while the user was already looking at "Updated" —
		// a divergence no assertion on the field could ever have caught.
		releaseFirst();
		await vi.advanceTimersByTimeAsync(0);
		expect(pillState()).toBe("updated");
	});

	it("latest completion returns status to idle", async () => {
		resetRecomputeThrottle();

		scheduleRecompute({ run: () => {} });

		await vi.advanceTimersByTimeAsync(RECOMPUTE_THROTTLE_MS);
		await vi.advanceTimersByTimeAsync(300);

		expect(pillState()).toBe("idle");
	});

	// D-15: one interval for every mode. This used to run once per member of a
	// `RecomputeMode` union, which was the only way to state "no per-mode table"
	// while the request still carried a mode. It no longer does — a per-mode
	// throttle is now unconstructible without re-adding that field, so the
	// parameterisation was asserting over a dimension that does not exist and
	// the property collapses to the single timing below.
	//
	// Written against the exported constant so plan 04 (D-16) can ratify a
	// different value without touching this test.
	it("throttles on the one uniform constant", async () => {
		resetRecomputeThrottle();
		let runs = 0;

		// Leading edge.
		scheduleRecompute({
			run: () => {
				runs += 1;
			},
		});
		await vi.advanceTimersByTimeAsync(0);
		expect(runs).toBe(1);

		// Inside the window: no second run.
		scheduleRecompute({
			run: () => {
				runs += 1;
			},
		});
		await vi.advanceTimersByTimeAsync(RECOMPUTE_THROTTLE_MS - 1);
		expect(runs).toBe(1);

		// The window closes and the pending one lands.
		await vi.advanceTimersByTimeAsync(1);
		expect(runs).toBe(2);
	});

	it("no longer exports a per-mode debounce table, nor the debounce name", () => {
		const exportedNames = Object.keys(recomputeRunnerModule);

		expect(exportedNames).toContain("RECOMPUTE_THROTTLE_MS");
		// The rename is deliberate: the old name described the wrong mechanism,
		// and anything still importing it should fail loudly rather than keep
		// compiling against a constant that now means something else.
		expect(exportedNames).not.toContain("RECOMPUTE_DEBOUNCE_MS");
		expect(exportedNames).not.toContain("HEAVY_RECOMPUTE_DEBOUNCE_MS");
		expect(exportedNames).not.toContain("STANDARD_RECOMPUTE_DEBOUNCE_MS");
		expect(exportedNames).not.toContain("GPS_LAP_RECOMPUTE_DEBOUNCE_MS");
	});

	it("does not mirror status onto AppState", () => {
		const appState = new AppState();

		expect("recomputeStatus" in appState).toBe(false);
	});
});
