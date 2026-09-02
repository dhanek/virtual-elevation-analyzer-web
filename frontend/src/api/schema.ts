/**
 * THE headless-API contract (Convergence plan, C1): the JSON a runner accepts
 * and the JSON it emits. Everything else under `src/api/` is an implementation
 * of this file.
 *
 * LAYERING. `src/api/` is inside `src/` so it is type-checked, linted and
 * tested by the same CI gates as the app — `frontend/scripts/` is none of
 * those, so the CLI shim there stays ~90 lines and everything with meaning
 * lives here. Nothing in `src/main.ts`'s import graph reaches this directory
 * (`noNodeBuiltins.test.ts` pins both directions), and no file here imports a
 * `node:` builtin, so the Vite bundle cannot grow an accidental dependency on
 * the API.
 */
import type { AnalysisParameters } from "../components/AnalysisParameters";
import type { AnalysisModeId } from "../modes/analysis/types";
import type { WindSource } from "../state/AppState";
import type { SegmentVirtualDistance } from "../analysis/VirtualDistance";

/** The current request/response schema version. */
export const RUN_SCHEMA_VERSION = 1;

// ---------------------------------------------------------------------------
// Request
// ---------------------------------------------------------------------------

/** Decoded channel arrays, the `GoldenRideJson` leaf shape. */
export interface RunActivityChannels {
	record_count: number;
	timestamps: number[];
	power: number[];
	velocity: number[];
	position_lat: number[];
	position_long: number[];
	altitude: number[];
	distance: number[];
	air_speed?: number[];
	wind_speed?: number[];
	wind_yaw?: number[];
	temperature?: number[];
	air_density_data?: number[];
	road_speed?: number[];
}

export interface RunActivityRef {
	/**
	 * Path to a .fit or .csv file, resolved by the CALLER (the CLI resolves it
	 * relative to the config file's directory). Optional when the CLI is given
	 * `--file`, which wins.
	 */
	path?: string;
	/** "fit" | "csv"; inferred from the extension when absent. */
	type?: "fit" | "csv";
	/** Decoded channels, for callers that already hold arrays (tests do). */
	inline?: { channels: RunActivityChannels };
}

/** Standard: 1-BASED ordinals into the parsed lap list (`currentLaps[n-1]`). */
export interface RunSelectionLaps {
	laps: number[];
}

/** Standard, bypassing the lap list: explicit time windows. */
export interface RunSelectionTimeRanges {
	timeRanges: Array<{ start: number; end: number }>;
}

/** GPS-lap: full-activity index ranges, plus optional REAL lap numbers. */
export interface RunSelectionIndexRanges {
	indexRanges: Array<{ startIdx: number; endIdx: number }>;
	/** Aligned 1:1 with `indexRanges`; labels fall back to ordinals without it. */
	lapNumbers?: number[];
}

/** Out-and-back: outbound THEN inbound per section — the order is load-bearing. */
export interface RunSelectionSections {
	sections: Array<{
		sectionNumber: number;
		outboundStartIdx: number;
		outboundEndIdx: number;
		inboundStartIdx: number;
		inboundEndIdx: number;
	}>;
}

export type RunSelection =
	| RunSelectionLaps
	| RunSelectionTimeRanges
	| RunSelectionIndexRanges
	| RunSelectionSections;

/**
 * Two trim forms, never both. "selection" is ANALYZE-SELECTION index space —
 * exactly what the UI's trim sliders hold — mapped by the real
 * `mapTrimToSegments`. "segment" is SEGMENT-LOCAL space keyed by
 * `ModeSegment.key` ("standard-lap-3", "gpsLap-0", "s1-out").
 */
export type RunTrim =
	| { space: "selection"; start: number; end: number }
	| {
			space: "segment";
			bySegmentKey: Record<string, { start: number; end: number }>;
	  };

export interface RunInputs {
	cda: number;
	/** 22 °C-referenced; `resolveAppliedCrr` is applied inside the primitive. */
	crr: number;
	/** Defaults per `getDefaultWindSource` over the activity's channels. */
	windSource?: WindSource;
	airSpeedCalibrationPercent?: number;
	/** `fit-raw` only, headlessly — the DEM profiles live in browser state. */
	elevationProfile?: string;
	/**
	 * null/absent => resolve per `resolveRhoArray`; false => force the
	 * constant-rho path; an array => explicit FULL-ACTIVITY series.
	 */
	rhoArray?: number[] | false | null;
}

export interface RunOutputOptions {
	/** Per-sample arrays are big; off by default. */
	includeSeries?: boolean;
	/** Emit the RESULT_COLUMNS row (headers + unescaped values). */
	csvRow?: boolean;
	/** The Notes CSV cell. */
	notes?: string;
	/** Defaults to the activity file's basename. */
	fileName?: string | null;
}

export interface RunConfig {
	schemaVersion: number;
	activity?: RunActivityRef;
	mode: AnalysisModeId;
	selection: RunSelection;
	trim?: RunTrim;
	inputs: RunInputs;
	/** Missing keys fill from DEFAULT_PARAMETERS + normalizeLoadedParameters. */
	parameters?: Partial<AnalysisParameters>;
	output?: RunOutputOptions;
}

// ---------------------------------------------------------------------------
// Response
// ---------------------------------------------------------------------------

export interface RunErrorDetail {
	path: string;
	message: string;
	received?: unknown;
}

export interface RunError {
	code:
		| "invalid-config"
		| "activity-load-failed"
		| "no-valid-segments"
		| "internal";
	message: string;
	details?: RunErrorDetail[];
}

export interface RunSegmentResult {
	key: string;
	label: string;
	itemNumber: number | null;
	/** Full-activity range this segment consumed. */
	range: { startIdx: number; endIdx: number };
	/** Segment-local trim window it was measured over. */
	trim: { start: number; end: number };
	sampleCount: number;
	r2: number;
	rmse: number;
	veGain: number;
	actualGain: number;
	compare: {
		r2: number;
		rmse: number;
		veGain: number;
		actualGain: number;
	} | null;
}

export interface RunAggregate {
	r2: number;
	rmse: number;
	veGain: number;
	actualGain: number;
	segmentCount: number;
	extra?: Record<string, number>;
	compare?: {
		r2: number;
		rmse: number;
		veGain: number;
		actualGain: number;
		extra?: Record<string, number>;
	};
}

export interface RunSeries {
	bySegment: Array<{
		key: string;
		indices: number[];
		distancesKm: number[];
		virtualElevation: Array<number | null>;
		virtualElevationCompare: Array<number | null> | null;
		actualElevation: Array<number | null>;
	}>;
}

export interface RunResult {
	schemaVersion: number;
	ok: boolean;
	error?: RunError;
	run?: {
		fileName: string;
		mode: AnalysisModeId;
		cda: number;
		crr: number;
		crrApplied: number;
		windSourceRequested: WindSource;
		recordCount: number;
		wallClockMs: number;
	};
	aggregate?: RunAggregate;
	segments?: RunSegmentResult[];
	coverage?: {
		/** What the config asked for. */
		selected: number[];
		/** What the numbers describe (`appState.currentCoveredItems`). */
		covered: number[] | null;
	};
	virtualDistances?: SegmentVirtualDistance[];
	/** RESULT_COLUMNS, unescaped: quoting is the CSV writer's job. */
	csvRow?: {
		headers: string[];
		values: string[];
		/** Column indices the app always quotes (Notes). */
		quoteAlways: number[];
	};
	series?: RunSeries;
	warnings: string[];
}
