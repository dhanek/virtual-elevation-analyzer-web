import { FitFileProcessor } from "../../components/FitFileProcessor";
import { MapVisualization } from "../../components/MapVisualization";
import { AnalysisParametersComponent } from "../../components/AnalysisParameters";
import { ViewportAdapter } from "../../utils/ViewportAdapter";
import { ParameterStorage } from "../../utils/ParameterStorage";
import { ResultsStorage } from "../../utils/ResultsStorage";
import { DEMManager, ElevationProfileCache } from "../../utils/DEMManager";
import { RemoteDEMConfig } from "../../utils/RemoteDEMConfig";
import { RemoteDEMService } from "../../utils/RemoteDEMService";
import { MultiDEMManager } from "../../utils/MultiDEMManager";
import { WeatherCache } from "../../utils/WeatherCache";
import { log } from "../../utils/log";
import { AppState } from "../../state/AppState";
import {
	configureFileLoadOrchestration,
	handleFileSelection,
	initializeFitProcessor,
	processSelectedFile,
} from "../fileLoad/fileLoadOrchestration";
import {
	clearDEMFile,
	configureDemHandlers,
	handleDEMFileSelection,
	updateDEMSourceSelection,
} from "../dem/demHandlers";
import {
	configureAnalyzeOrchestrator,
	initializeAnalysisParameters,
	setupAnalyzeButton,
	updateAnalyzeButton,
} from "../analysis/analyzeOrchestrator";
import {
	configureSection3Orchestration,
	initializeSection3,
} from "../section3/section3Orchestration";

interface ShellDomElements {
	fitFileInput: HTMLInputElement;
	fileDropZone: HTMLDivElement;
	fileInfo: HTMLDivElement;
	fileDetails: HTMLDivElement;
	analyzeButton: HTMLButtonElement;
	loading: HTMLDivElement;
	loadingText: HTMLSpanElement;
	error: HTMLDivElement;
	results: HTMLDivElement;
	statisticsContent: HTMLDivElement;
	clearStorageButton: HTMLButtonElement;
	demFileInput: HTMLInputElement;
	demFileDropZone: HTMLDivElement;
	demFileInfo: HTMLDivElement;
	demFileName: HTMLSpanElement;
	demFileMetadata: HTMLDivElement;
	clearDemButton: HTMLButtonElement;
	remoteDEMSelector: HTMLSelectElement;
	localDEMFileSection: HTMLDivElement;
	remoteDEMStatus: HTMLDivElement;
}

export interface InitializeApplicationShellArgs {
	appState: AppState;
	parameterStorage: ParameterStorage;
	resultsStorage: ResultsStorage;
	demManager: DEMManager;
	elevationCache: ElevationProfileCache;
	multiDEMManager: MultiDEMManager;
	remoteDEMService: RemoteDEMService;
	dom: ShellDomElements;
}

function scrollToSection(sectionId: string): void {
	const section = document.getElementById(sectionId);
	if (!section) return;

	section.scrollIntoView({ behavior: "smooth", block: "start" });
}

function activateSection(sectionNumber: number): void {
	// Mark previous sections as completed
	for (let i = 1; i < sectionNumber; i++) {
		const numberEl = document.getElementById(`section${i}Number`);
		if (numberEl) {
			numberEl.classList.add("completed");
			numberEl.textContent = "✓";
		}
	}

	// Activate current section
	const sections = ["fileSection", "parametersSection", "analysisSection"];
	sections.forEach((sectionId, index) => {
		const section = document.getElementById(sectionId);
		if (section) {
			if (index + 1 <= sectionNumber) {
				section.classList.remove("inactive");
			} else {
				section.classList.add("inactive");
			}
		}
	});
}

export async function initializeApplicationShell(
	args: InitializeApplicationShellArgs,
): Promise<void> {
	const {
		appState,
		parameterStorage,
		resultsStorage,
		demManager,
		elevationCache,
		multiDEMManager,
		remoteDEMService,
		dom,
	} = args;

	let fitProcessor: FitFileProcessor | null = null;
	let mapVisualization: MapVisualization | null = null;
	let parametersComponent: AnalysisParametersComponent | null = null;

	function showLoading(message: string): void {
		dom.loadingText.textContent = message;
		dom.loading.classList.add("show");
		dom.analyzeButton.disabled = true;
	}

	function hideLoading(): void {
		dom.loading.classList.remove("show");
		dom.analyzeButton.disabled = false;
	}

	function showError(message: string): void {
		dom.error.textContent = message;
		dom.error.classList.remove("hidden");
	}

	function hideError(): void {
		dom.error.classList.add("hidden");
	}

	configureAnalyzeOrchestrator({
		appState,
		parameterStorage,
		resultsStorage,
		getMapVisualization: () => mapVisualization,
		getParametersComponent: () => parametersComponent,
		setParametersComponent: (component) => {
			parametersComponent = component;
		},
		initializeSection3,
		showLoading,
		hideLoading,
		showError,
	});

	configureSection3Orchestration({
		appState,
		parameterStorage,
		getMapVisualization: () => mapVisualization,
		setMapVisualization: (map) => {
			mapVisualization = map;
		},
		getParametersComponent: () => parametersComponent,
		updateAnalyzeButton,
		setupAnalyzeButton,
		showLoading,
		hideLoading,
		showError,
	});

	configureDemHandlers({
		appState,
		demManager,
		parameterStorage,
		demFileInfo: dom.demFileInfo,
		demFileName: dom.demFileName,
		demFileMetadata: dom.demFileMetadata,
		demFileInput: dom.demFileInput,
		localDEMFileSection: dom.localDEMFileSection,
		statisticsContent: dom.statisticsContent,
		results: dom.results,
		showLoading,
		hideLoading,
		showError,
		initializeAnalysisParameters,
		getParametersComponent: () => parametersComponent,
	});

	configureFileLoadOrchestration({
		appState,
		parameterStorage,
		resultsStorage,
		demManager,
		elevationCache,
		multiDEMManager,
		remoteDEMService,
		fileInfo: dom.fileInfo,
		fileDetails: dom.fileDetails,
		analyzeButton: dom.analyzeButton,
		remoteDEMStatus: dom.remoteDEMStatus,
		showLoading,
		hideLoading,
		showError,
		hideError,
		activateSection,
		scrollToSection,
		initializeAnalysisParameters,
		getParametersComponent: () => parametersComponent,
		setFitProcessor: (processor) => {
			fitProcessor = processor;
		},
		getFitProcessor: () => fitProcessor,
	});

	// File selection handlers
	dom.fileDropZone.addEventListener("click", () => {
		dom.fitFileInput.click();
	});

	dom.fitFileInput.addEventListener("change", (event) => {
		const target = event.target as HTMLInputElement;
		if (target.files && target.files.length > 0) {
			void handleFileSelection(target.files[0]);
		}
	});

	// Drag and drop handlers
	dom.fileDropZone.addEventListener("dragover", (event) => {
		event.preventDefault();
		dom.fileDropZone.classList.add("dragover");
	});

	dom.fileDropZone.addEventListener("dragleave", () => {
		dom.fileDropZone.classList.remove("dragover");
	});

	dom.fileDropZone.addEventListener("drop", (event) => {
		event.preventDefault();
		dom.fileDropZone.classList.remove("dragover");

		const files = event.dataTransfer?.files;
		if (files && files.length > 0) {
			void handleFileSelection(files[0]);
		}
	});

	// Analyze button handler
	dom.analyzeButton.addEventListener("click", () => {
		void processSelectedFile();
	});

	// DEM file selection handlers
	dom.demFileDropZone.addEventListener("click", () => {
		dom.demFileInput.click();
	});

	dom.demFileInput.addEventListener("change", async (event) => {
		const target = event.target as HTMLInputElement;
		if (target.files && target.files.length > 0) {
			await handleDEMFileSelection(target.files);
		}
	});

	dom.demFileDropZone.addEventListener("dragover", (event) => {
		event.preventDefault();
		dom.demFileDropZone.classList.add("dragover");
	});

	dom.demFileDropZone.addEventListener("dragleave", () => {
		dom.demFileDropZone.classList.remove("dragover");
	});

	dom.demFileDropZone.addEventListener("drop", async (event) => {
		event.preventDefault();
		dom.demFileDropZone.classList.remove("dragover");

		const files = event.dataTransfer?.files;
		if (files && files.length > 0) {
			await handleDEMFileSelection(files);
		}
	});

	dom.clearDemButton.addEventListener("click", () => {
		clearDEMFile();
	});

	dom.remoteDEMSelector.addEventListener("change", (event) => {
		updateDEMSourceSelection((event.target as HTMLSelectElement).value);
	});

	// Restore saved DEM preference
	const savedSources = RemoteDEMConfig.getPreferredSources();
	if (savedSources.length > 0 && savedSources.includes("aws-terrain")) {
		dom.remoteDEMSelector.value = "aws-terrain";
	} else if (savedSources.length === 0) {
		// Check if user explicitly saved "none"
		const raw = localStorage.getItem("remote-dem-sources");
		if (raw && JSON.parse(raw).length === 0) {
			dom.remoteDEMSelector.value = "none";
		}
	}
	updateDEMSourceSelection(dom.remoteDEMSelector.value);

	// Clear saved parameters and results button
	dom.clearStorageButton.addEventListener("click", async () => {
		if (
			confirm(
				"Are you sure you want to clear all saved parameters, results, AND weather cache? This cannot be undone.",
			)
		) {
			try {
				await parameterStorage.clearAll();
				await resultsStorage.clearAllResults();

				// Also clear weather cache
				const weatherCacheInstance = new WeatherCache();
				await weatherCacheInstance.clearCache();

				alert(
					"All saved parameters, results, and weather cache have been cleared.",
				);
			} catch (err) {
				log.error("Failed to clear storage:", err);
				alert("Failed to clear storage. Please try again.");
			}
		}
	});

	// Clean up on page unload
	window.addEventListener("beforeunload", () => {
		mapVisualization?.destroy();
	});

	// Initialize viewport adapter first
	const viewportAdapter = ViewportAdapter.getInstance();

	// Setup viewport change listener for map resizing
	viewportAdapter.onViewportChange(() => {
		// Update CSS custom properties for sidebar width
		const sidebarWidth = viewportAdapter.getOptimalSidebarWidth();
		document.documentElement.style.setProperty(
			"--sidebar-width",
			`${sidebarWidth}px`,
		);

		// Trigger map resize if map exists
		if (mapVisualization && mapVisualization.hasGpsData()) {
			// Map libraries usually need a resize trigger when container dimensions change
			mapVisualization.resizeMap();
		}
	});

	// Initialize FIT processor
	await initializeFitProcessor();
}
