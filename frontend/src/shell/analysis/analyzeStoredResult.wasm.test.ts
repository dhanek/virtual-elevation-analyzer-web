/**
 * @vitest-environment jsdom
 *
 * WR-4 ON A REAL RIDE, THROUGH REAL WASM.
 *
 * `gpsModeRealChain.test.ts` holds the same property, but its calculator is a
 * stub returning a CONSTANT `r2: 0.5` for every input. Against a constant, "the
 * seeded result equals the one the first update writes" cannot tell a shared
 * code path from any two code paths — both would agree on 0.5. It proves the
 * wiring; it cannot prove the number.
 *
 * So this file drives the real GPS-lap analyze entry point over the anonymised
 * golden ride (1436 samples, 7 laps) with the REAL Rust calculator, and asks the
 * question WR-4 actually poses:
 *
 *     is the r2/RMSE that Store Result would persist the same r2/RMSE the panel
 *     painted on screen?
 *
 * The screen is observed where it is actually written: `renderGpsLapVEPlots`
 * takes the stats object it paints the header spans from
 * (`gpsLapPlots.ts:663-680`), so capturing that argument captures what the user
 * is looking at. Nothing else here is mocked — not the calculator, not the wind
 * resolution, not the aggregation, not the summarize seam.
 */
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
	afterEach,
	beforeAll,
	beforeEach,
	describe,
	expect,
	it,
	vi,
} from "vitest";

/** Every stats object the panel was painted with, in order. */
const painted = vi.hoisted(() => [] as Array<Record<string, number>>);

vi.mock("../gpsLap/gpsLapPlots", async (importOriginal) => {
	const actual = await importOriginal<Record<string, unknown>>();
	return {
		...actual,
		// Plotly is the only thing jsdom genuinely cannot run. The stats
		// argument is passed through untouched, which is the observation point.
		renderGpsLapVEPlots: (
			_profiles: unknown,
			_meanElevation: unknown,
			stats: Record<string, number>,
		) => {
			painted.push(stats);
		},
		renderGpsLapWindPlot: () => {},
		renderGpsLapPowerPlot: () => {},
		renderGpsLapVdPlot: () => {},
	};
});

const modeState = vi.hoisted(() => ({ gps: "GPS based lap splitting" }));

vi.mock("../section3/section3Orchestration", async (importOriginal) => ({
	...(await importOriginal<Record<string, unknown>>()),
	getGpsAnalysisMode: () => modeState.gps,
}));

import { initSync } from "@wasm/virtual_elevation_analyzer.js";
import { createVeCalculator } from "../../analysis/VeCalculatorFactory";
import { getNormalizedActivityArrays } from "../../analysis/ActivityArrayCache";
import { resolveWindSeries } from "../../analysis/WindSourceResolver";
import {
	isGoldenRidePresent,
	loadGoldenRide,
} from "../../analysis/__fixtures__/loadGoldenRide";
import type { AppState } from "../../state/AppState";
import type { ParameterStorage } from "../../utils/ParameterStorage";
import type { ResultsStorage } from "../../utils/ResultsStorage";
import type { ShellServices } from "./types";
import { showGpsLapVEAnalysis } from "../gpsLap/renderGpsLap";
import { clearModeUpdateCallbacks } from "./modeUpdateCallbacks";
import { resetRecomputeThrottle } from "./recomputeRunner";
import { resetModeUpdateRequests } from "./requestModeUpdate";

// cwd-relative, not `import.meta.url`: under jsdom that is an `http:` URL and
// `fileURLToPath` throws. Vitest's cwd is the frontend package root.
const WASM_PATH = resolve(
	process.cwd(),
	"pkg/virtual_elevation_analyzer_bg.wasm",
);

const ready = existsSync(WASM_PATH) && isGoldenRidePresent();

const CDA = 0.28;
const CRR = 0.005;

function makeServices(appState: AppState): ShellServices {
	return {
		appState,
		showLoading: () => {},
		hideLoading: () => {},
		showError: () => {},
	};
}

/** Drain the recompute throttle so the post-bind kick's pass runs. */
async function settle(): Promise<void> {
	await vi.advanceTimersByTimeAsync(500);
}

describe.skipIf(!ready)("WR-4 on the golden ride, through real WASM", () => {
	let appState: AppState;
	let ride: ReturnType<typeof loadGoldenRide>;

	beforeAll(() => {
		initSync({ module: readFileSync(WASM_PATH) });
	});

	beforeEach(async () => {
		vi.useFakeTimers();
		Element.prototype.scrollIntoView = () => {};
		painted.length = 0;
		clearModeUpdateCallbacks();
		resetModeUpdateRequests();

		document.body.innerHTML = `
			<div id="veAnalysisSection">
				<div id="veAnalysisContent"></div>
			</div>
		`;

		ride = loadGoldenRide();
		appState = {
			currentFitData: ride.fitData,
			currentParameters: { ...ride.params, cda: CDA, crr: CRR },
			currentGpsLapIndexRanges: ride.indexRanges,
			currentLaps: ride.laps,
			selectedLaps: ride.laps.map((_, i) => i + 1),
			currentAnalyzedLaps: [],
			gpsDetectedLaps: [],
			gpsSelectedLaps: [],
			airSpeedCalibrationPercent: 0,
			currentWindSource: "none",
			currentVirtualDistances: [],
			currentCoveredItems: null,
			currentVEResult: null,
			currentFilteredData: null,
			activeDisplayProfile: "fit-raw",
			isCalculatingAutoRho: false,
			demProfilesAvailable: true,
		} as unknown as AppState;

		// The REAL analyze entry point: it computes the per-lap fits, renders the
		// real sidebar, binds the real controls and fires the post-bind kick.
		await showGpsLapVEAnalysis(
			makeServices(appState),
			{} as unknown as ParameterStorage,
			{} as unknown as ResultsStorage,
			async () => ({}),
			ride.indexRanges,
			ride.fitData,
			appState.currentParameters!,
			0,
		);
	});

	afterEach(() => {
		resetRecomputeThrottle();
		vi.useRealTimers();
		clearModeUpdateCallbacks();
		resetModeUpdateRequests();
	});

	/**
	 * THE claim, stated as WR-4 stated it: what Store Result would persist is
	 * what the screen showed.
	 *
	 * `storageHandlers.ts:314` persists `appState.currentVEResult` verbatim, and
	 * `gpsLapPlots.ts:668-673` paints the header spans from `stats.meanR2` /
	 * `stats.meanRMSE`. Those two numbers have to be the same number.
	 */
	it("stores the r2 and RMSE the panel was painted with", async () => {
		await settle();

		const onScreen = painted[painted.length - 1];
		const stored = appState.currentVEResult!;

		expect(onScreen).toBeDefined();
		expect(stored).not.toBeNull();

		// ANTI-VACUITY, and it is needed here: at CdA 0.28 / Crr 0.005 this ride
		// fits badly enough that every lap's r2 clamps to 0, so the r2 equality
		// below is 0 === 0 and proves nothing on its own. RMSE is the number
		// carrying the signal -- 7.81 m, agreeing to fifteen digits -- and this
		// guard is what stops a regression that zeroes EVERYTHING from passing
		// the pair. (The golden literals reach r2 0.25-0.31 on this ride under
		// the primitive's own harness; the difference is configuration, not
		// correctness. Both sides here are the same configuration, which is the
		// only thing this file asserts.)
		expect(stored.rmse).toBeGreaterThan(1);

		expect(stored.r2).toBeCloseTo(onScreen.meanR2, 12);
		expect(stored.rmse).toBeCloseTo(onScreen.meanRMSE, 12);
	});

	/**
	 * THE NEGATIVE CONTROL, and the reason this file is worth its weight.
	 *
	 * The equality above would also hold if both sides were wrong together, so
	 * this pins what the stored value must NOT be: the fit
	 * `prepareAnalysisPayload` used to run and `analyzeOrchestrator` used to
	 * assign -- ONE integration over the CONCATENATED selection, no trim window,
	 * wind source forced to `"fit"` with the offset off.
	 *
	 * That code is deleted, so it is reproduced here deliberately, as a control.
	 * This is the one place in the suite where re-implementing production is the
	 * right move: the subject is a value the app must no longer produce, and
	 * there is nothing left to call.
	 */
	it("does not store the stitched whole-selection fit the old path assigned", async () => {
		await settle();

		const normalized = getNormalizedActivityArrays(ride.fitData);
		const wind = resolveWindSeries({
			fitData: ride.fitData,
			windSource: "fit",
			applyOffset: false,
		});

		// The concatenated selection, exactly as the deleted code built it.
		const idx: number[] = [];
		for (const range of ride.indexRanges) {
			for (let i = range.startIdx; i <= range.endIdx; i++) idx.push(i);
		}
		const pick = (source: ArrayLike<number>) => idx.map((i) => source[i]);

		const stitched = createVeCalculator({
			timestamps: pick(normalized.timestamps),
			power: pick(normalized.power),
			velocity: pick(normalized.velocity),
			positionLat: pick(normalized.positionLat),
			positionLong: pick(normalized.positionLong),
			altitude: pick(normalized.altitude),
			distance: pick(normalized.distance),
			windSpeed: pick(wind.windSpeed),
			params: appState.currentParameters!,
			cda: CDA,
			crr: CRR,
		}).calculate_virtual_elevation(CDA, CRR, 0, idx.length - 1) as {
			r2: number;
			rmse: number;
		};

		const stored = appState.currentVEResult!;

		// Both are real fits of the same ride, so this is a claim about
		// SEGMENTATION: 7 per-lap integrations do not average to one integration
		// over the concatenation. If this ever passes by coincidence the ride
		// fixture has become degenerate, not the code correct.
		// Measured, so the margin is on the record rather than implied: the
		// stitched fit reports RMSE 55.33 m where the panel shows 7.81 m. That
		// gap IS the WR-4 defect -- what Store Result used to persist against
		// what the user was looking at.
		expect(stitched.rmse).toBeGreaterThan(50);
		expect(stored.rmse).toBeLessThan(10);
		expect(stored.rmse).not.toBeCloseTo(stitched.rmse, 4);
	});

	/**
	 * The trap the WR-4 re-scoping note called out: a seed that does not
	 * reproduce the first update is the same defect relocated. On a constant
	 * calculator that is cheap to satisfy; on real WASM over a real ride it is
	 * an exact-equality claim about seven independent fits.
	 */
	it("does not move when the first control gesture changes nothing", async () => {
		await settle();

		const before = appState.currentVEResult!;
		const snapshot = { r2: before.r2, rmse: before.rmse };

		const slider = document.getElementById("cdaSlider") as HTMLInputElement;
		slider.dispatchEvent(new Event("input", { bubbles: true }));
		await settle();

		const after = appState.currentVEResult!;
		expect(after.r2).toBe(snapshot.r2);
		expect(after.rmse).toBe(snapshot.rmse);
	});
});

/**
 * DOES THE PANEL JUMP WHEN THE KICK LANDS?
 *
 * The kick repaints the panel one macrotask after Analyze. If the analyze leg
 * and the primitive compute the same numbers, that repaint is invisible and
 * costs only time. If they DISAGREE, the user watches the plot and the header
 * change by themselves right after pressing Analyze.
 *
 * This is not checkable by eye -- a macrotask is not a duration a person can
 * resolve -- so it is checked by capturing what the panel was painted with on
 * each pass and comparing the numbers. `painted[0]` is the analyze leg's own
 * paint; `painted[last]` is the kick's.
 *
 * RHO IS THE AXIS UNDER TEST. The golden fixture zero-fills `air_density_data`,
 * so `resolveRhoArray` returns null for it and BOTH passes fall back to the
 * constant `params.rho` -- which would make this comparison agree for the one
 * reason that proves nothing. The ride's real per-point series is carried
 * separately by the fixture, so it is installed here to put the two passes on
 * the axis that can actually separate them.
 */
describe.skipIf(!ready)("the analyze paint and the kick's repaint", () => {
	beforeAll(() => {
		initSync({ module: readFileSync(WASM_PATH) });
	});

	beforeEach(async () => {
		vi.useFakeTimers();
		Element.prototype.scrollIntoView = () => {};
		painted.length = 0;
		clearModeUpdateCallbacks();
		resetModeUpdateRequests();
		document.body.innerHTML = `
			<div id="veAnalysisSection">
				<div id="veAnalysisContent"></div>
			</div>
		`;

		const ride = loadGoldenRide();
		// The real per-point air density, where `resolveRhoArray` looks for it.
		const fitData = {
			...ride.fitData,
			air_density_data: ride.rhoArray,
		} as typeof ride.fitData;

		const appState = {
			currentFitData: fitData,
			currentParameters: { ...ride.params, cda: CDA, crr: CRR },
			currentGpsLapIndexRanges: ride.indexRanges,
			currentLaps: ride.laps,
			selectedLaps: ride.laps.map((_, i) => i + 1),
			currentAnalyzedLaps: [],
			gpsDetectedLaps: [],
			gpsSelectedLaps: [],
			airSpeedCalibrationPercent: 0,
			currentWindSource: "none",
			currentVirtualDistances: [],
			currentCoveredItems: null,
			currentVEResult: null,
			currentFilteredData: null,
			activeDisplayProfile: "fit-raw",
			isCalculatingAutoRho: false,
			demProfilesAvailable: true,
		} as unknown as AppState;

		await showGpsLapVEAnalysis(
			makeServices(appState),
			{} as unknown as ParameterStorage,
			{} as unknown as ResultsStorage,
			async () => ({}),
			ride.indexRanges,
			fitData,
			appState.currentParameters!,
			0,
		);
	});

	afterEach(() => {
		resetRecomputeThrottle();
		vi.useRealTimers();
		clearModeUpdateCallbacks();
		resetModeUpdateRequests();
	});

	it("paints the same numbers, so the repaint is invisible", async () => {
		const firstPaint = painted[0];
		expect(firstPaint).toBeDefined();

		await settle();

		const afterKick = painted[painted.length - 1];
		expect(painted.length).toBeGreaterThan(1);

		// Anti-vacuity: a fit that collapsed to zeros would agree trivially.
		expect(afterKick.meanRMSE).toBeGreaterThan(1);

		expect(firstPaint.meanRMSE).toBeCloseTo(afterKick.meanRMSE, 9);
		expect(firstPaint.meanR2).toBeCloseTo(afterKick.meanR2, 9);
		expect(firstPaint.closingError).toBeCloseTo(afterKick.closingError, 9);
	});
});
