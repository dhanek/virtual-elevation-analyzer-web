/**
 * Regression tests for the stale-trim map-marker bug: after an analysis,
 * switching lap checkboxes must never let the (still-bound) VE trim handlers
 * repaint the previous lap's start/end markers onto the new lap's route.
 * The guard says the map may only follow the VE panel while the panel's
 * analyzed laps still equal the live checkbox selection.
 */
import { describe, it, expect } from "vitest";
import { veViewMatchesSelection } from "./veSelectionGuard";

describe("veViewMatchesSelection", () => {
	it("blocks map repaints after the user switches to a different lap", () => {
		// VE panel was rendered for lap 1; user has now checked lap 2.
		// This is the exact state in which auto-rho's synthetic input dispatch
		// used to paint lap 1's trim markers on lap 2's route.
		expect(veViewMatchesSelection([1], [2])).toBe(false);
	});

	it("blocks map repaints when the selection gained or lost laps", () => {
		expect(veViewMatchesSelection([1], [1, 2])).toBe(false);
		expect(veViewMatchesSelection([1, 2], [1])).toBe(false);
		expect(veViewMatchesSelection([1, 2], [])).toBe(false);
	});

	it("allows map repaints while the analyzed laps are still selected", () => {
		expect(veViewMatchesSelection([1], [1])).toBe(true);
		expect(veViewMatchesSelection([1, 2, 3], [1, 2, 3])).toBe(true);
	});

	it("compares selections order-insensitively", () => {
		expect(veViewMatchesSelection([1, 2], [2, 1])).toBe(true);
	});

	it("blocks map repaints when no analysis has been run", () => {
		expect(veViewMatchesSelection([], [])).toBe(false);
		expect(veViewMatchesSelection([], [1])).toBe(false);
	});

	it("does not mutate its inputs when sorting", () => {
		const analyzed = [2, 1];
		const selected = [1, 2];
		veViewMatchesSelection(analyzed, selected);
		expect(analyzed).toEqual([2, 1]);
	});
});
