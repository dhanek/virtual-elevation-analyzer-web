import { log } from '../../utils/log'

/**
 * Callbacks for the action footer buttons.
 */
export interface ActionFooterCallbacks {
    onSaveScreenshot: () => void
    onStoreResult: () => void
    onExportAll: () => void
    /**
     * Optional so the three sidebars can adopt the button independently, and so
     * a panel that never renders one is not forced to pass a no-op.
     */
    onShowAllResults?: () => void
    /** Settings export pair; optional for the same reason as above. */
    onExportSettings?: () => void
    onExportBundle?: () => void
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

    const showAllBtn = document.getElementById('showAllResults')
    if (showAllBtn && callbacks.onShowAllResults) {
        const onShowAllResults = callbacks.onShowAllResults
        showAllBtn.addEventListener('click', () => {
            log.debug('Action footer: showAllResults clicked')
            onShowAllResults()
        })
    }

    const exportBtn = document.getElementById('exportAllResults')
    if (exportBtn) {
        exportBtn.addEventListener('click', () => {
            log.debug('Action footer: exportAllResults clicked')
            callbacks.onExportAll()
        })
    }

    const exportSettingsBtn = document.getElementById('exportSettingsJson')
    if (exportSettingsBtn && callbacks.onExportSettings) {
        const onExportSettings = callbacks.onExportSettings
        exportSettingsBtn.addEventListener('click', () => {
            log.debug('Action footer: exportSettingsJson clicked')
            onExportSettings()
        })
    }

    const exportBundleBtn = document.getElementById('exportBundleZip')
    if (exportBundleBtn && callbacks.onExportBundle) {
        const onExportBundle = callbacks.onExportBundle
        exportBundleBtn.addEventListener('click', () => {
            log.debug('Action footer: exportBundleZip clicked')
            onExportBundle()
        })
    }
}
