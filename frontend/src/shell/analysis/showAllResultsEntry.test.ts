/**
 * @vitest-environment jsdom
 *
 * THE APP-FOOTER ENTRY POINT — the results view without a file loaded.
 *
 * The stored results are one global IndexedDB store spanning every ride ever
 * analysed; nothing about them depends on what is currently open. Until this,
 * though, the only way in was the VE sidebar footer, which does not exist until
 * a file is chosen, laps are selected and Analyze is pressed.
 *
 * The asymmetry that made the case: the app footer has carried "Clear Results &
 * Saved Parameters" all along, against that same store, with no file loaded. So
 * every stored result could be DESTROYED from a cold start but not READ. This
 * entry point is also what makes that clear button an informed decision rather
 * than a leap.
 *
 * Bound through a named function rather than inline in `initializeApplication`
 * so it can be driven here: that function needs the whole DOM and every storage
 * backend to run at all, and a wiring bug in it is exactly the class this repo
 * has been bitten by (`gpsModeRealChain.test.ts`'s header note: the suite stayed
 * green while both GPS modes were completely inert).
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { bindShowAllResultsButton } from "./storageHandlers";
import type { ResultsViewStorage } from "./storageHandlers";

function emptyStore(): ResultsViewStorage {
	return {
		getAllResults: async () => [],
		deleteResult: async () => {},
	};
}

describe("the app-footer results entry point", () => {
	beforeEach(() => {
		document.body.innerHTML = "";
		localStorage.clear();
	});

	it("opens the results view with no file loaded", async () => {
		document.body.innerHTML = `<button id="showAllResultsFooter">Show All Results</button>`;
		bindShowAllResultsButton(
			document.getElementById("showAllResultsFooter"),
			emptyStore(),
		);

		expect(document.getElementById("resultsModal")).toBeNull();
		document.getElementById("showAllResultsFooter")!.click();

		await vi.waitFor(() =>
			expect(document.getElementById("resultsModal")).not.toBeNull(),
		);
	});

	/**
	 * A cold browser has nothing stored, and that is the state this button is
	 * MOST likely to be pressed in. It must explain itself rather than present an
	 * empty table.
	 */
	it("shows the empty state rather than a bare table", async () => {
		document.body.innerHTML = `<button id="showAllResultsFooter"></button>`;
		bindShowAllResultsButton(
			document.getElementById("showAllResultsFooter"),
			emptyStore(),
		);

		document.getElementById("showAllResultsFooter")!.click();
		await vi.waitFor(() =>
			expect(document.getElementById("resultsEmpty")).not.toBeNull(),
		);

		expect(document.getElementById("resultsEmpty")!.hidden).toBe(false);
		expect(
			document.querySelectorAll("#resultsTable tbody tr"),
		).toHaveLength(0);
	});

	/**
	 * `initializeApplication` resolves its DOM refs with `getElementById` and a
	 * cast, so an id typo or a removed element arrives here as `null` rather than
	 * as a type error. Binding must not throw the whole app init on that.
	 */
	it("is a no-op when the button is not in the page", () => {
		expect(() =>
			bindShowAllResultsButton(null, emptyStore()),
		).not.toThrow();
	});
});
