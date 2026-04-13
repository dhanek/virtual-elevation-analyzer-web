import { describe, expect, it } from 'vitest'

import { DEFAULT_PARAMETERS } from '../components/AnalysisParameters'
import { DEFAULT_AIR_SPEED_CALIBRATION_PERCENT } from './AirSpeedCalibration'
import { resolveMultiSegmentSettings, sameSelection } from './MultiSegmentSettings'

describe('sameSelection', () => {
    it('returns true for identical selections', () => {
        expect(sameSelection([1, 2, 4], [1, 2, 4])).toBe(true)
    })

    it('returns false for different selections', () => {
        expect(sameSelection([1, 2], [2, 1])).toBe(false)
        expect(sameSelection([1, 2], [1, 2, 3])).toBe(false)
    })
})

describe('resolveMultiSegmentSettings', () => {
    it('preserves current calibration and params for the same analyzed selection', () => {
        const params = { ...DEFAULT_PARAMETERS, cda: 0.24, crr: 0.0038 }

        const resolved = resolveMultiSegmentSettings({
            currentAnalyzedItems: [2, 3],
            nextAnalyzedItems: [2, 3],
            params,
            currentAirSpeedCalibrationPercent: 6.5,
            savedSettings: {
                cda: 0.3,
                crr: 0.005,
                airSpeedCalibration: 0,
            },
        })

        expect(resolved.params.cda).toBe(0.24)
        expect(resolved.params.crr).toBe(0.0038)
        expect(resolved.airSpeedCalibrationPercent).toBe(6.5)
    })

    it('loads saved cda/crr/calibration when the analyzed selection changes', () => {
        const resolved = resolveMultiSegmentSettings({
            currentAnalyzedItems: [1],
            nextAnalyzedItems: [4, 5],
            params: { ...DEFAULT_PARAMETERS, cda: 0.23, crr: 0.004 },
            currentAirSpeedCalibrationPercent: 8,
            savedSettings: {
                cda: 0.27,
                crr: 0.0033,
                airSpeedCalibration: -4.5,
            },
        })

        expect(resolved.params.cda).toBe(0.27)
        expect(resolved.params.crr).toBe(0.0033)
        expect(resolved.airSpeedCalibrationPercent).toBe(-4.5)
    })

    it('resets calibration to default when a new selection has no saved settings', () => {
        const resolved = resolveMultiSegmentSettings({
            currentAnalyzedItems: [1, 2],
            nextAnalyzedItems: [7],
            params: { ...DEFAULT_PARAMETERS, cda: 0.21, crr: 0.0042 },
            currentAirSpeedCalibrationPercent: 9,
            savedSettings: null,
        })

        expect(resolved.params.cda).toBe(0.21)
        expect(resolved.params.crr).toBe(0.0042)
        expect(resolved.airSpeedCalibrationPercent).toBe(DEFAULT_AIR_SPEED_CALIBRATION_PERCENT)
    })
})
