/**
 * Tells the user when a VE pass replaced sensor-shadowed air speed
 * (`correctSensorShadow`), ONCE per distinct set of events. The update runs
 * on every slider step, so without the key a drag would re-raise the same
 * notification dozens of times.
 */
import type { ShadowEvent } from "../../analysis/SensorShadow";
import { showNotification } from "../dom/notifications";

let lastKey = "";

function sensorShadowMessage(events: ShadowEvent[]): string {
	const parts = events.map((e) => `${e.label} (${Math.round(e.seconds)} s)`);
	return `Air-speed sensor read low while ground speed held — likely something in front of the sensor. Replaced with ground speed plus the fitted wind: ${parts.join(", ")}.`;
}

export function noteSensorShadow(events: ShadowEvent[]): void {
	const key = events
		.map((e) => `${e.label}:${e.startIdx}-${e.endIdx}`)
		.join("|");
	if (key === lastKey) return;
	lastKey = key;
	if (events.length > 0)
		showNotification(sensorShadowMessage(events), "warning");
}
