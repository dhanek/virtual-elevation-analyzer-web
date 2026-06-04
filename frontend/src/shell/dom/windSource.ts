import { log } from '../../utils/log'

/**
 * Get the currently selected wind source radio value.
 * Queries input[name="windSource"]:checked and returns its value.
 * Falls back to 'fit' if nothing is selected.
 *
 * This replaces the 13 scattered inline queries for the checked wind source.
 */
export function getSelectedWindSource(): string {
    const checked = document.querySelector('input[name="windSource"]:checked') as HTMLInputElement | null
    return checked?.value ?? 'fit'
}

/**
 * Bind change event listeners to all wind-source radio buttons.
 * When any radio changes, the onChange callback is invoked.
 *
 * This replaces the 3 identical wind-source binding blocks
 * in standard VE, GPS-lap, and out-and-back renderers.
 */
export function bindWindSourceRadios(onChange: () => void): void {
    const radios = document.querySelectorAll('input[name="windSource"]')
    radios.forEach(radio => {
        radio.addEventListener('change', () => {
            log.debug('Wind source changed:', getSelectedWindSource())
            onChange()
        })
    })
}
