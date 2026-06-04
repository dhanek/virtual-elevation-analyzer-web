import type { AnalysisParameters } from '../components/AnalysisParameters';

export interface SegmentSupplementarySeries {
    distancesKm: number[];
    powerWatts: number[];
    apparentWindSpeedMps: number[];
    virtualDistanceAirKm: number[];
    virtualDistanceGroundKm: number[];
}

export interface BuildSegmentSupplementarySeriesInput {
    timestamps: number[];
    power: number[];
    velocity: number[];
    positionLat: number[];
    positionLong: number[];
    distance: number[];
    windSpeed: number[];
    params: Pick<AnalysisParameters, 'wind_speed' | 'wind_direction'>;
    selectedWindSource: 'constant' | 'fit' | 'none';
}

export interface VirtualDistanceSeries {
    airKm: number[];
    groundKm: number[];
}

export function buildSegmentSupplementarySeries(
    input: BuildSegmentSupplementarySeriesInput,
): SegmentSupplementarySeries {
    const distancesKm = buildRelativeDistanceSeries(input.distance);
    const apparentWindSpeedMps = input.selectedWindSource === 'constant'
        ? calculateConstantApparentWindSeries(
            input.velocity,
            input.positionLat,
            input.positionLong,
            input.params,
        )
        : [...input.windSpeed];
    const virtualDistance = buildVirtualDistanceSeries(
        input.timestamps,
        input.velocity,
        apparentWindSpeedMps,
    );

    return {
        distancesKm,
        powerWatts: [...input.power],
        apparentWindSpeedMps,
        virtualDistanceAirKm: virtualDistance.airKm,
        virtualDistanceGroundKm: virtualDistance.groundKm,
    };
}

export function calculateConstantApparentWindSeries(
    velocity: number[],
    positionLat: number[],
    positionLong: number[],
    params: Pick<AnalysisParameters, 'wind_speed' | 'wind_direction'>,
): number[] {
    const configuredWindSpeed = params.wind_speed ?? 0;
    if (configuredWindSpeed === 0) {
        return [...velocity];
    }

    if (positionLat.length < 2 || positionLong.length < 2 || params.wind_direction == null) {
        return velocity.map(groundSpeed => groundSpeed + configuredWindSpeed);
    }

    const riderBearings = calculateRiderBearings(positionLat, positionLong);
    const configuredWindDirection = params.wind_direction;

    return velocity.map((groundSpeed, index) => {
        const bearing = riderBearings.length > index ? riderBearings[index] : 0;
        let angleDiff = Math.abs(configuredWindDirection - bearing);
        if (angleDiff > 180) {
            angleDiff = 360 - angleDiff;
        }

        const effectiveWind = configuredWindSpeed * Math.cos(angleDiff * Math.PI / 180);
        return groundSpeed + effectiveWind;
    });
}

export function calculateRiderBearings(positionLat: number[], positionLong: number[]): number[] {
    if (positionLat.length === 0 || positionLong.length === 0) {
        return [];
    }

    const riderBearings = new Array(positionLat.length).fill(0);
    for (let i = 1; i < positionLat.length; i++) {
        const lat1 = positionLat[i - 1] * Math.PI / 180;
        const lat2 = positionLat[i] * Math.PI / 180;
        const lon1 = positionLong[i - 1] * Math.PI / 180;
        const lon2 = positionLong[i] * Math.PI / 180;

        const deltaLongitude = lon2 - lon1;
        const y = Math.sin(deltaLongitude) * Math.cos(lat2);
        const x = Math.cos(lat1) * Math.sin(lat2) - Math.sin(lat1) * Math.cos(lat2) * Math.cos(deltaLongitude);
        let bearing = Math.atan2(y, x) * 180 / Math.PI;
        bearing = (bearing + 360) % 360;
        riderBearings[i] = bearing;
    }

    if (riderBearings.length > 1) {
        riderBearings[0] = riderBearings[1];
    }

    return riderBearings;
}

export function buildVirtualDistanceSeries(
    timestamps: number[],
    velocity: number[],
    apparentWindSpeedMps: number[],
): VirtualDistanceSeries {
    const airKm = new Array(timestamps.length).fill(0);
    const groundKm = new Array(timestamps.length).fill(0);

    for (let i = 1; i < timestamps.length; i++) {
        const dt = timestamps[i] - timestamps[i - 1];
        if (!(dt > 0 && dt < 10)) {
            airKm[i] = airKm[i - 1];
            groundKm[i] = groundKm[i - 1];
            continue;
        }

        const apparentSpeed = Number.isFinite(apparentWindSpeedMps[i]) && apparentWindSpeedMps[i] > 0
            ? apparentWindSpeedMps[i]
            : 0;
        const groundSpeed = Number.isFinite(velocity[i]) && velocity[i] > 0 ? velocity[i] : 0;

        airKm[i] = airKm[i - 1] + (apparentSpeed * dt) / 1000;
        groundKm[i] = groundKm[i - 1] + (groundSpeed * dt) / 1000;
    }

    return { airKm, groundKm };
}

function buildRelativeDistanceSeries(distance: number[]): number[] {
    if (distance.length === 0) {
        return [];
    }

    const startDistance = distance[0];
    return distance.map(value => (value - startDistance) / 1000);
}
