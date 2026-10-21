/**
 * Course checkpoint markers (CP1…CP4) on their OWN layer.
 *
 * Not on the shared `gpsMarkerLayer`: `setGpsMarker` clears that whole layer on
 * every gate move, and checkpoints live in every mode beside whichever gates
 * the mode places.
 */
import * as L from "leaflet";

const CHECKPOINT_MARKER_RADIUS_PX = 8;
const CHECKPOINT_TOOLTIP_OFFSET_Y_PX = 6;
export const CHECKPOINT_COLOR = "#911eb4";

export interface CheckpointMarker {
	lat: number;
	lon: number;
	label: string;
}

/** Replace every checkpoint marker on `layer` with `markers`. */
export function setCheckpointMarkers(
	layer: L.LayerGroup,
	markers: readonly CheckpointMarker[],
): void {
	layer.clearLayers();
	for (const marker of markers) {
		L.circleMarker([marker.lat, marker.lon], {
			radius: CHECKPOINT_MARKER_RADIUS_PX,
			fillColor: CHECKPOINT_COLOR,
			color: "#ffffff",
			weight: 2,
			opacity: 1,
			fillOpacity: 0.9,
		})
			.bindPopup(`Checkpoint ${marker.label}`)
			.bindTooltip(marker.label, {
				permanent: true,
				direction: "top",
				offset: [0, -CHECKPOINT_TOOLTIP_OFFSET_Y_PX],
				className: "gate-marker-label gate-marker-label--checkpoint",
			})
			.addTo(layer);
	}
}
