import type { AnalysisParameters } from '../components/AnalysisParameters';
import type { ActivityDataLike, WindSource } from '../state/AppState';

export type WindDataSource = 'air_speed' | 'wind_speed' | 'constant' | 'none';

export interface WindSeriesResolution {
    selectedWindSource: 'constant' | 'fit' | 'none';
    dataSource: WindDataSource;
    hasAirSpeed: boolean;
    hasWindSpeed: boolean;
    defaultAirSpeedOffset: number;
    windSpeed: number[];
}

export interface ResolveWindSeriesInput {
    fitData: Pick<ActivityDataLike, 'timestamps' | 'air_speed' | 'wind_speed' | 'wind_yaw'>;
    windSource?: WindSource | string | null;
    params?: AnalysisParameters | null;
    airSpeedCalibrationPercent?: number;
    applyOffset?: boolean;
}

export function getDefaultWindSource(fitData: Pick<ActivityDataLike, 'air_speed' | 'wind_speed'>): WindSource {
    const airSpeed = toNumberArray(fitData.air_speed);
    const windSpeed = toNumberArray(fitData.wind_speed);
    return hasUsableValues(airSpeed) || hasUsableValues(windSpeed) ? 'fit' : 'constant';
}

export function resolveWindSeries(input: ResolveWindSeriesInput): WindSeriesResolution {
    const timestamps = toNumberArray(input.fitData.timestamps);
    const airSpeed = toNumberArray(input.fitData.air_speed);
    const windSpeed = toNumberArray(input.fitData.wind_speed);
    const hasAirSpeed = hasUsableValues(airSpeed);
    const hasWindSpeed = hasUsableValues(windSpeed);
    const defaultAirSpeedOffset = hasAirSpeed ? 2 : 0;
    const requestedWindSource = normalizeWindSource(input.windSource) ?? getDefaultWindSource(input.fitData);
    const selectedWindSource = requestedWindSource === 'compare' ? 'fit' : requestedWindSource;

    if (selectedWindSource === 'constant') {
        return {
            selectedWindSource: 'constant',
            dataSource: 'constant',
            hasAirSpeed,
            hasWindSpeed,
            defaultAirSpeedOffset,
            windSpeed: new Array(timestamps.length).fill(NaN),
        };
    }

    const dataSource = hasAirSpeed ? 'air_speed' : hasWindSpeed ? 'wind_speed' : 'none';
    if (dataSource === 'none') {
        return {
            selectedWindSource: 'none',
            dataSource: 'none',
            hasAirSpeed,
            hasWindSpeed,
            defaultAirSpeedOffset: 0,
            windSpeed: new Array(timestamps.length).fill(0),
        };
    }

    const sourceMagnitudes = dataSource === 'air_speed' ? airSpeed : windSpeed;
    const yaw = resolveYawArray(input.fitData.wind_yaw, sourceMagnitudes.length);
    const offsetSeconds = input.params?.air_speed_offset ?? (dataSource === 'air_speed' ? 2 : 0);

    let resolvedWindSpeed = projectWindWithYaw(sourceMagnitudes, yaw);
    if (input.applyOffset !== false) {
        resolvedWindSpeed = applyAirSpeedOffset(resolvedWindSpeed, offsetSeconds);
    }

    if ((input.airSpeedCalibrationPercent ?? 0) !== 0) {
        const calibrationMultiplier = 1 + (input.airSpeedCalibrationPercent ?? 0) / 100;
        resolvedWindSpeed = resolvedWindSpeed.map(speed => speed * calibrationMultiplier);
    }

    return {
        selectedWindSource: 'fit',
        dataSource,
        hasAirSpeed,
        hasWindSpeed,
        defaultAirSpeedOffset,
        windSpeed: resolvedWindSpeed,
    };
}

export function applyAirSpeedOffset(airSpeed: number[], offsetSeconds: number): number[] {
    if (offsetSeconds === 0 || airSpeed.length === 0) {
        return airSpeed;
    }

    const offsetIndices = Math.round(offsetSeconds);
    const result = new Array(airSpeed.length);

    for (let i = 0; i < airSpeed.length; i++) {
        const sourceIndex = i + offsetIndices;
        result[i] = sourceIndex >= 0 && sourceIndex < airSpeed.length ? airSpeed[sourceIndex] : NaN;
    }

    return result;
}

export function calculateAirSpeedSyncError(
    groundSpeed: number[],
    airSpeed: number[],
    offsetSeconds: number,
    trimStart: number,
    trimEnd: number
): number {
    const offsetAirSpeed = applyAirSpeedOffset(airSpeed, offsetSeconds);

    let sumAbsDiff = 0;
    let validCount = 0;

    for (let i = trimStart; i <= trimEnd && i < groundSpeed.length; i++) {
        const ground = groundSpeed[i];
        const air = offsetAirSpeed[i];

        if (!isNaN(ground) && !isNaN(air) && ground > 0 && air > 0) {
            sumAbsDiff += Math.abs(air - ground);
            validCount++;
        }
    }

    return validCount > 0 ? sumAbsDiff / validCount : NaN;
}

function resolveYawArray(windYaw: ArrayLike<number> | undefined | null, length: number): number[] {
    const yaw = toNumberArray(windYaw);
    return yaw.length > 0 ? yaw : new Array(length).fill(0);
}

function projectWindWithYaw(magnitudes: number[], yaw: number[]): number[] {
    return magnitudes.map((magnitude, index) => {
        const yawDegrees = yaw[index] || 0;
        return Math.cos(yawDegrees * Math.PI / 180) * magnitude;
    });
}

function hasUsableValues(values: number[]): boolean {
    return values.some(value => !isNaN(value) && value !== 0);
}

function toNumberArray(values: ArrayLike<number> | undefined | null): number[] {
    return values ? Array.from(values) as number[] : [];
}

function normalizeWindSource(value: WindSource | string | null | undefined): WindSource | null {
    switch (value) {
        case 'constant':
        case 'fit':
        case 'compare':
        case 'none':
            return value;
        default:
            return null;
    }
}
