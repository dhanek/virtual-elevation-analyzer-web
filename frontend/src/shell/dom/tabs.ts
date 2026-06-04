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

function handleTabClick(e: Event): void {
    const target = e.currentTarget as HTMLElement
    const tabName = target.getAttribute('data-tab')
    if (!tabName) return

    // Update button active states (re-query in case the DOM changed)
    document.querySelectorAll('.ve-tab-button').forEach(b => b.classList.remove('active'))
    target.classList.add('active')

    // Update tab content active states
    document.querySelectorAll('.ve-tab-content').forEach(content => {
        content.classList.remove('active')
    })
    document.getElementById(`${tabName}-tab`)?.classList.add('active')

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
