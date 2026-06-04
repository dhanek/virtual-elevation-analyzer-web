import { describe, expect, it } from 'vitest'
import {
    AIR_SPEED_CALIBRATION_MAX_PERCENT,
    AIR_SPEED_CALIBRATION_MIN_PERCENT,
    calculateAutoAirSpeedCalibrationPercent,
} from './AirSpeedCalibration'

describe('calculateAutoAirSpeedCalibrationPercent', () => {
    it('calculates calibration for a single segment', () => {
        const calibration = calculateAutoAirSpeedCalibrationPercent([
            {
                timestamps: [0, 1, 2, 3],
                groundSpeed: [11, 11, 11, 11],
                apparentSpeed: [10, 10, 10, 10],
            },
        ])

        expect(calibration).toBeCloseTo(10, 6)
    })

    it('stacks multiple segments when calculating calibration', () => {
        const calibration = calculateAutoAirSpeedCalibrationPercent([
            {
                timestamps: [0, 1, 2],
                groundSpeed: [11, 11, 11],
                apparentSpeed: [10, 10, 10],
            },
            {
                timestamps: [0, 2, 4],
                groundSpeed: [22, 22, 22],
                apparentSpeed: [20, 20, 20],
            },
        ])

        expect(calibration).toBeCloseTo(10, 6)
    })

    it('ignores invalid time deltas and returns null when no usable air distance exists', () => {
        const calibration = calculateAutoAirSpeedCalibrationPercent([
            {
                timestamps: [0, 10, 20],
                groundSpeed: [11, 11, 11],
                apparentSpeed: [10, 10, 10],
            },
            {
                timestamps: [0, 1],
                groundSpeed: [11, 11],
                apparentSpeed: [0, 0],
            },
        ])

        expect(calibration).toBeNull()
    })

    it('respects start and end indices for trimmed standard-mode calculations', () => {
        const calibration = calculateAutoAirSpeedCalibrationPercent([
            {
                timestamps: [0, 1, 2, 3],
                groundSpeed: [5, 11, 11, 5],
                apparentSpeed: [5, 10, 10, 5],
                startIndex: 1,
                endIndex: 2,
            },
        ])

        expect(calibration).toBeCloseTo(10, 6)
    })

    it('clamps extreme suggestions to configured bounds', () => {
        const high = calculateAutoAirSpeedCalibrationPercent([
            {
                timestamps: [0, 1],
                groundSpeed: [30, 30],
                apparentSpeed: [10, 10],
            },
        ])
        const low = calculateAutoAirSpeedCalibrationPercent([
            {
                timestamps: [0, 1],
                groundSpeed: [1, 1],
                apparentSpeed: [10, 10],
            },
        ])

        expect(high).toBe(AIR_SPEED_CALIBRATION_MAX_PERCENT)
        expect(low).toBe(AIR_SPEED_CALIBRATION_MIN_PERCENT)
    })
})
