/**
 * @vitest-environment jsdom
 */

import { describe, expect, it, vi } from 'vitest'
import { renderSelectableCards, bindSelectableCardEvents } from './selectableCards'
import type { SelectableCardItem } from './selectableCards'

describe('renderSelectableCards', () => {
    it('returns empty string for empty items array', () => {
        const result = renderSelectableCards([], 'test-checkbox')
        expect(result).toBe('')
    })

    it('renders correct HTML structure for checked items', () => {
        const items: SelectableCardItem[] = [
            { id: 'gps-lap-1', label: 'Lap 1', details: '5:30 • 3.2km • North', checked: true, dataAttr: 'gps-lap', dataValue: 1 },
        ]
        const result = renderSelectableCards(items, 'gps-lap-checkbox')

        expect(result).toContain('class="lap-checkbox-item selected"')
        expect(result).toContain('data-gps-lap="1"')
        expect(result).toContain('class="gps-lap-checkbox"')
        expect(result).toContain('id="gps-lap-1"')
        expect(result).toContain('checked')
        expect(result).toContain('Lap 1')
        expect(result).toContain('5:30 • 3.2km • North')
    })

    it('renders unchecked items without selected class and checked attribute', () => {
        const items: SelectableCardItem[] = [
            { id: 'oab-2', label: 'Section 2', details: 'Out: 5m • Back: 5m', checked: false, dataAttr: 'oab-section', dataValue: 2 },
        ]
        const result = renderSelectableCards(items, 'oab-section-checkbox')

        expect(result).toContain('class="lap-checkbox-item"')
        expect(result).not.toContain('class="lap-checkbox-item selected"')
        expect(result).not.toContain('checked>')
        expect(result).toContain('data-oab-section="2"')
    })

    it('uses the provided CSS class for checkboxes', () => {
        const items: SelectableCardItem[] = [
            { id: 'lap-3', label: 'Lap 3', details: '10:00 • 5km', checked: true, dataAttr: 'lap', dataValue: 3 },
        ]
        const result = renderSelectableCards(items, 'lap-checkbox')

        expect(result).toContain('class="lap-checkbox"')
    })

    it('renders multiple items', () => {
        const items: SelectableCardItem[] = [
            { id: 'lap-1', label: 'Lap 1', details: 'a', checked: true, dataAttr: 'lap', dataValue: 1 },
            { id: 'lap-2', label: 'Lap 2', details: 'b', checked: false, dataAttr: 'lap', dataValue: 2 },
        ]
        const result = renderSelectableCards(items, 'lap-checkbox')

        expect(result).toContain('Lap 1')
        expect(result).toContain('Lap 2')
        expect(result).toContain('data-lap="1"')
        expect(result).toContain('data-lap="2"')
    })
})

describe('bindSelectableCardEvents', () => {
    function createContainer(items: SelectableCardItem[]): HTMLElement {
        const container = document.createElement('div')
        container.innerHTML = renderSelectableCards(items, 'test-cb')
        return container
    }

    it('calls onChange with selected values when checkbox changes', () => {
        const items: SelectableCardItem[] = [
            { id: 'item-1', label: 'Item 1', details: 'x', checked: true, dataAttr: 'test-item', dataValue: 1 },
            { id: 'item-2', label: 'Item 2', details: 'y', checked: true, dataAttr: 'test-item', dataValue: 2 },
        ]
        const container = createContainer(items)
        const onChange = vi.fn()
        document.body.appendChild(container)

        bindSelectableCardEvents(container, 'test-cb', 'test-item', onChange)

        // Uncheck item-2
        const checkbox = container.querySelector('#item-2') as HTMLInputElement
        checkbox.checked = false
        checkbox.dispatchEvent(new Event('change'))

        expect(onChange).toHaveBeenCalledWith([1])
        document.body.removeChild(container)
    })

    it('calls onChange when clicking on a card item toggles checkbox', () => {
        const items: SelectableCardItem[] = [
            { id: 'item-1', label: 'Item 1', details: 'x', checked: true, dataAttr: 'test-item', dataValue: 1 },
        ]
        const container = createContainer(items)
        const onChange = vi.fn()
        document.body.appendChild(container)

        bindSelectableCardEvents(container, 'test-cb', 'test-item', onChange)

        // Click on the card item (not the checkbox directly)
        const cardItem = container.querySelector('.lap-checkbox-item') as HTMLElement
        cardItem.click()

        expect(onChange).toHaveBeenCalledWith([])
        document.body.removeChild(container)
    })

    it('updates selected class on items when checkbox changes', () => {
        const items: SelectableCardItem[] = [
            { id: 'item-1', label: 'Item 1', details: 'x', checked: true, dataAttr: 'test-item', dataValue: 1 },
        ]
        const container = createContainer(items)
        const onChange = vi.fn()
        document.body.appendChild(container)

        bindSelectableCardEvents(container, 'test-cb', 'test-item', onChange)

        const checkbox = container.querySelector('#item-1') as HTMLInputElement
        const cardItem = container.querySelector('.lap-checkbox-item') as HTMLElement
        expect(cardItem.classList.contains('selected')).toBe(true)

        checkbox.checked = false
        checkbox.dispatchEvent(new Event('change'))

        expect(cardItem.classList.contains('selected')).toBe(false)
        document.body.removeChild(container)
    })
})
