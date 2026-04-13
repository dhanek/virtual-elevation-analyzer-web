export const DEFAULT_AIR_SPEED_CALIBRATION_PERCENT = 0.0
export const AIR_SPEED_CALIBRATION_MIN_PERCENT = -20.0
export const AIR_SPEED_CALIBRATION_MAX_PERCENT = 20.0
export const AIR_SPEED_CALIBRATION_STEP_PERCENT = 0.1
const MAX_VALID_VIRTUAL_DISTANCE_DELTA_SECONDS = 10

export interface AutoCalibrationSegment {
    timestamps: ArrayLike<number>
    groundSpeed: ArrayLike<number>
    apparentSpeed: ArrayLike<number>
    startIndex?: number
    endIndex?: number
}

export function clampAirSpeedCalibrationPercent(value: number): number {
    return Math.max(
        AIR_SPEED_CALIBRATION_MIN_PERCENT,
        Math.min(value, AIR_SPEED_CALIBRATION_MAX_PERCENT),
    )
}

export function formatAirSpeedCalibrationPercent(value: number | null | undefined): string {
    return clampAirSpeedCalibrationPercent(value ?? DEFAULT_AIR_SPEED_CALIBRATION_PERCENT).toFixed(1)
}

export function calculateAutoAirSpeedCalibrationPercent(
    segments: AutoCalibrationSegment[],
): number | null {
    let virtualDistanceAir = 0
    let virtualDistanceGround = 0

    for (const segment of segments) {
        const timestamps = Array.from(segment.timestamps)
        const groundSpeed = Array.from(segment.groundSpeed)
        const apparentSpeed = Array.from(segment.apparentSpeed)
        const maxIndex = Math.min(timestamps.length, groundSpeed.length, apparentSpeed.length) - 1

        if (maxIndex < 1) {
            continue
        }

        const startIndex = Math.max(0, Math.min(segment.startIndex ?? 0, maxIndex))
        const endIndex = Math.max(startIndex, Math.min(segment.endIndex ?? maxIndex, maxIndex))

        for (let index = startIndex + 1; index <= endIndex; index++) {
            const dt = timestamps[index] - timestamps[index - 1]
            if (dt <= 0 || dt >= MAX_VALID_VIRTUAL_DISTANCE_DELTA_SECONDS) {
                continue
            }

            const airSpeed = apparentSpeed[index]
            if (Number.isFinite(airSpeed) && airSpeed > 0) {
                virtualDistanceAir += airSpeed * dt
            }

            const speed = groundSpeed[index]
            if (Number.isFinite(speed) && speed > 0) {
                virtualDistanceGround += speed * dt
            }
        }
    }

    if (virtualDistanceAir <= 0) {
        return null
    }

    const calibrationMultiplier = virtualDistanceGround / virtualDistanceAir
    return clampAirSpeedCalibrationPercent((calibrationMultiplier - 1) * 100)
}
