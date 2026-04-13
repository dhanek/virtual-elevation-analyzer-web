import type { AnalysisParameters } from '../components/AnalysisParameters'
import type { LapSettings } from '../utils/ParameterStorage'

import { DEFAULT_AIR_SPEED_CALIBRATION_PERCENT } from './AirSpeedCalibration'

export interface ResolvedMultiSegmentSettings {
    params: AnalysisParameters
    airSpeedCalibrationPercent: number
}

interface ResolveMultiSegmentSettingsInput {
    currentAnalyzedItems: number[]
    nextAnalyzedItems: number[]
    params: AnalysisParameters
    currentAirSpeedCalibrationPercent: number
    savedSettings?: Pick<LapSettings, 'cda' | 'crr' | 'airSpeedCalibration'> | null
}

export function resolveMultiSegmentSettings(
    input: ResolveMultiSegmentSettingsInput,
): ResolvedMultiSegmentSettings {
    if (sameSelection(input.currentAnalyzedItems, input.nextAnalyzedItems)) {
        return {
            params: input.params,
            airSpeedCalibrationPercent: input.currentAirSpeedCalibrationPercent,
        }
    }

    return {
        params: {
            ...input.params,
            cda: input.savedSettings?.cda ?? input.params.cda,
            crr: input.savedSettings?.crr ?? input.params.crr,
        },
        airSpeedCalibrationPercent:
            input.savedSettings?.airSpeedCalibration ?? DEFAULT_AIR_SPEED_CALIBRATION_PERCENT,
    }
}

export function sameSelection(left: number[], right: number[]): boolean {
    return left.length === right.length && left.every((value, index) => value === right[index])
}
