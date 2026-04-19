import { AppState } from "../../state/AppState";
import { DEMManager } from "../../utils/DEMManager";
import {
	RemoteDEMConfig,
	type DEMSourceType,
} from "../../utils/RemoteDEMConfig";
import { ParameterStorage } from "../../utils/ParameterStorage";
import { AnalysisParametersComponent } from "../../components/AnalysisParameters";
import { AirDensityCalculator } from "../../../pkg/virtual_elevation_analyzer.js";
import type { GibliCsvData } from "../../utils/CsvParser";
import { log } from "../../utils/log";

interface DemHandlersDependencies {
	appState: AppState;
	demManager: DEMManager;
	parameterStorage: ParameterStorage;
	demFileInfo: HTMLDivElement;
	demFileName: HTMLSpanElement;
	demFileMetadata: HTMLDivElement;
	demFileInput: HTMLInputElement;
	localDEMFileSection: HTMLDivElement;
	statisticsContent: HTMLDivElement;
	results: HTMLDivElement;
	showLoading: (message: string) => void;
	hideLoading: () => void;
	showError: (message: string) => void;
	initializeAnalysisParameters: () => void;
	getParametersComponent: () => AnalysisParametersComponent | null;
}

let dependencies: DemHandlersDependencies | null = null;

function getDependencies(): DemHandlersDependencies {
	if (!dependencies) {
		throw new Error("DEM handlers are not configured");
	}
	return dependencies;
}

export function configureDemHandlers(
	nextDependencies: DemHandlersDependencies,
): void {
	dependencies = nextDependencies;
}

// DEM source selection: aws-terrain (default), none, local
export function updateDEMSourceSelection(value: string): void {
	const deps = getDependencies();

	// Show local file section only when "local" is selected
	deps.localDEMFileSection.classList.toggle("hidden", value !== "local");

	// Update description text
	const desc = document.getElementById("demDescription");
	if (desc) {
		switch (value) {
			case "aws-terrain":
				desc.textContent =
					"AWS Terrain Tiles are downloaded automatically to provide accurate elevation data.";
				break;
			case "none":
				desc.textContent =
					"Using the elevation recorded in the FIT file (GPS / barometer).";
				break;
			case "local":
				desc.textContent =
					"Upload a local GeoTIFF DEM file to use as elevation source.";
				break;
		}
	}

	// Set remote sources for AWS; clear for none/local
	if (value === "aws-terrain") {
		deps.appState.remoteDEMSources = ["aws-terrain"];
	} else {
		deps.appState.remoteDEMSources = [];
	}

	RemoteDEMConfig.setPreferredSources(
		value === "none" ? [] : [value as DEMSourceType],
	);
}

// DEM file handling functions
export async function handleDEMFileSelection(files: FileList): Promise<void> {
	const deps = getDependencies();

	try {
		deps.showLoading("Loading DEM file...");

		// Separate TIF, world, and projection files
		let tifFile: File | null = null;
		let worldFile: File | null = null;
		let projFile: File | null = null;

		for (let i = 0; i < files.length; i++) {
			const file = files[i];
			const fileName = file.name.toLowerCase();

			if (
				fileName.endsWith(".tif") ||
				fileName.endsWith(".tiff") ||
				fileName.endsWith(".vrt")
			) {
				tifFile = file;
			} else if (fileName.endsWith(".tfw") || fileName.endsWith(".tifw")) {
				worldFile = file;
			} else if (fileName.endsWith(".prj")) {
				projFile = file;
			}
		}

		if (!tifFile) {
			throw new Error("No .tif or .tiff file selected");
		}

		// Load DEM file with optional world and projection files
		await deps.demManager.loadDEMFile(
			tifFile,
			worldFile ?? undefined,
			projFile ?? undefined,
		);
		deps.appState.selectedDEMFile = tifFile;

		// Update UI
		deps.demFileInfo.classList.remove("hidden");
		const fileNames = [tifFile.name];
		if (worldFile) fileNames.push(worldFile.name);
		if (projFile) fileNames.push(projFile.name);
		const displayName = fileNames.join(" + ");
		deps.demFileName.textContent = displayName;

		// Show metadata
		const metadata = JSON.parse(deps.demManager.getDEMMetadata()!);
		const bounds = deps.demManager.getDEMBounds();
		deps.demFileMetadata.innerHTML = `
            <p>Size: ${metadata.width} × ${metadata.height} pixels</p>
            <p>Bounds: [${bounds![0].toFixed(2)}, ${bounds![1].toFixed(2)}, ${bounds![2].toFixed(2)}, ${bounds![3].toFixed(2)}]</p>
        `;

		deps.appState.elevationCorrectionEnabled = true;

		deps.hideLoading();
		log.debug("DEM file loaded successfully:", displayName);
	} catch (err) {
		deps.hideLoading();
		deps.showError(`Failed to load DEM file: ${err}`);
		clearDEMFile();
	}
}

export function clearDEMFile(): void {
	const deps = getDependencies();

	deps.demManager.clearDEM();
	deps.appState.selectedDEMFile = null;
	deps.demFileInfo.classList.add("hidden");
	deps.appState.elevationCorrectionEnabled = false;
	deps.demFileInput.value = "";
	deps.appState.elevationErrorRate = 0;
}

export async function displayResults(result: any): Promise<void> {
	const deps = getDependencies();

	const stats = result.parsing_statistics;
	const laps = result.laps;

	deps.statisticsContent.innerHTML = `
        <div class="stats-grid">
            <div class="stat-item">
                <div class="stat-label">File Size</div>
                <div class="stat-value">${formatFileSize(stats.file_size)}</div>
            </div>
            <div class="stat-item">
                <div class="stat-label">Records</div>
                <div class="stat-value">${stats.record_count.toLocaleString()}</div>
            </div>
            <div class="stat-item">
                <div class="stat-label">Duration</div>
                <div class="stat-value">${formatDuration(stats.duration_seconds)}</div>
            </div>
            <div class="stat-item">
                <div class="stat-label">Distance</div>
                <div class="stat-value">${formatDistance(stats.total_distance_m)}</div>
            </div>
            <div class="stat-item">
                <div class="stat-label">Avg Speed</div>
                <div class="stat-value">${formatSpeed(stats.avg_speed_ms)}</div>
            </div>
            <div class="stat-item">
                <div class="stat-label">Max Speed</div>
                <div class="stat-value">${formatSpeed(stats.max_speed_ms)}</div>
            </div>
            <div class="stat-item">
                <div class="stat-label">Avg Power</div>
                <div class="stat-value">${stats.has_power_data ? formatPower(stats.avg_power) : "N/A"}</div>
            </div>
            <div class="stat-item">
                <div class="stat-label">Max Power</div>
                <div class="stat-value">${stats.has_power_data ? formatPower(stats.max_power) : "N/A"}</div>
            </div>
            <div class="stat-item">
                <div class="stat-label">GPS Data</div>
                <div class="stat-value">${stats.has_gps_data ? "Yes" : "No"}</div>
            </div>
            <div class="stat-item">
                <div class="stat-label">Power Data</div>
                <div class="stat-value">${stats.has_power_data ? "Yes" : "No"}</div>
            </div>
        </div>

        ${
					laps.length > 0
						? `
        <div style="margin-top: 1.5rem; padding: 1rem; background: #f0fff4; border: 1px solid #38a169; border-radius: 4px; color: #2d7a52;">
            File analyzed successfully! Found ${laps.length} lap${laps.length > 1 ? "s" : ""} with ${stats.has_gps_data ? "GPS data" : "no GPS data"}.
            ${stats.has_gps_data ? "Map and lap selection are now available below." : ""}
        </div>
        `
						: ""
				}

        ${
					deps.appState.elevationCorrectionEnabled &&
					deps.appState.selectedDEMFile
						? `
        <div style="margin-top: 1.5rem; padding: 1rem; background: #e8f5e9; border-left: 4px solid #4caf50; border-radius: 4px;">
            <h4 style="margin: 0 0 0.5rem 0; color: #2d7a52;">📊 Elevation Correction Applied</h4>
            <p style="margin: 0 0 0.5rem 0; color: #2d7a52;"><strong>DEM file:</strong> ${deps.appState.selectedDEMFile.name}</p>
            <p style="margin: 0 0 0.5rem 0; color: #2d7a52;">
                <strong>Successfully corrected:</strong> ${(100 - deps.appState.elevationErrorRate * 100).toFixed(1)}%
            </p>
            ${
							deps.appState.elevationErrorRate > 0.01
								? `
            <p style="margin: 0; color: #f57c00; font-weight: 500;">
                ⚠️ ${(deps.appState.elevationErrorRate * 100).toFixed(1)}% of points used GPS fallback (DEM lookup failed)
            </p>
            `
								: ""
						}
        </div>
        `
						: ""
				}
    `;

	deps.results.classList.remove("hidden");

	// Initialize analysis parameters component immediately
	deps.appState.isLoadingParameters = true; // Prevent saving during initialization
	deps.initializeAnalysisParameters();

	const parametersComponent = deps.getParametersComponent();

	// Try to load saved parameters for this file
	if (deps.appState.currentFileHash && parametersComponent) {
		const savedParameters = await deps.parameterStorage.loadParameters(
			deps.appState.currentFileHash,
		);
		if (savedParameters) {
			// Load saved parameters (preserves user's preference for auto-rho)
			parametersComponent.setParameters(savedParameters);
		} else {
			// First time loading this file - apply smart defaults

			// Determine correct air_speed_offset default based on wind data source
			const fitData = result.fit_data;
			const hasAirSpeed =
				fitData.air_speed &&
				(Array.from(fitData.air_speed) as number[]).some(
					(v: number) => !isNaN(v) && v !== 0,
				);
			const defaultAirSpeedOffset = hasAirSpeed ? 2 : 0;

			const smartDefaults: any = {
				air_speed_offset: defaultAirSpeedOffset,
			};

			// Auto-enable velodrome mode if no GPS data
			if (!result.parsing_statistics.has_gps_data) {
				smartDefaults.velodrome = true;
			}
			// Auto-enable auto-rho if HAS GPS data
			else if (result.parsing_statistics.has_gps_data) {
				smartDefaults.auto_calculate_rho = true;
				log.debug("📍 GPS data detected - auto-rho enabled by default");
			}

			parametersComponent.setParameters(smartDefaults);
			log.debug(
				`📊 Set air_speed_offset default to ${defaultAirSpeedOffset}s (hasAirSpeed: ${hasAirSpeed})`,
			);
		}
	}

	deps.appState.isLoadingParameters = false; // Re-enable saving after load complete

	// Update appState.previousAutoLapDetection to match loaded parameters
	deps.appState.previousAutoLapDetection =
		deps.appState.currentParameters?.auto_lap_detection || "None";
}

// Utility functions
export function formatFileSize(bytes: number): string {
	const sizes = ["Bytes", "KB", "MB", "GB"];
	if (bytes === 0) return "0 Bytes";
	const i = Math.floor(Math.log(bytes) / Math.log(1024));
	return Math.round((bytes / Math.pow(1024, i)) * 100) / 100 + " " + sizes[i];
}

export function formatDuration(seconds: number): string {
	const hours = Math.floor(seconds / 3600);
	const minutes = Math.floor((seconds % 3600) / 60);
	const secs = Math.floor(seconds % 60);

	if (hours > 0) {
		return `${hours}:${minutes.toString().padStart(2, "0")}:${secs.toString().padStart(2, "0")}`;
	}

	return `${minutes}:${secs.toString().padStart(2, "0")}`;
}

export function formatDistance(meters: number): string {
	if (meters >= 1000) {
		return `${(meters / 1000).toFixed(1)} km`;
	}

	return `${meters.toFixed(0)} m`;
}

export function formatSpeed(ms: number): string {
	const kmh = ms * 3.6;
	return `${kmh.toFixed(1)} km/h`;
}

export function formatPower(watts: number): string {
	return `${watts.toFixed(0)} W`;
}

export function calculateAvgCda(csvData: GibliCsvData): number {
	if (!csvData.cdaReference) return 0;
	const validCda = csvData.cdaReference.filter((v) => !isNaN(v));
	if (validCda.length === 0) return 0;
	return validCda.reduce((sum, v) => sum + v, 0) / validCda.length;
}

export function calculateRhoArrayFromFitData(fitData: any): number[] | null {
	// Check if data has all required environmental data
	if (!fitData.temperature || !fitData.humidity || !fitData.pressure) {
		log.debug("📊 No environmental data available, using single rho parameter");
		return null;
	}

	const rhoArray: number[] = [];
	let successCount = 0;
	let failureCount = 0;

	for (let i = 0; i < fitData.timestamps.length; i++) {
		const temp = fitData.temperature[i];
		const humidity = fitData.humidity[i];
		const pressure = fitData.pressure[i];

		// Skip invalid data points
		if (isNaN(temp) || isNaN(humidity) || isNaN(pressure)) {
			rhoArray.push(1.225); // Use standard air density as fallback
			failureCount++;
			continue;
		}

		try {
			// Calculate air density from temperature, humidity, and pressure
			const rho = AirDensityCalculator.calculate_air_density_from_humidity(
				temp,
				pressure,
				humidity,
			);
			rhoArray.push(rho);
			successCount++;
		} catch (err) {
			log.warn(`Failed to calculate rho at index ${i}:`, err);
			rhoArray.push(1.225); // Use standard air density as fallback
			failureCount++;
		}
	}

	log.debug("📊 Per-datapoint rho calculation:", {
		totalPoints: fitData.timestamps.length,
		successCount,
		failureCount,
		sampleRho: rhoArray.slice(0, 5),
		avgRho: (rhoArray.reduce((sum, r) => sum + r, 0) / rhoArray.length).toFixed(
			4,
		),
		minRho: Math.min(...rhoArray).toFixed(4),
		maxRho: Math.max(...rhoArray).toFixed(4),
	});

	return rhoArray;
}
