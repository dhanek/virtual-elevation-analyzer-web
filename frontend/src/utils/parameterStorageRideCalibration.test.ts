/**
 * The ride calibration and its per-selection overrides, against a real
 * IndexedDB (`fake-indexeddb`, a fresh factory per test).
 */
import { IDBFactory } from "fake-indexeddb";
import { beforeEach, describe, expect, it } from "vitest";
import { DEFAULT_PARAMETERS } from "../components/AnalysisParameters";
import { ParameterStorage, type LapSettings } from "./ParameterStorage";

const FILE = "hash_ride";
const entry = (extra: Partial<LapSettings> = {}): LapSettings => ({
	trimStart: 0,
	trimEnd: 100,
	cda: 0.3,
	crr: 0.004,
	...extra,
});

describe("ride calibration storage", () => {
	let storage: ParameterStorage;

	beforeEach(async () => {
		globalThis.indexedDB = new IDBFactory();
		storage = new ParameterStorage();
		await storage.initialize();
		await storage.saveParameters(FILE, DEFAULT_PARAMETERS, "ride.fit");
	});

	it("reads nothing for a file never calibrated", async () => {
		expect(await storage.loadAirSpeedCalibration(FILE, [1])).toEqual({
			ride: undefined,
			override: undefined,
		});
		expect(await storage.loadAirSpeedCalibration("unknown", [1])).toEqual({});
	});

	it("a ride value reaches every selection; an override only its own", async () => {
		await storage.saveRideAirSpeedCalibration(FILE, 7.7);
		await storage.saveAirSpeedCalibrationOverride(FILE, [4, 5, 6], 0);

		expect(await storage.loadAirSpeedCalibration(FILE, [1, 2, 3])).toEqual({
			ride: 7.7,
			override: undefined,
		});
		expect(await storage.loadAirSpeedCalibration(FILE, [6, 4, 5])).toEqual({
			ride: 7.7,
			override: 0,
		});
		// Another combination of the same laps is another selection (D7).
		expect(
			(await storage.loadAirSpeedCalibration(FILE, [5])).override,
		).toBeUndefined();

		await storage.saveAirSpeedCalibrationOverride(FILE, [4, 5, 6], null);
		expect(
			(await storage.loadAirSpeedCalibration(FILE, [4, 5, 6])).override,
		).toBeUndefined();
	});

	it("a trim or CdA save keeps the override and the ride value", async () => {
		await storage.saveRideAirSpeedCalibration(FILE, 7.7);
		await storage.saveAirSpeedCalibrationOverride(FILE, [4, 5, 6], 5);
		await storage.saveLapSettings(FILE, [4, 5, 6], entry({ cda: 0.25 }));
		await storage.saveParameters(FILE, DEFAULT_PARAMETERS, "ride.fit");

		expect(await storage.loadAirSpeedCalibration(FILE, [4, 5, 6])).toEqual({
			ride: 7.7,
			override: 5,
		});
		expect((await storage.loadLapSettings(FILE, [4, 5, 6]))?.cda).toBe(0.25);
	});

	it("a lap save no longer stores a calibration on its entry", async () => {
		await storage.saveLapSettings(FILE, [1], entry({ airSpeedCalibration: 9 }));
		const stored = await storage.loadLapSettings(FILE, [1]);
		expect(stored && "airSpeedCalibration" in stored).toBe(false);
		expect(await storage.loadAirSpeedCalibration(FILE, [1])).toEqual({
			ride: undefined,
			override: undefined,
		});
	});

	describe("a record saved before the change (D2)", () => {
		beforeEach(async () => {
			const record = await storage.getStoredRecord(FILE);
			await storage.importStoredRecord({
				...record!,
				lapSettings: {
					"1-2-3": entry({ airSpeedCalibration: 0 }),
					"6": entry({ airSpeedCalibration: 7.7 }),
					"7-8-9": entry({ airSpeedCalibration: 7.7 }),
					"4-5-6": entry({ airSpeedCalibration: 5 }),
				},
			});
		});

		it("reads as a ride value plus the one deliberate-looking override", async () => {
			expect(await storage.loadAirSpeedCalibration(FILE, [1, 2, 3])).toEqual({
				ride: 7.7,
				override: undefined,
			});
			expect(await storage.loadAirSpeedCalibration(FILE, [4, 5, 6])).toEqual({
				ride: 7.7,
				override: 5,
			});
		});

		it("keeps its migration when a save replaces a legacy entry first", async () => {
			// Moving CdA on laps 4-6 replaces that entry. Its legacy +5.0 must
			// still become the override rather than vanish with the old entry.
			await storage.saveLapSettings(FILE, [4, 5, 6], entry({ cda: 0.25 }));
			expect(await storage.loadAirSpeedCalibration(FILE, [4, 5, 6])).toEqual({
				ride: 7.7,
				override: 5,
			});
			const record = await storage.getStoredRecord(FILE);
			expect(
				Object.values(record!.lapSettings).some(
					(s) => "airSpeedCalibration" in s,
				),
			).toBe(false);
		});

		it("a later ride calibration reaches the selections that followed", async () => {
			await storage.saveRideAirSpeedCalibration(FILE, 8);
			expect((await storage.loadAirSpeedCalibration(FILE, [6])).ride).toBe(8);
			expect(await storage.loadAirSpeedCalibration(FILE, [4, 5, 6])).toEqual({
				ride: 8,
				override: 5,
			});
		});
	});
});
