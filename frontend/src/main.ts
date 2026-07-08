import { AppState } from "./state/AppState";
import { ParameterStorage } from "./utils/ParameterStorage";
import { ResultsStorage } from "./utils/ResultsStorage";
import { DEMManager, ElevationProfileCache } from "./utils/DEMManager";
import { RemoteDEMService } from "./utils/RemoteDEMService";
import { MultiDEMManager } from "./utils/MultiDEMManager";
import { initializeApplicationShell } from "./shell/app/initializeApplication";
import { log } from "./utils/log";

// DOM elements
const fitFileInput = document.getElementById(
	"fitFileInput",
) as HTMLInputElement;
const fileDropZone = document.getElementById("fileDropZone") as HTMLDivElement;
const fileInfo = document.getElementById("fileInfo") as HTMLDivElement;
const fileDetails = document.getElementById("fileDetails") as HTMLDivElement;
const analyzeButton = document.getElementById(
	"analyzeButton",
) as HTMLButtonElement;
const loading = document.getElementById("loading") as HTMLDivElement;
const loadingText = document.getElementById("loadingText") as HTMLSpanElement;
const error = document.getElementById("error") as HTMLDivElement;
const results = document.getElementById("results") as HTMLDivElement;
const statisticsContent = document.getElementById(
	"statisticsContent",
) as HTMLDivElement;
const clearStorageButton = document.getElementById(
	"clearStorageButton",
) as HTMLButtonElement;

// DEM-related DOM elements
const demFileInput = document.getElementById(
	"demFileInput",
) as HTMLInputElement;
const demFileDropZone = document.getElementById(
	"demFileDropZone",
) as HTMLDivElement;
const demFileInfo = document.getElementById("demFileInfo") as HTMLDivElement;
const demFileName = document.getElementById("demFileName") as HTMLSpanElement;
const demFileMetadata = document.getElementById(
	"demFileMetadata",
) as HTMLDivElement;
const clearDemButton = document.getElementById(
	"clearDemButton",
) as HTMLButtonElement;

// DEM source selector & status
const remoteDEMSelector = document.getElementById(
	"remoteDEMSelector",
) as HTMLSelectElement;
const localDEMFileSection = document.getElementById(
	"localDEMFileSection",
) as HTMLDivElement;
const remoteDEMStatus = document.getElementById(
	"remoteDEMStatus",
) as HTMLDivElement;

// Composition root service construction
const appState = new AppState();
const parameterStorage = new ParameterStorage();
const resultsStorage = new ResultsStorage();
const demManager = new DEMManager();
const elevationCache = new ElevationProfileCache();
const multiDEMManager = new MultiDEMManager();
const remoteDEMService = new RemoteDEMService();

// Initialize the application shell
initializeApplicationShell({
	appState,
	parameterStorage,
	resultsStorage,
	demManager,
	elevationCache,
	multiDEMManager,
	remoteDEMService,
	dom: {
		fitFileInput,
		fileDropZone,
		fileInfo,
		fileDetails,
		analyzeButton,
		loading,
		loadingText,
		error,
		results,
		statisticsContent,
		clearStorageButton,
		demFileInput,
		demFileDropZone,
		demFileInfo,
		demFileName,
		demFileMetadata,
		clearDemButton,
		remoteDEMSelector,
		localDEMFileSection,
		remoteDEMStatus,
	},
}).catch((err) => {
	log.error("Failed to initialize application:", err);
	loading.classList.remove("loading--show");
	error.textContent = `Failed to initialize application: ${err.message}`;
	error.classList.remove("hidden");
});
