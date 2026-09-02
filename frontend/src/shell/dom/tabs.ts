import { log } from '../../utils/log'
import { resizePlotlyGraphsIn } from './plotlyResize'

/**
 * Callbacks for rendering tab-specific content.
 * Each key matches a tab name from the data-tab attribute.
 */
export interface TabRenderMap {
    wind?: () => void
    power?: () => void
    vd?: () => void
    ve?: () => void
}

// Latest render callbacks. Kept in a module ref so repeated setupTabSwitching
// calls (e.g. on every slider recompute) refresh the callbacks without binding
// additional click handlers. Only one VE panel is live at a time.
let currentRenderMap: TabRenderMap = {}

// Buttons that already have the single click handler bound. A WeakSet lets old
// button nodes (discarded when the panel HTML is rebuilt) be garbage-collected,
// so rebuilt panels get freshly bound while in-place recomputes do not.
const boundButtons = new WeakSet<Element>()

/**
 * Make one tab the active one, exactly as a click on its button would.
 *
 * Exported because a click is no longer the only way a tab becomes active.
 * `syncFitWindControlsVisibility` hides the VD tab when the wind source is
 * constant, and `.ve-tab-content--active` and `[hidden]` are different axes —
 * a hidden pane that is still the active one leaves the panel showing nothing
 * at all. The guard needs to move the user, and it must move them the same way
 * a click does, render callback included, or the tab it moves them to would be
 * active-but-undrawn.
 */
export function activateTab(tabName: string): void {
    // Update button active states (re-query in case the DOM changed)
    document.querySelectorAll('.ve-tab-button').forEach(b => b.classList.remove('ve-tab-button--active'))
    document.querySelector(`.ve-tab-button[data-tab="${tabName}"]`)?.classList.add('ve-tab-button--active')

    // Update tab content active states
    document.querySelectorAll('.ve-tab-content').forEach(content => {
        content.classList.remove('ve-tab-content--active')
    })
    const pane = document.getElementById(`${tabName}-tab`)
    pane?.classList.add('ve-tab-content--active')

    const showWindTab = !!document.getElementById('wind-tab')
    const showVdTab = !!document.getElementById('vd-tab')

    // Invoke tab-specific render callback from the latest renderMap if available
    if (tabName === 'wind' && showWindTab && currentRenderMap.wind) {
        log.debug('Tab switching: rendering wind tab')
        currentRenderMap.wind()
    } else if (tabName === 'power' && currentRenderMap.power) {
        log.debug('Tab switching: rendering power tab')
        currentRenderMap.power()
    } else if (tabName === 'vd' && showVdTab && currentRenderMap.vd) {
        log.debug('Tab switching: rendering virtual distance tab')
        currentRenderMap.vd()
    } else if (tabName === 've' && currentRenderMap.ve) {
        log.debug('Tab switching: rendering VE tab')
        currentRenderMap.ve()
    }

    // The pane is visible now and its plots have been redrawn, so this is the
    // first moment any of them can be measured against a real container width.
    // Every plot outside the VE tab is drawn while its pane is `display: none`,
    // where Plotly measures zero and pins its 700 px default; see
    // `resizePlotlyGraphsIn`.
    if (pane) resizePlotlyGraphsIn(pane)
}

/**
 * The tab that is currently active, or null when no panel is rendered.
 *
 * Exported for the x-axis toggle, which repaints the tab the user is looking at
 * and leaves the other three to the render map. Reads the DOM rather than a
 * module variable on purpose: `activateTab` is not the only thing that moves
 * the active class (the wind-source guard does too), and a second copy of that
 * state is a second thing to get out of step.
 */
export function getActiveTabName(): string | null {
    const pane = document.querySelector('.ve-tab-content--active')
    const id = pane?.id
    if (!id || !id.endsWith('-tab')) return null
    return id.slice(0, -'-tab'.length)
}

function handleTabClick(e: Event): void {
    const target = e.currentTarget as HTMLElement
    const tabName = target.getAttribute('data-tab')
    if (!tabName) return
    activateTab(tabName)
}

/**
 * Bind the click handler to every tab button that does not already have one.
 *
 * SEPARATE FROM THE RENDER MAP, and that separation is the whole point (WR-13).
 * These were one function, so a caller that only wanted the buttons live had to
 * call `setupTabSwitching()` with no argument — which defaulted `renderMap` to
 * `{}` and WIPED whatever map was installed. `renderStandardVe` did exactly
 * that, and only escaped it because `scheduleRecompute` defers to a macrotask
 * so the real map landed afterwards. On any path where the scheduled pass never
 * reached `renderVe`, Wind/Power/VD were dead for the panel's lifetime.
 *
 * Idempotent: a button is bound exactly once. Safe to call on every render.
 */
export function bindTabButtons(): void {
    document.querySelectorAll('.ve-tab-button').forEach(button => {
        if (boundButtons.has(button)) return
        boundButtons.add(button)
        button.addEventListener('click', handleTabClick)
    })
}

/**
 * Install the callbacks the next tab activation renders through.
 *
 * Replaces the map wholesale rather than merging: only one VE panel is live at
 * a time, and merging would leak a previous mode's callbacks into it — a
 * GPS-lap `vd` renderer surviving into a fresh Standard panel would draw the
 * wrong thing rather than nothing.
 */
export function setTabRenderMap(renderMap: TabRenderMap = {}): void {
    currentRenderMap = renderMap
}

/**
 * Drop the render map because the panel it belonged to is being replaced.
 *
 * CALL THIS WHERE THE PANEL MARKUP IS REBUILT, next to the
 * `veAnalysisContent.innerHTML = ...` assignment — not near the recompute.
 *
 * The map's callbacks close over a specific `profiles` array
 * (`bindStandardSliders.ts:241`) and draw into element ids that every panel
 * reuses. Once the markup is replaced they describe data the user is no longer
 * looking at, so leaving them installed means Wind/Power/VD render the PREVIOUS
 * selection into the new panel whenever the first scheduled pass does not reach
 * `renderVe` — every segment under MIN_SEGMENT_SAMPLES, every calculator
 * throwing, a trim window at its clamp.
 *
 * Same effect as `setTabRenderMap({})`, named separately because the call site
 * is a lifecycle boundary rather than an installation: a reader at the
 * `innerHTML` line should not have to work out why an empty map is being
 * installed there.
 */
export function resetTabRenderMapForNewPanel(): void {
    currentRenderMap = {}
}

/**
 * Set up VE tab switching for the standard analysis panel: bind the buttons and
 * install the render map in one call.
 *
 * Retained because the recompute paths legitimately want both on every pass —
 * they rebuild the panel and hand over fresh callbacks together. A caller that
 * wants ONLY the buttons must use `bindTabButtons`; calling this one bare still
 * resets the map to `{}`, which is what WR-13 was about.
 *
 * This replaces setupGpsLapTabSwitching, setupOutAndBackTabSwitching,
 * and the inline tab block in the standard VE render path.
 */
export function setupTabSwitching(renderMap: TabRenderMap = {}): void {
    setTabRenderMap(renderMap)
    bindTabButtons()
}
