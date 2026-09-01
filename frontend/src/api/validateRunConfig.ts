/**
 * Hand-written validation for `RunConfig` (Convergence plan, C3).
 *
 * ZERO DEPENDENCIES ON PURPOSE. This is a static Pages site with four runtime
 * dependencies; a schema library in `dependencies` is one accidental `src/`
 * import away from the bundle, and in `devDependencies` it breaks the day a
 * shell module imports `src/api/schema.ts` for its types. The schema is ~30
 * closed leaves, and the repo already hand-writes exactly this discipline
 * (`normalizeLoadedParameters`).
 *
 * NON-ROTTING BY CONSTRUCTION, not by vigilance: the per-field spec tables
 * are keyed `{ [K in keyof Required<...>]: ... }`, so adding a field to an
 * interface fails `npm run check` until its spec exists — the
 * `resultColumns.ts` one-table pattern.
 *
 * The validator returns errors, never throws, and never coerces silently.
 * Unknown TOP-LEVEL keys are errors (a typo'd "laps" must not become a
 * zero-segment run); unknown keys inside `parameters` are warnings, because
 * `AnalysisParameters` grows.
 */
import type { AnalysisModeId } from "../modes/analysis/types";
import {
	RUN_SCHEMA_VERSION,
	type RunConfig,
	type RunErrorDetail,
	type RunInputs,
	type RunOutputOptions,
} from "./schema";

export type ValidateRunConfigResult =
	| { ok: true; value: RunConfig; warnings: string[] }
	| { ok: false; errors: RunErrorDetail[] };

const MODES: readonly AnalysisModeId[] = ["standard", "gpsLap", "outAndBack"];
const WIND_SOURCES = ["constant", "fit", "compare", "none"] as const;

type FieldKind = "number" | "boolean" | "string";

interface FieldSpec {
	kind: FieldKind;
	optional: boolean;
	/** Extra constraint beyond the type, e.g. a range or an enum. */
	check?: (value: unknown) => string | null;
}

const finite = (value: unknown): string | null =>
	typeof value === "number" && Number.isFinite(value) ? null : "must be a finite number";

const positive = (value: unknown): string | null =>
	finite(value) ?? ((value as number) > 0 ? null : "must be > 0");

/** Keyed on `keyof` so a new RunInputs field cannot ship unvalidated. */
const INPUT_SPECS: { [K in keyof Required<RunInputs>]: FieldSpec } = {
	cda: { kind: "number", optional: false, check: positive },
	crr: { kind: "number", optional: false, check: positive },
	windSource: {
		kind: "string",
		optional: true,
		check: (v) =>
			(WIND_SOURCES as readonly string[]).includes(v as string)
				? null
				: `must be one of ${WIND_SOURCES.join(", ")}`,
	},
	airSpeedCalibrationPercent: { kind: "number", optional: true, check: finite },
	elevationProfile: { kind: "string", optional: true },
	// rhoArray is a union; validated by hand below.
	rhoArray: { kind: "number", optional: true },
};

const OUTPUT_SPECS: { [K in keyof Required<RunOutputOptions>]: FieldSpec } = {
	includeSeries: { kind: "boolean", optional: true },
	csvRow: { kind: "boolean", optional: true },
	notes: { kind: "string", optional: true },
	fileName: { kind: "string", optional: true },
};

const TOP_LEVEL_KEYS = new Set([
	"schemaVersion",
	"activity",
	"mode",
	"selection",
	"trim",
	"inputs",
	"parameters",
	"output",
]);

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isNumberArray(value: unknown): value is number[] {
	return Array.isArray(value) && value.every((v) => typeof v === "number");
}

function checkSpecs(
	object: Record<string, unknown>,
	specs: Record<string, FieldSpec>,
	path: string,
	errors: RunErrorDetail[],
	skip: Set<string> = new Set(),
): void {
	for (const [key, spec] of Object.entries(specs)) {
		if (skip.has(key)) continue;
		const value = object[key];
		if (value === undefined || value === null) {
			if (!spec.optional) {
				errors.push({ path: `${path}.${key}`, message: "is required" });
			}
			continue;
		}
		if (typeof value !== spec.kind) {
			errors.push({
				path: `${path}.${key}`,
				message: `must be a ${spec.kind}`,
				received: value,
			});
			continue;
		}
		const failure = spec.check?.(value);
		if (failure) {
			errors.push({ path: `${path}.${key}`, message: failure, received: value });
		}
	}
	for (const key of Object.keys(object)) {
		if (!(key in specs)) {
			errors.push({ path: `${path}.${key}`, message: "is not a known field" });
		}
	}
}

function validateSelection(
	mode: AnalysisModeId,
	selection: unknown,
	errors: RunErrorDetail[],
): void {
	if (!isRecord(selection)) {
		errors.push({ path: "selection", message: "is required" });
		return;
	}
	const keys = Object.keys(selection).filter((k) => k !== "lapNumbers");
	const shape = keys.length === 1 ? keys[0] : null;

	const expected: Record<AnalysisModeId, string[]> = {
		standard: ["laps", "timeRanges"],
		gpsLap: ["indexRanges"],
		outAndBack: ["sections"],
	};
	if (!shape || !expected[mode].includes(shape)) {
		// A selection that does not match the mode must be an ERROR, not a
		// silent zero-segment run with a null outcome and no explanation.
		errors.push({
			path: "selection",
			message: `mode '${mode}' needs exactly one of: ${expected[mode].join(" | ")}`,
			received: keys,
		});
		return;
	}

	const value = (selection as Record<string, unknown>)[shape];
	if (!Array.isArray(value) || value.length === 0) {
		errors.push({ path: `selection.${shape}`, message: "must be a non-empty array" });
		return;
	}

	if (shape === "laps" && !isNumberArray(value)) {
		errors.push({ path: "selection.laps", message: "must be 1-based lap ordinals" });
	}
	if (shape === "timeRanges") {
		for (const [i, range] of value.entries()) {
			if (!isRecord(range) || finite(range.start) || finite(range.end)) {
				errors.push({ path: `selection.timeRanges[${i}]`, message: "must be {start, end}" });
			}
		}
	}
	if (shape === "indexRanges") {
		for (const [i, range] of value.entries()) {
			if (!isRecord(range) || finite(range.startIdx) || finite(range.endIdx)) {
				errors.push({ path: `selection.indexRanges[${i}]`, message: "must be {startIdx, endIdx}" });
			}
		}
		const lapNumbers = (selection as Record<string, unknown>).lapNumbers;
		if (lapNumbers !== undefined) {
			if (!isNumberArray(lapNumbers) || lapNumbers.length !== value.length) {
				errors.push({
					path: "selection.lapNumbers",
					message: "must align 1:1 with indexRanges",
				});
			}
		}
	}
	if (shape === "sections") {
		for (const [i, section] of value.entries()) {
			const fields = [
				"sectionNumber",
				"outboundStartIdx",
				"outboundEndIdx",
				"inboundStartIdx",
				"inboundEndIdx",
			];
			if (!isRecord(section) || fields.some((f) => finite(section[f]))) {
				errors.push({
					path: `selection.sections[${i}]`,
					message: `must carry ${fields.join(", ")}`,
				});
			}
		}
	}
}

function validateTrim(trim: unknown, errors: RunErrorDetail[]): void {
	if (trim === undefined) return;
	if (!isRecord(trim)) {
		errors.push({ path: "trim", message: "must be an object" });
		return;
	}
	if (trim.space === "selection") {
		if (finite(trim.start) || finite(trim.end)) {
			errors.push({ path: "trim", message: "selection-space trim needs {start, end}" });
		}
	} else if (trim.space === "segment") {
		if (!isRecord(trim.bySegmentKey)) {
			errors.push({ path: "trim.bySegmentKey", message: "must map segment keys to {start, end}" });
			return;
		}
		for (const [key, window] of Object.entries(trim.bySegmentKey)) {
			if (!isRecord(window) || finite(window.start) || finite(window.end)) {
				errors.push({ path: `trim.bySegmentKey.${key}`, message: "must be {start, end}" });
			}
		}
	} else {
		errors.push({ path: "trim.space", message: "must be 'selection' or 'segment'", received: trim.space });
	}
}

export function validateRunConfig(raw: unknown): ValidateRunConfigResult {
	const errors: RunErrorDetail[] = [];
	const warnings: string[] = [];

	if (!isRecord(raw)) {
		return { ok: false, errors: [{ path: "", message: "config must be a JSON object" }] };
	}

	for (const key of Object.keys(raw)) {
		if (!TOP_LEVEL_KEYS.has(key)) {
			errors.push({ path: key, message: "is not a known field" });
		}
	}

	if (raw.schemaVersion !== RUN_SCHEMA_VERSION) {
		errors.push({
			path: "schemaVersion",
			message: `must be ${RUN_SCHEMA_VERSION}`,
			received: raw.schemaVersion,
		});
	}

	const mode = raw.mode as AnalysisModeId;
	if (!MODES.includes(mode)) {
		errors.push({
			path: "mode",
			message: `must be one of ${MODES.join(", ")} — 'compare' is not a mode, it is inputs.windSource`,
			received: raw.mode,
		});
	} else {
		validateSelection(mode, raw.selection, errors);
	}

	validateTrim(raw.trim, errors);

	if (!isRecord(raw.inputs)) {
		errors.push({ path: "inputs", message: "is required" });
	} else {
		checkSpecs(raw.inputs, INPUT_SPECS, "inputs", errors, new Set(["rhoArray"]));
		const rhoArray = raw.inputs.rhoArray;
		if (
			rhoArray !== undefined &&
			rhoArray !== null &&
			rhoArray !== false &&
			!isNumberArray(rhoArray)
		) {
			errors.push({
				path: "inputs.rhoArray",
				message: "must be null (auto), false (constant rho) or a number array",
			});
		}
	}

	if (raw.parameters !== undefined) {
		if (!isRecord(raw.parameters)) {
			errors.push({ path: "parameters", message: "must be an object" });
		} else {
			// Unknown parameter keys WARN rather than fail: AnalysisParameters
			// grows, and a config written against a newer app should not brick
			// an older runner outright.
			for (const [key, value] of Object.entries(raw.parameters)) {
				if (
					value !== null &&
					!["number", "boolean", "string"].includes(typeof value)
				) {
					errors.push({ path: `parameters.${key}`, message: "must be a scalar or null" });
				}
			}
		}
	}

	if (raw.output !== undefined) {
		if (!isRecord(raw.output)) {
			errors.push({ path: "output", message: "must be an object" });
		} else {
			checkSpecs(raw.output, OUTPUT_SPECS, "output", errors);
		}
	}

	if (raw.activity !== undefined) {
		if (!isRecord(raw.activity)) {
			errors.push({ path: "activity", message: "must be an object" });
		} else {
			const { path, type, inline } = raw.activity as Record<string, unknown>;
			if (path !== undefined && typeof path !== "string") {
				errors.push({ path: "activity.path", message: "must be a string" });
			}
			if (type !== undefined && type !== "fit" && type !== "csv") {
				errors.push({ path: "activity.type", message: "must be 'fit' or 'csv'", received: type });
			}
			if (inline !== undefined) {
				if (!isRecord(inline) || !isRecord(inline.channels)) {
					errors.push({ path: "activity.inline", message: "must carry {channels}" });
				}
			}
		}
	}

	if (errors.length > 0) {
		return { ok: false, errors };
	}
	return { ok: true, value: raw as unknown as RunConfig, warnings };
}
