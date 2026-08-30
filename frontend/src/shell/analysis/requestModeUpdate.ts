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
 * As of plan 07-04 there are NO exceptions left. Standard's `compare` branch was
 * the last one — it composed its own two calculators and never reached the
 * primitive — and D-07/D-20 folded it in. Every wind source in every mode now
 * takes this road.
 */
import { getNormalizedActivityArrays } from "../../analysis/ActivityArrayCache";
import { resolveAppliedCrr } from "../../analysis/CrrTemperatureCorrection";
import {
	collectSelectionIndices,
	getAnalysisModeHandler,
	getAnalysisModeHandlerById,
} from "../../modes/analysis/AnalysisModes";
import type { ModeSegment } from "../../modes/analysis/types";
import type { AppState } from "../../state/AppState";
import { log } from "../../utils/log";
import { getSelectedWindSource, toWindSource } from "../dom/windSource";
import { getGpsAnalysisMode } from "../section3/section3Orchestration";
import { mapTrimToSegments } from "../ve/standardSegments";
import type { ModeUpdateReason } from "./modeControlTable";
import { getModeUpdateCallbacks } from "./modeUpdateCallbacks";
import { scheduleRecompute } from "./recomputeRunner";
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
	// The UPDATE path, so the ANALYZED selection (WR-06). Mapping the window
	// through the live checkbox selection would place a trim sized for the
	// panel on screen onto laps that panel does not describe.
	const selectedIndices = collectSelectionIndices(
		(handler.prepareUpdateSelection ?? handler.prepareSelection).call(
			handler,
			appState,
		),
		normalized.timestamps,
	);

	return mapTrimToSegments(segments, selectedIndices, trimStart, trimEnd);
}

/**
 * WHICH MODE IS ON SCREEN — asked of the PANEL, not only of the Section 3 mode.
 *
 * The GPS-lap overlay is reached two ways, and `getGpsAnalysisMode()` can only
 * see one of them:
 *
 *   - genuine GPS lap splitting, where the mode reads "GPS based lap splitting";
 *   - the "Stacked" lap view of a multi-lap STANDARD selection, where the user
 *     never left standard mode and it still reads "None".
 *
 * In the second case resolving by the mode string alone hands the update to
 * Standard's handler — and therefore, via `getModeUpdateCallbacks(handler.id)`,
 * to STANDARD's render callbacks — while the GPS-LAP panel is on screen. Every
 * redraw is then aimed at `vePlot` / `vdPlot` / `windSpeedPlot`, ids that panel
 * does not contain, and Plotly throws: after its first paint the stacked view
 * never updated again. Before `f810cb9` the overlay's controls called
 * `updateGpsLapVEPlots` directly, so this is a regression of that migration, and
 * it is the one place "works in GPS-lap, dead in standard (None)" is literally
 * true.
 *
 * `isGpsLapModeActive` is the state that already means "the overlay is on
 * screen": set by `gpsLapMode.syncState` and by the orchestrator's stacked
 * toggle, cleared by `standardMode` / `outAndBackMode.syncState` and by the
 * stitched toggle. `resolveActiveGpsLapRanges` already collapses both routes
 * onto the same ranges for exactly this reason; asking the same question here
 * keeps the segments and the renderer from drifting apart.
 */
function resolveActiveModeHandler(
	appState: AppState,
): ReturnType<typeof getAnalysisModeHandler> {
	return appState.isGpsLapModeActive
		? getAnalysisModeHandlerById("gpsLap")
		: getAnalysisModeHandler(getGpsAnalysisMode());
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

	// Total by construction: both accessors index a complete record, so there is
	// no null branch to guard.
	const handler = resolveActiveModeHandler(appState);

	const cda = readNumber("cdaSlider", "cdaValue", FALLBACK_CDA);
	const crr = readNumber("crrSlider", "crrValue", FALLBACK_CRR);
	const windSource = toWindSource(getSelectedWindSource());

	// NO SOURCE IS ROUTED ANYWHERE ELSE (07-04 Task 1). Standard used to claim
	// `compare` here and run its own two-calculator branch, because the primitive
	// had no compare path. It has one now, so every wind source — `compare`
	// included — takes the same road: one funnel, one primitive, one set of
	// injected renderers. The sentence at the top of this file finally holds with
	// no exception clause attached to it.
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
		run: async () => {
			// RE-CHECKED HERE, not only at the top of this function (NEW-1).
			//
			// Everything this closure needs — `handler`, `callbacks`, `segments` —
			// was resolved BEFORE `scheduleRecompute`, so the panel can be torn
			// down between arming and firing and this pass would still hold a live
			// callbacks object pointing at renderers whose panel is gone. Clearing
			// FACTORIES cannot reach it and neither can the `hidden` class, because
			// the gate above already ran.
			//
			// `setGpsAnalysisMode`'s teardown also calls `resetRecomputeThrottle()`,
			// which cancels a pass still sitting in the throttle. This second guard
			// covers the rest: a pass that has already left the timer, and any
			// future teardown path that forgets to disarm.
			if (!isVeSectionVisible()) {
				log.debug(
					`requestModeUpdate(${reason}): VE section went away before the scheduled pass ran`,
				);
				return;
			}
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
