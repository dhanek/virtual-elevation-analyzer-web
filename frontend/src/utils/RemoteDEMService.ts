/**
 * Remote DEM fetching service — OpenTopography + AWS Terrain Tiles
 */

import { DEMSourceType } from './RemoteDEMConfig';

export interface RouteBbox {
    south: number;
    north: number;
    west: number;
    east: number;
}

export interface RemoteDEMResult {
    source: DEMSourceType;
    tiles: { data: Uint8Array; name: string }[];
    metadata: {
        dataset: string;
        resolution: string;
        tileCount: number;
        bbox: RouteBbox;
    };
}

type ProgressCallback = (source: DEMSourceType, stage: string, percent: number) => void;

// --- Bounding box helpers (ported from aerobench) ---

const MIN_SPAN_DEG = 0.01;
const MIN_AREA_KM2 = 0.09;
const KM_PER_DEG_LAT = 111.32;

function clamp(v: number, lo: number, hi: number): number {
    return Math.max(lo, Math.min(hi, v));
}

function estimateBboxAreaKm2(bbox: RouteBbox): number {
    const latSpan = Math.max(0, bbox.north - bbox.south);
    const lonSpan = Math.max(0, bbox.east - bbox.west);
    const centerLat = (bbox.north + bbox.south) * 0.5;
    const cosLat = Math.max(0.01, Math.abs(Math.cos(centerLat * Math.PI / 180)));
    return latSpan * KM_PER_DEG_LAT * lonSpan * KM_PER_DEG_LAT * cosLat;
}

function enforceMinimumBbox(bbox: RouteBbox): RouteBbox {
    let out = { ...bbox };

    // Enforce minimum span
    if (out.north - out.south < MIN_SPAN_DEG) {
        const center = (out.north + out.south) * 0.5;
        out.south = clamp(center - MIN_SPAN_DEG / 2, -90, 90);
        out.north = clamp(center + MIN_SPAN_DEG / 2, -90, 90);
    }
    if (out.east - out.west < MIN_SPAN_DEG) {
        const center = (out.east + out.west) * 0.5;
        out.west = clamp(center - MIN_SPAN_DEG / 2, -180, 180);
        out.east = clamp(center + MIN_SPAN_DEG / 2, -180, 180);
    }

    // Enforce minimum area
    let area = estimateBboxAreaKm2(out);
    for (let i = 0; i < 5 && area < MIN_AREA_KM2; i++) {
        const scale = Math.sqrt(MIN_AREA_KM2 / Math.max(area, 1e-6)) * 1.05;
        const factor = Math.max(1.1, Math.min(scale, 10));
        const latHalf = (out.north - out.south) * 0.5 * factor;
        const lonHalf = (out.east - out.west) * 0.5 * factor;
        const latCenter = (out.north + out.south) * 0.5;
        const lonCenter = (out.east + out.west) * 0.5;
        out.south = clamp(latCenter - latHalf, -90, 90);
        out.north = clamp(latCenter + latHalf, -90, 90);
        out.west = clamp(lonCenter - lonHalf, -180, 180);
        out.east = clamp(lonCenter + lonHalf, -180, 180);
        area = estimateBboxAreaKm2(out);
    }

    return out;
}

export function computeBboxFromRoute(lats: number[], lons: number[], paddingDeg: number = 0.005): RouteBbox {
    let minLat = Infinity, maxLat = -Infinity;
    let minLon = Infinity, maxLon = -Infinity;

    for (let i = 0; i < lats.length; i++) {
        const la = lats[i], lo = lons[i];
        if (!Number.isFinite(la) || !Number.isFinite(lo)) continue;
        // Skip (0,0) — common GPS initialization artifact
        if (la === 0 && lo === 0) continue;
        // Skip clearly invalid coordinates
        if (Math.abs(la) > 90 || Math.abs(lo) > 180) continue;
        minLat = Math.min(minLat, la);
        maxLat = Math.max(maxLat, la);
        minLon = Math.min(minLon, lo);
        maxLon = Math.max(maxLon, lo);
    }

    if (!Number.isFinite(minLat) || !Number.isFinite(minLon)) {
        throw new Error('No valid GPS coordinates found in route data');
    }

    return {
        south: clamp(minLat - paddingDeg, -90, 90),
        north: clamp(maxLat + paddingDeg, -90, 90),
        west: clamp(minLon - paddingDeg, -180, 180),
        east: clamp(maxLon + paddingDeg, -180, 180),
    };
}

// --- OpenTopography client ---

const OPENTOPO_BASE_URL = 'https://portal.opentopography.org/API/globaldem';
const DEFAULT_DATASET_ORDER = ['COP30', 'NASADEM', 'SRTMGL1'];

export class OpenTopographyClient {
    async fetchDEM(
        bbox: RouteBbox,
        apiKey: string,
        dataset?: string,
        onProgress?: ProgressCallback,
    ): Promise<RemoteDEMResult> {
        const clampedBbox = enforceMinimumBbox(bbox);
        const datasetsToTry = dataset ? [dataset] : DEFAULT_DATASET_ORDER;

        let lastError: Error | null = null;
        for (const demtype of datasetsToTry) {
            onProgress?.('opentopography', `Fetching ${demtype}...`, 30);

            const params = new URLSearchParams({
                demtype,
                south: String(clampedBbox.south),
                north: String(clampedBbox.north),
                west: String(clampedBbox.west),
                east: String(clampedBbox.east),
                outputFormat: 'GTiff',
                API_Key: apiKey,
            });

            try {
                const response = await fetch(`${OPENTOPO_BASE_URL}?${params.toString()}`);

                if (!response.ok) {
                    const body = await response.text().catch(() => '');
                    lastError = new Error(`OpenTopography ${demtype} failed (${response.status}): ${body || response.statusText}`);
                    if (response.status === 401 || response.status === 403) throw lastError;
                    continue;
                }

                onProgress?.('opentopography', `Processing ${demtype}...`, 80);

                const arrayBuffer = await response.arrayBuffer();
                const data = new Uint8Array(arrayBuffer);

                console.log(`OpenTopography ${demtype}: received ${(data.length / 1024).toFixed(0)} KB`);

                return {
                    source: 'opentopography',
                    tiles: [{ data, name: `opentopo-${demtype}.tif` }],
                    metadata: {
                        dataset: demtype,
                        resolution: demtype.includes('90') || demtype === 'SRTMGL3' ? '90m' : '30m',
                        tileCount: 1,
                        bbox: clampedBbox,
                    },
                };
            } catch (err) {
                if (lastError && (lastError.message.includes('401') || lastError.message.includes('403'))) {
                    throw lastError;
                }
                lastError = err instanceof Error ? err : new Error(String(err));
            }
        }

        throw lastError || new Error('OpenTopography DEM request failed');
    }
}

// --- AWS Terrain Tiles client ---

const AWS_TERRAIN_BASE_URL = 'https://s3.amazonaws.com/elevation-tiles-prod/geotiff';

export function latLonToTileXY(lat: number, lon: number, zoom: number): { x: number; y: number } {
    const n = Math.pow(2, zoom);
    const x = Math.floor((lon + 180) / 360 * n);
    const latRad = lat * Math.PI / 180;
    const y = Math.floor((1 - Math.log(Math.tan(latRad) + 1 / Math.cos(latRad)) / Math.PI) / 2 * n);
    return { x: clamp(x, 0, n - 1), y: clamp(y, 0, n - 1) };
}

/**
 * Pick a zoom level that keeps the tile count under maxTiles.
 * Starts at preferredZoom and decreases until the count fits.
 */
function selectZoomForBbox(bbox: RouteBbox, preferredZoom: number = 12, maxTiles: number = 36): number {
    for (let z = preferredZoom; z >= 6; z--) {
        const tl = latLonToTileXY(bbox.north, bbox.west, z);
        const br = latLonToTileXY(bbox.south, bbox.east, z);
        const cols = Math.abs(br.x - tl.x) + 1;
        const rows = Math.abs(br.y - tl.y) + 1;
        if (cols * rows <= maxTiles) return z;
    }
    return 6;
}

export class AWSTerrainTilesClient {
    async fetchDEM(
        bbox: RouteBbox,
        requestedZoom?: number,
        onProgress?: ProgressCallback,
    ): Promise<RemoteDEMResult> {
        // Auto-select zoom to keep tile count reasonable
        const zoom = requestedZoom ?? selectZoomForBbox(bbox);

        // Compute tile range
        const topLeft = latLonToTileXY(bbox.north, bbox.west, zoom);
        const bottomRight = latLonToTileXY(bbox.south, bbox.east, zoom);

        const minX = Math.min(topLeft.x, bottomRight.x);
        const maxX = Math.max(topLeft.x, bottomRight.x);
        const minY = Math.min(topLeft.y, bottomRight.y);
        const maxY = Math.max(topLeft.y, bottomRight.y);

        const totalTiles = (maxX - minX + 1) * (maxY - minY + 1);
        console.log(`AWS Terrain Tiles: zoom=${zoom}, tiles=${totalTiles} (${minX}-${maxX} x ${minY}-${maxY})`);

        if (totalTiles > 50) {
            throw new Error(`Too many AWS tiles needed (${totalTiles}). Try a shorter route or lower zoom.`);
        }

        const tileRequests: { x: number; y: number; url: string }[] = [];
        for (let y = minY; y <= maxY; y++) {
            for (let x = minX; x <= maxX; x++) {
                tileRequests.push({
                    x, y,
                    url: `${AWS_TERRAIN_BASE_URL}/${zoom}/${x}/${y}.tif`,
                });
            }
        }

        onProgress?.('aws-terrain', `Fetching ${totalTiles} tiles...`, 10);

        // Fetch all tiles in parallel
        let completed = 0;
        const results = await Promise.allSettled(
            tileRequests.map(async (tile) => {
                const response = await fetch(tile.url);
                if (!response.ok) {
                    throw new Error(`AWS tile ${tile.x}/${tile.y} failed: ${response.status}`);
                }
                const arrayBuffer = await response.arrayBuffer();
                completed++;
                onProgress?.('aws-terrain', `Fetched ${completed}/${totalTiles} tiles`, 10 + (completed / totalTiles) * 80);
                return {
                    data: new Uint8Array(arrayBuffer),
                    name: `aws-terrain-${zoom}-${tile.x}-${tile.y}.tif`,
                    x: tile.x,
                    y: tile.y,
                };
            })
        );

        const tiles: { data: Uint8Array; name: string }[] = [];
        let failedCount = 0;
        for (const result of results) {
            if (result.status === 'fulfilled') {
                tiles.push({ data: result.value.data, name: result.value.name });
            } else {
                failedCount++;
                console.warn('AWS tile fetch failed:', result.reason);
            }
        }

        if (tiles.length === 0) {
            throw new Error('All AWS Terrain Tile fetches failed');
        }

        if (failedCount > 0) {
            console.warn(`${failedCount}/${totalTiles} AWS tiles failed to load`);
        }

        onProgress?.('aws-terrain', 'Done', 100);

        return {
            source: 'aws-terrain',
            tiles,
            metadata: {
                dataset: `SRTM/3DEP (zoom ${zoom})`,
                resolution: zoom >= 12 ? '~38m' : zoom >= 10 ? '~150m' : `zoom ${zoom}`,
                tileCount: tiles.length,
                bbox,
            },
        };
    }
}

// --- Orchestrator ---

export class RemoteDEMService {
    private openTopoClient = new OpenTopographyClient();
    private awsClient = new AWSTerrainTilesClient();

    async fetchForRoute(
        lats: number[],
        lons: number[],
        sources: DEMSourceType[],
        config: { apiKey?: string; dataset?: string } = {},
        onProgress?: ProgressCallback,
    ): Promise<Map<DEMSourceType, RemoteDEMResult>> {
        const bbox = computeBboxFromRoute(lats, lons);
        const results = new Map<DEMSourceType, RemoteDEMResult>();

        const promises: Promise<void>[] = [];

        if (sources.includes('opentopography')) {
            if (!config.apiKey) {
                console.warn('OpenTopography skipped: no API key');
            } else {
                promises.push(
                    this.openTopoClient.fetchDEM(bbox, config.apiKey, config.dataset, onProgress)
                        .then(result => { results.set('opentopography', result); })
                        .catch(err => { console.error('OpenTopography fetch failed:', err); })
                );
            }
        }

        if (sources.includes('aws-terrain')) {
            promises.push(
                this.awsClient.fetchDEM(bbox, undefined, onProgress)
                    .then(result => { results.set('aws-terrain', result); })
                    .catch(err => { console.error('AWS Terrain Tiles fetch failed:', err); })
            );
        }

        await Promise.allSettled(promises);

        return results;
    }
}
