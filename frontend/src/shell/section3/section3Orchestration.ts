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

const MIN_TRIM_WINDOW_SAMPLES = 30;

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

	// Re-setup handlers after re-render
	setTimeout(async () => {
		try {
			// Setup GPS mode selector handler
			if (hasGpsData) {
				bindGpsModeSelector();
			}

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
							},
						);
					}
				}
			}

			// Setup lap selection handlers
			const lapListEl = document.getElementById("lapList");
			if (lapListEl) {
				bindLapSelection(lapListEl, () => updateSelectedLaps());
				bindSelectAllButton("selectAllLaps", "lapList", () =>
					updateSelectedLaps(),
				);
			}
			deps.setupAnalyzeButton();
		} catch (error) {
			log.error("Error re-rendering section 3:", error);
		}
	}, 100);
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

	// Update UI
	updateGpsDetectedLapsUI();

	// Auto-select all laps initially
	deps.appState.gpsSelectedLaps = deps.appState.gpsDetectedLaps.map(
		(lap) => lap.lapNumber,
	);
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
		lapsInfo.style.display = "none";
		return;
	}

	lapsInfo.style.display = "block";
	lapCountSpan.textContent = deps.appState.gpsDetectedLaps.length.toString();

	// Populate lap list
	lapList.innerHTML = deps.appState.gpsDetectedLaps
		.map(
			(lap) => `
        <div class="lap-checkbox-item selected" data-gps-lap="${lap.lapNumber}">
            <input type="checkbox" class="gps-lap-checkbox" id="gps-lap-${lap.lapNumber}" checked>
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

	// Update visual selection state
	document
		.querySelectorAll(".lap-checkbox-item[data-gps-lap]")
		.forEach((item) => {
			const checkbox = item.querySelector(
				".gps-lap-checkbox",
			) as HTMLInputElement;
			if (checkbox?.checked) {
				item.classList.add("selected");
			} else {
				item.classList.remove("selected");
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

	// Update UI
	updateOutAndBackSectionsUI();

	// Auto-select all sections initially
	deps.appState.outAndBackSelectedSections =
		deps.appState.outAndBackSections.map((s) => s.sectionNumber);
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
		sectionsInfo.style.display = "none";
		return;
	}

	sectionsInfo.style.display = "block";
	sectionCountSpan.textContent =
		deps.appState.outAndBackSections.length.toString();

	// Populate section list
	sectionList.innerHTML = deps.appState.outAndBackSections
		.map(
			(section) => `
        <div class="lap-checkbox-item selected" data-oab-section="${section.sectionNumber}">
            <input type="checkbox" class="oab-section-checkbox" id="oab-section-${section.sectionNumber}" checked>
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

	// Update visual selection state
	document
		.querySelectorAll(".lap-checkbox-item[data-oab-section]")
		.forEach((item) => {
			const checkbox = item.querySelector(
				".oab-section-checkbox",
			) as HTMLInputElement;
			if (checkbox?.checked) {
				item.classList.add("selected");
			} else {
				item.classList.remove("selected");
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

	// Update map visualization
	const mapVisualization = deps.getMapVisualization();
	if (mapVisualization) {
		mapVisualization.setSelectedLaps(deps.appState.selectedLaps);
	}

	const lapDetectionMode = getGpsAnalysisMode();
	const shouldShowSelectionTrimControls =
		deps.appState.selectedLaps.length > 0 &&
		!isGpsLapSelectionMode(lapDetectionMode) &&
		lapDetectionMode !== "GPS based out and back";

	// Show/hide trim controls based on lap selection.
	// GPS-based splitting modes have their own selection model, so these
	// FIT-lap trim controls are misleading there and should stay hidden.
	const mapTrimControls = document.getElementById("mapTrimControls");
	if (mapTrimControls) {
		if (shouldShowSelectionTrimControls) {
			mapTrimControls.style.display = "flex";
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
			mapTrimControls.style.display = "none";
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

		// Set map markers with loaded/default trim values
		const mapVisualization = deps.getMapVisualization();
		if (
			mapVisualization &&
			savedSettings &&
			deps.appState.presetTrimStart !== null &&
			deps.appState.presetTrimEnd !== null
		) {
			log.debug("Setting map trim markers to loaded settings:", {
				trimStart: deps.appState.presetTrimStart,
				trimEnd: deps.appState.presetTrimEnd,
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

	// Initialize map visualization only if GPS data is available
	setTimeout(async () => {
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
						},
					);
				}
			} else {
				log.debug("No GPS data - skipping map initialization");
				deps.setMapVisualization(null);
			}

			// Setup GPS mode selector handler (if GPS data available)
			if (hasGpsData) {
				bindGpsModeSelector();
			}

			// Setup lap selection handlers using shell helpers
			const lapListEl = document.getElementById("lapList");
			if (lapListEl) {
				bindLapSelection(lapListEl, () => updateSelectedLaps());
				bindSelectAllButton("selectAllLaps", "lapList", () =>
					updateSelectedLaps(),
				);
			}
			deps.setupAnalyzeButton();

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
