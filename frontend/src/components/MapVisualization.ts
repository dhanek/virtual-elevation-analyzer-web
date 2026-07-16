import * as L from "leaflet";
import "leaflet/dist/leaflet.css";
import type {
	DetectedLap,
	PassingPoint,
	OutAndBackSection,
} from "../utils/GpsLapDetection";
import { log } from "../utils/log";
import type { FitData, LapData, MapContext } from "./map/context";
import * as detectedRoutes from "./map/detectedRoutes";
import { collectValidPoints, degreeToCardinal } from "./map/geo";
import * as routeRendering from "./map/routeRendering";
import * as trimMarkers from "./map/trimMarkers";

const GATE_MARKER_RADIUS_PX = 12;
const GATE_MARKER_TOOLTIP_OFFSET_Y_PX = 8;

export class MapVisualization {
	private map: L.Map | null = null;
	private routeLayer: L.LayerGroup | null = null;
	private container: HTMLElement;
	private fitData: FitData | null = null;
	private laps: LapData[] = [];
	private selectedLaps: number[] = [];
	private routePoints: [number, number][] = [];
	private routePointIndices: number[] = []; // Maps route point index to fitData index
	private windIndicator: HTMLElement | null = null;

	// GPS Lap Detection state
	private gpsMarker: L.CircleMarker | null = null;
	private gpsMarkerLayer: L.LayerGroup | null = null;
	private detectedLapsLayer: L.LayerGroup | null = null;

	// Out and Back mode state
	private gpsMarkerA: L.CircleMarker | null = null;
	private gpsMarkerB: L.CircleMarker | null = null;

	constructor(containerId: string) {
		this.container = document.getElementById(containerId) as HTMLElement;
		if (!this.container) {
			throw new Error(`Container with id '${containerId}' not found`);
		}
	}

	/**
	 * Build the `MapContext` handed to the `components/map/` feature modules
	 * (D-08/D-09). Returns null before `initialize()` / after `destroy()` —
	 * delegating methods early-return then, matching the null guards the
	 * pre-extraction implementations carried.
	 */
	private getContext(): MapContext | null {
		if (
			!this.map ||
			!this.routeLayer ||
			!this.gpsMarkerLayer ||
			!this.detectedLapsLayer
		) {
			return null;
		}
		return {
			map: this.map,
			routeLayer: this.routeLayer,
			gpsMarkerLayer: this.gpsMarkerLayer,
			detectedLapsLayer: this.detectedLapsLayer,
			container: this.container,
			getFitData: () => this.fitData,
			getRoutePoints: () => this.routePoints,
			getRoutePointIndices: () => this.routePointIndices,
			getLaps: () => this.laps,
			getSelectedLaps: () => this.selectedLaps,
		};
	}

	public async initialize(): Promise<void> {
		// Leaflet CSS is bundled via the static `import "leaflet/dist/leaflet.css"`
		// at the top of this module (no runtime CDN <link>). Yield one frame so any
		// pending layout/style flush completes before the map is constructed and
		// before downstream Plotly plots size to their containers — this preserves
		// the event-loop boundary the previous link.onload await provided. Without
		// it, VE plots can render against a not-yet-settled container and collapse.
		await new Promise((resolve) => requestAnimationFrame(() => resolve(null)));

		// Initialize the map
		this.map = L.map(this.container, {
			center: [52.52, 13.405], // Default to Berlin
			zoom: 13,
			zoomControl: true,
			attributionControl: true,
		});

		// Add OpenStreetMap tile layer
		L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
			attribution: "© OpenStreetMap contributors",
			maxZoom: 19,
		}).addTo(this.map);

		// Initialize route layer
		this.routeLayer = L.layerGroup().addTo(this.map);

		// Initialize GPS marker layer (on top of route)
		this.gpsMarkerLayer = L.layerGroup().addTo(this.map);

		// Initialize detected laps visualization layer
		this.detectedLapsLayer = L.layerGroup().addTo(this.map);
	}

	public setData(fitData: FitData, laps: LapData[]): void {
		this.fitData = fitData;
		this.laps = laps;

		// Extract valid GPS points and track their indices
		const { points, indices } = collectValidPoints(
			fitData.position_lat,
			fitData.position_long,
			0,
			fitData.timestamps.length - 1,
		);
		this.routePoints = points;
		this.routePointIndices = indices;

		// Update map view if we have GPS data
		const ctx = this.getContext();
		if (ctx && this.routePoints.length > 0) {
			routeRendering.fitBoundsToRoute(ctx);
			routeRendering.updateVisualization(ctx);
		}
	}

	public setSelectedLaps(selectedLaps: number[]): void {
		log.debug("MapVisualization.setSelectedLaps called with:", selectedLaps);
		this.selectedLaps = selectedLaps;

		const ctx = this.getContext();
		if (!ctx) return;
		routeRendering.updateVisualization(ctx);

		// Auto-zoom to selected laps
		if (selectedLaps.length > 0) {
			routeRendering.fitBoundsToSelectedLaps(ctx);
		} else {
			routeRendering.fitBoundsToRoute(ctx);
		}
	}

	public fitBoundsToTrimRegion(
		trimStart: number,
		trimEnd: number,
		filteredPositionLat?: number[],
		filteredPositionLong?: number[],
	): void {
		const ctx = this.getContext();
		if (!ctx) return;
		trimMarkers.fitBoundsToTrimRegion(
			ctx,
			trimStart,
			trimEnd,
			filteredPositionLat,
			filteredPositionLong,
		);
	}

	public hasGpsData(): boolean {
		return this.routePoints.length > 0;
	}

	public resizeMap(): void {
		if (this.map) {
			// Force map to recalculate its size after container resize
			setTimeout(() => {
				if (this.map) {
					this.map.invalidateSize();
				}
			}, 100);
		}
	}

	public showWindIndicator(
		windSpeed: number,
		windDirection: number,
		windSpeedUnit: "m/s" | "km/h" = "m/s",
	): void {
		// Remove existing indicator if present
		if (this.windIndicator) {
			this.windIndicator.remove();
		}

		// Only show if wind parameters are non-zero
		if (windSpeed === 0 && windDirection === 0) {
			return;
		}

		// Convert wind speed to selected unit
		const displaySpeed = windSpeedUnit === "km/h" ? windSpeed * 3.6 : windSpeed;

		// Create wind indicator overlay
		this.windIndicator = document.createElement("div");
		this.windIndicator.style.position = "absolute";
		this.windIndicator.style.top = "10px";
		this.windIndicator.style.right = "10px";
		this.windIndicator.style.backgroundColor = "rgba(255, 255, 255, 0.9)";
		this.windIndicator.style.padding = "12px";
		this.windIndicator.style.borderRadius = "8px";
		this.windIndicator.style.border = "1px solid #4363d8";
		this.windIndicator.style.boxShadow = "0 2px 8px rgba(0,0,0,0.2)";
		this.windIndicator.style.zIndex = "1000";
		this.windIndicator.style.display = "flex";
		this.windIndicator.style.flexDirection = "column";
		this.windIndicator.style.alignItems = "center";
		this.windIndicator.style.gap = "6px";
		this.windIndicator.style.minWidth = "110px";

		// Create title
		const title = document.createElement("div");
		title.textContent = "Wind";
		title.style.fontSize = "16px";
		title.style.fontWeight = "600";
		title.style.color = "#4363d8";
		title.style.marginBottom = "2px";

		// Create arrow element - rotated by windDirection + 180 to point where wind is coming FROM
		const arrow = document.createElement("div");
		arrow.innerHTML = "↑";
		arrow.style.fontSize = "32px";
		arrow.style.transform = `rotate(${windDirection + 180}deg)`;
		arrow.style.transition = "transform 0.3s ease";
		arrow.style.color = "#4363d8";
		arrow.style.lineHeight = "1";

		// Create speed text
		const speed = document.createElement("div");
		speed.textContent = `${displaySpeed.toFixed(1)} ${windSpeedUnit}`;
		speed.style.fontSize = "14px";
		speed.style.fontWeight = "500";
		speed.style.color = "#2d3748";
		speed.style.marginTop = "2px";

		// Create direction text with cardinal direction
		const direction = document.createElement("div");
		const cardinal = degreeToCardinal(windDirection);
		direction.textContent = `${windDirection.toFixed(0)}°`;
		direction.style.fontSize = "13px";
		direction.style.color = "#666";

		// Create "from" text with cardinal direction
		const fromText = document.createElement("div");
		fromText.textContent = `from ${cardinal}`;
		fromText.style.fontSize = "12px";
		fromText.style.color = "#888";
		fromText.style.fontStyle = "italic";

		this.windIndicator.appendChild(title);
		this.windIndicator.appendChild(arrow);
		this.windIndicator.appendChild(speed);
		this.windIndicator.appendChild(direction);
		this.windIndicator.appendChild(fromText);

		// Append to map container
		this.container.style.position = "relative";
		this.container.appendChild(this.windIndicator);

		log.debug("Wind indicator shown:", { windSpeed, windDirection, cardinal });
	}

	public hideWindIndicator(): void {
		if (this.windIndicator) {
			this.windIndicator.remove();
			this.windIndicator = null;
		}
	}

	// ==================== GPS Lap Detection Methods ====================

	/**
	 * Set the GPS marker at a specific location
	 */
	public setGpsMarker(lat: number, lon: number): void {
		if (!this.gpsMarkerLayer) return;

		// Clear existing marker
		this.gpsMarkerLayer.clearLayers();

		// Create new marker with distinctive styling
		this.gpsMarker = L.circleMarker([lat, lon], {
			radius: GATE_MARKER_RADIUS_PX,
			fillColor: "#ff6b00", // Orange
			color: "#ffffff",
			weight: 3,
			opacity: 1,
			fillOpacity: 0.9,
		});

		// Add pulsing effect with CSS class
		const markerElement = this.gpsMarker.getElement?.();
		if (markerElement) {
			markerElement.classList.add("gps-gate-marker");
		}

		// Add popup
		this.gpsMarker.bindPopup("GPS Gate - Click to move");

		this.gpsMarker.addTo(this.gpsMarkerLayer);

		log.debug("GPS marker set at:", { lat, lon });
	}

	/**
	 * Clear the GPS marker
	 */
	public clearGpsMarker(): void {
		if (this.gpsMarkerLayer) {
			this.gpsMarkerLayer.clearLayers();
		}
		this.gpsMarker = null;
	}

	/**
	 * Display detected laps on the map
	 */
	public showDetectedLaps(
		laps: DetectedLap[],
		_passings: PassingPoint[],
	): void {
		const ctx = this.getContext();
		if (!ctx) return;
		detectedRoutes.showDetectedLaps(ctx, laps);
	}

	/**
	 * Clear detected lap visualizations
	 */
	public clearDetectedLaps(): void {
		detectedRoutes.clearDetectedLaps(this.detectedLapsLayer);
	}

	// ==================== Out and Back Mode Methods ====================

	/**
	 * Set GPS marker A at a specific location
	 */
	public setGpsMarkerA(lat: number, lon: number): void {
		if (!this.gpsMarkerLayer) return;

		// Remove existing marker A if present
		if (this.gpsMarkerA) {
			this.gpsMarkerLayer.removeLayer(this.gpsMarkerA);
		}

		// Create marker A with green color
		this.gpsMarkerA = L.circleMarker([lat, lon], {
			radius: GATE_MARKER_RADIUS_PX,
			fillColor: "#00aa00", // Green for start marker
			color: "#ffffff",
			weight: 3,
			opacity: 1,
			fillOpacity: 0.9,
		});

		// Add label positioned above the marker
		this.gpsMarkerA.bindPopup("Gate A (Start/End)");
		this.gpsMarkerA.bindTooltip("A", {
			permanent: true,
			direction: "top",
			offset: [0, -GATE_MARKER_TOOLTIP_OFFSET_Y_PX],
			className: "gate-marker-label gate-marker-label--a",
		});

		this.gpsMarkerA.addTo(this.gpsMarkerLayer);

		log.debug("GPS marker A set at:", { lat, lon });
	}

	/**
	 * Set GPS marker B at a specific location
	 */
	public setGpsMarkerB(lat: number, lon: number): void {
		if (!this.gpsMarkerLayer) return;

		// Remove existing marker B if present
		if (this.gpsMarkerB) {
			this.gpsMarkerLayer.removeLayer(this.gpsMarkerB);
		}

		// Create marker B with blue color
		this.gpsMarkerB = L.circleMarker([lat, lon], {
			radius: GATE_MARKER_RADIUS_PX,
			fillColor: "#0066cc", // Blue for turnaround marker
			color: "#ffffff",
			weight: 3,
			opacity: 1,
			fillOpacity: 0.9,
		});

		// Add label positioned above the marker
		this.gpsMarkerB.bindPopup("Gate B (Turnaround)");
		this.gpsMarkerB.bindTooltip("B", {
			permanent: true,
			direction: "top",
			offset: [0, -GATE_MARKER_TOOLTIP_OFFSET_Y_PX],
			className: "gate-marker-label gate-marker-label--b",
		});

		this.gpsMarkerB.addTo(this.gpsMarkerLayer);

		log.debug("GPS marker B set at:", { lat, lon });
	}

	/**
	 * Clear both Out and Back markers
	 */
	public clearOutAndBackMarkers(): void {
		if (this.gpsMarkerLayer) {
			if (this.gpsMarkerA) {
				this.gpsMarkerLayer.removeLayer(this.gpsMarkerA);
				this.gpsMarkerA = null;
			}
			if (this.gpsMarkerB) {
				this.gpsMarkerLayer.removeLayer(this.gpsMarkerB);
				this.gpsMarkerB = null;
			}
		}
	}

	/**
	 * Display detected Out and Back sections on the map
	 */
	public showOutAndBackSections(
		sections: OutAndBackSection[],
		_passingsA: PassingPoint[],
		_passingsB: PassingPoint[],
	): void {
		const ctx = this.getContext();
		if (!ctx) return;
		detectedRoutes.showOutAndBackSections(ctx, sections);
	}

	public destroy(): void {
		if (this.map) {
			this.map.remove();
			this.map = null;
		}
		this.routeLayer = null;
		this.gpsMarkerLayer = null;
		this.detectedLapsLayer = null;
		this.hideWindIndicator();
		this.clearGpsMarker();
		this.clearOutAndBackMarkers();
	}
}
