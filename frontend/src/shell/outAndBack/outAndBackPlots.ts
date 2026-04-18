/**
 * Out-and-back VE plot rendering and statistics.
 *
 * Verbatim lift from main.ts -- rendering logic for out-and-back mode plots.
 */
import type { OutAndBackVEProfile } from './types';
import type { SegmentSupplementarySeries } from '../../analysis/SegmentSupplementarySeries';
import { getMultiSegmentColor, interpolateElevation } from '../multiSegment/shared';
import {
    buildMultiSegmentWindFigure,
    buildMultiSegmentPowerFigure,
    buildMultiSegmentVirtualDistanceFigure,
} from '../../plots/MultiSegmentPlotBuilders';

/**
 * Calculate mean actual elevation profile for Out and Back (with inbound mirrored)
 */
export function calculateOutAndBackMeanElevation(profiles: OutAndBackVEProfile[]): { distances: number[]; elevation: number[] } {
    if (profiles.length === 0) {
        return { distances: [], elevation: [] };
    }

    // Find maximum distance across all segments
    let maxDistance = 0;
    for (const profile of profiles) {
        if (profile.outboundDistances.length > 0) {
            maxDistance = Math.max(maxDistance, profile.outboundDistances[profile.outboundDistances.length - 1]);
        }
        if (profile.inboundDistances.length > 0) {
            maxDistance = Math.max(maxDistance, profile.inboundDistances[profile.inboundDistances.length - 1]);
        }
    }

    // Create reference distance array with ~10m intervals
    const numPoints = Math.max(100, Math.floor(maxDistance * 100));
    const referenceDistances: number[] = [];
    for (let i = 0; i <= numPoints; i++) {
        referenceDistances.push((i / numPoints) * maxDistance);
    }

    // Accumulate elevation values
    const elevationSum = new Array(referenceDistances.length).fill(0);
    const elevationCount = new Array(referenceDistances.length).fill(0);

    for (const profile of profiles) {
        // Process outbound elevation (not mirrored)
        if (profile.outboundDistances.length > 0 && profile.outboundActualElevation.length > 0) {
            for (let i = 0; i < referenceDistances.length; i++) {
                const targetDist = referenceDistances[i];
                if (targetDist > profile.outboundDistances[profile.outboundDistances.length - 1]) continue;

                // Linear interpolation
                const elevAtDist = interpolateElevation(targetDist, profile.outboundDistances, profile.outboundActualElevation);
                if (!isNaN(elevAtDist)) {
                    elevationSum[i] += elevAtDist;
                    elevationCount[i]++;
                }
            }
        }

        // Process inbound elevation (mirrored on x-axis)
        if (profile.inboundDistances.length > 0 && profile.inboundActualElevation.length > 0) {
            const maxInboundDist = profile.inboundDistances[profile.inboundDistances.length - 1];
            const mirroredDistances = profile.inboundDistances.map(d => maxInboundDist - d);

            for (let i = 0; i < referenceDistances.length; i++) {
                const targetDist = referenceDistances[i];
                if (targetDist > maxInboundDist) continue;

                const elevAtDist = interpolateElevation(targetDist, mirroredDistances, profile.inboundActualElevation);
                if (!isNaN(elevAtDist)) {
                    elevationSum[i] += elevAtDist;
                    elevationCount[i]++;
                }
            }
        }
    }

    // Calculate mean
    const meanElevation: number[] = [];
    for (let i = 0; i < referenceDistances.length; i++) {
        if (elevationCount[i] > 0) {
            meanElevation.push(elevationSum[i] / elevationCount[i]);
        } else {
            meanElevation.push(meanElevation.length > 0 ? meanElevation[meanElevation.length - 1] : 0);
        }
    }

    return { distances: referenceDistances, elevation: meanElevation };
}

/**
 * Build multi-segment series for out-and-back plots (wind/power/VD).
 */
export function buildOutAndBackMultiSegmentSeries(profiles: OutAndBackVEProfile[]) {
    return profiles.flatMap((profile, index) => {
        const color = getMultiSegmentColor(index);
        const series = [] as Array<{
            label: string;
            color: string;
            metrics: SegmentSupplementarySeries;
            dash?: 'solid' | 'dash';
        }>;

        if (profile.outboundSeries) {
            series.push({
                label: `Section ${profile.sectionNumber} Out`,
                color,
                metrics: profile.outboundSeries,
            });
        }

        if (profile.inboundSeries) {
            series.push({
                label: `Section ${profile.sectionNumber} Back`,
                color,
                metrics: profile.inboundSeries,
                dash: 'dash',
            });
        }

        return series;
    });
}

/**
 * Render stacked Wind plot for Out and Back mode
 */
export function renderOutAndBackWindPlot(profiles: OutAndBackVEProfile[]) {
    const Plotly = (window as any).Plotly;
    if (!Plotly) return;

    const plotDiv = document.getElementById('oabWindPlot');
    if (!plotDiv) return;

    const figure = buildMultiSegmentWindFigure({
        title: 'Apparent Wind Speed by Section',
        series: buildOutAndBackMultiSegmentSeries(profiles),
    });

    Plotly.newPlot('oabWindPlot', figure.data, figure.layout, figure.config);
}

/**
 * Render stacked Power plot for Out and Back mode
 */
export function renderOutAndBackPowerPlot(profiles: OutAndBackVEProfile[]) {
    const Plotly = (window as any).Plotly;
    if (!Plotly) return;

    const plotDiv = document.getElementById('oabPowerPlot');
    if (!plotDiv) return;

    const figure = buildMultiSegmentPowerFigure({
        title: 'Power by Section',
        series: buildOutAndBackMultiSegmentSeries(profiles),
    });

    Plotly.newPlot('oabPowerPlot', figure.data, figure.layout, figure.config);
}

/**
 * Render stacked VD plot for Out and Back mode
 */
export function renderOutAndBackVdPlot(profiles: OutAndBackVEProfile[]) {
    const Plotly = (window as any).Plotly;
    if (!Plotly) return;

    const plotDiv = document.getElementById('oabVdPlot');
    if (!plotDiv) return;

    const figure = buildMultiSegmentVirtualDistanceFigure({
        title: 'Virtual Distance Difference by Section',
        series: buildOutAndBackMultiSegmentSeries(profiles),
    });

    Plotly.newPlot('oabVdPlot', figure.data, figure.layout, figure.config);
}

/**
 * Calculate statistics for Out and Back analysis
 */
export function calculateOutAndBackStats(profiles: OutAndBackVEProfile[], meanElevation: { distances: number[]; elevation: number[] }): {
    rmse: number; avgVeGain: number; avgActualGain: number; avgDiff: number;
} {
    if (profiles.length === 0 || meanElevation.distances.length === 0) {
        return { rmse: 0, avgVeGain: 0, avgActualGain: 0, avgDiff: 0 };
    }

    let sumSquaredError = 0;
    let errorCount = 0;
    let totalClosingError = 0;
    let sectionCount = 0;

    // For out-and-back, actual gain is 0 since we return to the same point (gate A)
    // The mean elevation profile only covers A→B, but we go A→B→A
    const startElev = meanElevation.elevation[0];
    const endElev = meanElevation.elevation[meanElevation.elevation.length - 1];
    const avgActualGain = 0;  // Always 0 for out-and-back (we return to start)

    for (const profile of profiles) {
        // Track the last outbound VE for continuity
        let outboundLastVE = endElev;

        // Process outbound
        if (profile.outboundVE.length > 0 && profile.outboundDistances.length > 0) {
            const calibratedOutboundVE = profile.outboundVE.map((ve) =>
                ve - profile.outboundVE[0] + startElev
            );
            outboundLastVE = calibratedOutboundVE[calibratedOutboundVE.length - 1];

            // RMSE calculation for outbound
            for (let i = 0; i < profile.outboundDistances.length; i++) {
                const dist = profile.outboundDistances[i];
                const meanElev = interpolateElevation(dist, meanElevation.distances, meanElevation.elevation);
                if (!isNaN(meanElev)) {
                    const error = calibratedOutboundVE[i] - meanElev;
                    sumSquaredError += error * error;
                    errorCount++;
                }
            }
        }

        // Process inbound (mirrored) - continues from outbound's last VE
        if (profile.inboundVE.length > 0 && profile.inboundDistances.length > 0) {
            const maxDist = profile.inboundDistances[profile.inboundDistances.length - 1];
            const mirroredDistances = profile.inboundDistances.map(d => maxDist - d);

            // Inbound VE starts from where outbound ended (continuity)
            const calibratedInboundVE = profile.inboundVE.map((ve) =>
                ve - profile.inboundVE[0] + outboundLastVE
            );

            // VE Gain (closing error) = last inbound VE - start elevation
            // This is the difference at gate A between end of inbound and start of outbound
            const inboundLastVE = calibratedInboundVE[calibratedInboundVE.length - 1];
            totalClosingError += inboundLastVE - startElev;
            sectionCount++;

            // RMSE calculation for inbound
            for (let i = 0; i < mirroredDistances.length; i++) {
                const dist = mirroredDistances[i];
                const meanElev = interpolateElevation(dist, meanElevation.distances, meanElevation.elevation);
                if (!isNaN(meanElev)) {
                    const error = calibratedInboundVE[i] - meanElev;
                    sumSquaredError += error * error;
                    errorCount++;
                }
            }
        }
    }

    const rmse = errorCount > 0 ? Math.sqrt(sumSquaredError / errorCount) : 0;
    // avgVeGain is the average closing error (VE at end of inbound - VE at start of outbound)
    // For perfect CdA/Crr, this should be close to 0
    const avgVeGain = sectionCount > 0 ? totalClosingError / sectionCount : 0;

    return {
        rmse,
        avgVeGain,
        avgActualGain,
        avgDiff: avgVeGain - avgActualGain
    };
}

/**
 * Render Out and Back plots
 */
export function renderOutAndBackPlots(
    Plotly: any,
    profiles: OutAndBackVEProfile[],
    meanElevation: { distances: number[]; elevation: number[] }
) {
    const veTraces: any[] = [];
    const residualTraces: any[] = [];

    // Color palette
    const colors = ['#4363d8', '#e6194b', '#3cb44b', '#f58231', '#911eb4', '#46f0f0', '#f032e6'];

    // Find max distance for plot range
    let maxDist = 0;
    for (const profile of profiles) {
        if (profile.outboundDistances.length > 0) {
            maxDist = Math.max(maxDist, profile.outboundDistances[profile.outboundDistances.length - 1]);
        }
        if (profile.inboundDistances.length > 0) {
            maxDist = Math.max(maxDist, profile.inboundDistances[profile.inboundDistances.length - 1]);
        }
    }

    // Plot mean actual elevation
    if (meanElevation.distances.length > 0) {
        veTraces.push({
            x: meanElevation.distances,
            y: meanElevation.elevation,
            mode: 'lines',
            name: 'Mean Actual Elevation',
            line: { color: 'black', width: 1 }
        });
    }

    const startElev = meanElevation.elevation.length > 0 ? meanElevation.elevation[0] : 0;
    const endElev = meanElevation.elevation.length > 0 ? meanElevation.elevation[meanElevation.elevation.length - 1] : 0;

    // Track closing errors for each section (VE at end of inbound vs actual start elevation)
    const closingErrors: { sectionNumber: number; error: number }[] = [];

    // Plot each section
    for (let i = 0; i < profiles.length; i++) {
        const profile = profiles[i];
        const color = colors[i % colors.length];

        // Track the last VE value from outbound for inbound continuity
        let outboundLastVE = endElev;  // Default to end elevation if no outbound data

        // Plot outbound VE (solid line)
        if (profile.outboundVE.length > 0) {
            const calibratedOutboundVE = profile.outboundVE.map((ve) =>
                ve - profile.outboundVE[0] + startElev
            );

            // Store the last calibrated VE value for inbound continuity
            outboundLastVE = calibratedOutboundVE[calibratedOutboundVE.length - 1];

            veTraces.push({
                x: profile.outboundDistances,
                y: calibratedOutboundVE,
                mode: 'lines',
                name: `Section ${profile.sectionNumber} (A→B)`,
                line: { color, width: 3 }
            });

            // Outbound residuals
            const residuals: number[] = [];
            const residualDists: number[] = [];
            for (let j = 0; j < profile.outboundDistances.length; j++) {
                const dist = profile.outboundDistances[j];
                const meanElev = interpolateElevation(dist, meanElevation.distances, meanElevation.elevation);
                if (!isNaN(meanElev)) {
                    residuals.push(calibratedOutboundVE[j] - meanElev);
                    residualDists.push(dist);
                }
            }
            residualTraces.push({
                x: residualDists,
                y: residuals,
                mode: 'lines',
                name: `Section ${profile.sectionNumber} (A→B)`,
                line: { color, width: 2 },
                showlegend: false
            });
        }

        // Plot inbound VE (dashed line, mirrored on x-axis)
        if (profile.inboundVE.length > 0) {
            const inboundMaxDist = profile.inboundDistances[profile.inboundDistances.length - 1];
            const mirroredDistances = profile.inboundDistances.map(d => inboundMaxDist - d);

            // Calibrate: inbound VE starts from where outbound VE ended (continuity)
            // The first inbound point (at turnaround B) should equal the last outbound VE value
            const calibratedInboundVE = profile.inboundVE.map((ve) =>
                ve - profile.inboundVE[0] + outboundLastVE
            );

            // Calculate closing error: last inbound VE vs actual start elevation
            const inboundLastVE = calibratedInboundVE[calibratedInboundVE.length - 1];
            const closingError = inboundLastVE - startElev;
            closingErrors.push({
                sectionNumber: profile.sectionNumber,
                error: closingError
            });

            veTraces.push({
                x: mirroredDistances,
                y: calibratedInboundVE,
                mode: 'lines',
                name: `Section ${profile.sectionNumber} (B→A)`,
                line: { color, width: 3, dash: 'dash' }
            });

            // Inbound residuals
            const residuals: number[] = [];
            const residualDists: number[] = [];
            for (let j = 0; j < mirroredDistances.length; j++) {
                const dist = mirroredDistances[j];
                const meanElev = interpolateElevation(dist, meanElevation.distances, meanElevation.elevation);
                if (!isNaN(meanElev)) {
                    residuals.push(calibratedInboundVE[j] - meanElev);
                    residualDists.push(dist);
                }
            }
            residualTraces.push({
                x: residualDists,
                y: residuals,
                mode: 'lines',
                name: `Section ${profile.sectionNumber} (B→A)`,
                line: { color, width: 2, dash: 'dash' },
                showlegend: false
            });
        }
    }

    // Display closing errors in a summary element
    const closingErrorDiv = document.getElementById('oabClosingError');
    if (closingErrorDiv && closingErrors.length > 0) {
        const avgError = closingErrors.reduce((sum, e) => sum + e.error, 0) / closingErrors.length;
        const errorDetails = closingErrors.map(e =>
            `Section ${e.sectionNumber}: ${e.error >= 0 ? '+' : ''}${e.error.toFixed(2)} m`
        ).join(' | ');
        closingErrorDiv.innerHTML = `<strong>Closing Error:</strong> ${errorDetails}` +
            (closingErrors.length > 1 ? ` | <strong>Avg:</strong> ${avgError >= 0 ? '+' : ''}${avgError.toFixed(2)} m` : '');
        closingErrorDiv.style.display = 'block';
    }

    // Plot layouts
    const veLayout = {
        title: 'Out & Back Virtual Elevation',
        xaxis: { title: 'Distance (km)', range: [0, maxDist * 1.02] },
        yaxis: { title: 'Elevation (m)' },
        legend: { orientation: 'h', y: -0.15 },
        margin: { t: 40, b: 80, l: 60, r: 20 },
        hovermode: 'closest'
    };

    const residualLayout = {
        title: 'VE Residuals (VE - Mean Elevation)',
        xaxis: { title: 'Distance (km)', range: [0, maxDist * 1.02] },
        yaxis: { title: 'Residual (m)' },
        margin: { t: 40, b: 60, l: 60, r: 20 },
        hovermode: 'closest',
        shapes: [{
            type: 'line', x0: 0, x1: maxDist, y0: 0, y1: 0,
            line: { color: 'gray', width: 1, dash: 'dot' }
        }]
    };

    Plotly.newPlot('oabVePlot', veTraces, veLayout, { responsive: true });
    Plotly.newPlot('oabVeResidualsPlot', residualTraces, residualLayout, { responsive: true });
}
