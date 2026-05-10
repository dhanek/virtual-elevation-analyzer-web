/**
 * Multi-source DEM coordinator — manages multiple DEMManager instances
 * for comparing elevation data from different sources.
 */

import { DEMManager } from "./DEMManager";
import { DEMSourceType } from "./RemoteDEMConfig";
import { RemoteDEMResult, latLonToTileXY } from "./RemoteDEMService";
import { log } from "./log";

export interface DEMSourceResult {
	source: DEMSourceType;
	elevations: number[];
	interpolatedElevations: number[];
	errorRate: number;
	metadata: string | null;
	// Matches DEMManager.getDEMBounds(): a zero-copy view of the WASM array.
	bounds: Float64Array | null;
}

/**
 * Compute a .tfw world file and .prj projection string for an AWS Terrain Tile.
 * Tiles are 512x512 pixels in Web Mercator (EPSG:3857).
 */
function computeAwsTileGeoref(
	z: number,
	x: number,
	y: number,
	tileSize: number = 512,
): { worldFile: string; prjFile: string } {
	const WORLD_EXTENT = 20037508.342789244; // half-circumference in meters
	const fullSpan = WORLD_EXTENT * 2; // 40075016.685578488
	const tileSpan = fullSpan / Math.pow(2, z);
	const pixelSize = tileSpan / tileSize;

	// Upper-left corner of the tile in Web Mercator meters
	const originX = -WORLD_EXTENT + x * tileSpan;
	const originY = WORLD_EXTENT - y * tileSpan;

	// World file uses center of upper-left pixel
	const centerX = originX + pixelSize / 2;
	const centerY = originY - pixelSize / 2;

	// TFW format: pixelWidth, rotY, rotX, pixelHeight(neg), centerX, centerY
	const worldFile = [
		pixelSize.toFixed(10),
		"0.0000000000",
		"0.0000000000",
		(-pixelSize).toFixed(10),
		centerX.toFixed(10),
		centerY.toFixed(10),
	].join("\n");

	const prjFile =
		'PROJCS["WGS 84 / Pseudo-Mercator",GEOGCS["WGS 84",DATUM["WGS_1984",SPHEROID["WGS 84",6378137,298.257223563]],PRIMEM["Greenwich",0],UNIT["degree",0.0174532925199433]],PROJECTION["Mercator_1SP"],PARAMETER["central_meridian",0],PARAMETER["scale_factor",1],PARAMETER["false_easting",0],PARAMETER["false_northing",0],UNIT["metre",1]]';

	return { worldFile, prjFile };
}

export class MultiDEMManager {
	/** One DEMManager per source (for OpenTopography which returns a single GeoTIFF) */
	private managers = new Map<DEMSourceType, DEMManager>();

	/** For AWS: one DEMManager per tile, keyed by "z/x/y" */
	private awsTileManagers: {
		manager: DEMManager;
		z: number;
		x: number;
		y: number;
	}[] = [];
	private awsZoom: number = 12;

	/**
	 * Load a remote DEM result into the coordinator
	 */
	async loadSource(
		source: DEMSourceType,
		result: RemoteDEMResult,
	): Promise<void> {
		if (source === "opentopography") {
			// Single GeoTIFF — one DEMManager
			const mgr = new DEMManager();
			await mgr.loadFromArrayBuffer(result.tiles[0].data, result.tiles[0].name);
			this.managers.set("opentopography", mgr);
		} else if (source === "aws-terrain") {
			// Multiple tiles — one DEMManager per tile
			this.clearSource("aws-terrain");
			// Extract zoom from tile name pattern: aws-terrain-{z}-{x}-{y}.tif
			for (const tile of result.tiles) {
				const match = tile.name.match(/aws-terrain-(\d+)-(\d+)-(\d+)\.tif/);
				if (!match) continue;
				const z = parseInt(match[1]);
				const x = parseInt(match[2]);
				const y = parseInt(match[3]);
				this.awsZoom = z;

				// Pass world file as fallback — the Rust DEMProcessor will prefer
				// embedded GeoTIFF tags (ModelPixelScaleTag, ModelTiepointTag,
				// GeoKeyDirectoryTag with EPSG:3857) when available, and only
				// use the computed world file if tags are missing or invalid.
				const { worldFile, prjFile } = computeAwsTileGeoref(z, x, y);

				try {
					const mgr = new DEMManager();
					await mgr.loadFromArrayBuffer(
						tile.data,
						tile.name,
						worldFile,
						prjFile,
					);
					this.awsTileManagers.push({ manager: mgr, z, x, y });
				} catch (err) {
					log.warn(`Failed to load AWS tile ${tile.name}:`, err);
				}
			}
			log.debug(
				`AWS Terrain: loaded ${this.awsTileManagers.length}/${result.tiles.length} tiles`,
			);
		}
	}

	/**
	 * Correct elevations using all loaded sources
	 */
	async correctAllSources(
		lats: number[],
		lons: number[],
		fallbackAltitudes: number[],
	): Promise<Map<DEMSourceType, DEMSourceResult>> {
		const results = new Map<DEMSourceType, DEMSourceResult>();

		// OpenTopography — single DEM, use directly
		const otoMgr = this.managers.get("opentopography");
		if (otoMgr?.isDEMLoaded()) {
			try {
				const correction = await otoMgr.computeDemProfiles(
					lats,
					lons,
					fallbackAltitudes,
				);
				results.set("opentopography", {
					source: "opentopography",
					elevations: correction.demRawNearestElevation,
					interpolatedElevations: correction.demInterpolatedElevation,
					errorRate: correction.errorRate,
					metadata: otoMgr.getDEMMetadata(),
					bounds: otoMgr.getDEMBounds(),
				});
			} catch (err) {
				log.error("OpenTopography elevation correction failed:", err);
			}
		}

		// AWS Terrain Tiles — route each point to the correct tile
		if (this.awsTileManagers.length > 0) {
			try {
				const result = this.correctWithAWSTiles(lats, lons, fallbackAltitudes);
				results.set("aws-terrain", result);
			} catch (err) {
				log.error("AWS Terrain elevation correction failed:", err);
			}
		}

		return results;
	}

	private correctWithAWSTiles(
		lats: number[],
		lons: number[],
		fallbackAltitudes: number[],
	): DEMSourceResult {
		const n = lats.length;
		const elevations = new Array<number>(n);
		const interpolatedElevations = new Array<number>(n);
		let errorCount = 0;

		// Build a lookup map for tiles by "x,y"
		const tileMap = new Map<string, DEMManager>();
		for (const entry of this.awsTileManagers) {
			tileMap.set(`${entry.x},${entry.y}`, entry.manager);
		}

		for (let i = 0; i < n; i++) {
			const lat = lats[i];
			const lon = lons[i];

			if (!Number.isFinite(lat) || !Number.isFinite(lon)) {
				const fallback = fallbackAltitudes[i];
				elevations[i] = fallback;
				interpolatedElevations[i] = fallback;
				errorCount++;
				continue;
			}

			// Determine which tile this point falls in
			const { x, y } = latLonToTileXY(lat, lon, this.awsZoom);
			const key = `${x},${y}`;
			const mgr = tileMap.get(key);

			if (mgr?.isDEMLoaded()) {
				try {
					const nearest = mgr.singleLookup(lat, lon);
					const interpolated = mgr.singleLookupInterpolated(lat, lon);

					const nearestValid = Number.isFinite(nearest) && !isNaN(nearest);
					const interpolatedValid =
						Number.isFinite(interpolated) && !isNaN(interpolated);

					elevations[i] = nearestValid ? nearest : fallbackAltitudes[i];
					interpolatedElevations[i] = interpolatedValid
						? interpolated
						: nearestValid
							? nearest
							: fallbackAltitudes[i];

					if (!nearestValid) {
						errorCount++;
					}
				} catch {
					const fallback = fallbackAltitudes[i];
					elevations[i] = fallback;
					interpolatedElevations[i] = fallback;
					errorCount++;
				}
			} else {
				const fallback = fallbackAltitudes[i];
				elevations[i] = fallback;
				interpolatedElevations[i] = fallback;
				errorCount++;
			}
		}

		this.backfillLeadingMissing(elevations);
		this.backfillLeadingMissing(interpolatedElevations);

		return {
			source: "aws-terrain",
			elevations,
			interpolatedElevations,
			errorRate: n > 0 ? errorCount / n : 0,
			metadata: `${this.awsTileManagers.length} tiles at zoom ${this.awsZoom}`,
			bounds: null,
		};
	}

	private backfillLeadingMissing(values: number[]): void {
		let firstValidIdx = -1;
		let firstValidValue = 0;
		for (let i = 0; i < values.length; i++) {
			if (!isNaN(values[i]) && values[i] !== 0) {
				firstValidIdx = i;
				firstValidValue = values[i];
				break;
			}
		}

		if (firstValidIdx <= 0) return;

		for (let i = 0; i < firstValidIdx; i++) {
			if (values[i] === 0 || isNaN(values[i])) {
				values[i] = firstValidValue;
			}
		}
	}

	getLoadedSources(): DEMSourceType[] {
		const sources: DEMSourceType[] = [];
		if (this.managers.has("opentopography")) sources.push("opentopography");
		if (this.awsTileManagers.length > 0) sources.push("aws-terrain");
		return sources;
	}

	clearSource(source: DEMSourceType): void {
		if (source === "opentopography") {
			const mgr = this.managers.get("opentopography");
			mgr?.clearDEM();
			this.managers.delete("opentopography");
		} else if (source === "aws-terrain") {
			for (const entry of this.awsTileManagers) {
				entry.manager.clearDEM();
			}
			this.awsTileManagers = [];
		}
	}

	clearAll(): void {
		for (const mgr of this.managers.values()) {
			mgr.clearDEM();
		}
		this.managers.clear();
		for (const entry of this.awsTileManagers) {
			entry.manager.clearDEM();
		}
		this.awsTileManagers = [];
	}
}
