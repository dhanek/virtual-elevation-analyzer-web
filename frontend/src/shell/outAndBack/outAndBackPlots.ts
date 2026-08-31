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
import { renderVirtualDistanceHeader, sectionVirtualDistanceRows } from '../ve/vdHeader';
import { anchorSeriesTo } from '../../plots/comparisonTraces';
import { log } from '../../utils/log';
import { resizePlotlyGraphsIn } from '../dom/plotlyResize';

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

    Plotly.react('oabWindPlot', figure.data, figure.layout, figure.config);
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

    Plotly.react('oabPowerPlot', figure.data, figure.layout, figure.config);
}

/**
 * Render stacked VD plot for Out and Back mode
 */
/**
 * Render the stacked VD plot for out-and-back, and the per-section readouts
 * above it.
 *
 * This tab used to render a bare plot with no header at all -- the same hole
 * that was fixed for the GPS-lap sidebar, left open here because the shape was
 * a real design question: two legs per section means per-segment would be 2N
 * lines. The maintainer ruled per-section total, so there is one labelled line
 * per section combining both its legs.
 *
 * As in the other two modes, the header is filled from the SAME cumulative
 * series the plot below draws, so the numbers cannot drift from the curve they
 * label -- which was the original defect.
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

    Plotly.react('oabVdPlot', figure.data, figure.layout, figure.config);
    renderVirtualDistanceHeader(
        sectionVirtualDistanceRows(
            profiles.map(profile => ({
                label: `Section ${profile.sectionNumber}`,
                outbound: profile.outboundSeries,
                inbound: profile.inboundSeries,
            })),
        ),
    );
}

/**
 * Which wind model's two legs a scorer or figure builder reads.
 *
 * Out-and-back keeps its comparison series PER LEG (`outboundVECompare` /
 * `inboundVECompare`), so every consumer that used to reach for `outboundVE`
 * and `inboundVE` directly now goes through one of these two picks. That is
 * what makes the FIT and constant passes literally the same code over
 * different arrays, rather than two loops that can drift apart.
 */
type OutAndBackLegPick = (profile: OutAndBackVEProfile) => {
    outbound: number[];
    inbound: number[];
};

const FIT_LEGS: OutAndBackLegPick = profile => ({
    outbound: profile.outboundVE,
    inbound: profile.inboundVE,
});

const COMPARE_LEGS: OutAndBackLegPick = profile => ({
    outbound: profile.outboundVECompare ?? [],
    inbound: profile.inboundVECompare ?? [],
});

/**
 * Do ALL sections carry a comparison series on every leg they actually have?
 *
 * A leg the primitive skipped (under 10 samples) has no VE either, so it is not
 * evidence of a missing comparison — the condition is "every leg that was
 * computed was computed twice". A partial set is a bug upstream and renders as
 * the single-source figure with a warning.
 */
export function everySectionHasCompareSeries(profiles: OutAndBackVEProfile[]): boolean {
    return (
        profiles.length > 0 &&
        profiles.every(profile =>
            (profile.outboundVE.length === 0 || profile.outboundVECompare != null) &&
            (profile.inboundVE.length === 0 || profile.inboundVECompare != null)
        )
    );
}

/** How many sections carry a comparison series on at least one leg. */
function sectionsCarryingCompare(profiles: OutAndBackVEProfile[]): number {
    return profiles.filter(
        profile => profile.outboundVECompare != null || profile.inboundVECompare != null
    ).length;
}

export interface OutAndBackStats {
    rmse: number;
    avgVeGain: number;
    avgActualGain: number;
    avgDiff: number;
    /**
     * The same four numbers over the SECOND wind model, present iff the update
     * ran under `compare` (ruling 2, plan 07-04). The fields above always
     * describe the FIT series and are numerically untouched by its presence —
     * switching the radio must not move the numbers the user was reading.
     */
    compare?: {
        rmse: number;
        avgVeGain: number;
        avgActualGain: number;
        avgDiff: number;
    };
}

/**
 * Score ONE wind model's legs against the mean elevation profile.
 *
 * Verbatim maths from the single-model version, with the two hand-rolled offset
 * lines replaced by `anchorSeriesTo` (07-04 Task 1) and the leg arrays supplied
 * by `pick`. The inbound leg is anchored to THIS model's outbound last value,
 * which is the whole reason the pick exists.
 */
function scoreOutAndBackLegs(
    profiles: OutAndBackVEProfile[],
    meanElevation: { distances: number[]; elevation: number[] },
    pick: OutAndBackLegPick
): { rmse: number; avgVeGain: number; avgActualGain: number; avgDiff: number } {
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
        const legs = pick(profile);

        // Track the last outbound VE for continuity
        let outboundLastVE = endElev;

        // Process outbound
        if (legs.outbound.length > 0 && profile.outboundDistances.length > 0) {
            const calibratedOutboundVE = anchorSeriesTo(legs.outbound, startElev);
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
        if (legs.inbound.length > 0 && profile.inboundDistances.length > 0) {
            const maxDist = profile.inboundDistances[profile.inboundDistances.length - 1];
            const mirroredDistances = profile.inboundDistances.map(d => maxDist - d);

            // Inbound VE starts from where outbound ended (continuity)
            const calibratedInboundVE = anchorSeriesTo(legs.inbound, outboundLastVE);

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
 * Calculate statistics for Out and Back analysis
 */
export function calculateOutAndBackStats(
    profiles: OutAndBackVEProfile[],
    meanElevation: { distances: number[]; elevation: number[] }
): OutAndBackStats {
    if (profiles.length === 0 || meanElevation.distances.length === 0) {
        return { rmse: 0, avgVeGain: 0, avgActualGain: 0, avgDiff: 0 };
    }

    const primary = scoreOutAndBackLegs(profiles, meanElevation, FIT_LEGS);
    if (!everySectionHasCompareSeries(profiles)) {
        return primary;
    }

    return {
        ...primary,
        compare: scoreOutAndBackLegs(profiles, meanElevation, COMPARE_LEGS),
    };
}

/** The section palette. Index is section ORDER, and it means section identity. */
const SECTION_COLORS = ['#4363d8', '#e6194b', '#3cb44b', '#f58231', '#911eb4', '#46f0f0', '#f032e6'];

/** The x-range both figures share: the longest leg across all sections. */
function maxOutAndBackDistance(profiles: OutAndBackVEProfile[]): number {
    let maxDist = 0;
    for (const profile of profiles) {
        if (profile.outboundDistances.length > 0) {
            maxDist = Math.max(maxDist, profile.outboundDistances[profile.outboundDistances.length - 1]);
        }
        if (profile.inboundDistances.length > 0) {
            maxDist = Math.max(maxDist, profile.inboundDistances[profile.inboundDistances.length - 1]);
        }
    }
    return maxDist;
}

/** The mean actual elevation reference, identical in both VE figures. */
function meanElevationTrace(meanElevation: { distances: number[]; elevation: number[] }) {
    return {
        x: meanElevation.distances,
        y: meanElevation.elevation,
        mode: 'lines',
        name: 'Mean Actual Elevation',
        line: { color: 'black', width: 1 }
    };
}

/**
 * Residuals at the sampled distances, dropping points the mean profile does not
 * cover. The drop is why this is not `residualsAgainst`: an uncovered point has
 * no reference, and today's figure omits it rather than drawing a gap.
 */
function residualsOverMean(
    distances: number[],
    calibrated: number[],
    meanElevation: { distances: number[]; elevation: number[] }
): { x: number[]; y: number[] } {
    const x: number[] = [];
    const y: number[] = [];
    for (let j = 0; j < distances.length; j++) {
        const dist = distances[j];
        const meanElev = interpolateElevation(dist, meanElevation.distances, meanElevation.elevation);
        if (!isNaN(meanElev)) {
            y.push(calibrated[j] - meanElev);
            x.push(dist);
        }
    }
    return { x, y };
}

function outAndBackLayouts(maxDist: number, titleSuffix: string) {
    return {
        veLayout: {
            title: `Out & Back Virtual Elevation${titleSuffix}`,
            xaxis: { title: 'Distance (km)', range: [0, maxDist * 1.02] },
            yaxis: { title: 'Elevation (m)' },
            legend: { orientation: 'h', y: -0.15 },
            margin: { t: 40, b: 80, l: 60, r: 20 },
            hovermode: 'closest'
        },
        residualLayout: {
            title: `VE Residuals${titleSuffix} (VE - Mean Elevation)`,
            xaxis: { title: 'Distance (km)', range: [0, maxDist * 1.02] },
            yaxis: { title: 'Residual (m)' },
            margin: { t: 40, b: 60, l: 60, r: 20 },
            hovermode: 'closest',
            shapes: [{
                type: 'line', x0: 0, x1: maxDist, y0: 0, y1: 0,
                line: { color: 'gray', width: 1, dash: 'dot' }
            }]
        },
    };
}

/**
 * The traces for ONE wind model: `2N` section traces per figure, plus the mean
 * elevation reference on the VE figure.
 *
 * Every visual channel is a verbatim lift — colour is section identity, solid is
 * outbound, dashed is inbound, and the inbound leg is drawn against a MIRRORED
 * x-axis so both legs read left-to-right from gate A. The one thing that varies
 * per call is which arrays `pick` hands over, so the constant-wind figure is
 * literally the same drawing of different numbers.
 *
 * The continuity calibration is PER MODEL: `outboundLastVE` is this model's own
 * outbound last value. Anchoring a constant-wind inbound leg to the FIT
 * outbound would splice half of one model onto half of another and draw a curve
 * that belongs to neither — plausible on screen, silently wrong. That is the
 * D-10 mutation site this task owns.
 */
function buildOutAndBackModelTraces(
    profiles: OutAndBackVEProfile[],
    meanElevation: { distances: number[]; elevation: number[] },
    pick: OutAndBackLegPick
): {
    veTraces: any[];
    residualTraces: any[];
    closingErrors: { sectionNumber: number; error: number }[];
} {
    const veTraces: any[] = [];
    const residualTraces: any[] = [];
    const closingErrors: { sectionNumber: number; error: number }[] = [];

    if (meanElevation.distances.length > 0) {
        veTraces.push(meanElevationTrace(meanElevation));
    }

    const startElev = meanElevation.elevation.length > 0 ? meanElevation.elevation[0] : 0;
    const endElev = meanElevation.elevation.length > 0 ? meanElevation.elevation[meanElevation.elevation.length - 1] : 0;

    for (let i = 0; i < profiles.length; i++) {
        const profile = profiles[i];
        const color = SECTION_COLORS[i % SECTION_COLORS.length];
        const legs = pick(profile);

        // Track the last VE value from outbound for inbound continuity
        let outboundLastVE = endElev;  // Default to end elevation if no outbound data

        // Plot outbound VE (solid line)
        if (legs.outbound.length > 0) {
            const calibratedOutboundVE = anchorSeriesTo(legs.outbound, startElev);

            // Store the last calibrated VE value for inbound continuity
            outboundLastVE = calibratedOutboundVE[calibratedOutboundVE.length - 1];

            veTraces.push({
                x: profile.outboundDistances,
                y: calibratedOutboundVE,
                mode: 'lines',
                name: `Section ${profile.sectionNumber} (A→B)`,
                line: { color, width: 3 }
            });

            const residuals = residualsOverMean(profile.outboundDistances, calibratedOutboundVE, meanElevation);
            residualTraces.push({
                x: residuals.x,
                y: residuals.y,
                mode: 'lines',
                name: `Section ${profile.sectionNumber} (A→B)`,
                line: { color, width: 2 },
                showlegend: false
            });
        }

        // Plot inbound VE (dashed line, mirrored on x-axis)
        if (legs.inbound.length > 0) {
            const inboundMaxDist = profile.inboundDistances[profile.inboundDistances.length - 1];
            const mirroredDistances = profile.inboundDistances.map(d => inboundMaxDist - d);

            // Calibrate: inbound VE starts from where outbound VE ended (continuity)
            // The first inbound point (at turnaround B) should equal the last outbound VE value
            const calibratedInboundVE = anchorSeriesTo(legs.inbound, outboundLastVE);

            // Calculate closing error: last inbound VE vs actual start elevation
            const inboundLastVE = calibratedInboundVE[calibratedInboundVE.length - 1];
            closingErrors.push({
                sectionNumber: profile.sectionNumber,
                error: inboundLastVE - startElev
            });

            veTraces.push({
                x: mirroredDistances,
                y: calibratedInboundVE,
                mode: 'lines',
                name: `Section ${profile.sectionNumber} (B→A)`,
                line: { color, width: 3, dash: 'dash' }
            });

            const residuals = residualsOverMean(mirroredDistances, calibratedInboundVE, meanElevation);
            residualTraces.push({
                x: residuals.x,
                y: residuals.y,
                mode: 'lines',
                name: `Section ${profile.sectionNumber} (B→A)`,
                line: { color, width: 2, dash: 'dash' },
                showlegend: false
            });
        }
    }

    return { veTraces, residualTraces, closingErrors };
}

export interface OutAndBackFigures {
    ve: { data: any[]; layout: any };
    residuals: { data: any[]; layout: any };
    /** The constant-wind subplots, present only under compare. */
    compareVe?: { data: any[]; layout: any };
    compareResiduals?: { data: any[]; layout: any };
    /** Closing errors of the FIT series — what `#oabClosingError` has always shown. */
    closingErrors: { sectionNumber: number; error: number }[];
}

/** The single-source figures — one pair of plots, exactly as before. */
function buildOutAndBackSingleSourceFigures(
    profiles: OutAndBackVEProfile[],
    meanElevation: { distances: number[]; elevation: number[] }
): OutAndBackFigures {
    const { veLayout, residualLayout } = outAndBackLayouts(maxOutAndBackDistance(profiles), '');
    const traces = buildOutAndBackModelTraces(profiles, meanElevation, FIT_LEGS);

    return {
        ve: { data: traces.veTraces, layout: veLayout },
        residuals: { data: traces.residualTraces, layout: residualLayout },
        closingErrors: traces.closingErrors,
    };
}

/**
 * The out-and-back comparison figures (D-20 ruling, plan 07-04 Task 4).
 *
 * OPTION-B, AS RULED: a second stacked subplot, the constant-wind view BELOW the
 * FIT view. Neither plot spends a channel on the wind model, so each keeps
 * exactly today's encoding and today's readability — colour is section, solid is
 * outbound, dashed is inbound. The alternatives were declined for reasons
 * recorded in `07-GOLDEN-BASELINE.md` §"Task 3 ruling"; do not re-encode this as
 * an overlay.
 *
 * Four figures, `2N` section traces each (the VE figures also carry the single
 * mean-elevation reference they have always carried). The residual pair is what
 * makes "residuals carry both without ambiguity" true: putting both models'
 * residuals in one axis would reintroduce exactly the channel conflict — and the
 * 64-traces-at-16-sections crowding — that option-a was rejected for.
 */
export function buildOutAndBackComparisonFigures(
    profiles: OutAndBackVEProfile[],
    meanElevation: { distances: number[]; elevation: number[] }
): OutAndBackFigures {
    const maxDist = maxOutAndBackDistance(profiles);
    // Under compare the primary figure is titled, because an untitled plot above
    // a "(Constant Wind)" plot would leave the reader guessing which model it is.
    // The non-compare path keeps the bare title it has always had.
    const primary = outAndBackLayouts(maxDist, ' (FIT Wind)');
    const secondary = outAndBackLayouts(maxDist, ' (Constant Wind)');

    const fit = buildOutAndBackModelTraces(profiles, meanElevation, FIT_LEGS);
    const constant = buildOutAndBackModelTraces(profiles, meanElevation, COMPARE_LEGS);

    return {
        ve: { data: fit.veTraces, layout: primary.veLayout },
        residuals: { data: fit.residualTraces, layout: primary.residualLayout },
        compareVe: { data: constant.veTraces, layout: secondary.veLayout },
        compareResiduals: { data: constant.residualTraces, layout: secondary.residualLayout },
        closingErrors: fit.closingErrors,
    };
}

/** Paint `#oabClosingError` from the FIT series, exactly as before. */
function renderOutAndBackClosingErrors(closingErrors: { sectionNumber: number; error: number }[]) {
    const closingErrorDiv = document.getElementById('oabClosingError');
    if (closingErrorDiv && closingErrors.length > 0) {
        const avgError = closingErrors.reduce((sum, e) => sum + e.error, 0) / closingErrors.length;
        const errorDetails = closingErrors.map(e =>
            `Section ${e.sectionNumber}: ${e.error >= 0 ? '+' : ''}${e.error.toFixed(2)} m`
        ).join(' | ');
        closingErrorDiv.innerHTML = `<strong>Closing Error:</strong> ${errorDetails}` +
            (closingErrors.length > 1 ? ` | <strong>Avg:</strong> ${avgError >= 0 ? '+' : ''}${avgError.toFixed(2)} m` : '');
        closingErrorDiv.classList.remove('hidden');
    }
}

/**
 * Render Out and Back plots
 *
 * WHICH FIGURES ARE DRAWN IS A PROPERTY OF THE PROFILES, not a second entry
 * point (the shape Task 2 settled for GPS-lap): every computed leg carrying a
 * comparison series means compare, and anything else means the single-source
 * pair this mode has always drawn.
 */
export function renderOutAndBackPlots(
    Plotly: any,
    profiles: OutAndBackVEProfile[],
    meanElevation: { distances: number[]; elevation: number[] }
) {
    const withCompare = sectionsCarryingCompare(profiles);
    const isCompare = everySectionHasCompareSeries(profiles);
    if (withCompare > 0 && !isCompare) {
        // Half a comparison is worse than none: the second subplot would claim a
        // constant-wind view of sections it has no constant-wind data for.
        log.warn(
            `Out-and-back compare: ${withCompare} of ${profiles.length} sections carry a compare series; falling back to the single-source plot`,
        );
    }

    const figures = isCompare
        ? buildOutAndBackComparisonFigures(profiles, meanElevation)
        : buildOutAndBackSingleSourceFigures(profiles, meanElevation);

    renderOutAndBackClosingErrors(figures.closingErrors);

    // Unhide BEFORE plotting: Plotly measures the container at draw time, and a
    // `display: none` div measures zero.
    const compareView = document.getElementById('oabCompareView');
    if (compareView) {
        compareView.classList.toggle('hidden', !isCompare);
    }

    Plotly.react('oabVePlot', figures.ve.data, figures.ve.layout, { responsive: true });
    Plotly.react('oabVeResidualsPlot', figures.residuals.data, figures.residuals.layout, { responsive: true });

    if (figures.compareVe && figures.compareResiduals) {
        Plotly.react('oabVeComparePlot', figures.compareVe.data, figures.compareVe.layout, { responsive: true });
        Plotly.react(
            'oabVeCompareResidualsPlot',
            figures.compareResiduals.data,
            figures.compareResiduals.layout,
            { responsive: true },
        );

        // The unhide above is no longer enough on its own. `newPlot` measured
        // the container on every call, so unhiding first was the whole fix;
        // `react` reuses the width the graph already carries, and the compare
        // view spends time hidden whenever the selection drops out of compare.
        // A window resize during that stretch resizes a zero-width div, and
        // without this the stale width would survive the next unhide.
        // Scoped to the compare view deliberately: resizing every graph on the
        // page would hand `Plots.resize` the hidden tab panes too, and a
        // zero-width measurement is exactly the state this is here to undo.
        if (compareView) resizePlotlyGraphsIn(compareView);
    }
}
