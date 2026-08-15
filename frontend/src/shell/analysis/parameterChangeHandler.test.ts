/**
 * @vitest-environment jsdom
 *
 * N-4 — the PARAMETERS FORM must recalculate in every mode.
 *
 * `handleParametersChange` used to end by dispatching a synthetic `input` event
 * on `#trimStartSlider`. That id exists in ONE template — Standard's — so rho,
 * system mass, eta, velodrome, constant wind speed/direction and the air-speed
 * offset silently failed to recalculate in GPS-lap and out-and-back: the element
 * lookup returned null and the function simply did nothing. This is ROADMAP SC#3
 * stated as an existing bug (D-17b). The fix is one `requestModeUpdate`, which
 * resolves the handler from the mode that is actually on screen.
 *
 * WHAT THIS FILE REPLACED, AND WHY IT IS WORTH SAYING. The previous version of
 * this file imported NOTHING from production. It stubbed `document`, built a
 * mock slider, re-implemented the orchestrator's `if` in the test body, and
 * asserted that its own mock had been called — plus six cases of the form
 * `const flowWorks = true; expect(flowWorks).toBe(true)`. It was green
 * throughout the entire period the defect above was live, and it would have
 * stayed green through this fix and through any regression of it. It is the
 * cleanest example in the repo of the vacuous guard this phase keeps finding, so
 * the filename is kept and the contents are rewritten.
 *
 * The real `handleParametersChange` runs here, against the real dependency
 * seam. Only the funnel is faked — it is the observation point — and
 * `getGpsAnalysisMode`, so the suite can say which mode is live without driving
 * the whole Section 3 UI.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const funnel = vi.hoisted(() => ({ request: vi.fn() }));

vi.mock("./requestModeUpdate", async (importOriginal) => ({
	...(await importOriginal<Record<string, unknown>>()),
	requestModeUpdate: (...args: unknown[]) => funnel.request(...args),
}));

const modeState = vi.hoisted(() => ({ gps: "None" as string }));

vi.mock("../section3/section3Orchestration", async (importOriginal) => ({
	...(await importOriginal<Record<string, unknown>>()),
	getGpsAnalysisMode: () => modeState.gps,
}));

import type { AnalysisParameters } from "../../components/AnalysisParameters";
import type { AppState } from "../../state/AppState";
import type { ParameterStorage } from "../../utils/ParameterStorage";
import type { ResultsStorage } from "../../utils/ResultsStorage";
import {
	configureAnalyzeOrchestrator,
	handleParametersChange,
} from "./analyzeOrchestrator";

const params = {
	system_mass: 80,
	rho: 1.2,
	eta: 0.98,
	cda: 0.3,
	crr: 0.005,
	air_speed_offset: 2,
	auto_calculate_rho: false,
	velodrome: false,
} as unknown as AnalysisParameters;

let saved: unknown[][];

function makeAppState(): AppState {
	return {
		currentParameters: { ...params },
		currentFitData: { timestamps: [0, 1, 2] },
		currentFileHash: "hash",
		selectedFile: { name: "ride.fit" },
		isLoadingParameters: false,
		isCalculatingAutoRho: false,
	} as unknown as AppState;
}

function configure(appState: AppState): void {
	configureAnalyzeOrchestrator({
		appState,
		parameterStorage: {
			saveParameters: (...args: unknown[]) => {
				saved.push(args);
				return Promise.resolve();
			},
		} as unknown as ParameterStorage,
		resultsStorage: {} as unknown as ResultsStorage,
		// No map, so the wind-indicator branch is inert and cannot mask the
		// assertion below by throwing.
		getMapVisualization: () => null,
		getParametersComponent: () => null,
		setParametersComponent: () => {},
		initializeSection3: () => {},
		showLoading: () => {},
		hideLoading: () => {},
		showError: () => {},
	});
}

/**
 * The host page WITHOUT any Standard markup — no `#trimStartSlider`, no sliders
 * of any kind. This is the GPS panel's shape as far as this function is
 * concerned, and rendering trim markup "just in case" would let the GPS cases
 * below pass for the wrong reason.
 */
function renderVisibleVeSection(): void {
	document.body.innerHTML = `<div id="veAnalysisSection"></div>`;
}

beforeEach(() => {
	saved = [];
	funnel.request.mockClear();
	modeState.gps = "None";
	document.body.innerHTML = "";
	configure(makeAppState());
});

afterEach(() => {
	document.body.innerHTML = "";
});

describe("handleParametersChange reaches the funnel", () => {
	it("asks for exactly one update when the VE panel is on screen", () => {
		renderVisibleVeSection();

		handleParametersChange({ ...params, rho: 1.25 } as AnalysisParameters);

		expect(funnel.request).toHaveBeenCalledTimes(1);
		expect(funnel.request).toHaveBeenCalledWith("parameters");
	});

	it("still saves the parameters it was handed", () => {
		// The recalculation is the change; the persistence above it is not, and a
		// rewrite that quietly dropped it would be a regression this file should
		// see.
		renderVisibleVeSection();

		handleParametersChange({ ...params, rho: 1.25 } as AnalysisParameters);

		expect(saved).toHaveLength(1);
		expect(saved[0][0]).toBe("hash");
	});

	it.each([
		["GPS based lap splitting", "gpsLap"],
		["Out and back", "outAndBack"],
	])(
		"asks for the update in %s, where there is no #trimStartSlider at all",
		(mode) => {
			// THE N-4 REGRESSION TEST. Against the old implementation this fails by
			// construction: it looked up `#trimStartSlider`, found null in a GPS
			// panel, and returned having done nothing at all. Asserting the DOM is
			// genuinely without that element is part of the test, not a comment —
			// if a future fixture adds Standard markup here, the guard goes vacuous
			// and this line is what stops it.
			modeState.gps = mode;
			renderVisibleVeSection();
			expect(document.getElementById("trimStartSlider")).toBeNull();

			handleParametersChange({ ...params, rho: 1.25 } as AnalysisParameters);

			expect(funnel.request).toHaveBeenCalledTimes(1);
			expect(funnel.request).toHaveBeenCalledWith("parameters");
		},
	);
});

describe("handleParametersChange leaves the funnel alone when it should", () => {
	it("does not ask while parameters are being loaded from storage", () => {
		const appState = makeAppState();
		appState.isLoadingParameters = true;
		configure(appState);
		renderVisibleVeSection();

		handleParametersChange({ ...params, rho: 1.25 } as AnalysisParameters);

		expect(funnel.request).not.toHaveBeenCalled();
		expect(saved).toHaveLength(0);
	});

	it("does not ask when there is no file to save against", () => {
		const appState = makeAppState();
		(appState as unknown as { currentFileHash: string | null }).currentFileHash =
			null;
		configure(appState);
		renderVisibleVeSection();

		handleParametersChange({ ...params, rho: 1.25 } as AnalysisParameters);

		expect(funnel.request).not.toHaveBeenCalled();
	});
});

/**
 * The VISIBILITY guard did not disappear with the dispatch — it moved into the
 * funnel (`isVeSectionVisible`), which is why these cases assert the funnel is
 * still CALLED rather than that nothing happens. The funnel is faked here, so
 * what this file can honestly say is "the orchestrator no longer carries its own
 * copy of the class-name check"; that the check still fires is
 * `requestModeUpdate`'s own guard, asserted where it lives.
 */
describe("the visibility check moved rather than vanished", () => {
	it("no longer decides visibility for itself when the panel is hidden", () => {
		document.body.innerHTML = `<div id="veAnalysisSection" class="hidden"></div>`;

		handleParametersChange({ ...params, rho: 1.25 } as AnalysisParameters);

		// One call, unconditionally: the orchestrator asks, and the funnel is the
		// one place that answers. Two copies of the answer is how they drift.
		expect(funnel.request).toHaveBeenCalledTimes(1);
	});

	it("asks even with no VE panel in the DOM at all", () => {
		expect(document.getElementById("veAnalysisSection")).toBeNull();

		handleParametersChange({ ...params, rho: 1.25 } as AnalysisParameters);

		expect(funnel.request).toHaveBeenCalledTimes(1);
	});
});
