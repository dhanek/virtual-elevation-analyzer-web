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

/**
 * Object-prototype keys. The lookup is a `Map` on purpose (Plan 06-05
 * decision 3) — an object literal would resolve these to inherited members
 * and stringify them into the notification.
 */
const PROTOTYPE_KEYS = ["constructor", "toString", "valueOf", "__proto__"];

/** Every failure shape the resolver must survive, for the invariant sweeps. */
const ALL_FAILURES: Array<{ label: string; error: unknown }> = [
	{ label: "DATA_TOO_OLD", error: weatherError("DATA_TOO_OLD") },
	{ label: "API_ERROR", error: weatherError("API_ERROR") },
	{ label: "FETCH_ERROR", error: weatherError("FETCH_ERROR") },
	...UNMAPPED_CODES.map((code) => ({ label: code, error: weatherError(code) })),
	{ label: "code-less WeatherAPIError", error: weatherError(undefined) },
	{ label: "unknown code", error: weatherError("SOMETHING_NEW") },
	...PROTOTYPE_KEYS.map((code) => ({
		label: `prototype key "${code}"`,
		error: weatherError(code),
	})),
	{ label: "plain Error", error: new Error(`boom ${LEAK_SENTINEL}`) },
	{ label: "TypeError", error: new TypeError(`bad ${LEAK_SENTINEL}`) },
	{ label: "thrown string", error: `raw ${LEAK_SENTINEL}` },
	{ label: "thrown null", error: null },
	{ label: "thrown undefined", error: undefined },
	{
		label: "duck-typed WeatherAPIError impostor",
		error: {
			name: "WeatherAPIError",
			code: "DATA_TOO_OLD",
			message: LEAK_SENTINEL,
		},
	},
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
	test("warns that the activity is too old and keeps the manual rho", () => {
		expect(resolveWeatherFailure(weatherError("DATA_TOO_OLD"))).toEqual({
			userMessage: `${WEATHER_FAILURE_PREFIX}: Activity is too old (>92 days). Using manual rho value.`,
			severity: "warning",
			keepManualRho: true,
		});
	});
});

describe("resolveWeatherFailure — rung 3: API_ERROR", () => {
	test("warns that the weather service is unavailable", () => {
		expect(resolveWeatherFailure(weatherError("API_ERROR"))).toEqual({
			userMessage: `${WEATHER_FAILURE_PREFIX}: Weather service unavailable. Using manual rho value.`,
			severity: "warning",
			keepManualRho: true,
		});
	});
});

describe("resolveWeatherFailure — rung 3: FETCH_ERROR", () => {
	test("warns about the network connection", () => {
		expect(resolveWeatherFailure(weatherError("FETCH_ERROR"))).toEqual({
			userMessage: `${WEATHER_FAILURE_PREFIX}: Network error. Check your internet connection.`,
			severity: "warning",
			keepManualRho: true,
		});
	});
});

describe("resolveWeatherFailure — coded messages stay distinct", () => {
	test("each mapped code yields its own user message", () => {
		const messages = ["DATA_TOO_OLD", "API_ERROR", "FETCH_ERROR"].map(
			(code) => resolveWeatherFailure(weatherError(code)).userMessage,
		);
		expect(new Set(messages).size).toBe(3);
		// None of them may collapse into the generic text.
		expect(messages).not.toContain(WEATHER_FAILURE_GENERIC_MESSAGE);
		for (const message of messages) {
			expect(message.startsWith(`${WEATHER_FAILURE_PREFIX}: `)).toBe(true);
		}
	});
});

describe("resolveWeatherFailure — unmapped WeatherAPIError codes", () => {
	test.each([...UNMAPPED_CODES, "SOMETHING_NEW"])(
		"%s falls back to the generic weather message",
		(code) => {
			expect(resolveWeatherFailure(weatherError(code))).toEqual({
				userMessage: WEATHER_FAILURE_GENERIC_MESSAGE,
				severity: "warning",
				keepManualRho: true,
			});
		},
	);

	test("a WeatherAPIError without a code uses the generic message", () => {
		expect(resolveWeatherFailure(weatherError(undefined))).toEqual({
			userMessage: WEATHER_FAILURE_GENERIC_MESSAGE,
			severity: "warning",
			keepManualRho: true,
		});
	});

	test.each(PROTOTYPE_KEYS)(
		'a code of "%s" cannot resolve an inherited member into the message',
		(code) => {
			const { userMessage } = resolveWeatherFailure(weatherError(code));
			expect(userMessage).toBe(WEATHER_FAILURE_GENERIC_MESSAGE);
			expect(userMessage).not.toMatch(/function|\[object|native code/i);
		},
	);
});

describe("resolveWeatherFailure — non-WeatherAPIError failures", () => {
	test("a plain Error reports an auto-rho error and keeps the manual rho", () => {
		expect(resolveWeatherFailure(new Error(`boom ${LEAK_SENTINEL}`))).toEqual({
			userMessage: AUTO_RHO_FAILURE_MESSAGE,
			severity: "error",
			keepManualRho: true,
		});
	});

	test.each([
		["a thrown string", `raw ${LEAK_SENTINEL}`],
		["null", null],
		["undefined", undefined],
		["a bare object", { anything: LEAK_SENTINEL }],
	])("%s is handled without throwing", (_label, thrown) => {
		expect(resolveWeatherFailure(thrown)).toEqual({
			userMessage: AUTO_RHO_FAILURE_MESSAGE,
			severity: "error",
			keepManualRho: true,
		});
	});

	test("a duck-typed impostor does not get a coded weather message", () => {
		// Only a real WeatherAPIError may reach the coded branch — an object
		// merely carrying `code` must not steer the user-facing text.
		const { userMessage, severity } = resolveWeatherFailure({
			name: "WeatherAPIError",
			code: "DATA_TOO_OLD",
			message: LEAK_SENTINEL,
		});
		expect(userMessage).toBe(AUTO_RHO_FAILURE_MESSAGE);
		expect(severity).toBe("error");
	});
});

describe("resolveWeatherFailure — no-leak guard (T-06-07)", () => {
	test.each(ALL_FAILURES)(
		"$label never surfaces internals in userMessage",
		({ error }) => {
			const { userMessage } = resolveWeatherFailure(error);
			expect(userMessage).not.toContain(LEAK_SENTINEL);
			// Nothing from the diagnostic payload may appear either.
			expect(userMessage).not.toMatch(/500|status|http|https:\/\//i);
			if (error instanceof Error) {
				expect(userMessage).not.toContain(error.message);
			}
		},
	);

	test("only ever returns one of the three fixed strings", () => {
		const allowed = new Set([
			`${WEATHER_FAILURE_PREFIX}: Activity is too old (>92 days). Using manual rho value.`,
			`${WEATHER_FAILURE_PREFIX}: Weather service unavailable. Using manual rho value.`,
			`${WEATHER_FAILURE_PREFIX}: Network error. Check your internet connection.`,
			WEATHER_FAILURE_GENERIC_MESSAGE,
			AUTO_RHO_FAILURE_MESSAGE,
		]);
		for (const { error } of ALL_FAILURES) {
			expect(allowed.has(resolveWeatherFailure(error).userMessage)).toBe(true);
		}
	});
});

describe("resolveWeatherFailure — manual rho survives every rung (T-06-08)", () => {
	test.each(ALL_FAILURES)("$label keeps the manual rho", ({ error }) => {
		const resolution = resolveWeatherFailure(error);
		expect(resolution.keepManualRho).toBe(true);
		expect(["warning", "error"]).toContain(resolution.severity);
		expect(resolution.userMessage.length).toBeGreaterThan(0);
	});

	test("weather-client failures warn, unexpected bugs error", () => {
		// Severity split is behavioural: an outage is a warning (expected),
		// anything else is an error (a bug in the auto-rho path).
		expect(resolveWeatherFailure(weatherError("API_ERROR")).severity).toBe(
			"warning",
		);
		expect(resolveWeatherFailure(weatherError("NULL_DATA")).severity).toBe(
			"warning",
		);
		expect(resolveWeatherFailure(new Error("bug")).severity).toBe("error");
	});
});
