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

/**
 * Set up VE tab switching for the standard analysis panel.
 * Finds all .ve-tab-button elements and .ve-tab-content elements,
 * and wires click handlers that toggle active classes and invoke
 * optional render callbacks from the renderMap.
 *
 * This replaces setupGpsLapTabSwitching, setupOutAndBackTabSwitching,
 * and the inline tab block in the standard VE render path.
 */
export function setupTabSwitching(renderMap: TabRenderMap = {}): void {
    const tabButtons = document.querySelectorAll('.ve-tab-button')
    const showWindTab = !!document.getElementById('wind-tab')
    const showVdTab = !!document.getElementById('vd-tab')

    tabButtons.forEach(button => {
        const btn = button as HTMLButtonElement
        btn.addEventListener('click', (e) => {
            const target = e.currentTarget as HTMLElement
            const tabName = target.getAttribute('data-tab')
            if (!tabName) return

            // Update button active states
            tabButtons.forEach(b => b.classList.remove('active'))
            target.classList.add('active')

            // Update tab content active states
            document.querySelectorAll('.ve-tab-content').forEach(content => {
                content.classList.remove('active')
            })
            document.getElementById(`${tabName}-tab`)?.classList.add('active')

            // Invoke tab-specific render callback if available
            if (tabName === 'wind' && showWindTab && renderMap.wind) {
                log.debug('Tab switching: rendering wind tab')
                renderMap.wind()
            } else if (tabName === 'power' && renderMap.power) {
                log.debug('Tab switching: rendering power tab')
                renderMap.power()
            } else if (tabName === 'vd' && showVdTab && renderMap.vd) {
                log.debug('Tab switching: rendering virtual distance tab')
                renderMap.vd()
            } else if (tabName === 've' && renderMap.ve) {
                log.debug('Tab switching: rendering VE tab')
                renderMap.ve()
            }
        })
    })
}
