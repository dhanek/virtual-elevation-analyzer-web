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
import { lapVirtualDistanceRows, renderVirtualDistanceHeader } from '../ve/vdHeader';

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

/** True when `values` never steps backwards. */
function isNonDecreasing(values: number[]): boolean {
    for (let i = 1; i < values.length; i++) {
        if (values[i] < values[i - 1]) return false;
    }
    return true;
}

/**
 * D3 — one forward walk instead of a full rescan per target.
 *
 * All four interpolation sites in this file used to answer "which pair of
 * samples brackets this distance?" by scanning the sample array from index 0,
 * for every single target. That is O(targets x samples): with 6 laps of ~1100
 * points against a ~1100-point reference grid it is ~7 million inner iterations
 * per update, and it was the single largest term in the GPS-lap slider cost.
 *
 * Both sequences are sorted in every real case, so the bracket for target i+1
 * is at or after the bracket for target i and the cursor only has to move
 * forward. That is the entire optimisation.
 *
 * EXACTNESS, which matters more than the speed here: this returns the SAME index
 * the rescan returned, including its edge cases, rather than a tidier one.
 *
 *   - the rescan returns the FIRST bracketing pair. With duplicate distances
 *     (a stationary rider) several pairs qualify; advancing only while
 *     `d[cursor+1] < target` stops at the same first one.
 *   - when nothing brackets the target the rescan "finds" nothing, and its two
 *     callers do DIFFERENT things about it -- the mean profile falls back to
 *     index 0 and extrapolates backwards, the stats loops leave the
 *     interpolated value at 0. So this returns -1 and leaves that choice to the
 *     caller instead of inventing a shared answer.
 *   - if either sequence steps backwards, a forward-only cursor could sail past
 *     a bracket the rescan would find. Non-monotonic SAMPLES fall back to the
 *     original rescan for the whole series; a target that moves backwards
 *     rewinds the cursor. Both cases are pinned by
 *     `gpsLapStatsInterpolation.test.ts`, because bad GPS does produce them.
 */
function createBracketFinder(distances: number[]): (target: number) => number {
    const n = distances.length;
    const monotonicSamples = isNonDecreasing(distances);
    let cursor = 0;
    let lastTarget = Number.NEGATIVE_INFINITY;

    return function findBracket(target: number): number {
        if (n < 2) return -1;

        if (!monotonicSamples) {
            for (let k = 0; k < n - 1; k++) {
                if (distances[k] <= target && distances[k + 1] >= target) return k;
            }
            return -1;
        }

        if (target < lastTarget) cursor = 0;
        lastTarget = target;

        while (cursor < n - 2 && distances[cursor + 1] < target) cursor++;

        return distances[cursor] <= target && distances[cursor + 1] >= target
            ? cursor
            : -1;
    };
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
        // One cursor per lap: the reference distances are increasing, so the
        // bracket for each successive target is at or after the previous one.
        const findBracket = createBracketFinder(lap.distances);
        const lapMaxDistance = lap.distances[lap.distances.length - 1];

        // Interpolate this lap's elevation onto the reference distances
        for (let i = 0; i < referenceDistances.length; i++) {
            const targetDist = referenceDistances[i];

            // Only interpolate within this lap's range
            if (targetDist > lapMaxDistance) continue;

            // Find bracketing points. No bracket -> index 0, which extrapolates
            // backwards from the first two samples; that is what the original
            // rescan did with its `lowIdx = 0` initialiser and it is load-bearing
            // for laps that start after the reference grid does.
            const bracket = findBracket(targetDist);
            const lowIdx = bracket === -1 ? 0 : bracket;

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
 * The three numbers the GPS-lap header shows above the plot.
 *
 * Named as a type because there is exactly ONE producer of them per update and
 * three consumers -- the sidebar template's initial paint, the header spans, and
 * the stored result. Whoever computes them computes them once and hands the same
 * object to all three; see `renderGpsLapVEPlots`.
 */
export interface GpsLapHeaderStats {
    meanR2: number;
    meanRMSE: number;
    closingError: number;
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
        const findResidualBracket = createBracketFinder(meanElevation.distances);
        for (let i = 0; i < lap.distances.length; i++) {
            const dist = lap.distances[i];
            // No bracket -> 0, NOT the nearest sample. On real elevations that
            // is a ~1000 m residual rather than a rounding difference, so it is
            // shipped behaviour worth reproducing exactly, not a bug to tidy.
            let interpMeanElev = 0;
            const k = findResidualBracket(dist);
            if (k !== -1) {
                const t = (dist - meanElevation.distances[k]) /
                          (meanElevation.distances[k + 1] - meanElevation.distances[k]);
                interpMeanElev = meanElevation.elevation[k] + t *
                                 (meanElevation.elevation[k + 1] - meanElevation.elevation[k]);
            }
            const residual = calibratedVE[i] - interpMeanElev;
            sumSquaredResiduals += residual * residual;
            meanElevSum += interpMeanElev;
            count++;
        }

        const meanMeanElev = count > 0 ? meanElevSum / count : 0;
        // A second cursor, because this walks the same targets from the start
        // again. Its only output is R2 -- and R2 is clamped with Math.max(0, r2),
        // so on the golden ride (every lap negative) this loop is invisible.
        // `gpsLapStatsInterpolation.test.ts` is what actually watches it.
        const findTotalBracket = createBracketFinder(meanElevation.distances);
        for (let i = 0; i < lap.distances.length; i++) {
            const dist = lap.distances[i];
            let interpMeanElev = 0;
            const k = findTotalBracket(dist);
            if (k !== -1) {
                const t = (dist - meanElevation.distances[k]) /
                          (meanElevation.distances[k + 1] - meanElevation.distances[k]);
                interpMeanElev = meanElevation.elevation[k] + t *
                                 (meanElevation.elevation[k + 1] - meanElevation.elevation[k]);
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
 *
 * `stats` is REQUIRED and is NOT recomputed here (D1). This function used to
 * call `calculateGpsLapStats` itself, so every slider update ran that helper
 * twice on identical inputs -- once for the aggregate the primitive stores in
 * the result state, and again here for the header spans. The second run cost
 * ~6 ms of a ~22 ms update and bought nothing.
 *
 * Taking the stats as a required parameter rather than an optional one is the
 * point: an optional parameter with a recompute fallback would leave two code
 * paths that can print different numbers, which is the drift this is supposed to
 * make impossible. There is now exactly one computation per update and the
 * header, the plot and the stored result all read it.
 */
export function renderGpsLapVEPlots(
    lapProfiles: LapVEProfile[],
    meanElevation: { distances: number[]; elevation: number[] },
    stats: GpsLapHeaderStats
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

        const findBracket = createBracketFinder(meanElevation.distances);
        for (let j = 0; j < lap.distances.length; j++) {
            const dist = lap.distances[j];
            // Interpolate mean elevation at this distance
            let meanElev = 0;
            const k = findBracket(dist);
            if (k !== -1) {
                const t = (dist - meanElevation.distances[k]) /
                          (meanElevation.distances[k + 1] - meanElevation.distances[k]);
                meanElev = meanElevation.elevation[k] + t *
                           (meanElevation.elevation[k + 1] - meanElevation.elevation[k]);
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

    // Update statistics -- from the caller's single computation, never a second one.
    const r2Span = document.getElementById('gpsLapR2Value');
    const rmseSpan = document.getElementById('gpsLapRmseValue');
    const closingErrorSpan = document.getElementById('gpsLapClosingErrorValue');
    if (r2Span) r2Span.textContent = stats.meanR2.toFixed(4);
    if (rmseSpan) rmseSpan.textContent = stats.meanRMSE.toFixed(2) + 'm';
    if (closingErrorSpan) closingErrorSpan.textContent = stats.closingError.toFixed(2) + 'm';

    // Populate lap summary table
    const summaryTable = document.getElementById('gpsLapSummaryTable');
    if (summaryTable) {
        const rows = lapProfiles.map((lap) => {
            const avgSpeed = lap.totalDistance / (lap.duration / 3600); // km/h
            return `<tr class="ve-lap-summary__row">
                    <td class="ve-lap-summary__cell ve-lap-summary__cell--label">
                        <span class="ve-lap-summary__swatch"></span>
                        Lap ${lap.lapNumber}
                    </td>
                    <td class="ve-lap-summary__cell">${formatLapDuration(lap.duration)}</td>
                    <td class="ve-lap-summary__cell">${lap.totalDistance.toFixed(2)} km</td>
                    <td class="ve-lap-summary__cell">${avgSpeed.toFixed(1)} km/h</td>
                </tr>`;
        }).join('');

        const tableHtml = `<table class="ve-lap-summary__table">
                <thead>
                    <tr class="ve-lap-summary__row ve-lap-summary__row--head">
                        <th class="ve-lap-summary__cell ve-lap-summary__cell--label">Lap</th>
                        <th class="ve-lap-summary__cell">Duration</th>
                        <th class="ve-lap-summary__cell">Distance</th>
                        <th class="ve-lap-summary__cell">Avg Speed</th>
                    </tr>
                </thead>
                <tbody>${rows}</tbody></table>`;
        summaryTable.innerHTML = tableHtml;

        // Swatch backgrounds are runtime data (the shared stacked-lap Plotly
        // palette), so they stay imperative per D-07's continuous-value
        // exception rather than duplicating the palette as CSS modifiers.
        summaryTable
            .querySelectorAll<HTMLSpanElement>('.ve-lap-summary__swatch')
            .forEach((swatch, i) => {
                swatch.style.background = stackedLapColor(i);
            });
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

    // `react`, not `newPlot` (D4): these three redraw on every slider update
    // while their tab is open, and `newPlot` tears the graph down and rebuilds
    // it from scratch each time. `react` initializes an empty div on the first
    // call exactly as `newPlot` does, then diffs -- which is what the VE and
    // residual plots above have always done.
    PlotlyGlobal.react('gpsLapWindPlot', figure.data, figure.layout, figure.config);
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

    PlotlyGlobal.react('gpsLapPowerPlot', figure.data, figure.layout, figure.config);
}

/**
 * Render stacked VD plot for GPS lap mode, and the per-lap readouts above it.
 *
 * This sidebar is shared by genuine GPS lap splitting and the Standard "Stacked"
 * view, and it used to render the plot with NO header -- so in both modes the
 * label was missing outright rather than merely stale. Header and plot are
 * written from the SAME per-lap cumulative series, which is what stops the two
 * drifting apart the way Standard's did.
 */
export function renderGpsLapVdPlot(lapProfiles: LapVEProfile[]) {
    const PlotlyGlobal = (window as any).Plotly;
    if (!PlotlyGlobal) return;

    const plotDiv = document.getElementById('gpsLapVdPlot');
    if (!plotDiv) return;

    const series = lapProfiles.map((lap, index) => ({
        label: `Lap ${lap.lapNumber}`,
        color: stackedLapColor(index),
        metrics: lap.supplementarySeries,
    }));

    const figure = buildMultiSegmentVirtualDistanceFigure({
        title: 'Virtual Distance Difference by Lap',
        series,
    });

    PlotlyGlobal.react('gpsLapVdPlot', figure.data, figure.layout, figure.config);
    renderVirtualDistanceHeader(lapVirtualDistanceRows(series));
}
