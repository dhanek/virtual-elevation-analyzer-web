/**
 * The portable form of one file's analysis settings — the versioned JSON the
 * "Export Settings" button writes and the drop zone reads back, alone or
 * zipped next to its FIT file.
 *
 * The payload is deliberately the `StoredParameters` record ParameterStorage
 * already persists (parameters + per-lap trim/CdA/Crr + GPS gate settings),
 * not a new shape: import is then "write the record under the activity's
 * hash and run the normal restore path", so a bundle can never restore
 * something the app's own reload path could not. Pure module — no DOM, no
 * IndexedDB — so the parse/build round-trip is node-testable.
 *
 * Validation is hand-written, matching the repo's zero-dependency rule and
 * `normalizeLoadedParameters`' precedent: check the envelope's structure,
 * then hand the parameters to the SAME normaliser the IndexedDB read path
 * uses (D-07 there: a legacy record without `wind_height_factor` must load
 * at the legacy factor, and that must hold for imported files too).
 */
import type { AnalysisParameters } from "../components/AnalysisParameters";
import {
	normalizeLoadedParameters,
	type GpsMarkerSettings,
	type LapSettings,
	type OutAndBackMarkerSettings,
	type StoredParameters,
} from "../utils/ParameterStorage";
import type { ZipEntry } from "../utils/zip";

export const SETTINGS_FORMAT = "virtual-elevation-analyzer-settings";

/**
 * The Section-3 dropdown's values, verbatim — `section3Orchestration`'s
 * `GpsAnalysisMode` union, restated here because this module must stay
 * DOM-free and shell-free. `restoreSection3Selection` accepts this type, so
 * a drift between the two lists fails to compile at that call site.
 */
export const GPS_ANALYSIS_MODES = [
	"None",
	"GPS based lap splitting",
	"GPS based out and back",
	"GPS gate one way",
] as const;
export type Section3AnalysisMode = (typeof GPS_ANALYSIS_MODES)[number];

/**
 * What Section 3 shows: the map-analysis type and the FIT laps ticked. The
 * gate positions deliberately do NOT live here — they are already in the
 * marker-settings maps below, keyed by lap selection, which is the shape the
 * detection panels restore from.
 */
export interface Section3Selection {
	gpsAnalysisMode: Section3AnalysisMode;
	selectedLaps: number[];
}
export const SETTINGS_SCHEMA_VERSION = 1;

export interface SettingsEnvelope {
	format: typeof SETTINGS_FORMAT;
	schemaVersion: number;
	exportedAt: string;
	/** Name and hash of the activity the settings were exported from. */
	activityFileName: string | null;
	activityFileHash: string | null;
	/** Null on exports predating Section-3 capture. */
	section3: Section3Selection | null;
	parameters: AnalysisParameters;
	lapSettings: Record<string, LapSettings>;
	gpsMarkerSettings: Record<string, GpsMarkerSettings>;
	outAndBackMarkerSettings: Record<string, OutAndBackMarkerSettings>;
}

export function buildSettingsEnvelope(input: {
	/** The stored record, when one exists — lap/gate settings come from it. */
	record: StoredParameters | null;
	/**
	 * The LIVE form parameters, which win over `record.parameters`: Section-2
	 * edits are only persisted on analyze, and an export must capture what
	 * the form shows, not what the last analyze stored.
	 */
	parameters: AnalysisParameters;
	activityFileName: string | null;
	activityFileHash: string | null;
	section3: Section3Selection | null;
	now?: Date;
}): SettingsEnvelope {
	return {
		format: SETTINGS_FORMAT,
		schemaVersion: SETTINGS_SCHEMA_VERSION,
		exportedAt: (input.now ?? new Date()).toISOString(),
		activityFileName: input.activityFileName,
		activityFileHash: input.activityFileHash,
		section3: input.section3,
		parameters: input.parameters,
		lapSettings: input.record?.lapSettings ?? {},
		gpsMarkerSettings: input.record?.gpsMarkerSettings ?? {},
		outAndBackMarkerSettings: input.record?.outAndBackMarkerSettings ?? {},
	};
}

export type ParsedSettingsEnvelope =
	| { ok: true; envelope: SettingsEnvelope }
	| { ok: false; error: string };

/** Parse and validate exported settings JSON. Never throws. */
export function parseSettingsEnvelope(text: string): ParsedSettingsEnvelope {
	let raw: unknown;
	try {
		raw = JSON.parse(text);
	} catch {
		return { ok: false, error: "The file is not valid JSON." };
	}
	if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
		return { ok: false, error: "The file is not a settings export." };
	}
	const candidate = raw as Record<string, unknown>;
	if (candidate.format !== SETTINGS_FORMAT) {
		return {
			ok: false,
			error:
				"The file is not a Virtual Elevation Analyzer settings export.",
		};
	}
	if (typeof candidate.schemaVersion !== "number") {
		return { ok: false, error: "The settings export names no version." };
	}
	if (candidate.schemaVersion > SETTINGS_SCHEMA_VERSION) {
		return {
			ok: false,
			error:
				`This settings file is version ${candidate.schemaVersion}, newer ` +
				"than this app understands — update the app and try again.",
		};
	}
	const parameters = normalizeLoadedParameters(
		candidate.parameters as AnalysisParameters | null | undefined,
	);
	if (!parameters) {
		return { ok: false, error: "The settings export carries no parameters." };
	}

	const section3 = parseSection3(candidate.section3);

	const record = (value: unknown): Record<string, never> =>
		typeof value === "object" && value !== null && !Array.isArray(value)
			? (value as Record<string, never>)
			: {};

	return {
		ok: true,
		envelope: {
			format: SETTINGS_FORMAT,
			schemaVersion: candidate.schemaVersion,
			exportedAt:
				typeof candidate.exportedAt === "string" ? candidate.exportedAt : "",
			activityFileName:
				typeof candidate.activityFileName === "string"
					? candidate.activityFileName
					: null,
			activityFileHash:
				typeof candidate.activityFileHash === "string"
					? candidate.activityFileHash
					: null,
			section3,
			parameters,
			lapSettings: record(candidate.lapSettings),
			gpsMarkerSettings: record(candidate.gpsMarkerSettings),
			outAndBackMarkerSettings: record(candidate.outAndBackMarkerSettings),
		},
	};
}

/**
 * Salvage what is valid rather than refuse the file: a hand-edited mode
 * falls back to "None" and non-lap-number noise is dropped, because the
 * envelope's parameters are still worth importing either way.
 *
 * Exported because it is also the read-path validator for the `section3`
 * field ParameterStorage persists — stored data is as untrusted as a
 * hand-edited JSON, and both must degrade the same way.
 */
export function parseSection3(value: unknown): Section3Selection | null {
	if (typeof value !== "object" || value === null || Array.isArray(value)) {
		return null;
	}
	const candidate = value as Record<string, unknown>;
	const mode = (GPS_ANALYSIS_MODES as readonly unknown[]).includes(
		candidate.gpsAnalysisMode,
	)
		? (candidate.gpsAnalysisMode as Section3AnalysisMode)
		: "None";
	const selectedLaps = Array.isArray(candidate.selectedLaps)
		? candidate.selectedLaps.filter(
				(lap): lap is number => Number.isInteger(lap) && (lap as number) >= 1,
			)
		: [];
	return { gpsAnalysisMode: mode, selectedLaps };
}

/**
 * The record an imported envelope becomes, under the TARGET file's hash —
 * which may differ from the exporting file's (the point of a JSON import is
 * applying settings to whatever ride is loaded).
 */
export function envelopeToStoredRecord(
	envelope: SettingsEnvelope,
	targetFileHash: string,
	targetFileName: string | undefined,
	now: number = Date.now(),
): StoredParameters {
	return {
		fileHash: targetFileHash,
		parameters: envelope.parameters,
		lapSettings: envelope.lapSettings,
		gpsMarkerSettings: envelope.gpsMarkerSettings,
		outAndBackMarkerSettings: envelope.outAndBackMarkerSettings,
		section3: envelope.section3,
		lastUsed: now,
		fileName: targetFileName,
	};
}

export interface BundleEntrySplit {
	activity: ZipEntry | null;
	settings: ZipEntry | null;
}

/**
 * Pick the activity (.fit/.csv) and settings (.json) out of a zip listing.
 * macOS resource-fork noise (`__MACOSX/`, `.DS_Store`) is ignored because
 * user-made zips reliably contain it. First match wins per slot.
 */
export function splitBundleEntries(entries: readonly ZipEntry[]): BundleEntrySplit {
	let activity: ZipEntry | null = null;
	let settings: ZipEntry | null = null;
	for (const entry of entries) {
		const name = entry.name.toLowerCase();
		if (name.startsWith("__macosx/") || name.endsWith(".ds_store")) continue;
		if (!activity && (name.endsWith(".fit") || name.endsWith(".csv"))) {
			activity = entry;
		} else if (!settings && name.endsWith(".json")) {
			settings = entry;
		}
	}
	return { activity, settings };
}

/** "rides/2026 tempo.fit" -> "2026 tempo.fit" — zip entries may carry paths. */
export function entryBaseName(name: string): string {
	const parts = name.split("/");
	return parts[parts.length - 1];
}
