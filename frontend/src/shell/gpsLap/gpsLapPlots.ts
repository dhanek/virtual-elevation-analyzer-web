/**
 * GPS-lap VE plot rendering and statistics.
 *
 * Verbatim lift from main.ts -- rendering logic for GPS-lap mode plots.
 */
import type { LapVEProfile } from './types';
import {
    buildMultiSegmentWindFigure,
    buildMultiSegmentPowerFigure,
    buildMultiSegmentVirtualDistanceFigure,
} from '../../plots/MultiSegmentPlotBuilders';
import { formatLapDuration } from '../../utils/GpsLapDetection';

// Plotly.js type declaration
declare const Plotly: any;

/**
 * Color palette for stacked lap plots (genuine GPS and standard "Stacked").
 * Scoped to the stacked VE graph only — stitched/standard plots are unaffected.
 */
export const STACKED_LAP_COLORS = [
    '#e41a1c',
    '#377eb8',
    '#4daf4a',
    '#984ea3',
    '#ff7f00',
    '#ffff33',
    '#a65628',
    '#f781bf',
    '#999999',
];

/**
 * Map a lap to its color by its position in the selected set, so a selection of
 * laps 2/4/6 picks the first three palette colors. Because both stacked modes
 * render through the same path, the same selection yields the same colors in
 * each.
 */
export function stackedLapColor(index: number): string {
    const wrapped = ((index % STACKED_LAP_COLORS.length) + STACKED_LAP_COLORS.length) % STACKED_LAP_COLORS.length;
    return STACKED_LAP_COLORS[wrapped];
}

/**
 * Calculate mean actual elevation profile across all laps
 */
export function calculateMeanElevationProfile(lapProfiles: LapVEProfile[]): { distances: number[]; elevation: number[] } {
    if (lapProfiles.length === 0) {
        return { distances: [], elevation: [] };
    }

    // Find maximum lap distance
    let maxDistance = 0;
    for (const lap of lapProfiles) {
        const lapMax = lap.distances[lap.distances.length - 1];
        if (lapMax > maxDistance) maxDistance = lapMax;
    }

    // Create reference distance array with ~10m intervals
    const numPoints = Math.max(100, Math.floor(maxDistance * 100)); // 10m resolution
    const referenceDistances: number[] = [];
    for (let i = 0; i <= numPoints; i++) {
        referenceDistances.push((i / numPoints) * maxDistance);
    }

    // Accumulate elevation values
    const elevationSum = new Array(referenceDistances.length).fill(0);
    const elevationCount = new Array(referenceDistances.length).fill(0);

    for (const lap of lapProfiles) {
        // Interpolate this lap's elevation onto the reference distances
        for (let i = 0; i < referenceDistances.length; i++) {
            const targetDist = referenceDistances[i];

            // Only interpolate within this lap's range
            if (targetDist > lap.distances[lap.distances.length - 1]) continue;

            // Find bracketing points
            let lowIdx = 0;
            for (let j = 0; j < lap.distances.length - 1; j++) {
                if (lap.distances[j] <= targetDist && lap.distances[j + 1] >= targetDist) {
                    lowIdx = j;
                    break;
                }
            }

            // Linear interpolation
            const d0 = lap.distances[lowIdx];
            const d1 = lap.distances[lowIdx + 1] || d0;
            const e0 = lap.actualElevation[lowIdx];
            const e1 = lap.actualElevation[lowIdx + 1] || e0;

            const t = (d1 !== d0) ? (targetDist - d0) / (d1 - d0) : 0;
            const interpolatedElevation = e0 + t * (e1 - e0);

            if (!isNaN(interpolatedElevation)) {
                elevationSum[i] += interpolatedElevation;
                elevationCount[i]++;
            }
        }
    }

    // Calculate mean
    const meanElevation: number[] = [];
    for (let i = 0; i < referenceDistances.length; i++) {
        if (elevationCount[i] > 0) {
            meanElevation.push(elevationSum[i] / elevationCount[i]);
        } else {
            // Use previous value or 0
            meanElevation.push(meanElevation.length > 0 ? meanElevation[meanElevation.length - 1] : 0);
        }
    }

    return { distances: referenceDistances, elevation: meanElevation };
}

/**
 * Calculate statistics for GPS lap VE analysis
 */
export function calculateGpsLapStats(
    lapProfiles: LapVEProfile[],
    meanElevation: { distances: number[]; elevation: number[] }
): { meanR2: number; meanRMSE: number; avgVeGain: number; avgActualGain: number; closingError: number; lapClosingErrors: number[] } {
    if (lapProfiles.length === 0) {
        return { meanR2: 0, meanRMSE: 0, avgVeGain: 0, avgActualGain: 0, closingError: 0, lapClosingErrors: [] };
    }

    let totalR2 = 0;
    let totalRMSE = 0;
    let totalVeGain = 0;
    let totalActualGain = 0;
    const lapClosingErrors: number[] = [];  // Per-lap closing errors

    for (const lap of lapProfiles) {
        // Calculate R2 and RMSE for this lap against mean elevation
        let sumSquaredResiduals = 0;
        let sumSquaredTotal = 0;
        const startElevation = meanElevation.elevation.length > 0 ? meanElevation.elevation[0] : 0;
        const veOffset = lap.virtualElevation[0] - startElevation;
        const calibratedVE = lap.virtualElevation.map(v => v - veOffset);

        // Calculate VE gain for this lap (end - start of calibrated VE)
        // For GPS laps, this should be ~0 since we return to the same point
        let lapVeChange = 0;
        if (calibratedVE.length > 1) {
            lapVeChange = calibratedVE[calibratedVE.length - 1] - calibratedVE[0];
            totalVeGain += lapVeChange;
        }
        lapClosingErrors.push(lapVeChange);

        // Calculate actual elevation gain for this lap
        if (lap.actualElevation.length > 1) {
            totalActualGain += lap.actualElevation[lap.actualElevation.length - 1] - lap.actualElevation[0];
        }

        // Interpolate mean elevation at each lap distance point
        let meanElevSum = 0;
        let count = 0;
        for (let i = 0; i < lap.distances.length; i++) {
            const dist = lap.distances[i];
            let interpMeanElev = 0;
            for (let k = 0; k < meanElevation.distances.length - 1; k++) {
                if (meanElevation.distances[k] <= dist && meanElevation.distances[k + 1] >= dist) {
                    const t = (dist - meanElevation.distances[k]) /
                              (meanElevation.distances[k + 1] - meanElevation.distances[k]);
                    interpMeanElev = meanElevation.elevation[k] + t *
                                     (meanElevation.elevation[k + 1] - meanElevation.elevation[k]);
                    break;
                }
            }
            const residual = calibratedVE[i] - interpMeanElev;
            sumSquaredResiduals += residual * residual;
            meanElevSum += interpMeanElev;
            count++;
        }

        const meanMeanElev = count > 0 ? meanElevSum / count : 0;
        for (let i = 0; i < lap.distances.length; i++) {
            const dist = lap.distances[i];
            let interpMeanElev = 0;
            for (let k = 0; k < meanElevation.distances.length - 1; k++) {
                if (meanElevation.distances[k] <= dist && meanElevation.distances[k + 1] >= dist) {
                    const t = (dist - meanElevation.distances[k]) /
                              (meanElevation.distances[k + 1] - meanElevation.distances[k]);
                    interpMeanElev = meanElevation.elevation[k] + t *
                                     (meanElevation.elevation[k + 1] - meanElevation.elevation[k]);
                    break;
                }
            }
            sumSquaredTotal += Math.pow(interpMeanElev - meanMeanElev, 2);
        }

        const r2 = sumSquaredTotal > 0 ? 1 - (sumSquaredResiduals / sumSquaredTotal) : 0;
        const rmse = count > 0 ? Math.sqrt(sumSquaredResiduals / count) : 0;

        totalR2 += Math.max(0, r2); // Clamp negative R2 to 0
        totalRMSE += rmse;
    }

    // Also calculate mean elevation gain from the mean profile
    let meanProfileGain = 0;
    if (meanElevation.elevation.length > 1) {
        meanProfileGain = meanElevation.elevation[meanElevation.elevation.length - 1] - meanElevation.elevation[0];
    }

    // Calculate closing error as sum of absolute VE changes per lap
    // For GPS laps, each lap should return to 0, so any deviation is an error
    const closingError = lapClosingErrors.reduce((sum, err) => sum + Math.abs(err), 0);

    return {
        meanR2: totalR2 / lapProfiles.length,
        meanRMSE: totalRMSE / lapProfiles.length,
        avgVeGain: totalVeGain / lapProfiles.length,
        avgActualGain: meanProfileGain,  // Use mean profile gain as the reference
        closingError: closingError,
        lapClosingErrors: lapClosingErrors
    };
}

/**
 * Render GPS lap VE plots (extracted for reuse during recalculation)
 */
export function renderGpsLapVEPlots(
    lapProfiles: LapVEProfile[],
    meanElevation: { distances: number[]; elevation: number[] }
) {
    const PlotlyGlobal = (window as any).Plotly;
    if (!PlotlyGlobal) return;

    // Find maximum distance for axis
    let maxDist = 0;
    for (const lap of lapProfiles) {
        const lapMax = lap.distances[lap.distances.length - 1];
        if (lapMax > maxDist) maxDist = lapMax;
    }

    // Build plot traces
    const veTraces: any[] = [];
    const residualTraces: any[] = [];

    // Add mean elevation trace (dashed black line)
    if (meanElevation.distances.length > 0) {
        veTraces.push({
            x: meanElevation.distances,
            y: meanElevation.elevation,
            mode: 'lines',
            name: 'Mean Elevation',
            line: { color: 'black', dash: 'dash', width: 2 }
        });
    }

    // Add VE traces for each lap
    for (let i = 0; i < lapProfiles.length; i++) {
        const lap = lapProfiles[i];
        const color = stackedLapColor(i);

        // Calibrate VE to match mean elevation at start
        const startElevation = meanElevation.elevation.length > 0 ? meanElevation.elevation[0] : 0;
        const veOffset = lap.virtualElevation[0] - startElevation;
        const calibratedVE = lap.virtualElevation.map(v => v - veOffset);

        // VE trace
        veTraces.push({
            x: lap.distances,
            y: calibratedVE,
            mode: 'lines',
            name: `Lap ${lap.lapNumber}`,
            line: { color: color, width: 3 }
        });

        // Calculate residuals (VE - interpolated mean elevation)
        const residuals: number[] = [];
        const residualDistances: number[] = [];

        for (let j = 0; j < lap.distances.length; j++) {
            const dist = lap.distances[j];
            // Interpolate mean elevation at this distance
            let meanElev = 0;
            if (meanElevation.distances.length > 0) {
                for (let k = 0; k < meanElevation.distances.length - 1; k++) {
                    if (meanElevation.distances[k] <= dist && meanElevation.distances[k + 1] >= dist) {
                        const t = (dist - meanElevation.distances[k]) /
                                  (meanElevation.distances[k + 1] - meanElevation.distances[k]);
                        meanElev = meanElevation.elevation[k] + t *
                                   (meanElevation.elevation[k + 1] - meanElevation.elevation[k]);
                        break;
                    }
                }
            }
            residuals.push(calibratedVE[j] - meanElev);
            residualDistances.push(dist);
        }

        // Residual trace
        residualTraces.push({
            x: residualDistances,
            y: residuals,
            mode: 'lines',
            name: `Lap ${lap.lapNumber}`,
            line: { color: color, width: 2 },
            showlegend: false
        });
    }

    // Main VE plot layout
    const veLayout = {
        title: 'Virtual Elevation by Lap',
        xaxis: {
            title: 'Distance from Gate (km)',
            range: [0, maxDist]
        },
        yaxis: {
            title: 'Elevation (m)'
        },
        legend: {
            orientation: 'h',
            y: -0.2
        },
        margin: { t: 40, b: 80, l: 60, r: 20 },
        hovermode: 'closest'
    };

    // Residual plot layout
    const residualLayout = {
        title: 'VE Residuals (VE - Mean Elevation)',
        xaxis: {
            title: 'Distance from Gate (km)',
            range: [0, maxDist]
        },
        yaxis: {
            title: 'Residual (m)'
        },
        margin: { t: 40, b: 60, l: 60, r: 20 },
        hovermode: 'closest',
        shapes: [{
            type: 'line',
            x0: 0,
            x1: maxDist,
            y0: 0,
            y1: 0,
            line: { color: 'black', width: 1 }
        }]
    };

    // Render plots in-place. Plotly.react initializes the div on first call and
    // diffs on subsequent calls, so slider-driven recomputes update smoothly
    // without the full teardown/rebuild that Plotly.newPlot performs.
    PlotlyGlobal.react('gpsLapVePlot', veTraces, veLayout, { responsive: true });
    PlotlyGlobal.react('gpsLapResidualPlot', residualTraces, residualLayout, { responsive: true });

    // Update statistics
    const stats = calculateGpsLapStats(lapProfiles, meanElevation);
    const r2Span = document.getElementById('gpsLapR2Value');
    const rmseSpan = document.getElementById('gpsLapRmseValue');
    const closingErrorSpan = document.getElementById('gpsLapClosingErrorValue');
    if (r2Span) r2Span.textContent = stats.meanR2.toFixed(4);
    if (rmseSpan) rmseSpan.textContent = stats.meanRMSE.toFixed(2) + 'm';
    if (closingErrorSpan) closingErrorSpan.textContent = stats.closingError.toFixed(2) + 'm';

    // Populate lap summary table
    const summaryTable = document.getElementById('gpsLapSummaryTable');
    if (summaryTable) {
        const rows = lapProfiles.map((lap, i) => {
            const color = stackedLapColor(i);
            const avgSpeed = lap.totalDistance / (lap.duration / 3600); // km/h
            return `<tr style="border-bottom: 1px solid #e2e8f0;">
                    <td style="padding: 0.5rem;">
                        <span style="display: inline-block; width: 12px; height: 12px; background: ${color}; border-radius: 2px; margin-right: 0.5rem;"></span>
                        Lap ${lap.lapNumber}
                    </td>
                    <td style="text-align: right; padding: 0.5rem;">${formatLapDuration(lap.duration)}</td>
                    <td style="text-align: right; padding: 0.5rem;">${lap.totalDistance.toFixed(2)} km</td>
                    <td style="text-align: right; padding: 0.5rem;">${avgSpeed.toFixed(1)} km/h</td>
                </tr>`;
        }).join('');

        const tableHtml = `<table style="width: 100%; border-collapse: collapse; font-size: 0.85rem;">
                <thead>
                    <tr style="border-bottom: 2px solid #e2e8f0;">
                        <th style="text-align: left; padding: 0.5rem;">Lap</th>
                        <th style="text-align: right; padding: 0.5rem;">Duration</th>
                        <th style="text-align: right; padding: 0.5rem;">Distance</th>
                        <th style="text-align: right; padding: 0.5rem;">Avg Speed</th>
                    </tr>
                </thead>
                <tbody>${rows}</tbody></table>`;
        summaryTable.innerHTML = tableHtml;
    }
}

/**
 * Render stacked Wind plot for GPS lap mode
 */
export function renderGpsLapWindPlot(lapProfiles: LapVEProfile[]) {
    const PlotlyGlobal = (window as any).Plotly;
    if (!PlotlyGlobal) return;

    const plotDiv = document.getElementById('gpsLapWindPlot');
    if (!plotDiv) return;

    const figure = buildMultiSegmentWindFigure({
        title: 'Apparent Wind Speed by Lap',
        series: lapProfiles.map((lap, index) => ({
            label: `Lap ${lap.lapNumber}`,
            color: stackedLapColor(index),
            metrics: lap.supplementarySeries,
        })),
    });

    PlotlyGlobal.newPlot('gpsLapWindPlot', figure.data, figure.layout, figure.config);
}

/**
 * Render stacked Power plot for GPS lap mode
 */
export function renderGpsLapPowerPlot(lapProfiles: LapVEProfile[]) {
    const PlotlyGlobal = (window as any).Plotly;
    if (!PlotlyGlobal) return;

    const plotDiv = document.getElementById('gpsLapPowerPlot');
    if (!plotDiv) return;

    const figure = buildMultiSegmentPowerFigure({
        title: 'Power by Lap',
        series: lapProfiles.map((lap, index) => ({
            label: `Lap ${lap.lapNumber}`,
            color: stackedLapColor(index),
            metrics: lap.supplementarySeries,
        })),
    });

    PlotlyGlobal.newPlot('gpsLapPowerPlot', figure.data, figure.layout, figure.config);
}

/**
 * Render stacked VD plot for GPS lap mode
 */
export function renderGpsLapVdPlot(lapProfiles: LapVEProfile[]) {
    const PlotlyGlobal = (window as any).Plotly;
    if (!PlotlyGlobal) return;

    const plotDiv = document.getElementById('gpsLapVdPlot');
    if (!plotDiv) return;

    const figure = buildMultiSegmentVirtualDistanceFigure({
        title: 'Virtual Distance Difference by Lap',
        series: lapProfiles.map((lap, index) => ({
            label: `Lap ${lap.lapNumber}`,
            color: stackedLapColor(index),
            metrics: lap.supplementarySeries,
        })),
    });

    PlotlyGlobal.newPlot('gpsLapVdPlot', figure.data, figure.layout, figure.config);
}
