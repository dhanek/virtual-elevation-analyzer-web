import { DEMProcessor } from "../../pkg/virtual_elevation_analyzer";
import { log } from "./log";

/**
 * Manages DEM (Digital Elevation Model) files for elevation correction
 * Uses streaming approach - DEM files are processed on-the-fly and not stored in IndexedDB
 */
export class DEMManager {
	private demProcessor: DEMProcessor | null = null;
	private demFile: File | null = null;
	private demName: string | null = null;
	private demFileLoaded: boolean = false;

	private mergeWithFallback(
		demElevations: ArrayLike<number>,
		fallbackAltitudes: number[],
	): { elevations: number[]; errorCount: number } {
		const correctedElevations: number[] = [];
		let errorCount = 0;

		for (let i = 0; i < demElevations.length; i++) {
			if (isNaN(demElevations[i]) || demElevations[i] === null) {
				correctedElevations.push(fallbackAltitudes[i]);
				errorCount++;
			} else {
				correctedElevations.push(demElevations[i]);
			}
		}

		// Fix leading invalid values with first valid sample.
		let firstValidIdx = -1;
		let firstValidValue = 0;
		for (let i = 0; i < correctedElevations.length; i++) {
			const val = correctedElevations[i];
			if (!isNaN(val) && val !== 0 && val !== null) {
				firstValidIdx = i;
				firstValidValue = val;
				break;
			}
		}

		if (firstValidIdx > 0) {
			for (let i = 0; i < firstValidIdx; i++) {
				if (correctedElevations[i] === 0 || isNaN(correctedElevations[i])) {
					correctedElevations[i] = firstValidValue;
				}
			}
		}

		return { elevations: correctedElevations, errorCount };
	}

	/**
	 * Load a DEM file into memory for processing
	 * @param file The DEM file (GeoTIFF, TIF, etc.)
	 * @param worldFile Optional world file (.tfw, .tifw) for geospatial coordinates
	 * @param projFile Optional projection file (.prj) for coordinate system definition
	 */
	async loadDEMFile(
		file: File,
		worldFile?: File,
		projFile?: File,
	): Promise<void> {
		if (!this.isValidDEMFile(file)) {
			throw new Error(
				"Invalid DEM file format. Supported formats: .tif, .tiff, .vrt",
			);
		}

		try {
			// Read file as ArrayBuffer
			const arrayBuffer = await file.arrayBuffer();
			const uint8Array = new Uint8Array(arrayBuffer);

			// Read world file if provided
			let worldFileContent: string | undefined = undefined;
			if (worldFile) {
				worldFileContent = await worldFile.text();
				log.debug("World file loaded:", worldFile.name);
			}

			// Read projection file if provided
			let projFileContent: string | undefined = undefined;
			if (projFile) {
				projFileContent = await projFile.text();
				log.debug("Projection file loaded:", projFile.name);
			}

			// Create DEM processor from file data
			// If world file or proj file is provided, use new_with_world_file method
			this.demProcessor =
				worldFileContent || projFileContent
					? DEMProcessor.new_with_world_file(
							uint8Array,
							file.name,
							worldFileContent,
							projFileContent,
						)
					: new DEMProcessor(uint8Array, file.name);

			this.demFile = file;
			this.demFileLoaded = true;

			log.debug("DEM file loaded successfully:", file.name);
			log.debug("DEM metadata:", this.demProcessor.get_metadata());
			log.debug("DEM bounds:", this.demProcessor.get_bounds());
		} catch (error) {
			this.demProcessor = null;
			this.demFile = null;
			this.demFileLoaded = false;
			throw new Error(`Failed to load DEM file: ${error}`);
		}
	}

	/**
	 * Load DEM data from a raw ArrayBuffer (e.g., fetched from a remote API)
	 * @param data The DEM data as Uint8Array (GeoTIFF bytes)
	 * @param name A display name for this DEM source
	 * @param worldFileContent Optional world file (.tfw) content for georeferencing
	 * @param projFileContent Optional projection file (.prj) content for CRS
	 */
	async loadFromArrayBuffer(
		data: Uint8Array,
		name: string,
		worldFileContent?: string,
		projFileContent?: string,
	): Promise<void> {
		try {
			this.demProcessor =
				worldFileContent || projFileContent
					? DEMProcessor.new_with_world_file(
							data,
							name,
							worldFileContent,
							projFileContent,
						)
					: new DEMProcessor(data, name);
			this.demFile = null;
			this.demName = name;
			this.demFileLoaded = true;

			log.debug("DEM loaded from ArrayBuffer:", name);
			log.debug("DEM metadata:", this.demProcessor.get_metadata());
			log.debug("DEM bounds:", this.demProcessor.get_bounds());
		} catch (error) {
			this.demProcessor = null;
			this.demFile = null;
			this.demName = null;
			this.demFileLoaded = false;
			throw new Error(`Failed to load DEM from buffer: ${error}`);
		}
	}

	/**
	 * Correct elevation for a set of GPS coordinates
	 * @param lats Array of latitudes (WGS84)
	 * @param lons Array of longitudes (WGS84)
	 * @param fallbackAltitudes Original GPS altitudes to use if DEM lookup fails
	 * @returns Corrected elevations and error rate
	 */
	lookupNearestElevations(lats: number[], lons: number[]): number[] {
		if (!this.demProcessor || !this.demFileLoaded) {
			throw new Error("DEM file not loaded. Please load a DEM file first.");
		}

		return Array.from(
			this.demProcessor.batch_lookup(
				new Float64Array(lats),
				new Float64Array(lons),
			),
		);
	}

	lookupInterpolatedElevations(lats: number[], lons: number[]): number[] {
		if (!this.demProcessor || !this.demFileLoaded) {
			throw new Error("DEM file not loaded. Please load a DEM file first.");
		}

		const processor = this.demProcessor as unknown as {
			batch_lookup_interpolated?: (
				lats: Float64Array,
				lons: Float64Array,
			) => Float64Array;
			batch_lookup: (lats: Float64Array, lons: Float64Array) => Float64Array;
		};

		if (processor.batch_lookup_interpolated) {
			return Array.from(
				processor.batch_lookup_interpolated(
					new Float64Array(lats),
					new Float64Array(lons),
				),
			);
		}

		// Fallback until WASM bundle is regenerated.
		return Array.from(
			processor.batch_lookup(new Float64Array(lats), new Float64Array(lons)),
		);
	}

	async computeDemProfiles(
		lats: number[],
		lons: number[],
		fallbackAltitudes: number[],
	): Promise<{
		demRawNearestElevation: number[];
		demInterpolatedElevation: number[];
		errorRate: number;
	}> {
		if (
			lats.length !== lons.length ||
			lats.length !== fallbackAltitudes.length
		) {
			throw new Error(
				"lats, lons, and fallbackAltitudes must have the same length",
			);
		}

		const nearestRaw = this.lookupNearestElevations(lats, lons);
		const interpolatedRaw = this.lookupInterpolatedElevations(lats, lons);
		const nearestMerged = this.mergeWithFallback(nearestRaw, fallbackAltitudes);
		const interpolatedMerged = this.mergeWithFallback(
			interpolatedRaw,
			fallbackAltitudes,
		);

		return {
			demRawNearestElevation: nearestMerged.elevations,
			demInterpolatedElevation: interpolatedMerged.elevations,
			errorRate:
				nearestRaw.length > 0
					? nearestMerged.errorCount / nearestRaw.length
					: 0,
		};
	}

	async correctElevation(
		lats: number[],
		lons: number[],
		fallbackAltitudes: number[],
	): Promise<{ elevations: number[]; errorRate: number }> {
		try {
			const profiles = await this.computeDemProfiles(
				lats,
				lons,
				fallbackAltitudes,
			);
			return {
				elevations: profiles.demRawNearestElevation,
				errorRate: profiles.errorRate,
			};
		} catch (error) {
			throw new Error(`Failed to correct elevation: ${error}`);
		}
	}

	/**
	 * Look up nearest-neighbor elevation for a single point (used by MultiDEMManager for tile routing)
	 */
	singleLookup(lat: number, lon: number): number {
		if (!this.demProcessor || !this.demFileLoaded) return NaN;
		return this.lookupNearestElevations([lat], [lon])[0];
	}

	/**
	 * Look up interpolated elevation for a single point.
	 */
	singleLookupInterpolated(lat: number, lon: number): number {
		if (!this.demProcessor || !this.demFileLoaded) return NaN;
		return this.lookupInterpolatedElevations([lat], [lon])[0];
	}

	/**
	 * Check if a DEM file is currently loaded
	 */
	isDEMLoaded(): boolean {
		return this.demFileLoaded;
	}

	/**
	 * Get the currently loaded DEM file name
	 */
	getDEMFileName(): string | null {
		return this.demFile ? this.demFile.name : this.demName;
	}

	/**
	 * Get DEM metadata
	 */
	getDEMMetadata(): string | null {
		return this.demProcessor ? this.demProcessor.get_metadata() : null;
	}

	/**
	 * Get DEM bounds [min_lon, min_lat, max_lon, max_lat].
	 *
	 * Returns a Float64Array rather than number[] because `get_bounds()`
	 * comes straight from wasm-bindgen and copying to a plain array would
	 * be a needless allocation. Callers can index it like a normal array.
	 */
	getDEMBounds(): Float64Array | null {
		return this.demProcessor ? this.demProcessor.get_bounds() : null;
	}

	/**
	 * Clear the loaded DEM file from memory
	 */
	clearDEM(): void {
		if (this.demProcessor) {
			this.demProcessor.free();
			this.demProcessor = null;
		}
		this.demFile = null;
		this.demName = null;
		this.demFileLoaded = false;
	}

	/**
	 * Validate DEM file format
	 */
	private isValidDEMFile(file: File): boolean {
		const validExtensions = [".tif", ".tiff", ".vrt"];
		const fileName = file.name.toLowerCase();
		return validExtensions.some((ext) => fileName.endsWith(ext));
	}
}

/**
 * Elevation profile cache for storing corrected elevations per FIT file
 */
export class ElevationProfileCache {
	private dbName = "ve-elevation-profiles";
	private storeName = "profiles";
	private db: IDBDatabase | null = null;

	async initialize(): Promise<void> {
		return new Promise((resolve, reject) => {
			const request = indexedDB.open(this.dbName, 1);

			request.onerror = () => reject(request.error);
			request.onsuccess = () => {
				this.db = request.result;
				resolve();
			};

			request.onupgradeneeded = (event) => {
				const db = (event.target as IDBOpenDBRequest).result;
				if (!db.objectStoreNames.contains(this.storeName)) {
					db.createObjectStore(this.storeName, { keyPath: "fileHash" });
				}
			};
		});
	}

	/**
	 * Cache elevation profile for a FIT file
	 */
	async cacheProfile(
		fileHash: string,
		fileName: string,
		elevations: number[],
		bounds: { minLat: number; maxLat: number; minLon: number; maxLon: number },
	): Promise<void> {
		if (!this.db) await this.initialize();

		return new Promise((resolve, reject) => {
			const transaction = this.db!.transaction([this.storeName], "readwrite");
			const store = transaction.objectStore(this.storeName);

			const profile = {
				fileHash,
				fileName,
				elevations,
				bounds,
				timestamp: Date.now(),
				size: elevations.length * 8, // Approximate size in bytes
			};

			const request = store.put(profile);
			request.onsuccess = () => resolve();
			request.onerror = () => reject(request.error);
		});
	}

	/**
	 * Get cached elevation profile for a FIT file
	 */
	async getProfile(fileHash: string): Promise<number[] | null> {
		if (!this.db) await this.initialize();

		return new Promise((resolve, reject) => {
			const transaction = this.db!.transaction([this.storeName], "readonly");
			const store = transaction.objectStore(this.storeName);
			const request = store.get(fileHash);

			request.onsuccess = () => {
				const result = request.result;
				resolve(result ? result.elevations : null);
			};
			request.onerror = () => reject(request.error);
		});
	}

	/**
	 * Clear all cached elevation profiles
	 */
	async clearAll(): Promise<void> {
		if (!this.db) await this.initialize();

		return new Promise((resolve, reject) => {
			const transaction = this.db!.transaction([this.storeName], "readwrite");
			const store = transaction.objectStore(this.storeName);
			const request = store.clear();

			request.onsuccess = () => resolve();
			request.onerror = () => reject(request.error);
		});
	}

	/**
	 * Get total storage size of cached profiles
	 */
	async getStorageSize(): Promise<number> {
		if (!this.db) await this.initialize();

		return new Promise((resolve, reject) => {
			const transaction = this.db!.transaction([this.storeName], "readonly");
			const store = transaction.objectStore(this.storeName);
			const request = store.getAll();

			request.onsuccess = () => {
				const profiles = request.result;
				const totalSize = profiles.reduce(
					(sum, profile) => sum + (profile.size || 0),
					0,
				);
				resolve(totalSize);
			};
			request.onerror = () => reject(request.error);
		});
	}
}
