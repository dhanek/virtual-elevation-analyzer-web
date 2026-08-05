import { log } from '../../utils/log'

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
    document.getElementById(`${tabName}-tab`)?.classList.add('ve-tab-content--active')

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
}

function handleTabClick(e: Event): void {
    const target = e.currentTarget as HTMLElement
    const tabName = target.getAttribute('data-tab')
    if (!tabName) return
    activateTab(tabName)
}

/**
 * Set up VE tab switching for the standard analysis panel.
 * Finds all .ve-tab-button elements and .ve-tab-content elements,
 * and wires click handlers that toggle active classes and invoke
 * optional render callbacks from the renderMap.
 *
 * Idempotent: each button is bound exactly once, and repeated calls only swap in
 * the latest renderMap. This lets the GPS-lap recompute path refresh its tab
 * callbacks on every slider update without leaking click handlers.
 *
 * This replaces setupGpsLapTabSwitching, setupOutAndBackTabSwitching,
 * and the inline tab block in the standard VE render path.
 */
export function setupTabSwitching(renderMap: TabRenderMap = {}): void {
    currentRenderMap = renderMap

    document.querySelectorAll('.ve-tab-button').forEach(button => {
        if (boundButtons.has(button)) return
        boundButtons.add(button)
        button.addEventListener('click', handleTabClick)
    })
}
