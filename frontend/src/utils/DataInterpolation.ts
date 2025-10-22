/**
 * Data Interpolation Utilities
 * Converts non-uniform time series data to uniform 1Hz sampling
 */

/**
 * Linear interpolation between two points
 */
function linearInterpolate(x: number, x0: number, x1: number, y0: number, y1: number): number {
    if (x1 === x0) return y0;
    return y0 + (x - x0) * (y1 - y0) / (x1 - x0);
}

/**
 * Interpolate a single array of values to uniform 1Hz timestamps
 *
 * @param sourceTimestamps - Original non-uniform timestamps (seconds)
 * @param sourceValues - Original values corresponding to timestamps
 * @param targetTimestamps - Target uniform 1Hz timestamps (seconds)
 * @returns Interpolated values at target timestamps
 */
export function interpolateToUniform(
    sourceTimestamps: number[],
    sourceValues: number[],
    targetTimestamps: number[]
): number[] {
    if (sourceTimestamps.length !== sourceValues.length) {
        throw new Error('Source timestamps and values must have same length');
    }

    if (sourceTimestamps.length === 0) {
        return [];
    }

    const result: number[] = new Array(targetTimestamps.length);

    // Track current search position to avoid re-scanning
    let sourceIndex = 0;

    for (let i = 0; i < targetTimestamps.length; i++) {
        const targetTime = targetTimestamps[i];

        // Find the two source points that bracket the target time
        // Move sourceIndex forward until we find the right bracket
        while (sourceIndex < sourceTimestamps.length - 1 && sourceTimestamps[sourceIndex + 1] < targetTime) {
            sourceIndex++;
        }

        // Handle edge cases
        if (targetTime <= sourceTimestamps[0]) {
            // Before first point - use first value
            result[i] = sourceValues[0];
        } else if (targetTime >= sourceTimestamps[sourceTimestamps.length - 1]) {
            // After last point - use last value
            result[i] = sourceValues[sourceValues.length - 1];
        } else {
            // Interpolate between sourceIndex and sourceIndex + 1
            const t0 = sourceTimestamps[sourceIndex];
            const t1 = sourceTimestamps[sourceIndex + 1];
            const v0 = sourceValues[sourceIndex];
            const v1 = sourceValues[sourceIndex + 1];

            // Handle NaN values - use nearest non-NaN value
            if (isNaN(v0) && isNaN(v1)) {
                result[i] = NaN;
            } else if (isNaN(v0)) {
                result[i] = v1;
            } else if (isNaN(v1)) {
                result[i] = v0;
            } else {
                result[i] = linearInterpolate(targetTime, t0, t1, v0, v1);
            }
        }
    }

    return result;
}

/**
 * Generate uniform 1Hz timestamp array from start to end
 *
 * @param startTime - Start time in seconds
 * @param endTime - End time in seconds
 * @returns Array of timestamps at 1-second intervals
 */
export function generateUniformTimestamps(startTime: number, endTime: number): number[] {
    const timestamps: number[] = [];

    // Round start time down to nearest second
    const start = Math.floor(startTime);
    // Round end time up to nearest second
    const end = Math.ceil(endTime);

    for (let t = start; t <= end; t++) {
        timestamps.push(t);
    }

    return timestamps;
}

/**
 * Interpolate all data arrays to uniform 1Hz sampling
 *
 * @param sourceTimestamps - Original non-uniform timestamps
 * @param dataArrays - Object containing arrays to interpolate
 * @returns Object with interpolated arrays and uniform timestamps
 */
export function interpolateAllData<T extends Record<string, number[]>>(
    sourceTimestamps: number[],
    dataArrays: T
): T & { timestamps: number[] } {
    if (sourceTimestamps.length === 0) {
        throw new Error('Source timestamps cannot be empty');
    }

    // Generate uniform timestamps
    const uniformTimestamps = generateUniformTimestamps(
        sourceTimestamps[0],
        sourceTimestamps[sourceTimestamps.length - 1]
    );

    // Interpolate all arrays
    const result: any = {
        timestamps: uniformTimestamps
    };

    for (const [key, values] of Object.entries(dataArrays)) {
        if (Array.isArray(values) && values.length === sourceTimestamps.length) {
            result[key] = interpolateToUniform(sourceTimestamps, values, uniformTimestamps);
        } else if (Array.isArray(values)) {
            // If array doesn't match timestamp length, keep it as-is (metadata array)
            result[key] = values;
        } else {
            // Non-array values, keep as-is
            result[key] = values;
        }
    }

    return result;
}

/**
 * Calculate statistics about time intervals in a non-uniform time series
 * Useful for debugging and understanding data quality
 */
export function analyzeTimeIntervals(timestamps: number[]): {
    min: number;
    max: number;
    mean: number;
    median: number;
    std: number;
} {
    if (timestamps.length < 2) {
        return { min: 0, max: 0, mean: 0, median: 0, std: 0 };
    }

    const intervals: number[] = [];
    for (let i = 1; i < timestamps.length; i++) {
        intervals.push(timestamps[i] - timestamps[i - 1]);
    }

    intervals.sort((a, b) => a - b);

    const min = intervals[0];
    const max = intervals[intervals.length - 1];
    const mean = intervals.reduce((sum, v) => sum + v, 0) / intervals.length;
    const median = intervals[Math.floor(intervals.length / 2)];

    const variance = intervals.reduce((sum, v) => sum + Math.pow(v - mean, 2), 0) / intervals.length;
    const std = Math.sqrt(variance);

    return { min, max, mean, median, std };
}
