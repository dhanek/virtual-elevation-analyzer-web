import type { ActivityDataLike } from '../state/AppState';

export interface NormalizedActivityArrays {
    timestamps: number[];
    power: number[];
    velocity: number[];
    positionLat: number[];
    positionLong: number[];
    altitude: number[];
    distance: number[];
    airSpeed: number[];
    windSpeed: number[];
    windYaw: number[];
    airDensity: number[];
    roadSpeed: number[];
    temperature: number[];
    cdaReference: number[] | null;
}

const activityArrayCache = new WeakMap<object, NormalizedActivityArrays>();

export function getNormalizedActivityArrays(fitData: ActivityDataLike): NormalizedActivityArrays {
    const cacheKey = fitData as object;
    const cached = activityArrayCache.get(cacheKey);
    if (cached) {
        return cached;
    }

    const normalized: NormalizedActivityArrays = {
        timestamps: toNumberArray(fitData.timestamps),
        power: toNumberArray(fitData.power),
        velocity: toNumberArray(fitData.velocity),
        positionLat: toNumberArray(fitData.position_lat),
        positionLong: toNumberArray(fitData.position_long),
        altitude: toNumberArray(fitData.altitude),
        distance: toNumberArray(fitData.distance),
        airSpeed: toNumberArray(fitData.air_speed),
        windSpeed: toNumberArray(fitData.wind_speed),
        windYaw: toNumberArray(fitData.wind_yaw),
        airDensity: toNumberArray(fitData.air_density_data),
        roadSpeed: toNumberArray(fitData.road_speed),
        temperature: toNumberArray(fitData.temperature),
        cdaReference: fitData.cda_reference ? [...fitData.cda_reference] : null,
    };

    activityArrayCache.set(cacheKey, normalized);
    return normalized;
}

function toNumberArray(values: ArrayLike<number> | undefined | null): number[] {
    if (!values) {
        return [];
    }

    return Array.isArray(values)
        ? values
        : Array.from(values) as number[];
}
