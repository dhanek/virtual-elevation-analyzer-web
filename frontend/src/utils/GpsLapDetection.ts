/**
 * GPS Lap Detection Module
 *
 * Detects virtual laps based on GPS marker crossings in the same direction.
 * Ported from the Python implementation in escape-flavoured-virtual-elevation-recipe.
 */

import {
	bearingToCompassDirection,
	calculateSmoothedBearings,
	circularAngleDifference,
	findGatePassings,
	type IndexWindow,
	type PassingPoint,
	type TrackArrays,
} from "./gatePassings";

export type { IndexWindow, PassingPoint } from "./gatePassings";

const DEFAULT_PROXIMITY_THRESHOLD_METERS = 20;
const DEFAULT_BEARING_WINDOW_POINTS = 5;
const DEFAULT_SAME_DIRECTION_ANGLE_THRESHOLD_DEGREES = 30;
const DEFAULT_OPPOSITE_DIRECTION_ANGLE_THRESHOLD_DEGREES = 90;
const METERS_PER_KILOMETER = 1000;

// Detection mode types - extensible for future modes
type LapDetectionMode =
	| "GPS based lap splitting" // Same direction crossings
	| "GPS gate one way" // Future: single direction gate
	| "GPS based out and back"; // Future: out and back detection

export interface GpsLapDetectionConfig {
	markerLat: number; // GPS marker latitude
	markerLon: number; // GPS marker longitude
	/** The selected FIT laps as contiguous index ranges; no lap spans two. */
	windows: IndexWindow[];
	proximityThreshold: number; // Distance threshold in meters (default: 20)
	bearingWindowSize: number; // Points for bearing smoothing (default: 5)
	angleThreshold: number; // Direction matching threshold in degrees (default: 30)
	mode: LapDetectionMode; // Detection mode
}

export interface DetectedLap {
	lapNumber: number; // 1-based lap number
	startIdx: number; // Start index in data array
	endIdx: number; // End index in data array
	startTime: number; // Start timestamp (Unix seconds)
	endTime: number; // End timestamp (Unix seconds)
	duration: number; // Duration in seconds
	distance: number; // Distance in kilometers
	startDirection: number; // Bearing at lap start (0-360)
	endDirection: number; // Bearing at lap end (0-360)
	directionName: string; // Compass direction name (N, NE, E, etc.)
	startLat: number; // Start position latitude
	startLon: number; // Start position longitude
}

export interface GpsLapDetectionResult {
	detectedLaps: DetectedLap[];
	passings: PassingPoint[]; // All detected passings for visualization
	markerLat: number;
	markerLon: number;
}

// ==================== Out and Back Detection Types ====================

export interface OutAndBackConfig {
	markerALat: number; // GPS marker A latitude (start/end)
	markerALon: number; // GPS marker A longitude
	markerBLat: number; // GPS marker B latitude (turnaround)
	markerBLon: number; // GPS marker B longitude
	/** The selected FIT laps as contiguous index ranges; no section spans two. */
	windows: IndexWindow[];
	proximityThreshold: number; // Distance threshold in meters (default: 20)
	bearingWindowSize: number; // Points for bearing smoothing (default: 5)
	angleThreshold: number; // Direction matching threshold for opposite (default: 90)
}

export interface OutAndBackSection {
	sectionNumber: number; // 1-based section number
	// Outbound segment (A → B)
	outboundStartIdx: number;
	outboundEndIdx: number;
	outboundStartDirection: number;
	outboundEndDirection: number;
	outboundDuration: number; // seconds
	outboundDistance: number; // km
	// Inbound segment (B → A)
	inboundStartIdx: number;
	inboundEndIdx: number;
	inboundStartDirection: number;
	inboundEndDirection: number;
	inboundDuration: number; // seconds
	inboundDistance: number; // km
	// Combined
	totalDuration: number; // seconds
	totalDistance: number; // km
}

export interface OutAndBackResult {
	detectedSections: OutAndBackSection[];
	passingsA: PassingPoint[]; // All passings near marker A
	passingsB: PassingPoint[]; // All passings near marker B
	markerALat: number;
	markerALon: number;
	markerBLat: number;
	markerBLon: number;
}

/**
 * GPS Lap Detector class
 * Detects lap splits based on GPS marker crossings in the same direction
 */
export class GpsLapDetector {
	private track: TrackArrays;
	private distance: number[];
	private config: GpsLapDetectionConfig;

	constructor(
		positionLat: number[],
		positionLon: number[],
		timestamps: number[],
		distance: number[],
		config: GpsLapDetectionConfig,
	) {
		this.track = { positionLat, positionLon, timestamps };
		this.distance = distance;
		this.config = config;
	}

	/**
	 * Main detection method - detects laps based on configured mode
	 */
	public detectLaps(): GpsLapDetectionResult {
		switch (this.config.mode) {
			case "GPS based lap splitting":
				return this.detectLapsSameDirection();
			case "GPS gate one way":
				// Future: implement one-way gate detection
				return this.detectLapsSameDirection(); // Fallback for now
			case "GPS based out and back":
				// Future: implement out-and-back detection
				return this.detectLapsSameDirection(); // Fallback for now
			default:
				return this.detectLapsSameDirection();
		}
	}

	/**
	 * Detect laps where crossings are in the same direction, window by window.
	 */
	private detectLapsSameDirection(): GpsLapDetectionResult {
		const detectedLaps: DetectedLap[] = [];
		const allPassings: PassingPoint[] = [];
		const bearings = calculateSmoothedBearings(
			this.track,
			this.config.bearingWindowSize,
		);

		for (const window of this.config.windows) {
			const passings = findGatePassings(
				this.track,
				bearings,
				this.config.markerLat,
				this.config.markerLon,
				window,
				this.config.proximityThreshold,
			);
			allPassings.push(...passings);

			// Each lap runs to the next passing in the same direction. A passing
			// with no such partner is skipped, not the end of detection: a window
			// that opens on a one-off pass the other way still holds every lap
			// after it.
			let lapStart = 0;
			while (lapStart < passings.length - 1) {
				const start = passings[lapStart];
				let lapEnd: number | null = null;
				for (let j = lapStart + 1; j < passings.length; j++) {
					if (
						circularAngleDifference(start.direction, passings[j].direction) <
						this.config.angleThreshold
					) {
						lapEnd = j;
						break;
					}
				}

				if (lapEnd === null) {
					lapStart++;
					continue;
				}

				const end = passings[lapEnd];
				detectedLaps.push({
					lapNumber: detectedLaps.length + 1,
					startIdx: start.index,
					endIdx: end.index,
					startTime: start.timestamp,
					endTime: end.timestamp,
					duration: end.timestamp - start.timestamp,
					distance:
						(this.distance[end.index] - this.distance[start.index]) /
						METERS_PER_KILOMETER,
					startDirection: start.direction,
					endDirection: end.direction,
					directionName: bearingToCompassDirection(start.direction),
					startLat: start.lat,
					startLon: start.lon,
				});
				lapStart = lapEnd;
			}
		}

		return {
			detectedLaps,
			passings: allPassings,
			markerLat: this.config.markerLat,
			markerLon: this.config.markerLon,
		};
	}
}

// ==================== Out and Back Detector ====================

type MarkedPassing = PassingPoint & { marker: "A" | "B" };

/**
 * Out and Back Detector class
 * Detects out-and-back sections based on two GPS markers (A and B)
 *
 * A complete section consists of:
 * 1. Pass marker A (outbound start) — the LAST pass of A before step 2
 * 2. Pass marker B (outbound end)
 * 3. Pass marker B again in opposite direction (inbound start)
 * 4. Pass marker A again in opposite direction (inbound end)
 */
export class OutAndBackDetector {
	private track: TrackArrays;
	private distance: number[];
	private config: OutAndBackConfig;

	constructor(
		positionLat: number[],
		positionLon: number[],
		timestamps: number[],
		distance: number[],
		config: OutAndBackConfig,
	) {
		this.track = { positionLat, positionLon, timestamps };
		this.distance = distance;
		this.config = config;
	}

	/**
	 * Main detection method - detects out-and-back sections, window by window
	 */
	public detectSections(): OutAndBackResult {
		const detectedSections: OutAndBackSection[] = [];
		const passingsA: PassingPoint[] = [];
		const passingsB: PassingPoint[] = [];
		const bearings = calculateSmoothedBearings(
			this.track,
			this.config.bearingWindowSize,
		);
		const { proximityThreshold } = this.config;

		for (const window of this.config.windows) {
			const windowA = findGatePassings(
				this.track,
				bearings,
				this.config.markerALat,
				this.config.markerALon,
				window,
				proximityThreshold,
			);
			const windowB = findGatePassings(
				this.track,
				bearings,
				this.config.markerBLat,
				this.config.markerBLon,
				window,
				proximityThreshold,
			);
			passingsA.push(...windowA);
			passingsB.push(...windowB);

			// Stable sort: two passings of one U-turn share an index and must keep
			// their arriving-then-leaving order.
			const merged: MarkedPassing[] = [
				...windowA.map((p): MarkedPassing => ({ ...p, marker: "A" })),
				...windowB.map((p): MarkedPassing => ({ ...p, marker: "B" })),
			].sort((a, b) => a.index - b.index);

			for (const section of this.pairSections(merged)) {
				detectedSections.push({
					...section,
					sectionNumber: detectedSections.length + 1,
				});
			}
		}

		return {
			detectedSections,
			passingsA,
			passingsB,
			markerALat: this.config.markerALat,
			markerALon: this.config.markerALon,
			markerBLat: this.config.markerBLat,
			markerBLon: this.config.markerBLon,
		};
	}

	/** The state machine over one window's passings, in track order. */
	private pairSections(
		passings: MarkedPassing[],
	): Array<Omit<OutAndBackSection, "sectionNumber">> {
		const sections: Array<Omit<OutAndBackSection, "sectionNumber">> = [];
		const { angleThreshold } = this.config;
		let outStart: PassingPoint | null = null;
		let outEnd: PassingPoint | null = null;
		let inStart: PassingPoint | null = null;
		let inStartProvisional = false;

		for (const passing of passings) {
			if (!outEnd) {
				// Waiting for B. Every A restarts the leg, so a rider who comes
				// back through A before heading out starts from the pass that
				// actually leads to B.
				if (passing.marker === "A") outStart = passing;
				else if (outStart) outEnd = passing;
			} else if (!inStart) {
				if (
					passing.marker === "B" &&
					circularAngleDifference(passing.direction, outEnd.direction) >
						angleThreshold
				) {
					inStart = passing;
					inStartProvisional = passing.index === outEnd.index;
				}
			} else if (passing.marker === "B") {
				// A bend sharper than TURNAROUND_ANGLE_DEGREES doubles its passing
				// just as a U-turn does, so an inStart at outEnd's own index is only
				// provisional: a later reversed pass through B tells the two apart.
				if (
					inStartProvisional &&
					circularAngleDifference(passing.direction, outEnd.direction) >
						angleThreshold
				) {
					inStart = passing;
					inStartProvisional = passing.index === outEnd.index;
				}
			} else if (
				passing.marker === "A" &&
				circularAngleDifference(passing.direction, outStart!.direction) >
					angleThreshold
			) {
				sections.push(this.buildSection(outStart!, outEnd, inStart, passing));
				outStart = null;
				outEnd = null;
				inStart = null;
				inStartProvisional = false;
			}
		}

		return sections;
	}

	private buildSection(
		outStart: PassingPoint,
		outEnd: PassingPoint,
		inStart: PassingPoint,
		inEnd: PassingPoint,
	): Omit<OutAndBackSection, "sectionNumber"> {
		const outboundDuration = outEnd.timestamp - outStart.timestamp;
		const inboundDuration = inEnd.timestamp - inStart.timestamp;
		const outboundDistance =
			(this.distance[outEnd.index] - this.distance[outStart.index]) /
			METERS_PER_KILOMETER;
		const inboundDistance =
			(this.distance[inEnd.index] - this.distance[inStart.index]) /
			METERS_PER_KILOMETER;

		return {
			outboundStartIdx: outStart.index,
			outboundEndIdx: outEnd.index,
			outboundStartDirection: outStart.direction,
			outboundEndDirection: outEnd.direction,
			outboundDuration,
			outboundDistance,
			inboundStartIdx: inStart.index,
			inboundEndIdx: inEnd.index,
			inboundStartDirection: inStart.direction,
			inboundEndDirection: inEnd.direction,
			inboundDuration,
			inboundDistance,
			totalDuration: outboundDuration + inboundDuration,
			totalDistance: outboundDistance + inboundDistance,
		};
	}
}

/**
 * Default values for GPS lap detection configuration
 */
const DEFAULT_LAP_DETECTION_CONFIG = {
	proximityThreshold: DEFAULT_PROXIMITY_THRESHOLD_METERS,
	bearingWindowSize: DEFAULT_BEARING_WINDOW_POINTS,
	angleThreshold: DEFAULT_SAME_DIRECTION_ANGLE_THRESHOLD_DEGREES,
	mode: "GPS based lap splitting" as LapDetectionMode,
};

/**
 * Default values for Out and Back detection configuration
 */
export const DEFAULT_OUT_AND_BACK_CONFIG = {
	proximityThreshold: DEFAULT_PROXIMITY_THRESHOLD_METERS,
	bearingWindowSize: DEFAULT_BEARING_WINDOW_POINTS,
	angleThreshold: DEFAULT_OPPOSITE_DIRECTION_ANGLE_THRESHOLD_DEGREES,
};

/**
 * Get default configuration for GPS lap detection
 */
export function getDefaultLapDetectionConfig(): Pick<
	GpsLapDetectionConfig,
	"proximityThreshold" | "bearingWindowSize" | "angleThreshold" | "mode"
> {
	return { ...DEFAULT_LAP_DETECTION_CONFIG };
}

/**
 * Format lap duration as MM:SS
 */
export function formatLapDuration(durationSeconds: number): string {
	const mins = Math.floor(durationSeconds / 60);
	const secs = Math.floor(durationSeconds % 60);
	return `${mins.toString().padStart(2, "0")}:${secs.toString().padStart(2, "0")}`;
}

/**
 * Format lap distance
 */
export function formatLapDistance(distanceKm: number): string {
	return `${distanceKm.toFixed(2)} km`;
}
