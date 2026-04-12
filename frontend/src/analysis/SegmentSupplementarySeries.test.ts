import { describe, expect, it } from 'vitest'
import type { AnalysisParameters } from '../components/AnalysisParameters'
import {
    buildSegmentSupplementarySeries,
    buildVirtualDistanceSeries,
    calculateConstantApparentWindSeries,
} from './SegmentSupplementarySeries'

function createParams(overrides: Partial<AnalysisParameters> = {}): AnalysisParameters {
    return {
        system_mass: 75,
        rho: 1.225,
        eta: 0.97,
        cda: null,
        crr: null,
        cda_min: 0.15,
        cda_max: 0.5,
        crr_min: 0.002,
        crr_max: 0.015,
        wind_speed: null,
        wind_direction: null,
        wind_speed_unit: 'm/s',
        air_speed_offset: 2,
        velodrome: false,
        auto_lap_detection: 'None',
        auto_calculate_rho: false,
        rho_source: 'manual',
        ...overrides,
    }
}

describe('calculateConstantApparentWindSeries', () => {
    it('falls back to ground speed plus configured headwind when GPS bearings are unavailable', () => {
        const apparent = calculateConstantApparentWindSeries(
            [10, 10, 10],
            [],
            [],
            createParams({ wind_speed: 5, wind_direction: 180 }),
        )

        expect(apparent).toEqual([15, 15, 15])
    })
})

describe('buildVirtualDistanceSeries', () => {
    it('accumulates air and ground distance in kilometers', () => {
        const result = buildVirtualDistanceSeries([0, 1, 2], [10, 10, 10], [15, 15, 15])

        expect(result.airKm).toEqual([0, 0.015, 0.03])
        expect(result.groundKm).toEqual([0, 0.01, 0.02])
    })
})

describe('buildSegmentSupplementarySeries', () => {
    it('builds relative distance, power, apparent wind, and VD series for a segment', () => {
        const result = buildSegmentSupplementarySeries({
            timestamps: [0, 1, 2],
            power: [200, 210, 220],
            velocity: [10, 10, 10],
            positionLat: [],
            positionLong: [],
            distance: [1000, 1010, 1020],
            windSpeed: [0, 0, 0],
            params: createParams({ wind_speed: 5, wind_direction: 180 }),
            selectedWindSource: 'constant',
        })

        expect(result.distancesKm).toEqual([0, 0.01, 0.02])
        expect(result.powerWatts).toEqual([200, 210, 220])
        expect(result.apparentWindSpeedMps).toEqual([15, 15, 15])
        expect(result.virtualDistanceAirKm).toEqual([0, 0.015, 0.03])
        expect(result.virtualDistanceGroundKm).toEqual([0, 0.01, 0.02])
    })
})
