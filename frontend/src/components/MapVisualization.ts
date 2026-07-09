import * as L from "leaflet";
import "leaflet/dist/leaflet.css";
import type {
	DetectedLap,
	PassingPoint,
	OutAndBackSection,
} from "../utils/GpsLapDetection";
import { log } from "../utils/log";

type NumericSeries = ArrayLike<number>;

interface LapData {
	lap_number?: number;
	start_time: number;
	end_time: number;
	total_elapsed_time: number;
	total_distance: number;
	avg_speed: number;
	max_speed?: number;
	avg_power?: number;
	max_power?: number;
	start_position_lat?: number;
	start_position_long?: number;
}

interface FitData {
	timestamps: NumericSeries;
	position_lat: NumericSeries;
	position_long: NumericSeries;
	velocity: NumericSeries;
	power: NumericSeries;
	altitude: NumericSeries;
	distance: NumericSeries;
	air_speed: NumericSeries;
	wind_speed: NumericSeries;
	heart_rate: NumericSeries;
	cadence: NumericSeries;
	temperature: NumericSeries;
}

// Callback type for GPS marker changes
export type GpsMarkerChangeCallback = (
	lat: number,
	lon: number,
	nearestIndex: number,
) => void;
// Callback type for Out and Back marker changes (marker A or B)
export type OutAndBackMarkerChangeCallback = (
	marker: "A" | "B",
	lat: number,
	lon: number,
	nearestIndex: number,
) => void;

const ROUTE_BOUNDS_PADDING_PX = 20;
const FOCUSED_BOUNDS_PADDING_PX = 30;
const TRIM_MARKER_RADIUS_PX = 8;
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
	private gpsMarkerPosition: { lat: number; lon: number } | null = null;
	private gpsMarkerLayer: L.LayerGroup | null = null;
	private detectedLapsLayer: L.LayerGroup | null = null;
	private onGpsMarkerChange: GpsMarkerChangeCallback | null = null;
	private gpsMarkerModeEnabled: boolean = false;

	// Out and Back mode state
	private outAndBackModeEnabled: boolean = false;
	private activeMarker: "A" | "B" = "A"; // Which marker to place next
	private gpsMarkerA: L.CircleMarker | null = null;
	private gpsMarkerB: L.CircleMarker | null = null;
	private gpsMarkerAPosition: { lat: number; lon: number } | null = null;
	private gpsMarkerBPosition: { lat: number; lon: number } | null = null;
	private onOutAndBackMarkerChange: OutAndBackMarkerChangeCallback | null =
		null;
	private boundOutAndBackClickHandler:
		| ((e: L.LeafletMouseEvent) => void)
		| null = null;

	constructor(containerId: string) {
		this.container = document.getElementById(containerId) as HTMLElement;
		if (!this.container) {
			throw new Error(`Container with id '${containerId}' not found`);
		}
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
		this.routePoints = [];
		this.routePointIndices = [];
		for (let i = 0; i < fitData.timestamps.length; i++) {
			const lat = fitData.position_lat[i];
			const lng = fitData.position_long[i];

			// Filter out invalid GPS coordinates
			if (lat && lng && lat !== 0 && lng !== 0) {
				this.routePoints.push([lat, lng]);
				this.routePointIndices.push(i);
			}
		}

		// Update map view if we have GPS data
		if (this.routePoints.length > 0) {
			this.fitBoundsToRoute();
			this.updateVisualization();
		}
	}

	public setSelectedLaps(selectedLaps: number[]): void {
		log.debug("MapVisualization.setSelectedLaps called with:", selectedLaps);
		this.selectedLaps = selectedLaps;
		this.updateVisualization();

		// Auto-zoom to selected laps
		if (selectedLaps.length > 0) {
			this.fitBoundsToSelectedLaps();
		} else {
			this.fitBoundsToRoute();
		}
	}

	private fitBoundsToRoute(): void {
		if (!this.map || this.routePoints.length === 0) return;

		const bounds = L.latLngBounds(this.routePoints);
		// animate: false — Leaflet silently drops any fitBounds issued while a
		// zoom animation is in flight (_tryAnimatedZoom returns early), which
		// swallowed the follow-up fitBoundsToSelectedLaps during map rebuilds.
		this.map.fitBounds(bounds, {
			padding: [ROUTE_BOUNDS_PADDING_PX, ROUTE_BOUNDS_PADDING_PX],
			animate: false,
		});
	}

	private fitBoundsToSelectedLaps(): void {
		if (
			!this.map ||
			!this.fitData ||
			this.routePoints.length === 0 ||
			this.selectedLaps.length === 0
		)
			return;

		// Collect all GPS points that belong to selected laps
		const selectedPoints: [number, number][] = [];

		for (const lapNumber of this.selectedLaps) {
			const lapIndex = lapNumber - 1;
			const lap = this.laps[lapIndex];

			if (!lap) continue;

			for (let i = 0; i < this.fitData.timestamps.length; i++) {
				const timestamp = this.fitData.timestamps[i];
				if (timestamp >= lap.start_time && timestamp <= lap.end_time) {
					const lat = this.fitData.position_lat[i];
					const lng = this.fitData.position_long[i];

					if (lat && lng && lat !== 0 && lng !== 0) {
						selectedPoints.push([lat, lng]);
					}
				}
			}
		}

		if (selectedPoints.length > 0) {
			const bounds = L.latLngBounds(selectedPoints);
			this.map.fitBounds(bounds, {
				padding: [FOCUSED_BOUNDS_PADDING_PX, FOCUSED_BOUNDS_PADDING_PX],
			});
		}
	}

	public fitBoundsToTrimRegion(
		trimStart: number,
		trimEnd: number,
		filteredPositionLat?: number[],
		filteredPositionLong?: number[],
	): void {
		if (!this.map || this.routePoints.length === 0) return;

		log.debug("fitBoundsToTrimRegion called:", {
			trimStart,
			trimEnd,
			hasFilteredData: !!(filteredPositionLat && filteredPositionLong),
			filteredDataLength: filteredPositionLat?.length,
		});

		// Use filtered data if provided (for VE analysis), otherwise use full fit data
		const posLat = filteredPositionLat || this.fitData?.position_lat;
		const posLong = filteredPositionLong || this.fitData?.position_long;

		if (!posLat || !posLong) return;

		// Collect GPS points in the trim region (trimEnd is inclusive)
		const trimmedPoints: [number, number][] = [];

		for (let i = trimStart; i <= Math.min(trimEnd, posLat.length - 1); i++) {
			const lat = posLat[i];
			const lng = posLong[i];

			if (lat && lng && lat !== 0 && lng !== 0) {
				trimmedPoints.push([lat, lng]);
			}
		}

		log.debug("Trimmed points collected:", trimmedPoints.length);

		if (trimmedPoints.length > 0) {
			const bounds = L.latLngBounds(trimmedPoints);
			this.map.fitBounds(bounds, {
				padding: [FOCUSED_BOUNDS_PADDING_PX, FOCUSED_BOUNDS_PADDING_PX],
			});

			// Add trim markers
			this.addTrimMarkers(trimStart, trimEnd, posLat, posLong);
		}
	}

	private addTrimMarkers(
		trimStart: number,
		trimEnd: number,
		posLat: NumericSeries,
		posLong: NumericSeries,
	): void {
		if (!this.map || !this.routeLayer) return;

		// Remove existing trim markers
		this.routeLayer.eachLayer((layer: any) => {
			if (layer.options && layer.options.trimMarker) {
				this.routeLayer!.removeLayer(layer);
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
				startMarker.addTo(this.routeLayer);
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
				endMarker.addTo(this.routeLayer);
			}
		}
	}

	private updateVisualization(): void {
		log.debug("updateVisualization called:", {
			hasMap: !!this.map,
			hasRouteLayer: !!this.routeLayer,
			hasFitData: !!this.fitData,
			routePointsCount: this.routePoints.length,
			selectedLaps: this.selectedLaps,
		});

		if (!this.map || !this.routeLayer || !this.fitData) {
			log.debug("Missing required objects for visualization");
			return;
		}

		// Clear existing layers
		this.routeLayer.clearLayers();

		if (this.routePoints.length === 0) {
			log.debug("No route points available");
			return;
		}

		if (this.selectedLaps.length === 0) {
			log.debug("Drawing full route (no laps selected)");
			// No laps selected - show full route in solid blue
			this.drawFullRoute();
		} else {
			log.debug("Drawing selected laps:", this.selectedLaps);
			// Show selected laps highlighted
			this.drawSelectedLaps();
		}
	}

	private drawFullRoute(): void {
		if (!this.routeLayer || this.routePoints.length === 0) return;

		const polyline = L.polyline(this.routePoints, {
			color: "#4363d8",
			weight: 4,
			opacity: 1.0,
		});

		polyline.addTo(this.routeLayer);
	}

	private drawSelectedLaps(): void {
		if (!this.routeLayer || !this.fitData || this.routePoints.length === 0)
			return;

		// Create a mask to mark which points belong to selected laps
		const selectedMask = new Array(this.fitData.timestamps.length).fill(false);

		// Mark all points that belong to selected laps
		for (const lapNumber of this.selectedLaps) {
			// Convert 1-based lap numbers to 0-based array index
			const lapIndex = lapNumber - 1;
			const lap = this.laps[lapIndex];

			if (!lap) {
				log.debug(`Lap ${lapNumber} not found in laps array`);
				continue;
			}

			log.debug(`Processing lap ${lapNumber}:`, {
				start_time: lap.start_time,
				end_time: lap.end_time,
				total_elapsed_time: lap.total_elapsed_time,
			});

			for (let i = 0; i < this.fitData.timestamps.length; i++) {
				const timestamp = this.fitData.timestamps[i];
				if (timestamp >= lap.start_time && timestamp <= lap.end_time) {
					selectedMask[i] = true;
				}
			}
		}

		// Convert to route point indices (filtering out invalid GPS points)
		const routeSelectedMask: boolean[] = [];
		let routeIndex = 0;

		for (let i = 0; i < this.fitData.timestamps.length; i++) {
			const lat = this.fitData.position_lat[i];
			const lng = this.fitData.position_long[i];

			if (lat && lng && lat !== 0 && lng !== 0) {
				routeSelectedMask[routeIndex] = selectedMask[i];
				routeIndex++;
			}
		}

		// Draw non-selected segments (dashed blue with reduced opacity)
		this.drawSegments(routeSelectedMask, false, {
			color: "#4363d8",
			weight: 3,
			opacity: 0.5,
			dashArray: "5,10",
		});

		// Draw selected segments (solid blue with full opacity)
		this.drawSegments(routeSelectedMask, true, {
			color: "#4363d8",
			weight: 5,
			opacity: 1.0,
		});

		// Add lap markers
		this.addLapMarkers();
	}

	private drawSegments(
		mask: boolean[],
		isSelected: boolean,
		style: L.PolylineOptions,
	): void {
		if (!this.routeLayer) return;

		const segments: [number, number][][] = [];
		let currentSegment: [number, number][] = [];

		for (let i = 0; i < mask.length; i++) {
			if (mask[i] === isSelected) {
				currentSegment.push(this.routePoints[i]);
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
			polyline.addTo(this.routeLayer);
		}
	}

	private addLapMarkers(): void {
		if (!this.routeLayer || !this.fitData) return;

		for (const lapNumber of this.selectedLaps) {
			// Convert 1-based lap numbers to 0-based array index
			const lapIndex = lapNumber - 1;
			const lap = this.laps[lapIndex];
			if (!lap) continue;

			// Find start and end points
			let startPoint: [number, number] | null = null;
			let endPoint: [number, number] | null = null;

			for (let i = 0; i < this.fitData.timestamps.length; i++) {
				const timestamp = this.fitData.timestamps[i];
				const lat = this.fitData.position_lat[i];
				const lng = this.fitData.position_long[i];

				if (lat && lng && lat !== 0 && lng !== 0) {
					if (timestamp >= lap.start_time && timestamp <= lap.end_time) {
						if (!startPoint) {
							startPoint = [lat, lng];
						}
						endPoint = [lat, lng];
					}
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
				startMarker.addTo(this.routeLayer);
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
				endMarker.addTo(this.routeLayer);
			}
		}
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

	private degreeToCardinal(degrees: number): string {
		const directions = [
			"N",
			"NNE",
			"NE",
			"ENE",
			"E",
			"ESE",
			"SE",
			"SSE",
			"S",
			"SSW",
			"SW",
			"WSW",
			"W",
			"WNW",
			"NW",
			"NNW",
		];
		const index = Math.round((degrees % 360) / 22.5) % 16;
		return directions[index];
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
		const cardinal = this.degreeToCardinal(windDirection);
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
	 * Enable GPS marker placement mode
	 * When enabled, clicking on the map places a GPS marker for lap detection
	 */
	public enableGpsMarkerMode(callback: GpsMarkerChangeCallback): void {
		if (!this.map) return;

		this.gpsMarkerModeEnabled = true;
		this.onGpsMarkerChange = callback;

		// Change cursor to crosshair when hovering over the map
		this.container.style.cursor = "crosshair";

		// Add click handler to place marker
		this.map.on("click", this.handleMapClick.bind(this));

		log.debug("GPS marker mode enabled");
	}

	/**
	 * Disable GPS marker placement mode
	 */
	public disableGpsMarkerMode(): void {
		if (!this.map) return;

		this.gpsMarkerModeEnabled = false;
		this.onGpsMarkerChange = null;

		// Reset cursor
		this.container.style.cursor = "";

		// Remove click handler
		this.map.off("click", this.handleMapClick.bind(this));

		log.debug("GPS marker mode disabled");
	}

	/**
	 * Handle map click for GPS marker placement
	 */
	private handleMapClick(e: L.LeafletMouseEvent): void {
		if (!this.gpsMarkerModeEnabled || !this.fitData) return;

		const clickedLat = e.latlng.lat;
		const clickedLon = e.latlng.lng;

		// Find the nearest point on the route
		const nearest = this.findNearestRoutePoint(clickedLat, clickedLon);
		if (!nearest) return;

		// Place marker at the nearest route point (snapping to route)
		this.setGpsMarker(nearest.lat, nearest.lon);

		// Notify callback with the marker position and data index
		if (this.onGpsMarkerChange) {
			this.onGpsMarkerChange(nearest.lat, nearest.lon, nearest.dataIndex);
		}
	}

	/**
	 * Find the nearest point on the route to the given coordinates
	 */
	private findNearestRoutePoint(
		lat: number,
		lon: number,
	): {
		lat: number;
		lon: number;
		routeIndex: number;
		dataIndex: number;
	} | null {
		if (this.routePoints.length === 0) return null;

		let nearestIndex = 0;
		let nearestDistance = Infinity;

		for (let i = 0; i < this.routePoints.length; i++) {
			const [routeLat, routeLon] = this.routePoints[i];
			// Use simple Euclidean distance for speed (good enough for snapping)
			const dist = Math.pow(lat - routeLat, 2) + Math.pow(lon - routeLon, 2);
			if (dist < nearestDistance) {
				nearestDistance = dist;
				nearestIndex = i;
			}
		}

		const [nearestLat, nearestLon] = this.routePoints[nearestIndex];
		const dataIndex = this.routePointIndices[nearestIndex];

		return {
			lat: nearestLat,
			lon: nearestLon,
			routeIndex: nearestIndex,
			dataIndex: dataIndex,
		};
	}

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
		this.gpsMarkerPosition = { lat, lon };

		log.debug("GPS marker set at:", { lat, lon });
	}

	/**
	 * Set GPS marker by data index (used when loading saved marker position)
	 */
	public setGpsMarkerByIndex(dataIndex: number): void {
		if (
			!this.fitData ||
			dataIndex < 0 ||
			dataIndex >= this.fitData.position_lat.length
		) {
			return;
		}

		const lat = this.fitData.position_lat[dataIndex];
		const lon = this.fitData.position_long[dataIndex];

		if (lat && lon && lat !== 0 && lon !== 0) {
			this.setGpsMarker(lat, lon);
		}
	}

	/**
	 * Get current GPS marker position
	 */
	public getGpsMarkerPosition(): { lat: number; lon: number } | null {
		return this.gpsMarkerPosition;
	}

	/**
	 * Get GPS marker data index (nearest index in fitData)
	 */
	public getGpsMarkerDataIndex(): number | null {
		if (!this.gpsMarkerPosition || !this.fitData) return null;

		const nearest = this.findNearestRoutePoint(
			this.gpsMarkerPosition.lat,
			this.gpsMarkerPosition.lon,
		);

		return nearest?.dataIndex ?? null;
	}

	/**
	 * Clear the GPS marker
	 */
	public clearGpsMarker(): void {
		if (this.gpsMarkerLayer) {
			this.gpsMarkerLayer.clearLayers();
		}
		this.gpsMarker = null;
		this.gpsMarkerPosition = null;
	}

	/**
	 * Display detected laps on the map
	 */
	public showDetectedLaps(
		laps: DetectedLap[],
		_passings: PassingPoint[],
	): void {
		if (!this.detectedLapsLayer || !this.fitData) return;

		// Clear existing lap visualizations
		this.detectedLapsLayer.clearLayers();

		// Define colors for laps (cycle through if more laps than colors)
		const lapColors = [
			"#4363d8", // Blue
			"#e6194b", // Red
			"#3cb44b", // Green
			"#f58231", // Orange
			"#911eb4", // Purple
			"#46f0f0", // Cyan
			"#f032e6", // Magenta
			"#bcf60c", // Lime
		];

		// Draw lap segments with different colors
		for (const lap of laps) {
			const color = lapColors[(lap.lapNumber - 1) % lapColors.length];

			// Extract route points for this lap
			const lapPoints: [number, number][] = [];
			for (
				let i = lap.startIdx;
				i <= lap.endIdx && i < this.fitData.position_lat.length;
				i++
			) {
				const lat = this.fitData.position_lat[i];
				const lon = this.fitData.position_long[i];
				if (lat && lon && lat !== 0 && lon !== 0) {
					lapPoints.push([lat, lon]);
				}
			}

			if (lapPoints.length > 1) {
				// Draw lap polyline
				const polyline = L.polyline(lapPoints, {
					color: color,
					weight: 4,
					opacity: 0.8,
				});
				polyline.addTo(this.detectedLapsLayer);
			}
		}

		log.debug(`Displayed ${laps.length} detected laps on map`);
	}

	/**
	 * Clear detected lap visualizations
	 */
	public clearDetectedLaps(): void {
		if (this.detectedLapsLayer) {
			this.detectedLapsLayer.clearLayers();
		}
	}

	/**
	 * Check if GPS marker mode is enabled
	 */
	public isGpsMarkerModeEnabled(): boolean {
		return this.gpsMarkerModeEnabled;
	}

	// ==================== Out and Back Mode Methods ====================

	/**
	 * Enable Out and Back marker placement mode
	 * When enabled, clicking on the map places GPS markers A and B alternately
	 * Note: Call setActiveMarker() BEFORE this to set which marker to place
	 */
	public enableOutAndBackMode(callback: OutAndBackMarkerChangeCallback): void {
		if (!this.map) return;

		// Remove existing handler if any (prevent duplicates)
		if (this.boundOutAndBackClickHandler) {
			this.map.off("click", this.boundOutAndBackClickHandler);
		}

		this.outAndBackModeEnabled = true;
		this.onOutAndBackMarkerChange = callback;
		// Don't reset activeMarker here - let setActiveMarker control it

		// Change cursor to crosshair when hovering over the map
		this.container.style.cursor = "crosshair";

		// Create and store bound handler for proper removal later
		this.boundOutAndBackClickHandler = this.handleOutAndBackClick.bind(this);
		this.map.on("click", this.boundOutAndBackClickHandler);

		log.debug(
			`Out and Back marker mode enabled - place marker ${this.activeMarker} first`,
		);
	}

	/**
	 * Disable Out and Back marker placement mode
	 */
	public disableOutAndBackMode(): void {
		if (!this.map) return;

		this.outAndBackModeEnabled = false;
		this.onOutAndBackMarkerChange = null;

		// Reset cursor
		this.container.style.cursor = "";

		// Remove click handler using the stored bound reference
		if (this.boundOutAndBackClickHandler) {
			this.map.off("click", this.boundOutAndBackClickHandler);
			this.boundOutAndBackClickHandler = null;
		}

		log.debug("Out and Back marker mode disabled");
	}

	/**
	 * Set which marker to place next (A or B)
	 */
	public setActiveMarker(marker: "A" | "B"): void {
		this.activeMarker = marker;
		log.debug(`Active marker set to: ${marker}`);
	}

	/**
	 * Get current active marker
	 */
	public getActiveMarker(): "A" | "B" {
		return this.activeMarker;
	}

	/**
	 * Handle map click for Out and Back marker placement
	 */
	private handleOutAndBackClick(e: L.LeafletMouseEvent): void {
		if (!this.outAndBackModeEnabled || !this.fitData) return;

		const clickedLat = e.latlng.lat;
		const clickedLon = e.latlng.lng;

		// Find the nearest point on the route
		const nearest = this.findNearestRoutePoint(clickedLat, clickedLon);
		if (!nearest) return;

		// Place the appropriate marker
		if (this.activeMarker === "A") {
			this.setGpsMarkerA(nearest.lat, nearest.lon);
		} else {
			this.setGpsMarkerB(nearest.lat, nearest.lon);
		}

		// Notify callback with the marker position and data index
		if (this.onOutAndBackMarkerChange) {
			this.onOutAndBackMarkerChange(
				this.activeMarker,
				nearest.lat,
				nearest.lon,
				nearest.dataIndex,
			);
		}

		// Auto-switch to next marker
		this.activeMarker = this.activeMarker === "A" ? "B" : "A";
	}

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
		this.gpsMarkerAPosition = { lat, lon };

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
		this.gpsMarkerBPosition = { lat, lon };

		log.debug("GPS marker B set at:", { lat, lon });
	}

	/**
	 * Set GPS marker A by data index
	 */
	public setGpsMarkerAByIndex(dataIndex: number): void {
		if (
			!this.fitData ||
			dataIndex < 0 ||
			dataIndex >= this.fitData.position_lat.length
		) {
			return;
		}

		const lat = this.fitData.position_lat[dataIndex];
		const lon = this.fitData.position_long[dataIndex];

		if (lat && lon && lat !== 0 && lon !== 0) {
			this.setGpsMarkerA(lat, lon);
		}
	}

	/**
	 * Set GPS marker B by data index
	 */
	public setGpsMarkerBByIndex(dataIndex: number): void {
		if (
			!this.fitData ||
			dataIndex < 0 ||
			dataIndex >= this.fitData.position_lat.length
		) {
			return;
		}

		const lat = this.fitData.position_lat[dataIndex];
		const lon = this.fitData.position_long[dataIndex];

		if (lat && lon && lat !== 0 && lon !== 0) {
			this.setGpsMarkerB(lat, lon);
		}
	}

	/**
	 * Get GPS marker A position
	 */
	public getGpsMarkerAPosition(): { lat: number; lon: number } | null {
		return this.gpsMarkerAPosition;
	}

	/**
	 * Get GPS marker B position
	 */
	public getGpsMarkerBPosition(): { lat: number; lon: number } | null {
		return this.gpsMarkerBPosition;
	}

	/**
	 * Get GPS marker A data index
	 */
	public getGpsMarkerADataIndex(): number | null {
		if (!this.gpsMarkerAPosition || !this.fitData) return null;

		const nearest = this.findNearestRoutePoint(
			this.gpsMarkerAPosition.lat,
			this.gpsMarkerAPosition.lon,
		);

		return nearest?.dataIndex ?? null;
	}

	/**
	 * Get GPS marker B data index
	 */
	public getGpsMarkerBDataIndex(): number | null {
		if (!this.gpsMarkerBPosition || !this.fitData) return null;

		const nearest = this.findNearestRoutePoint(
			this.gpsMarkerBPosition.lat,
			this.gpsMarkerBPosition.lon,
		);

		return nearest?.dataIndex ?? null;
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
		this.gpsMarkerAPosition = null;
		this.gpsMarkerBPosition = null;
	}

	/**
	 * Display detected Out and Back sections on the map
	 */
	public showOutAndBackSections(
		sections: OutAndBackSection[],
		_passingsA: PassingPoint[],
		_passingsB: PassingPoint[],
	): void {
		if (!this.detectedLapsLayer || !this.fitData) return;

		// Clear existing visualizations
		this.detectedLapsLayer.clearLayers();

		// Define colors for sections
		const sectionColors = [
			"#4363d8", // Blue
			"#e6194b", // Red
			"#3cb44b", // Green
			"#f58231", // Orange
			"#911eb4", // Purple
			"#46f0f0", // Cyan
			"#f032e6", // Magenta
			"#bcf60c", // Lime
		];

		// Draw each section (just the track segments, no labels)
		for (const section of sections) {
			const color =
				sectionColors[(section.sectionNumber - 1) % sectionColors.length];

			// Draw outbound segment (A → B) - solid line
			const outboundPoints: [number, number][] = [];
			for (
				let i = section.outboundStartIdx;
				i <= section.outboundEndIdx && i < this.fitData.position_lat.length;
				i++
			) {
				const lat = this.fitData.position_lat[i];
				const lon = this.fitData.position_long[i];
				if (lat && lon && lat !== 0 && lon !== 0) {
					outboundPoints.push([lat, lon]);
				}
			}

			if (outboundPoints.length > 1) {
				const outboundLine = L.polyline(outboundPoints, {
					color: color,
					weight: 4,
					opacity: 0.8,
				});
				outboundLine.addTo(this.detectedLapsLayer);
			}

			// Draw inbound segment (B → A) - dashed line
			const inboundPoints: [number, number][] = [];
			for (
				let i = section.inboundStartIdx;
				i <= section.inboundEndIdx && i < this.fitData.position_lat.length;
				i++
			) {
				const lat = this.fitData.position_lat[i];
				const lon = this.fitData.position_long[i];
				if (lat && lon && lat !== 0 && lon !== 0) {
					inboundPoints.push([lat, lon]);
				}
			}

			if (inboundPoints.length > 1) {
				const inboundLine = L.polyline(inboundPoints, {
					color: color,
					weight: 4,
					opacity: 0.8,
					dashArray: "10, 5", // Dashed for inbound
				});
				inboundLine.addTo(this.detectedLapsLayer);
			}
		}

		log.debug(`Displayed ${sections.length} out-and-back sections on map`);
	}

	/**
	 * Check if Out and Back mode is enabled
	 */
	public isOutAndBackModeEnabled(): boolean {
		return this.outAndBackModeEnabled;
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
