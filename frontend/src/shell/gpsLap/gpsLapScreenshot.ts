/**
 * GPS-lap screenshot functionality.
 */
import { log } from '../../utils/log';

/**
 * Save GPS lap VE plot as screenshot
 */
export async function saveGpsLapScreenshot(
    waitForPlotly: () => Promise<any>,
) {
    const plotElement = document.getElementById('gpsLapVePlot');
    if (!plotElement) return;

    try {
        const Plotly = await waitForPlotly();
        const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
        await Plotly.downloadImage('gpsLapVePlot', {
            format: 'png',
            width: 1200,
            height: 600,
            filename: `gps-lap-ve-${timestamp}`
        });
    } catch (err) {
        log.error('Failed to save screenshot:', err);
    }
}
