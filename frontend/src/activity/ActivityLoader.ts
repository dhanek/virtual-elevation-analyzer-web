import { GibliCsvParser, type GibliCsvData } from '../utils/CsvParser';
import { analyzeTimeIntervals, interpolateAllData } from '../utils/DataInterpolation';
import {
    createLoadedActivity,
    type ActivityData,
    type ActivityLapLike,
    type ActivityResult,
    type LoadedActivity,
} from '../state/AppState';

export interface LoadCsvActivityInput {
    file: File;
    fileHash: string | null;
    text: string;
}

export interface LoadCsvActivityResult {
    csvData: GibliCsvData;
    result: ActivityResult;
    loadedActivity: LoadedActivity;
    summary: string;
    intervals: ReturnType<typeof analyzeTimeIntervals>;
    wasInterpolated: boolean;
}

export function createFitLoadedActivity(input: {
    file: File;
    fileHash: string | null;
    result: ActivityResult;
}): LoadedActivity {
    return createLoadedActivity({
        source: 'fit',
        file: input.file,
        fileHash: input.fileHash,
        result: input.result,
    });
}

export function loadCsvActivity(input: LoadCsvActivityInput): LoadCsvActivityResult {
    const parsedCsv = GibliCsvParser.parse(input.text);
    const { csvData, intervals, wasInterpolated } = normalizeCsvData(parsedCsv);
    const result = buildCsvActivityResult(csvData);

    return {
        csvData,
        result,
        loadedActivity: createLoadedActivity({
            source: 'csv',
            file: input.file,
            fileHash: input.fileHash,
            result,
        }),
        summary: GibliCsvParser.getSummary(csvData),
        intervals,
        wasInterpolated,
    };
}

function normalizeCsvData(csvData: GibliCsvData): {
    csvData: GibliCsvData;
    intervals: ReturnType<typeof analyzeTimeIntervals>;
    wasInterpolated: boolean;
} {
    const normalized = cloneCsvData(csvData);
    const intervals = analyzeTimeIntervals(normalized.timestamps);

    if (intervals.std <= 0.1) {
        return { csvData: normalized, intervals, wasInterpolated: false };
    }

    const dataToInterpolate: Record<string, number[]> = {
        velocity: normalized.velocity,
        power: normalized.power,
        airSpeed: normalized.airSpeed,
        windAngle: normalized.windAngle,
        altitude: normalized.altitude,
        positionLat: normalized.positionLat,
        positionLong: normalized.positionLong,
    };

    if (normalized.temperature) dataToInterpolate.temperature = normalized.temperature;
    if (normalized.humidity) dataToInterpolate.humidity = normalized.humidity;
    if (normalized.pressure) dataToInterpolate.pressure = normalized.pressure;
    if (normalized.cdaReference) dataToInterpolate.cdaReference = normalized.cdaReference;
    if (normalized.lapNumber) dataToInterpolate.lapNumber = normalized.lapNumber;

    const interpolated = interpolateAllData(normalized.timestamps, dataToInterpolate);

    normalized.timestamps = interpolated.timestamps;
    normalized.velocity = interpolated.velocity;
    normalized.power = interpolated.power;
    normalized.airSpeed = interpolated.airSpeed;
    normalized.windAngle = interpolated.windAngle;
    normalized.altitude = interpolated.altitude;
    normalized.positionLat = interpolated.positionLat;
    normalized.positionLong = interpolated.positionLong;
    if (interpolated.temperature) normalized.temperature = interpolated.temperature;
    if (interpolated.humidity) normalized.humidity = interpolated.humidity;
    if (interpolated.pressure) normalized.pressure = interpolated.pressure;
    if (interpolated.cdaReference) normalized.cdaReference = interpolated.cdaReference;
    if (interpolated.lapNumber) normalized.lapNumber = interpolated.lapNumber;

    normalized.dataPointCount = normalized.timestamps.length;
    normalized.timeRangeSeconds = normalized.timestamps.length > 0
        ? normalized.timestamps[normalized.timestamps.length - 1] - normalized.timestamps[0]
        : 0;

    return {
        csvData: normalized,
        intervals,
        wasInterpolated: true,
    };
}

function cloneCsvData(csvData: GibliCsvData): GibliCsvData {
    return {
        ...csvData,
        timestamps: [...csvData.timestamps],
        velocity: [...csvData.velocity],
        power: [...csvData.power],
        airSpeed: [...csvData.airSpeed],
        windAngle: [...csvData.windAngle],
        altitude: [...csvData.altitude],
        positionLat: [...csvData.positionLat],
        positionLong: [...csvData.positionLong],
        temperature: csvData.temperature ? [...csvData.temperature] : undefined,
        humidity: csvData.humidity ? [...csvData.humidity] : undefined,
        pressure: csvData.pressure ? [...csvData.pressure] : undefined,
        cdaReference: csvData.cdaReference ? [...csvData.cdaReference] : undefined,
        lapNumber: csvData.lapNumber ? [...csvData.lapNumber] : undefined,
    };
}

function buildCsvActivityResult(csvData: GibliCsvData): ActivityResult {
    const activityData = createCsvActivityData(csvData);

    return {
        fit_data: activityData,
        parsing_statistics: {
            has_power_data: csvData.power.some(p => !isNaN(p) && p > 0),
            has_gps_data: csvData.positionLat.some(lat => !isNaN(lat)),
            has_altitude_data: csvData.altitude.some(alt => !isNaN(alt)),
            has_air_speed_data: csvData.airSpeed.some(speed => !isNaN(speed) && speed > 0),
            data_points: csvData.timestamps.length,
        },
        laps: csvData.hasLapData ? generateLapsFromCsv(csvData) : [],
    };
}

function calculateDistanceArray(lats: number[], lons: number[]): number[] {
    const distances: number[] = [0];
    let cumulative = 0;

    for (let i = 1; i < lats.length; i++) {
        const lat1 = lats[i - 1];
        const lon1 = lons[i - 1];
        const lat2 = lats[i];
        const lon2 = lons[i];

        const earthRadiusMeters = 6371000;
        const phi1 = lat1 * Math.PI / 180;
        const phi2 = lat2 * Math.PI / 180;
        const deltaPhi = (lat2 - lat1) * Math.PI / 180;
        const deltaLambda = (lon2 - lon1) * Math.PI / 180;

        const a = Math.sin(deltaPhi / 2) * Math.sin(deltaPhi / 2) +
            Math.cos(phi1) * Math.cos(phi2) *
            Math.sin(deltaLambda / 2) * Math.sin(deltaLambda / 2);
        const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
        const distance = earthRadiusMeters * c;

        cumulative += distance;
        distances.push(cumulative);
    }

    return distances;
}

function generateLapsFromCsv(csvData: GibliCsvData): ActivityLapLike[] {
    if (!csvData.hasLapData || !csvData.lapNumber) {
        return [];
    }

    const laps: ActivityLapLike[] = [];
    const uniqueLapNumbers = Array.from(new Set(csvData.lapNumber.filter(n => !isNaN(n)))).sort((a, b) => a - b);

    for (const lapNum of uniqueLapNumbers) {
        const indices = csvData.lapNumber
            .map((n, i) => n === lapNum ? i : -1)
            .filter(i => i !== -1);

        if (indices.length === 0) {
            continue;
        }

        const startIdx = indices[0];
        const endIdx = indices[indices.length - 1];

        laps.push({
            lap_number: lapNum,
            start_time: csvData.timestamps[startIdx],
            end_time: csvData.timestamps[endIdx],
            total_elapsed_time: csvData.timestamps[endIdx] - csvData.timestamps[startIdx],
            start_index: startIdx,
            end_index: endIdx,
            total_distance: 0,
            avg_power: 0,
            avg_speed: 0,
            start_position_lat: csvData.positionLat[startIdx] ?? 0,
            start_position_long: csvData.positionLong[startIdx] ?? 0,
        });
    }

    return laps;
}

function createCsvActivityData(csvData: GibliCsvData): ActivityData {
    const distance = calculateDistanceArray(csvData.positionLat, csvData.positionLong);

    const windSpeed = csvData.windAngle.map((angleDeg, i) => {
        const magnitude = csvData.airSpeed[i];
        if (isNaN(angleDeg) || isNaN(magnitude)) {
            return 0;
        }
        const angleRad = (angleDeg * Math.PI) / 180;
        return Math.cos(angleRad) * magnitude;
    });

    return {
        timestamps: csvData.timestamps,
        position_lat: csvData.positionLat,
        position_long: csvData.positionLong,
        altitude: csvData.altitude,
        velocity: csvData.velocity,
        power: csvData.power,
        air_speed: csvData.airSpeed,
        distance,
        wind_speed: windSpeed,
        wind_yaw: csvData.windAngle || new Array(csvData.timestamps.length).fill(0),
        air_density_data: new Array(csvData.timestamps.length).fill(0),
        road_speed: new Array(csvData.timestamps.length).fill(0),
        temperature: csvData.temperature || new Array(csvData.timestamps.length).fill(0),
        battery_soc: new Array(csvData.timestamps.length).fill(0),
        heart_rate: new Array(csvData.timestamps.length).fill(0),
        cadence: new Array(csvData.timestamps.length).fill(0),
        record_count: csvData.timestamps.length,
        humidity: csvData.humidity,
        pressure: csvData.pressure,
        cda_reference: csvData.cdaReference,
    };
}
