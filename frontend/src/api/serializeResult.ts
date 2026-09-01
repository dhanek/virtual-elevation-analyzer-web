/**
 * `ModeUpdateOutcome` + the run's `AppState` → the JSON-safe `RunResult`
 * (Convergence plan, C8).
 *
 * TWO JSON TRAPS, NOT ONE. A `Float64Array` stringifies to an index-keyed
 * object (`Array.from` fixes it), and — the silent one — `NaN`/`±Infinity`
 * stringify to `null`: the constant-wind series is deliberately NaN-filled,
 * and any non-finite value reaching an output array becomes an
 * indistinguishable null. So every emitted number goes through one helper
 * that maps non-finite → null AND COUNTS what it mapped into `warnings` — a
 * 400-ride batch must never grow a column that means two things silently.
 *
 * THE CSV ROW comes from `buildSaveResultData` → `toStoredVEResult` →
 * `RESULT_COLUMNS` — the app's own Store Result / Export CSV chain (C5), so
 * the batch CSV and the app's export are the same table by construction.
 * Values are UNESCAPED: quoting is the CSV writer's job (`toCsvCell`), and
 * `quoteAlways` names the columns the app always quotes (Notes).
 */
import type { ModeUpdateOutcome } from "../shell/analysis/updateModeVEPlots";
import { buildSaveResultData } from "../shell/analysis/buildSaveResultData";
import type { AppState, WindSource } from "../state/AppState";
import {
	toStoredVEResult,
	virtualDistanceCsvCells,
} from "../utils/ResultsStorage";
import { RESULT_COLUMNS } from "../utils/resultColumns";
import {
	RUN_SCHEMA_VERSION,
	type RunConfig,
	type RunResult,
	type RunSegmentResult,
} from "./schema";

function toJsonNumber(
	value: number,
	label: string,
	warnings: Map<string, number>,
): number | null {
	if (Number.isFinite(value)) {
		return value;
	}
	warnings.set(label, (warnings.get(label) ?? 0) + 1);
	return null;
}

function toJsonNumbers(
	values: ArrayLike<number>,
	label: string,
	warnings: Map<string, number>,
): Array<number | null> {
	const out = new Array<number | null>(values.length);
	for (let i = 0; i < values.length; i++) {
		out[i] = toJsonNumber(values[i], label, warnings);
	}
	return out;
}

export interface SerializeRunResultInput {
	config: RunConfig;
	appState: AppState;
	outcome: ModeUpdateOutcome;
	windSource: WindSource;
	selectedItems: number[];
	recordedTrim: { start: number; end: number };
	fileName: string;
	recordCount: number;
	wallClockMs: number;
}

export function serializeRunResult(input: SerializeRunResultInput): RunResult {
	const { config, appState, outcome } = input;
	const warnings = new Map<string, number>();
	const output = config.output ?? {};

	const segments: RunSegmentResult[] = outcome.profiles.map((profile) => ({
		key: profile.segment.key,
		label: profile.segment.label,
		itemNumber: profile.segment.itemNumber ?? null,
		range: {
			startIdx: profile.segment.range.startIdx,
			endIdx: profile.segment.range.endIdx,
		},
		trim: {
			start: profile.segment.trim?.start ?? 0,
			end: profile.segment.trim?.end ?? profile.virtualElevation.length - 1,
		},
		sampleCount: profile.virtualElevation.length,
		r2: profile.result.r2,
		rmse: profile.result.rmse,
		veGain: profile.result.ve_elevation_diff,
		actualGain: profile.result.actual_elevation_diff,
		compare: profile.resultCompare
			? {
					r2: profile.resultCompare.r2,
					rmse: profile.resultCompare.rmse,
					veGain: profile.resultCompare.ve_elevation_diff,
					actualGain: profile.resultCompare.actual_elevation_diff,
				}
			: null,
	}));

	const result: RunResult = {
		schemaVersion: RUN_SCHEMA_VERSION,
		ok: true,
		run: {
			fileName: input.fileName,
			mode: config.mode,
			cda: outcome.inputs.cda,
			crr: outcome.inputs.crr,
			crrApplied: outcome.inputs.appliedCrr,
			windSourceRequested: input.windSource,
			recordCount: input.recordCount,
			wallClockMs: Math.round(input.wallClockMs),
		},
		aggregate: outcome.aggregate,
		segments,
		coverage: {
			selected: input.selectedItems,
			covered: appState.currentCoveredItems ?? null,
		},
		virtualDistances: appState.currentVirtualDistances,
		warnings: [],
	};

	if (output.csvRow !== false) {
		const built = buildSaveResultData({
			appState,
			fileName: input.fileName,
			notes: output.notes ?? "",
			cda: outcome.inputs.cda,
			crr: outcome.inputs.crr,
			trimStart: input.recordedTrim.start,
			trimEnd: input.recordedTrim.end,
			now: new Date(),
		});
		if (built.ok) {
			const row = toStoredVEResult(built.data);
			const vd = virtualDistanceCsvCells(row.virtualDistances);
			result.csvRow = {
				headers: RESULT_COLUMNS.map((column) => column.header),
				values: RESULT_COLUMNS.map((column) => column.cell(row, vd)),
				quoteAlways: RESULT_COLUMNS.flatMap((column, index) =>
					column.alwaysQuote ? [index] : [],
				),
			};
		} else {
			result.warnings.push(`csvRow skipped: ${built.logMessage}`);
		}
	}

	if (output.includeSeries) {
		result.series = {
			bySegment: outcome.profiles.map((profile) => ({
				key: profile.segment.key,
				indices: profile.indices,
				distancesKm: profile.distancesKm,
				virtualElevation: toJsonNumbers(
					profile.virtualElevation,
					"virtual_elevation",
					warnings,
				),
				virtualElevationCompare: profile.virtualElevationCompare
					? toJsonNumbers(
							profile.virtualElevationCompare,
							"virtual_elevation_compare",
							warnings,
						)
					: null,
				actualElevation: toJsonNumbers(
					profile.actualElevation,
					"actual_elevation",
					warnings,
				),
			})),
		};
	}

	for (const [label, count] of warnings) {
		result.warnings.push(
			`${label}: ${count} non-finite sample${count === 1 ? "" : "s"} emitted as null`,
		);
	}

	return result;
}
