/**
 * Route rendering — full-route polyline, selected-lap segment masking and
 * lap start/end markers, plus the route/lap bounds fitting that accompanies
 * them. Moved verbatim from the `MapVisualization` facade (plan 05-10,
 * D-08/D-09); consumes the shared state through `MapContext` instead of
 * facade internals.
 */
import * as L from "leaflet";
import { log } from "../../utils/log";
import type { MapContext } from "./context";

const ROUTE_BOUNDS_PADDING_PX = 20;
/** Padding for focused (lap/trim) bounds — shared with trimMarkers.ts. */
export const FOCUSED_BOUNDS_PADDING_PX = 30;

/** Fit the map view to the full route. */
export function fitBoundsToRoute(ctx: MapContext): void {
	const routePoints = ctx.getRoutePoints();
	if (routePoints.length === 0) return;

	// Leaflet interop: L.latLngBounds expects a mutable array type.
	const bounds = L.latLngBounds(routePoints as [number, number][]);
	// animate: false — Leaflet silently drops any fitBounds issued while a
	// zoom animation is in flight (_tryAnimatedZoom returns early), which
	// swallowed the follow-up fitBoundsToSelectedLaps during map rebuilds.
	ctx.map.fitBounds(bounds, {
		padding: [ROUTE_BOUNDS_PADDING_PX, ROUTE_BOUNDS_PADDING_PX],
		animate: false,
	});
}

/** Fit the map view to the GPS points of the currently selected laps. */
export function fitBoundsToSelectedLaps(ctx: MapContext): void {
	const fitData = ctx.getFitData();
	const routePoints = ctx.getRoutePoints();
	const routePointIndices = ctx.getRoutePointIndices();
	const selectedLaps = ctx.getSelectedLaps();
	const laps = ctx.getLaps();

	if (!fitData || routePoints.length === 0 || selectedLaps.length === 0)
		return;

	// Collect all GPS points that belong to selected laps.
	// routePoints/routePointIndices are the collectValidPoints result over
	// the full activity (established in setData).
	const selectedPoints: [number, number][] = [];

	for (const lapNumber of selectedLaps) {
		const lapIndex = lapNumber - 1;
		const lap = laps[lapIndex];

		if (!lap) continue;

		for (let k = 0; k < routePoints.length; k++) {
			const timestamp = fitData.timestamps[routePointIndices[k]];
			if (timestamp >= lap.start_time && timestamp <= lap.end_time) {
				selectedPoints.push(routePoints[k]);
			}
		}
	}

	if (selectedPoints.length > 0) {
		const bounds = L.latLngBounds(selectedPoints);
		ctx.map.fitBounds(bounds, {
			padding: [FOCUSED_BOUNDS_PADDING_PX, FOCUSED_BOUNDS_PADDING_PX],
		});
	}
}

/**
 * Redraw the route layer: full route when no laps are selected, otherwise
 * the selected-lap segment highlighting with lap start/end markers.
 */
export function updateVisualization(ctx: MapContext): void {
	const fitData = ctx.getFitData();
	const routePoints = ctx.getRoutePoints();
	const selectedLaps = ctx.getSelectedLaps();

	log.debug("updateVisualization called:", {
		hasMap: true,
		hasRouteLayer: true,
		hasFitData: !!fitData,
		routePointsCount: routePoints.length,
		selectedLaps,
	});

	if (!fitData) {
		log.debug("Missing required objects for visualization");
		return;
	}

	// Clear existing layers
	ctx.routeLayer.clearLayers();

	if (routePoints.length === 0) {
		log.debug("No route points available");
		return;
	}

	if (selectedLaps.length === 0) {
		log.debug("Drawing full route (no laps selected)");
		// No laps selected - show full route in solid blue
		drawFullRoute(ctx);
	} else {
		log.debug("Drawing selected laps:", selectedLaps);
		// Show selected laps highlighted
		drawSelectedLaps(ctx);
	}
}

function drawFullRoute(ctx: MapContext): void {
	const routePoints = ctx.getRoutePoints();
	if (routePoints.length === 0) return;

	// Leaflet interop: L.polyline expects a mutable array type.
	const polyline = L.polyline(routePoints as [number, number][], {
		color: "#4363d8",
		weight: 4,
		opacity: 1.0,
	});

	polyline.addTo(ctx.routeLayer);
}

function drawSelectedLaps(ctx: MapContext): void {
	const fitData = ctx.getFitData();
	const routePoints = ctx.getRoutePoints();
	const routePointIndices = ctx.getRoutePointIndices();
	const selectedLaps = ctx.getSelectedLaps();
	const laps = ctx.getLaps();

	if (!fitData || routePoints.length === 0) return;

	// Create a mask to mark which points belong to selected laps
	const selectedMask = new Array(fitData.timestamps.length).fill(false);

	// Mark all points that belong to selected laps
	for (const lapNumber of selectedLaps) {
		// Convert 1-based lap numbers to 0-based array index
		const lapIndex = lapNumber - 1;
		const lap = laps[lapIndex];

		if (!lap) {
			log.debug(`Lap ${lapNumber} not found in laps array`);
			continue;
		}

		log.debug(`Processing lap ${lapNumber}:`, {
			start_time: lap.start_time,
			end_time: lap.end_time,
			total_elapsed_time: lap.total_elapsed_time,
		});

		for (let i = 0; i < fitData.timestamps.length; i++) {
			const timestamp = fitData.timestamps[i];
			if (timestamp >= lap.start_time && timestamp <= lap.end_time) {
				selectedMask[i] = true;
			}
		}
	}

	// Convert to route point indices (filtering out invalid GPS points):
	// routePointIndices maps each route point to its fitData index.
	const routeSelectedMask = routePointIndices.map((i) => selectedMask[i]);

	// Draw non-selected segments (dashed blue with reduced opacity)
	drawSegments(ctx, routeSelectedMask, false, {
		color: "#4363d8",
		weight: 3,
		opacity: 0.5,
		dashArray: "5,10",
	});

	// Draw selected segments (solid blue with full opacity)
	drawSegments(ctx, routeSelectedMask, true, {
		color: "#4363d8",
		weight: 5,
		opacity: 1.0,
	});

	// Add lap markers
	addLapMarkers(ctx);
}

function drawSegments(
	ctx: MapContext,
	mask: boolean[],
	isSelected: boolean,
	style: L.PolylineOptions,
): void {
	const routePoints = ctx.getRoutePoints();

	const segments: [number, number][][] = [];
	let currentSegment: [number, number][] = [];

	for (let i = 0; i < mask.length; i++) {
		if (mask[i] === isSelected) {
			currentSegment.push(routePoints[i]);
		} else {
			if (currentSegment.length > 1) {
				segments.push([...currentSegment]);
			}
			currentSegment = [];
		}
	}

	// Add the last segment if it exists
	if (currentSegment.length > 1) {
		segments.push(currentSegment);
	}

	// Draw all segments
	for (const segment of segments) {
		const polyline = L.polyline(segment, style);
		polyline.addTo(ctx.routeLayer);
	}
}

function addLapMarkers(ctx: MapContext): void {
	const fitData = ctx.getFitData();
	const routePoints = ctx.getRoutePoints();
	const routePointIndices = ctx.getRoutePointIndices();
	const selectedLaps = ctx.getSelectedLaps();
	const laps = ctx.getLaps();

	if (!fitData) return;

	for (const lapNumber of selectedLaps) {
		// Convert 1-based lap numbers to 0-based array index
		const lapIndex = lapNumber - 1;
		const lap = laps[lapIndex];
		if (!lap) continue;

		// Find start and end points among the valid route points
		let startPoint: [number, number] | null = null;
		let endPoint: [number, number] | null = null;

		for (let k = 0; k < routePoints.length; k++) {
			const timestamp = fitData.timestamps[routePointIndices[k]];
			if (timestamp >= lap.start_time && timestamp <= lap.end_time) {
				if (!startPoint) {
					startPoint = routePoints[k];
				}
				endPoint = routePoints[k];
			}
		}

		// Add markers
		if (startPoint) {
			const startMarker = L.marker(startPoint, {
				icon: L.divIcon({
					className: "lap-marker lap-marker--start",
					html: `<div class="lap-marker__content lap-marker__content--start">▶</div>`,
					iconSize: [24, 24],
					iconAnchor: [12, 12],
				}),
			});
			startMarker.bindPopup(`Lap ${lapNumber} Start`);
			startMarker.addTo(ctx.routeLayer);
		}

		if (endPoint && endPoint !== startPoint) {
			const endMarker = L.marker(endPoint, {
				icon: L.divIcon({
					className: "lap-marker lap-marker--end",
					html: `<div class="lap-marker__content lap-marker__content--end">⏹</div>`,
					iconSize: [24, 24],
					iconAnchor: [12, 12],
				}),
			});
			endMarker.bindPopup(`Lap ${lapNumber} End`);
			endMarker.addTo(ctx.routeLayer);
		}
	}
}
