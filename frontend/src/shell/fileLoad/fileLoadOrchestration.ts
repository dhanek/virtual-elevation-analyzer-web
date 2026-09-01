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
import {
	initializeSection3,
	resetAnalysisForNewActivity,
	restoreSection3Selection,
} from "../section3/section3Orchestration";
import {
	calculateAvgCda,
	displayResults,
	formatFileSize,
} from "../dem/demHandlers";
import init from "../../../pkg/virtual_elevation_analyzer.js";
import {
	entryBaseName,
	envelopeToStoredRecord,
	parseSection3,
	parseSettingsEnvelope,
	splitBundleEntries,
	type SettingsEnvelope,
} from "../../analysis/SettingsBundle";
import { readZip } from "../../utils/zip";
import { rememberActivityFile } from "../dev/devSessionStore";

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

	// The one drop zone takes three shapes: an activity file, an exported
	// settings JSON, or a zip bundling both. Dispatch on extension here so
	// the activity path below stays exactly what it was.
	const lowerName = file.name.toLowerCase();
	if (lowerName.endsWith(".json")) {
		await importSettingsJsonFile(file);
		return;
	}
	if (lowerName.endsWith(".zip")) {
		await importSettingsZipFile(file);
		return;
	}

	// Validate file type and size
	if (!validateActivityFile(file)) {
		deps.showError(
			"Please select a valid FIT or CSV file (.fit or .csv extension, under 50MB)",
		);
		return;
	}

	deps.appState.selectedFile = file;
	displayFileInfo(file);

	// DEV ONLY, and it does not await: cache the bytes so a Vite reload can
	// come back to this ride instead of an empty drop zone. No-op in a
	// production build. See shell/dev/devSessionStore.
	void rememberActivityFile(file);

	// Calculate file hash immediately for parameter persistence
	deps.appState.currentFileHash =
		await deps.parameterStorage.calculateFileHash(file);

	// A DIFFERENT activity: any imported-settings note belongs to the old one.
	// The SAME activity keeps its note — the imported record still governs it.
	if (
		importedSettingsNote &&
		importedSettingsNote.fileHash !== deps.appState.currentFileHash
	) {
		importedSettingsNote = null;
	}

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

/**
 * The "what did that JSON bring in" block shown UNDER the activity's details
 * in the file-info box. Held per file hash rather than written once, because
 * `displayResults`/`displayCsvResults` rewrite `fileDetails` on EVERY
 * analyze — including a later Analyze press — and the note must survive
 * those rewrites for as long as the imported file stays loaded.
 */
let importedSettingsNote: { fileHash: string; html: string } | null = null;

function escapeHtml(value: string): string {
	return value
		.replace(/&/g, "&amp;")
		.replace(/</g, "&lt;")
		.replace(/>/g, "&gt;");
}

function setImportedSettingsNote(
	envelope: SettingsEnvelope,
	settingsFileName: string,
	fileHash: string,
): void {
	const lines: string[] = [
		`<div><strong>Imported settings:</strong> ${escapeHtml(settingsFileName)}</div>`,
	];

	const exportedAt = envelope.exportedAt ? new Date(envelope.exportedAt) : null;
	const exportedText =
		exportedAt && !Number.isNaN(exportedAt.getTime())
			? exportedAt.toLocaleString()
			: null;
	const sourceName = envelope.activityFileName
		? escapeHtml(envelope.activityFileName)
		: null;
	if (exportedText || sourceName) {
		const from = sourceName ? ` from ${sourceName}` : "";
		lines.push(
			`<div><strong>Exported:</strong> ${exportedText ?? "unknown date"}${from}</div>`,
		);
	}

	if (envelope.section3) {
		const laps = envelope.section3.selectedLaps;
		const lapsText = laps.length > 0 ? ` — laps ${laps.join(", ")}` : "";
		lines.push(
			`<div><strong>Map analysis:</strong> ${escapeHtml(envelope.section3.gpsAnalysisMode)}${lapsText}</div>`,
		);
	}

	lines.push(
		"<div>These settings replace this file's stored settings and apply on every analyze.</div>",
	);

	importedSettingsNote = {
		fileHash,
		html: `<div class="settings-import-note">${lines.join("\n")}</div>`,
	};
}

/** Append the note below whatever details the analyze just rendered. */
function appendImportedSettingsNote(): void {
	const deps = getDependencies();

	// The FIT path never rewrites `fileDetails` after `displayFileInfo`, so a
	// note appended by an earlier analyze is still there — drop any existing
	// copies first, or every Analyze press / re-import stacks another one
	// (and a superseded import's note would shadow the current one).
	for (const el of Array.from(
		deps.fileDetails.querySelectorAll(".settings-import-note"),
	)) {
		el.remove();
	}

	if (
		!importedSettingsNote ||
		importedSettingsNote.fileHash !== deps.appState.currentFileHash
	) {
		return;
	}
	deps.fileDetails.insertAdjacentHTML("beforeend", importedSettingsNote.html);
}

/**
 * Store an imported envelope for `targetHash` and, when that is the loaded
 * file, re-run the analyze path so the restored parameters actually reach
 * the form — the same route a reload takes, which is what makes an import
 * indistinguishable from having had the settings all along.
 */
async function applyImportedEnvelope(
	envelope: SettingsEnvelope,
	targetHash: string,
	targetFileName: string | undefined,
): Promise<void> {
	const deps = getDependencies();
	await deps.parameterStorage.importStoredRecord(
		envelopeToStoredRecord(envelope, targetHash, targetFileName),
	);
	log.debug("Imported settings stored under", targetHash);
}

// A dropped settings JSON: apply to the loaded activity if there is one,
// otherwise park the settings under the hash the export recorded so they
// restore when that activity is loaded.
export async function importSettingsJsonFile(file: File): Promise<void> {
	const deps = getDependencies();

	const parsed = parseSettingsEnvelope(await file.text());
	if (!parsed.ok) {
		deps.showError(`Could not import settings: ${parsed.error}`);
		return;
	}
	deps.hideError();

	if (deps.appState.selectedFile && deps.appState.currentFileHash) {
		await applyImportedEnvelope(
			parsed.envelope,
			deps.appState.currentFileHash,
			deps.appState.selectedFile.name,
		);
		setImportedSettingsNote(
			parsed.envelope,
			file.name,
			deps.appState.currentFileHash,
		);
		// Re-analyze so the imported settings restore now, through the same
		// load path a reload takes — the Section-3 selection included, since
		// it is part of the record processFitFile restores from.
		await processSelectedFile();
		return;
	}

	if (parsed.envelope.activityFileHash) {
		await applyImportedEnvelope(
			parsed.envelope,
			parsed.envelope.activityFileHash,
			parsed.envelope.activityFileName ?? undefined,
		);
		deps.fileDetails.innerHTML = `
        <div><strong>Settings imported</strong> for ${parsed.envelope.activityFileName ?? "an activity"}.</div>
        <div>Load that activity file and its settings will restore automatically.</div>
    `;
		deps.fileInfo.classList.remove("hidden");
		return;
	}

	deps.showError(
		"This settings file names no activity — load a FIT or CSV file first, " +
			"then drop the settings JSON to apply it.",
	);
}

// A dropped zip bundle: load the activity inside it through the normal file
// path, seed its settings under the hash that load computed, and analyze.
export async function importSettingsZipFile(file: File): Promise<void> {
	const deps = getDependencies();

	let entries;
	try {
		entries = await readZip(new Uint8Array(await file.arrayBuffer()));
	} catch (err) {
		deps.showError(
			`Could not read the zip: ${err instanceof Error ? err.message : err}`,
		);
		return;
	}

	const { activity, settings } = splitBundleEntries(entries);
	if (!activity) {
		deps.showError(
			"The zip contains no .fit or .csv activity file. A bundle needs the " +
				"activity plus (optionally) its settings JSON.",
	);
		return;
	}

	let envelope: SettingsEnvelope | null = null;
	if (settings) {
		const parsed = parseSettingsEnvelope(
			new TextDecoder().decode(settings.data),
		);
		if (!parsed.ok) {
			deps.showError(
				`The zip's settings file could not be read: ${parsed.error}`,
			);
			return;
		}
		envelope = parsed.envelope;
	}

	const activityFile = new File(
		[activity.data as BlobPart],
		entryBaseName(activity.name),
	);
	await handleFileSelection(activityFile);
	if (deps.appState.selectedFile !== activityFile) {
		// The activity failed validation; handleFileSelection already said why.
		return;
	}

	if (envelope && settings && deps.appState.currentFileHash) {
		await applyImportedEnvelope(
			envelope,
			deps.appState.currentFileHash,
			activityFile.name,
		);
		setImportedSettingsNote(
			envelope,
			entryBaseName(settings.name),
			deps.appState.currentFileHash,
		);
	}

	// A bundle is a complete analysis, so run it — the drop should end on the
	// analyzed screen, not on an armed Analyze button. Section 3 restores
	// inside processFitFile, from the record seeded above.
	await processSelectedFile();
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

		// A DIFFERENT ride: everything selected for the previous one is now
		// meaningless, and `setLoadedActivity` does not touch any of it. BEFORE
		// `displayResults` below re-renders Section 3, which re-ticks the lap
		// boxes from `selectedLaps`.
		resetAnalysisForNewActivity();

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
		appendImportedSettingsNote();

		// Activate section 2 (parameters) and 3 (lap selection) after successful file analysis
		deps.activateSection(2);
		deps.scrollToSection("parametersSection");

		const parametersComponent = deps.getParametersComponent();

		// Trigger auto-rho calculation if enabled and we have GPS data
		if (
			parametersComponent?.getParameters().auto_calculate_rho &&
			result.parsing_statistics.has_gps_data
		) {
			// Delay slightly to ensure trim sliders are initialized.
			// The timer is detached, so nothing can await this promise — attach
			// a .catch so a rejection cannot escape as an unhandled rejection
			// (matches the other calculateAutoRho call sites).
			setTimeout(() => {
				calculateAutoRho(deps.appState, parametersComponent, {
					appState: deps.appState,
					showLoading: deps.showLoading,
					hideLoading: deps.hideLoading,
					showError: deps.showError,
				}).catch((err) => {
					log.error("Auto-rho calculation error after file load:", err);
				});
			}, 500);
		}

		// Activate section 3 if we have laps (GPS data optional)
		if (result.laps.length > 0) {
			deps.activateSection(3);

			// Replicate the stored Section-3 selection (mode + ticked laps).
			// EVERY analyze passes through here, so imported or previously
			// chosen settings survive the Analyze button and a reload — not
			// just the drop that imported them. State-only, and the timer
			// below is not yet scheduled, so the one render initializeSection3
			// performs paints the restored state (see restoreSection3Selection).
			await restoreStoredSection3();

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

/**
 * Read the loaded file's stored record and restore its Section-3 selection,
 * validated through the same `parseSection3` an imported JSON goes through —
 * stored data is equally untrusted, and both must degrade to "None" + no
 * laps rather than break the load.
 */
async function restoreStoredSection3(): Promise<void> {
	const deps = getDependencies();
	if (!deps.appState.currentFileHash) return;
	try {
		const record = await deps.parameterStorage.getStoredRecord(
			deps.appState.currentFileHash,
		);
		const section3 = parseSection3(record?.section3);
		if (section3) {
			restoreSection3Selection(section3);
		}
	} catch (err) {
		log.error("Failed to restore Section 3 selection:", err);
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

		// Same reset as the FIT path, for the same reason.
		resetAnalysisForNewActivity();

		deps.hideLoading();
		await displayCsvResults(csvData, result);
		appendImportedSettingsNote();

		// Activate section 2 (parameters) and section 3 (map/laps)
		// CSV files work just like FIT files - both sections are active after loading
		deps.activateSection(2);
		deps.scrollToSection("parametersSection");

		// Initialize and activate section 3 if we have laps
		if (result.laps.length > 0) {
			log.debug("📍 Activating section 3 for CSV lap analysis...");
			deps.activateSection(3);

			// Same replication as the FIT path, for the same reason.
			await restoreStoredSection3();

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
