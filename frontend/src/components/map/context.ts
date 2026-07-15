/**
 * MapContext — the boundary interface between the `MapVisualization` facade
 * and the internal `components/map/` feature modules (D-08/D-09/D-10).
 *
 * The facade stays the only export visible to `shell/` and owns all shared
 * Leaflet state and lifecycle. Feature modules (route rendering, trim markers,
 * wind indicator, gate markers, detected routes — extracted in plan 05-10)
 * receive this context instead of reaching into facade internals. Live state
 * is exposed through getters (read at call time, never captured as snapshots),
 * mirroring the repo's injected-dependencies pattern
 * (`CrrTempControlsBinding` in crrTempControls.ts).
 */
import type * as L from "leaflet";

/** Numeric column as delivered by the FIT/CSV data source (array or typed array). */
export type NumericSeries = ArrayLike<number>;

/** Per-record activity data columns consumed by map rendering. */
export interface FitData {
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

/** Shared map state owned by the `MapVisualization` facade. */
export interface MapContext {
	/** The Leaflet map instance. Lifecycle (create/remove) belongs to the facade. */
	map: L.Map;

	/** Layer holding the route polylines, lap-segment overlays and trim markers. */
	routeLayer: L.LayerGroup;

	/**
	 * Layer SHARED by both gate-marker families: the single GPS gate marker
	 * (`setGpsMarker`) and the out-and-back A/B markers (`setGpsMarkerA`/`B`).
	 *
	 * INVARIANT (Pitfall 7): `setGpsMarker` calls `clearLayers()` on this layer,
	 * which wipes markers A and B too, while `setGpsMarkerA`/`B` surgically
	 * remove only their own marker. This is safe ONLY because GPS-gate mode and
	 * out-and-back mode are mutually exclusive in the UI. Preserve the
	 * `clearLayers()` semantics exactly, and keep both marker families in one
	 * module so the invariant never crosses a module boundary.
	 */
	gpsMarkerLayer: L.LayerGroup;

	/**
	 * Layer for detected-lap polylines and out-and-back section polylines —
	 * shared by `showDetectedLaps` and `showOutAndBackSections`, each of which
	 * clears it entirely before drawing.
	 */
	detectedLapsLayer: L.LayerGroup;

	/** The map container element (`#mapView`); DOM overlays (wind indicator) attach here. */
	container: HTMLElement;

	/** Current activity data, read live (null before `setData` is called). */
	getFitData(): FitData | null;

	/** Valid-GPS route points as `[lat, lng]` pairs, read live. */
	getRoutePoints(): readonly [number, number][];

	/** For each route point, its source index into the FitData columns, read live. */
	getRoutePointIndices(): readonly number[];
}
