/**
 * Gate markers — BOTH marker families on the shared `gpsMarkerLayer`: the
 * single GPS gate marker (`setGpsMarker`/`clearGpsMarker`) and the
 * out-and-back A/B markers (`setGpsMarkerA`/`setGpsMarkerB`/
 * `clearOutAndBackMarkers`). Moved verbatim from the `MapVisualization`
 * facade (plan 05-10, D-08/D-09).
 *
 * INVARIANT (Pitfall 7, documented on `MapContext.gpsMarkerLayer`):
 * `setGpsMarker` calls `clearLayers()` on the shared layer — wiping markers
 * A and B too — while `setGpsMarkerA`/`B` surgically `removeLayer` only their
 * own marker. Safe ONLY because GPS-gate mode and out-and-back mode are
 * mutually exclusive in the UI. Both families live in this ONE module so the
 * invariant never crosses a module boundary.
 */
import * as L from "leaflet";
import { log } from "../../utils/log";
import type { MapContext } from "./context";

const GATE_MARKER_RADIUS_PX = 12;
const GATE_MARKER_TOOLTIP_OFFSET_Y_PX = 8;

/** Marker handles owned by the facade, mutated in place by this module. */
export interface GateMarkers {
	/** The single GPS gate marker (GPS-lap detection mode). */
	gate: L.CircleMarker | null;
	/** Out-and-back start/end marker A. */
	a: L.CircleMarker | null;
	/** Out-and-back turnaround marker B. */
	b: L.CircleMarker | null;
}

export function createGateMarkers(): GateMarkers {
	return { gate: null, a: null, b: null };
}

/** Set the GPS gate marker — clears the WHOLE shared layer first (invariant). */
export function setGpsMarker(
	ctx: MapContext,
	markers: GateMarkers,
	lat: number,
	lon: number,
): void {
	// Clear existing marker
	ctx.gpsMarkerLayer.clearLayers();

	// Create new marker with distinctive styling
	markers.gate = L.circleMarker([lat, lon], {
		radius: GATE_MARKER_RADIUS_PX,
		fillColor: "#ff6b00", // Orange
		color: "#ffffff",
		weight: 3,
		opacity: 1,
		fillOpacity: 0.9,
	});

	// Add pulsing effect with CSS class
	const markerElement = markers.gate.getElement?.();
	if (markerElement) {
		markerElement.classList.add("gps-gate-marker");
	}

	// Add popup
	markers.gate.bindPopup("GPS Gate - Click to move");

	markers.gate.addTo(ctx.gpsMarkerLayer);

	log.debug("GPS marker set at:", { lat, lon });
}

/**
 * Clear the GPS gate marker. Takes the (possibly null) layer directly so the
 * facade's `destroy()` can call it after the map/layers are torn down.
 */
export function clearGpsMarker(
	gpsMarkerLayer: L.LayerGroup | null,
	markers: GateMarkers,
): void {
	if (gpsMarkerLayer) {
		gpsMarkerLayer.clearLayers();
	}
	markers.gate = null;
}

/** Set out-and-back marker A — surgical removeLayer of its own marker only. */
export function setGpsMarkerA(
	ctx: MapContext,
	markers: GateMarkers,
	lat: number,
	lon: number,
): void {
	// Remove existing marker A if present
	if (markers.a) {
		ctx.gpsMarkerLayer.removeLayer(markers.a);
	}

	// Create marker A with green color
	markers.a = L.circleMarker([lat, lon], {
		radius: GATE_MARKER_RADIUS_PX,
		fillColor: "#00aa00", // Green for start marker
		color: "#ffffff",
		weight: 3,
		opacity: 1,
		fillOpacity: 0.9,
	});

	// Add label positioned above the marker
	markers.a.bindPopup("Gate A (Start/End)");
	markers.a.bindTooltip("A", {
		permanent: true,
		direction: "top",
		offset: [0, -GATE_MARKER_TOOLTIP_OFFSET_Y_PX],
		className: "gate-marker-label gate-marker-label--a",
	});

	markers.a.addTo(ctx.gpsMarkerLayer);

	log.debug("GPS marker A set at:", { lat, lon });
}

/** Set out-and-back marker B — surgical removeLayer of its own marker only. */
export function setGpsMarkerB(
	ctx: MapContext,
	markers: GateMarkers,
	lat: number,
	lon: number,
): void {
	// Remove existing marker B if present
	if (markers.b) {
		ctx.gpsMarkerLayer.removeLayer(markers.b);
	}

	// Create marker B with blue color
	markers.b = L.circleMarker([lat, lon], {
		radius: GATE_MARKER_RADIUS_PX,
		fillColor: "#0066cc", // Blue for turnaround marker
		color: "#ffffff",
		weight: 3,
		opacity: 1,
		fillOpacity: 0.9,
	});

	// Add label positioned above the marker
	markers.b.bindPopup("Gate B (Turnaround)");
	markers.b.bindTooltip("B", {
		permanent: true,
		direction: "top",
		offset: [0, -GATE_MARKER_TOOLTIP_OFFSET_Y_PX],
		className: "gate-marker-label gate-marker-label--b",
	});

	markers.b.addTo(ctx.gpsMarkerLayer);

	log.debug("GPS marker B set at:", { lat, lon });
}

/**
 * Clear both out-and-back markers. Takes the (possibly null) layer directly
 * so the facade's `destroy()` can call it after teardown — matching the
 * pre-extraction semantics, the marker handles are only nulled when the
 * layer still exists.
 */
export function clearOutAndBackMarkers(
	gpsMarkerLayer: L.LayerGroup | null,
	markers: GateMarkers,
): void {
	if (gpsMarkerLayer) {
		if (markers.a) {
			gpsMarkerLayer.removeLayer(markers.a);
			markers.a = null;
		}
		if (markers.b) {
			gpsMarkerLayer.removeLayer(markers.b);
			markers.b = null;
		}
	}
}
