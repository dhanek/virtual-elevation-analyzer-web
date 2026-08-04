import { log } from '../../utils/log'
import { syncWindHeightControlsVisibility } from '../ve/windHeightControls'

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
 *
 * It also owns the wind-height (k) control's visibility, because it is the one
 * place all three sidebars already agree on. The control only means something
 * when the wind is modelled from a 10 m reference — see windHeightAppliesTo —
 * and was previously rendered unconditionally, so it sat visible and inert
 * under FIT wind in every mode. Putting the sync here rather than in three
 * per-mode handlers means a mode cannot be missed, and it covers the two
 * different ways the state can go stale:
 *
 * - at bind time, because GPS-lap and out-and-back answer a source change by
 *   re-rendering the whole sidebar (recalculateGpsLapVE -> showGpsLapVEAnalysis),
 *   which replaces the element and re-runs this binder;
 * - on change, because Standard keeps the same DOM and only redraws plots, so
 *   nothing else would revisit the control while the panel is open.
 *
 * The sync runs before onChange so a re-render triggered by the recompute
 * starts from the settled state, and it runs outside the radio loop so it still
 * fires in the sidebars that render no wind-source radios at all.
 */
export function bindWindSourceRadios(onChange: () => void): void {
    syncWindHeightControlsVisibility(getSelectedWindSource())
    const radios = document.querySelectorAll('input[name="windSource"]')
    radios.forEach(radio => {
        radio.addEventListener('change', () => {
            const selected = getSelectedWindSource()
            log.debug('Wind source changed:', selected)
            syncWindHeightControlsVisibility(selected)
            onChange()
        })
    })
}
