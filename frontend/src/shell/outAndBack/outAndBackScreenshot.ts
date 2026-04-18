/**
 * Out-and-back screenshot functionality.
 */
import { log } from '../../utils/log';

/**
 * Save Out and Back VE plot as screenshot
 */
export async function saveOutAndBackScreenshot(
    waitForPlotly: () => Promise<any>,
) {
    const plotElement = document.getElementById('oabVePlot');
    if (!plotElement) return;

    try {
        const Plotly = await waitForPlotly();
        const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
        await Plotly.downloadImage('oabVePlot', {
            format: 'png',
            width: 1200,
            height: 600,
            filename: `out-and-back-ve-${timestamp}`
        });
    } catch (err) {
        log.error('Failed to save screenshot:', err);
    }
}
