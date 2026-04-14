import { log } from '../../utils/log'

/**
 * Data shape for a selectable checkbox-card item.
 * Used for FIT laps, GPS detected laps, and out-and-back sections.
 */
export interface SelectableCardItem {
    id: string
    label: string
    details: string
    checked: boolean
    dataAttr: string
    dataValue: string | number
}

/**
 * Render selectable checkbox-card items as an HTML string.
 * Returns the same .lap-checkbox-item / .lap-info / .lap-number / .lap-details
 * DOM structure used by the existing main.ts card lists.
 *
 * @param items - Card data to render
 * @param cssClass - CSS class for the checkbox input (e.g. 'gps-lap-checkbox')
 * @returns HTML string of checkbox-card items, or empty string for empty input
 */
export function renderSelectableCards(items: SelectableCardItem[], cssClass: string): string {
    if (items.length === 0) return ''

    return items
        .map(item => {
            const selectedClass = item.checked ? ' selected' : ''
            const checkedAttr = item.checked ? ' checked' : ''
            return `<div class="lap-checkbox-item${selectedClass}" data-${item.dataAttr}="${item.dataValue}">
            <input type="checkbox" class="${cssClass}" id="${item.id}"${checkedAttr}>
            <div class="lap-info">
                <div class="lap-number">${item.label}</div>
                <div class="lap-details">${item.details}</div>
            </div>
        </div>`
        })
        .join('')
}

/**
 * Bind change and click event handlers on selectable card items within a container.
 * Replaces the three nearly-identical binding blocks for GPS laps, out-and-back
 * sections, and FIT laps in main.ts.
 *
 * @param container - Parent element containing rendered cards
 * @param checkboxClass - CSS class to find checkboxes (e.g. 'gps-lap-checkbox')
 * @param dataAttr - Data attribute name to read selected values from (e.g. 'gps-lap')
 * @param onChange - Callback receiving array of selected numeric values
 */
export function bindSelectableCardEvents(
    container: HTMLElement,
    checkboxClass: string,
    dataAttr: string,
    onChange: (selectedValues: number[]) => void,
): void {
    const dataSelector = `data-${dataAttr}`

    function collectSelected(): number[] {
        const checked = container.querySelectorAll(`.${checkboxClass}:checked`) as NodeListOf<HTMLInputElement>
        return Array.from(checked)
            .map(cb => {
                const item = cb.closest('.lap-checkbox-item')
                return item ? parseInt(item.getAttribute(dataSelector) || '0', 10) : 0
            })
            .filter(v => v > 0)
    }

    function updateVisualState(): void {
        container.querySelectorAll(`.lap-checkbox-item[${dataSelector}]`).forEach(item => {
            const checkbox = item.querySelector(`.${checkboxClass}`) as HTMLInputElement | null
            if (checkbox?.checked) {
                item.classList.add('selected')
            } else {
                item.classList.remove('selected')
            }
        })
    }

    function handleChange(): void {
        const selected = collectSelected()
        updateVisualState()
        log.debug(`Selectable cards [${dataAttr}] selection changed:`, selected)
        onChange(selected)
    }

    // Bind checkbox change events
    container.querySelectorAll(`.${checkboxClass}`).forEach(checkbox => {
        checkbox.addEventListener('change', handleChange)
    })

    // Bind click handlers on card items to toggle their checkbox
    container.querySelectorAll('.lap-checkbox-item').forEach(item => {
        item.addEventListener('click', (e) => {
            const target = e.target as Element
            if (!target.classList.contains(checkboxClass)) {
                const checkbox = item.querySelector(`.${checkboxClass}`) as HTMLInputElement | null
                if (checkbox) {
                    checkbox.checked = !checkbox.checked
                    handleChange()
                }
            }
        })
    })
}
