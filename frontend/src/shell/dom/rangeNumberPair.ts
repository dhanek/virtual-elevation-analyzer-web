import { log } from '../../utils/log'

/**
 * Options for synchronizing a range slider with a number input.
 */
export interface RangeNumberPairOptions {
    /** ID of the range input element */
    rangeId: string
    /** ID of the number input element */
    numberId: string
    /** Number of decimal places (default: 1) */
    decimals?: number
    /** Optional minimum clamp value */
    clampMin?: number
    /** Optional maximum clamp value */
    clampMax?: number
}

/**
 * Synchronize a range input and a number input bidirectionally.
 * When either changes, the other is updated and the onChange callback
 * is invoked with the new (possibly clamped) value.
 *
 * This replaces the repeated slider/number sync patterns in
 * setupVESliders, setupGpsLapSliderHandlers, and setupOutAndBackSliderSync.
 */
export function syncRangeAndNumber(
    options: RangeNumberPairOptions,
    onChange: (value: number) => void,
): void {
    const { rangeId, numberId, decimals = 1, clampMin, clampMax } = options

    const rangeEl = document.getElementById(rangeId) as HTMLInputElement | null
    const numberEl = document.getElementById(numberId) as HTMLInputElement | null

    if (!rangeEl || !numberEl) {
        log.warn(`syncRangeAndNumber: could not find elements #${rangeId} or #${numberId}`)
        return
    }

    function clamp(value: number): number {
        let result = value
        if (clampMin !== undefined && result < clampMin) result = clampMin
        if (clampMax !== undefined && result > clampMax) result = clampMax
        return result
    }

    rangeEl.addEventListener('input', () => {
        const raw = parseFloat(rangeEl.value)
        const value = clamp(raw)
        numberEl.value = value.toFixed(decimals)
        log.debug(`Range [${rangeId}] changed to ${value}`)
        onChange(value)
    })

    numberEl.addEventListener('change', () => {
        const raw = parseFloat(numberEl.value)
        const value = clamp(raw)
        rangeEl.value = value.toString()
        numberEl.value = value.toFixed(decimals)
        log.debug(`Number [${numberId}] changed to ${value}`)
        onChange(value)
    })
}
