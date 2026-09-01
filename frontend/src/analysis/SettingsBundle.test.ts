import { describe, expect, it } from "vitest";
import { DEFAULT_PARAMETERS } from "../components/AnalysisParameters";
import { LEGACY_WIND_HEIGHT_FACTOR } from "./WindHeightTransfer";
import {
	buildSettingsEnvelope,
	entryBaseName,
	envelopeToStoredRecord,
	parseSettingsEnvelope,
	SETTINGS_SCHEMA_VERSION,
	splitBundleEntries,
} from "./SettingsBundle";
import type { StoredParameters } from "../utils/ParameterStorage";

const params = () => ({ ...DEFAULT_PARAMETERS, cda: 0.271, crr: 0.0043 });

const storedRecord = (): StoredParameters => ({
	fileHash: "abc_ride",
	parameters: params(),
	lapSettings: { "1-2": { trimStart: 10, trimEnd: 400, cda: 0.27, crr: 0.004 } },
	gpsMarkerSettings: { "1-2": { gateTimeOffset: 30 } },
	outAndBackMarkerSettings: {
		"3": { gateATimeOffset: 5, gateBTimeOffset: 250 },
	},
	lastUsed: 1_700_000_000_000,
	fileName: "ride.fit",
});

describe("buildSettingsEnvelope / parseSettingsEnvelope", () => {
	it("round-trips the whole stored record through JSON", () => {
		const envelope = buildSettingsEnvelope({
			record: storedRecord(),
			parameters: params(),
			activityFileName: "ride.fit",
			activityFileHash: "abc_ride",
		});
		const parsed = parseSettingsEnvelope(JSON.stringify(envelope));
		expect(parsed.ok).toBe(true);
		if (!parsed.ok) return;
		expect(parsed.envelope.parameters.cda).toBe(0.271);
		expect(parsed.envelope.lapSettings["1-2"].trimEnd).toBe(400);
		expect(parsed.envelope.gpsMarkerSettings["1-2"].gateTimeOffset).toBe(30);
		expect(parsed.envelope.outAndBackMarkerSettings["3"].gateBTimeOffset).toBe(250);
		expect(parsed.envelope.activityFileHash).toBe("abc_ride");
	});

	it("the live form parameters win over the stored record's", () => {
		const envelope = buildSettingsEnvelope({
			record: storedRecord(),
			parameters: { ...params(), cda: 0.999 },
			activityFileName: null,
			activityFileHash: null,
		});
		expect(envelope.parameters.cda).toBe(0.999);
	});

	it("refuses non-JSON, foreign JSON, and a newer schema, each in plain words", () => {
		expect(parseSettingsEnvelope("not json at {{{")).toMatchObject({
			ok: false,
			error: expect.stringContaining("not valid JSON"),
		});
		expect(parseSettingsEnvelope('{"some":"other file"}')).toMatchObject({
			ok: false,
			error: expect.stringContaining("not a Virtual Elevation Analyzer"),
		});
		const newer = buildSettingsEnvelope({
			record: null,
			parameters: params(),
			activityFileName: null,
			activityFileHash: null,
		});
		const bumped = { ...newer, schemaVersion: SETTINGS_SCHEMA_VERSION + 1 };
		expect(parseSettingsEnvelope(JSON.stringify(bumped))).toMatchObject({
			ok: false,
			error: expect.stringContaining("newer"),
		});
	});

	it("normalises legacy parameters exactly as the IndexedDB read path does", () => {
		const envelope = buildSettingsEnvelope({
			record: null,
			parameters: params(),
			activityFileName: null,
			activityFileHash: null,
		});
		const legacyParams = { ...params() } as Record<string, unknown>;
		delete legacyParams.wind_height_factor;
		const parsed = parseSettingsEnvelope(
			JSON.stringify({ ...envelope, parameters: legacyParams }),
		);
		expect(parsed.ok).toBe(true);
		if (!parsed.ok) return;
		expect(parsed.envelope.parameters.wind_height_factor).toBe(
			LEGACY_WIND_HEIGHT_FACTOR,
		);
	});

	it("tolerates absent settings maps, defaulting them empty", () => {
		const parsed = parseSettingsEnvelope(
			JSON.stringify({
				format: "virtual-elevation-analyzer-settings",
				schemaVersion: 1,
				parameters: params(),
			}),
		);
		expect(parsed.ok).toBe(true);
		if (!parsed.ok) return;
		expect(parsed.envelope.lapSettings).toEqual({});
		expect(parsed.envelope.outAndBackMarkerSettings).toEqual({});
	});
});

describe("envelopeToStoredRecord", () => {
	it("re-keys the record to the TARGET file, not the exporting one", () => {
		const envelope = buildSettingsEnvelope({
			record: storedRecord(),
			parameters: params(),
			activityFileName: "ride.fit",
			activityFileHash: "abc_ride",
		});
		const record = envelopeToStoredRecord(envelope, "other_hash", "other.fit", 42);
		expect(record.fileHash).toBe("other_hash");
		expect(record.fileName).toBe("other.fit");
		expect(record.lastUsed).toBe(42);
		expect(record.lapSettings["1-2"].cda).toBe(0.27);
	});
});

describe("splitBundleEntries", () => {
	const entry = (name: string) => ({ name, data: new Uint8Array(0) });

	it("finds the activity and settings, ignoring macOS zip noise", () => {
		const split = splitBundleEntries([
			entry("__MACOSX/._ride.fit"),
			entry("bundle/.DS_Store"),
			entry("bundle/ride.fit"),
			entry("bundle/ride.ve-settings.json"),
		]);
		expect(split.activity?.name).toBe("bundle/ride.fit");
		expect(split.settings?.name).toBe("bundle/ride.ve-settings.json");
	});

	it("reports what is missing as null", () => {
		expect(splitBundleEntries([entry("readme.txt")])).toEqual({
			activity: null,
			settings: null,
		});
	});
});

describe("entryBaseName", () => {
	it("strips zip directory prefixes", () => {
		expect(entryBaseName("rides/2026 tempo.fit")).toBe("2026 tempo.fit");
		expect(entryBaseName("ride.fit")).toBe("ride.fit");
	});
});
