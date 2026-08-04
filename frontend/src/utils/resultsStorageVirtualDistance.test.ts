/**
 * Change-list entry (h): the exported CSV and the stored record carry the
 * per-segment virtual distances.
 *
 * Two things are guarded here, and the second matters more than the first.
 *
 * 1. The columns exist and hold one value per segment, in analysis order.
 * 2. **A record written before entry (h) still loads and still exports.** The
 *    new fields are additive and optional; nothing about the IndexedDB schema
 *    version or the composite key `[fileName, lapKey, notes]` changed, so no
 *    migration runs and no existing row is rewritten. The failure mode a schema
 *    change has here is not a thrown error on upgrade — it is
 *    `generateCSVFromResults` reading `.length` or `.map` off an absent field
 *    and taking the export down with every old row in it. The old-record case
 *    below is what stops that.
 */
import { describe, expect, it } from "vitest";
import {
	CSV_HEADERS,
	generateCSVFromResults,
	ResultsStorage,
	virtualDistanceCsvCells,
	type SaveResultData,
	type StoredVEResult,
} from "./ResultsStorage";

/** A record with every pre-(h) field populated and nothing else. */
function legacyRecord(overrides: Partial<StoredVEResult> = {}): StoredVEResult {
	return {
		fileName: "ride.fit",
		lapKey: "2-3",
		trimStart: 0,
		trimEnd: 100,
		cda: 0.25,
		crr: 0.004,
		windSource: "fit",
		windSpeed: "",
		windDirection: "",
		systemMass: 80,
		rho: 1.225,
		eta: 0.97,
		r2: 0.98,
		rmse: 1.23,
		veGain: 4,
		actualGain: 5,
		avgPower: 250,
		avgSpeed: 36,
		avgTemperature: 18,
		notes: "test",
		recordingDate: "2026-08-04",
		timestamp: "2026-08-04T10:00:00.000Z",
		...overrides,
	};
}

function headerIndex(name: string): number {
	const index = CSV_HEADERS.indexOf(name);
	expect(index).toBeGreaterThanOrEqual(0);
	return index;
}

function cellsOf(csv: string): string[] {
	const lines = csv.trim().split("\n");
	expect(lines).toHaveLength(2);
	return lines[1].split(",");
}

describe("the CSV carries per-segment virtual distances", () => {
	it("writes one value per lap, aligned with the segment names", () => {
		const csv = generateCSVFromResults([
			legacyRecord({
				virtualDistances: [
					{ label: "Lap 2", airKm: 0.108, groundKm: 0.09, differencePercent: 20 },
					{ label: "Lap 3", airKm: 0.126, groundKm: 0.09, differencePercent: 40 },
				],
			}),
		]);

		const cells = cellsOf(csv);
		expect(cells[headerIndex("VDSegments")]).toBe("Lap 2;Lap 3");
		expect(cells[headerIndex("VDAirKm")]).toBe("0.108;0.126");
		expect(cells[headerIndex("VDGroundKm")]).toBe("0.090;0.090");
		expect(cells[headerIndex("VDDiffPercent")]).toBe("20.00;40.00");
	});

	it("does not flatten N laps into one number", () => {
		const [, air] = virtualDistanceCsvCells([
			{ label: "Lap 2", airKm: 0.108, groundKm: 0.09, differencePercent: 20 },
			{ label: "Lap 3", airKm: 0.126, groundKm: 0.09, differencePercent: 40 },
		]);

		// The sum (0.234) and the concatenated integral (8.648 over this
		// fixture, see segmentVirtualDistance.test.ts) are both absent: the
		// cell is the two laps, separately.
		expect(air).toBe("0.108;0.126");
		expect(air).not.toContain("0.234");
		expect(air.split(";")).toHaveLength(2);
	});

	it("leaves a single-segment analysis in its existing shape", () => {
		const cells = cellsOf(
			generateCSVFromResults([
				legacyRecord({
					lapKey: "2",
					virtualDistances: [
						{ label: "Lap 2", airKm: 2.476, groundKm: 2.702, differencePercent: -8.36 },
					],
				}),
			]),
		);

		// No segment name, and a bare number in each value column — exactly
		// what single-lap Standard shows on screen.
		expect(cells[headerIndex("VDSegments")]).toBe("");
		expect(cells[headerIndex("VDAirKm")]).toBe("2.476");
		expect(cells[headerIndex("VDGroundKm")]).toBe("2.702");
		expect(cells[headerIndex("VDDiffPercent")]).toBe("-8.36");
	});
});

describe("records stored before entry (h) still load and export", () => {
	it("exports an old record rather than throwing on its missing field", () => {
		const old = legacyRecord();
		expect(old.virtualDistances).toBeUndefined();

		const csv = generateCSVFromResults([old]);
		const cells = cellsOf(csv);

		// Every pre-(h) value survives untouched...
		expect(cells[headerIndex("R2")]).toBe("0.9800");
		expect(cells[headerIndex("ActualGain")]).toBe("5.00");
		expect(cells[headerIndex("AvgPower")]).toBe("250.0");
		// ...and the four new columns are simply empty.
		expect(cells[headerIndex("VDSegments")]).toBe("");
		expect(cells[headerIndex("VDAirKm")]).toBe("");
		expect(cells[headerIndex("VDGroundKm")]).toBe("");
		expect(cells[headerIndex("VDDiffPercent")]).toBe("");
		// The row still lines up with the header, so an old row does not shift
		// every later column by four.
		expect(cells).toHaveLength(CSV_HEADERS.length);
	});

	it("exports old and new records side by side in one file", () => {
		const csv = generateCSVFromResults([
			legacyRecord({ lapKey: "1", recordingDate: "2026-08-03" }),
			legacyRecord({
				lapKey: "2-3",
				virtualDistances: [
					{ label: "Lap 2", airKm: 0.108, groundKm: 0.09, differencePercent: 20 },
					{ label: "Lap 3", airKm: 0.126, groundKm: 0.09, differencePercent: 40 },
				],
			}),
		]);

		const rows = csv.trim().split("\n");
		expect(rows).toHaveLength(3);
		for (const row of rows.slice(1)) {
			expect(row.split(",")).toHaveLength(CSV_HEADERS.length);
		}
	});

	it("carries an absent field through the pre-v5 migration unchanged", () => {
		const storage = new ResultsStorage();
		const captured: Record<string, unknown>[] = [];
		// The migration path rebuilds every record field by field; a required
		// new field would turn an old row into a malformed one.
		(storage as unknown as { db: unknown }).db = fakeDb(captured);

		return (
			storage as unknown as {
				migrateData(rows: unknown[]): Promise<void>;
			}
		)
			.migrateData([{ fileName: "old.fit", lapKey: "1", notes: "" }])
			.then(() => {
				expect(captured).toHaveLength(1);
				expect(captured[0].fileName).toBe("old.fit");
				expect(captured[0].virtualDistances).toBeUndefined();
			});
	});
});

describe("Store Result persists what was on screen", () => {
	it("writes the per-segment virtual distances into the stored record", async () => {
		const storage = new ResultsStorage();
		const captured: Record<string, unknown>[] = [];
		(storage as unknown as { db: unknown }).db = fakeDb(captured);

		await storage.saveResult({
			fileName: "ride.fit",
			laps: [2, 3],
			trimStart: 0,
			trimEnd: 100,
			cda: 0.25,
			crr: 0.004,
			windSource: "fit",
			parameters: { system_mass: 80, rho: 1.225, eta: 0.97 } as never,
			result: {
				virtual_elevation: new Float64Array(0),
				r2: 0.98,
				rmse: 1.23,
				ve_elevation_diff: 4,
				actual_elevation_diff: 5,
				// The combined multi-lap shape's zeros: what the export used to
				// have had to fall back on.
				virtual_distance_air: 0,
				virtual_distance_ground: 0,
				vd_difference_percent: 0,
			},
			virtualDistances: [
				{ label: "Lap 2", airKm: 0.108, groundKm: 0.09, differencePercent: 20 },
				{ label: "Lap 3", airKm: 0.126, groundKm: 0.09, differencePercent: 40 },
			],
			timestamp: new Date("2026-08-04T10:00:00.000Z"),
			recordingDate: "2026-08-04",
			avgPower: 250,
			avgSpeed: 36,
			avgTemperature: 18,
			notes: "test",
		} satisfies SaveResultData);

		expect(captured).toHaveLength(1);
		expect(captured[0].lapKey).toBe("2-3");
		expect(captured[0].virtualDistances).toEqual([
			{ label: "Lap 2", airKm: 0.108, groundKm: 0.09, differencePercent: 20 },
			{ label: "Lap 3", airKm: 0.126, groundKm: 0.09, differencePercent: 40 },
		]);
	});
});

/**
 * The smallest IndexedDB stand-in `saveResult` and `migrateData` need: capture
 * whatever is written and complete the transaction. The real store is not
 * mocked away — the code under test is the real method, keying and all.
 */
function fakeDb(captured: Record<string, unknown>[]) {
	return {
		transaction() {
			const objectStore = {
				put(record: Record<string, unknown>) {
					captured.push(record);
					const request: { onsuccess?: () => void; onerror?: () => void } = {};
					queueMicrotask(() => request.onsuccess?.());
					return request;
				},
				add(record: Record<string, unknown>) {
					return objectStore.put(record);
				},
			};
			const transaction: {
				objectStore(): typeof objectStore;
				oncomplete?: () => void;
				onerror?: () => void;
			} = {
				objectStore: () => objectStore,
			};
			queueMicrotask(() => transaction.oncomplete?.());
			return transaction;
		},
	};
}
