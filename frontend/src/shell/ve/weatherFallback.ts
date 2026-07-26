import { WeatherAPIError } from "../../utils/WeatherAPI";

/**
 * WEATH-03 — graceful degradation for the single-sample weather path.
 *
 * This module is deliberately **pure and DOM-free**: it maps a thrown weather
 * failure onto the user-facing degradation decision, and nothing else. The
 * caller (`autoRho.ts`) owns the side effects (`showNotification`, logging,
 * loading state). That split is what makes every rung of the ladder reachable
 * from a unit test without a DOM.
 *
 * Security (threat T-06-07, information disclosure): `userMessage` is built
 * **only** from the fixed strings in this file. A `WeatherAPIError` carries an
 * untrusted diagnostic payload (HTTP status objects, raw API response bodies,
 * the original network error) — none of that may ever reach the notification
 * text. Internal diagnostics stay in `log.error` at the call site.
 */

/** The degradation decision for one weather failure. */
export interface WeatherFailureResolution {
	/** Text safe to show to the user. Never contains error internals. */
	userMessage: string;
	/** Notification severity to pass to `showNotification`. */
	severity: "warning" | "error";
	/**
	 * True when analysis should continue on the existing manual/prior rho.
	 * A weather outage must never block or crash a VE run (threat T-06-08).
	 */
	keepManualRho: boolean;
}

/** Shared prefix for weather-fetch failures (unchanged from the pre-refactor text). */
export const WEATHER_FAILURE_PREFIX = "Could not fetch weather data";

/** Fallback text for any `WeatherAPIError` code without a dedicated message. */
export const WEATHER_FAILURE_GENERIC_MESSAGE =
	"Could not fetch weather data. Using manual rho value.";

/** Text for a failure that did not come from the weather client at all. */
export const AUTO_RHO_FAILURE_MESSAGE =
	"Auto-rho calculation failed. Using manual value.";

/**
 * Fixed, user-safe text per `WeatherAPIError.code`.
 *
 * A `Map` (not an object literal) is used on purpose: lookup keys come from an
 * error thrown by the fetch layer, and a `Map` cannot resolve inherited keys
 * such as `constructor` or `toString` into a message.
 */
const CODED_MESSAGES = new Map<string, string>([
	// Rung 4: activity older than the weather window.
	["DATA_TOO_OLD", "Activity is too old (>92 days). Using manual rho value."],
	// Rung 3: Open-Meteo reachable but not serving.
	["API_ERROR", "Weather service unavailable. Using manual rho value."],
	// Rung 3: the request never completed.
	["FETCH_ERROR", "Network error. Check your internet connection."],
]);

/**
 * Map a weather failure onto its degradation outcome.
 *
 * Every branch keeps the manual rho, so the caller can always fall through to
 * "return null, analysis continues on `params.rho`".
 *
 * @param error - Anything thrown by the weather fetch path.
 * @returns The user-facing message, its severity, and the degradation decision.
 */
export function resolveWeatherFailure(error: unknown): WeatherFailureResolution {
	if (error instanceof WeatherAPIError) {
		const coded =
			typeof error.code === "string" ? CODED_MESSAGES.get(error.code) : undefined;

		return {
			userMessage: coded
				? `${WEATHER_FAILURE_PREFIX}: ${coded}`
				: WEATHER_FAILURE_GENERIC_MESSAGE,
			severity: "warning",
			keepManualRho: true,
		};
	}

	// Not a weather-client failure (unexpected bug in the auto-rho path).
	// Surfaced as an error, but analysis still continues on the manual rho.
	return {
		userMessage: AUTO_RHO_FAILURE_MESSAGE,
		severity: "error",
		keepManualRho: true,
	};
}
