/**
 * Wind indicator — DOM overlay in the top-right corner of the map container.
 * Moved from the `MapVisualization` facade (plan 05-10, D-08/D-09) and
 * de-inlined (D-06/D-07): the former ~30 imperative element style writes
 * are now `map-wind-indicator` BEM classes in styles/map.css (markup-function
 * shape, `crrTempControlsMarkup` analog). ONLY the arrow's `rotate(...)`
 * transform stays imperative — a truly continuous runtime value (D-07).
 *
 * Security (T-05-02): the markup interpolates ONLY internal numeric wind
 * values (speed/direction via toFixed) and the fixed cardinal-direction
 * strings from geo.ts — no user-controlled strings enter the HTML.
 *
 * Takes the map container element (`MapContext.container`) rather than the
 * full context: the overlay is pure DOM, and the facade's `destroy()` must be
 * able to remove it after the Leaflet map is torn down.
 */
import { log } from "../../utils/log";
import { degreeToCardinal } from "./geo";

export function windIndicatorMarkup(
	displaySpeed: number,
	windSpeedUnit: "m/s" | "km/h",
	windDirection: number,
	cardinal: string,
): string {
	return `
        <div class="map-wind-indicator">
            <div class="map-wind-indicator__title">Wind</div>
            <div class="map-wind-indicator__arrow">↑</div>
            <div class="map-wind-indicator__speed">${displaySpeed.toFixed(1)} ${windSpeedUnit}</div>
            <div class="map-wind-indicator__direction">${windDirection.toFixed(0)}°</div>
            <div class="map-wind-indicator__from">from ${cardinal}</div>
        </div>
    `;
}

/**
 * Show (or refresh) the wind indicator overlay on the map container.
 * Hidden entirely when both wind parameters are zero.
 */
export function showWindIndicator(
	container: HTMLElement,
	windSpeed: number,
	windDirection: number,
	windSpeedUnit: "m/s" | "km/h" = "m/s",
): void {
	// Remove existing indicator if present
	hideWindIndicator(container);

	// Only show if wind parameters are non-zero
	if (windSpeed === 0 && windDirection === 0) {
		return;
	}

	// Convert wind speed to selected unit
	const displaySpeed = windSpeedUnit === "km/h" ? windSpeed * 3.6 : windSpeed;
	const cardinal = degreeToCardinal(windDirection);

	container.insertAdjacentHTML(
		"beforeend",
		windIndicatorMarkup(displaySpeed, windSpeedUnit, windDirection, cardinal),
	);

	// Arrow rotated by windDirection + 180 to point where wind is coming FROM.
	// The ONLY imperative style write: a continuous runtime value (D-07).
	const arrow = container.querySelector<HTMLElement>(
		".map-wind-indicator__arrow",
	);
	if (arrow) {
		arrow.style.transform = `rotate(${windDirection + 180}deg)`;
	}

	log.debug("Wind indicator shown:", { windSpeed, windDirection, cardinal });
}

/** Remove the wind indicator overlay if present. */
export function hideWindIndicator(container: HTMLElement): void {
	container.querySelector(".map-wind-indicator")?.remove();
}
