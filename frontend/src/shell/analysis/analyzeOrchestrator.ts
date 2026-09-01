import {
	AnalysisParametersComponent,
	AnalysisParameters,
} from "../../components/AnalysisParameters";
import { MapVisualization } from "../../components/MapVisualization";
import { AppState } from "../../state/AppState";
import { ParameterStorage } from "../../utils/ParameterStorage";
import { ResultsStorage } from "../../utils/ResultsStorage";
import { log } from "../../utils/log";
import { getNormalizedActivityArrays } from "../../analysis/ActivityArrayCache";
import { resolveWindSeries } from "../../analysis/WindSourceResolver";
import { getAnalysisModeHandler } from "../../modes/analysis/AnalysisModes";
import { prepareAnalysisPayload } from "./prepareAnalysisPayload";
import { createModeRenderCallbacks } from "./renderDelegates";
import { showGpsLapVEAnalysis } from "../gpsLap";
import { showOutAndBackVEAnalysis } from "../outAndBack";
import { calculateAutoRho, showVirtualElevationAnalysisInline } from "../ve";
import {
	handleSaveScreenshot,
	handleStoreResult,
	handleExportAllResults,
	handleShowAllResults,
	saveCurrentLapSettings,
} from "./storageHandlers";
import {
	isGpsLapSelectionMode,
	getGpsAnalysisMode,
} from "../section3/section3Orchestration";
import { waitForPlotly } from "./plotlyLoader";
import { requestModeUpdate } from "./requestModeUpdate";
import {
	ensureAutoConvergeState,
	syncAutoConvergeControlState,
} from "../ve/autoConvergeLocks";
import { configureParameterMerge } from "./parametersSync";
import {
	clearLapViewToggle,
	configureLapViewToggle,
} from "../ve/lapViewToggle";
import { deriveOverlayLaps } from "../ve/deriveLapRanges";

interface AnalyzeOrchestratorDependencies {
	appState: AppState;
	parameterStorage: ParameterStorage;
	resultsStorage: ResultsStorage;
	getMapVisualization: () => MapVisualization | null;
	getParametersComponent: () => AnalysisParametersComponent | null;
	setParametersComponent: (
		component: AnalysisParametersComponent | null,
	) => void;
	initializeSection3: () => void;
	showLoading: (message: string) => void;
	hideLoading: () => void;
	showError: (message: string) => void;
}

let dependencies: AnalyzeOrchestratorDependencies | null = null;

function getDependencies(): AnalyzeOrchestratorDependencies {
	if (!dependencies) {
		throw new Error("Analyze orchestrator is not configured");
	}
	return dependencies;
}

function getServices(deps: AnalyzeOrchestratorDependencies) {
	return {
		appState: deps.appState,
		showLoading: deps.showLoading,
		hideLoading: deps.hideLoading,
		showError: deps.showError,
	};
}

export function configureAnalyzeOrchestrator(
	nextDependencies: AnalyzeOrchestratorDependencies,
): void {
	dependencies = nextDependencies;
	// Route out-of-form parameter writes (e.g. Crr temp controls in GPS-lap /
	// out-and-back sidebars) through the parameters component so its private
	// copy stays in sync and later form edits don't revert them.
	configureParameterMerge((fields) => {
		const component = nextDependencies.getParametersComponent();
		if (component) {
			component.setParameters(fields);
		} else if (nextDependencies.appState.currentParameters) {
			Object.assign(nextDependencies.appState.currentParameters, fields);
		}
	});
}

// Analysis parameters initialization
export function initializeAnalysisParameters(): void {
	const deps = getDependencies();

	try {
		const parametersComponent = new AnalysisParametersComponent(
			"analysisParameters",
			handleParametersChange,
		);
		deps.setParametersComponent(parametersComponent);

		// Initialize appState.currentParameters with the default values from the component
		deps.appState.currentParameters = parametersComponent.getParameters();

		// Update analyze button with the default parameters
		updateAnalyzeButton();
	} catch (error) {
		log.error("Error initializing analysis parameters:", error);
	}
}

/**
 * Parameter Update Paths Documentation
 *
 * This function handles parameter changes from the AnalysisParameters component.
 * It routes updates to the appropriate components based on parameter type.
 *
 * Orchestrator-triggered parameters (saved with files via parameter storage layer):
 * - All parameters that go through setParameters() → trigger this function
 * - These are persisted with the analysis file
 * - Recalculation goes through the one funnel, `requestModeUpdate("parameters")`,
 *   which resolves the handler from the mode that is on screen and performs the
 *   VE-visibility check itself. This function no longer knows any mode's markup.
 *
 * Local-only parameters (runtime adjustments in AppState):
 * - airSpeedCalibrationPercent: Lives in AppState, not persisted per-file
 * - These are runtime adjustments that update directly via local functions
 * - They bypass the parameter storage layer (intentional - runtime adjustment, not a saved parameter)
 *
 * Note: GPS mode is now controlled via Section 3 UI, not via AnalysisParameters.
 * The auto_lap_detection field was removed from AnalysisParameters.
 */
export function handleParametersChange(parameters: AnalysisParameters): void {
	const deps = getDependencies();

	deps.appState.currentParameters = parameters;

	// Don't save if we're currently loading parameters from storage
	if (deps.appState.isLoadingParameters) {
		return;
	}

	// Save parameters to IndexedDB for this file
	if (!deps.appState.currentFileHash) {
		log.error("❌ Cannot save: appState.currentFileHash is null/undefined");
		return;
	}

	if (!deps.appState.selectedFile) {
		log.error("❌ Cannot save: appState.selectedFile is null/undefined");
		return;
	}

	deps.parameterStorage
		.saveParameters(
			deps.appState.currentFileHash,
			parameters,
			deps.appState.selectedFile.name,
		)
		.then(() => {})
		.catch((err) => {
			log.error("❌ Failed to save parameters:", err);
		});

	// Update wind indicator on map if wind parameters are set
	const mapVisualization = deps.getMapVisualization();
	if (mapVisualization && deps.appState.currentParameters) {
		if (
			deps.appState.currentParameters.wind_speed !== null &&
			deps.appState.currentParameters.wind_speed !== undefined &&
			deps.appState.currentParameters.wind_direction !== null &&
			deps.appState.currentParameters.wind_direction !== undefined
		) {
			mapVisualization.showWindIndicator(
				deps.appState.currentParameters.wind_speed,
				deps.appState.currentParameters.wind_direction,
				deps.appState.currentParameters.wind_speed_unit,
			);
		} else {
			mapVisualization.hideWindIndicator();
		}
	}

	// Trigger auto-rho calculation if checkbox was just enabled
	// or if auto-calculate is already enabled (parameters changed)
	// BUT skip if we're already calculating (prevents infinite loop)
	const parametersComponent = deps.getParametersComponent();
	if (
		parameters.auto_calculate_rho &&
		deps.appState.currentFitData &&
		!deps.appState.isCalculatingAutoRho
	) {
		// Small delay to ensure UI is updated
		setTimeout(() => {
			calculateAutoRho(
				deps.appState,
				parametersComponent,
				getServices(deps),
			).catch((err) => {
				log.error("Auto-rho calculation error:", err);
			});
		}, 100);
	}

	// Recalculate, in whichever mode is on screen (N-4).
	//
	// This used to fake an `input` event on Standard's trim-start slider. That
	// element exists in ONE template -- Standard's -- so in GPS-lap and
	// out-and-back the lookup returned null and every form-driven parameter
	// change (rho, system mass, eta, velodrome, constant wind speed/direction,
	// air-speed offset) silently did nothing at all. No element id belonging to
	// one mode's markup appears in this mode-agnostic file any more; the funnel
	// resolves the handler from the live mode, so one call reaches all three.
	//
	// The VE-visibility check is not lost, it MOVED: `requestModeUpdate` runs it
	// through `isVeSectionVisible`, which is the same class-name test lifted
	// verbatim. Keeping a second copy here is how two copies of one answer drift
	// apart, so this asks unconditionally and the funnel answers.
	requestModeUpdate("parameters");

	// Update analyze button state
	updateAnalyzeButton();
}

// Setup analyze button functionality
export function setupAnalyzeButton(): void {
	const analyzeBtn = document.getElementById("analyzeBtn");
	if (analyzeBtn) {
		analyzeBtn.addEventListener("click", handleAnalyze);
	}
	bindAutoConvergeCheckbox();
}

/**
 * The Section-3 auto-converge checkbox. Bound here because a GPS-mode switch
 * destroys and rebuilds Section 3's DOM, and `restoreSection3Controls`
 * already re-runs `setupAnalyzeButton` — so the rebind comes for free. The
 * handler is a stable module-level reference, so a repeated bind on the same
 * element deduplicates instead of stacking listeners (the `handleAnalyze`
 * pattern above).
 */
function bindAutoConvergeCheckbox(): void {
	const checkbox = document.getElementById(
		"autoConvergeToggle",
	) as HTMLInputElement | null;
	if (!checkbox) {
		return;
	}
	const { appState } = getDependencies();
	checkbox.checked = ensureAutoConvergeState(appState).enabled;
	checkbox.addEventListener("change", handleAutoConvergeToggle);
}

function handleAutoConvergeToggle(event: Event): void {
	const checkbox = event.currentTarget as HTMLInputElement;
	const { appState } = getDependencies();
	ensureAutoConvergeState(appState).enabled = checkbox.checked;
	// Reveal/hide the lock block and release any disabled slider; then let the
	// funnel decide whether a recompute is possible (it gates on visibility).
	syncAutoConvergeControlState(appState);
	requestModeUpdate("autoConverge");
}

export function updateAnalyzeButton(): void {
	const deps = getDependencies();

	const analyzeBtn = document.getElementById("analyzeBtn") as HTMLButtonElement;
	if (analyzeBtn) {
		const lapDetectionMode = getGpsAnalysisMode();
		const isGpsLapMode = isGpsLapSelectionMode(lapDetectionMode);
		const isOutAndBackMode = lapDetectionMode === "GPS based out and back";

		// Check which lap/section selection to use
		let hasSelectedLaps: boolean;
		let lapCount: number;
		let hasDetectedItems: boolean;

		if (isOutAndBackMode) {
			hasSelectedLaps = deps.appState.outAndBackSelectedSections.length > 0;
			lapCount = deps.appState.outAndBackSelectedSections.length;
			hasDetectedItems = deps.appState.outAndBackSections.length > 0;
		} else if (isGpsLapMode) {
			hasSelectedLaps = deps.appState.gpsSelectedLaps.length > 0;
			lapCount = deps.appState.gpsSelectedLaps.length;
			hasDetectedItems = deps.appState.gpsDetectedLaps.length > 0;
		} else {
			hasSelectedLaps = deps.appState.selectedLaps.length > 0;
			lapCount = deps.appState.selectedLaps.length;
			hasDetectedItems = true;
		}

		const hasValidParameters =
			deps.getParametersComponent()?.isValid() ?? false;

		analyzeBtn.disabled =
			!hasSelectedLaps || !hasValidParameters || !hasDetectedItems;

		if (isOutAndBackMode && deps.appState.outAndBackSections.length === 0) {
			analyzeBtn.textContent = "Set GPS Gates to Detect Sections";
		} else if (isGpsLapMode && deps.appState.gpsDetectedLaps.length === 0) {
			analyzeBtn.textContent = "Set GPS Gate to Detect Laps";
		} else if (!hasSelectedLaps) {
			analyzeBtn.textContent = isOutAndBackMode
				? "Select Sections to Analyze"
				: "Select Laps to Analyze";
		} else if (!hasValidParameters) {
			analyzeBtn.textContent = "Check Parameters Above";
		} else {
			if (isOutAndBackMode) {
				analyzeBtn.textContent = `Analyze ${lapCount} Selected Section${lapCount > 1 ? "s" : ""}`;
			} else {
				analyzeBtn.textContent = `Analyze ${lapCount} Selected Lap${lapCount > 1 ? "s" : ""}`;
			}
		}
	}
}

export async function handleAnalyze(): Promise<void> {
	const deps = getDependencies();

	const lapDetectionMode = getGpsAnalysisMode();
	const modeHandler = getAnalysisModeHandler(lapDetectionMode);
	const selection = modeHandler.prepareSelection(deps.appState);

	// Reset the stitched/stacked toggle by default; the standard render path
	// re-enables it when eligible (2+ ordinary laps).
	clearLapViewToggle();

	if (
		!deps.appState.currentParameters ||
		selection.selectedItems.length === 0
	) {
		alert(selection.emptySelectionMessage);
		return;
	}

	if (!deps.appState.currentFitData) {
		alert("No FIT data available for analysis.");
		return;
	}

	const validationMessage = modeHandler.validate(deps.appState);
	if (validationMessage) {
		alert(validationMessage);
		return;
	}

	// Note: Auto-rho will be triggered AFTER VE analysis when trim sliders are created
	// (trim sliders don't exist yet at this point)
	try {
		// CLEARED AT THE START OF EVERY ANALYZE (WR-4).
		//
		// `currentVEResult` has exactly two readers, both in `storageHandlers`:
		// the guard that lets Store Result run (`:105`) and the value it
		// persists (`:314`). So a result left over from the PREVIOUS ride would
		// be stored under THIS one's name the moment an analyze failed --
		// `selectedFile` has already moved on by the time we get here.
		//
		// The only writer that fills it again is `handler.summarize`, reached
		// through the update primitive, which every mode now runs at analyze
		// time: Standard via its post-bind kick (`renderStandardVe.ts:562`) and
		// the GPS modes via theirs. An analyze that never reaches that seam has
		// nothing on screen to describe, and must therefore leave nothing
		// behind.
		deps.appState.currentVEResult = null;

		deps.showLoading("Preparing data for Virtual Elevation analysis...");

		if (selection.mode === "outAndBack") {
			log.debug(
				"Out and Back mode - selected sections:",
				selection.outAndBackSections,
			);
		} else if (selection.mode === "gpsLap") {
			log.debug(
				"GPS lap mode - selected lap index ranges:",
				selection.indexRanges,
			);
		} else {
			log.debug("Normal mode - selected lap data:", selection.selectedEntries);
		}

		log.debug(
			"appState.currentFitResult structure:",
			deps.appState.currentFitResult,
		);
		log.debug(
			"appState.currentFitResult keys:",
			deps.appState.currentFitResult
				? Object.keys(deps.appState.currentFitResult)
				: "null",
		);

		if (!deps.appState.currentFitResult) {
			throw new Error("No data available for analysis");
		}

		const fitData =
			deps.appState.currentFitData || deps.appState.currentFitResult.fit_data;
		if (!fitData) {
			throw new Error("No analysis data available");
		}

		const normalizedArrays = getNormalizedActivityArrays(fitData);
		const hasWindYaw = normalizedArrays.windYaw.some(
			(yaw: number) => !isNaN(yaw) && yaw !== 0,
		);
		const initialWindResolution = resolveWindSeries({
			fitData,
			windSource: "fit",
			applyOffset: false,
		});

		if (initialWindResolution.dataSource === "air_speed") {
			log.debug("🌬️ Found air speed data, using it as apparent wind speed");
		} else if (initialWindResolution.dataSource === "wind_speed") {
			if (hasWindYaw) {
				log.debug(
					"🌬️ Found wind speed with yaw, triangulating for apparent wind speed",
				);
			} else {
				log.debug(
					"🌬️ Found wind speed without yaw, using it as apparent wind speed",
				);
			}
		} else {
			log.debug(
				"🌬️ No air/wind speed data found, using constant wind as source",
			);
		}

		const hasRoadSpeed = normalizedArrays.roadSpeed.some(
			(v: number) => !isNaN(v) && v !== 0,
		);
		const hasEnhancedSpeed = normalizedArrays.velocity.some(
			(v: number) => !isNaN(v) && v !== 0,
		);
		if (hasRoadSpeed && hasEnhancedSpeed) {
			log.debug("🚴 Found enhanced speed and road speed, prefer road speed");
		}

		deps.showLoading("Running Virtual Elevation calculation...");

		// NO rho, NO cda/crr, NO calculator (WR-4). This call filters the
		// selection and nothing else; the physics belongs to the update
		// primitive, which resolves rho itself per update (D-06) and is now
		// reached at analyze time by every mode's post-bind kick.
		const payload = prepareAnalysisPayload({
			appState: deps.appState,
			fitData,
			selection,
			params: deps.appState.currentParameters,
			getNormalizedActivityArrays,
		});

		const powerDataPoints = payload.filteredData.power.filter(
			(p) => p > 0,
		).length;
		if (powerDataPoints < payload.filteredData.timestamps.length * 0.5) {
			log.warn(
				`Only ${powerDataPoints}/${payload.filteredData.timestamps.length} records have power data`,
			);
		}

		deps.hideLoading();

		// NO `currentVEResult = payload.initialResult` HERE (WR-4).
		//
		// `initialResult` is ONE stitched fit over the concatenated selection.
		// Its only consumer is `standardMode.ts:155` -> Standard's header spans;
		// `gpsLapMode.render` and `outAndBackMode.render` never forward it. So
		// in the GPS modes this assignment stored an r2/RMSE that no panel had
		// ever displayed -- N per-lap fits are on screen, and the first control
		// nudge replaced the stored number with theirs.
		//
		// The field is written in ONE place now, `handler.summarize`, off the
		// same primitive the update path uses. That is what makes "the stored
		// result is what the screen showed" structural rather than remembered.
		deps.appState.filteredVEData = {
			positionLat: payload.filteredData.positionLat,
			positionLong: payload.filteredData.positionLong,
		};

		modeHandler.syncState(deps.appState, selection);

		const parametersComponent = deps.getParametersComponent();
		const mapVisualization = deps.getMapVisualization();

		const callbacks = createModeRenderCallbacks({
			standard: async (args) => {
				await waitForPlotly();

				// Stitched view: the standard concatenated VE renderer (default).
				const renderStitched = () => {
					deps.appState.isGpsLapModeActive = false;
					deps.appState.currentGpsLapIndexRanges = null;
					deps.appState.currentOverlayLapNumbers = null;
					return showVirtualElevationAnalysisInline(
						deps.appState,
						deps.parameterStorage,
						parametersComponent,
						getServices(deps),
						mapVisualization,
						{
							onSaveScreenshot: () => {
								void handleSaveScreenshot(deps.appState, deps.resultsStorage);
							},
							onStoreResult: () => {
								void handleStoreResult(deps.appState, deps.resultsStorage);
							},
							onShowAllResults: () => {
								void handleShowAllResults(deps.resultsStorage);
							},
							onExportAll: () => {
								void handleExportAllResults(deps.resultsStorage);
							},
							saveCurrentLapSettings: () => {
								void saveCurrentLapSettings(
									deps.appState,
									deps.parameterStorage,
								);
							},
						},
						args.analyzedLaps,
						args.selectedIndices,
						args.timestamps,
						args.power,
						args.velocity,
						args.positionLat,
						args.positionLong,
						args.altitude,
						args.distance,
						args.windSpeed,
						args.temperature,
						args.cdaReference,
						args.defaultAirSpeedOffset,
					);
				};

				// Offer the stitched/stacked toggle only for ordinary multi-lap
				// selections; stacked reuses the GPS-lap overlay renderer with
				// per-lap index ranges derived from each lap's time span.
				if (selection.mode === "standard" && args.analyzedLaps.length >= 2) {
					const timestamps =
						getNormalizedActivityArrays(fitData).timestamps;
					const selectedLapInputs = args.analyzedLaps
						.map((lapNumber) => ({
							lapNumber,
							lap: deps.appState.currentLaps[lapNumber - 1],
						}))
						.filter((entry) => Boolean(entry.lap));
					const { ranges, lapNumbers } = deriveOverlayLaps(
						timestamps,
						selectedLapInputs,
					);

					if (ranges.length >= 2) {
						const renderStacked = () => {
							deps.appState.isGpsLapModeActive = true;
							deps.appState.currentGpsLapIndexRanges = ranges;
							deps.appState.currentOverlayLapNumbers = lapNumbers;
							return showGpsLapVEAnalysis(
								getServices(deps),
								deps.parameterStorage,
								deps.resultsStorage,
								waitForPlotly,
								ranges,
								fitData,
								deps.appState.currentParameters!,
								args.defaultAirSpeedOffset,
							);
						};
						configureLapViewToggle({ renderStitched, renderStacked });
					}
				}

				return renderStitched();
			},
			gpsLap: ({ lapIndexRanges, fitData, params, defaultAirSpeedOffset }) =>
				showGpsLapVEAnalysis(
					getServices(deps),
					deps.parameterStorage,
					deps.resultsStorage,
					waitForPlotly,
					lapIndexRanges,
					fitData,
					params,
					defaultAirSpeedOffset,
				),
			outAndBack: ({ sections, fitData, params, defaultAirSpeedOffset }) =>
				showOutAndBackVEAnalysis(
					getServices(deps),
					deps.parameterStorage,
					deps.resultsStorage,
					sections,
					fitData,
					params,
					defaultAirSpeedOffset,
					waitForPlotly,
				),
		});

		await modeHandler.render({
			appState: deps.appState,
			selection,
			fitData,
			params: deps.appState.currentParameters,
			defaultAirSpeedOffset: payload.defaultAirSpeedOffset,
			filteredData: payload.filteredData,
			selectedIndices: payload.selectedIndices,
			callbacks,
		});
	} catch (err) {
		log.error("Virtual Elevation analysis failed:", err);
		deps.hideLoading();
		const errorMessage = err instanceof Error ? err.message : "Unknown error";
		deps.showError(`Virtual Elevation analysis failed: ${errorMessage}`);
	}
}
