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
import { createGateMarkers, type GateMarkers } from "./map/gateMarkers";
import * as gateMarkers from "./map/gateMarkers";
import { collectValidPoints } from "./map/geo";
import * as routeRendering from "./map/routeRendering";
import * as trimMarkers from "./map/trimMarkers";
import * as windIndicator from "./map/windIndicator";

/**
 * Map facade (D-08/D-09): owns the Leaflet lifecycle and the shared map
 * state, and delegates all feature behavior — route rendering, trim markers,
 * detected routes, gate/A/B markers, wind indicator — to the internal
 * `components/map/` modules via `MapContext`. `shell/` modules import ONLY
 * this facade; its public API is frozen (17 live methods).
 */
export class MapVisualization {
	private map: L.Map | null = null;
	private routeLayer: L.LayerGroup | null = null;
	private container: HTMLElement;
	private fitData: FitData | null = null;
	private laps: LapData[] = [];
	private selectedLaps: number[] = [];
	private routePoints: [number, number][] = [];
	private routePointIndices: number[] = []; // Maps route point index to fitData index

	// Gate + out-and-back marker handles (mutated by the gateMarkers module)
	private readonly gateMarkers: GateMarkers = createGateMarkers();
	private gpsMarkerLayer: L.LayerGroup | null = null;
	private detectedLapsLayer: L.LayerGroup | null = null;

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
		windIndicator.showWindIndicator(
			this.container,
			windSpeed,
			windDirection,
			windSpeedUnit,
		);
	}

	public hideWindIndicator(): void {
		windIndicator.hideWindIndicator(this.container);
	}

	// ==================== GPS Lap Detection Methods ====================

	/**
	 * Set the GPS marker at a specific location
	 */
	public setGpsMarker(lat: number, lon: number): void {
		const ctx = this.getContext();
		if (!ctx) return;
		gateMarkers.setGpsMarker(ctx, this.gateMarkers, lat, lon);
	}

	/**
	 * Clear the GPS marker
	 */
	public clearGpsMarker(): void {
		gateMarkers.clearGpsMarker(this.gpsMarkerLayer, this.gateMarkers);
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
		const ctx = this.getContext();
		if (!ctx) return;
		gateMarkers.setGpsMarkerA(ctx, this.gateMarkers, lat, lon);
	}

	/**
	 * Set GPS marker B at a specific location
	 */
	public setGpsMarkerB(lat: number, lon: number): void {
		const ctx = this.getContext();
		if (!ctx) return;
		gateMarkers.setGpsMarkerB(ctx, this.gateMarkers, lat, lon);
	}

	/**
	 * Clear both Out and Back markers
	 */
	public clearOutAndBackMarkers(): void {
		gateMarkers.clearOutAndBackMarkers(this.gpsMarkerLayer, this.gateMarkers);
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
