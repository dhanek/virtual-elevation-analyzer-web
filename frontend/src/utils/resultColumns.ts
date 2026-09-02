/**
 * THE column table for a stored result — one definition, two renderers.
 *
 * `CSV_HEADERS` and the value list inside `generateCSVFromResults` used to be
 * two parallel arrays of 32 entries, related by nothing but position and kept
 * aligned by hand. Adding a field to one and not the other shifts every cell
 * after it, and every consumer then reads the wrong column with no error
 * anywhere — the same two-writers-one-meaning shape as WR-02's `Laps` column
 * and WR-4's stored result. The on-screen results view would have been a THIRD
 * such list.
 *
 * So the header and the cell live together here, and both the CSV export and
 * the results table render from this array. A new field is one entry, and it
 * reaches both surfaces or neither.
 *
 * `id` is the stable handle the results view uses to remember which columns the
 * user hid. It is deliberately NOT the header text: renaming a header is a
 * display change and must not silently un-hide a column, or hide a different
 * one.
 *
 * NO IMPORT FROM `ResultsStorage` BEYOND THE TYPE. That module imports this
 * one, so a value import back would be a runtime cycle. The four
 * virtual-distance cells are therefore handed in as `vd` — computed once per
 * row by the caller — rather than fetched here.
 */
import { factorToPercent } from "../analysis/WindHeightTransfer";
import type { StoredVEResult } from "./ResultsStorage";

/** `[VDSegments, VDAirKm, VDGroundKm, VDDiffPercent]`, already formatted. */
export type VirtualDistanceCells = readonly [string, string, string, string];

export interface ResultColumn {
	/** Stable identity, independent of the displayed header. */
	readonly id: string;
	readonly header: string;
	/** The value, UNESCAPED. CSV quoting belongs to the CSV writer. */
	readonly cell: (
		result: StoredVEResult,
		vd: VirtualDistanceCells,
	) => string;
	/**
	 * Emit this cell wrapped in quotes even when it contains nothing that needs
	 * escaping. Only `Notes` does, and only because it always has: a record with
	 * no notes has exported `""` rather than an empty cell since the column
	 * existed. Both parse identically, so this preserves bytes rather than
	 * meaning — and preserving bytes is what let this table be extracted under a
	 * characterization pin instead of a promise.
	 */
	readonly alwaysQuote?: boolean;
}

/** `undefined` reads as an empty cell, never as a fabricated value. */
const optional = (
	value: number | undefined,
	digits: number,
): string => (value === undefined ? "" : value.toFixed(digits));

/**
 * ORDER IS THE MAINTAINER'S, and it is the reading order for BOTH surfaces --
 * the on-screen table and the exported CSV -- because both render from this one
 * array. Reordering here is the whole payoff of merging the two lists.
 *
 * The first twelve were specified directly: what the ride WAS (date, file,
 * notes), what was fitted (CdA, Crr), what the rider actually did (power,
 * speed), how well it fitted (RMSE, R2), the conditions (temp), when it was
 * stored, and which laps.
 *
 * The rest are ordered by how much they change the reading of those twelve:
 *   - `LapsCovered` immediately after `Laps`, because it says which of them the
 *     numbers above actually describe;
 *   - the gains, which are the other half of the fit quality;
 *   - the wind model and its inputs, which change what the numbers MEAN more
 *     than any other group;
 *   - the Crr correction chain;
 *   - the setup constants, which rarely vary within a session;
 *   - the trim window;
 *   - the per-segment virtual distances last: four columns, each holding a
 *     ';'-separated list, useful to few readers and wide for all of them.
 *
 * CHANGING THIS ORDER CHANGES THE CSV. That is intended here, and it is a
 * breaking change for anything that reads the export positionally rather than
 * by header name.
 */
export const RESULT_COLUMNS: readonly ResultColumn[] = [
	{
		id: "recordingDate",
		header: "RecordingDate",
		cell: (r) => String(r.recordingDate),
	},
	{ id: "fileName", header: "FileName", cell: (r) => r.fileName },
	{ id: "notes", header: "Notes", cell: (r) => r.notes, alwaysQuote: true },
	{ id: "cda", header: "CdA", cell: (r) => r.cda.toFixed(3) },
	{ id: "crr", header: "Crr", cell: (r) => r.crr.toFixed(4) },
	{ id: "avgPower", header: "AvgPower", cell: (r) => r.avgPower.toFixed(1) },
	{ id: "avgSpeed", header: "AvgSpeed", cell: (r) => r.avgSpeed.toFixed(2) },
	{ id: "rmse", header: "RMSE", cell: (r) => r.rmse.toFixed(2) },
	{ id: "r2", header: "R2", cell: (r) => r.r2.toFixed(4) },
	// The RIDE's measured temperature. `AmbientTemp` further down is a different
	// quantity -- the value the Crr temperature correction was evaluated at --
	// and it sits with the rest of that chain rather than here.
	{
		id: "avgTemp",
		header: "AvgTemp",
		cell: (r) => optional(r.avgTemperature, 1),
	},
	{ id: "timestamp", header: "Timestamp", cell: (r) => String(r.timestamp) },
	// `Laps` is what was SELECTED; `LapsCovered` is which of them the numbers in
	// this row actually describe (WR-02). Empty in LapsCovered does NOT mean
	// "nothing was dropped" — it means UNKNOWN, i.e. a pre-WR-02 record or one
	// stored before any recompute ran. They stay adjacent for that reason.
	{ id: "laps", header: "Laps", cell: (r) => r.lapKey },
	{
		id: "lapsCovered",
		header: "LapsCovered",
		cell: (r) => r.lapsCoveredKey ?? "",
	},
	{ id: "veGain", header: "VEGain", cell: (r) => r.veGain.toFixed(2) },
	{
		id: "actualGain",
		header: "ActualGain",
		cell: (r) => r.actualGain.toFixed(2),
	},
	{ id: "windSource", header: "WindSource", cell: (r) => r.windSource },
	{ id: "windSpeed", header: "WindSpeed", cell: (r) => String(r.windSpeed) },
	{ id: "windDir", header: "WindDir", cell: (r) => String(r.windDirection) },
	// Stored as the 0-1 FACTOR, shown as a percent, matching the control (WR-02).
	// `windSpeed` beside it is the raw 10 m value; the wind that reached the
	// physics is `windSpeed * windHeightFactor`.
	//
	// The percent conversion is `factorToPercent`'s, not a second copy of it:
	// the rounding rule lives in `WindHeightTransfer` so the control's readout
	// and this cell can never disagree about what 0.725 is. That module imports
	// nothing, so the value import is cycle-free even though this file is
	// imported by `ResultsStorage`.
	{
		id: "windHeightPct",
		header: "WindHeightPct",
		cell: (r) =>
			r.windHeightFactor === undefined
				? ""
				: String(factorToPercent(r.windHeightFactor)),
	},
	{
		id: "airSpeedCal",
		header: "AirSpeedCal",
		cell: (r) => optional(r.airSpeedCalibration, 1),
	},
	{
		id: "crrApplied",
		header: "CrrApplied",
		cell: (r) => optional(r.crrApplied, 4),
	},
	{
		id: "ambientTemp",
		header: "AmbientTemp",
		cell: (r) => optional(r.ambientTemp, 1),
	},
	{
		id: "tireSensitivity",
		header: "TireSensitivity",
		cell: (r) => r.tireSensitivity ?? "",
	},
	{ id: "systemMass", header: "SystemMass", cell: (r) => String(r.systemMass) },
	{ id: "rho", header: "Rho", cell: (r) => r.rho.toFixed(3) },
	{ id: "eta", header: "Eta", cell: (r) => r.eta.toFixed(3) },
	{ id: "trimStart", header: "TrimStart", cell: (r) => String(r.trimStart) },
	{ id: "trimEnd", header: "TrimEnd", cell: (r) => String(r.trimEnd) },
	// Entry (h). One value per independently-integrated segment, ';'-separated in
	// analysis order, aligned position-for-position with VDSegments. No total is
	// invented for a multi-segment analysis.
	{ id: "vdSegments", header: "VDSegments", cell: (_r, vd) => vd[0] },
	{ id: "vdAirKm", header: "VDAirKm", cell: (_r, vd) => vd[1] },
	{ id: "vdGroundKm", header: "VDGroundKm", cell: (_r, vd) => vd[2] },
	{ id: "vdDiffPercent", header: "VDDiffPercent", cell: (_r, vd) => vd[3] },
];

/**
 * One cell, ready for a CSV row.
 *
 * Quoting is the WRITER'S job, not the column's, which is what makes the same
 * `cell` usable by a DOM table that must show `he said "go"` rather than
 * `"he said ""go"""`. It also closes a latent hole: only `Notes` was ever
 * escaped, so a FIT file whose NAME contained a comma shifted every column
 * after `FileName` in that row, silently.
 */
export function toCsvCell(column: ResultColumn, value: string): string {
	const needsQuotes =
		column.alwaysQuote ||
		value.includes(",") ||
		value.includes('"') ||
		value.includes("\n");
	return needsQuotes ? `"${value.replace(/"/g, '""')}"` : value;
}
