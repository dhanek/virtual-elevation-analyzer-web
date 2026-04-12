import { describe, expect, it } from 'vitest'
import type { AnalysisParameters } from '../components/AnalysisParameters'
import { applyAirSpeedOffset, calculateAirSpeedSyncError, resolveWindSeries } from './WindSourceResolver'

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

describe('resolveWindSeries', () => {
    it('returns a constant-source NaN series when constant wind is selected', () => {
        const result = resolveWindSeries({
            fitData: {
                timestamps: [0, 1, 2],
                air_speed: [10, 11, 12],
                wind_speed: [0, 0, 0],
                wind_yaw: [0, 0, 0],
            },
            windSource: 'constant',
            params: createParams(),
        })

        expect(result.selectedWindSource).toBe('constant')
        expect(result.dataSource).toBe('constant')
        expect(result.windSpeed).toHaveLength(3)
        expect(result.windSpeed.every(value => Number.isNaN(value))).toBe(true)
    })

    it('uses air-speed data with yaw projection and calibration', () => {
        const result = resolveWindSeries({
            fitData: {
                timestamps: [0, 1],
                air_speed: [10, 20],
                wind_speed: [0, 0],
                wind_yaw: [0, 60],
            },
            windSource: 'fit',
            params: createParams({ air_speed_offset: 0 }),
            airSpeedCalibrationPercent: 10,
        })

        expect(result.selectedWindSource).toBe('fit')
        expect(result.dataSource).toBe('air_speed')
        expect(result.windSpeed[0]).toBeCloseTo(11)
        expect(result.windSpeed[1]).toBeCloseTo(11)
    })

    it('falls back to FIT wind-speed data when air-speed data is unavailable', () => {
        const result = resolveWindSeries({
            fitData: {
                timestamps: [0, 1],
                air_speed: [0, 0],
                wind_speed: [5, 6],
                wind_yaw: [0, 0],
            },
            windSource: 'fit',
            params: createParams({ air_speed_offset: 0 }),
        })

        expect(result.dataSource).toBe('wind_speed')
        expect(result.windSpeed).toEqual([5, 6])
    })
})

describe('air-speed helpers', () => {
    it('shifts the apparent-speed series by the configured offset', () => {
        expect(applyAirSpeedOffset([10, 20, 30], 1)).toEqual([20, 30, Number.NaN])
        expect(applyAirSpeedOffset([10, 20, 30], -1)).toEqual([Number.NaN, 10, 20])
    })

    it('computes a trim-region sync error for overlapping ground and air speed', () => {
        const error = calculateAirSpeedSyncError([10, 12, 14], [11, 13, 15], 0, 0, 2)
        expect(error).toBeCloseTo(1)
    })
})
