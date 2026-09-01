/**
 * THE declarative control union (D-04, ROADMAP SC#2).
 *
 * Every VE control that can trigger a recompute is a ROW here, with the modes it
 * applies to and what it does besides recomputing. `bindModeControls` walks this
 * table and wires each row; nothing else wires a VE control. That is the whole
 * point: the 2026-04-19 bug was a BINDING omission — a handler that forgot to
 * call an update function — and three hand-written binding sets above one
 * primitive would have left that forget-to-call surface fully intact.
 *
 * A row is one CONTROL, not one concept: the trim window is two rows (start and
 * end), and so is its map twin, because each is an independently bindable
 * element pair. `reason` is shared across the rows of one concept.
 *
 * DELIBERATELY NOT IN THIS TABLE: the action footer (`bindActionFooter`). It
 * saves, stores and exports — it never triggers a recompute — so it is not part
 * of the control/pipeline surface this table exists to make exhaustive. Each
 * render file keeps binding it directly.
 *
 * Source of truth for the rows: 07-RESEARCH.md §"Priority 6 — Binding layer
 * inventory (D-04)". Rows are neither invented nor omitted relative to it.
 */
import type { AnalysisModeId } from "../../modes/analysis/types";

/**
 * Why an update was requested. Carried through the funnel purely for logging and
 * for the call-shape guards; the primitive does not branch on it.
 *
 * `parameters` has no row in the table — it is the AnalysisParameters FORM, not a
 * VE control, and it reaches the funnel from `handleParametersChange`.
 * `convergence` has none either: it is the Convergence tab's ACTIVATION, which
 * reaches the funnel from the tab render map (`requestConvergenceRedraw`)
 * because an inactive tab has no cached surface to draw from (D-14).
 */
/**
 * Why the funnel was asked to recompute.
 *
 * Two members are deliberately NOT rows in `MODE_CONTROL_TABLE`, because they
 * do not come from a control inside the mode panel: `parameters`, raised by
 * `handleParametersChange`, and `segmentSelection`, raised by Section 3 when
 * the user ticks a detected GPS lap or out-and-back section. `modeControls.
 * callshape.test.ts` names both as exceptions.
 */
export type ModeUpdateReason =
	| "cda"
	| "crr"
	| "trim"
	| "mapTrim"
	| "calibration"
	| "autoAdjustCalibration"
	| "airSpeedOffset"
	| "windSource"
	| "elevationSmoothing"
	| "elevationDiffSource"
	| "crrTemp"
	| "windHeight"
	| "autoConverge"
	| "parameters"
	| "convergence"
	| "segmentSelection";

/** The DOM identity of one row. Absent ids mean the row is not element-driven. */
export interface ModeControlElements {
	rangeId?: string;
	numberId?: string;
	buttonId?: string;
	/** Read-only readout this row refreshes (currently only the offset metric). */
	metricId?: string;
	/** Which end of a paired window control this row drives. */
	role?: "start" | "end";
}

export interface ModeControlSpec {
	reason: ModeUpdateReason;
	kind: "rangeNumber" | "radioGroup" | "toggle" | "button" | "delegated";
	elements: ModeControlElements;
	/** Modes whose template renders this control at all. */
	modes: readonly AnalysisModeId[];
	/** What the handler writes before it asks for a recompute. */
	writes: "none" | "appStateCalibration" | "parameterFields";
	persistsSettings: boolean;
	movesMap: boolean;
	triggersAutoRho: boolean;
	refreshesOffsetMetric: boolean;
	/** Decimal places for the number input mirror. */
	decimals?: number;
}

const ALL_MODES: readonly AnalysisModeId[] = ["standard", "gpsLap", "outAndBack"];
/** The GPS templates render no trim markup at all — see 07-RESEARCH.md §Priority 6. */
const STANDARD_ONLY: readonly AnalysisModeId[] = ["standard"];

export const MODE_CONTROL_TABLE: readonly ModeControlSpec[] = [
	{
		reason: "cda",
		kind: "rangeNumber",
		elements: { rangeId: "cdaSlider", numberId: "cdaValue" },
		modes: ALL_MODES,
		writes: "none",
		persistsSettings: true,
		movesMap: false,
		triggersAutoRho: false,
		refreshesOffsetMetric: false,
		decimals: 3,
	},
	{
		reason: "crr",
		kind: "rangeNumber",
		elements: { rangeId: "crrSlider", numberId: "crrValue" },
		modes: ALL_MODES,
		writes: "none",
		persistsSettings: true,
		movesMap: false,
		triggersAutoRho: false,
		refreshesOffsetMetric: false,
		decimals: 4,
	},
	{
		// The auto-converge LOCK PAIR — one row for both checkboxes, because
		// `bindAutoConvergeLocks` binds and reports them as a unit. The block
		// is present-and-hidden until the Section-3 checkbox enables it; a
		// locked slider is `disabled`, so the cda/crr rows above stay bound
		// and simply never fire.
		reason: "autoConverge",
		kind: "toggle",
		elements: {},
		modes: ALL_MODES,
		writes: "none",
		persistsSettings: false,
		movesMap: false,
		triggersAutoRho: false,
		refreshesOffsetMetric: false,
	},
	{
		reason: "trim",
		kind: "rangeNumber",
		elements: {
			rangeId: "trimStartSlider",
			numberId: "trimStartValue",
			role: "start",
		},
		modes: STANDARD_ONLY,
		writes: "none",
		persistsSettings: true,
		movesMap: true,
		triggersAutoRho: true,
		refreshesOffsetMetric: false,
		decimals: 0,
	},
	{
		reason: "trim",
		kind: "rangeNumber",
		elements: {
			rangeId: "trimEndSlider",
			numberId: "trimEndValue",
			role: "end",
		},
		modes: STANDARD_ONLY,
		writes: "none",
		persistsSettings: true,
		movesMap: true,
		triggersAutoRho: true,
		refreshesOffsetMetric: false,
		decimals: 0,
	},
	{
		reason: "mapTrim",
		kind: "rangeNumber",
		elements: {
			rangeId: "mapTrimStartSlider",
			numberId: "mapTrimStartValue",
			role: "start",
		},
		modes: STANDARD_ONLY,
		writes: "none",
		persistsSettings: true,
		movesMap: true,
		triggersAutoRho: true,
		refreshesOffsetMetric: false,
		decimals: 0,
	},
	{
		reason: "mapTrim",
		kind: "rangeNumber",
		elements: {
			rangeId: "mapTrimEndSlider",
			numberId: "mapTrimEndValue",
			role: "end",
		},
		modes: STANDARD_ONLY,
		writes: "none",
		persistsSettings: true,
		movesMap: true,
		triggersAutoRho: true,
		refreshesOffsetMetric: false,
		decimals: 0,
	},
	{
		reason: "calibration",
		kind: "rangeNumber",
		elements: {
			rangeId: "airSpeedCalibrationSlider",
			numberId: "airSpeedCalibrationValue",
		},
		modes: ALL_MODES,
		writes: "appStateCalibration",
		persistsSettings: true,
		movesMap: false,
		triggersAutoRho: false,
		refreshesOffsetMetric: false,
		decimals: 1,
	},
	{
		reason: "autoAdjustCalibration",
		kind: "button",
		// The button DRIVES the calibration pair, so the pair is named here
		// rather than hard-coded in the binder. Without this the "declarative
		// table" claim in the file header did not hold for this row: a second
		// `button` row would have silently driven the air-speed calibration
		// slider, which is the forget-to-wire class the table exists to remove.
		elements: {
			buttonId: "autoAdjustCalibration",
			rangeId: "airSpeedCalibrationSlider",
			numberId: "airSpeedCalibrationValue",
		},
		modes: ALL_MODES,
		writes: "appStateCalibration",
		persistsSettings: true,
		movesMap: false,
		triggersAutoRho: false,
		refreshesOffsetMetric: false,
	},
	{
		// N-3: rendered in all three templates, bound in only one of them until
		// this plan. The GPS sidebars had the slider and the number input and no
		// handler at all, so dragging it did nothing.
		reason: "airSpeedOffset",
		kind: "rangeNumber",
		elements: {
			rangeId: "airSpeedOffsetSlider",
			numberId: "airSpeedOffsetValue",
			metricId: "airSpeedOffsetErrorMetric",
		},
		modes: ALL_MODES,
		writes: "parameterFields",
		persistsSettings: true,
		movesMap: false,
		triggersAutoRho: false,
		refreshesOffsetMetric: true,
		decimals: 0,
	},
	{
		// N-5: all three converge on ONE primitive pass that rebuilds every tab.
		reason: "windSource",
		kind: "radioGroup",
		elements: {},
		modes: ALL_MODES,
		writes: "none",
		persistsSettings: false,
		movesMap: false,
		triggersAutoRho: false,
		refreshesOffsetMetric: false,
	},
	{
		reason: "elevationSmoothing",
		kind: "toggle",
		elements: {},
		modes: ALL_MODES,
		writes: "none",
		persistsSettings: true,
		movesMap: false,
		triggersAutoRho: false,
		refreshesOffsetMetric: false,
	},
	{
		// Phase 2 of the Convergence plan: where the closure target comes from
		// (DEM | Barometer | Manual, plus the manual Δh input — bound as one
		// unit by `bindElevationDiffControls`, like the lock pair above).
		// Writes `elevation_diff_source` / `manual_elevation_diff_m` through
		// `mergeAnalysisParameters`; the parameter store persists them, so the
		// row itself does not save settings.
		reason: "elevationDiffSource",
		kind: "radioGroup",
		elements: {},
		modes: ALL_MODES,
		writes: "parameterFields",
		persistsSettings: false,
		movesMap: false,
		triggersAutoRho: false,
		refreshesOffsetMetric: false,
	},
	{
		reason: "crrTemp",
		kind: "delegated",
		elements: {},
		modes: ALL_MODES,
		writes: "parameterFields",
		persistsSettings: false,
		movesMap: false,
		triggersAutoRho: false,
		refreshesOffsetMetric: false,
	},
	{
		reason: "windHeight",
		kind: "delegated",
		elements: {},
		modes: ALL_MODES,
		writes: "parameterFields",
		persistsSettings: false,
		movesMap: false,
		triggersAutoRho: false,
		refreshesOffsetMetric: false,
	},
];

/** Rows this mode's template renders. */
export function controlsForMode(
	modeId: AnalysisModeId,
): readonly ModeControlSpec[] {
	return MODE_CONTROL_TABLE.filter((spec) => spec.modes.includes(modeId));
}
