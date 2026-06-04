import { describe, expect, it } from "vitest";
import { AppState } from "../../state/AppState";
import { gpsLapMode } from "./gpsLapMode";
import { outAndBackMode } from "./outAndBackMode";
import { standardMode } from "./standardMode";
import type { PreparedAnalysisSelection } from "./types";

function selection(
	overrides: Partial<PreparedAnalysisSelection> = {},
): PreparedAnalysisSelection {
	return {
		mode: "gpsLap",
		selectedItems: [],
		selectedEntries: [],
		indexRanges: [{ startIdx: 0, endIdx: 5 }],
		timeRanges: null,
		outAndBackSections: null,
		emptySelectionMessage: "",
		...overrides,
	};
}

describe("syncState clears stale overlay lap numbers", () => {
	it("gpsLap mode resets currentOverlayLapNumbers (no leak from a prior Stacked toggle)", () => {
		const appState = new AppState();
		appState.currentOverlayLapNumbers = [2, 3, 4];

		gpsLapMode.syncState(appState, selection());

		expect(appState.currentOverlayLapNumbers).toBeNull();
	});

	it("outAndBack mode resets currentOverlayLapNumbers", () => {
		const appState = new AppState();
		appState.currentOverlayLapNumbers = [2, 3, 4];

		outAndBackMode.syncState(appState, selection({ mode: "outAndBack" }));

		expect(appState.currentOverlayLapNumbers).toBeNull();
	});

	it("standard mode resets currentOverlayLapNumbers (stacked toggle re-sets it later)", () => {
		const appState = new AppState();
		appState.currentOverlayLapNumbers = [2, 3, 4];

		standardMode.syncState(appState, selection({ mode: "standard" }));

		expect(appState.currentOverlayLapNumbers).toBeNull();
	});
});
