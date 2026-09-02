/**
 * THE CSV IS PINNED BYTE FOR BYTE, so the column table underneath it can be
 * refactored without anyone having to trust that it was refactored correctly.
 *
 * `CSV_HEADERS` and the value list inside `generateCSVFromResults` used to be
 * two parallel arrays kept aligned by hand: 32 headers in one place, 32
 * expressions in another, with nothing but position relating them. Adding a
 * field in one and not the other shifts every cell after it, and every consumer
 * reads the wrong column with no error anywhere. That is the same class of
 * defect as WR-02's Laps column and WR-4's stored result -- two writers, one
 * meaning -- so the two lists are now ONE table and both the CSV and the
 * on-screen results view render from it.
 *
 * The literals below were captured from the implementation BEFORE that
 * extraction. They are a characterization pin, not a specification: if the
 * refactor were to change so much as a decimal place or an escaped quote, these
 * fail. Their own value was confirmed by mutating a column and watching them
 * fail, which is the only thing that distinguishes a pin from a tautology.
 *
 * RE-BASELINED ONCE, DELIBERATELY, on 2026-08-31: the maintainer reordered
 * `RESULT_COLUMNS` so the table and the CSV read most-important-first. All four
 * tests here failed on that change, which is exactly what a pin is for — the
 * reorder could not have reached the export unnoticed. The literals below are
 * the NEW order. The cell FORMATS are unchanged from the original capture, and
 * that is the part still being pinned: same values, same precision, same
 * escaping, different columns.
 */
import { describe, expect, it } from "vitest";
import {
	CSV_HEADERS,
	generateCSVFromResults,
	type StoredVEResult,
} from "./ResultsStorage";

/** Every optional field populated, plus notes needing CSV escaping. */
function fullRecord(): StoredVEResult {
	return {
		fileName: "ride.fit",
		lapKey: "2-3",
		lapsCoveredKey: "2",
		trimStart: 0,
		trimEnd: 100,
		cda: 0.25,
		crr: 0.004,
		crrApplied: 0.0043,
		ambientTemp: 18.5,
		tireSensitivity: "typical",
		airSpeedCalibration: 5,
		windSource: "fit",
		windSpeed: 3.5,
		windDirection: 220,
		windHeightFactor: 0.72,
		systemMass: 80,
		rho: 1.225,
		eta: 0.97,
		r2: 0.98,
		rmse: 1.23,
		veGain: 4,
		actualGain: 5,
		virtualDistances: [
			{ label: "Lap 2", airKm: 0.108, groundKm: 0.09, differencePercent: 20 },
			{ label: "Lap 3", airKm: 0.126, groundKm: 0.09, differencePercent: 40 },
		],
		avgPower: 250,
		avgSpeed: 36,
		avgTemperature: 18,
		notes: 'has "quotes", and commas',
		recordingDate: "2026-08-04",
		timestamp: "2026-08-04T10:00:00.000Z",
	} as unknown as StoredVEResult;
}

/**
 * A row written before the optional columns existed. It must still export, with
 * empty cells rather than fabricated values -- the property
 * `resultsStorageVirtualDistance.test.ts` already guards for the VD group, held
 * here for every optional column at once.
 */
function legacyRecord(): StoredVEResult {
	return {
		fileName: "old.fit",
		lapKey: "1",
		trimStart: 0,
		trimEnd: 10,
		cda: 0.3,
		crr: 0.005,
		windSource: "constant",
		windSpeed: "",
		windDirection: "",
		systemMass: 75,
		rho: 1.2,
		eta: 0.97,
		r2: 0.9,
		rmse: 2,
		veGain: 1,
		actualGain: 2,
		avgPower: 200,
		avgSpeed: 30,
		notes: "",
		recordingDate: "2026-01-01",
		timestamp: "2026-01-01T00:00:00.000Z",
	} as unknown as StoredVEResult;
}

const HEADER_LINE =
	"RecordingDate,FileName,Notes,CdA,Crr,AvgPower,AvgSpeed,RMSE,R2,AvgTemp," +
	"Timestamp,Laps,LapsCovered,VEGain,ActualGain,WindSource,WindSpeed,WindDir," +
	"WindHeightPct,AirSpeedCal,CrrApplied,AmbientTemp,TireSensitivity,SystemMass," +
	"Rho,Eta,TrimStart,TrimEnd,VDSegments,VDAirKm,VDGroundKm,VDDiffPercent";

const FULL_ROW =
	'2026-08-04,ride.fit,"has ""quotes"", and commas",0.250,0.0040,250.0,' +
	"36.00,1.23,0.9800,18.0,2026-08-04T10:00:00.000Z,2-3,2,4.00,5.00,fit," +
	"3.5,220,72,5.0,0.0043,18.5,typical,80,1.225,0.970,0,100,Lap 2;Lap 3," +
	"0.108;0.126,0.090;0.090,20.00;40.00";

const LEGACY_ROW =
	'2026-01-01,old.fit,"",0.300,0.0050,200.0,30.00,2.00,0.9000,,' +
	"2026-01-01T00:00:00.000Z,1,,1.00,2.00,constant,,,,,,,,75,1.200,0.970," +
	"0,10,,,,";

describe("the exported CSV", () => {
	it("writes the header line unchanged", () => {
		expect(CSV_HEADERS.join(",")).toBe(HEADER_LINE);
	});

	it("writes a fully populated record unchanged", () => {
		const csv = generateCSVFromResults([fullRecord()]);
		expect(csv).toBe(`${HEADER_LINE}\n${FULL_ROW}\n`);
	});

	it("writes a pre-optional-columns record unchanged, with empty cells", () => {
		const csv = generateCSVFromResults([legacyRecord()]);
		expect(csv).toBe(`${HEADER_LINE}\n${LEGACY_ROW}\n`);
	});

	/**
	 * A CSV line, split the way a reader does.
	 *
	 * Hand-rolled because the test needs to count cells including EMPTY TRAILING
	 * ones -- a legacy row ends `,,,,` -- and a `split(",")` that respects quotes
	 * is the only thing that gets that right. An earlier regex version silently
	 * dropped the final empty cell and reported 31 columns for a 32-column row.
	 */
	function splitCsvLine(line: string): string[] {
		const cells: string[] = [];
		let cell = "";
		let inQuotes = false;

		for (let i = 0; i < line.length; i++) {
			const character = line[i];
			if (inQuotes) {
				if (character !== '"') {
					cell += character;
				} else if (line[i + 1] === '"') {
					cell += '"';
					i++;
				} else {
					inQuotes = false;
				}
			} else if (character === '"') {
				inQuotes = true;
			} else if (character === ",") {
				cells.push(cell);
				cell = "";
			} else {
				cell += character;
			}
		}
		cells.push(cell);
		return cells;
	}

	/**
	 * Every header has a cell and every cell has a header. This is the invariant
	 * the two parallel arrays could violate silently, and the one the column
	 * table makes unrepresentable -- kept as a test anyway, because it is the
	 * property that matters rather than the shape that currently guarantees it.
	 */
	it("emits exactly one cell per header, for every record", () => {
		const csv = generateCSVFromResults([fullRecord(), legacyRecord()]);
		const lines = csv.trim().split("\n");

		expect(lines).toHaveLength(3);
		for (const line of lines) {
			expect(splitCsvLine(line)).toHaveLength(CSV_HEADERS.length);
		}
	});

	/**
	 * Escaping is REVERSIBLE. A note carrying both a comma and a quote is the
	 * case that breaks a naive writer, and the one most likely to appear -- notes
	 * are free text typed at store time.
	 */
	it("round-trips a note containing commas and quotes", () => {
		const csv = generateCSVFromResults([fullRecord()]);
		const cells = splitCsvLine(csv.trim().split("\n")[1]);

		expect(cells[CSV_HEADERS.indexOf("Notes")]).toBe(
			'has "quotes", and commas',
		);
	});

});
