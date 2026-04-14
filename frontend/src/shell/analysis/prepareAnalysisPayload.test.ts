import { describe, expect, it, vi } from 'vitest';
import type { PayloadPreparationInput } from './prepareAnalysisPayload';
import type { PreparedAnalysisSelection } from '../../modes/analysis/types';
import type { AnalysisParameters } from '../../components/AnalysisParameters';

// Mock the WASM-dependent module so tests run without WASM runtime
vi.mock('../../analysis/VeCalculatorFactory', () => ({
    createVeCalculator: vi.fn(() => ({
        calculate_virtual_elevation: vi.fn(
            (cda: number, _crr: number, trimStart: number, trimEnd: number) => ({
                ve: new Array(Math.max(trimEnd - trimStart + 1, 0)).fill(0),
                cd: cda,
            }),
        ),
    })),
}));

// Mock AnalysisModes to avoid loading mode-handler dependencies
vi.mock('../../modes/analysis/AnalysisModes', () => ({
    collectSelectionIndices: vi.fn((selection: PreparedAnalysisSelection, timestamps: ArrayLike<number>) => {
        if (selection.indexRanges) {
            const indices: number[] = [];
            for (const range of selection.indexRanges) {
                for (let i = range.startIdx; i <= range.endIdx && i < timestamps.length; i++) {
                    indices.push(i);
                }
            }
            return indices;
        }
        if (selection.timeRanges) {
            const indices: number[] = [];
            for (let i = 0; i < timestamps.length; i++) {
                if (selection.timeRanges.some(range => timestamps[i] >= range.start && timestamps[i] <= range.end)) {
                    indices.push(i);
                }
            }
            return indices;
        }
        return [];
    }),
}));

// Import after mocks are set up
import { prepareAnalysisPayload } from './prepareAnalysisPayload';

const defaultParams: AnalysisParameters = {
    system_mass: 80,
    rho: 1.225,
    eta: 0.97,
    cda: 0.3,
    crr: 0.008,
    cda_min: 0.1,
    cda_max: 0.6,
    crr_min: 0.001,
    crr_max: 0.02,
    wind_speed: null,
    wind_direction: null,
    wind_speed_unit: 'm/s' as const,
    air_speed_offset: 2,
    velodrome: false,
    auto_lap_detection: 'None' as const,
    auto_calculate_rho: false,
};

function createMockFitData(overrides: Record<string, unknown> = {}) {
    return {
        timestamps: [0, 1, 2, 3, 4],
        power: [100, 200, 300, 150, 250],
        velocity: [5, 6, 7, 4, 8],
        position_lat: [1, 2, 3, 4, 5],
        position_long: [10, 20, 30, 40, 50],
        altitude: [100, 101, 102, 100, 103],
        distance: [0, 10, 20, 30, 40],
        air_speed: [3, 4, 5, 3, 4],
        wind_speed: [],
        wind_yaw: [],
        air_density_data: [],
        road_speed: [],
        temperature: [20, 21, 22, 20, 21],
        battery_soc: [],
        heart_rate: [],
        cadence: [],
        record_count: 5,
        ...overrides,
    } as any;
}

function createMockNormalizedArrays(fitData: any) {
    return {
        timestamps: fitData.timestamps,
        power: fitData.power,
        velocity: fitData.velocity,
        positionLat: fitData.position_lat,
        positionLong: fitData.position_long,
        altitude: fitData.altitude,
        distance: fitData.distance,
        airSpeed: fitData.air_speed,
        windSpeed: fitData.wind_speed || [],
        windYaw: fitData.wind_yaw || [],
        airDensity: fitData.air_density_data || [],
        roadSpeed: fitData.road_speed || [],
        temperature: fitData.temperature || [],
        cdaReference: fitData.cda_reference || null,
    };
}

function createSelection(overrides: Partial<PreparedAnalysisSelection> = {}): PreparedAnalysisSelection {
    return {
        mode: 'standard',
        selectedItems: [0],
        selectedEntries: [],
        indexRanges: [{ startIdx: 0, endIdx: 2 }],
        timeRanges: null,
        outAndBackSections: null,
        emptySelectionMessage: '',
        ...overrides,
    };
}

function createInput(overrides: Partial<PayloadPreparationInput> = {}): PayloadPreparationInput {
    const fitData = (overrides.fitData as any) ?? createMockFitData();
    return {
        fitData,
        selection: createSelection(),
        params: defaultParams,
        cda: 0.3,
        crr: 0.008,
        getNormalizedActivityArrays: () => createMockNormalizedArrays(fitData),
        ...overrides,
    };
}

describe('prepareAnalysisPayload', () => {
    it('returns correct filteredData for a simple selection with indices [0, 1, 2]', () => {
        const result = prepareAnalysisPayload(createInput());

        expect(result.selectedIndices).toEqual([0, 1, 2]);
        expect(result.filteredData.timestamps).toEqual([0, 1, 2]);
        expect(result.filteredData.power).toEqual([100, 200, 300]);
        expect(result.filteredData.velocity).toEqual([5, 6, 7]);
        expect(result.filteredData.altitude).toEqual([100, 101, 102]);
        expect(result.filteredData.distance).toEqual([0, 10, 20]);
    });

    it('returns correct defaultAirSpeedOffset from resolveWindSeries', () => {
        const result = prepareAnalysisPayload(createInput());

        // air_speed has usable values → defaultAirSpeedOffset = 2
        expect(result.defaultAirSpeedOffset).toBe(2);
    });

    it('returns null rhoArray when calculateRhoArray is not provided', () => {
        const result = prepareAnalysisPayload(createInput());

        expect(result.rhoArray).toBeNull();
    });

    it('returns selected rho values when calculateRhoArray returns a full array', () => {
        const fullRhoArray = [1.225, 1.226, 1.227, 1.224, 1.225];

        const result = prepareAnalysisPayload(
            createInput({
                calculateRhoArray: () => fullRhoArray,
            }),
        );

        // selectedIndices = [0, 1, 2]
        expect(result.rhoArray).toEqual([1.225, 1.226, 1.227]);
    });

    it('throws when filteredTimestamps is empty (no valid data points)', () => {
        const selection = createSelection({
            indexRanges: null,
            timeRanges: [{ start: 999, end: 1000 }],
        });

        expect(() =>
            prepareAnalysisPayload(createInput({ selection })),
        ).toThrow('No valid data points found in selected laps');
    });
});
