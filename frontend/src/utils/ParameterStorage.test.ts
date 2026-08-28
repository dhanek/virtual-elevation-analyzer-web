import { describe, expect, test } from "vitest";
import type { AnalysisParameters } from "../components/AnalysisParameters";
import { normalizeLoadedParameters } from "./ParameterStorage";

/**
 * A record as it was persisted before the wind height transfer existed: every
 * pre-feature field present, neither of the two new ones. Built without the
 * `wind_height_factor` key at all rather than setting it to undefined, because
 * that is what an actual IndexedDB record looks like.
 */
function legacyRecord(
	overrides: Partial<AnalysisParameters> = {},
): AnalysisParameters {
	return {
		system_mass: 82,
		rho: 1.19,
		eta: 0.97,
		cda: null,
		crr: null,
		cda_min: 0.15,
		cda_max: 0.5,
		crr_min: 0.002,
		crr_max: 0.015,
		wind_speed: 3.5,
		wind_direction: 220,
		wind_speed_unit: "m/s",
		air_speed_offset: 2,
		velodrome: false,
		auto_calculate_rho: true,
		crr_temp_correction: true,
		...overrides,
	};
}

/**
 * The exact parameters shape the three inline default-entry literals in
 * ParameterStorage now produce (saveLapSettings / saveGpsMarkerSettings /
 * saveOutAndBackMarkerSettings). Kept verbatim so this file fails if a future
 * edit drops the two wind fields from them.
 */
function freshlyCreatedRecord(): AnalysisParameters {
	return {
		system_mass: 75,
		rho: 1.225,
		eta: 0.97,
		cda: null,
		crr: null,
		cda_min: 0.15,
		cda_max: 0.5,
		crr_min: 0.002,
		crr_max: 0.015,
		wind_speed: null,
		wind_direction: null,
		wind_speed_unit: "m/s",
		air_speed_offset: 2,
		velodrome: false,
		auto_calculate_rho: false,
		wind_height_factor: 0.5,
		wind_entry: "manual",
	};
}

/**
 * WR-03 widened normalizeLoadedParameters to return null for a partial record.
 * These tests all pass a well-formed record, so a null here is a real failure,
 * not a case to type-guard past — this asserts that rather than suppressing it.
 */
function normalizeOrFail(
	stored: AnalysisParameters | null | undefined,
): AnalysisParameters {
	const normalized = normalizeLoadedParameters(stored);
	if (normalized === null) {
		throw new Error("expected a normalised record, got null");
	}
	return normalized;
}

describe("normalizeLoadedParameters (D-07)", () => {
	test("a pre-feature record loads at 1.0 labelled 'unknown'", () => {
		const normalized = normalizeOrFail(legacyRecord());

		expect(normalized.wind_height_factor).toBe(1.0);
		expect(normalized.wind_entry).toBe("unknown");
		// Branding it manual would let a later auto-rho fill count as a first
		// fill and re-seed 0.5 onto an analysis already read (D-06 amendment).
		expect(normalized.wind_entry).not.toBe("manual");
	});

	test("an existing provenance survives the factor normalisation", () => {
		const normalized = normalizeOrFail(
			legacyRecord({ wind_entry: "weather" }),
		);

		expect(normalized.wind_height_factor).toBe(1.0);
		expect(normalized.wind_entry).toBe("weather");
	});

	test("a record carrying the factor is returned untouched, by identity", () => {
		const stored = legacyRecord({
			wind_height_factor: 0.5,
			wind_entry: "weather",
		});

		const normalized = normalizeOrFail(stored);

		expect(normalized).toBe(stored);
		expect(normalized.wind_height_factor).toBe(0.5);
	});

	test("a stored factor of 0 is left alone (=== undefined, not falsiness)", () => {
		const stored = legacyRecord({ wind_height_factor: 0, wind_entry: "manual" });

		const normalized = normalizeOrFail(stored);

		// A ?? or || fallback on the value would rewrite this to 1.0 and hide
		// the corrupt value from resolveWindHeightFactor's guards.
		expect(normalized).toBe(stored);
		expect(normalized.wind_height_factor).toBe(0);
	});

	test("every other stored field survives normalisation", () => {
		const normalized = normalizeOrFail(legacyRecord());

		expect(normalized.system_mass).toBe(82);
		expect(normalized.rho).toBe(1.19);
		expect(normalized.crr_temp_correction).toBe(true);
		expect(normalized.wind_speed).toBe(3.5);
		expect(normalized.auto_calculate_rho).toBe(true);
	});

	test("a newly created record is not mistaken for a legacy one", () => {
		const normalized = normalizeOrFail(freshlyCreatedRecord());

		expect(normalized.wind_height_factor).toBe(0.5);
		expect(normalized.wind_entry).toBe("manual");
	});
});

/**
 * WR-03: `stored` is untrusted persisted data. A record lacking `parameters`
 * used to throw a TypeError inside the IndexedDB onsuccess handler, where the
 * enclosing Promise executor has already returned — so loadParameters never
 * settled and the file-load path hung silently.
 */
describe("normalizeLoadedParameters tolerates partial records (WR-03)", () => {
	test("undefined returns null instead of throwing", () => {
		expect(() => normalizeLoadedParameters(undefined)).not.toThrow();
		expect(normalizeLoadedParameters(undefined)).toBeNull();
	});

	test("null returns null instead of throwing", () => {
		expect(normalizeLoadedParameters(null)).toBeNull();
	});

	test("a non-object returns null instead of throwing", () => {
		expect(
			normalizeLoadedParameters("corrupt" as unknown as AnalysisParameters),
		).toBeNull();
	});
});
