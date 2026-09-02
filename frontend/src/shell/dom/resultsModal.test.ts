/**
 * @vitest-environment jsdom
 *
 * THE RESULTS VIEW — the first way to see stored results without downloading a
 * file.
 *
 * Two properties carry the weight here.
 *
 * The table and the CSV render from ONE column table (`resultColumns.ts`), so
 * this file asserts the coupling rather than a column list of its own: a header
 * count taken from `RESULT_COLUMNS` fails the moment the view grows a private
 * idea of what a result contains. Restating the columns here would recreate
 * exactly the parallel-list defect the extraction removed.
 *
 * And DELETE IS DESTRUCTIVE. The confirm step, the key it sends, and the fact
 * that cancelling sends nothing are each asserted separately, because "the row
 * disappeared from the DOM" is not evidence that the right row left the
 * database — the two are different claims and only one of them is recoverable.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { RESULT_COLUMNS } from "../../utils/resultColumns";
import type { StoredVEResult } from "../../utils/ResultsStorage";
import {
	closeResultsModal,
	HIDDEN_COLUMNS_STORAGE_KEY,
	openResultsModal,
} from "./resultsModal";

function record(overrides: Partial<StoredVEResult> = {}): StoredVEResult {
	return {
		fileName: "ride.fit",
		lapKey: "1",
		trimStart: 0,
		trimEnd: 100,
		cda: 0.25,
		crr: 0.004,
		windSource: "fit",
		windSpeed: 3.5,
		windDirection: 220,
		systemMass: 80,
		rho: 1.225,
		eta: 0.97,
		r2: 0.98,
		rmse: 1.23,
		veGain: 4,
		actualGain: 5,
		avgPower: 250,
		avgSpeed: 36,
		notes: "",
		recordingDate: "2026-08-04",
		timestamp: "2026-08-04T10:00:00.000Z",
		...overrides,
	} as unknown as StoredVEResult;
}

let deleteResult: ReturnType<typeof vi.fn>;

async function open(results: StoredVEResult[]): Promise<void> {
	deleteResult = vi.fn(async () => {});
	await openResultsModal({
		getAllResults: async () => results,
		deleteResult,
	});
}

const rows = () =>
	Array.from(document.querySelectorAll("#resultsTable tbody tr"));
const headers = () =>
	Array.from(document.querySelectorAll("#resultsTable thead th"));

/** The delete control on row `i`, whatever state it is in. */
function rowButton(i: number, action: string): HTMLButtonElement {
	const button = rows()[i].querySelector<HTMLButtonElement>(
		`button[data-action="${action}"]`,
	);
	if (!button) throw new Error(`row ${i} has no "${action}" button`);
	return button;
}

describe("the stored-results view", () => {
	beforeEach(() => {
		// Through the exported close, not by wiping the body: the view's own
		// listener is on `document`, so an innerHTML reset would leave the
		// previous test's handler live and let it answer this test's keystrokes.
		closeResultsModal();
		document.body.innerHTML = "";
		localStorage.clear();
	});

	it("shows one row per stored result", async () => {
		await open([record({ lapKey: "1" }), record({ lapKey: "2" })]);
		expect(rows()).toHaveLength(2);
	});

	/**
	 * The coupling to the one column table, asserted by COUNT rather than by a
	 * duplicated list. Plus one for the actions column the table adds.
	 */
	it("renders every column the CSV exports, and no private list of its own", async () => {
		await open([record()]);

		expect(headers()).toHaveLength(RESULT_COLUMNS.length + 1);
		expect(headers()[0].textContent).toBe(RESULT_COLUMNS[0].header);
	});

	/**
	 * Asserted on VISIBILITY, not on presence. The empty-state paragraph is in
	 * the DOM either way, so `not.toBeNull()` would pass with a full table --
	 * the same vacuous shape as a guard that reads a field the fixture never
	 * sets.
	 */
	it("shows the empty state only when nothing is stored", async () => {
		await open([]);
		expect(rows()).toHaveLength(0);
		expect(document.getElementById("resultsEmpty")!.hidden).toBe(false);

		document.body.innerHTML = "";
		await open([record()]);
		expect(document.getElementById("resultsEmpty")!.hidden).toBe(true);
	});

	describe("hiding columns", () => {
		it("drops the column's header and its cells", async () => {
			await open([record()]);
			const target = RESULT_COLUMNS[2];

			document
				.querySelector<HTMLInputElement>(
					`input[data-column="${target.id}"]`,
				)!
				.click();

			const shown = headers().map((h) => h.textContent);
			expect(shown).not.toContain(target.header);
			expect(rows()[0].querySelectorAll("td")).toHaveLength(
				RESULT_COLUMNS.length, // one fewer data cell, plus the actions cell
			);
		});

		/**
		 * Persisted by ID, not by header text: renaming a header is a display
		 * change and must not silently un-hide a column, or hide a different one.
		 */
		it("remembers the choice across opens", async () => {
			await open([record()]);
			const target = RESULT_COLUMNS[2];

			document
				.querySelector<HTMLInputElement>(
					`input[data-column="${target.id}"]`,
				)!
				.click();

			expect(
				JSON.parse(localStorage.getItem(HIDDEN_COLUMNS_STORAGE_KEY)!),
			).toContain(target.id);

			document.body.innerHTML = "";
			await open([record()]);

			expect(headers().map((h) => h.textContent)).not.toContain(
				target.header,
			);
		});

		/**
		 * A stored preference naming a column that no longer exists must not take
		 * the view down — the same "an old record must still load" rule the CSV
		 * follows for dropped fields.
		 *
		 * Asserted through PRUNING, not through the header count. A count cannot
		 * see this: an unrecognised id never matches a column, so the table looks
		 * identical whether the id was filtered out or merely never matched, and
		 * the assertion passes with the filter deleted. Confirmed by doing
		 * exactly that. What IS observable is that the stale id does not survive
		 * the next write — without the filter it accumulates in localStorage
		 * forever, one dead entry per renamed column.
		 */
		it("prunes a remembered column that no longer exists", async () => {
			localStorage.setItem(
				HIDDEN_COLUMNS_STORAGE_KEY,
				JSON.stringify(["aColumnThatWasRemoved"]),
			);

			await open([record()]);
			expect(headers()).toHaveLength(RESULT_COLUMNS.length + 1);

			const real = RESULT_COLUMNS[1];
			document
				.querySelector<HTMLInputElement>(`input[data-column="${real.id}"]`)!
				.click();

			expect(
				JSON.parse(localStorage.getItem(HIDDEN_COLUMNS_STORAGE_KEY)!),
			).toEqual([real.id]);
		});

		/**
		 * localStorage is shared, writable by anything on the origin, and
		 * survives across versions. A value that is not JSON, or is JSON but not
		 * an array, must leave the view usable rather than throwing on open.
		 */
		it("survives a stored preference that is not a column list", async () => {
			localStorage.setItem(HIDDEN_COLUMNS_STORAGE_KEY, "not json at all");
			await open([record()]);
			expect(headers()).toHaveLength(RESULT_COLUMNS.length + 1);

			document.body.innerHTML = "";
			localStorage.setItem(HIDDEN_COLUMNS_STORAGE_KEY, '{"hidden":"cda"}');
			await open([record()]);
			expect(headers()).toHaveLength(RESULT_COLUMNS.length + 1);
		});
	});

	describe("deleting a row", () => {
		it("asks before deleting anything", async () => {
			await open([record()]);

			rowButton(0, "delete").click();

			expect(deleteResult).not.toHaveBeenCalled();
			expect(rowButton(0, "confirm-delete")).toBeTruthy();
		});

		it("sends the full composite key, not just the file name", async () => {
			await open([
				record({ fileName: "a.fit", lapKey: "2-3", notes: "baseline" }),
			]);

			rowButton(0, "delete").click();
			rowButton(0, "confirm-delete").click();
			await vi.waitFor(() => expect(deleteResult).toHaveBeenCalled());

			expect(deleteResult).toHaveBeenCalledWith({
				fileName: "a.fit",
				lapKey: "2-3",
				notes: "baseline",
			});
		});

		it("removes only the confirmed row from the table", async () => {
			await open([record({ lapKey: "1" }), record({ lapKey: "2" })]);

			rowButton(0, "delete").click();
			rowButton(0, "confirm-delete").click();
			await vi.waitFor(() => expect(rows()).toHaveLength(1));

			expect(rows()[0].textContent).toContain("2");
		});

		it("deletes nothing when the confirm is cancelled", async () => {
			await open([record()]);

			rowButton(0, "delete").click();
			rowButton(0, "cancel-delete").click();

			expect(deleteResult).not.toHaveBeenCalled();
			expect(rows()).toHaveLength(1);
			expect(rowButton(0, "delete")).toBeTruthy();
		});
	});

	describe("closing", () => {
		it("closes on Escape", async () => {
			await open([record()]);

			document.dispatchEvent(
				new KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
			);

			expect(document.getElementById("resultsModal")).toBeNull();
		});

		it("closes on a backdrop click but not on a click inside the dialog", async () => {
			await open([record()]);

			document.getElementById("resultsTable")!.dispatchEvent(
				new MouseEvent("click", { bubbles: true }),
			);
			expect(document.getElementById("resultsModal")).not.toBeNull();

			document.getElementById("resultsModalBackdrop")!.click();
			expect(document.getElementById("resultsModal")).toBeNull();
		});

		/**
		 * The exported close is the one the rest of the app calls, and it used
		 * to remove the element WITHOUT removing the keydown handler, which is
		 * registered on `document` and therefore outlives the element. The
		 * evidence that the handler is still live is not the modal — that is
		 * already gone — it is the focus restore inside it: Escape anywhere
		 * afterwards dragged the caret back to whatever had focus when the dead
		 * view was opened.
		 */
		it("takes its Escape handler with it when closed from outside", async () => {
			const opener = document.createElement("button");
			document.body.appendChild(opener);
			opener.focus();

			await open([record()]);
			closeResultsModal();

			const elsewhere = document.createElement("input");
			document.body.appendChild(elsewhere);
			elsewhere.focus();

			document.dispatchEvent(
				new KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
			);

			expect(document.activeElement).toBe(elsewhere);
		});

		it("still closes on Escape after an earlier view was closed from outside", async () => {
			// The other half of the same seam: a teardown ref that is cleared
			// too eagerly leaves the NEXT view without a working Escape.
			await open([record()]);
			closeResultsModal();
			await open([record()]);

			document.dispatchEvent(
				new KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
			);

			expect(document.getElementById("resultsModal")).toBeNull();
		});
	});

	/**
	 * TWO OPENS INSIDE ONE LOAD.
	 *
	 * `openResultsModal` closes whatever is up and then AWAITS `getAllResults`,
	 * and the close is not a claim on the seat. A double-click on the footer
	 * button — or the footer button and then the sidebar's, now that both reach
	 * the same view — put two opens inside that await: both passed the close,
	 * both resolved, and both appended. That leaves two elements sharing
	 * `id="resultsModal"`, a `closeOpenView` holding only the second one's
	 * teardown, and the FIRST view's `document` keydown listener armed forever on
	 * a node no longer in the page — the exact leak the "closed from outside"
	 * cases above exist to prevent, arriving by a different door.
	 */
	describe("two opens racing the same load", () => {
		/** An open whose results arrive only when the test says so. */
		function deferredOpen() {
			let release: (results: StoredVEResult[]) => void = () => {};
			const loaded = new Promise<StoredVEResult[]>((resolve) => {
				release = resolve;
			});
			const getAllResults = vi.fn(() => loaded);
			const pending = openResultsModal({
				getAllResults,
				deleteResult: vi.fn(async () => {}),
			});
			return { getAllResults, pending, release };
		}

		it("appends one view, not two", async () => {
			const first = deferredOpen();
			const second = deferredOpen();

			// BOTH released, so a build without the latch fails on the assertion
			// rather than by hanging on a promise it never awaited.
			first.release([record()]);
			second.release([record()]);
			await Promise.all([first.pending, second.pending]);

			expect(document.querySelectorAll("#resultsModal")).toHaveLength(1);
			// The second call did not even ask the store: it saw a load already
			// in flight and stood down.
			expect(second.getAllResults).not.toHaveBeenCalled();
		});

		it("leaves no Escape handler behind after the surviving view closes", async () => {
			const opener = document.createElement("button");
			document.body.appendChild(opener);
			opener.focus();

			const first = deferredOpen();
			const second = deferredOpen();
			first.release([record()]);
			second.release([record()]);
			await Promise.all([first.pending, second.pending]);

			closeResultsModal();

			const elsewhere = document.createElement("input");
			document.body.appendChild(elsewhere);
			elsewhere.focus();

			// A surviving handler from an orphaned view would run its own
			// teardown here and pull focus back to `opener`.
			document.dispatchEvent(
				new KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
			);

			expect(document.activeElement).toBe(elsewhere);
		});

		it("still opens normally once the first load has finished", async () => {
			const first = deferredOpen();
			first.release([record()]);
			await first.pending;

			// The latch is released with the load, not held for the life of the
			// view: reopening must still work.
			closeResultsModal();
			await open([record(), record({ lapKey: "2" })]);

			expect(rows()).toHaveLength(2);
		});
	});
});
