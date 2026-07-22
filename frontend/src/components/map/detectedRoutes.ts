/**
 * Detected routes — GPS-detected lap polylines and out-and-back section
 * polylines on the shared `detectedLapsLayer`. Moved verbatim from the
 * `MapVisualization` facade (plan 05-10, D-08/D-09); consumes the shared
 * state through `MapContext` instead of facade internals.
 *
 * The lap/section color palette lives here and ONLY here: the colors encode
 * data (lap identity) and must stay byte-identical to v1.0 (MAP-02, UI-SPEC).
 */
import * as L from "leaflet";
import type { DetectedLap, OutAndBackSection } from "../../utils/GpsLapDetection";
import { log } from "../../utils/log";
import type { MapContext } from "./context";
import { collectValidPoints } from "./geo";

/** Colors for detected laps / sections (cycle through if more than colors). */
const LAP_SECTION_COLORS = [
	"#4363d8", // Blue
	"#e6194b", // Red
	"#3cb44b", // Green
	"#f58231", // Orange
	"#911eb4", // Purple
	"#46f0f0", // Cyan
	"#f032e6", // Magenta
	"#bcf60c", // Lime
];

/** Display detected laps on the map. */
export function showDetectedLaps(ctx: MapContext, laps: DetectedLap[]): void {
	const fitData = ctx.getFitData();
	if (!fitData) return;

	// Clear existing lap visualizations
	ctx.detectedLapsLayer.clearLayers();

	// Draw lap segments with different colors
	for (const lap of laps) {
		const color = LAP_SECTION_COLORS[(lap.lapNumber - 1) % LAP_SECTION_COLORS.length];

		// Extract route points for this lap
		const { points: lapPoints } = collectValidPoints(
			fitData.position_lat,
			fitData.position_long,
			lap.startIdx,
			lap.endIdx,
		);

		if (lapPoints.length > 1) {
			// Draw lap polyline
			const polyline = L.polyline(lapPoints, {
				color: color,
				weight: 4,
				opacity: 0.8,
			});
			polyline.addTo(ctx.detectedLapsLayer);
		}
	}

	log.debug(`Displayed ${laps.length} detected laps on map`);
}

/**
 * Clear detected lap visualizations. Takes the (possibly null) layer directly
 * so the facade can call it before initialization without a context.
 */
export function clearDetectedLaps(
	detectedLapsLayer: L.LayerGroup | null,
): void {
	if (detectedLapsLayer) {
		detectedLapsLayer.clearLayers();
	}
}

/** Display detected Out and Back sections on the map. */
export function showOutAndBackSections(
	ctx: MapContext,
	sections: OutAndBackSection[],
): void {
	const fitData = ctx.getFitData();
	if (!fitData) return;

	// Clear existing visualizations
	ctx.detectedLapsLayer.clearLayers();

	// Draw each section (just the track segments, no labels)
	for (const section of sections) {
		const color =
			LAP_SECTION_COLORS[(section.sectionNumber - 1) % LAP_SECTION_COLORS.length];

		// Draw outbound segment (A → B) - solid line
		const { points: outboundPoints } = collectValidPoints(
			fitData.position_lat,
			fitData.position_long,
			section.outboundStartIdx,
			section.outboundEndIdx,
		);

		if (outboundPoints.length > 1) {
			const outboundLine = L.polyline(outboundPoints, {
				color: color,
				weight: 4,
				opacity: 0.8,
			});
			outboundLine.addTo(ctx.detectedLapsLayer);
		}

		// Draw inbound segment (B → A) - dashed line
		const { points: inboundPoints } = collectValidPoints(
			fitData.position_lat,
			fitData.position_long,
			section.inboundStartIdx,
			section.inboundEndIdx,
		);

		if (inboundPoints.length > 1) {
			const inboundLine = L.polyline(inboundPoints, {
				color: color,
				weight: 4,
				opacity: 0.8,
				dashArray: "10, 5", // Dashed for inbound
			});
			inboundLine.addTo(ctx.detectedLapsLayer);
		}
	}

	log.debug(`Displayed ${sections.length} out-and-back sections on map`);
}
