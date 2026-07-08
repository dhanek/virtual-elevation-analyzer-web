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
	saveCurrentLapSettings,
} from "./storageHandlers";
import {
	isGpsLapSelectionMode,
	getGpsAnalysisMode,
} from "../section3/section3Orchestration";
import { calculateRhoArrayFromFitData } from "../dem/demHandlers";
import { configureRecomputeRunner } from "./recomputeRunner";
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

// Helper function to dynamically load and wait for Plotly
function waitForPlotly(): Promise<any> {
	return new Promise((resolve, reject) => {
		// Check if already loaded
		if (typeof (window as any).Plotly !== "undefined") {
			resolve((window as any).Plotly);
			return;
		}

		// Load Plotly script dynamically
		const script = document.createElement("script");
		script.src = "https://cdn.plot.ly/plotly-basic-2.27.0.min.js"; // Use basic bundle (no eval required)
		script.async = false;
		script.crossOrigin = "anonymous";

		script.onload = () => {
			// Give it a moment to initialize
			setTimeout(() => {
				if (typeof (window as any).Plotly !== "undefined") {
					resolve((window as any).Plotly);
				} else {
					log.error("Plotly script loaded but Plotly is not on window object");
					reject(new Error("Plotly loaded but not available"));
				}
			}, 100);
		};

		script.onerror = (error) => {
			log.error("Failed to load Plotly script:", error);
			log.error("Network error or CSP blocking the script");
			reject(new Error("Failed to load Plotly script from CDN"));
		};

		document.head.appendChild(script);
	});
}

export function configureAnalyzeOrchestrator(
	nextDependencies: AnalyzeOrchestratorDependencies,
): void {
	dependencies = nextDependencies;
	configureRecomputeRunner(nextDependencies.appState);
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
 * - When VE section is visible, dispatch input event on trimStartSlider to trigger recalculation
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

	// If VE analysis is already visible, recalculate when parameters change
	const veSection =
		document.getElementById("veAnalysisSection") ??
		document.getElementById("veSection");
	const isVeVisible =
		!!veSection &&
		!veSection.classList.contains("hidden") &&
		!veSection.classList.contains("workflow-section--inactive");
	if (isVeVisible) {
		const trimStartSlider = document.getElementById(
			"trimStartSlider",
		) as HTMLInputElement;

		if (trimStartSlider) {
			trimStartSlider.dispatchEvent(new Event("input", { bubbles: true }));
		}
	}

	// Update analyze button state
	updateAnalyzeButton();
}

// Setup analyze button functionality
export function setupAnalyzeButton(): void {
	const analyzeBtn = document.getElementById("analyzeBtn");
	if (analyzeBtn) {
		analyzeBtn.addEventListener("click", handleAnalyze);
	}
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

		const hasEnvironmentalData = !!(
			fitData.temperature &&
			fitData.humidity &&
			fitData.pressure
		);
		const payload = prepareAnalysisPayload({
			appState: deps.appState,
			fitData,
			selection,
			params: deps.appState.currentParameters,
			cda: deps.appState.currentParameters.cda,
			crr: deps.appState.currentParameters.crr,
			getNormalizedActivityArrays,
			calculateRhoArray: (fd) => {
				const currentNormalized = getNormalizedActivityArrays(fd);
				const hasAirDensityData = currentNormalized.airDensity.some(
					(rho) => !isNaN(rho) && rho > 0,
				);
				if (hasAirDensityData) {
					log.debug("💨 Found air density data, using it for calculations");
					return currentNormalized.airDensity;
				}

				if (hasEnvironmentalData) {
					const calculated = calculateRhoArrayFromFitData(fd);
					if (calculated) {
						log.debug("💨 Calculated air density from environmental data");
					}
					return calculated;
				}

				log.debug(
					"💨 No air density found, using constant value from weather API",
				);
				return null;
			},
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

		deps.appState.currentRhoArray = payload.rhoArray;
		deps.appState.currentVEResult = payload.initialResult;
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
						args.initialResult,
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
			initialResult: payload.initialResult,
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
