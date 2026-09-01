/**
 * The raw-record pair the settings export/import rides on, against a real
 * IndexedDB engine (`fake-indexeddb`, same reasoning as
 * `resultsStorageDelete.test.ts`): the claim that matters is that
 * `getStoredRecord` returns EXACTLY what the app's own save paths wrote —
 * lap settings and GPS gates included — and that `importStoredRecord`'s
 * write is then indistinguishable from those paths to `loadParameters`.
 */
import { IDBFactory } from "fake-indexeddb";
import { beforeEach, describe, expect, it } from "vitest";
import { DEFAULT_PARAMETERS } from "../components/AnalysisParameters";
import { ParameterStorage, type StoredParameters } from "./ParameterStorage";

beforeEach(() => {
	globalThis.indexedDB = new IDBFactory();
});

async function freshStorage(): Promise<ParameterStorage> {
	const storage = new ParameterStorage();
	await storage.initialize();
	return storage;
}

describe("getStoredRecord / importStoredRecord", () => {
	it("returns the record the normal save paths built, whole", async () => {
		const storage = await freshStorage();
		await storage.saveParameters("hash_a", { ...DEFAULT_PARAMETERS, cda: 0.31 }, "a.fit");
		await storage.saveLapSettings("hash_a", [1, 2], {
			trimStart: 5,
			trimEnd: 900,
			cda: 0.31,
			crr: 0.0041,
		});

		const record = await storage.getStoredRecord("hash_a");
		expect(record?.fileHash).toBe("hash_a");
		expect(record?.parameters.cda).toBe(0.31);
		expect(record?.lapSettings["1-2"]).toMatchObject({ trimStart: 5, trimEnd: 900 });
	});

	it("resolves null for an unknown hash", async () => {
		const storage = await freshStorage();
		expect(await storage.getStoredRecord("nope")).toBeNull();
	});

	it("an imported record restores through loadParameters like a native one", async () => {
		const storage = await freshStorage();
		const record: StoredParameters = {
			fileHash: "hash_b",
			parameters: { ...DEFAULT_PARAMETERS, cda: 0.244, crr: 0.0052 },
			lapSettings: { "3": { trimStart: 0, trimEnd: 100, cda: 0.244, crr: 0.0052 } },
			gpsMarkerSettings: { "3": { gateTimeOffset: 12 } },
			lastUsed: Date.now(),
			fileName: "b.fit",
		};
		await storage.importStoredRecord(record);

		expect((await storage.loadParameters("hash_b"))?.cda).toBe(0.244);
		expect(await storage.loadGpsMarkerSettings("hash_b", [3])).toMatchObject({
			gateTimeOffset: 12,
		});
	});

	it("import REPLACES an existing record rather than merging into it", async () => {
		const storage = await freshStorage();
		await storage.saveParameters("hash_c", { ...DEFAULT_PARAMETERS, cda: 0.5 });
		await storage.saveLapSettings("hash_c", [9], {
			trimStart: 1,
			trimEnd: 2,
			cda: 0.5,
			crr: 0.005,
		});
		await storage.importStoredRecord({
			fileHash: "hash_c",
			parameters: { ...DEFAULT_PARAMETERS, cda: 0.2 },
			lapSettings: {},
			lastUsed: Date.now(),
		});

		const record = await storage.getStoredRecord("hash_c");
		expect(record?.parameters.cda).toBe(0.2);
		expect(record?.lapSettings).toEqual({});
	});
});
