/** @vitest-environment jsdom */
import { describe, expect, it, vi, beforeEach } from "vitest";
import { AppState } from "../../state/AppState";
import { applyVeStatus } from "../../state/veStatus";
import { updateModeVEPlots } from "./updateModeVEPlots";

/**
 * These assert the ORDER of the status writes, which is the property the
 * refactor rests on: nothing may observe `ready` before `summarize` has run.
 *
 * The real mode-chain suites now cover idle/computing/ready ordering through
 * each handler's actual summarize seam. This focused file keeps the missing-
 * input transition small and direct.
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
