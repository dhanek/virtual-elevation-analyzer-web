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

describe("saveParameters field preservation", () => {
	it("keeps gate maps and the Section-3 selection across a parameters save", async () => {
		const storage = await freshStorage();
		await storage.importStoredRecord({
			fileHash: "hash_d",
			parameters: { ...DEFAULT_PARAMETERS, cda: 0.3 },
			lapSettings: { "3-5": { trimStart: 0, trimEnd: 50, cda: 0.3, crr: 0.005 } },
			gpsMarkerSettings: { "3-5": { gateTimeOffset: 20 } },
			outAndBackMarkerSettings: {
				"3-5": { gateATimeOffset: 15, gateBTimeOffset: 150 },
			},
			section3: {
				gpsAnalysisMode: "GPS based out and back",
				selectedLaps: [3, 5],
			},
			lastUsed: 1,
			fileName: "d.fit",
		});

		await storage.saveParameters("hash_d", { ...DEFAULT_PARAMETERS, cda: 0.29 });

		const record = await storage.getStoredRecord("hash_d");
		expect(record?.parameters.cda).toBe(0.29);
		expect(record?.gpsMarkerSettings).toEqual({ "3-5": { gateTimeOffset: 20 } });
		expect(record?.outAndBackMarkerSettings).toEqual({
			"3-5": { gateATimeOffset: 15, gateBTimeOffset: 150 },
		});
		expect(record?.section3).toEqual({
			gpsAnalysisMode: "GPS based out and back",
			selectedLaps: [3, 5],
		});
	});
});

describe("saveSection3", () => {
	it("merges into an existing record without touching its other fields", async () => {
		const storage = await freshStorage();
		await storage.saveParameters("hash_e", { ...DEFAULT_PARAMETERS, cda: 0.27 });
		await storage.saveGpsMarkerSettings("hash_e", [2], { gateTimeOffset: 7 });

		await storage.saveSection3("hash_e", {
			gpsAnalysisMode: "GPS based lap splitting",
			selectedLaps: [2],
		});

		const record = await storage.getStoredRecord("hash_e");
		expect(record?.section3).toEqual({
			gpsAnalysisMode: "GPS based lap splitting",
			selectedLaps: [2],
		});
		expect(record?.parameters.cda).toBe(0.27);
		expect(record?.gpsMarkerSettings).toEqual({ "2": { gateTimeOffset: 7 } });
	});

	it("creates a default record when the file has none yet", async () => {
		const storage = await freshStorage();
		await storage.saveSection3("hash_f", {
			gpsAnalysisMode: "None",
			selectedLaps: [1],
		});

		const record = await storage.getStoredRecord("hash_f");
		expect(record?.section3?.selectedLaps).toEqual([1]);
		// The record must be loadable through the normal read path.
		expect(await storage.loadParameters("hash_f")).not.toBeNull();
	});
});
