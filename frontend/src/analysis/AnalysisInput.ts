export interface AnalysisInput {
    timestamps: number[];
    power: number[];
    velocity: number[];
    positionLat: number[];
    positionLong: number[];
    altitude: number[];
    distance: number[];
    windSpeed: number[];
}

export function createAnalysisInput(input: AnalysisInput): AnalysisInput {
    return input;
}
