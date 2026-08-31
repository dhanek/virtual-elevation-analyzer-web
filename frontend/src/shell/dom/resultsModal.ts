/**
 * The stored-results view: a table of everything Store Result has kept, with
 * per-column hiding and per-entry delete.
 *
 * Until this, the only way to see stored results was to download the CSV and
 * open it in something else — a spreadsheet round trip to answer "did that run
 * save?". Deleting a single bad entry was not possible at all: the store had
 * `clearAllResults` and nothing between that and keeping everything.
 *
 * COLUMNS COME FROM `RESULT_COLUMNS`, NOT FROM A LIST HERE. That array is what
 * the CSV export renders from too, so the table and the file cannot disagree
 * about what a result contains, and a new field reaches both or neither. A
 * private column list in this file would be the third parallel list of the same
 * 32 things — the shape WR-02 and WR-4 both came from.
 *
 * DEPENDENCIES ARE INJECTED rather than importing `ResultsStorage`: the two
 * functions this needs are the whole contract, and taking them as arguments is
 * what lets the view be driven in jsdom without an IndexedDB.
 */
import { RESULT_COLUMNS } from "../../utils/resultColumns";
import {
	virtualDistanceCsvCells,
	type StoredVEResult,
} from "../../utils/ResultsStorage";
import { log } from "../../utils/log";

/** The composite key a stored row is addressed by. */
export interface StoredResultKey {
	fileName: string;
	lapKey: string;
	notes: string;
}

export interface ResultsModalDeps {
	getAllResults: () => Promise<StoredVEResult[]>;
	deleteResult: (key: StoredResultKey) => Promise<void>;
}

/**
 * Hidden columns are remembered by COLUMN ID, never by header text: a header is
 * display copy and renaming one must not silently un-hide a column, or hide a
 * different one that happens to have taken the old name.
 */
export const HIDDEN_COLUMNS_STORAGE_KEY = "veResultsHiddenColumns";

const MODAL_ID = "resultsModal";

function readHiddenColumns(): Set<string> {
	try {
		const raw = localStorage.getItem(HIDDEN_COLUMNS_STORAGE_KEY);
		if (!raw) return new Set();
		const parsed: unknown = JSON.parse(raw);
		if (!Array.isArray(parsed)) return new Set();
		// An id that no longer matches a column is DROPPED rather than kept: the
		// same rule the CSV follows for a field a record predates. A stale
		// preference must not be able to take the view down or hide a column
		// nobody asked to hide.
		const known = new Set(RESULT_COLUMNS.map((column) => column.id));
		return new Set(parsed.filter((id): id is string => known.has(id as string)));
	} catch (error) {
		// A private window, cleared site data, or storage the browser refuses.
		// The view still opens; it just shows every column.
		log.warn("Could not read hidden results columns:", error);
		return new Set();
	}
}

function writeHiddenColumns(hidden: Set<string>): void {
	try {
		localStorage.setItem(
			HIDDEN_COLUMNS_STORAGE_KEY,
			JSON.stringify([...hidden]),
		);
	} catch (error) {
		log.warn("Could not persist hidden results columns:", error);
	}
}

function keyOf(result: StoredVEResult): StoredResultKey {
	return {
		fileName: result.fileName,
		lapKey: result.lapKey,
		notes: result.notes,
	};
}

/**
 * Teardown for the view that is currently open, installed by
 * `openResultsModal`.
 *
 * The listener the view registers is on `document`, not on the modal element,
 * so removing the element does not remove it. Without this ref the exported
 * close — which also runs at the top of every open — left a live handler
 * holding a detached modal: Escape then "closed" that dead view and threw focus
 * back to whatever had it when the view was opened.
 */
let closeOpenView: (() => void) | null = null;

/** Close whatever results view is open, if any. */
export function closeResultsModal(): void {
	const close = closeOpenView;
	closeOpenView = null;
	close?.();
	// Belt and braces: an element left behind by an earlier build that
	// registered no teardown.
	document.getElementById(MODAL_ID)?.remove();
}

/**
 * Build and show the view.
 *
 * Everything is created with `createElement` and `textContent` rather than an
 * HTML string. Stored results carry a user-typed `notes` field and a file name
 * that came off disk; interpolating either into markup would make a stored
 * result an injection vector against the next person to open this table.
 */
export async function openResultsModal(deps: ResultsModalDeps): Promise<void> {
	closeResultsModal();

	let results: StoredVEResult[];
	try {
		results = await deps.getAllResults();
	} catch (error) {
		log.error("Could not load stored results:", error);
		return;
	}

	const hidden = readHiddenColumns();
	const visible = () =>
		RESULT_COLUMNS.filter((column) => !hidden.has(column.id));

	const modal = document.createElement("div");
	modal.id = MODAL_ID;
	modal.className = "results-modal";

	const backdrop = document.createElement("div");
	backdrop.id = "resultsModalBackdrop";
	backdrop.className = "results-modal__backdrop";
	backdrop.addEventListener("click", close);
	modal.appendChild(backdrop);

	const dialog = document.createElement("div");
	dialog.className = "results-modal__dialog";
	dialog.setAttribute("role", "dialog");
	dialog.setAttribute("aria-modal", "true");
	dialog.setAttribute("aria-label", "Stored results");
	modal.appendChild(dialog);

	// ---- header -----------------------------------------------------------
	const header = document.createElement("div");
	header.className = "results-modal__header";

	const title = document.createElement("h2");
	title.textContent = `Stored results (${results.length})`;
	header.appendChild(title);

	const closeBtn = document.createElement("button");
	closeBtn.type = "button";
	closeBtn.id = "resultsModalClose";
	closeBtn.className = "results-modal__close";
	closeBtn.setAttribute("aria-label", "Close");
	closeBtn.textContent = "×";
	closeBtn.addEventListener("click", close);
	header.appendChild(closeBtn);

	dialog.appendChild(header);

	// ---- column visibility -------------------------------------------------
	const columnsBar = document.createElement("details");
	columnsBar.className = "results-modal__columns";
	const columnsSummary = document.createElement("summary");
	columnsSummary.textContent = "Columns";
	columnsBar.appendChild(columnsSummary);

	const columnsList = document.createElement("div");
	columnsList.className = "results-modal__column-list";
	for (const column of RESULT_COLUMNS) {
		const label = document.createElement("label");
		const box = document.createElement("input");
		box.type = "checkbox";
		box.dataset.column = column.id;
		box.checked = !hidden.has(column.id);
		box.addEventListener("change", () => {
			if (box.checked) {
				hidden.delete(column.id);
			} else {
				hidden.add(column.id);
			}
			writeHiddenColumns(hidden);
			renderTable();
		});
		label.appendChild(box);
		label.appendChild(document.createTextNode(` ${column.header}`));
		columnsList.appendChild(label);
	}
	columnsBar.appendChild(columnsList);
	dialog.appendChild(columnsBar);

	// ---- table -------------------------------------------------------------
	const scroller = document.createElement("div");
	scroller.className = "results-modal__scroll";
	const table = document.createElement("table");
	table.id = "resultsTable";
	table.className = "results-table";
	const thead = document.createElement("thead");
	const tbody = document.createElement("tbody");
	table.appendChild(thead);
	table.appendChild(tbody);
	scroller.appendChild(table);
	dialog.appendChild(scroller);

	const empty = document.createElement("p");
	empty.id = "resultsEmpty";
	empty.className = "results-modal__empty";
	empty.textContent =
		"No results stored yet. Press Store Result after an analysis to keep one.";
	dialog.appendChild(empty);

	function renderTable(): void {
		const columns = visible();

		thead.replaceChildren();
		const headRow = document.createElement("tr");
		for (const column of columns) {
			const th = document.createElement("th");
			th.scope = "col";
			th.textContent = column.header;
			headRow.appendChild(th);
		}
		const actionsHead = document.createElement("th");
		actionsHead.scope = "col";
		actionsHead.textContent = "";
		headRow.appendChild(actionsHead);
		thead.appendChild(headRow);

		tbody.replaceChildren();
		for (const result of results) {
			tbody.appendChild(buildRow(result, columns));
		}

		empty.hidden = results.length > 0;
		table.hidden = results.length === 0;
	}

	function buildRow(
		result: StoredVEResult,
		columns: readonly (typeof RESULT_COLUMNS)[number][],
	): HTMLTableRowElement {
		const tr = document.createElement("tr");
		// Computed ONCE per row and handed to the four columns that read it,
		// matching what the CSV writer does.
		const vd = virtualDistanceCsvCells(result.virtualDistances);

		for (const column of columns) {
			const td = document.createElement("td");
			td.textContent = column.cell(result, vd);
			tr.appendChild(td);
		}

		const actions = document.createElement("td");
		actions.className = "results-table__actions";
		actions.appendChild(deleteControl(result, tr, actions));
		tr.appendChild(actions);
		return tr;
	}

	/**
	 * Delete, then Confirm/Cancel IN PLACE on the row.
	 *
	 * In place rather than a dialog because this view is itself a dialog, and a
	 * second layer over it is both awkward to dismiss and easy to confirm
	 * without having read which row it belongs to. Keeping the choice on the row
	 * keeps the row's own values on screen while the user decides.
	 */
	function deleteControl(
		result: StoredVEResult,
		tr: HTMLTableRowElement,
		actions: HTMLElement,
	): HTMLButtonElement {
		const button = document.createElement("button");
		button.type = "button";
		button.dataset.action = "delete";
		button.className = "results-table__delete";
		button.textContent = "Delete";
		button.addEventListener("click", () => {
			actions.replaceChildren(confirmPair(result, tr, actions));
		});
		return button;
	}

	function confirmPair(
		result: StoredVEResult,
		tr: HTMLTableRowElement,
		actions: HTMLElement,
	): DocumentFragment {
		const fragment = document.createDocumentFragment();

		const confirm = document.createElement("button");
		confirm.type = "button";
		confirm.dataset.action = "confirm-delete";
		confirm.className = "results-table__confirm";
		confirm.textContent = "Confirm";
		confirm.addEventListener("click", () => {
			// Disabled immediately: a double click would otherwise fire two
			// deletes, and the second one resolves against a key that is already
			// gone. Harmless in IndexedDB, but it would also run the row removal
			// twice.
			confirm.disabled = true;
			void (async () => {
				try {
					await deps.deleteResult(keyOf(result));
				} catch (error) {
					log.error("Could not delete stored result:", error);
					confirm.disabled = false;
					return;
				}
				results = results.filter((candidate) => candidate !== result);
				tr.remove();
				title.textContent = `Stored results (${results.length})`;
				empty.hidden = results.length > 0;
				table.hidden = results.length === 0;
			})();
		});

		const cancel = document.createElement("button");
		cancel.type = "button";
		cancel.dataset.action = "cancel-delete";
		cancel.className = "results-table__cancel";
		cancel.textContent = "Cancel";
		cancel.addEventListener("click", () => {
			actions.replaceChildren(deleteControl(result, tr, actions));
		});

		fragment.appendChild(confirm);
		fragment.appendChild(cancel);
		return fragment;
	}

	function onKeydown(event: KeyboardEvent): void {
		if (event.key === "Escape") {
			close();
		}
	}

	// Routed through the module-level ref so that EVERY close runs the same
	// teardown, including `closeResultsModal()` called from outside.
	function close(): void {
		closeResultsModal();
	}

	function teardown(): void {
		document.removeEventListener("keydown", onKeydown);
		modal.remove();
		previouslyFocused?.focus?.();
	}

	const previouslyFocused = document.activeElement as HTMLElement | null;

	renderTable();
	closeOpenView = teardown;
	document.addEventListener("keydown", onKeydown);
	document.body.appendChild(modal);
	closeBtn.focus();
}
