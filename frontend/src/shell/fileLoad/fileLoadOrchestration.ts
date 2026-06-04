import {
	getActivityFileType,
	validateActivityFile,
	validateFitMagicNumber,
} from "../../utils/FileValidation";
import { FitFileProcessor } from "../../components/FitFileProcessor";
import { ParameterStorage } from "../../utils/ParameterStorage";
import { ResultsStorage } from "../../utils/ResultsStorage";
import { DEMManager, ElevationProfileCache } from "../../utils/DEMManager";
import type { DEMSourceType } from "../../utils/RemoteDEMConfig";
import { RemoteDEMService } from "../../utils/RemoteDEMService";
import { MultiDEMManager } from "../../utils/MultiDEMManager";
import { CsvParseError, type GibliCsvData } from "../../utils/CsvParser";
import { log } from "../../utils/log";
import { smoothDemMovingAverage } from "../../analysis/demSmoothing";
import { AppState } from "../../state/AppState";
import {
	createFitLoadedActivity,
	loadCsvActivity,
} from "../../activity/ActivityLoader";
import { calculateAutoRho } from "../ve";
import { AnalysisParametersComponent } from "../../components/AnalysisParameters";
import { initializeSection3 } from "../section3/section3Orchestration";
import {
	calculateAvgCda,
	displayResults,
	formatFileSize,
} from "../dem/demHandlers";
import init from "../../../pkg/virtual_elevation_analyzer.js";

interface FileLoadDependencies {
	appState: AppState;
	parameterStorage: ParameterStorage;
	resultsStorage: ResultsStorage;
	demManager: DEMManager;
	elevationCache: ElevationProfileCache;
	multiDEMManager: MultiDEMManager;
	remoteDEMService: RemoteDEMService;
	fileInfo: HTMLDivElement;
	fileDetails: HTMLDivElement;
	analyzeButton: HTMLButtonElement;
	remoteDEMStatus: HTMLDivElement;
	showLoading: (message: string) => void;
	hideLoading: () => void;
	showError: (message: string) => void;
	hideError: () => void;
	activateSection: (sectionNumber: number) => void;
	scrollToSection: (sectionId: string) => void;
	initializeAnalysisParameters: () => void;
	getParametersComponent: () => AnalysisParametersComponent | null;
	setFitProcessor: (fitProcessor: FitFileProcessor | null) => void;
	getFitProcessor: () => FitFileProcessor | null;
}

let dependencies: FileLoadDependencies | null = null;

function getDependencies(): FileLoadDependencies {
	if (!dependencies) {
		throw new Error("File-load orchestration is not configured");
	}
	return dependencies;
}

export function configureFileLoadOrchestration(
	nextDependencies: FileLoadDependencies,
): void {
	dependencies = nextDependencies;
}

// Initialize FIT processor and parameter storage
export async function initializeFitProcessor(): Promise<void> {
	const deps = getDependencies();

	try {
		deps.showLoading("Initializing WebAssembly module...");

		// Initialize the Virtual Elevation WASM module
		await init();

		const fitProcessor = new FitFileProcessor();
		await fitProcessor.initialize();
		deps.setFitProcessor(fitProcessor);

		// Initialize parameter storage
		await deps.parameterStorage.initialize();

		// Initialize results storage
		await deps.resultsStorage.initialize();

		// Clean up old entries on startup
		await deps.parameterStorage.cleanup();

		deps.hideLoading();
		deps.hideError();
	} catch (err) {
		log.error("Failed to initialize:", err);
		deps.hideLoading();
		const errorMessage = err instanceof Error ? err.message : "Unknown error";
		deps.showError(
			`Failed to initialize: ${errorMessage}. Check browser console for details.`,
		);
	}
}

// File validation and display
export async function handleFileSelection(file: File): Promise<void> {
	const deps = getDependencies();

	// Validate file type and size
	if (!validateActivityFile(file)) {
		deps.showError(
			"Please select a valid FIT or CSV file (.fit or .csv extension, under 50MB)",
		);
		return;
	}

	deps.appState.selectedFile = file;
	displayFileInfo(file);

	// Calculate file hash immediately for parameter persistence
	deps.appState.currentFileHash =
		await deps.parameterStorage.calculateFileHash(file);

	deps.analyzeButton.disabled = false;
	deps.hideError();
}

export function displayFileInfo(file: File): void {
	const deps = getDependencies();

	const fileSize = formatFileSize(file.size);
	const lastModified = new Date(file.lastModified).toLocaleString();

	deps.fileDetails.innerHTML = `
        <div><strong>Name:</strong> ${file.name}</div>
        <div><strong>Size:</strong> ${fileSize}</div>
        <div><strong>Modified:</strong> ${lastModified}</div>
    `;

	deps.fileInfo.classList.remove("hidden");
}

// Process FIT file
export async function processFitFile(file: File): Promise<void> {
	const deps = getDependencies();

	try {
		deps.showLoading("Reading FIT file...");

		// Additional validation
		const isValidMagicNumber = await validateFitMagicNumber(file);
		if (!isValidMagicNumber) {
			deps.showError(
				"Invalid FIT file format. Please select a valid FIT file.",
			);
			deps.hideLoading();
			return;
		}

		deps.showLoading("Parsing FIT data...");

		const fitProcessor = deps.getFitProcessor();
		if (!fitProcessor) {
			deps.showError("FIT processor not initialized");
			deps.hideLoading();
			return;
		}

		const result = await fitProcessor.processFitFile(file);
		deps.appState.setLoadedActivity(
			createFitLoadedActivity({
				file,
				fileHash: deps.appState.currentFileHash,
				result,
			}),
		);

		if (result.fit_data) {
			deps.appState.fitRawElevation = Array.from(result.fit_data.altitude);
		}
		deps.appState.demRawNearestElevation = null;
		deps.appState.demInterpolatedSmoothed5ptElevation = null;
		deps.appState.activeDisplayProfile = "fit-raw";
		deps.appState.demProfilesAvailable = false;

		// Apply DEM elevation correction if enabled
		if (
			deps.appState.elevationCorrectionEnabled &&
			deps.demManager.isDEMLoaded() &&
			result.fit_data
		) {
			deps.showLoading("Correcting elevation using DEM...");

			try {
				const fitData = result.fit_data;
				const lats = fitData.position_lat;
				const lons = fitData.position_long;
				const originalAltitudes = fitData.altitude;

				if (lats && lons && originalAltitudes) {
					// Debug: Log first few coordinates
					log.debug("Sample GPS coordinates:", {
						lat: lats.slice(0, 5),
						lon: lons.slice(0, 5),
						originalAlt: originalAltitudes.slice(0, 5),
					});

					const correctionResult = await deps.demManager.computeDemProfiles(
						Array.from(lats),
						Array.from(lons),
						Array.from(originalAltitudes),
					);

					const demInterpolatedSmoothed5ptElevation = smoothDemMovingAverage(
						correctionResult.demInterpolatedElevation,
					);

					log.debug(
						"Sample corrected elevations:",
						correctionResult.demRawNearestElevation.slice(0, 5),
					);

					// Replace altitudes with corrected values using setter
					result.fit_data.set_altitude(correctionResult.demRawNearestElevation);
					deps.appState.elevationErrorRate = correctionResult.errorRate;
					deps.appState.demRawNearestElevation =
						correctionResult.demRawNearestElevation;
					deps.appState.demInterpolatedSmoothed5ptElevation =
						demInterpolatedSmoothed5ptElevation;
					deps.appState.activeDisplayProfile =
						"dem-interpolated-smoothed-5pt";
					deps.appState.demProfilesAvailable = true;

					log.debug(
						`Elevation corrected. Error rate: ${(deps.appState.elevationErrorRate * 100).toFixed(1)}%`,
					);

					if (deps.appState.elevationErrorRate > 0.5) {
						log.warn(
							"High error rate! DEM may not cover route area. DEM bounds:",
							deps.demManager.getDEMBounds(),
						);
					}

					// Cache the corrected elevation profile
					if (deps.appState.currentFileHash) {
						const bounds = {
							minLat: Math.min(...lats),
							maxLat: Math.max(...lats),
							minLon: Math.min(...lons),
							maxLon: Math.max(...lons),
						};

						await deps.elevationCache.cacheProfile(
							deps.appState.currentFileHash,
							deps.appState.selectedFile?.name ?? "unknown",
							correctionResult.demRawNearestElevation,
							bounds,
						);
					}
				} else {
					log.warn("Missing GPS or altitude data, skipping DEM correction");
				}
			} catch (demError) {
				log.warn(
					"DEM elevation correction failed, using GPS altitude:",
					demError,
				);
				deps.showError(
					`Warning: DEM correction failed: ${demError}. Using GPS altitude.`,
				);
				deps.appState.demRawNearestElevation = null;
				deps.appState.demInterpolatedSmoothed5ptElevation = null;
				deps.appState.demProfilesAvailable = false;
				deps.appState.activeDisplayProfile = "fit-raw";
				// Continue with original GPS altitude
			}
		}

		// Apply remote DEM elevation correction(s) if any sources selected
		deps.appState.remoteDEMResults = null;
		if (deps.appState.remoteDEMSources.length > 0 && result.fit_data) {
			const fitData = result.fit_data;
			const lats = fitData.position_lat;
			const lons = fitData.position_long;
			const originalAltitudes = fitData.altitude;

			if (lats && lons && originalAltitudes) {
				try {
					deps.showLoading("Downloading remote DEM data...");
					deps.remoteDEMStatus.classList.remove("hidden");
					deps.remoteDEMStatus.textContent = "Fetching elevation data...";

					deps.multiDEMManager.clearAll();

					const fetchResults = await deps.remoteDEMService.fetchForRoute(
						Array.from(lats),
						Array.from(lons),
						deps.appState.remoteDEMSources,
						{},
						(_source, stage, _percent) => {
							deps.remoteDEMStatus.textContent = stage;
						},
					);

					// Load each source into MultiDEMManager
					for (const [source, data] of fetchResults) {
						deps.showLoading(`Loading ${source} DEM...`);
						await deps.multiDEMManager.loadSource(source, data);
					}

					// Correct elevations for all sources
					deps.showLoading("Correcting elevation from remote DEM...");
					deps.appState.remoteDEMResults =
						await deps.multiDEMManager.correctAllSources(
							Array.from(lats),
							Array.from(lons),
							Array.from(originalAltitudes),
						);

					// Apply the best available DEM as actual elevation
					const bestSource: DEMSourceType | undefined =
						deps.appState.remoteDEMResults.has("aws-terrain")
							? "aws-terrain"
							: undefined;
					if (bestSource) {
						const bestDEM = deps.appState.remoteDEMResults.get(bestSource)!;
						if (bestDEM.errorRate < 0.5) {
							const demRawNearestElevation = Array.from(bestDEM.elevations);
							const demInterpolatedSmoothed5ptElevation =
								smoothDemMovingAverage(bestDEM.interpolatedElevations);
							result.fit_data.set_altitude(demRawNearestElevation);
							deps.appState.demRawNearestElevation = demRawNearestElevation;
							deps.appState.demInterpolatedSmoothed5ptElevation =
								demInterpolatedSmoothed5ptElevation;
							deps.appState.activeDisplayProfile =
						"dem-interpolated-smoothed-5pt";
							deps.appState.demProfilesAvailable = true;
							log.debug(
								`Applied ${bestSource} DEM as actual elevation (error rate: ${(bestDEM.errorRate * 100).toFixed(1)}%)`,
							);
						} else {
							log.warn(
								`${bestSource} DEM error rate too high (${(bestDEM.errorRate * 100).toFixed(1)}%), keeping FIT elevation`,
							);
						}
					}

					// Update status display
					const statusParts: string[] = [];
					for (const [, demRes] of deps.appState.remoteDEMResults) {
						const coverage = ((1 - demRes.errorRate) * 100).toFixed(1);
						statusParts.push(`AWS Terrain: ${coverage}% coverage`);
					}
					deps.remoteDEMStatus.textContent = statusParts.join(" | ");

					log.debug(
						"Remote DEM results:",
						Object.fromEntries(deps.appState.remoteDEMResults),
					);
				} catch (remoteDemError) {
					log.warn("Remote DEM correction failed:", remoteDemError);
					deps.remoteDEMStatus.textContent = `Failed: ${remoteDemError}`;
				}
			}
		} else {
			deps.remoteDEMStatus.classList.add("hidden");
		}

		deps.hideLoading();
		await displayResults(result);

		// Activate section 2 (parameters) and 3 (lap selection) after successful file analysis
		deps.activateSection(2);
		deps.scrollToSection("parametersSection");

		const parametersComponent = deps.getParametersComponent();

		// Trigger auto-rho calculation if enabled and we have GPS data
		if (
			parametersComponent?.getParameters().auto_calculate_rho &&
			result.parsing_statistics.has_gps_data
		) {
			// Delay slightly to ensure trim sliders are initialized
			setTimeout(async () => {
				await calculateAutoRho(deps.appState, parametersComponent, {
					appState: deps.appState,
					showLoading: deps.showLoading,
					hideLoading: deps.hideLoading,
					showError: deps.showError,
				});
			}, 500);
		}

		// Activate section 3 if we have laps (GPS data optional)
		if (result.laps.length > 0) {
			deps.activateSection(3);

			// Initialize section 3 after a brief delay to ensure DOM is ready
			setTimeout(() => {
				initializeSection3();
			}, 100);
		}
	} catch (err) {
		deps.hideLoading();
		log.error("Error processing FIT file:", err);
		deps.showError(`Error processing FIT file: ${err}`);
	}
}

// Display CSV results (similar to displayResults but for CSV)
export async function displayCsvResults(
	csvData: GibliCsvData,
	result: any,
): Promise<void> {
	const deps = getDependencies();

	const stats = result.parsing_statistics;

	deps.fileDetails.innerHTML = `
        <div><strong>File Type:</strong> CSV (Gibli Aerosensor)</div>
        <div><strong>Data Points:</strong> ${stats.data_points}</div>
        <div><strong>Duration:</strong> ${(csvData.timeRangeSeconds / 60).toFixed(1)} minutes</div>
        <div><strong>Power Data:</strong> ${stats.has_power_data ? "✅ Yes" : "❌ No"}</div>
        <div><strong>GPS Data:</strong> ${stats.has_gps_data ? "✅ Yes" : "❌ No"}</div>
        <div><strong>Altitude Data:</strong> ${stats.has_altitude_data ? "✅ Yes" : "❌ No"}</div>
        <div><strong>Air Speed Data:</strong> ${stats.has_air_speed_data ? "✅ Yes" : "❌ No"}</div>
        <div><strong>Environmental Data:</strong> ${csvData.hasEnvironmentalData ? "✅ Yes (Temp, Humidity, Pressure)" : "❌ No"}</div>
        <div><strong>CdA Reference:</strong> ${csvData.hasCdaReference ? `✅ Yes (avg: ${calculateAvgCda(csvData).toFixed(3)})` : "❌ No"}</div>
        <div><strong>Laps:</strong> ${result.laps.length > 0 ? `✅ ${result.laps.length} lap(s)` : "❌ No lap data"}</div>
    `;

	deps.fileInfo.classList.remove("hidden");

	// Initialize analysis parameters component (same as FIT files)
	deps.appState.isLoadingParameters = true; // Prevent saving during initialization
	deps.initializeAnalysisParameters();

	const parametersComponent = deps.getParametersComponent();

	// Try to load saved parameters for this file
	if (deps.appState.currentFileHash && parametersComponent) {
		const savedParameters = await deps.parameterStorage.loadParameters(
			deps.appState.currentFileHash,
		);
		if (savedParameters) {
			// Load saved parameters
			parametersComponent.setParameters(savedParameters);
		} else {
			// First time loading - apply smart defaults
			if (csvData.hasEnvironmentalData) {
				// CSV has environmental data - disable weather API
				parametersComponent.setParameters({
					auto_calculate_rho: false,
				});
				log.debug("📊 CSV has environmental data - weather API disabled");
			} else if (stats.has_gps_data) {
				// No environmental data but has GPS - enable weather API
				parametersComponent.setParameters({
					auto_calculate_rho: true,
				});
				log.debug("📍 GPS data detected - auto-rho enabled");
			}
		}
	}

	deps.appState.isLoadingParameters = false;

	// Note: GPS mode state is managed via Section 3 UI, not via AnalysisParameters
}

// Initialize section 3 for CSV data
export function initializeSection3Csv(
	_csvData: GibliCsvData,
	_result: any,
): void {
	// CSV data is normalized into appState.currentFitData during file loading.
	initializeSection3();
}

// Process CSV file
export async function processCsvFile(file: File): Promise<void> {
	const deps = getDependencies();

	try {
		deps.showLoading("Reading CSV file...");

		// Read file content
		const text = await file.text();

		deps.showLoading("Parsing CSV data...");

		const loadedCsv = loadCsvActivity({
			file,
			fileHash: deps.appState.currentFileHash,
			text,
		});
		const {
			csvData,
			result,
			loadedActivity,
			summary,
			intervals,
			wasInterpolated,
		} = loadedCsv;

		log.debug("CSV Data Summary:");
		log.debug(summary);
		log.debug("Time interval statistics:", intervals);

		if (wasInterpolated) {
			log.debug("Non-uniform time series detected, interpolated to 1Hz");
		}

		deps.appState.setLoadedActivity(loadedActivity);

		deps.hideLoading();
		await displayCsvResults(csvData, result);

		// Activate section 2 (parameters) and section 3 (map/laps)
		// CSV files work just like FIT files - both sections are active after loading
		deps.activateSection(2);
		deps.scrollToSection("parametersSection");

		// Initialize and activate section 3 if we have laps
		if (result.laps.length > 0) {
			log.debug("📍 Activating section 3 for CSV lap analysis...");
			deps.activateSection(3);
			setTimeout(() => {
				initializeSection3Csv(csvData, result);
				log.debug("✅ Section 3 initialized for CSV");
			}, 100);
		}
	} catch (err) {
		deps.hideLoading();
		log.error("Error processing CSV file:", err);
		if (err instanceof CsvParseError) {
			deps.showError(`CSV parsing error:\n${err.message}`);
			return;
		}
		deps.showError(`Error processing CSV file: ${err}`);
	}
}

export async function processSelectedFile(): Promise<void> {
	const deps = getDependencies();

	const fitProcessor = deps.getFitProcessor();
	if (!deps.appState.selectedFile || !fitProcessor) {
		deps.showError("No file selected or processor not initialized");
		return;
	}

	try {
		// Detect file type
		const fileType = getActivityFileType(deps.appState.selectedFile);

		if (fileType === "fit") {
			await processFitFile(deps.appState.selectedFile);
		} else if (fileType === "csv") {
			await processCsvFile(deps.appState.selectedFile);
		} else {
			deps.showError("Unknown file type. Please select a .fit or .csv file.");
			deps.hideLoading();
		}
	} catch (err) {
		log.error("Error processing file:", err);
		deps.showError(
			`Failed to process file: ${err instanceof Error ? err.message : "Unknown error"}`,
		);
		deps.hideLoading();
	}
}
