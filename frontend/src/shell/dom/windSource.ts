import { log } from '../../utils/log'
import type { WindSource } from '../../state/AppState'
import { syncWindHeightControlsVisibility } from '../ve/windHeightControls'
import { syncFitWindControlsVisibility } from '../ve/windSourceVisibility'

const WIND_SOURCES: readonly string[] = ['fit', 'constant', 'compare', 'none']

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
 * Narrow a raw radio `value` to the WindSource union, CHECKED rather than cast.
 *
 * The value is whatever the template's `value=` attribute says, so a typo there
 * — or a future fourth radio nobody added to the union — produced a string the
 * primitive treats as "not compare, not constant" (`updateModeVEPlots.ts:136`)
 * and handed unchecked to `resolveWindSeries`, silently. A cast at the call site
 * cannot catch that, because a cast is exactly the thing that erases the check.
 */
export function toWindSource(value: string): WindSource {
    if (WIND_SOURCES.includes(value)) {
        return value as WindSource
    }
    log.error(`Unknown wind source "${value}" on the checked radio; falling back to "fit".`)
    return 'fit'
}

/**
 * Bind change event listeners to all wind-source radio buttons.
 * When any radio changes, the onChange callback is invoked.
 *
 * This replaces the 3 identical wind-source binding blocks
 * in standard VE, GPS-lap, and out-and-back renderers.
 *
 * It also owns the visibility of every control whose meaning depends on the
 * source, because it is the one place all three sidebars already agree on.
 * Putting the syncs here rather than in three per-mode handlers means a mode
 * cannot be missed, and it covers the two different ways the state can go
 * stale: at bind time, and on every change while the panel stays open.
 *
 * Two syncs, opposite directions, same defect class — a control that is bound
 * and responsive while the physics ignores it:
 *
 * - the wind-height (k) block is inert under FIT and hidden there
 *   (windHeightAppliesTo);
 * - the FIT-only blocks — air-speed offset, air-speed calibration and Auto
 *   Adjust, plus the VD tab in the sidebars that tag it — are inert under
 *   constant and hidden there (fitWindControlsApplyTo).
 *
 * The syncs run before onChange so a recompute starts from the settled state,
 * and they run outside the radio loop so they still fire in the sidebars that
 * render no wind-source radios at all.
 *
 * RETURNS whether any radio was actually bound — a ride with neither a FIT
 * air-speed channel nor a configured constant wind renders no radio group, and
 * `bindModeControls` reports that row as skipped rather than as bound.
 */
export function bindWindSourceRadios(onChange: () => void): boolean {
    syncWindHeightControlsVisibility(getSelectedWindSource())
    syncFitWindControlsVisibility(getSelectedWindSource())
    const radios = document.querySelectorAll('input[name="windSource"]')
    radios.forEach(radio => {
        radio.addEventListener('change', () => {
            const selected = getSelectedWindSource()
            log.debug('Wind source changed:', selected)
            syncWindHeightControlsVisibility(selected)
            syncFitWindControlsVisibility(selected)
            onChange()
        })
    })
    return radios.length > 0
}
