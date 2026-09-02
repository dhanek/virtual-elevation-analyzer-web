import { describe, expect, test } from "vitest";
import { RUN_SCHEMA_VERSION } from "./schema";
import { validateRunConfig } from "./validateRunConfig";

const good = () => ({
	schemaVersion: RUN_SCHEMA_VERSION,
	mode: "standard",
	selection: { laps: [2, 5] },
	inputs: { cda: 0.28, crr: 0.005 },
});

function errorsOf(raw: unknown): string[] {
	const outcome = validateRunConfig(raw);
	return outcome.ok ? [] : outcome.errors.map((e) => `${e.path}: ${e.message}`);
}

describe("validateRunConfig", () => {
	test("accepts a minimal valid config", () => {
		const outcome = validateRunConfig(good());
		expect(outcome.ok).toBe(true);
	});

	test("rejects a non-object outright", () => {
		expect(errorsOf("nope")[0]).toContain("must be a JSON object");
	});

	test("rejects an unknown top-level key — a typo must not become a no-op", () => {
		expect(errorsOf({ ...good(), lapz: [1] }).join()).toContain("lapz");
	});

	test("rejects the wrong schema version", () => {
		expect(errorsOf({ ...good(), schemaVersion: 99 }).join()).toContain(
			"schemaVersion",
		);
	});

	test("names 'compare is not a mode' for a compare mode", () => {
		expect(errorsOf({ ...good(), mode: "compare" }).join()).toContain(
			"inputs.windSource",
		);
	});

	test("a selection that does not match the mode is an error, never a silent zero-segment run", () => {
		expect(
			errorsOf({ ...good(), mode: "gpsLap", selection: { laps: [2] } }).join(),
		).toContain("indexRanges");
		expect(
			errorsOf({
				...good(),
				selection: { indexRanges: [{ startIdx: 0, endIdx: 10 }] },
			}).join(),
		).toContain("laps | timeRanges");
	});

	test("lapNumbers must align 1:1 with indexRanges", () => {
		expect(
			errorsOf({
				...good(),
				mode: "gpsLap",
				selection: {
					indexRanges: [{ startIdx: 0, endIdx: 10 }],
					lapNumbers: [3, 4],
				},
			}).join(),
		).toContain("lapNumbers");
	});

	test("inputs are required and type-checked field by field", () => {
		expect(errorsOf({ ...good(), inputs: undefined }).join()).toContain(
			"inputs",
		);
		expect(
			errorsOf({ ...good(), inputs: { cda: "0.3", crr: 0.005 } }).join(),
		).toContain("inputs.cda");
		expect(
			errorsOf({ ...good(), inputs: { cda: -1, crr: 0.005 } }).join(),
		).toContain("must be > 0");
		expect(
			errorsOf({
				...good(),
				inputs: { cda: 0.3, crr: 0.005, windSource: "gusty" },
			}).join(),
		).toContain("windSource");
		expect(
			errorsOf({
				...good(),
				inputs: { cda: 0.3, crr: 0.005, sneaky: 1 },
			}).join(),
		).toContain("sneaky");
	});

	test("rhoArray takes only its three shapes", () => {
		for (const rhoArray of [null, false, [1.1, 1.2]]) {
			expect(
				validateRunConfig({
					...good(),
					inputs: { cda: 0.3, crr: 0.005, rhoArray },
				}).ok,
			).toBe(true);
		}
		expect(
			errorsOf({
				...good(),
				inputs: { cda: 0.3, crr: 0.005, rhoArray: true },
			}).join(),
		).toContain("rhoArray");
	});

	test("trim must be one of the two spaces, fully formed", () => {
		expect(
			validateRunConfig({
				...good(),
				trim: { space: "selection", start: 0, end: 100 },
			}).ok,
		).toBe(true);
		expect(
			validateRunConfig({
				...good(),
				trim: { space: "segment", bySegmentKey: { "standard-lap-2": { start: 1, end: 50 } } },
			}).ok,
		).toBe(true);
		expect(errorsOf({ ...good(), trim: { space: "both" } }).join()).toContain(
			"trim.space",
		);
		expect(
			errorsOf({ ...good(), trim: { space: "selection", start: 0 } }).join(),
		).toContain("start, end");
	});

	test("sections must carry all five index fields", () => {
		expect(
			errorsOf({
				...good(),
				mode: "outAndBack",
				selection: { sections: [{ sectionNumber: 1 }] },
			}).join(),
		).toContain("outboundStartIdx");
	});
});
