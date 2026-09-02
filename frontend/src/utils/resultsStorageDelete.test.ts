/**
 * PER-ENTRY DELETE, against a real IndexedDB.
 *
 * Until this file the store's IndexedDB half had no coverage at all: jsdom ships
 * no IndexedDB, so `saveResult`, `getAllResults` and `clearAllResults` were
 * exercised only by hand. That was tolerable for an append and an
 * all-or-nothing clear. It is not tolerable for a keyed DELETE, because the
 * assertion that matters is not "the row went" — it is **"only that row went"**,
 * and nothing about a composite key `[fileName, lapKey, notes]` makes that
 * obvious from reading the call.
 *
 * `fake-indexeddb` is the store's own engine, not a stub of it: the same
 * key-comparison and transaction semantics the browser applies. A hand-rolled
 * double would have been free to agree with whatever the code did, which is the
 * failure mode this branch has spent its time removing.
 */
import { IDBFactory } from "fake-indexeddb";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
	ResultsStorage,
	type SaveResultData,
	type VEAnalysisResult,
} from "./ResultsStorage";
import type { AnalysisParameters } from "../components/AnalysisParameters";

const params = {
	wind_speed: 3.5,
	wind_direction: 220,
	wind_height_factor: 0.72,
} as unknown as AnalysisParameters;

const result = {
	r2: 0.98,
	rmse: 1.23,
	ve_elevation_diff: 4,
	actual_elevation_diff: 5,
	virtual_elevation: new Float64Array(0),
	virtual_distance_air: 0,
	virtual_distance_ground: 0,
	vd_difference_percent: 0,
} as unknown as VEAnalysisResult;

function record(overrides: Partial<SaveResultData> = {}): SaveResultData {
	return {
		fileName: "ride.fit",
		laps: [1],
		trimStart: 0,
		trimEnd: 100,
		cda: 0.25,
		crr: 0.004,
		windSource: "fit",
		parameters: params,
		result,
		avgPower: 250,
		avgSpeed: 36,
		notes: "",
		recordingDate: "2026-08-04",
		timestamp: new Date("2026-08-04T10:00:00.000Z"),
		...overrides,
	} as SaveResultData;
}

/** Identify a stored row the way a human reading the table would. */
const identify = (r: { fileName: string; lapKey: string; notes: string }) =>
	`${r.fileName}|${r.lapKey}|${r.notes}`;

/**
 * THE STORE OPENS ITSELF, because the results view is reachable with no file
 * loaded.
 *
 * `initialize()` had exactly one production caller, on the startup path
 * (`fileLoadOrchestration.ts:91`), and it runs after the WASM module and the FIT
 * processor. The footer's "Show All Results" is bound before any of that
 * (`initializeApplication.ts:324`) and is the entry point whose whole point is
 * that it works with nothing open — which is precisely the window in which the
 * database is not. `getAllResults` answers `[]` rather than throwing when it has
 * no connection, so the user was shown "Stored results (0)" over a populated
 * store, and "Clear Results" beside it cleared nothing.
 */
describe("reading the store before anything has opened it", () => {
	beforeEach(() => {
		globalThis.indexedDB = new IDBFactory();
	});

	/** Put rows in the database and drop the connection that wrote them. */
	async function seedTwoRows(): Promise<void> {
		const writer = new ResultsStorage();
		await writer.initialize();
		await writer.saveResult(record({ fileName: "a.fit", laps: [1] }));
		await writer.saveResult(record({ fileName: "b.fit", laps: [2] }));
	}

	it("opens on demand rather than reporting an empty store", async () => {
		await seedTwoRows();

		// Never initialized: the footer button's state on a cold page.
		const reader = new ResultsStorage();

		expect(await reader.getAllResults()).toHaveLength(2);
	});

	it("clears on demand rather than clearing nothing", async () => {
		await seedTwoRows();

		const cold = new ResultsStorage();
		await cold.clearAllResults();

		expect(await cold.getAllResults()).toHaveLength(0);
	});

	it("opens once however many readers arrive together", async () => {
		await seedTwoRows();

		const storage = new ResultsStorage();
		const opens = vi.spyOn(globalThis.indexedDB, "open");

		// Two readers inside the same open. Memoised on the promise rather than
		// on a `db !== null` check, because that check is still false while the
		// first open is in flight — two concurrent `openDatabase` runs would
		// mean two version-upgrade/migration sequences against one database.
		const [first, second] = await Promise.all([
			storage.getAllResults(),
			storage.getAllResults(),
		]);
		const afterConcurrent = opens.mock.calls.length;

		expect(first).toHaveLength(2);
		expect(second).toHaveLength(2);

		// And an already-open store opens nothing further.
		await storage.getAllResults();
		expect(opens.mock.calls.length).toBe(afterConcurrent);

		opens.mockRestore();
	});

	it("retries after a failed open instead of latching the failure", async () => {
		await seedTwoRows();

		const storage = new ResultsStorage();
		const opens = vi
			.spyOn(globalThis.indexedDB, "open")
			.mockImplementationOnce(() => {
				throw new Error("storage refused");
			});

		// A refused open is reported as an empty table, not as a broken page.
		expect(await storage.getAllResults()).toEqual([]);

		// And the memoised promise is dropped on failure, so the next reader
		// tries again rather than inheriting the first one's bad luck forever.
		opens.mockRestore();
		expect(await storage.getAllResults()).toHaveLength(2);
	});
});

describe("deleting one stored result", () => {
	let storage: ResultsStorage;

	beforeEach(async () => {
		// A FRESH factory per test, rather than deleting the database on a
		// shared one. `deleteDatabase` against a connection the previous test
		// left open BLOCKS rather than erroring, which surfaces as a hook
		// timeout -- a failure nobody can read back to its cause. A new factory
		// has no connections and no databases by construction.
		//
		// The top-level export is used rather than `fake-indexeddb/lib/...`:
		// the package publishes types only for its package root, so the deep
		// path type-checks as `any` and `npm run check` rejects it.
		globalThis.indexedDB = new IDBFactory();

		storage = new ResultsStorage();
		await storage.initialize();
	});

	/**
	 * THE assertion. The three rows differ in exactly one key component each, so
	 * a delete that compared on `fileName` alone, or on `lapKey` alone, or that
	 * passed the components in the wrong order, takes a neighbour with it.
	 */
	it("removes only the addressed row", async () => {
		await storage.saveResult(record({ fileName: "a.fit", laps: [1], notes: "x" }));
		await storage.saveResult(record({ fileName: "a.fit", laps: [2], notes: "x" }));
		await storage.saveResult(record({ fileName: "b.fit", laps: [1], notes: "x" }));

		expect(await storage.getAllResults()).toHaveLength(3);

		await storage.deleteResult({
			fileName: "a.fit",
			lapKey: "1",
			notes: "x",
		});

		const left = (await storage.getAllResults()).map(identify);
		expect(left).toHaveLength(2);
		expect(left).toContain("a.fit|2|x");
		expect(left).toContain("b.fit|1|x");
		expect(left).not.toContain("a.fit|1|x");
	});

	/**
	 * `notes` is the third key component, and it is free text the user types at
	 * store time. Two analyses of the SAME file and the SAME laps are therefore
	 * distinct rows whenever the notes differ — which is the whole reason the
	 * key is a triple — so deleting one must not take the other.
	 */
	it("distinguishes rows that differ only by their notes", async () => {
		await storage.saveResult(record({ notes: "baseline" }));
		await storage.saveResult(record({ notes: "with skinsuit" }));

		await storage.deleteResult({
			fileName: "ride.fit",
			lapKey: "1",
			notes: "baseline",
		});

		const left = await storage.getAllResults();
		expect(left).toHaveLength(1);
		expect(left[0].notes).toBe("with skinsuit");
	});

	/**
	 * Deleting something already gone is what a second click on a stale table
	 * does. IndexedDB's `delete` succeeds on a missing key, and this pins that
	 * the wrapper does not turn that into a rejection the caller has to handle.
	 */
	it("is a no-op when the row is already gone", async () => {
		await storage.saveResult(record());

		await storage.deleteResult({
			fileName: "nothing.fit",
			lapKey: "9",
			notes: "",
		});

		expect(await storage.getAllResults()).toHaveLength(1);
	});

	/**
	 * RESOLVING IS A CLAIM. `resultsModal` removes the row from the table and
	 * decrements its "Stored results (N)" heading the moment this settles, so
	 * every way of resolving without having deleted anything shows the user a
	 * deletion that did not happen. The two below are the ones that were
	 * reachable.
	 */
	describe("does not report a delete it did not perform", () => {
		it("rejects when the database was never opened", async () => {
			// A private window, storage the browser refuses, an `initialize`
			// that threw. `saveResult` already throws on this; the delete used
			// to return quietly, which reads as success.
			const unopened = new ResultsStorage();

			await expect(
				unopened.deleteResult({ fileName: "a.fit", lapKey: "1", notes: "" }),
			).rejects.toThrow(/not initialized/i);
		});

		it("rejects when the transaction is rolled back after the request succeeded", async () => {
			await storage.saveResult(record({ fileName: "a.fit", notes: "keep" }));

			const db = (storage as unknown as { db: IDBDatabase }).db;
			const openTransaction = db.transaction.bind(db);

			// Abort from the delete request's OWN success handler: the exact
			// shape of a write that IndexedDB reports as successful and then
			// throws away when the transaction cannot commit (quota, an
			// explicit abort, the connection closing). Resolving on
			// `request.onsuccess` cannot tell this apart from a real delete.
			vi.spyOn(db, "transaction").mockImplementation((...args: unknown[]) => {
				const transaction = (
					openTransaction as unknown as (...a: unknown[]) => IDBTransaction
				)(...args);
				const openStore = transaction.objectStore.bind(transaction);
				transaction.objectStore = (name: string) => {
					const store = openStore(name);
					const remove = store.delete.bind(store);
					store.delete = (key: IDBValidKey | IDBKeyRange) => {
						const request = remove(key);
						request.addEventListener("success", () => transaction.abort());
						return request;
					};
					return store;
				};
				return transaction;
			});

			await expect(
				storage.deleteResult({ fileName: "a.fit", lapKey: "1", notes: "keep" }),
			).rejects.toBeTruthy();

			vi.restoreAllMocks();
			// The row is still there, which is what makes the rejection the
			// truthful answer.
			expect(await storage.getAllResults()).toHaveLength(1);
		});
	});
});
