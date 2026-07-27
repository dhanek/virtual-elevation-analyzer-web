import { describe, expect, test } from "vitest";
import { WeatherAPIError } from "../../utils/WeatherAPI";
import {
	AUTO_RHO_FAILURE_MESSAGE,
	WEATHER_FAILURE_GENERIC_MESSAGE,
	WEATHER_FAILURE_PREFIX,
	resolveWeatherFailure,
} from "./weatherFallback";

/**
 * TEST-01 — coverage for the WEATH-03 degradation ladder (Plan 06-05).
 *
 * Every rung must produce user-safe text, the right severity, and
 * `keepManualRho: true` so a weather outage can never block a VE run
 * (threat T-06-08). No branch may echo error internals (threat T-06-07).
 */

/**
 * Sentinel planted in every fixture error's `message` **and** `details`.
 * If it ever appears in `userMessage`, the resolver is leaking internals.
 */
const LEAK_SENTINEL = "SECRET_STATUS_500";

/**
 * Build a `WeatherAPIError` shaped like the ones `WeatherAPI` actually throws:
 * a diagnostic message plus an untrusted `details` payload. Both carry the
 * leak sentinel so any assertion on the fixture doubles as a no-leak check.
 */
function weatherError(code?: string): WeatherAPIError {
	return new WeatherAPIError(
		`Weather API error: 500 ${LEAK_SENTINEL}`,
		code,
		{
			status: 500,
			statusText: LEAK_SENTINEL,
			url: `https://api.open-meteo.com/v1/forecast?key=${LEAK_SENTINEL}`,
		},
	);
}

/** Codes `WeatherAPI` can throw that have no dedicated user message. */
const UNMAPPED_CODES = [
	"NULL_DATA",
	"INVALID_DATA",
	"INVALID_RESPONSE",
	"DATA_NOT_FOUND",
	"INCOMPLETE_DATA",
];

describe("weatherFallback fixtures", () => {
	test("weatherError carries the code, the details payload and the sentinel", () => {
		const error = weatherError("API_ERROR");
		expect(error).toBeInstanceOf(WeatherAPIError);
		expect(error.code).toBe("API_ERROR");
		expect(error.message).toContain(LEAK_SENTINEL);
		expect(JSON.stringify(error.details)).toContain(LEAK_SENTINEL);
	});

	test("unmapped code list is non-empty", () => {
		expect(UNMAPPED_CODES.length).toBeGreaterThan(0);
	});

	test("the seam exports the symbols the assertions bind to", () => {
		// Tests bind to these constants rather than copy-pasted literals, so a
		// wording change breaks in one place (Plan 06-05 decision 4).
		expect(WEATHER_FAILURE_PREFIX).toBeTypeOf("string");
		expect(WEATHER_FAILURE_GENERIC_MESSAGE).toBeTypeOf("string");
		expect(AUTO_RHO_FAILURE_MESSAGE).toBeTypeOf("string");
		expect(resolveWeatherFailure).toBeTypeOf("function");
	});
});

describe("resolveWeatherFailure — rung 4: DATA_TOO_OLD", () => {
	test.todo("warns that the activity is too old and keeps the manual rho");
});

describe("resolveWeatherFailure — rung 3: API_ERROR", () => {
	test.todo("warns that the weather service is unavailable");
});

describe("resolveWeatherFailure — rung 3: FETCH_ERROR", () => {
	test.todo("warns about the network connection");
});

describe("resolveWeatherFailure — unmapped WeatherAPIError codes", () => {
	test.todo("falls back to the generic weather message");
});

describe("resolveWeatherFailure — non-WeatherAPIError failures", () => {
	test.todo("reports an auto-rho error and still keeps the manual rho");
});

describe("resolveWeatherFailure — no-leak guard (T-06-07)", () => {
	test.todo("never surfaces the error message or details in userMessage");
});

describe("resolveWeatherFailure — manual rho survives every rung (T-06-08)", () => {
	test.todo("returns keepManualRho true for every failure shape");
});
