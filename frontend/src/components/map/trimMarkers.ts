/**
 * Trim markers — trim start/end circle markers on the route layer and the
 * bounds fitting for the trimmed region. Moved verbatim from the
 * `MapVisualization` facade (plan 05-10, D-08/D-09); consumes the shared
 * state through `MapContext` instead of facade internals.
 */
import * as L from "leaflet";
import { log } from "../../utils/log";
import type { MapContext, NumericSeries } from "./context";
import { collectValidPoints } from "./geo";
import { FOCUSED_BOUNDS_PADDING_PX } from "./routeRendering";

const TRIM_MARKER_RADIUS_PX = 8;

/**
 * Fit the map view to the GPS points inside `[trimStart, trimEnd]` (inclusive)
 * and place the green/red trim boundary markers.
 */
export function fitBoundsToTrimRegion(
	ctx: MapContext,
	trimStart: number,
	trimEnd: number,
	filteredPositionLat?: number[],
	filteredPositionLong?: number[],
): void {
	if (ctx.getRoutePoints().length === 0) return;

	log.debug("fitBoundsToTrimRegion called:", {
		trimStart,
		trimEnd,
		hasFilteredData: !!(filteredPositionLat && filteredPositionLong),
		filteredDataLength: filteredPositionLat?.length,
	});

	// Use filtered data if provided (for VE analysis), otherwise use full fit data
	const posLat = filteredPositionLat || ctx.getFitData()?.position_lat;
	const posLong = filteredPositionLong || ctx.getFitData()?.position_long;

	if (!posLat || !posLong) return;

	// Collect GPS points in the trim region (trimEnd is inclusive)
	const { points: trimmedPoints } = collectValidPoints(
		posLat,
		posLong,
		trimStart,
		trimEnd,
	);

	log.debug("Trimmed points collected:", trimmedPoints.length);

	if (trimmedPoints.length > 0) {
		const bounds = L.latLngBounds(trimmedPoints);
		ctx.map.fitBounds(bounds, {
			padding: [FOCUSED_BOUNDS_PADDING_PX, FOCUSED_BOUNDS_PADDING_PX],
		});

		// Add trim markers
		addTrimMarkers(ctx, trimStart, trimEnd, posLat, posLong);
	}
}

function addTrimMarkers(
	ctx: MapContext,
	trimStart: number,
	trimEnd: number,
	posLat: NumericSeries,
	posLong: NumericSeries,
): void {
	const routeLayer = ctx.routeLayer;

	// Remove existing trim markers
	routeLayer.eachLayer((layer: any) => {
		if (layer.options && layer.options.trimMarker) {
			routeLayer.removeLayer(layer);
		}
	});

	// Add trim start marker (green)
	if (trimStart < posLat.length) {
		const startLat = posLat[trimStart];
		const startLng = posLong[trimStart];
		log.debug("Adding trim start marker:", {
			index: trimStart,
			lat: startLat,
			lng: startLng,
		});
		if (startLat && startLng && startLat !== 0 && startLng !== 0) {
			const startMarker = L.circleMarker([startLat, startLng], {
				radius: TRIM_MARKER_RADIUS_PX,
				fillColor: "green",
				color: "white",
				weight: 2,
				opacity: 1,
				fillOpacity: 0.8,
				trimMarker: true,
			} as any);
			startMarker.addTo(routeLayer);
		}
	}

	// Add trim end marker (red)
	if (trimEnd < posLat.length) {
		const endLat = posLat[trimEnd];
		const endLng = posLong[trimEnd];
		log.debug("Adding trim end marker:", {
			index: trimEnd,
			lat: endLat,
			lng: endLng,
		});
		if (endLat && endLng && endLat !== 0 && endLng !== 0) {
			const endMarker = L.circleMarker([endLat, endLng], {
				radius: TRIM_MARKER_RADIUS_PX,
				fillColor: "red",
				color: "white",
				weight: 2,
				opacity: 1,
				fillOpacity: 0.8,
				trimMarker: true,
			} as any);
			endMarker.addTo(routeLayer);
		}
	}
}
