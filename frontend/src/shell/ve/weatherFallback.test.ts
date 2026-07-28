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
 * Every rung must produce user-safe text and the right severity, and no branch
 * may echo error internals (threat T-06-07).
 *
 * The "a weather outage never blocks a VE run" half of the contract
 * (threat T-06-08) is a property of the *caller*, not of this pure mapping, so
 * it is asserted against real behaviour in `autoRho.test.ts` — this file only
 * proves the resolver is total and leak-free.
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

/**
 * Codes the resolver must handle generically (no dedicated user message).
 *
 * Some are defensive rather than live: `NULL_DATA` is currently unreachable —
 * its throw site sits in the `else` of `allowNullFallback`, and the only
 * '15min' caller always passes `true` (see WeatherAPI.ts, `fetchFromAPI`). It
 * is listed here so the generic branch stays covered if that changes.
 */
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
	// This is the one fixture check worth keeping: the entire no-leak sweep
	// below is vacuous if `weatherError` ever stops planting the sentinel in
	// both `message` and `details`. It guards a real assumption, not a literal.
	test("weatherError carries the code, the details payload and the sentinel", () => {
		const error = weatherError("API_ERROR");
		expect(error).toBeInstanceOf(WeatherAPIError);
		expect(error.code).toBe("API_ERROR");
		expect(error.message).toContain(LEAK_SENTINEL);
		expect(JSON.stringify(error.details)).toContain(LEAK_SENTINEL);
	});
});

describe("WEATH-03 shipped message text is frozen (06-05 parity bar)", () => {
	// Everywhere else in this suite the assertions bind to the exported
	// constants, which means a rename of the *value* would move the whole suite
	// with it and stay green. These three literal pins are the only thing
	// standing between a wording edit and a silent break of the 06-05 byte-
	// parity promise. Change them deliberately, never to make a test pass.
	test("the exact strings the user sees have not drifted", () => {
		expect(WEATHER_FAILURE_PREFIX).toBe("Could not fetch weather data");
		expect(WEATHER_FAILURE_GENERIC_MESSAGE).toBe(
			"Could not fetch weather data. Using manual rho value.",
		);
		expect(AUTO_RHO_FAILURE_MESSAGE).toBe(
			"Auto-rho calculation failed. Using manual value.",
		);
	});

	test("the three coded suffixes have not drifted", () => {
		expect(resolveWeatherFailure(weatherError("DATA_TOO_OLD")).userMessage).toBe(
			"Could not fetch weather data: Activity is too old (>92 days). Using manual rho value.",
		);
		expect(resolveWeatherFailure(weatherError("API_ERROR")).userMessage).toBe(
			"Could not fetch weather data: Weather service unavailable. Using manual rho value.",
		);
		expect(resolveWeatherFailure(weatherError("FETCH_ERROR")).userMessage).toBe(
			"Could not fetch weather data: Network error. Check your internet connection.",
		);
	});
});

describe("resolveWeatherFailure — rung 4 (defensive, unreachable): DATA_TOO_OLD", () => {
	// Nothing in frontend/src throws DATA_TOO_OLD today (WeatherAPI has no age
	// guard; >82d goes to Archive, which serves 1940+). This pins the mapping
	// for the day one is added — it is not evidence of live behaviour.
	test("warns that the activity is too old", () => {
		expect(resolveWeatherFailure(weatherError("DATA_TOO_OLD"))).toEqual({
			userMessage: `${WEATHER_FAILURE_PREFIX}: Activity is too old (>92 days). Using manual rho value.`,
			severity: "warning",
		});
	});
});

describe("resolveWeatherFailure — rung 3: API_ERROR", () => {
	test("warns that the weather service is unavailable", () => {
		expect(resolveWeatherFailure(weatherError("API_ERROR"))).toEqual({
			userMessage: `${WEATHER_FAILURE_PREFIX}: Weather service unavailable. Using manual rho value.`,
			severity: "warning",
		});
	});
});

describe("resolveWeatherFailure — rung 3: FETCH_ERROR", () => {
	test("warns about the network connection", () => {
		expect(resolveWeatherFailure(weatherError("FETCH_ERROR"))).toEqual({
			userMessage: `${WEATHER_FAILURE_PREFIX}: Network error. Check your internet connection.`,
			severity: "warning",
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
			});
		},
	);

	test("a WeatherAPIError without a code uses the generic message", () => {
		expect(resolveWeatherFailure(weatherError(undefined))).toEqual({
			userMessage: WEATHER_FAILURE_GENERIC_MESSAGE,
			severity: "warning",
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
	test("a plain Error reports an auto-rho error", () => {
		expect(resolveWeatherFailure(new Error(`boom ${LEAK_SENTINEL}`))).toEqual({
			userMessage: AUTO_RHO_FAILURE_MESSAGE,
			severity: "error",
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

describe("resolveWeatherFailure — total over every failure shape", () => {
	// The resolver must never throw and must always hand the caller something
	// showable: that is what lets `autoRho.ts` degrade unconditionally without
	// inspecting the failure. (That the degradation actually preserves the
	// manual rho — T-06-08 — is asserted in autoRho.test.ts.)
	test.each(ALL_FAILURES)("$label resolves to a showable result", ({ error }) => {
		const resolution = resolveWeatherFailure(error);
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
