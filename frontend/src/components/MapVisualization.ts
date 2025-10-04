import * as L from 'leaflet';

interface LapData {
    lap_number: number;
    start_time: number;
    end_time: number;
    total_elapsed_time: number;
    total_distance: number;
    avg_speed: number;
    max_speed: number;
    avg_power: number;
    max_power: number;
    start_position_lat?: number;
    start_position_long?: number;
}

interface FitData {
    timestamps: number[];
    position_lat: number[];
    position_long: number[];
    velocity: number[];
    power: number[];
    altitude: number[];
    distance: number[];
    air_speed: number[];
    wind_speed: number[];
    heart_rate: number[];
    cadence: number[];
    temperature: number[];
}

export class MapVisualization {
    private map: L.Map | null = null;
    private routeLayer: L.LayerGroup | null = null;
    private container: HTMLElement;
    private fitData: FitData | null = null;
    private laps: LapData[] = [];
    private selectedLaps: number[] = [];
    private routePoints: [number, number][] = [];
    private windIndicator: HTMLElement | null = null;

    constructor(containerId: string) {
        this.container = document.getElementById(containerId) as HTMLElement;
        if (!this.container) {
            throw new Error(`Container with id '${containerId}' not found`);
        }
    }

    public async initialize(): Promise<void> {
        // Import Leaflet CSS
        const link = document.createElement('link');
        link.rel = 'stylesheet';
        link.href = 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.css';
        document.head.appendChild(link);

        // Wait for CSS to load
        await new Promise(resolve => {
            link.onload = resolve;
        });

        // Initialize the map
        this.map = L.map(this.container, {
            center: [52.52, 13.405], // Default to Berlin
            zoom: 13,
            zoomControl: true,
            attributionControl: true
        });

        // Add OpenStreetMap tile layer
        L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
            attribution: '© OpenStreetMap contributors',
            maxZoom: 19
        }).addTo(this.map);

        // Initialize route layer
        this.routeLayer = L.layerGroup().addTo(this.map);
    }

    public setData(fitData: FitData, laps: LapData[]): void {
        this.fitData = fitData;
        this.laps = laps;

        // Extract valid GPS points
        this.routePoints = [];
        for (let i = 0; i < fitData.timestamps.length; i++) {
            const lat = fitData.position_lat[i];
            const lng = fitData.position_long[i];

            // Filter out invalid GPS coordinates
            if (lat && lng && lat !== 0 && lng !== 0) {
                this.routePoints.push([lat, lng]);
            }
        }

        // Update map view if we have GPS data
        if (this.routePoints.length > 0) {
            this.fitBoundsToRoute();
            this.updateVisualization();
        }
    }

    public setSelectedLaps(selectedLaps: number[]): void {
        console.log('MapVisualization.setSelectedLaps called with:', selectedLaps);
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
        this.map.fitBounds(bounds, { padding: [20, 20] });
    }

    private fitBoundsToSelectedLaps(): void {
        if (!this.map || !this.fitData || this.routePoints.length === 0 || this.selectedLaps.length === 0) return;

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
            this.map.fitBounds(bounds, { padding: [30, 30] });
        }
    }

    public fitBoundsToTrimRegion(trimStart: number, trimEnd: number, filteredPositionLat?: number[], filteredPositionLong?: number[]): void {
        if (!this.map || this.routePoints.length === 0) return;

        console.log('fitBoundsToTrimRegion called:', {
            trimStart,
            trimEnd,
            hasFilteredData: !!(filteredPositionLat && filteredPositionLong),
            filteredDataLength: filteredPositionLat?.length
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

        console.log('Trimmed points collected:', trimmedPoints.length);

        if (trimmedPoints.length > 0) {
            const bounds = L.latLngBounds(trimmedPoints);
            this.map.fitBounds(bounds, { padding: [30, 30] });

            // Add trim markers
            this.addTrimMarkers(trimStart, trimEnd, posLat, posLong);
        }
    }

    private addTrimMarkers(trimStart: number, trimEnd: number, posLat: number[], posLong: number[]): void {
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
            console.log('Adding trim start marker:', { index: trimStart, lat: startLat, lng: startLng });
            if (startLat && startLng && startLat !== 0 && startLng !== 0) {
                const startMarker = L.circleMarker([startLat, startLng], {
                    radius: 8,
                    fillColor: 'green',
                    color: 'white',
                    weight: 2,
                    opacity: 1,
                    fillOpacity: 0.8,
                    trimMarker: true
                } as any);
                startMarker.addTo(this.routeLayer);
            }
        }

        // Add trim end marker (red)
        if (trimEnd < posLat.length) {
            const endLat = posLat[trimEnd];
            const endLng = posLong[trimEnd];
            console.log('Adding trim end marker:', { index: trimEnd, lat: endLat, lng: endLng });
            if (endLat && endLng && endLat !== 0 && endLng !== 0) {
                const endMarker = L.circleMarker([endLat, endLng], {
                    radius: 8,
                    fillColor: 'red',
                    color: 'white',
                    weight: 2,
                    opacity: 1,
                    fillOpacity: 0.8,
                    trimMarker: true
                } as any);
                endMarker.addTo(this.routeLayer);
            }
        }
    }

    private updateVisualization(): void {
        console.log('updateVisualization called:', {
            hasMap: !!this.map,
            hasRouteLayer: !!this.routeLayer,
            hasFitData: !!this.fitData,
            routePointsCount: this.routePoints.length,
            selectedLaps: this.selectedLaps
        });

        if (!this.map || !this.routeLayer || !this.fitData) {
            console.log('Missing required objects for visualization');
            return;
        }

        // Clear existing layers
        this.routeLayer.clearLayers();

        if (this.routePoints.length === 0) {
            console.log('No route points available');
            return;
        }

        if (this.selectedLaps.length === 0) {
            console.log('Drawing full route (no laps selected)');
            // No laps selected - show full route in solid blue
            this.drawFullRoute();
        } else {
            console.log('Drawing selected laps:', this.selectedLaps);
            // Show selected laps highlighted
            this.drawSelectedLaps();
        }
    }

    private drawFullRoute(): void {
        if (!this.routeLayer || this.routePoints.length === 0) return;

        const polyline = L.polyline(this.routePoints, {
            color: '#4363d8',
            weight: 4,
            opacity: 1.0
        });

        polyline.addTo(this.routeLayer);
    }

    private drawSelectedLaps(): void {
        if (!this.routeLayer || !this.fitData || this.routePoints.length === 0) return;

        // Create a mask to mark which points belong to selected laps
        const selectedMask = new Array(this.fitData.timestamps.length).fill(false);

        // Mark all points that belong to selected laps
        for (const lapNumber of this.selectedLaps) {
            // Convert 1-based lap numbers to 0-based array index
            const lapIndex = lapNumber - 1;
            const lap = this.laps[lapIndex];

            if (!lap) {
                console.log(`Lap ${lapNumber} not found in laps array`);
                continue;
            }

            console.log(`Processing lap ${lapNumber}:`, {
                start_time: lap.start_time,
                end_time: lap.end_time,
                total_elapsed_time: lap.total_elapsed_time
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
            color: '#4363d8',
            weight: 3,
            opacity: 0.5,
            dashArray: '5,10'
        });

        // Draw selected segments (solid blue with full opacity)
        this.drawSegments(routeSelectedMask, true, {
            color: '#4363d8',
            weight: 5,
            opacity: 1.0
        });

        // Add lap markers
        this.addLapMarkers();
    }

    private drawSegments(mask: boolean[], isSelected: boolean, style: L.PolylineOptions): void {
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
                        className: 'lap-marker start-marker',
                        html: `<div class="marker-content start">▶</div>`,
                        iconSize: [24, 24],
                        iconAnchor: [12, 12]
                    })
                });
                startMarker.bindPopup(`Lap ${lapNumber} Start`);
                startMarker.addTo(this.routeLayer);
            }

            if (endPoint && endPoint !== startPoint) {
                const endMarker = L.marker(endPoint, {
                    icon: L.divIcon({
                        className: 'lap-marker end-marker',
                        html: `<div class="marker-content end">⏹</div>`,
                        iconSize: [24, 24],
                        iconAnchor: [12, 12]
                    })
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
        const directions = ['N', 'NNE', 'NE', 'ENE', 'E', 'ESE', 'SE', 'SSE', 'S', 'SSW', 'SW', 'WSW', 'W', 'WNW', 'NW', 'NNW'];
        const index = Math.round(((degrees % 360) / 22.5)) % 16;
        return directions[index];
    }

    public showWindIndicator(windSpeed: number, windDirection: number, windSpeedUnit: 'm/s' | 'km/h' = 'm/s'): void {
        // Remove existing indicator if present
        if (this.windIndicator) {
            this.windIndicator.remove();
        }

        // Only show if wind parameters are non-zero
        if (windSpeed === 0 && windDirection === 0) {
            return;
        }

        // Convert wind speed to selected unit
        const displaySpeed = windSpeedUnit === 'km/h' ? windSpeed * 3.6 : windSpeed;

        // Create wind indicator overlay
        this.windIndicator = document.createElement('div');
        this.windIndicator.style.position = 'absolute';
        this.windIndicator.style.top = '10px';
        this.windIndicator.style.right = '10px';
        this.windIndicator.style.backgroundColor = 'rgba(255, 255, 255, 0.9)';
        this.windIndicator.style.padding = '12px';
        this.windIndicator.style.borderRadius = '8px';
        this.windIndicator.style.border = '1px solid #4363d8';
        this.windIndicator.style.boxShadow = '0 2px 8px rgba(0,0,0,0.2)';
        this.windIndicator.style.zIndex = '1000';
        this.windIndicator.style.display = 'flex';
        this.windIndicator.style.flexDirection = 'column';
        this.windIndicator.style.alignItems = 'center';
        this.windIndicator.style.gap = '6px';
        this.windIndicator.style.minWidth = '110px';

        // Create title
        const title = document.createElement('div');
        title.textContent = 'Wind';
        title.style.fontSize = '16px';
        title.style.fontWeight = '600';
        title.style.color = '#4363d8';
        title.style.marginBottom = '2px';

        // Create arrow element - rotated by windDirection + 180 to point where wind is coming FROM
        const arrow = document.createElement('div');
        arrow.innerHTML = '↑';
        arrow.style.fontSize = '32px';
        arrow.style.transform = `rotate(${windDirection + 180}deg)`;
        arrow.style.transition = 'transform 0.3s ease';
        arrow.style.color = '#4363d8';
        arrow.style.lineHeight = '1';

        // Create speed text
        const speed = document.createElement('div');
        speed.textContent = `${displaySpeed.toFixed(1)} ${windSpeedUnit}`;
        speed.style.fontSize = '14px';
        speed.style.fontWeight = '500';
        speed.style.color = '#2d3748';
        speed.style.marginTop = '2px';

        // Create direction text with cardinal direction
        const direction = document.createElement('div');
        const cardinal = this.degreeToCardinal(windDirection);
        direction.textContent = `${windDirection.toFixed(0)}°`;
        direction.style.fontSize = '13px';
        direction.style.color = '#666';

        // Create "from" text with cardinal direction
        const fromText = document.createElement('div');
        fromText.textContent = `from ${cardinal}`;
        fromText.style.fontSize = '12px';
        fromText.style.color = '#888';
        fromText.style.fontStyle = 'italic';

        this.windIndicator.appendChild(title);
        this.windIndicator.appendChild(arrow);
        this.windIndicator.appendChild(speed);
        this.windIndicator.appendChild(direction);
        this.windIndicator.appendChild(fromText);

        // Append to map container
        this.container.style.position = 'relative';
        this.container.appendChild(this.windIndicator);

        console.log('Wind indicator shown:', { windSpeed, windDirection, cardinal });
    }

    public hideWindIndicator(): void {
        if (this.windIndicator) {
            this.windIndicator.remove();
            this.windIndicator = null;
        }
    }

    public destroy(): void {
        if (this.map) {
            this.map.remove();
            this.map = null;
        }
        this.routeLayer = null;
        this.hideWindIndicator();
    }
}