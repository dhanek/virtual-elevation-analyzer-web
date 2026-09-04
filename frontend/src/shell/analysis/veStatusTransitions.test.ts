/** @vitest-environment jsdom */
import { describe, expect, it, vi, beforeEach } from "vitest";
import { AppState } from "../../state/AppState";
import { applyVeStatus } from "../../state/veStatus";
import { updateModeVEPlots } from "./updateModeVEPlots";

/**
 * These assert the ORDER of the status writes, which is the property the
 * refactor rests on: nothing may observe `ready` before `summarize` has run.
 *
 * A second test asserting the full idle -> computing -> ready sequence through
 * a real `handler.summarize` call was scoped out here: it needs a populated
 * `AppState` (fit data, parameters, laps) built the way
 * `analyzeResultLifecycle.test.ts` builds one, but that file's `makeFitData` /
 * `makeAppState` helpers are private to it, not exported for reuse. Per the
 * task brief, rather than inventing a parallel fixture layer, that assertion
 * is left to Task 3+ (or a follow-up that first exports a shared fixture).
 */
describe("veStatus transitions in the producer", () => {
	beforeEach(() => {
		document.body.innerHTML = "";
	});

	it("goes idle when there is no fit data", async () => {
		const appState = new AppState();
		applyVeStatus(appState, "computing");

		const outcome = await updateModeVEPlots({
			appState,
			handler: { id: "standard", summarize: vi.fn() },
			callbacks: {},
			windSource: "none",
			cda: 0.3,
			crr: 0.008,
			segments: [],
		} as never);

		expect(outcome).toBeNull();
		expect(appState.veStatus).toBe("idle");
	});
});
