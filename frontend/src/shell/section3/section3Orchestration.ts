import { AppState } from "../../state/AppState";
import {
	ParameterStorage,
	type LapSettings,
} from "../../utils/ParameterStorage";
import { MapVisualization } from "../../components/MapVisualization";
import { log } from "../../utils/log";
import {
	GpsLapDetector,
	OutAndBackDetector,
	type GpsLapDetectionConfig,
	type OutAndBackConfig,
	getDefaultLapDetectionConfig,
	DEFAULT_OUT_AND_BACK_CONFIG,
	formatLapDuration,
	formatLapDistance,
	type OutAndBackSection,
} from "../../utils/GpsLapDetection";
import { saveMapTrimSettings } from "../../analysis/MultiSegmentSettings";
import { calculateAutoRho } from "../ve";
import {
	renderSection3Template,
	bindLapSelection,
	bindSelectAllButton,
	bindGpsModeSelector,
	bindGpsDetection,
	bindOutAndBackDetection,
} from ".";
import {
	formatDistance,
	formatDuration,
	formatPower,
} from "../dem/demHandlers";
import { AnalysisParametersComponent } from "../../components/AnalysisParameters";
import { clearModeUpdateCallbacks } from "../analysis/modeUpdateCallbacks";
import {
	resetRecomputeStatus,
	resetRecomputeThrottle,
} from "../analysis/recomputeRunner";
import { purgePlotlyGraphsIn } from "../dom/plotlyPurge";
import { requestModeUpdate } from "../analysis/requestModeUpdate";
import { sameItems } from "../ve/veSelectionGuard";

const MIN_TRIM_WINDOW_SAMPLES = 30;

/**
 * "Re-run the active GPS detection with the gates where they are now",
 * published by whichever binder is currently bound.
 *
 * BOTH DETECTORS ARE SCOPED TO THE FIT LAP SELECTION — each derives its
 * `trimStart`/`trimEnd` from `appState.selectedLaps` — and nothing re-ran them
 * when that selection changed. Ticking a second FIT lap left the detected lap
 * count, the checkbox list and the VE panel all describing the previous window;
 * the only way to provoke a re-detect was to nudge a gate by a second. Reported
 * from the running app, 2026-09-01.
 *
 * A slot rather than a direct call because the gate offsets live in the
 * binders' closures, and `rerenderSection3` rebinds them. Cleared alongside
 * `restoreSection3Controls` so a mode that is no longer bound cannot leave a
 * closure behind that re-detects into a mode the user has left.
 */
let redetectForFitSelection: (() => void) | null = null;

function setGpsRedetect(redetect: () => void): void {
	redetectForFitSelection = redetect;
}

function clearGpsRedetect(): void {
	redetectForFitSelection = null;
}

// GPS Analysis Mode state - lives in Section 3 shell as single source of truth (per D-04)
type GpsAnalysisMode =
	| "None"
	| "GPS based lap splitting"
	| "GPS based out and back"
	| "GPS gate one way";
let currentGpsAnalysisMode: GpsAnalysisMode = "None";

/**
 * Get the current GPS analysis mode
 */
export function getGpsAnalysisMode(): GpsAnalysisMode {
	return currentGpsAnalysisMode;
}

/**
 * Set the GPS analysis mode and update all dependent UI elements
 */
export function setGpsAnalysisMode(mode: GpsAnalysisMode): void {
	const deps = getDependencies();
	const previousMode = currentGpsAnalysisMode;

	// Update state
	currentGpsAnalysisMode = mode;

	// If mode changes from non-"None" to "None" or to a different mode, clear GPS detections (per D-07)
	if (previousMode !== "None" && mode === "None") {
		// Clear all GPS detections
		deps.appState.gpsDetectedLaps = [];
		deps.appState.gpsSelectedLaps = [];
		deps.appState.gpsLapDetectionResult = null;
		deps.appState.outAndBackSections = [];
		deps.appState.outAndBackSelectedSections = [];
		deps.appState.outAndBackResult = null;

		// Clear map visualization
		deps.getMapVisualization()?.clearDetectedLaps();
		deps.getMapVisualization()?.clearGpsMarker();
		deps.getMapVisualization()?.clearOutAndBackMarkers();

		// Update UI
		updateGpsDetectedLapsUI();
		updateOutAndBackSectionsUI();
	} else if (previousMode !== mode && previousMode !== "None") {
		// Mode switched to different GPS mode - clear previous detections
		if (
			previousMode === "GPS based lap splitting" ||
			previousMode === "GPS gate one way"
		) {
			deps.appState.gpsDetectedLaps = [];
			deps.appState.gpsSelectedLaps = [];
			deps.appState.gpsLapDetectionResult = null;
			deps.getMapVisualization()?.clearDetectedLaps();
			deps.getMapVisualization()?.clearGpsMarker();
			updateGpsDetectedLapsUI();
		} else if (previousMode === "GPS based out and back") {
			deps.appState.outAndBackSections = [];
			deps.appState.outAndBackSelectedSections = [];
			deps.appState.outAndBackResult = null;
			deps.getMapVisualization()?.clearDetectedLaps();
			deps.getMapVisualization()?.clearOutAndBackMarkers();
			updateOutAndBackSectionsUI();
		}
	}

	// The VE panel belongs to the mode that rendered it, so a real mode change
	// invalidates it (GPS-02 / v1.1 audit finding BL-1). BEFORE the re-render,
	// so the panel is gone before Section 3 repaints.
	if (previousMode !== mode) {
		tearDownVeAnalysisPanel(deps.appState);
	}

	// Re-render Section 3 to show/hide GPS detection panels based on new mode
	rerenderSection3();

	// Update map visualization if mode changed
	if (previousMode !== mode) {
		const mapViz = deps.getMapVisualization();
		if (mapViz) {
			// Clear markers when switching modes
			mapViz.clearDetectedLaps();
			mapViz.clearGpsMarker();
			mapViz.clearOutAndBackMarkers();
		}
	}

	log.debug(`GPS analysis mode changed: ${previousMode} -> ${mode}`);
}

/**
 * Invalidate the VE analysis panel after a real Section-3 mode change.
 *
 * GPS-02 / v1.1 audit finding BL-1. The panel on screen was rendered by ONE
 * mode's renderer and its update callbacks were registered under that mode's
 * id, but `resolveActiveModeHandler` (`requestModeUpdate.ts:180-186`) picks the
 * handler fresh on every control event:
 *
 *     appState.isGpsLapModeActive ? gpsLap : getAnalysisModeHandler(getGpsAnalysisMode())
 *
 * Changing the dropdown moved that choice without moving the panel, and it
 * broke in TWO different directions:
 *
 *  1. Standard or out-and-back analyzed, dropdown -> a GPS mode. The flag is
 *     false, so the dropdown wins and the funnel points at a mode with no
 *     registered callbacks: the sliders move and the plot never updates. With a
 *     `gpsLap` factory left over from an earlier analyze — `FACTORIES` was never
 *     cleared in production — it instead reached the primitive with zero
 *     segments. Dead either way, but visibly so.
 *
 *  2. GPS-lap analyzed, dropdown -> None. The flag is STILL true (only
 *     `gpsLapMode.syncState` sets it, and nothing here reset it), so the flag
 *     branch short-circuits and the funnel kept RECOMPUTING against detections
 *     this very function had just cleared. Silently wrong rather than visibly
 *     dead, which is why `isGpsLapModeActive` is in the reset list below and why
 *     making the dropdown authoritative would NOT have been a fix.
 *
 * Consistent with what this function already does to detections and map
 * markers: the basis is gone, so the results computed from it go too. The user
 * re-Analyzes.
 */
function tearDownVeAnalysisPanel(appState: AppState): void {
	// The exact class the three render files remove to show the panel, and one
	// of the two `isVeSectionVisible` (`requestModeUpdate.ts:73-78`) checks.
	// `#veAnalysisContent.innerHTML` is deliberately left alone — the next
	// render replaces it wholesale, and the stale controls it still holds are
	// unreachable behind the visibility gate.
	document.getElementById("veAnalysisSection")?.classList.add("hidden");

	// The MARKUP can stay; what Plotly hung off it should not (audit NEW-2).
	// Hiding a graph div releases none of the figure data, layout, drag handlers
	// or `responsive` window listener behind it, and this is the point at which
	// they stop describing anything on screen. Bounded at one panel — the next
	// analyze overwrites the container — so this is memory and a stray listener,
	// not correctness.
	const veContent = document.getElementById("veAnalysisContent");
	if (veContent) {
		purgePlotlyGraphsIn(veContent);
	}

	// First production caller. Stops a previous mode's renderer factory staying
	// reachable for the life of the session.
	clearModeUpdateCallbacks();

	// Disarm a recompute that is already scheduled (NEW-1). `requestModeUpdate`
	// resolves its handler, callbacks and segments BEFORE scheduling and captures
	// them in the closure, so a drag landing inside the throttle window followed
	// by a mode change would otherwise let that pass run and repopulate the very
	// fields reset below. `requestModeUpdate`'s scheduled run re-checks
	// visibility as well; this disarms it earlier so the pass never starts.
	resetRecomputeThrottle();

	// The 250 ms "Updated" flash is a SEPARATE timer that `resetRecomputeThrottle`
	// does not clear. Left armed it fires into a torn-down panel, and going idle
	// used to MINT a `#veRecomputeStatus` node wherever it failed to find one —
	// so the teardown ended with a fresh pill inside the panel it had just
	// hidden. Cosmetic, and now impossible from either end.
	resetRecomputeStatus();

	// Everything Store Result and Export read, so neither can persist a record
	// describing an analysis whose basis no longer exists.
	appState.isGpsLapModeActive = false;
	appState.currentVEResult = null;
	appState.currentFilteredData = null;
	appState.currentAnalyzedLaps = [];
	// null, not [] — the documented "coverage unknown" value (WR-01/WR-02).
	appState.currentCoveredItems = null;
	appState.currentWindSource = "none";
	appState.currentVirtualDistances = [];
	// Not read by Store Result, but the segment/overlay state every `syncState`
	// already nulls; leaving it would keep a stale segment list alive.
	appState.currentGpsLapIndexRanges = null;
	appState.currentOverlayLapNumbers = null;
	// The out-and-back twin of the two above, and the basis
	// `invalidateVePanelIfDetectionChanged` reads: left behind, a torn-down
	// panel would still report an analysed cut, and `resolveActiveOutAndBackSections`
	// would still prefer it over the live selection.
	appState.currentOutAndBackSections = [];
}

/**
 * Invalidate the VE panel when a Section-3 SELECTION no longer matches the one
 * that was analyzed.
 *
 * The same rule `tearDownVeAnalysisPanel` states for a mode change — the basis
 * is gone, so the results computed from it go too — reached by the other route.
 * A mode change is not the only way to replace the panel's input: the lap
 * checkboxes, the out-and-back section checkboxes and a gate re-detection all
 * do. None of them touched the panel, so the plot kept the old selection's
 * curve while the Section-3 controls that read the selection directly moved to
 * the new one.
 *
 * GUARDED, NOT UNCONDITIONAL, on both halves of the condition:
 *
 *  - `analyzedBasis` empty means nothing has been analyzed, so there is no
 *    panel to invalidate. Selecting the laps for a FIRST analyze must not run
 *    the teardown — it would fight the very selection the user is making.
 *  - An UNCHANGED basis means this call is a reconciliation, not a user edit.
 *    `updateSelectedLaps` is also Section 3's post-render hook: it re-derives
 *    the selection from freshly rendered markup on every `rerenderSection3`,
 *    and tearing down there would destroy a valid panel on an ordinary mode
 *    re-render. That is the defect the first describe block of
 *    `section3ModeSwitch.test.ts` exists for, and this is the shape that would
 *    reintroduce it.
 *
 * Callers pass the analyzed list their own mode records: `currentAnalyzedLaps`
 * for FIT laps, `currentCoveredItems` for the segment modes' section numbers
 * (WR-01/WR-02).
 */
function invalidateVePanelIfBasisChanged(
	analyzedBasis: number[] | null,
	newBasis: number[],
): void {
	if (!analyzedBasis || analyzedBasis.length === 0) return;
	if (sameItems(analyzedBasis, newBasis)) return;
	tearDownVeAnalysisPanel(getDependencies().appState);
}

/**
 * The RE-DETECTION twin of the above: the panel goes when THE DETECTION
 * CHANGES, in either GPS mode.
 *
 * Two earlier versions of this were both too weak. The first compared item
 * numbers, which the detectors renumber sequentially from 1, so a gate nudge
 * that still yielded three sections compared `[1, 2, 3]` with `[1, 2, 3]` and
 * the guard could not fire at all. The second compared the ANALYSED ranges
 * against the new detection and spared a detection that merely ADDED items,
 * on the reasoning that what was on screen was still accurate. It is not:
 * widening the FIT window from one lap to two took the GPS lap count from 6 to
 * 14 while the plot stayed, and the plot's own lap NUMBERS — the key Store
 * Result and the saved CdA/Crr live under — now point at different laps. A
 * detection that changed is a basis that changed, whichever direction it moved.
 * Reported from the running app, 2026-09-01.
 *
 * So the comparison is the detected list BEFORE against the detected list
 * AFTER, in order, and the analysed state only answers "is there a panel to
 * invalidate at all".
 *
 * STILL GUARDED, for the reason the doc above gives: `bindOutAndBackDetection`
 * and `bindGpsDetection` both end with an initial detection call, so an ordinary
 * `rerenderSection3` re-runs detection with the gates unmoved. That pass
 * re-derives an identical list, matches, and must leave a valid panel alone.
 */
function invalidateVePanelIfDetectionChanged(
	before: string[],
	after: string[],
): void {
	const { appState } = getDependencies();
	if (!gpsPanelIsAnalyzed(appState)) return;
	if (sameDetection(before, after)) return;
	tearDownVeAnalysisPanel(appState);
}

/**
 * Did a re-detection produce the same cut of the ride?
 *
 * ORDER-SENSITIVE, unlike `sameItems`: both detectors walk the ride and emit in
 * ride order, so position carries meaning here and two lists that agree as sets
 * but not in order describe different cuts.
 */
function sameDetection(before: string[], after: string[]): boolean {
	return (
		before.length === after.length &&
		before.every((cut, index) => cut === after[index])
	);
}

/**
 * A DETECTED ITEM WAS TICKED OR UNTICKED — recompute the panel over the new
 * subset instead of throwing it away.
 *
 * These checkboxes are not the detection. Unticking one of six detected GPS
 * laps leaves the cut of the ride exactly where it was and asks a narrower
 * question of the same data, so tearing the panel down and making the user press
 * Analyze again is more destructive than the change warrants (maintainer,
 * 2026-09-01). A gate move or a wider FIT window is the opposite case and still
 * tears down, through `invalidateVePanelIfDetectionChanged`.
 *
 * THIS IS THE DELIBERATE REVERSAL OF A DELIBERATE CHOICE, so it is worth saying
 * which. `activeOutAndBackSections.ts` prefers the ON-SCREEN list over the
 * selection precisely so that a checkbox toggle could not SILENTLY change what
 * the next slider drag computed. That reasoning stands and the seam is
 * unchanged: the on-screen list is still authoritative, and the toggle now
 * MOVES it and asks for a recompute in the same breath, rather than moving it
 * behind the panel's back.
 *
 * `currentAnalyzedLaps` is untouched, which is the WR-01 rule and not an
 * oversight: it is the key the saved CdA/Crr and trim live under, it belongs to
 * the analyze that produced them, and a narrowed VIEW must not re-key them.
 * Coverage moves instead — `summarize` rewrites `currentCoveredItems` from the
 * profiles that survive this pass, so Store Result and the CSV stay truthful.
 *
 * Emptying the selection is not a narrower question, it is no question: there
 * is nothing to compute and the panel goes.
 */
function recomputePanelForSelection(
	appState: AppState,
	applySelection: () => boolean,
): void {
	if (!gpsPanelIsAnalyzed(appState)) return;
	if (!applySelection()) {
		tearDownVeAnalysisPanel(appState);
		return;
	}
	requestModeUpdate("segmentSelection");
}

/**
 * Is a GPS-mode VE panel on screen, i.e. is there anything to invalidate?
 *
 * Both fields are written at render — `currentOutAndBackSections` by
 * `showOutAndBackVEAnalysis` (`renderOutAndBack.ts:101`),
 * `currentGpsLapIndexRanges` by `gpsLapMode.syncState` (`gpsLapMode.ts:70`) —
 * and both are cleared by `tearDownVeAnalysisPanel`, so this is false exactly
 * when there is no panel. Only one is ever populated; asking about both saves
 * the caller having to know which mode is live.
 *
 * NOT `currentCoveredItems`, which `resolveMultiSegmentAnalysisParams` nulls and
 * only `summarize` refills: a re-detection landing between Analyze and the first
 * recompute would find no analysed basis at all and return early.
 */
function gpsPanelIsAnalyzed(appState: AppState): boolean {
	return (
		appState.currentOutAndBackSections.length > 0 ||
		(appState.currentGpsLapIndexRanges?.length ?? 0) > 0
	);
}

/** One out-and-back section, keyed on both of its legs. */
function outAndBackCut(section: OutAndBackSection): string {
	return (
		`${section.outboundStartIdx}:${section.outboundEndIdx}:` +
		`${section.inboundStartIdx}:${section.inboundEndIdx}`
	);
}

/** One GPS lap, or one already-analysed lap range. */
function lapRangeCut(range: { startIdx: number; endIdx: number }): string {
	return `${range.startIdx}:${range.endIdx}`;
}

/**
 * Return Section 3 and the VE panel to their pre-analysis state, because a
 * DIFFERENT activity has just been loaded.
 *
 * `setLoadedActivity` (`AppState.ts:314`) swaps `currentFitData`,
 * `currentFitResult` and `currentLaps` and stops there. Everything the user had
 * SELECTED survived that swap, and `renderSection3Template` re-ticks from
 * `selectedLaps`, so laps chosen for the previous ride came back checked
 * against the new one and Analyze ran on them with no further gesture.
 *
 * `currentAnalyzedLaps` survived too, which is the half that does not show up
 * as a wrong tick: `invalidateVePanelIfBasisChanged` compares the carried-over
 * selection against the carried-over analyzed set, finds them equal, and leaves
 * the previous file's VE panel on screen over the new file's data.
 *
 * NOT ROUTED THROUGH `setGpsAnalysisMode("None")`, which is the obvious way to
 * write this and is wrong. Every branch of that function is gated on
 * `previousMode !== mode`, so asking for a mode already selected does nothing —
 * and "already None" is plain Standard mode, the most common case and the one
 * that was reported. The mode variable is moved directly here, and the
 * `<select>` is put back in step with it.
 *
 * CALL THIS BEFORE SECTION 3 IS RE-RENDERED for the new activity
 * (`displayResults`), or the template re-ticks the old laps from the state this
 * clears.
 */
export function resetAnalysisForNewActivity(): void {
	const deps = getDependencies();
	const { appState } = deps;

	// The three selections, one per mode family.
	// A file with exactly ONE lap has no choice to make, so do not charge the
	// user a click for it. Every other count starts empty, as before.
	appState.selectedLaps = appState.currentLaps.length === 1 ? [1] : [];
	appState.gpsSelectedLaps = [];
	appState.outAndBackSelectedSections = [];
	appState.currentOutAndBackSections = [];

	// AND THE STATE DERIVED FROM THEM, which is the half that was missed.
	// Clearing a selection while leaving its derived data behind does not
	// produce a clean slate — it produces an INCONSISTENT one, and the
	// inconsistency is load-bearing: `calculateAutoRho`'s early return is
	// `if (!appState.filteredLapData)`, so a surviving value from the previous
	// file carried the load-path call (`fileLoadOrchestration.ts:398`) past its
	// own guard and into trim sliders that had just been re-rendered for the new
	// activity. With `start === end` the metadata call throws and the user gets
	// "Auto-rho calculation failed. Using manual value." on every file switch,
	// and never on the first load — where this field is still null.
	appState.filteredLapData = null;
	appState.filteredVEData = null;

	// Sample INDICES into the selection that has just gone. Carried onto a new
	// activity they point at nothing in particular.
	appState.presetTrimStart = 0;
	appState.presetTrimEnd = null;

	// The detections those selections indexed into. All are derived from the
	// activity that has just been replaced.
	appState.gpsDetectedLaps = [];
	appState.gpsLapDetectionResult = null;
	appState.outAndBackSections = [];
	appState.outAndBackResult = null;

	const mapVisualization = deps.getMapVisualization();
	mapVisualization?.clearDetectedLaps();
	mapVisualization?.clearGpsMarker();
	mapVisualization?.clearOutAndBackMarkers();

	currentGpsAnalysisMode = "None";
	const modeSelect = document.getElementById(
		"gpsAnalysisMode",
	) as HTMLSelectElement | null;
	if (modeSelect) modeSelect.value = "None";

	// Unconditionally, unlike the mode-change and selection-change callers: a new
	// activity invalidates the panel whatever the old basis was, and there is no
	// "unchanged" case to spare.
	tearDownVeAnalysisPanel(appState);
}

/**
 * Re-render Section 3 with updated GPS mode visibility.
 * Called after mode changes to show/hide GPS detection panels.
 */
function rerenderSection3(): void {
	const deps = getDependencies();
	const analysisSection = document.getElementById("analysisSection");
	const fitData = deps.appState.currentFitData;
	const laps = deps.appState.currentLaps;
	if (!analysisSection || !fitData || !laps.length) return;

	const hasGpsData =
		deps.appState.currentFitResult?.parsing_statistics?.has_gps_data ?? false;
	const gpsMode = getGpsAnalysisMode();
	const showGpsLapDetection = hasGpsData && isGpsLapSelectionMode(gpsMode);
	const showOutAndBack = hasGpsData && gpsMode === "GPS based out and back";

	// Generate updated Section 3 HTML
	const analysisHtml = renderSection3Template({
		laps,
		selectedLaps: deps.appState.selectedLaps,
		hasGpsData,
		showGpsLapDetection,
		showOutAndBack,
		gpsAnalysisMode: gpsMode,
		formatDuration,
		formatDistance,
		formatPower,
	});

	const resultsDiv = analysisSection.querySelector("#results");
	if (resultsDiv) {
		resultsDiv.innerHTML = analysisHtml;
		resultsDiv.classList.remove("hidden");
	}

	// Re-setup handlers after re-render.
	//
	// Section 3's own controls are restored FIRST and in their own try, before any
	// of the fallible map work. They used to sit at the tail of a single try that
	// began by tearing down and re-awaiting a Leaflet map against DOM that had just
	// been replaced underneath it; any throw there aborted the whole hook and left
	// Section 3 inert -- the mode dropdown unbound, the Analyze button stuck at the
	// template's hard-coded `disabled`, and the trim sliders stuck at the
	// template's hard-coded `hidden`. Nothing about re-binding a checkbox handler
	// depends on the map succeeding, so nothing about it should be sequenced behind
	// the map.
	setTimeout(async () => {
		// BEFORE `restoreSection3Controls`, not after, because that function ENDS
		// IN `updateSelectedLaps()` (`:652`) and `updateSelectedLaps` now fires
		// the redetect closure. Cleared one line too late, a mode switch ran the
		// PREVIOUS mode's closure: leaving out-and-back for GPS-lap re-ran
		// `updateGates()` against detached `#oabGate*` sliders, repopulating the
		// very arrays `setGpsAnalysisMode` had just cleared, redrawing A/B markers
		// on a map about to be destroyed, and persisting gate offsets for a mode
		// the user had left. The binders below re-publish it a few lines later,
		// and each runs its own initial detection, so nothing is lost by clearing
		// first.
		clearGpsRedetect();
		restoreSection3Controls(hasGpsData);

		try {
			// Setup map visualization if GPS data available
			if (hasGpsData) {
				const mapViz = deps.getMapVisualization();
				if (mapViz) {
					// Destroy old map and reinitialize to handle DOM reconstruction
					mapViz.destroy();
					const mapVisualization = new MapVisualization("mapView");
					await mapVisualization.initialize();
					mapVisualization.setData(fitData, laps);
					mapVisualization.setSelectedLaps(deps.appState.selectedLaps);
					deps.setMapVisualization(mapVisualization);

					// Setup GPS lap detection if enabled
					if (showGpsLapDetection) {
						void bindGpsDetection(
							deps.appState,
							deps.parameterStorage,
							mapVisualization,
							{
								getSelectedDataTimeRange,
								findDataIndexAtTimeOffset,
								runGpsLapDetection,
								registerRedetect: setGpsRedetect,
							},
						);
					}

					// Setup Out and Back detection if enabled
					if (showOutAndBack) {
						void bindOutAndBackDetection(
							deps.appState,
							deps.parameterStorage,
							mapVisualization,
							{
								getSelectedDataTimeRange,
								findDataIndexAtTimeOffset,
								runOutAndBackDetection,
								registerRedetect: setGpsRedetect,
							},
						);
					}
				} else {
					// Map not yet initialized, initialize it
					const mapVisualization = new MapVisualization("mapView");
					await mapVisualization.initialize();
					mapVisualization.setData(fitData, laps);
					mapVisualization.setSelectedLaps(deps.appState.selectedLaps);
					deps.setMapVisualization(mapVisualization);

					if (showGpsLapDetection) {
						void bindGpsDetection(
							deps.appState,
							deps.parameterStorage,
							mapVisualization,
							{
								getSelectedDataTimeRange,
								findDataIndexAtTimeOffset,
								runGpsLapDetection,
								registerRedetect: setGpsRedetect,
							},
						);
					}

					if (showOutAndBack) {
						void bindOutAndBackDetection(
							deps.appState,
							deps.parameterStorage,
							mapVisualization,
							{
								getSelectedDataTimeRange,
								findDataIndexAtTimeOffset,
								runOutAndBackDetection,
								registerRedetect: setGpsRedetect,
							},
						);
					}
				}
			}

		} catch (error) {
			log.error("Error re-initializing the section 3 map:", error);
		}
	}, 100);
}

/**
 * Re-bind everything Section 3 owns after its DOM has been replaced.
 *
 * `renderSection3Template` emits the Analyze button hard-coded `disabled` and the
 * map trim controls hard-coded `hidden`, while re-rendering the FIT lap
 * checkboxes *checked* from `appState.selectedLaps`. So a re-render always leaves
 * the markup disagreeing with the retained selection, and only
 * `updateSelectedLaps()` reconciles the two: it re-derives the selection from the
 * checkboxes, shows and initialises the trim controls when the mode allows them,
 * and re-evaluates the Analyze button. That is precisely what the user's
 * deselect-and-reselect workaround was triggering by hand.
 *
 * Deliberately free of any map dependency and wrapped in its own try, so a
 * failure in the map teardown/re-init cannot take Section 3's controls with it.
 */
function restoreSection3Controls(hasGpsData: boolean): void {
	const deps = getDependencies();

	try {
		// The mode dropdown first: losing it means the user cannot even switch back.
		if (hasGpsData) {
			bindGpsModeSelector();
		}

		const lapListEl = document.getElementById("lapList");
		if (lapListEl) {
			bindLapSelection(lapListEl, () => updateSelectedLaps());
			bindSelectAllButton("selectAllLaps", "lapList", () =>
				updateSelectedLaps(),
			);
		}
		deps.setupAnalyzeButton();
		updateSelectedLaps();
	} catch (error) {
		log.error("Error re-binding section 3 controls:", error);
	}
}

interface Section3Dependencies {
	appState: AppState;
	parameterStorage: ParameterStorage;
	getMapVisualization: () => MapVisualization | null;
	setMapVisualization: (map: MapVisualization | null) => void;
	getParametersComponent: () => AnalysisParametersComponent | null;
	updateAnalyzeButton: () => void;
	setupAnalyzeButton: () => void;
	showLoading: (message: string) => void;
	hideLoading: () => void;
	showError: (message: string) => void;
}

let dependencies: Section3Dependencies | null = null;

function getDependencies(): Section3Dependencies {
	if (!dependencies) {
		throw new Error("Section 3 orchestration is not configured");
	}
	return dependencies;
}

function getServices(deps: Section3Dependencies) {
	return {
		appState: deps.appState,
		showLoading: deps.showLoading,
		hideLoading: deps.hideLoading,
		showError: deps.showError,
	};
}

export function configureSection3Orchestration(
	nextDependencies: Section3Dependencies,
): void {
	dependencies = nextDependencies;
}

export function isGpsLapSelectionMode(
	lapDetectionMode: string | null | undefined,
): boolean {
	return (
		lapDetectionMode === "GPS based lap splitting" ||
		lapDetectionMode === "GPS gate one way"
	);
}

/**
 * Get the time range of currently selected data (from selected FIT laps)
 */
export function getSelectedDataTimeRange(): {
	startTime: number;
	endTime: number;
	duration: number;
} {
	const deps = getDependencies();

	if (!deps.appState.currentFitData) {
		return { startTime: 0, endTime: 0, duration: 0 };
	}

	const timestamps = Array.from(
		deps.appState.currentFitData.timestamps,
	) as number[];

	if (
		deps.appState.selectedLaps.length === 0 ||
		deps.appState.currentLaps.length === 0
	) {
		// No laps selected, use full data range
		const startTime = timestamps[0] || 0;
		const endTime = timestamps[timestamps.length - 1] || 0;
		return { startTime, endTime, duration: endTime - startTime };
	}

	// Get time range from selected FIT laps
	const selectedLapData = deps.appState.selectedLaps
		.map((lapNumber) => deps.appState.currentLaps[lapNumber - 1])
		.filter(Boolean);
	if (selectedLapData.length === 0) {
		const startTime = timestamps[0] || 0;
		const endTime = timestamps[timestamps.length - 1] || 0;
		return { startTime, endTime, duration: endTime - startTime };
	}

	const startTime = Math.min(...selectedLapData.map((lap) => lap.start_time));
	const endTime = Math.max(...selectedLapData.map((lap) => lap.end_time));

	return { startTime, endTime, duration: endTime - startTime };
}

/**
 * Find the data index at a given time offset from start
 */
export function findDataIndexAtTimeOffset(
	timeOffset: number,
	startTime: number,
): number | null {
	const deps = getDependencies();

	if (!deps.appState.currentFitData) return null;

	const timestamps = Array.from(
		deps.appState.currentFitData.timestamps,
	) as number[];
	const targetTime = startTime + timeOffset;

	// Find the index with timestamp closest to targetTime
	let closestIndex = 0;
	let closestDiff = Math.abs(timestamps[0] - targetTime);

	for (let i = 1; i < timestamps.length; i++) {
		const diff = Math.abs(timestamps[i] - targetTime);
		if (diff < closestDiff) {
			closestDiff = diff;
			closestIndex = i;
		}
	}

	return closestIndex;
}

/**
 * Run GPS lap detection algorithm
 */
export async function runGpsLapDetection(
	markerLat: number,
	markerLon: number,
	_markerIndex: number,
): Promise<void> {
	const deps = getDependencies();

	if (!deps.appState.currentFitData) return;

	// Detection is scoped to the selected FIT laps. With no selection there is
	// no scope to detect within, so bail out rather than fall back to the whole
	// activity (which would detect laps the user never asked for).
	if (
		deps.appState.selectedLaps.length === 0 ||
		deps.appState.currentLaps.length === 0
	) {
		log.debug("Skipping GPS lap detection: no FIT laps selected");
		return;
	}

	// Calculate trim indices from selected FIT laps' time ranges
	let trimStart = 0;
	let trimEnd = deps.appState.currentFitData.timestamps.length - 1;

	if (
		deps.appState.selectedLaps.length > 0 &&
		deps.appState.currentLaps.length > 0
	) {
		// Get time ranges for selected FIT laps
		const selectedLapData = deps.appState.selectedLaps.map(
			(lapNumber) => deps.appState.currentLaps[lapNumber - 1],
		);
		const allTimestamps = Array.from(
			deps.appState.currentFitData.timestamps,
		) as number[];

		// Find the data indices that fall within the selected FIT laps' time ranges
		const indicesInSelectedLaps: number[] = [];
		for (let i = 0; i < allTimestamps.length; i++) {
			const timestamp = allTimestamps[i];
			const isInSelectedLap = selectedLapData.some(
				(lap) => timestamp >= lap.start_time && timestamp <= lap.end_time,
			);
			if (isInSelectedLap) {
				indicesInSelectedLaps.push(i);
			}
		}

		if (indicesInSelectedLaps.length > 0) {
			trimStart = indicesInSelectedLaps[0];
			trimEnd = indicesInSelectedLaps[indicesInSelectedLaps.length - 1];
			log.debug(
				`GPS lap detection trim region: ${trimStart} to ${trimEnd} (${indicesInSelectedLaps.length} points from ${deps.appState.selectedLaps.length} FIT laps)`,
			);
		}
	}

	// Get detection mode from Section 3 GPS mode state (not None since we're running detection)
	const detectionMode = getGpsAnalysisMode();
	const mode =
		detectionMode && detectionMode !== "None"
			? detectionMode
			: "GPS based lap splitting";

	const config: GpsLapDetectionConfig = {
		markerLat,
		markerLon,
		trimStart,
		trimEnd,
		...getDefaultLapDetectionConfig(),
		mode,
	};

	const detector = new GpsLapDetector(
		Array.from(deps.appState.currentFitData.position_lat),
		Array.from(deps.appState.currentFitData.position_long),
		Array.from(deps.appState.currentFitData.timestamps),
		Array.from(deps.appState.currentFitData.distance),
		config,
	);

	// Captured BEFORE the overwrite: the guard at the foot of this function
	// compares the detection the panel was built against with the one just
	// produced, so the previous list has to be read while it is still there.
	const detectionBefore = deps.appState.gpsDetectedLaps.map(lapRangeCut);

	deps.appState.gpsLapDetectionResult = detector.detectLaps();
	deps.appState.gpsDetectedLaps =
		deps.appState.gpsLapDetectionResult.detectedLaps;

	log.debug(
		`Detected ${deps.appState.gpsDetectedLaps.length} laps:`,
		deps.appState.gpsDetectedLaps,
	);

	// Show detected laps on map
	const mapVisualization = deps.getMapVisualization();
	if (mapVisualization && deps.appState.gpsLapDetectionResult) {
		mapVisualization.showDetectedLaps(
			deps.appState.gpsLapDetectionResult.detectedLaps,
			deps.appState.gpsLapDetectionResult.passings,
		);
	}

	const detectionAfter = deps.appState.gpsDetectedLaps.map(lapRangeCut);

	// AUTO-SELECT ALL, BUT ONLY WHEN THE DETECTION ACTUALLY MOVED.
	//
	// Resetting the selection unconditionally was harmless while every selection
	// change tore the panel down. It is not now that a checkbox NARROWS the panel
	// instead: untick lap 5 of 5, then tick a FIT lap that adds no gate passing,
	// and the re-detection reproduces the identical list — so the panel rightly
	// survives at four laps while the checkboxes silently go back to five. Every
	// later slider drag then computes four laps and Store Result reports four
	// while the sidebar claims five, with no gesture that resyncs them.
	//
	// When the detection DID move, the panel is being torn down two lines below,
	// so there is nothing left for the selection to contradict and all-selected
	// is the right fresh start.
	if (!sameDetection(detectionBefore, detectionAfter)) {
		deps.appState.gpsSelectedLaps = deps.appState.gpsDetectedLaps.map(
			(lap) => lap.lapNumber,
		);
	}

	// AFTER the selection is settled: the list renders each checkbox from it.
	updateGpsDetectedLapsUI();

	// The out-and-back twin, and for the identical reason: moving the gate — or
	// widening the FIT window this detection is scoped to — re-cuts the ride, and
	// a panel built on the previous cut is describing laps that are no longer the
	// laps under those numbers. Compared on the RANGES, because the numbers are
	// the detector's own 1..N and compare equal to themselves.
	invalidateVePanelIfDetectionChanged(detectionBefore, detectionAfter);

	deps.updateAnalyzeButton();
}

/**
 * Update the GPS detected laps UI list
 */
export function updateGpsDetectedLapsUI(): void {
	const deps = getDependencies();

	const lapsInfo = document.getElementById("gpsDetectedLapsInfo");
	const lapCountSpan = document.getElementById("gpsLapCount");
	const lapList = document.getElementById("gpsLapList");

	if (!lapsInfo || !lapCountSpan || !lapList) return;

	if (deps.appState.gpsDetectedLaps.length === 0) {
		lapsInfo.classList.add("hidden");
		return;
	}

	lapsInfo.classList.remove("hidden");
	lapCountSpan.textContent = deps.appState.gpsDetectedLaps.length.toString();

	// FROM THE SELECTION, not hardcoded `checked`. A re-detection that did not
	// move the cut leaves a narrowed selection in place (see
	// `runGpsLapDetection`), and a list that always renders every box ticked
	// would then contradict both the selection and the panel.
	const selected = deps.appState.gpsSelectedLaps;

	// Populate lap list
	lapList.innerHTML = deps.appState.gpsDetectedLaps
		.map(
			(lap) => `
        <div class="lap-checkbox-item${selected.includes(lap.lapNumber) ? " lap-checkbox-item--selected" : ""}" data-gps-lap="${lap.lapNumber}">
            <input type="checkbox" class="gps-lap-checkbox" id="gps-lap-${lap.lapNumber}"${selected.includes(lap.lapNumber) ? " checked" : ""}>
            <div class="lap-info">
                <div class="lap-number">Lap ${lap.lapNumber}</div>
                <div class="lap-details">
                    ${formatLapDuration(lap.duration)} •
                    ${formatLapDistance(lap.distance)} •
                    ${lap.directionName}
                </div>
            </div>
        </div>
    `,
		)
		.join("");

	// Setup event handlers for GPS lap checkboxes
	lapList.querySelectorAll(".gps-lap-checkbox").forEach((checkbox) => {
		checkbox.addEventListener("change", handleGpsLapSelectionChange);
	});

	// Setup click handlers for lap items
	lapList.querySelectorAll(".lap-checkbox-item").forEach((item) => {
		item.addEventListener("click", (event) => {
			const target = event.target as Element;
			if (!target.classList.contains("gps-lap-checkbox")) {
				const checkbox = item.querySelector(
					".gps-lap-checkbox",
				) as HTMLInputElement;
				if (checkbox) {
					checkbox.checked = !checkbox.checked;
					handleGpsLapSelectionChange();
				}
			}
		});
	});
}

/**
 * Handle GPS lap selection checkbox changes
 */
export function handleGpsLapSelectionChange(): void {
	const deps = getDependencies();

	const checkboxes = document.querySelectorAll(
		".gps-lap-checkbox:checked",
	) as NodeListOf<HTMLInputElement>;
	deps.appState.gpsSelectedLaps = Array.from(checkboxes)
		.map((cb) => {
			const item = cb.closest(".lap-checkbox-item");
			return item ? parseInt(item.getAttribute("data-gps-lap") || "0") : 0;
		})
		.filter((lap) => lap > 0);

	// The panel follows the selection rather than dying with it: see
	// `recomputePanelForSelection`.
	recomputePanelForSelection(deps.appState, () => {
		const selected = deps.appState.gpsDetectedLaps.filter((lap) =>
			deps.appState.gpsSelectedLaps.includes(lap.lapNumber),
		);
		if (selected.length === 0) return false;
		deps.appState.currentGpsLapIndexRanges = selected.map((lap) => ({
			startIdx: lap.startIdx,
			endIdx: lap.endIdx,
		}));
		// IN LOCKSTEP. `gpsLapNumberAt` (`gpsLapMode.ts:17`) indexes this by the
		// RANGE ordinal, so a ranges list that moved without it would label every
		// lap after the removed one with its neighbour's number.
		deps.appState.currentOverlayLapNumbers = selected.map(
			(lap) => lap.lapNumber,
		);
		return true;
	});

	// Update visual selection state
	document
		.querySelectorAll(".lap-checkbox-item[data-gps-lap]")
		.forEach((item) => {
			const checkbox = item.querySelector(
				".gps-lap-checkbox",
			) as HTMLInputElement;
			if (checkbox?.checked) {
				item.classList.add("lap-checkbox-item--selected");
			} else {
				item.classList.remove("lap-checkbox-item--selected");
			}
		});

	log.debug("GPS selected laps:", deps.appState.gpsSelectedLaps);
	deps.updateAnalyzeButton();
}

/**
 * Run Out and Back detection algorithm
 */
export async function runOutAndBackDetection(
	markerALat: number,
	markerALon: number,
	markerBLat: number,
	markerBLon: number,
): Promise<void> {
	const deps = getDependencies();

	if (!deps.appState.currentFitData) return;

	// Detection is scoped to the selected FIT laps. With no selection there
	// is no scope to detect within, so bail out rather than fall back to the
	// whole activity (which would detect sections the user never asked for).
	if (
		deps.appState.selectedLaps.length === 0 ||
		deps.appState.currentLaps.length === 0
	) {
		log.debug("Skipping Out and Back detection: no FIT laps selected");
		return;
	}

	// Calculate trim indices from selected FIT laps' time ranges
	let trimStart = 0;
	let trimEnd = deps.appState.currentFitData.timestamps.length - 1;

	if (
		deps.appState.selectedLaps.length > 0 &&
		deps.appState.currentLaps.length > 0
	) {
		const selectedLapData = deps.appState.selectedLaps.map(
			(lapNumber) => deps.appState.currentLaps[lapNumber - 1],
		);
		const allTimestamps = Array.from(
			deps.appState.currentFitData.timestamps,
		) as number[];

		const indicesInSelectedLaps: number[] = [];
		for (let i = 0; i < allTimestamps.length; i++) {
			const timestamp = allTimestamps[i];
			const isInSelectedLap = selectedLapData.some(
				(lap) => timestamp >= lap.start_time && timestamp <= lap.end_time,
			);
			if (isInSelectedLap) {
				indicesInSelectedLaps.push(i);
			}
		}

		if (indicesInSelectedLaps.length > 0) {
			trimStart = indicesInSelectedLaps[0];
			trimEnd = indicesInSelectedLaps[indicesInSelectedLaps.length - 1];
			log.debug(`Out and Back trim region: ${trimStart} to ${trimEnd}`);
		}
	}

	const config: OutAndBackConfig = {
		markerALat,
		markerALon,
		markerBLat,
		markerBLon,
		trimStart,
		trimEnd,
		...DEFAULT_OUT_AND_BACK_CONFIG,
	};

	const detector = new OutAndBackDetector(
		Array.from(deps.appState.currentFitData.position_lat),
		Array.from(deps.appState.currentFitData.position_long),
		Array.from(deps.appState.currentFitData.timestamps),
		Array.from(deps.appState.currentFitData.distance),
		config,
	);

	// Captured BEFORE the overwrite, as in `runGpsLapDetection`.
	const detectionBefore = deps.appState.outAndBackSections.map(outAndBackCut);

	deps.appState.outAndBackResult = detector.detectSections();
	deps.appState.outAndBackSections =
		deps.appState.outAndBackResult.detectedSections;

	log.debug(
		`Detected ${deps.appState.outAndBackSections.length} out-and-back sections:`,
		deps.appState.outAndBackSections,
	);

	// Show detected sections on map
	const mapVisualization = deps.getMapVisualization();
	if (mapVisualization && deps.appState.outAndBackResult) {
		mapVisualization.showOutAndBackSections(
			deps.appState.outAndBackResult.detectedSections,
			deps.appState.outAndBackResult.passingsA,
			deps.appState.outAndBackResult.passingsB,
		);
	}

	const detectionAfter = deps.appState.outAndBackSections.map(outAndBackCut);

	// Auto-select all sections, but only when the detection moved — see the
	// GPS-lap twin in `runGpsLapDetection` for why the unconditional reset
	// contradicts a narrowed panel.
	if (!sameDetection(detectionBefore, detectionAfter)) {
		deps.appState.outAndBackSelectedSections =
			deps.appState.outAndBackSections.map((s) => s.sectionNumber);
	}

	// AFTER the selection is settled: the list renders each checkbox from it.
	updateOutAndBackSectionsUI();

	// Moving a gate re-cuts the ride into different sections, so a panel
	// analyzed from the previous cut describes segments that no longer exist —
	// the same invalidation as ticking the section boxes, by a blunter route.
	// Compared on the RANGES, not the section numbers: see the helper.
	invalidateVePanelIfDetectionChanged(detectionBefore, detectionAfter);

	deps.updateAnalyzeButton();
}

/**
 * Update the Out and Back sections UI list
 */
export function updateOutAndBackSectionsUI(): void {
	const deps = getDependencies();

	const sectionsInfo = document.getElementById("outAndBackSectionsInfo");
	const sectionCountSpan = document.getElementById("outAndBackSectionCount");
	const sectionList = document.getElementById("outAndBackSectionList");

	if (!sectionsInfo || !sectionCountSpan || !sectionList) return;

	if (deps.appState.outAndBackSections.length === 0) {
		sectionsInfo.classList.add("hidden");
		return;
	}

	sectionsInfo.classList.remove("hidden");
	sectionCountSpan.textContent =
		deps.appState.outAndBackSections.length.toString();

	// From the selection, like the GPS-lap list above.
	const selected = deps.appState.outAndBackSelectedSections;

	// Populate section list
	sectionList.innerHTML = deps.appState.outAndBackSections
		.map(
			(section) => `
        <div class="lap-checkbox-item${selected.includes(section.sectionNumber) ? " lap-checkbox-item--selected" : ""}" data-oab-section="${section.sectionNumber}">
            <input type="checkbox" class="oab-section-checkbox" id="oab-section-${section.sectionNumber}"${selected.includes(section.sectionNumber) ? " checked" : ""}>
            <div class="lap-info">
                <div class="lap-number">Section ${section.sectionNumber}</div>
                <div class="lap-details">
                    Out: ${formatLapDuration(section.outboundDuration)} •
                    Back: ${formatLapDuration(section.inboundDuration)} •
                    ${formatLapDistance(section.totalDistance)}
                </div>
            </div>
        </div>
    `,
		)
		.join("");

	// Setup event handlers for section checkboxes
	sectionList.querySelectorAll(".oab-section-checkbox").forEach((checkbox) => {
		checkbox.addEventListener("change", handleOutAndBackSectionSelectionChange);
	});

	// Setup click handlers for section items
	sectionList.querySelectorAll(".lap-checkbox-item").forEach((item) => {
		item.addEventListener("click", (event) => {
			const target = event.target as Element;
			if (!target.classList.contains("oab-section-checkbox")) {
				const checkbox = item.querySelector(
					".oab-section-checkbox",
				) as HTMLInputElement;
				if (checkbox) {
					checkbox.checked = !checkbox.checked;
					handleOutAndBackSectionSelectionChange();
				}
			}
		});
	});
}

/**
 * Handle Out and Back section selection checkbox changes
 */
export function handleOutAndBackSectionSelectionChange(): void {
	const deps = getDependencies();

	const checkboxes = document.querySelectorAll(
		".oab-section-checkbox:checked",
	) as NodeListOf<HTMLInputElement>;
	deps.appState.outAndBackSelectedSections = Array.from(checkboxes)
		.map((cb) => {
			const item = cb.closest(".lap-checkbox-item");
			return item ? parseInt(item.getAttribute("data-oab-section") || "0") : 0;
		})
		.filter((section) => section > 0);

	// The GPS-lap twin, and the same rule: a section checkbox narrows the
	// question, it does not re-cut the ride. See `recomputePanelForSelection`.
	recomputePanelForSelection(deps.appState, () => {
		const selected = deps.appState.outAndBackSections.filter((section) =>
			deps.appState.outAndBackSelectedSections.includes(section.sectionNumber),
		);
		if (selected.length === 0) return false;
		// Sections carry their own `sectionNumber`, so unlike GPS-lap there is no
		// parallel numbering array to keep aligned.
		deps.appState.currentOutAndBackSections = selected;
		return true;
	});

	// Update visual selection state
	document
		.querySelectorAll(".lap-checkbox-item[data-oab-section]")
		.forEach((item) => {
			const checkbox = item.querySelector(
				".oab-section-checkbox",
			) as HTMLInputElement;
			if (checkbox?.checked) {
				item.classList.add("lap-checkbox-item--selected");
			} else {
				item.classList.remove("lap-checkbox-item--selected");
			}
		});

	log.debug(
		"Out and Back selected sections:",
		deps.appState.outAndBackSelectedSections,
	);
	deps.updateAnalyzeButton();
}

export function initializeMapTrimControls(dataLength: number): void {
	const mapTrimStartSlider = document.getElementById(
		"mapTrimStartSlider",
	) as HTMLInputElement;
	const mapTrimEndSlider = document.getElementById(
		"mapTrimEndSlider",
	) as HTMLInputElement;
	const mapTrimStartValue = document.getElementById(
		"mapTrimStartValue",
	) as HTMLInputElement;
	const mapTrimEndValue = document.getElementById(
		"mapTrimEndValue",
	) as HTMLInputElement;

	if (
		!mapTrimStartSlider ||
		!mapTrimEndSlider ||
		!mapTrimStartValue ||
		!mapTrimEndValue
	)
		return;

	// Set initial ranges based on actual lap data
	mapTrimStartSlider.min = "0";
	mapTrimStartSlider.max = (dataLength - MIN_TRIM_WINDOW_SAMPLES).toString();
	mapTrimStartSlider.value = "0";
	mapTrimStartValue.value = "0";
	mapTrimStartValue.min = "0";
	mapTrimStartValue.max = (dataLength - MIN_TRIM_WINDOW_SAMPLES).toString();

	mapTrimEndSlider.min = MIN_TRIM_WINDOW_SAMPLES.toString();
	mapTrimEndSlider.max = (dataLength - 1).toString();
	mapTrimEndSlider.value = (dataLength - 1).toString();
	mapTrimEndValue.value = (dataLength - 1).toString();
	mapTrimEndValue.min = MIN_TRIM_WINDOW_SAMPLES.toString();
	mapTrimEndValue.max = (dataLength - 1).toString();
}

export function updateSelectedLaps(): void {
	const deps = getDependencies();

	const checkboxes = document.querySelectorAll(
		".lap-checkbox:checked",
	) as NodeListOf<HTMLInputElement>;
	deps.appState.selectedLaps = Array.from(checkboxes)
		.map((cb) => {
			const item = cb.closest(".lap-checkbox-item");
			return item ? parseInt(item.getAttribute("data-lap") || "0") : 0;
		})
		.filter((lap) => lap > 0);

	const lapDetectionMode = getGpsAnalysisMode();

	// ONLY IN THE FIT-LAP MODES, because only there do the two lists being
	// compared mean the same thing. `currentAnalyzedLaps` holds FIT lap numbers
	// under Standard, but GPS VIRTUAL LAP numbers under GPS-lap splitting
	// (`renderGpsLap.ts:103`) and SECTION numbers under out-and-back
	// (`renderOutAndBack.ts:94`) — all three written by
	// `resolveMultiSegmentAnalysisParams` (`MultiSegmentSettings.ts:84`), and
	// all three counting 1..N, so they collide numerically with the FIT lap
	// list in `selectedLaps`. Ticking FIT lap 3 with three GPS laps analyzed
	// made `[1,2,3]` match `[1,2,3]` and skipped an invalidation that was due;
	// the mirror case tore down a perfectly valid GPS panel. The GPS modes
	// invalidate on their own basis instead — out-and-back through
	// `invalidateVePanelIfDetectionChanged`, which the FIT-lap selection
	// reaches anyway because it re-trims the detector's input.
	const isFitLapSelectionMode =
		!isGpsLapSelectionMode(lapDetectionMode) &&
		lapDetectionMode !== "GPS based out and back";

	// BEFORE the auto-rho schedule below, deliberately. Auto-rho writes
	// parameters ~500 ms later and that write reaches
	// `requestModeUpdate("parameters")`; with the panel already hidden the
	// primitive bails at its visibility gate instead of recomputing against a
	// selection the panel on screen does not belong to.
	if (isFitLapSelectionMode) {
		invalidateVePanelIfBasisChanged(
			deps.appState.currentAnalyzedLaps,
			deps.appState.selectedLaps,
		);
	}

	// Update map visualization
	const mapVisualization = deps.getMapVisualization();
	if (mapVisualization) {
		mapVisualization.setSelectedLaps(deps.appState.selectedLaps);
	}

	// AND IN THE GPS MODES, RE-DETECT. The FIT selection is the detection
	// WINDOW there, not the analysis unit: `runGpsLapDetection` and
	// `runOutAndBackDetection` both derive `trimStart`/`trimEnd` from
	// `selectedLaps`. Nothing re-ran them when it changed, so ticking a second
	// FIT lap left the detected-lap count and the panel on the old window until
	// the user nudged a gate.
	//
	// The teardown falls out of the re-detection rather than being ordered
	// separately: both detectors end in `invalidateVePanelIfDetectionChanged`, so
	// a window that finds a different set of laps or sections drops the panel
	// while a re-detection that reproduces the same list leaves it up. The empty
	// selection is the one case the detectors cannot speak for — they bail before
	// detecting — so it is answered here, with the same "no basis, no panel"
	// rule.
	if (!isFitLapSelectionMode) {
		if (deps.appState.selectedLaps.length === 0) {
			if (gpsPanelIsAnalyzed(deps.appState)) {
				tearDownVeAnalysisPanel(deps.appState);
			}
			// AND THE DETECTION ITSELF. The window that produced it is gone, so
			// `updateAnalyzeButton` (`analyzeOrchestrator.ts:244-252`) must not
			// still find a selection to analyse in it — one gesture cannot mean
			// "no basis" for the panel and "the whole previous window" for
			// Analyze. Both GPS mode families, because this branch covers both.
			// The A/B gate markers stay: the gates are the user's placement and
			// survive a window change by design. Only the DETECTION derived from
			// the window is stale.
			deps.appState.gpsDetectedLaps = [];
			deps.appState.gpsSelectedLaps = [];
			deps.appState.gpsLapDetectionResult = null;
			deps.appState.outAndBackSections = [];
			deps.appState.outAndBackSelectedSections = [];
			deps.appState.outAndBackResult = null;
			deps.getMapVisualization()?.clearDetectedLaps();
			updateGpsDetectedLapsUI();
			updateOutAndBackSectionsUI();
		} else {
			redetectForFitSelection?.();
		}
	}

	const shouldShowSelectionTrimControls =
		deps.appState.selectedLaps.length > 0 && isFitLapSelectionMode;

	// Show/hide trim controls based on lap selection.
	// GPS-based splitting modes have their own selection model, so these
	// FIT-lap trim controls are misleading there and should stay hidden.
	const mapTrimControls = document.getElementById("mapTrimControls");
	if (mapTrimControls) {
		if (shouldShowSelectionTrimControls) {
			mapTrimControls.classList.remove("hidden");
			void initializeMapTrimControlsForSelectedLaps();

			if (
				deps.appState.currentParameters?.auto_calculate_rho &&
				!deps.appState.isCalculatingAutoRho
			) {
				setTimeout(() => {
					calculateAutoRho(
						deps.appState,
						deps.getParametersComponent(),
						getServices(deps),
					).catch((err) => {
						log.error("Auto-rho calculation error on lap selection:", err);
					});
				}, 500);
			}
		} else {
			mapTrimControls.classList.add("hidden");
		}
	}

	// Update analyze button in section 3
	deps.updateAnalyzeButton();
}

export async function initializeMapTrimControlsForSelectedLaps(): Promise<void> {
	const deps = getDependencies();

	if (
		!deps.appState.currentFitResult ||
		!deps.appState.currentLaps ||
		deps.appState.selectedLaps.length === 0
	) {
		return;
	}

	// Get selected lap data
	const selectedLapData = deps.appState.selectedLaps.map(
		(lapNumber) => deps.appState.currentLaps[lapNumber - 1],
	);

	// Get data from unified structure (works for both FIT and CSV)
	const fitData =
		deps.appState.currentFitData || deps.appState.currentFitResult.fit_data;
	if (!fitData) {
		log.error("No fit data available for map trim controls");
		return;
	}

	const allTimestamps = fitData.timestamps;
	const allPositionLat = fitData.position_lat;
	const allPositionLong = fitData.position_long;

	const hasGpsData =
		deps.appState.currentFitResult.parsing_statistics?.has_gps_data ?? false;

	// Get time ranges for selected laps
	const selectedLapTimeRanges = selectedLapData.map((lap) => ({
		start: lap.start_time,
		end: lap.end_time,
	}));

	// Filter GPS data for selected laps (if available)
	const filteredLapPositionLat: number[] = [];
	const filteredLapPositionLong: number[] = [];
	const filteredLapTimestamps: number[] = [];

	let dataLength = 0;

	if (hasGpsData && allPositionLat && allPositionLong) {
		for (let i = 0; i < allTimestamps.length; i++) {
			const timestamp = allTimestamps[i];
			const isInSelectedLap = selectedLapTimeRanges.some(
				(range) => timestamp >= range.start && timestamp <= range.end,
			);
			if (isInSelectedLap) {
				filteredLapPositionLat.push(allPositionLat[i]);
				filteredLapPositionLong.push(allPositionLong[i]);
				filteredLapTimestamps.push(timestamp);
			}
		}
		dataLength = filteredLapPositionLat.length;
	} else {
		// Use timestamp count instead of GPS points
		for (let i = 0; i < allTimestamps.length; i++) {
			const timestamp = allTimestamps[i];
			const isInSelectedLap = selectedLapTimeRanges.some(
				(range) => timestamp >= range.start && timestamp <= range.end,
			);
			if (isInSelectedLap) {
				filteredLapTimestamps.push(timestamp);
				dataLength++;
			}
		}
	}

	// Store filtered lap data globally for auto-rho calculation
	deps.appState.filteredLapData = {
		position_lat: filteredLapPositionLat,
		position_long: filteredLapPositionLong,
		timestamps: filteredLapTimestamps,
	};

	// Initialize the controls with correct data length
	initializeMapTrimControls(dataLength);

	// Try to load saved lap settings for this file and lap combination
	let savedSettings: LapSettings | null = null;
	if (deps.appState.currentFileHash) {
		try {
			savedSettings = await deps.parameterStorage.loadLapSettings(
				deps.appState.currentFileHash,
				deps.appState.selectedLaps,
			);
			if (savedSettings) {
				// Use saved trim values
				deps.appState.presetTrimStart = savedSettings.trimStart;
				deps.appState.presetTrimEnd = savedSettings.trimEnd;
			} else {
				// Set preset values to defaults
				deps.appState.presetTrimStart = 0;
				deps.appState.presetTrimEnd = dataLength - 1;
			}
		} catch (err) {
			log.error("Failed to load lap settings:", err);
			// Fallback to defaults
			deps.appState.presetTrimStart = 0;
			deps.appState.presetTrimEnd = dataLength - 1;
		}
	} else {
		// No file hash, use defaults
		deps.appState.presetTrimStart = 0;
		deps.appState.presetTrimEnd = dataLength - 1;
	}

	// Set up event listeners for map trim controls
	const mapTrimStartSlider = document.getElementById(
		"mapTrimStartSlider",
	) as HTMLInputElement;
	const mapTrimEndSlider = document.getElementById(
		"mapTrimEndSlider",
	) as HTMLInputElement;
	const mapTrimStartValue = document.getElementById(
		"mapTrimStartValue",
	) as HTMLInputElement;
	const mapTrimEndValue = document.getElementById(
		"mapTrimEndValue",
	) as HTMLInputElement;

	if (
		mapTrimStartSlider &&
		mapTrimEndSlider &&
		mapTrimStartValue &&
		mapTrimEndValue
	) {
		// Remove old listeners by cloning elements
		const newMapTrimStartSlider = mapTrimStartSlider.cloneNode(
			true,
		) as HTMLInputElement;
		const newMapTrimEndSlider = mapTrimEndSlider.cloneNode(
			true,
		) as HTMLInputElement;
		const newMapTrimStartValue = mapTrimStartValue.cloneNode(
			true,
		) as HTMLInputElement;
		const newMapTrimEndValue = mapTrimEndValue.cloneNode(
			true,
		) as HTMLInputElement;

		mapTrimStartSlider.parentNode?.replaceChild(
			newMapTrimStartSlider,
			mapTrimStartSlider,
		);
		mapTrimEndSlider.parentNode?.replaceChild(
			newMapTrimEndSlider,
			mapTrimEndSlider,
		);
		mapTrimStartValue.parentNode?.replaceChild(
			newMapTrimStartValue,
			mapTrimStartValue,
		);
		mapTrimEndValue.parentNode?.replaceChild(
			newMapTrimEndValue,
			mapTrimEndValue,
		);

		// Set slider values to loaded settings (or defaults)
		newMapTrimStartSlider.value = deps.appState.presetTrimStart.toString();
		newMapTrimStartValue.value = deps.appState.presetTrimStart.toString();
		newMapTrimEndSlider.value = deps.appState.presetTrimEnd.toString();
		newMapTrimEndValue.value = deps.appState.presetTrimEnd.toString();

		// Set map markers with loaded/default trim values.
		// Always refresh markers when switching laps so stale markers from a
		// previously selected lap don't remain when the new lap has no saved config.
		const mapVisualization = deps.getMapVisualization();
		if (
			mapVisualization &&
			deps.appState.presetTrimStart !== null &&
			deps.appState.presetTrimEnd !== null
		) {
			log.debug("Setting map trim markers:", {
				trimStart: deps.appState.presetTrimStart,
				trimEnd: deps.appState.presetTrimEnd,
				fromSavedSettings: !!savedSettings,
			});
			const trimStartVal = deps.appState.presetTrimStart;
			const trimEndVal = deps.appState.presetTrimEnd;
			setTimeout(() => {
				deps
					.getMapVisualization()
					?.fitBoundsToTrimRegion(
						trimStartVal,
						trimEndVal,
						filteredLapPositionLat,
						filteredLapPositionLong,
					);
			}, 100);
		}

		// Add new listeners
		newMapTrimStartSlider.addEventListener("input", () => {
			const value = parseInt(newMapTrimStartSlider.value);
			newMapTrimStartValue.value = value.toString();
			deps.appState.presetTrimStart = value;

			// Update map markers immediately (before analyze) - use filtered lap GPS data
			const currentMapVisualization = deps.getMapVisualization();
			if (currentMapVisualization) {
				const trimEnd = deps.appState.presetTrimEnd ?? dataLength - 1;
				currentMapVisualization.fitBoundsToTrimRegion(
					value,
					trimEnd,
					filteredLapPositionLat,
					filteredLapPositionLong,
				);
			}

			// Save map trim settings
			saveMapTrimSettings(deps.appState, deps.parameterStorage);
		});

		newMapTrimEndSlider.addEventListener("input", () => {
			const value = parseInt(newMapTrimEndSlider.value);
			newMapTrimEndValue.value = value.toString();
			deps.appState.presetTrimEnd = value;

			// Update map markers immediately (before analyze) - use filtered lap GPS data
			deps
				.getMapVisualization()
				?.fitBoundsToTrimRegion(
					deps.appState.presetTrimStart,
					value,
					filteredLapPositionLat,
					filteredLapPositionLong,
				);

			// Save map trim settings
			saveMapTrimSettings(deps.appState, deps.parameterStorage);
		});

		newMapTrimStartValue.addEventListener("change", () => {
			const value = parseInt(newMapTrimStartValue.value);
			if (!isNaN(value)) {
				const trimEnd = deps.appState.presetTrimEnd ?? dataLength - 1;
				const clamped = Math.max(
					0,
					Math.min(value, trimEnd - MIN_TRIM_WINDOW_SAMPLES),
				);
				newMapTrimStartSlider.value = clamped.toString();
				newMapTrimStartValue.value = clamped.toString();
				deps.appState.presetTrimStart = clamped;

				// Update map markers immediately (before analyze) - use filtered lap GPS data
				deps
					.getMapVisualization()
					?.fitBoundsToTrimRegion(
						clamped,
						trimEnd,
						filteredLapPositionLat,
						filteredLapPositionLong,
					);

				// Save map trim settings
				saveMapTrimSettings(deps.appState, deps.parameterStorage);
			}
		});

		newMapTrimEndValue.addEventListener("change", () => {
			const value = parseInt(newMapTrimEndValue.value);
			if (!isNaN(value)) {
				const clamped = Math.max(
					deps.appState.presetTrimStart + MIN_TRIM_WINDOW_SAMPLES,
					Math.min(value, dataLength - 1),
				);
				newMapTrimEndSlider.value = clamped.toString();
				newMapTrimEndValue.value = clamped.toString();
				deps.appState.presetTrimEnd = clamped;

				// Update map markers immediately (before analyze) - use filtered lap GPS data
				deps
					.getMapVisualization()
					?.fitBoundsToTrimRegion(
						deps.appState.presetTrimStart,
						clamped,
						filteredLapPositionLat,
						filteredLapPositionLong,
					);

				// Save map trim settings
				saveMapTrimSettings(deps.appState, deps.parameterStorage);
			}
		});

		// Add auto-rho trigger on map trim slider changes (debounced)
		let mapAutoRhoDebounceTimer: ReturnType<typeof setTimeout> | null = null;
		const triggerAutoRhoOnMapTrimChange = () => {
			if (mapAutoRhoDebounceTimer) {
				clearTimeout(mapAutoRhoDebounceTimer);
			}
			mapAutoRhoDebounceTimer = setTimeout(() => {
				if (
					deps.appState.currentParameters?.auto_calculate_rho &&
					!deps.appState.isCalculatingAutoRho
				) {
					calculateAutoRho(
						deps.appState,
						deps.getParametersComponent(),
						getServices(deps),
					).catch((err) => {
						log.error("Auto-rho calculation error on map trim change:", err);
					});
				}
			}, 500); // Wait 500ms after last slider change
		};

		newMapTrimStartSlider.addEventListener(
			"input",
			triggerAutoRhoOnMapTrimChange,
		);
		newMapTrimEndSlider.addEventListener(
			"input",
			triggerAutoRhoOnMapTrimChange,
		);
		newMapTrimStartValue.addEventListener(
			"change",
			triggerAutoRhoOnMapTrimChange,
		);
		newMapTrimEndValue.addEventListener(
			"change",
			triggerAutoRhoOnMapTrimChange,
		);
	}
}

// Initialize Section 3: Map Analysis & Lap Selection
export function initializeSection3(): void {
	const deps = getDependencies();

	const analysisSection = document.getElementById("analysisSection");
	const fitData = deps.appState.currentFitData;
	const laps = deps.appState.currentLaps;
	if (!analysisSection || !fitData || !laps.length) return;

	const hasGpsData =
		deps.appState.currentFitResult?.parsing_statistics?.has_gps_data ?? false;
	const gpsMode = getGpsAnalysisMode();
	const showGpsLapDetection = hasGpsData && isGpsLapSelectionMode(gpsMode);
	const showOutAndBack = hasGpsData && gpsMode === "GPS based out and back";

	// Generate Section 3 HTML using the shell template helper
	const analysisHtml = renderSection3Template({
		laps,
		selectedLaps: deps.appState.selectedLaps,
		hasGpsData,
		showGpsLapDetection,
		showOutAndBack,
		gpsAnalysisMode: gpsMode,
		formatDuration,
		formatDistance,
		formatPower,
	});

	const resultsDiv = analysisSection.querySelector("#results");
	if (resultsDiv) {
		resultsDiv.innerHTML = analysisHtml;
		resultsDiv.classList.remove("hidden");
	}

	// Initialize map visualization only if GPS data is available.
	// Controls first, map second, separate trys -- same reasoning as
	// rerenderSection3: a map failure must not leave Section 3 inert.
	setTimeout(async () => {
		// BEFORE `restoreSection3Controls`, not after, because that function ENDS
		// IN `updateSelectedLaps()` (`:652`) and `updateSelectedLaps` now fires
		// the redetect closure. Cleared one line too late, a mode switch ran the
		// PREVIOUS mode's closure: leaving out-and-back for GPS-lap re-ran
		// `updateGates()` against detached `#oabGate*` sliders, repopulating the
		// very arrays `setGpsAnalysisMode` had just cleared, redrawing A/B markers
		// on a map about to be destroyed, and persisting gate offsets for a mode
		// the user had left. The binders below re-publish it a few lines later,
		// and each runs its own initial detection, so nothing is lost by clearing
		// first.
		clearGpsRedetect();
		restoreSection3Controls(hasGpsData);

		try {
			if (hasGpsData) {
				const mapVisualization = new MapVisualization("mapView");
				await mapVisualization.initialize();
				mapVisualization.setData(fitData, laps);
				deps.setMapVisualization(mapVisualization);
				log.debug("Map initialized with GPS data");

				// Setup GPS lap detection if enabled
				if (showGpsLapDetection) {
					void bindGpsDetection(
						deps.appState,
						deps.parameterStorage,
						mapVisualization,
						{
							getSelectedDataTimeRange,
							findDataIndexAtTimeOffset,
							runGpsLapDetection,
							registerRedetect: setGpsRedetect,
						},
					);
				}

				// Setup Out and Back detection if enabled
				if (showOutAndBack) {
					void bindOutAndBackDetection(
						deps.appState,
						deps.parameterStorage,
						mapVisualization,
						{
							getSelectedDataTimeRange,
							findDataIndexAtTimeOffset,
							runOutAndBackDetection,
							registerRedetect: setGpsRedetect,
						},
					);
				}
			} else {
				log.debug("No GPS data - skipping map initialization");
				deps.setMapVisualization(null);
			}

			log.debug(
				"Section 3 initialized (GPS:",
				hasGpsData,
				", GPS Lap Detection:",
				showGpsLapDetection,
				", Out and Back:",
				showOutAndBack,
				")",
			);
		} catch (error) {
			log.error("Error initializing section 3:", error);
		}
	}, 100);
}
