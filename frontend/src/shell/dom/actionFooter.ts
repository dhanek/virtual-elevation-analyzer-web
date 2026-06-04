import { log } from '../../utils/log'

/**
 * Callbacks for the action footer buttons.
 */
export interface ActionFooterCallbacks {
    onSaveScreenshot: () => void
    onStoreResult: () => void
    onExportAll: () => void
}

/**
 * Bind click handlers to the save/store/export action footer buttons.
 * Only binds to elements that actually exist in the DOM.
 *
 * This replaces the 3 identical footer-binding blocks in
 * standard VE, GPS-lap, and out-and-back renderers.
 */
export function bindActionFooter(callbacks: ActionFooterCallbacks): void {
    const screenshotBtn = document.getElementById('saveScreenshot')
    if (screenshotBtn) {
        screenshotBtn.addEventListener('click', () => {
            log.debug('Action footer: saveScreenshot clicked')
            callbacks.onSaveScreenshot()
        })
    }

    const storeBtn = document.getElementById('storeResult')
    if (storeBtn) {
        storeBtn.addEventListener('click', () => {
            log.debug('Action footer: storeResult clicked')
            callbacks.onStoreResult()
        })
    }

    const exportBtn = document.getElementById('exportAllResults')
    if (exportBtn) {
        exportBtn.addEventListener('click', () => {
            log.debug('Action footer: exportAllResults clicked')
            callbacks.onExportAll()
        })
    }
}
