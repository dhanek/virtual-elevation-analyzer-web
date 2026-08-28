// @vitest-environment jsdom
import { beforeEach, describe, expect, test, vi } from "vitest";
import { AppState } from "../../state/AppState";
import { AnalysisParametersComponent } from "../../components/AnalysisParameters";
import { WeatherAPIError } from "../../utils/WeatherAPI";
import type { ShellServices } from "../analysis/types";
import {
	AUTO_RHO_FAILURE_MESSAGE,
	WEATHER_FAILURE_GENERIC_MESSAGE,
} from "./weatherFallback";

/**
 * TEST-01 (autoRho half) — the behaviour `weatherFallback.test.ts` cannot see.
 *
 * `weatherFallback.ts` is a pure mapping; the *contract* that a weather outage
 * degrades gracefully lives here, in the caller:
 *
 *  - T-06-08: a failed fetch resolves to `null` (never rejects), leaves the
 *    existing rho in place, and clears `isCalculatingAutoRho` so auto-rho is
 *    not dead for the rest of the session.
 *  - CR-01: a failed *re-fetch* must not leave the previous trim region's
 *    weather payload attached to the current one — the provenance is dropped.
 *  - WR-01: the flag is cleared structurally (a `finally`), so even a throw
 *    from inside a catch handler cannot strand it.
 *  - WR-05: a `WeatherAPIError` that reaches the *outer* catch is a bug in the
 *    auto-rho path, not an outage, and must stay severity `error`.
 */

const mocks = vi.hoisted(() => ({
	getWeatherData: vi.fn(),
	updateCachedEntry: vi.fn(),
	calculateAirDensity: vi.fn(),
	showNotification: vi.fn(),
}));

vi.mock("../dom/notifications", () => ({
	showNotification: mocks.showNotification,
}));

vi.mock("../../utils/WeatherCache", () => ({
	WeatherCache: class {
		getWeatherData = mocks.getWeatherData;
		updateCachedEntry = mocks.updateCachedEntry;
	},
}));

vi.mock("../../../pkg/virtual_elevation_analyzer.js", () => ({
	AirDensityCalculator: { calculate_air_density: mocks.calculateAirDensity },
}));

// Imported after the mocks so the module under test picks them up.
const { calculateAutoRho } = await import("./autoRho");

/** Two spatially distinct halves, so T1 and T2 produce different query keys. */
const REGION_POINTS = 12;
const T1 = { start: 0, end: 5 };
const T2 = { start: 6, end: 11 };

const BASE_TS = Math.floor(Date.UTC(2026, 5, 1, 10, 0, 0) / 1000);

function makeFilteredLapData() {
	const position_lat: number[] = [];
	const position_long: number[] = [];
	const timestamps: number[] = [];
	for (let i = 0; i < REGION_POINTS; i++) {
		// First half near 47°N, second half near 48°N — a real trim move.
		position_lat.push(i < REGION_POINTS / 2 ? 47.1 + i * 0.001 : 48.2 + i * 0.001);
		position_long.push(i < REGION_POINTS / 2 ? 8.5 + i * 0.001 : 9.7 + i * 0.001);
		timestamps.push(BASE_TS + i * 60);
	}
	return { position_lat, position_long, timestamps };
}

/** A complete API weather sample (no cache-refetch branch is taken). */
function weatherEntry(temperature: number) {
	return {
		key: { lat: 47.1, lon: 8.5, date: "2026-06-01", hour: 10 },
		data: {
			temperature,
			dewPoint: temperature - 5,
			pressure: 1013.2,
			windSpeed: 3.5,
			windDirection: 220,
			queriedAt: Date.now(),
		},
		cachedAt: Date.now(),
		source: "api" as const,
	};
}

/**
 * An API sample the weather service returned with no wind reading.
 *
 * The declared WeatherData type says these are numbers, but the cache can hold
 * entries without them (autoRho re-fetches on exactly that condition) and the
 * success path guards both fields against null, so this is the shape the guard
 * exists for.
 */
function weatherEntryWithoutWind(temperature: number) {
	const entry = weatherEntry(temperature);
	return {
		...entry,
		data: { ...entry.data, windSpeed: null, windDirection: null },
	};
}

function setTrim(range: { start: number; end: number }): void {
	(document.getElementById("mapTrimStartSlider") as HTMLInputElement).value =
		String(range.start);
	(document.getElementById("mapTrimEndSlider") as HTMLInputElement).value =
		String(range.end);
}

interface Harness {
	appState: AppState;
	parametersComponent: AnalysisParametersComponent;
	services: ShellServices;
}

function setupHarness(): Harness {
	document.body.innerHTML = `
		<input type="range" id="mapTrimStartSlider" value="0">
		<input type="range" id="mapTrimEndSlider" value="5">
		<div id="paramsContainer"></div>
	`;

	const appState = new AppState();
	appState.currentFitData = makeFilteredLapData() as never;
	appState.filteredLapData = makeFilteredLapData();

	const parametersComponent = new AnalysisParametersComponent(
		"paramsContainer",
		() => {},
	);
	parametersComponent.setParameters({ auto_calculate_rho: true });

	const services: ShellServices = {
		appState,
		showLoading: vi.fn(),
		hideLoading: vi.fn(),
		showError: vi.fn(),
	};

	return { appState, parametersComponent, services };
}

/** Drive one successful fetch over trim region T1. */
async function succeedOnT1(h: Harness, temperature = 21.4): Promise<void> {
	setTrim(T1);
	mocks.getWeatherData.mockResolvedValueOnce(weatherEntry(temperature));
	mocks.calculateAirDensity.mockReturnValueOnce(1.19837);

	const rho = await calculateAutoRho(
		h.appState,
		h.parametersComponent,
		h.services,
	);
	expect(rho).toBe(1.1984);
}

beforeEach(() => {
	vi.clearAllMocks();
	mocks.calculateAirDensity.mockReturnValue(1.2);
});

describe("calculateAutoRho — successful fetch", () => {
	test("stores the rho, its weather provenance and the wind vector", async () => {
		const h = setupHarness();
		await succeedOnT1(h);

		const params = h.parametersComponent.getParameters();
		expect(params.rho).toBe(1.1984);
		expect(params.rho_source).toBe("weather_api");
		expect(params.weather_metadata).toMatchObject({
			temperature: 21.4,
			pressure: 1013.2,
			windSpeed: 3.5,
			windDirection: 220,
			source: "api",
		});
		expect(params.wind_speed).toBe(3.5);
		expect(params.wind_direction).toBe(220);
		// The same fill also claims the wind's provenance and seeds the height
		// factor, so the 10 m wind above is transferred down to rider height.
		expect(params.wind_entry).toBe("weather");
		expect(params.wind_height_factor).toBe(0.5);
		expect(h.appState.isCalculatingAutoRho).toBe(false);
		expect(h.services.hideLoading).toHaveBeenCalled();
	});
});

describe("calculateAutoRho — weather failure degrades (T-06-08)", () => {
	test("resolves null, clears the in-progress flag and warns the user", async () => {
		const h = setupHarness();
		mocks.getWeatherData.mockRejectedValueOnce(
			new WeatherAPIError("Weather API error: 503 SECRET", "API_ERROR"),
		);

		await expect(
			calculateAutoRho(h.appState, h.parametersComponent, h.services),
		).resolves.toBeNull();

		// Dies without the reset — the whole point of the WEATH-03 rung 3 guard.
		expect(h.appState.isCalculatingAutoRho).toBe(false);
		expect(h.services.hideLoading).toHaveBeenCalled();
		// Literal, not constant-bound: any text drift fails here (WR-02).
		expect(mocks.showNotification).toHaveBeenCalledWith(
			"Could not fetch weather data: Weather service unavailable. Using manual rho value.",
			"warning",
		);
		// No internals from the thrown error may reach the user.
		expect(mocks.showNotification.mock.calls[0][0]).not.toContain("SECRET");
	});

	test("the manual rho is untouched when no fetch ever succeeded", async () => {
		const h = setupHarness();
		h.parametersComponent.setParameters({ rho: 1.2345 });
		mocks.getWeatherData.mockRejectedValueOnce(
			new WeatherAPIError("boom", "FETCH_ERROR"),
		);

		await calculateAutoRho(h.appState, h.parametersComponent, h.services);

		const params = h.parametersComponent.getParameters();
		expect(params.rho).toBe(1.2345);
		expect(params.rho_source).toBe("manual");
		expect(params.weather_metadata).toBeUndefined();
	});

	test("an unmapped error code still degrades through the generic message", async () => {
		const h = setupHarness();
		mocks.getWeatherData.mockRejectedValueOnce(
			new WeatherAPIError("bad payload", "INCOMPLETE_DATA"),
		);

		await expect(
			calculateAutoRho(h.appState, h.parametersComponent, h.services),
		).resolves.toBeNull();
		expect(mocks.showNotification).toHaveBeenCalledWith(
			WEATHER_FAILURE_GENERIC_MESSAGE,
			"warning",
		);
	});
});

describe("calculateAutoRho — a failed re-fetch drops stale provenance (CR-01)", () => {
	test("success then failure leaves the rho un-attributed, not labelled as live weather", async () => {
		const h = setupHarness();
		await succeedOnT1(h);
		expect(h.parametersComponent.getParameters().rho_source).toBe(
			"weather_api",
		);

		// The user drags the trim slider to a different region and the re-fetch
		// fails. The stored rho now belongs to T1, not T2.
		setTrim(T2);
		mocks.getWeatherData.mockRejectedValueOnce(
			new WeatherAPIError("Weather API error: 503", "API_ERROR"),
		);

		await expect(
			calculateAutoRho(h.appState, h.parametersComponent, h.services),
		).resolves.toBeNull();

		const params = h.parametersComponent.getParameters();
		// The claim "this rho is live weather data for this region" is gone...
		expect(params.rho_source).toBe("manual");
		expect(params.weather_metadata).toBeUndefined();
		// ...but the number itself survives, so analysis continues (T-06-08).
		expect(params.rho).toBe(1.1984);
	});

	test("the weather panel stops advertising the previous region's reading", async () => {
		const h = setupHarness();
		await succeedOnT1(h);

		const panel = document.getElementById(
			"weather_info_container",
		) as HTMLElement;
		expect(panel.classList.contains("hidden")).toBe(false);

		setTrim(T2);
		mocks.getWeatherData.mockRejectedValueOnce(
			new WeatherAPIError("down", "API_ERROR"),
		);
		await calculateAutoRho(h.appState, h.parametersComponent, h.services);

		expect(panel.classList.contains("hidden")).toBe(true);
	});

	test("the wind vector is deliberately kept — it has no provenance to drop", async () => {
		// Documented decision (see invalidateStaleWeatherProvenance): wind_speed
		// and wind_direction are user-editable inputs treated exactly like `rho`
		// itself. Clearing them would silently switch the analysis to a
		// zero-wind assumption and could discard a hand-entered value.
		const h = setupHarness();
		await succeedOnT1(h);

		setTrim(T2);
		mocks.getWeatherData.mockRejectedValueOnce(
			new WeatherAPIError("down", "API_ERROR"),
		);
		await calculateAutoRho(h.appState, h.parametersComponent, h.services);

		const params = h.parametersComponent.getParameters();
		expect(params.wind_speed).toBe(3.5);
		expect(params.wind_direction).toBe(220);
	});

	test("a failure with no prior weather success does not rewrite parameters", async () => {
		const h = setupHarness();
		h.parametersComponent.setParameters({ wind_speed: 2.2, wind_direction: 90 });
		mocks.getWeatherData.mockRejectedValueOnce(
			new WeatherAPIError("down", "API_ERROR"),
		);

		await calculateAutoRho(h.appState, h.parametersComponent, h.services);

		const params = h.parametersComponent.getParameters();
		expect(params.rho_source).toBe("manual");
		expect(params.wind_speed).toBe(2.2);
		expect(params.wind_direction).toBe(90);
	});
});

describe("calculateAutoRho — the in-progress flag is cleared structurally (WR-01)", () => {
	test("a throw from the notification layer still clears the flag", async () => {
		const h = setupHarness();
		mocks.getWeatherData.mockRejectedValueOnce(
			new WeatherAPIError("down", "API_ERROR"),
		);
		// The inner catch's showNotification blows up; the outer catch's does not.
		mocks.showNotification.mockImplementationOnce(() => {
			throw new Error("no DOM");
		});

		await expect(
			calculateAutoRho(h.appState, h.parametersComponent, h.services),
		).resolves.toBeNull();

		// Fails without the `finally` — the old code cleared the flag *after*
		// showNotification, so this path stranded it at true forever.
		expect(h.appState.isCalculatingAutoRho).toBe(false);
	});

	test("the flag is cleared even when the failure escapes the function", async () => {
		const h = setupHarness();
		mocks.getWeatherData.mockRejectedValueOnce(
			new WeatherAPIError("down", "API_ERROR"),
		);
		mocks.showNotification.mockImplementation(() => {
			throw new Error("no DOM");
		});

		// Residual, by design: if *both* handlers' DOM writes fail there is
		// nothing left to report with, so the promise rejects. Every call site
		// attaches a .catch (incl. the detached timer in fileLoadOrchestration),
		// so this cannot become an unhandled rejection — but the flag must
		// still be clear, or auto-rho is dead for the session.
		await expect(
			calculateAutoRho(h.appState, h.parametersComponent, h.services),
		).rejects.toThrow("no DOM");
		expect(h.appState.isCalculatingAutoRho).toBe(false);

		mocks.showNotification.mockReset();
	});

	test.each([
		["auto-calculate is disabled", (h: Harness) => h.parametersComponent.setParameters({ auto_calculate_rho: false })],
		["there is no FIT data", (h: Harness) => { h.appState.currentFitData = null; }],
		["there is no filtered lap data", (h: Harness) => { h.appState.filteredLapData = null; }],
	])("the flag is cleared on the early return when %s", async (_label, mutate) => {
		const h = setupHarness();
		mutate(h);

		await expect(
			calculateAutoRho(h.appState, h.parametersComponent, h.services),
		).resolves.toBeNull();
		expect(h.appState.isCalculatingAutoRho).toBe(false);
	});

	test("the re-entrancy guard short-circuits without clearing a live flag", async () => {
		const h = setupHarness();
		h.appState.isCalculatingAutoRho = true;

		await expect(
			calculateAutoRho(h.appState, h.parametersComponent, h.services),
		).resolves.toBeNull();

		// The guard returns *before* the try, so the in-flight run keeps its flag.
		expect(h.appState.isCalculatingAutoRho).toBe(true);
		expect(mocks.getWeatherData).not.toHaveBeenCalled();
	});
});

describe("calculateAutoRho — the loading overlay is only hidden by its owner (IN-04)", () => {
	test("a throw before showLoading() does not dismiss someone else's overlay", async () => {
		const h = setupHarness();
		// getParameters() is read inside the outer try but *before*
		// services.showLoading(), so this throw lands in the outer catch with no
		// overlay of our own on screen. hideLoading() is a global, non-refcounted
		// toggle that also re-enables the Analyze button, and auto-rho runs from
		// detached timers — so calling it here would kill a concurrent
		// operation's overlay mid-run.
		vi.spyOn(h.parametersComponent, "getParameters").mockImplementationOnce(
			() => {
				throw new Error("params exploded");
			},
		);

		await expect(
			calculateAutoRho(h.appState, h.parametersComponent, h.services),
		).resolves.toBeNull();

		expect(h.services.showLoading).not.toHaveBeenCalled();
		expect(h.services.hideLoading).not.toHaveBeenCalled();
		// Still reported, and the flag is still cleared.
		expect(mocks.showNotification).toHaveBeenCalledWith(
			AUTO_RHO_FAILURE_MESSAGE,
			"error",
		);
		expect(h.appState.isCalculatingAutoRho).toBe(false);
	});

	test("the overlay is hidden exactly once when both catch handlers run", async () => {
		const h = setupHarness();
		mocks.getWeatherData.mockRejectedValueOnce(
			new WeatherAPIError("down", "API_ERROR"),
		);
		// Inner catch hides the overlay, then throws on its way out; the outer
		// catch must not toggle it a second time.
		mocks.showNotification.mockImplementationOnce(() => {
			throw new Error("no DOM");
		});

		await calculateAutoRho(h.appState, h.parametersComponent, h.services);

		expect(h.services.showLoading).toHaveBeenCalledTimes(1);
		expect(h.services.hideLoading).toHaveBeenCalledTimes(1);
	});

	test("a successful run hides the overlay exactly once", async () => {
		const h = setupHarness();
		await succeedOnT1(h);
		expect(h.services.showLoading).toHaveBeenCalledTimes(1);
		expect(h.services.hideLoading).toHaveBeenCalledTimes(1);
	});
});

describe("calculateAutoRho — the outer catch never de-escalates (WR-05)", () => {
	test("a WeatherAPIError reaching the outer catch is still reported as an error", async () => {
		const h = setupHarness();
		mocks.getWeatherData.mockRejectedValueOnce(
			new WeatherAPIError("down", "API_ERROR"),
		);
		// Force a WeatherAPIError out of the *inner* handler, so the outer catch
		// sees one. Routing that through resolveWeatherFailure would downgrade a
		// hard bug to a weather-flavoured warning.
		mocks.showNotification.mockImplementationOnce(() => {
			throw new WeatherAPIError("secondary", "API_ERROR");
		});

		await expect(
			calculateAutoRho(h.appState, h.parametersComponent, h.services),
		).resolves.toBeNull();

		expect(mocks.showNotification).toHaveBeenCalledTimes(2);
		expect(mocks.showNotification.mock.calls[1]).toEqual([
			AUTO_RHO_FAILURE_MESSAGE,
			"error",
		]);
		// Literal pin: this is the pre-06-05 text and severity (WR-02).
		expect(mocks.showNotification.mock.calls[1][0]).toBe(
			"Auto-rho calculation failed. Using manual value.",
		);
	});
});

describe("calculateAutoRho — unchanged query short-circuits", () => {
	test("a repeat call for the same trim region reuses the stored rho", async () => {
		const h = setupHarness();
		await succeedOnT1(h);
		expect(mocks.getWeatherData).toHaveBeenCalledTimes(1);

		const rho = await calculateAutoRho(
			h.appState,
			h.parametersComponent,
			h.services,
		);

		expect(rho).toBe(1.1984);
		expect(mocks.getWeatherData).toHaveBeenCalledTimes(1);
		expect(h.appState.isCalculatingAutoRho).toBe(false);
	});

	test("a failed fetch does not mark its region as already loaded", async () => {
		// The query key exists to skip a *redundant* fetch — one whose result is
		// already in `params.rho`. A failed fetch loaded nothing, so recording
		// its key strands the user: the same trim region is never retried, and
		// the only escape is to move the slider away and back.
		const h = setupHarness();
		setTrim(T1);
		mocks.getWeatherData.mockRejectedValueOnce(
			new WeatherAPIError("down", "API_ERROR"),
		);

		await calculateAutoRho(h.appState, h.parametersComponent, h.services);
		expect(mocks.getWeatherData).toHaveBeenCalledTimes(1);

		// The network comes back. Same region, no slider move.
		mocks.getWeatherData.mockResolvedValueOnce(weatherEntry(21.4));
		mocks.calculateAirDensity.mockReturnValueOnce(1.19837);

		const rho = await calculateAutoRho(
			h.appState,
			h.parametersComponent,
			h.services,
		);

		expect(mocks.getWeatherData).toHaveBeenCalledTimes(2);
		expect(rho).toBe(1.1984);
		expect(h.parametersComponent.getParameters().rho_source).toBe(
			"weather_api",
		);
	});
});

describe("calculateAutoRho — the wind height factor (D-06)", () => {
	test("a first weather fill seeds the factor and claims weather provenance", async () => {
		const h = setupHarness();
		// Start away from the seeded value so the seed is observable rather than
		// coinciding with the component's default.
		h.parametersComponent.setParameters({
			wind_entry: "manual",
			wind_height_factor: 0.8,
		});

		await succeedOnT1(h);

		const params = h.parametersComponent.getParameters();
		expect(params.wind_entry).toBe("weather");
		expect(params.wind_height_factor).toBe(0.5);
	});

	test("a refill does not clobber a factor the user tuned", async () => {
		// Manual verification check 5, automated. A trim-slider move forces a
		// refetch; the venue-specific k the user chose must survive it.
		const h = setupHarness();
		await succeedOnT1(h);

		h.parametersComponent.setParameters({ wind_height_factor: 0.65 });

		setTrim(T2);
		mocks.getWeatherData.mockResolvedValueOnce(weatherEntry(19.2));
		await calculateAutoRho(h.appState, h.parametersComponent, h.services);

		const params = h.parametersComponent.getParameters();
		expect(params.wind_height_factor).toBe(0.65);
		expect(params.wind_entry).toBe("weather");
		// The refill did land — this is a refill, not a skipped call.
		expect(mocks.getWeatherData).toHaveBeenCalledTimes(2);
	});

	test("a response carrying no wind does not claim weather provenance", async () => {
		// T-08-11: the seeding is gated on the wind actually having been written,
		// not on the fetch having succeeded. Marking the wind weather-sourced here
		// would claim a provenance for a number the API never returned.
		const h = setupHarness();
		h.parametersComponent.setParameters({
			wind_entry: "manual",
			wind_height_factor: 0.8,
		});

		setTrim(T1);
		mocks.getWeatherData.mockResolvedValueOnce(weatherEntryWithoutWind(21.4));
		mocks.calculateAirDensity.mockReturnValueOnce(1.19837);

		const rho = await calculateAutoRho(
			h.appState,
			h.parametersComponent,
			h.services,
		);

		// The rho still resolved — only the wind was missing.
		expect(rho).toBe(1.1984);
		const params = h.parametersComponent.getParameters();
		expect(params.wind_entry).not.toBe("weather");
		expect(params.wind_entry).toBe("manual");
		expect(params.wind_height_factor).toBe(0.8);
	});

	test("a failed re-fetch drops rho provenance but leaves the wind fields alone", async () => {
		// D-06's negative case: the retained wind is still the same *kind* of
		// number (a 10 m model wind), so the factor must keep applying. This is
		// the test that fails if a refactor folds wind provenance into rho_source,
		// which invalidateStaleWeatherProvenance does clear.
		const h = setupHarness();
		await succeedOnT1(h);
		h.parametersComponent.setParameters({ wind_height_factor: 0.65 });

		setTrim(T2);
		mocks.getWeatherData.mockRejectedValueOnce(
			new WeatherAPIError("down", "API_ERROR"),
		);
		await calculateAutoRho(h.appState, h.parametersComponent, h.services);

		const params = h.parametersComponent.getParameters();
		expect(params.rho_source).toBe("manual");
		expect(params.weather_metadata).toBeUndefined();
		expect(params.wind_entry).toBe("weather");
		expect(params.wind_height_factor).toBe(0.65);
	});

	test("a reopened pre-feature record is not re-seeded by a successful fill", async () => {
		// T-08-16 / D-07 / R-04, end-to-end. auto-rho genuinely re-fires on load
		// from fileLoad/fileLoadOrchestration.ts:389 and
		// ve/bindStandardSliders.ts:632 — neither suppressed by
		// isLoadingParameters — so on any saved file with auto_calculate_rho: true
		// this exact sequence runs right after normalizeLoadedParameters produced
		// wind_entry: "unknown". The API does return a wind here; the record must
		// still stay at k = 1.0 rather than being silently re-fitted at 0.5.
		const h = setupHarness();
		h.parametersComponent.setParameters({
			wind_entry: "unknown",
			wind_height_factor: 1.0,
		});

		await succeedOnT1(h);

		const params = h.parametersComponent.getParameters();
		expect(params.wind_height_factor).toBe(1.0);
		expect(params.wind_entry).toBe("unknown");
		// The rest of the fill still applied as normal.
		expect(params.rho).toBe(1.1984);
		expect(params.wind_speed).toBe(3.5);
	});
});
