/**
 * Geospatial calculations for weather data retrieval
 */

export interface TrimRegionMetadata {
    avgLat: number;           // Average latitude (6 decimal precision)
    avgLon: number;           // Average longitude (6 decimal precision)
    middleTimestamp: number;  // Unix timestamp (seconds) at middle of trim region
    middleDate: Date;         // JavaScript Date object
    dataPointCount: number;   // Number of valid GPS points used
    trimStart: number;        // Original trim start index
    trimEnd: number;          // Original trim end index
}

export interface FitDataForGeo {
    position_lat: number[];
    position_long: number[];
    timestamps: number[];
}

/**
 * Calculate average GPS position and middle timestamp from trim region
 *
 * This function:
 * 1. Extracts all GPS coordinates between trimStart and trimEnd (inclusive)
 * 2. Filters out invalid coordinates (0.0, NaN, or undefined)
 * 3. Calculates arithmetic mean of valid coordinates
 * 4. Calculates middle timestamp as average of first and last timestamp
 *
 * @param fitData - FIT file data containing GPS and timestamp arrays
 * @param trimStart - Start index of trim region (inclusive)
 * @param trimEnd - End index of trim region (inclusive)
 * @returns Metadata about the trim region for weather API queries
 * @throws Error if no valid GPS data is found in trim region
 */
export function calculateTrimRegionMetadata(
    fitData: FitDataForGeo,
    trimStart: number,
    trimEnd: number
): TrimRegionMetadata {
    // Validate inputs
    if (trimStart < 0 || trimEnd >= fitData.timestamps.length) {
        throw new Error(
            `Invalid trim region: start=${trimStart}, end=${trimEnd}, length=${fitData.timestamps.length}`
        );
    }

    if (trimStart >= trimEnd) {
        throw new Error(
            `Invalid trim region: start (${trimStart}) must be less than end (${trimEnd})`
        );
    }

    // Extract data from trim region (inclusive range)
    const latSlice = fitData.position_lat.slice(trimStart, trimEnd + 1);
    const lonSlice = fitData.position_long.slice(trimStart, trimEnd + 1);
    const timestampSlice = fitData.timestamps.slice(trimStart, trimEnd + 1);

    // Filter out invalid GPS coordinates
    // Valid coordinates must:
    // - Not be 0.0 (common default/missing value)
    // - Not be NaN
    // - Be within valid lat/lon ranges
    const validPoints: Array<{ lat: number; lon: number; ts: number }> = [];

    for (let i = 0; i < latSlice.length; i++) {
        const lat = latSlice[i];
        const lon = lonSlice[i];
        const ts = timestampSlice[i];

        if (
            isValidCoordinate(lat, lon) &&
            !isNaN(ts) &&
            ts > 0
        ) {
            validPoints.push({ lat, lon, ts });
        }
    }

    if (validPoints.length === 0) {
        throw new Error(
            'No valid GPS data found in trim region. Please ensure your FIT file contains GPS coordinates.'
        );
    }

    // Calculate average latitude and longitude
    // Using arithmetic mean (suitable for small areas)
    let sumLat = 0;
    let sumLon = 0;

    for (const point of validPoints) {
        sumLat += point.lat;
        sumLon += point.lon;
    }

    const avgLat = sumLat / validPoints.length;
    const avgLon = sumLon / validPoints.length;

    // Calculate middle timestamp
    // Using average of first and last timestamp in slice
    const middleTimestamp = (timestampSlice[0] + timestampSlice[timestampSlice.length - 1]) / 2;

    // Round coordinates to 6 decimal places
    // 6 decimals = ~0.1 meter precision, sufficient for weather data
    const roundedLat = Number(avgLat.toFixed(6));
    const roundedLon = Number(avgLon.toFixed(6));

    // Convert timestamp to Date object
    const middleDate = new Date(middleTimestamp * 1000);

    console.log('📊 GPS Calculation Summary:');
    console.log('  - Total points in slice:', latSlice.length);
    console.log('  - Valid GPS points:', validPoints.length);
    console.log('  - Invalid/filtered points:', latSlice.length - validPoints.length);
    console.log('  - Average latitude:', roundedLat);
    console.log('  - Average longitude:', roundedLon);
    console.log('  - First timestamp:', new Date(timestampSlice[0] * 1000).toISOString());
    console.log('  - Last timestamp:', new Date(timestampSlice[timestampSlice.length - 1] * 1000).toISOString());
    console.log('  - Middle timestamp:', middleDate.toISOString());

    return {
        avgLat: roundedLat,
        avgLon: roundedLon,
        middleTimestamp,
        middleDate,
        dataPointCount: validPoints.length,
        trimStart,
        trimEnd
    };
}

/**
 * Validate GPS coordinates
 *
 * @param lat - Latitude
 * @param lon - Longitude
 * @returns true if coordinates are valid
 */
function isValidCoordinate(lat: number, lon: number): boolean {
    // Check for NaN or undefined
    if (isNaN(lat) || isNaN(lon)) {
        return false;
    }

    // Check for zero (common missing value indicator)
    if (lat === 0.0 && lon === 0.0) {
        return false;
    }

    // Check for valid latitude range (-90 to 90)
    if (lat < -90 || lat > 90) {
        return false;
    }

    // Check for valid longitude range (-180 to 180)
    if (lon < -180 || lon > 180) {
        return false;
    }

    return true;
}

/**
 * Calculate distance between two GPS points using Haversine formula
 * Useful for validation and debugging
 *
 * @param lat1 - Latitude of point 1
 * @param lon1 - Longitude of point 1
 * @param lat2 - Latitude of point 2
 * @param lon2 - Longitude of point 2
 * @returns Distance in meters
 */
export function calculateDistance(
    lat1: number,
    lon1: number,
    lat2: number,
    lon2: number
): number {
    const R = 6371000; // Earth's radius in meters
    const φ1 = (lat1 * Math.PI) / 180;
    const φ2 = (lat2 * Math.PI) / 180;
    const Δφ = ((lat2 - lat1) * Math.PI) / 180;
    const Δλ = ((lon2 - lon1) * Math.PI) / 180;

    const a =
        Math.sin(Δφ / 2) * Math.sin(Δφ / 2) +
        Math.cos(φ1) * Math.cos(φ2) * Math.sin(Δλ / 2) * Math.sin(Δλ / 2);

    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));

    return R * c;
}

/**
 * Format coordinates for display
 *
 * @param lat - Latitude
 * @param lon - Longitude
 * @returns Formatted string with hemisphere indicators
 */
export function formatCoordinates(lat: number, lon: number): string {
    const latDir = lat >= 0 ? 'N' : 'S';
    const lonDir = lon >= 0 ? 'E' : 'W';
    return `${Math.abs(lat).toFixed(6)}°${latDir}, ${Math.abs(lon).toFixed(6)}°${lonDir}`;
}
