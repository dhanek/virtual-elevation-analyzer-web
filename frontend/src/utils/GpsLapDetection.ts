/**
 * GPS Lap Detection Module
 *
 * Detects virtual laps based on GPS marker crossings in the same direction.
 * Ported from the Python implementation in escape-flavoured-virtual-elevation-recipe.
 */

import { calculateDistance } from './GeoCalculations';

const DEFAULT_PROXIMITY_THRESHOLD_METERS = 20;
const DEFAULT_BEARING_WINDOW_POINTS = 5;
const DEFAULT_SAME_DIRECTION_ANGLE_THRESHOLD_DEGREES = 30;
const DEFAULT_OPPOSITE_DIRECTION_ANGLE_THRESHOLD_DEGREES = 90;
const PASSING_CLUSTER_GAP_POINTS = 5;
const METERS_PER_KILOMETER = 1000;
const FULL_CIRCLE_DEGREES = 360;
const HALF_CIRCLE_DEGREES = 180;
const MIN_VALID_LATITUDE = -90;
const MAX_VALID_LATITUDE = 90;
const MIN_VALID_LONGITUDE = -180;
const MAX_VALID_LONGITUDE = 180;

// Detection mode types - extensible for future modes
export type LapDetectionMode =
    | 'GPS based lap splitting'   // Same direction crossings
    | 'GPS gate one way'          // Future: single direction gate
    | 'GPS based out and back';   // Future: out and back detection

export interface GpsLapDetectionConfig {
    markerLat: number;            // GPS marker latitude
    markerLon: number;            // GPS marker longitude
    trimStart: number;            // Analysis window start index
    trimEnd: number;              // Analysis window end index
    proximityThreshold: number;   // Distance threshold in meters (default: 20)
    bearingWindowSize: number;    // Points for bearing smoothing (default: 5)
    angleThreshold: number;       // Direction matching threshold in degrees (default: 30)
    mode: LapDetectionMode;       // Detection mode
}

export interface PassingPoint {
    index: number;                // Index in the data array
    distance: number;             // Distance to marker in meters
    direction: number;            // Smoothed bearing at this point (0-360)
    timestamp: number;            // Unix timestamp
    lat: number;                  // GPS latitude
    lon: number;                  // GPS longitude
}

export interface DetectedLap {
    lapNumber: number;            // 1-based lap number
    startIdx: number;             // Start index in data array
    endIdx: number;               // End index in data array
    startTime: number;            // Start timestamp (Unix seconds)
    endTime: number;              // End timestamp (Unix seconds)
    duration: number;             // Duration in seconds
    distance: number;             // Distance in kilometers
    startDirection: number;       // Bearing at lap start (0-360)
    endDirection: number;         // Bearing at lap end (0-360)
    directionName: string;        // Compass direction name (N, NE, E, etc.)
    startLat: number;             // Start position latitude
    startLon: number;             // Start position longitude
}

export interface GpsLapDetectionResult {
    detectedLaps: DetectedLap[];
    passings: PassingPoint[];     // All detected passings for visualization
    markerLat: number;
    markerLon: number;
}

// ==================== Out and Back Detection Types ====================

export interface OutAndBackConfig {
    markerALat: number;           // GPS marker A latitude (start/end)
    markerALon: number;           // GPS marker A longitude
    markerBLat: number;           // GPS marker B latitude (turnaround)
    markerBLon: number;           // GPS marker B longitude
    trimStart: number;            // Analysis window start index
    trimEnd: number;              // Analysis window end index
    proximityThreshold: number;   // Distance threshold in meters (default: 20)
    bearingWindowSize: number;    // Points for bearing smoothing (default: 5)
    angleThreshold: number;       // Direction matching threshold for opposite (default: 90)
}

export interface OutAndBackSection {
    sectionNumber: number;        // 1-based section number
    // Outbound segment (A → B)
    outboundStartIdx: number;
    outboundEndIdx: number;
    outboundStartDirection: number;
    outboundEndDirection: number;
    outboundDuration: number;     // seconds
    outboundDistance: number;     // km
    // Inbound segment (B → A)
    inboundStartIdx: number;
    inboundEndIdx: number;
    inboundStartDirection: number;
    inboundEndDirection: number;
    inboundDuration: number;      // seconds
    inboundDistance: number;      // km
    // Combined
    totalDuration: number;        // seconds
    totalDistance: number;        // km
}

export interface OutAndBackResult {
    detectedSections: OutAndBackSection[];
    passingsA: PassingPoint[];    // All passings near marker A
    passingsB: PassingPoint[];    // All passings near marker B
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
    private positionLat: number[];
    private positionLon: number[];
    private timestamps: number[];
    private distance: number[];
    private config: GpsLapDetectionConfig;

    constructor(
        positionLat: number[],
        positionLon: number[],
        timestamps: number[],
        distance: number[],
        config: GpsLapDetectionConfig
    ) {
        this.positionLat = positionLat;
        this.positionLon = positionLon;
        this.timestamps = timestamps;
        this.distance = distance;
        this.config = config;
    }

    /**
     * Main detection method - detects laps based on configured mode
     */
    public detectLaps(): GpsLapDetectionResult {
        switch (this.config.mode) {
            case 'GPS based lap splitting':
                return this.detectLapsSameDirection();
            case 'GPS gate one way':
                // Future: implement one-way gate detection
                return this.detectLapsSameDirection(); // Fallback for now
            case 'GPS based out and back':
                // Future: implement out-and-back detection
                return this.detectLapsSameDirection(); // Fallback for now
            default:
                return this.detectLapsSameDirection();
        }
    }

    /**
     * Detect laps where crossings are in the same direction
     */
    private detectLapsSameDirection(): GpsLapDetectionResult {
        const detectedLaps: DetectedLap[] = [];

        // Calculate smoothed bearings for the entire track
        const bearings = this.calculateSmoothedBearings();

        // Find all passings near the marker within trim region
        const passings = this.findPassings(bearings);

        // Group nearby passings and keep closest
        const groupedPassings = this.groupAndClusterPassings(passings);

        // Match consecutive passings in the same direction to form laps
        if (groupedPassings.length >= 2) {
            let lapStart = 0;
            let lapNumber = 1;

            while (lapStart < groupedPassings.length - 1) {
                let lapEnd: number | null = null;

                // Find next passing in the same direction
                for (let j = lapStart + 1; j < groupedPassings.length; j++) {
                    const dirDiff = this.circularAngleDifference(
                        groupedPassings[lapStart].direction,
                        groupedPassings[j].direction
                    );

                    if (dirDiff < this.config.angleThreshold) {
                        lapEnd = j;
                        break;
                    }
                }

                if (lapEnd !== null) {
                    const startPassing = groupedPassings[lapStart];
                    const endPassing = groupedPassings[lapEnd];

                    // Calculate lap distance from distance array
                    const lapDistance = (this.distance[endPassing.index] - this.distance[startPassing.index]) / METERS_PER_KILOMETER;

                    const lap: DetectedLap = {
                        lapNumber: lapNumber,
                        startIdx: startPassing.index,
                        endIdx: endPassing.index,
                        startTime: startPassing.timestamp,
                        endTime: endPassing.timestamp,
                        duration: endPassing.timestamp - startPassing.timestamp,
                        distance: lapDistance,
                        startDirection: startPassing.direction,
                        endDirection: endPassing.direction,
                        directionName: this.bearingToCompassDirection(startPassing.direction),
                        startLat: startPassing.lat,
                        startLon: startPassing.lon
                    };

                    detectedLaps.push(lap);
                    lapNumber++;
                    lapStart = lapEnd;
                } else {
                    break;
                }
            }
        }

        return {
            detectedLaps,
            passings: groupedPassings,
            markerLat: this.config.markerLat,
            markerLon: this.config.markerLon
        };
    }

    /**
     * Calculate bearing between two GPS points
     * @returns Bearing in degrees (0-360, where 0 = North)
     */
    private calculateBearing(lat1: number, lon1: number, lat2: number, lon2: number): number {
        const lat1Rad = lat1 * Math.PI / HALF_CIRCLE_DEGREES;
        const lat2Rad = lat2 * Math.PI / HALF_CIRCLE_DEGREES;
        const lon1Rad = lon1 * Math.PI / HALF_CIRCLE_DEGREES;
        const lon2Rad = lon2 * Math.PI / HALF_CIRCLE_DEGREES;

        const y = Math.sin(lon2Rad - lon1Rad) * Math.cos(lat2Rad);
        const x = Math.cos(lat1Rad) * Math.sin(lat2Rad) -
                  Math.sin(lat1Rad) * Math.cos(lat2Rad) * Math.cos(lon2Rad - lon1Rad);

        let bearing = Math.atan2(y, x) * HALF_CIRCLE_DEGREES / Math.PI;
        return (bearing + FULL_CIRCLE_DEGREES) % FULL_CIRCLE_DEGREES;
    }

    /**
     * Calculate smoothed bearings for the entire track using a window
     * This reduces noise in GPS bearing data
     */
    private calculateSmoothedBearings(): number[] {
        const bearings: number[] = [];
        const windowSize = this.config.bearingWindowSize;
        const len = this.positionLat.length;

        for (let i = 0; i < len; i++) {
            let bearing: number;

            if (i < windowSize) {
                // First points: use forward-looking window
                if (i + windowSize < len) {
                    bearing = this.calculateBearing(
                        this.positionLat[i], this.positionLon[i],
                        this.positionLat[i + windowSize], this.positionLon[i + windowSize]
                    );
                } else if (i + 1 < len) {
                    bearing = this.calculateBearing(
                        this.positionLat[i], this.positionLon[i],
                        this.positionLat[i + 1], this.positionLon[i + 1]
                    );
                } else {
                    bearing = bearings.length > 0 ? bearings[bearings.length - 1] : 0;
                }
            } else if (i >= len - windowSize) {
                // Last points: use backward-looking window
                bearing = this.calculateBearing(
                    this.positionLat[i - windowSize], this.positionLon[i - windowSize],
                    this.positionLat[i], this.positionLon[i]
                );
            } else {
                // Middle points: use centered window
                const halfWindow = Math.floor(windowSize / 2);
                bearing = this.calculateBearing(
                    this.positionLat[i - halfWindow], this.positionLon[i - halfWindow],
                    this.positionLat[i + halfWindow], this.positionLon[i + halfWindow]
                );
            }

            bearings.push(bearing);
        }

        return bearings;
    }

    /**
     * Find all points where we pass near the GPS marker within trim region
     */
    private findPassings(bearings: number[]): PassingPoint[] {
        const passings: PassingPoint[] = [];
        const { markerLat, markerLon, trimStart, trimEnd, proximityThreshold } = this.config;

        for (let i = trimStart; i <= Math.min(trimEnd, this.positionLat.length - 1); i++) {
            const lat = this.positionLat[i];
            const lon = this.positionLon[i];

            // Skip invalid GPS coordinates
            if (!this.isValidCoordinate(lat, lon)) continue;

            const dist = calculateDistance(markerLat, markerLon, lat, lon);

            if (dist < proximityThreshold) {
                passings.push({
                    index: i,
                    distance: dist,
                    direction: bearings[i] || 0,
                    timestamp: this.timestamps[i],
                    lat: lat,
                    lon: lon
                });
            }
        }

        return passings;
    }

    /**
     * Group nearby passings and keep only the closest point in each group
     * This handles multiple data points within proximity threshold
     */
    private groupAndClusterPassings(passings: PassingPoint[]): PassingPoint[] {
        if (passings.length === 0) return [];

        const groupedPassings: PassingPoint[] = [];
        let currentGroup: PassingPoint[] = [];

        for (const passing of passings) {
            // Group passings within 5 data points of each other
            if (currentGroup.length === 0 ||
                passing.index - currentGroup[currentGroup.length - 1].index <= PASSING_CLUSTER_GAP_POINTS) {
                currentGroup.push(passing);
            } else {
                // Find closest point in the group
                if (currentGroup.length > 0) {
                    const closest = currentGroup.reduce((min, p) =>
                        p.distance < min.distance ? p : min, currentGroup[0]);
                    groupedPassings.push(closest);
                }
                currentGroup = [passing];
            }
        }

        // Add the last group
        if (currentGroup.length > 0) {
            const closest = currentGroup.reduce((min, p) =>
                p.distance < min.distance ? p : min, currentGroup[0]);
            groupedPassings.push(closest);
        }

        // Sort by index
        groupedPassings.sort((a, b) => a.index - b.index);

        return groupedPassings;
    }

    /**
     * Calculate circular angle difference (handles wrap-around at 360°)
     */
    private circularAngleDifference(angle1: number, angle2: number): number {
        const diff = Math.abs(angle1 - angle2);
        return Math.min(diff, FULL_CIRCLE_DEGREES - diff);
    }

    /**
     * Convert bearing to compass direction name
     */
    private bearingToCompassDirection(bearing: number): string {
        const directions = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];
        const index = Math.round(bearing / 45) % 8;
        return directions[index];
    }

    /**
     * Check if GPS coordinate is valid
     */
    private isValidCoordinate(lat: number, lon: number): boolean {
        if (isNaN(lat) || isNaN(lon)) return false;
        if (lat === 0 && lon === 0) return false;
        if (lat < MIN_VALID_LATITUDE || lat > MAX_VALID_LATITUDE) return false;
        if (lon < MIN_VALID_LONGITUDE || lon > MAX_VALID_LONGITUDE) return false;
        return true;
    }
}

// ==================== Out and Back Detector ====================

/**
 * Out and Back Detector class
 * Detects out-and-back sections based on two GPS markers (A and B)
 *
 * A complete section consists of:
 * 1. Pass marker A (outbound start)
 * 2. Pass marker B (outbound end)
 * 3. Pass marker B again in opposite direction (inbound start)
 * 4. Pass marker A again in opposite direction (inbound end)
 */
export class OutAndBackDetector {
    private positionLat: number[];
    private positionLon: number[];
    private timestamps: number[];
    private distance: number[];
    private config: OutAndBackConfig;

    constructor(
        positionLat: number[],
        positionLon: number[],
        timestamps: number[],
        distance: number[],
        config: OutAndBackConfig
    ) {
        this.positionLat = positionLat;
        this.positionLon = positionLon;
        this.timestamps = timestamps;
        this.distance = distance;
        this.config = config;
    }

    /**
     * Main detection method - detects out-and-back sections
     */
    public detectSections(): OutAndBackResult {
        const detectedSections: OutAndBackSection[] = [];

        // Calculate smoothed bearings for the entire track
        const bearings = this.calculateSmoothedBearings();

        // Find all passings near marker A and B within trim region
        const passingsA = this.findPassingsNearMarker(
            this.config.markerALat,
            this.config.markerALon,
            bearings
        );
        const passingsB = this.findPassingsNearMarker(
            this.config.markerBLat,
            this.config.markerBLon,
            bearings
        );

        // Group nearby passings
        const groupedPassingsA = this.groupAndClusterPassings(passingsA);
        const groupedPassingsB = this.groupAndClusterPassings(passingsB);

        // Merge and sort all passings by index
        const allPassings: Array<PassingPoint & { marker: 'A' | 'B' }> = [];
        for (const p of groupedPassingsA) {
            allPassings.push({ ...p, marker: 'A' });
        }
        for (const p of groupedPassingsB) {
            allPassings.push({ ...p, marker: 'B' });
        }
        allPassings.sort((a, b) => a.index - b.index);

        // State machine to find out-and-back sections
        let outboundStarted = false;
        let outboundEnded = false;
        let inboundStarted = false;

        let currentSection: Partial<{
            outboundStartIdx: number;
            outboundStartDirection: number;
            outboundEndIdx: number;
            outboundEndDirection: number;
            inboundStartIdx: number;
            inboundStartDirection: number;
            inboundEndIdx: number;
            inboundEndDirection: number;
        }> = {};

        let sectionNumber = 1;

        for (const passing of allPassings) {
            const marker = passing.marker;
            const idx = passing.index;
            const direction = passing.direction;

            if (!outboundStarted) {
                // Looking for first A
                if (marker === 'A') {
                    currentSection = {
                        outboundStartIdx: idx,
                        outboundStartDirection: direction
                    };
                    outboundStarted = true;
                }
            } else if (outboundStarted && !outboundEnded) {
                // Looking for first B after A
                if (marker === 'B') {
                    currentSection.outboundEndIdx = idx;
                    currentSection.outboundEndDirection = direction;
                    outboundEnded = true;
                }
            } else if (outboundEnded && !inboundStarted) {
                // Looking for second B in opposite direction
                if (marker === 'B') {
                    const dirDiff = this.circularAngleDifference(
                        direction,
                        currentSection.outboundEndDirection!
                    );

                    if (dirDiff > this.config.angleThreshold) {
                        // Found start of inbound journey
                        currentSection.inboundStartIdx = idx;
                        currentSection.inboundStartDirection = direction;
                        inboundStarted = true;
                    }
                }
            } else if (inboundStarted) {
                // Looking for second A in opposite direction to complete the section
                if (marker === 'A') {
                    const dirDiff = this.circularAngleDifference(
                        direction,
                        currentSection.outboundStartDirection!
                    );

                    if (dirDiff > this.config.angleThreshold) {
                        // Found end of inbound journey - complete section
                        currentSection.inboundEndIdx = idx;
                        currentSection.inboundEndDirection = direction;

                        // Calculate durations
                        const outboundDuration = this.timestamps[currentSection.outboundEndIdx!] -
                                                this.timestamps[currentSection.outboundStartIdx!];
                        const inboundDuration = this.timestamps[currentSection.inboundEndIdx!] -
                                               this.timestamps[currentSection.inboundStartIdx!];

                        // Calculate distances
                        const outboundDistance = (this.distance[currentSection.outboundEndIdx!] -
                                                 this.distance[currentSection.outboundStartIdx!]) / METERS_PER_KILOMETER;
                        const inboundDistance = (this.distance[currentSection.inboundEndIdx!] -
                                                this.distance[currentSection.inboundStartIdx!]) / METERS_PER_KILOMETER;

                        const section: OutAndBackSection = {
                            sectionNumber: sectionNumber,
                            outboundStartIdx: currentSection.outboundStartIdx!,
                            outboundEndIdx: currentSection.outboundEndIdx!,
                            outboundStartDirection: currentSection.outboundStartDirection!,
                            outboundEndDirection: currentSection.outboundEndDirection!,
                            outboundDuration: outboundDuration,
                            outboundDistance: outboundDistance,
                            inboundStartIdx: currentSection.inboundStartIdx!,
                            inboundEndIdx: currentSection.inboundEndIdx!,
                            inboundStartDirection: currentSection.inboundStartDirection!,
                            inboundEndDirection: currentSection.inboundEndDirection!,
                            inboundDuration: inboundDuration,
                            inboundDistance: inboundDistance,
                            totalDuration: outboundDuration + inboundDuration,
                            totalDistance: outboundDistance + inboundDistance
                        };

                        detectedSections.push(section);
                        sectionNumber++;

                        // Reset for next section
                        outboundStarted = false;
                        outboundEnded = false;
                        inboundStarted = false;
                        currentSection = {};
                    }
                }
            }
        }

        return {
            detectedSections,
            passingsA: groupedPassingsA,
            passingsB: groupedPassingsB,
            markerALat: this.config.markerALat,
            markerALon: this.config.markerALon,
            markerBLat: this.config.markerBLat,
            markerBLon: this.config.markerBLon
        };
    }

    /**
     * Calculate bearing between two GPS points
     */
    private calculateBearing(lat1: number, lon1: number, lat2: number, lon2: number): number {
        const lat1Rad = lat1 * Math.PI / HALF_CIRCLE_DEGREES;
        const lat2Rad = lat2 * Math.PI / HALF_CIRCLE_DEGREES;
        const lon1Rad = lon1 * Math.PI / HALF_CIRCLE_DEGREES;
        const lon2Rad = lon2 * Math.PI / HALF_CIRCLE_DEGREES;

        const y = Math.sin(lon2Rad - lon1Rad) * Math.cos(lat2Rad);
        const x = Math.cos(lat1Rad) * Math.sin(lat2Rad) -
                  Math.sin(lat1Rad) * Math.cos(lat2Rad) * Math.cos(lon2Rad - lon1Rad);

        let bearing = Math.atan2(y, x) * HALF_CIRCLE_DEGREES / Math.PI;
        return (bearing + FULL_CIRCLE_DEGREES) % FULL_CIRCLE_DEGREES;
    }

    /**
     * Calculate smoothed bearings for the entire track
     */
    private calculateSmoothedBearings(): number[] {
        const bearings: number[] = [];
        const windowSize = this.config.bearingWindowSize;
        const len = this.positionLat.length;

        for (let i = 0; i < len; i++) {
            let bearing: number;

            if (i < windowSize) {
                if (i + windowSize < len) {
                    bearing = this.calculateBearing(
                        this.positionLat[i], this.positionLon[i],
                        this.positionLat[i + windowSize], this.positionLon[i + windowSize]
                    );
                } else if (i + 1 < len) {
                    bearing = this.calculateBearing(
                        this.positionLat[i], this.positionLon[i],
                        this.positionLat[i + 1], this.positionLon[i + 1]
                    );
                } else {
                    bearing = bearings.length > 0 ? bearings[bearings.length - 1] : 0;
                }
            } else if (i >= len - windowSize) {
                bearing = this.calculateBearing(
                    this.positionLat[i - windowSize], this.positionLon[i - windowSize],
                    this.positionLat[i], this.positionLon[i]
                );
            } else {
                const halfWindow = Math.floor(windowSize / 2);
                bearing = this.calculateBearing(
                    this.positionLat[i - halfWindow], this.positionLon[i - halfWindow],
                    this.positionLat[i + halfWindow], this.positionLon[i + halfWindow]
                );
            }

            bearings.push(bearing);
        }

        return bearings;
    }

    /**
     * Find all points passing near a specific marker
     */
    private findPassingsNearMarker(markerLat: number, markerLon: number, bearings: number[]): PassingPoint[] {
        const passings: PassingPoint[] = [];
        const { trimStart, trimEnd, proximityThreshold } = this.config;

        for (let i = trimStart; i <= Math.min(trimEnd, this.positionLat.length - 1); i++) {
            const lat = this.positionLat[i];
            const lon = this.positionLon[i];

            if (!this.isValidCoordinate(lat, lon)) continue;

            const dist = calculateDistance(markerLat, markerLon, lat, lon);

            if (dist < proximityThreshold) {
                passings.push({
                    index: i,
                    distance: dist,
                    direction: bearings[i] || 0,
                    timestamp: this.timestamps[i],
                    lat: lat,
                    lon: lon
                });
            }
        }

        return passings;
    }

    /**
     * Group nearby passings and keep only the closest point in each group
     */
    private groupAndClusterPassings(passings: PassingPoint[]): PassingPoint[] {
        if (passings.length === 0) return [];

        const groupedPassings: PassingPoint[] = [];
        let currentGroup: PassingPoint[] = [];

        for (const passing of passings) {
            if (currentGroup.length === 0 ||
                passing.index - currentGroup[currentGroup.length - 1].index <= PASSING_CLUSTER_GAP_POINTS) {
                currentGroup.push(passing);
            } else {
                if (currentGroup.length > 0) {
                    const closest = currentGroup.reduce((min, p) =>
                        p.distance < min.distance ? p : min, currentGroup[0]);
                    groupedPassings.push(closest);
                }
                currentGroup = [passing];
            }
        }

        if (currentGroup.length > 0) {
            const closest = currentGroup.reduce((min, p) =>
                p.distance < min.distance ? p : min, currentGroup[0]);
            groupedPassings.push(closest);
        }

        groupedPassings.sort((a, b) => a.index - b.index);
        return groupedPassings;
    }

    /**
     * Calculate circular angle difference
     */
    private circularAngleDifference(angle1: number, angle2: number): number {
        const diff = Math.abs(angle1 - angle2);
        return Math.min(diff, FULL_CIRCLE_DEGREES - diff);
    }

    /**
     * Check if GPS coordinate is valid
     */
    private isValidCoordinate(lat: number, lon: number): boolean {
        if (isNaN(lat) || isNaN(lon)) return false;
        if (lat === 0 && lon === 0) return false;
        if (lat < MIN_VALID_LATITUDE || lat > MAX_VALID_LATITUDE) return false;
        if (lon < MIN_VALID_LONGITUDE || lon > MAX_VALID_LONGITUDE) return false;
        return true;
    }
}

/**
 * Default values for GPS lap detection configuration
 */
export const DEFAULT_LAP_DETECTION_CONFIG = {
    proximityThreshold: DEFAULT_PROXIMITY_THRESHOLD_METERS,
    bearingWindowSize: DEFAULT_BEARING_WINDOW_POINTS,
    angleThreshold: DEFAULT_SAME_DIRECTION_ANGLE_THRESHOLD_DEGREES,
    mode: 'GPS based lap splitting' as LapDetectionMode
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
export function getDefaultLapDetectionConfig(): Pick<GpsLapDetectionConfig, 'proximityThreshold' | 'bearingWindowSize' | 'angleThreshold' | 'mode'> {
    return { ...DEFAULT_LAP_DETECTION_CONFIG };
}

/**
 * Format lap duration as MM:SS
 */
export function formatLapDuration(durationSeconds: number): string {
    const mins = Math.floor(durationSeconds / 60);
    const secs = Math.floor(durationSeconds % 60);
    return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
}

/**
 * Format lap distance
 */
export function formatLapDistance(distanceKm: number): string {
    return `${distanceKm.toFixed(2)} km`;
}
