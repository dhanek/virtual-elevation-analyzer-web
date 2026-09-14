/**
 * A PARAMETER SAVE KEEPS THE GATES, against a real IndexedDB.
 *
 * `saveParameters` runs on every parameter change, and auto-rho changes the
 * parameters on every file load. It used to rebuild the record from
 * `parameters` and `lapSettings` alone, so each of those saves dropped the
 * three gate families stored beside them — a gate placed in Section 3 did not
 * survive reopening its file, whether or not the user touched a setting.
 *
 * `fake-indexeddb` is the store's own engine, not a stub of it; see
 * `resultsStorageDelete.test.ts` for why a fresh factory per test.
 */
import { IDBFactory } from "fake-indexeddb";
import { beforeEach, describe, expect, it } from "vitest";
import { DEFAULT_PARAMETERS } from "../components/AnalysisParameters";
import { ParameterStorage } from "./ParameterStorage";

const FILE = "hash_ride";
const LAPS = [10, 12, 16];

describe("saveParameters keeps what it did not write", () => {
	let storage: ParameterStorage;

	beforeEach(async () => {
		globalThis.indexedDB = new IDBFactory();
		storage = new ParameterStorage();
		await storage.initialize();
		await storage.saveParameters(FILE, DEFAULT_PARAMETERS, "ride.fit");
	});

	it("every gate family survives a later parameter save", async () => {
		await storage.saveGpsMarkerSettings(FILE, LAPS, { gateTimeOffset: 8 });
		await storage.saveOutAndBackMarkerSettings(FILE, LAPS, {
			gateATimeOffset: 8,
			gateBTimeOffset: 50,
		});
		await storage.saveOneWayMarkerSettings(FILE, LAPS, {
			gateATimeOffset: 100,
			gateBTimeOffset: 120,
		});

		await storage.saveParameters(
			FILE,
			{ ...DEFAULT_PARAMETERS, system_mass: 76 },
			"ride.fit",
		);

		expect((await storage.loadParameters(FILE))?.system_mass).toBe(76);
		expect(await storage.loadGpsMarkerSettings(FILE, LAPS)).toEqual({
			gateTimeOffset: 8,
		});
		expect(await storage.loadOutAndBackMarkerSettings(FILE, LAPS)).toEqual({
			gateATimeOffset: 8,
			gateBTimeOffset: 50,
		});
		expect(await storage.loadOneWayMarkerSettings(FILE, LAPS)).toEqual({
			gateATimeOffset: 100,
			gateBTimeOffset: 120,
		});
	});
});
