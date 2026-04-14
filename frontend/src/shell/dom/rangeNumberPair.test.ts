/**
 * @vitest-environment jsdom
 */
import { describe, expect, it, vi } from 'vitest'
import { syncRangeAndNumber } from './rangeNumberPair'

describe('syncRangeAndNumber', () => {
    function createPair(rangeId = 'testRange', numberId = 'testNumber'): { container: HTMLElement; range: HTMLInputElement; number: HTMLInputElement } {
        const container = document.createElement('div')

        const range = document.createElement('input')
        range.type = 'range'
        range.id = rangeId
        range.min = '0'
        range.max = '100'
        range.value = '50'
        range.step = '1'

        const number = document.createElement('input')
        number.type = 'number'
        number.id = numberId
        number.value = '50'

        container.append(range, number)
        document.body.appendChild(container)

        return { container, range, number }
    }

    it('syncs range input to number input', () => {
        const { container, range, number } = createPair()
        const onChange = vi.fn()

        syncRangeAndNumber({ rangeId: 'testRange', numberId: 'testNumber' }, onChange)

        range.value = '75'
        range.dispatchEvent(new Event('input'))

        expect(number.value).toBe('75.0')
        expect(onChange).toHaveBeenCalledWith(75)
        document.body.removeChild(container)
    })

    it('syncs number input to range input', () => {
        const { container, range, number } = createPair()
        const onChange = vi.fn()

        syncRangeAndNumber({ rangeId: 'testRange', numberId: 'testNumber' }, onChange)

        number.value = '30'
        number.dispatchEvent(new Event('change'))

        expect(range.value).toBe('30')
        expect(onChange).toHaveBeenCalledWith(30)
        document.body.removeChild(container)
    })

    it('clamps values to min/max range', () => {
        const { container, range, number } = createPair()
        const onChange = vi.fn()

        syncRangeAndNumber(
            { rangeId: 'testRange', numberId: 'testNumber', clampMin: 10, clampMax: 90 },
            onChange,
        )

        // Try setting below min
        number.value = '5'
        number.dispatchEvent(new Event('change'))
        expect(onChange).toHaveBeenCalledWith(10)
        expect(range.value).toBe('10')

        // Try setting above max
        number.value = '150'
        number.dispatchEvent(new Event('change'))
        expect(onChange).toHaveBeenCalledWith(90)
        expect(range.value).toBe('90')

        document.body.removeChild(container)
    })

    it('formats to specified decimal places', () => {
        const { container, range, number } = createPair()
        const onChange = vi.fn()

        syncRangeAndNumber(
            { rangeId: 'testRange', numberId: 'testNumber', decimals: 2 },
            onChange,
        )

        range.value = '33'
        range.dispatchEvent(new Event('input'))

        expect(number.value).toBe('33.00')
        document.body.removeChild(container)
    })

    it('does not throw when elements are missing', () => {
        const onChange = vi.fn()
        // Should not throw, just log a warning
        expect(() => {
            syncRangeAndNumber({ rangeId: 'missing', numberId: 'alsoMissing' }, onChange)
        }).not.toThrow()
        expect(onChange).not.toHaveBeenCalled()
    })
})
