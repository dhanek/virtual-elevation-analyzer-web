/**
 * THE funnel (D-04, ROADMAP SC#2).
 *
 * THIS FILE IS THE ONLY PRODUCTION MODULE ALLOWED TO CALL `updateModeVEPlots`.
 * Plan 07-02 gave the phase one compute path; that closed half of the
 * 2026-04-19 omission class. The other half was a control that reached the
 * update by a private route (or by no route at all). With one funnel above one
 * primitive, "forgot to call the update" stops being a thing a human can do:
 * a control is either a row in `MODE_CONTROL_TABLE` — and therefore bound and
 * funnelled — or it does not exist.
 *
 * Everything mode-specific is resolved through the two seams that already exist:
 * `getAnalysisModeHandler` for behaviour (D-03) and `getModeUpdateCallbacks` for
 * rendering. Nothing here knows which mode it is serving.
 *
 * Standard's `compare` branch is the one live exception, and it is not an
 * exception to the sentence above: that branch composes its own two calculators
 * and never reaches the primitive. Plan 07-04 (D-07/D-20) folds it in and
 * deletes it.
 */
import { getNormalizedActivityArrays } from "../../analysis/ActivityArrayCache";
import { resolveAppliedCrr } from "../../analysis/CrrTemperatureCorrection";
import {
	collectSelectionIndices,
	getAnalysisModeHandler,
} from "../../modes/analysis/AnalysisModes";
import type { AnalysisModeId, ModeSegment } from "../../modes/analysis/types";
import type { AppState, WindSource } from "../../state/AppState";
import { log } from "../../utils/log";
import { getSelectedWindSource } from "../dom/windSource";
import { getGpsAnalysisMode } from "../section3/section3Orchestration";
import { mapTrimToSegments } from "../ve/standardSegments";
import type { ModeUpdateReason } from "./modeControlTable";
import { getModeUpdateCallbacks } from "./modeUpdateCallbacks";
import { scheduleRecompute, type RecomputeMode } from "./recomputeRunner";
import { updateModeVEPlots } from "./updateModeVEPlots";

/** Defaults the two GPS update paths already used when a slider was missing. */
const FALLBACK_CDA = 0.3;
const FALLBACK_CRR = 0.008;

export interface ModeUpdateRequestDeps {
	appState: AppState;
}

let deps: ModeUpdateRequestDeps | null = null;

export function configureModeUpdateRequests(
	nextDeps: ModeUpdateRequestDeps,
): void {
	deps = nextDeps;
}

/** Test seam. */
export function resetModeUpdateRequests(): void {
	deps = null;
}

/**
 * Is the VE panel on screen?
 *
 * Moved here verbatim from `handleParametersChange`, which used it to decide
 * whether to fire its synthetic slider dispatch (N-4). Both callers now share
 * this one definition rather than each carrying a copy of the class names.
 */
export function isVeSectionVisible(): boolean {
	if (typeof document === "undefined") {
		return false;
	}
	const veSection =
		document.getElementById("veAnalysisSection") ??
		document.getElementById("veSection");
	return (
		!!veSection &&
		!veSection.classList.contains("hidden") &&
		!veSection.classList.contains("workflow-section--inactive")
	);
}

function recomputeModeFor(id: AnalysisModeId): RecomputeMode {
	switch (id) {
		case "gpsLap":
			return "gps-lap";
		case "outAndBack":
			return "out-and-back";
		default:
			return "standard";
	}
}

function readNumber(
	rangeId: string,
	numberId: string,
	fallback: number,
): number {
	const range = document.getElementById(rangeId) as HTMLInputElement | null;
	const fromRange = range ? parseFloat(range.value) : NaN;
	if (!Number.isNaN(fromRange)) {
		return fromRange;
	}
	const number = document.getElementById(numberId) as HTMLInputElement | null;
	const fromNumber = number ? parseFloat(number.value) : NaN;
	return Number.isNaN(fromNumber) ? fallback : fromNumber;
}

/**
 * Attach the trim window to the segments, by ELEMENT PRESENCE rather than by a
 * mode `if`.
 *
 * Standard is the only template that renders trim markup, so the rule stays
 * declarative: a mode that grows a trim window gets this for free, and one that
 * has none never asks for it.
 *
 * The mapping goes through `mapTrimToSegments`, not by attaching the window to
 * `segments[0]`. Under D-19 Option B Standard emits ONE SEGMENT PER SELECTED
 * LAP, so a single global window has to be placed on each of them separately —
 * and adjacent laps share their boundary record, which is why the mapping routes
 * through full-activity indices instead of arithmetic on the deduplicated
 * selection. See `standardSegments.ts` for the three index spaces involved.
 */
function withTrim(
	appState: AppState,
	handler: ReturnType<typeof getAnalysisModeHandler>,
	segments: ModeSegment[],
): ModeSegment[] {
	const trimStartSlider = document.getElementById(
		"trimStartSlider",
	) as HTMLInputElement | null;
	const trimEndSlider = document.getElementById(
		"trimEndSlider",
	) as HTMLInputElement | null;

	if (!trimStartSlider || !trimEndSlider) {
		return segments;
	}

	const trimStart = parseInt(trimStartSlider.value);
	const trimEnd = parseInt(trimEndSlider.value);
	if (Number.isNaN(trimStart) || Number.isNaN(trimEnd)) {
		return segments;
	}

	const fitData = appState.currentFitData;
	if (!fitData) {
		return segments;
	}

	const normalized = getNormalizedActivityArrays(fitData);
	const selectedIndices = collectSelectionIndices(
		handler.prepareSelection(appState),
		normalized.timestamps,
	);

	return mapTrimToSegments(segments, selectedIndices, trimStart, trimEnd);
}

/**
 * Ask for a VE update.
 *
 * Every bound control funnels through here, and so does the parameters form.
 * The call is scheduled, not run: `scheduleRecompute` is latest-input-wins, so a
 * drag that fires this fifty times still ends on one pass over the newest values.
 */
export function requestModeUpdate(reason: ModeUpdateReason): void {
	if (!deps) {
		log.debug(`requestModeUpdate(${reason}): not configured yet`);
		return;
	}

	const { appState } = deps;
	if (!appState.currentFitData || !appState.currentParameters) {
		log.debug(`requestModeUpdate(${reason}): no activity or parameters loaded`);
		return;
	}

	if (!isVeSectionVisible()) {
		log.debug(`requestModeUpdate(${reason}): VE section not visible`);
		return;
	}

	// Total by construction: `getAnalysisModeHandler` indexes a complete record
	// by `getAnalysisModeId`, so there is no null branch to guard.
	const handler = getAnalysisModeHandler(getGpsAnalysisMode());

	const cda = readNumber("cdaSlider", "cdaValue", FALLBACK_CDA);
	const crr = readNumber("crrSlider", "crrValue", FALLBACK_CRR);
	const windSource = getSelectedWindSource() as WindSource;

	const callbacks = getModeUpdateCallbacks(handler.id, {
		windSource,
		cda,
		crr,
		appliedCrr: resolveAppliedCrr(appState.currentParameters, crr),
	});
	if (!callbacks) {
		log.error(
			`requestModeUpdate(${reason}): no update callbacks registered for mode ${handler.id}`,
		);
		return;
	}

	const segments = withTrim(
		appState,
		handler,
		handler.getUpdateSegments(appState),
	);

	log.debug(`requestModeUpdate(${reason}) -> ${handler.id}`);

	scheduleRecompute({
		mode: recomputeModeFor(handler.id),
		run: async () => {
			await updateModeVEPlots({
				appState,
				handler,
				callbacks,
				windSource,
				cda,
				crr,
				segments,
			});
		},
	});
}
