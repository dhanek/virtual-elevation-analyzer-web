import type { SelectedSlice } from '../state/AppState';

export interface SegmentExtractionInput {
    startIdx: number;
    endIdx: number;
    allTimestamps: number[];
    allPower: number[];
    allVelocity: number[];
    allPositionLat: number[];
    allPositionLong: number[];
    allAltitude: number[];
    allDistance: number[];
    allWindSpeed: number[];
}

export function createSelectedSlice(input: SegmentExtractionInput): SelectedSlice {
    const timestamps: number[] = [];
    const power: number[] = [];
    const velocity: number[] = [];
    const positionLat: number[] = [];
    const positionLong: number[] = [];
    const altitude: number[] = [];
    const distance: number[] = [];
    const windSpeed: number[] = [];

    for (let i = input.startIdx; i <= input.endIdx && i < input.allTimestamps.length; i++) {
        timestamps.push(input.allTimestamps[i]);
        power.push(input.allPower[i]);
        velocity.push(input.allVelocity[i]);
        positionLat.push(input.allPositionLat[i]);
        positionLong.push(input.allPositionLong[i]);
        altitude.push(input.allAltitude[i]);
        distance.push(input.allDistance[i]);
        windSpeed.push(input.allWindSpeed[i]);
    }

    return {
        startIdx: input.startIdx,
        endIdx: input.endIdx,
        timestamps,
        power,
        velocity,
        positionLat,
        positionLong,
        altitude,
        distance,
        windSpeed,
    };
}

export function extractSegmentData(input: SegmentExtractionInput): SelectedSlice {
    return createSelectedSlice(input);
}
