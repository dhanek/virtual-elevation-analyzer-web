/**
 * ONE SIZING CONVENTION, AND THIS FILE USED TO BREAK IT.
 *
 * Across the app a plot is sized like this: the graph div carries a HEIGHT FROM
 * CSS (`.ve-plot-container__plot--ve` / `--residuals` / `--tall`), the figure
 * carries NO `layout.height`, and Plotly autosizes into the box. That is the
 * only convention compatible with the two things that re-measure a plot after
 * it is drawn — `config.responsive`, which re-autosizes on window resize, and
 * `Plots.resize`, which the tab layer calls when a hidden pane becomes visible.
 *
 * The Standard figures below used to carry `height: 350` / `height: 200` while
 * their container carried no CSS height at all, which inverted the
 * relationship: the BOX was sized by the plot. Measured in Chrome 2026-08-31,
 * that fails in two ways, and both were on screen:
 *
 *   - `Plots.resize` guards on `gd.layout.width && gd.layout.height`
 *     (plotly-cartesian.js:48489). These layouts set height but never width, so the
 *     guard let it through and the next two lines DELETE both and re-autosize —
 *     into a box whose height came from the plot. Measured: 350 px -> 26 px,
 *     and 26 px again on every later resize.
 *   - Standard's wind, power and VD figures set no height and their containers
 *     set none either, so they had NO height source. They only ever looked
 *     right because they were drawn while their pane was `display: none`, where
 *     Plotly falls back to a 700x450 default. That accident was load-bearing:
 *     any path that honestly re-measured them collapsed them to 26 px.
 *
 * So: no `height` in any layout in this file. If a plot is the wrong size, the
 * stylesheet is where to fix it.
 */
import { anchorSeriesTo, residualsAgainst } from './comparisonTraces';
import { buildTrimBoundaryShapes, createContextSlices, type PlotContext } from './PlotContext';
import type { ReferenceElevationSeries } from '../analysis/elevationProfiles';
import {
    computeVirtualDistanceWindowTotals,
    integrateVirtualDistance,
    type VirtualDistanceTotals,
} from '../analysis/VirtualDistance';

// The integration itself moved to analysis/VirtualDistance.ts once Store Result
// and Export CSV started persisting these numbers (change-list entry (h)): the
// `summarize` seam that writes them lives in modes/analysis/ and must not reach
// into this layer. Re-exported here so every existing import site keeps working
// and there is still exactly ONE integration.
export {
    computeVirtualDistanceWindowTotals,
    integrateVirtualDistance,
    virtualDistanceDifferencePercent,
} from '../analysis/VirtualDistance';
export type {
    VirtualDistanceIntegration,
    VirtualDistanceTotals,
    VirtualDistanceWindow,
    SegmentVirtualDistance,
} from '../analysis/VirtualDistance';

export type PlotTrace = Record<string, unknown>;
export type PlotLayout = Record<string, unknown>;
export type PlotConfig = Record<string, unknown>;

export interface PlotDefinition {
    data: PlotTrace[];
    layout: PlotLayout;
    config: PlotConfig;
}

export interface VirtualElevationFigures {
    elevation: PlotDefinition;
    residuals: PlotDefinition;
}

export interface VirtualElevationComparisonPlotInput {
    context: PlotContext;
    virtualElevationConstant: number[];
    virtualElevationFit: number[];
    actualElevation: number[];
    /** The non-master elevation channel, drawn dashed beside the actual trace. */
    referenceElevation?: ReferenceElevationSeries | null;
}

export interface VirtualElevationPlotInput {
    context: PlotContext;
    virtualElevation: number[];
    actualElevation: number[];
    /** The non-master elevation channel, drawn dashed beside the actual trace. */
    referenceElevation?: ReferenceElevationSeries | null;
    cdaLabel: string;
    crrLabel: string;
}

export interface WindSpeedPlotInput {
    context: PlotContext;
    velocity: number[];
    fitWindSpeedKmh: Array<number | null>;
    constantWindApparentKmh?: number[];
}

export interface SpeedPowerPlotInput {
    context: PlotContext;
    velocity: number[];
    power: number[];
}

/**
 * D-21 / N-6: there is NO calibration field here, deliberately.
 *
 * `windSpeed` is an ALREADY-RESOLVED apparent-wind series — offset and the
 * `1 + pct/100` calibration multiplier have both been applied upstream by
 * `resolveWindSeries`, which after plan 07-02 is the only place in the update
 * path that applies either. This builder used to re-apply the multiplier
 * internally, which was harmless only while its callers happened to pass an
 * un-calibrated series. Once the series arrives pre-calibrated that internal
 * multiplier becomes a DOUBLE application, and 07-RESEARCH.md named it the
 * single most likely silent numeric regression in the phase.
 *
 * Removing the field rather than passing 0 makes a second application a
 * COMPILE error instead of a convention. Guarded by
 * `virtualDistanceCalibration.test.ts`.
 */
export interface VirtualDistancePlotInput {
    context: PlotContext;
    timestamps: number[];
    velocity: number[];
    /** Already offset AND calibrated. Do not scale it again — see above. */
    windSpeed: number[];
}

export function getDefaultPlotConfig(): PlotConfig {
    return {
        responsive: true,
        displayModeBar: true,
        modeBarButtonsToRemove: ['pan2d', 'lasso2d', 'select2d'],
        displaylogo: false,
    };
}

/**
 * The legend for an OVERLAY figure, and the second thing the sizing convention
 * above broke.
 *
 * The figures in this file put their legend INSIDE the plot area
 * (`x: 0.02, y: 0.98`), where it cannot touch an axis title. The three overlay
 * figures cannot: they stack several laps or sections on one axis, so they
 * carry more entries than fit over the data, and the legend goes below the
 * x-axis instead. That is the placement that collides.
 *
 * `legend.y` is a FRACTION OF THE PLOT AREA under the default
 * `yref: 'paper'`. The x-axis title beneath it is placed at a fixed PIXEL
 * offset from the axis line. While every canvas carried a fixed
 * `layout.height` the two agreed by coincidence and the hardcoded `-0.15` /
 * `-0.2` looked correct. Moving the heights into CSS `clamp()`s made the plot
 * area shrink with the viewport, so the same fraction buys fewer and fewer
 * pixels until the legend sits on top of `Distance (km)` -- seen in the
 * out-and-back VE plot in a short window, 2026-08-31.
 *
 * No single paper fraction fixes it, which is why this is a helper and not a
 * bigger number: one large enough to clear the title at the clamp MINIMUM
 * pushes the legend past the bottom margin and off the figure at the clamp
 * MAXIMUM. `yref: 'container'` measures from the figure's own bottom edge, so
 * the legend is pinned there and the only thing that must be big enough is
 * `margin.b` -- also pixels, so it holds at every height in the clamp range.
 *
 * Use `BELOW_AXIS_LEGEND_MARGIN_B` as the bottom margin wherever this is used;
 * the two are one setting in two fields, and pinned together by
 * `belowAxisLegend.test.ts`.
 */
export function belowAxisLegend(): PlotLayout {
    return {
        orientation: 'h',
        yref: 'container',
        yanchor: 'bottom',
        y: 0,
        // Centred EXPLICITLY. Plotly's default `x` for a horizontal legend is 0,
        // which the old layouts were quietly relying on not being applied --
        // they read as centred because the entries filled the width. Measured in
        // Chrome once `yref` was set: the legend went hard left.
        x: 0.5,
        xanchor: 'center',
    };
}

/** Bottom margin that fits an x-axis title AND `belowAxisLegend` under it. */
export const BELOW_AXIS_LEGEND_MARGIN_B = 100;

/** One dashed-grey style for the reference channel, shared by both builders. */
const REFERENCE_ELEVATION_LINE = { color: '#8a8a8a', width: 1.5, dash: 'dash' };

/**
 * Offset aligning the reference channel to the master at the first trimmed
 * sample where BOTH are finite. The barometer's absolute datum is
 * calibration-dependent and routinely sits tens of metres from the DEM's;
 * drawn raw, that gap doubles the y-range and flattens exactly the shape
 * detail this overlay exists to compare — so the reference is aligned the
 * same way the VE trace is anchored to the actual. Zero when no finite pair
 * exists; the trace then draws at its own datum, which is at least honest.
 */
function referenceAlignmentOffset(actualMain: number[], referenceMain: number[]): number {
    const n = Math.min(actualMain.length, referenceMain.length);
    for (let i = 0; i < n; i++) {
        if (Number.isFinite(actualMain[i]) && Number.isFinite(referenceMain[i])) {
            return actualMain[i] - referenceMain[i];
        }
    }
    return 0;
}

export function buildVirtualElevationFigures(input: VirtualElevationPlotInput): VirtualElevationFigures {
    const virtualSlices = createContextSlices(input.virtualElevation, input.context);
    const actualSlices = createContextSlices(input.actualElevation, input.context);
    const referenceSlices = input.referenceElevation
        ? createContextSlices(input.referenceElevation.series, input.context)
        : null;
    const referenceOffset = referenceSlices
        ? referenceAlignmentOffset(actualSlices.main, referenceSlices.main)
        : 0;

    const veOffset = actualSlices.main[0] - virtualSlices.main[0];
    const offsetMain = virtualSlices.main.map(value => value + veOffset);
    const offsetBefore = virtualSlices.before.map(value => value + veOffset);
    const offsetAfter = virtualSlices.after.map(value => value + veOffset);

    const elevationData: PlotTrace[] = [];
    if (input.context.contextBefore > 0) {
        elevationData.push(
            {
                x: input.context.xPointsBefore,
                y: offsetBefore,
                type: 'scatter',
                mode: 'lines',
                name: 'VE (trimmed)',
                line: { color: '#4363d8', width: 2 },
                opacity: 0.2,
                showlegend: false,
            },
            {
                x: input.context.xPointsBefore,
                y: actualSlices.before,
                type: 'scatter',
                mode: 'lines',
                name: 'Actual (trimmed)',
                line: { color: '#000000', width: 2 },
                opacity: 0.2,
                showlegend: false,
            },
        );
        if (referenceSlices && input.referenceElevation) {
            elevationData.push({
                x: input.context.xPointsBefore,
                y: referenceSlices.before.map(value => value + referenceOffset),
                type: 'scatter',
                mode: 'lines',
                name: `${input.referenceElevation.label} (trimmed)`,
                line: REFERENCE_ELEVATION_LINE,
                opacity: 0.2,
                showlegend: false,
            });
        }
    }

    elevationData.push(
        {
            x: input.context.xPointsMain,
            y: offsetMain,
            type: 'scatter',
            mode: 'lines',
            name: 'Virtual Elevation',
            line: { color: '#4363d8', width: 2 },
        },
        {
            x: input.context.xPointsMain,
            y: actualSlices.main,
            type: 'scatter',
            mode: 'lines',
            name: 'Actual Elevation',
            line: { color: '#000000', width: 2 },
        },
    );

    if (referenceSlices && input.referenceElevation) {
        elevationData.push({
            x: input.context.xPointsMain,
            y: referenceSlices.main.map(value => value + referenceOffset),
            type: 'scatter',
            mode: 'lines',
            name: `${input.referenceElevation.label} (aligned)`,
            line: REFERENCE_ELEVATION_LINE,
        });
    }

    if (input.context.contextAfter > 0) {
        elevationData.push(
            {
                x: input.context.xPointsAfter,
                y: offsetAfter,
                type: 'scatter',
                mode: 'lines',
                name: 'VE (trimmed)',
                line: { color: '#4363d8', width: 2 },
                opacity: 0.2,
                showlegend: false,
            },
            {
                x: input.context.xPointsAfter,
                y: actualSlices.after,
                type: 'scatter',
                mode: 'lines',
                name: 'Actual (trimmed)',
                line: { color: '#000000', width: 2 },
                opacity: 0.2,
                showlegend: false,
            },
        );
        if (referenceSlices && input.referenceElevation) {
            elevationData.push({
                x: input.context.xPointsAfter,
                y: referenceSlices.after.map(value => value + referenceOffset),
                type: 'scatter',
                mode: 'lines',
                name: `${input.referenceElevation.label} (trimmed)`,
                line: REFERENCE_ELEVATION_LINE,
                opacity: 0.2,
                showlegend: false,
            });
        }
    }

    const annotationPosition = findOptimalAnnotationPosition(
        [...offsetMain, ...actualSlices.main],
        [...input.context.xPointsMain, ...input.context.xPointsMain],
    );

    const residualsMain = offsetMain.map((value, index) => value - actualSlices.main[index]);
    const residualsBefore = offsetBefore.map((value, index) => value - actualSlices.before[index]);
    const residualsAfter = offsetAfter.map((value, index) => value - actualSlices.after[index]);

    const residualsData: PlotTrace[] = [];
    if (input.context.contextBefore > 0) {
        residualsData.push({
            x: input.context.xPointsBefore,
            y: residualsBefore,
            type: 'scatter',
            mode: 'lines',
            name: 'Residuals (trimmed)',
            line: { color: '#4363d8', width: 2 },
            opacity: 0.2,
            showlegend: false,
        });
    }

    residualsData.push({
        x: input.context.xPointsMain,
        y: residualsMain,
        type: 'scatter',
        mode: 'lines',
        name: 'VE - Actual',
        line: { color: '#4363d8', width: 2 },
    });

    if (input.context.contextAfter > 0) {
        residualsData.push({
            x: input.context.xPointsAfter,
            y: residualsAfter,
            type: 'scatter',
            mode: 'lines',
            name: 'Residuals (trimmed)',
            line: { color: '#4363d8', width: 2 },
            opacity: 0.2,
            showlegend: false,
        });
    }

    const allTimePoints = [
        ...input.context.xPointsBefore,
        ...input.context.xPointsMain,
        ...input.context.xPointsAfter,
    ];
    if (allTimePoints.length > 0) {
        residualsData.push({
            x: [allTimePoints[0], allTimePoints[allTimePoints.length - 1]],
            y: [0, 0],
            type: 'scatter',
            mode: 'lines',
            name: 'Zero Line',
            line: { color: '#7f8c8d', width: 1, dash: 'dash' },
            showlegend: false,
        });
    }

    return {
        elevation: {
            data: elevationData,
            layout: {
                title: { text: 'Virtual vs Actual Elevation Profile', font: { size: 14 } },
                xaxis: {
                    title: '',
                    showgrid: true,
                    gridcolor: '#e0e0e0',
                    showticklabels: false,
                    range: [input.context.xMin, input.context.xMax],
                },
                yaxis: {
                    title: 'Elevation (m)',
                    showgrid: true,
                    gridcolor: '#e0e0e0',
                },
                legend: { x: 0.02, y: 0.98, bgcolor: 'rgba(255,255,255,0.8)' },
                shapes: buildTrimBoundaryShapes(input.context),
                annotations: [{
                    text: `CdA: ${input.cdaLabel}<br>Crr: ${input.crrLabel}`,
                    xref: 'paper',
                    yref: 'paper',
                    x: annotationPosition.x,
                    y: annotationPosition.y,
                    xanchor: annotationPosition.xanchor,
                    yanchor: annotationPosition.yanchor,
                    showarrow: false,
                    bgcolor: 'rgba(255,255,255,0.9)',
                    bordercolor: '#4363d8',
                    borderwidth: 1,
                    borderpad: 6,
                    font: {
                        size: 12,
                        family: 'monospace',
                        color: '#2d3748',
                    },
                }],
                margin: { l: 60, r: 20, t: 40, b: 5 },
                plot_bgcolor: '#fafafa',
                paper_bgcolor: 'white',
            },
            config: getDefaultPlotConfig(),
        },
        residuals: {
            data: residualsData,
            layout: {
                title: { text: 'Residuals (Virtual - Actual Elevation)', font: { size: 12 } },
                xaxis: {
                    title: input.context.xAxisTitle,
                    showgrid: true,
                    gridcolor: '#e0e0e0',
                    range: [input.context.xMin, input.context.xMax],
                },
                yaxis: {
                    title: 'Residuals (m)',
                    showgrid: true,
                    gridcolor: '#e0e0e0',
                    zeroline: true,
                    zerolinecolor: '#7f8c8d',
                    zerolinewidth: 1,
                },
                legend: { x: 0.02, y: 0.98, bgcolor: 'rgba(255,255,255,0.8)' },
                shapes: buildTrimBoundaryShapes(input.context),
                margin: { l: 60, r: 20, t: 30, b: 60 },
                plot_bgcolor: '#fafafa',
                paper_bgcolor: 'white',
            },
            config: getDefaultPlotConfig(),
        },
    };
}

export function buildVirtualElevationComparisonFigures(input: VirtualElevationComparisonPlotInput): VirtualElevationFigures {
    const fitSlices = createContextSlices(input.virtualElevationFit, input.context);
    const constantSlices = createContextSlices(input.virtualElevationConstant, input.context);
    const actualSlices = createContextSlices(input.actualElevation, input.context);
    const referenceSlices = input.referenceElevation
        ? createContextSlices(input.referenceElevation.series, input.context)
        : null;

    // Each series is anchored INDEPENDENTLY on the first main-window actual
    // sample, through the one shared helper the GPS comparison figures also use
    // (07-04 Task 1). Output is unchanged: `comparisonTraces.test.ts` pins every
    // y value of all six traces, and was green against the hand-rolled version
    // before this call replaced it.
    const offsetFit = anchorSeriesTo(fitSlices.main, actualSlices.main[0]);
    const offsetConstant = anchorSeriesTo(constantSlices.main, actualSlices.main[0]);
    const fitResiduals = residualsAgainst(offsetFit, actualSlices.main);
    const constantResiduals = residualsAgainst(offsetConstant, actualSlices.main);

    return {
        elevation: {
            data: [
                {
                    x: input.context.xPointsMain,
                    y: offsetFit,
                    type: 'scatter',
                    mode: 'lines',
                    name: 'VE (FIT Air Speed)',
                    line: { color: '#4363d8', width: 2 },
                },
                {
                    x: input.context.xPointsMain,
                    y: actualSlices.main,
                    type: 'scatter',
                    mode: 'lines',
                    name: 'Actual Elevation',
                    line: { color: '#000000', width: 2 },
                },
                {
                    x: input.context.xPointsMain,
                    y: offsetConstant,
                    type: 'scatter',
                    mode: 'lines',
                    name: 'VE (Constant Wind)',
                    line: { color: '#a9a9a9', width: 2 },
                },
                // The non-master channel, aligned exactly as in
                // `buildVirtualElevationFigures`. Spread of a conditional
                // array keeps the six pinned traces at their indices
                // (`comparisonTraces.test.ts`) when no reference exists.
                ...(referenceSlices && input.referenceElevation
                    ? [{
                        x: input.context.xPointsMain,
                        y: referenceSlices.main.map(value =>
                            value + referenceAlignmentOffset(actualSlices.main, referenceSlices.main)),
                        type: 'scatter',
                        mode: 'lines',
                        name: `${input.referenceElevation.label} (aligned)`,
                        line: REFERENCE_ELEVATION_LINE,
                    }]
                    : []),
            ],
            layout: {
                title: 'Virtual Elevation Comparison',
                // THE UPPER HALF OF A STACKED PAIR, so no title AND NO TICK
                // LABELS — `buildVirtualElevationFigures`' elevation layout
                // above says the same thing, and this builder draws into the
                // same two containers (`bindStandardSliders.ts:184`): `#vePlot`
                // over `#veResidualsPlot`, where the lower plot carries the
                // shared x axis for both (`renderStandardVe.ts:532`).
                //
                // `showticklabels` is not cosmetic here. The `b: 5` margin below
                // leaves five pixels of gutter, so Plotly drew the tick numbers
                // straight through it and they came out sliced in half. Dropping
                // the title alone left that, because the labels were never the
                // title's doing.
                xaxis: {
                    title: '',
                    showticklabels: false,
                    // PINNED, like the non-compare pair's two axes. Two
                    // autoranged plots agree only by luck, and this pair is read
                    // as one stacked chart.
                    range: [input.context.xMin, input.context.xMax],
                },
                yaxis: { title: 'Elevation (m)' },
                showlegend: true,
                // INSIDE THE PLOT AREA, at `buildVirtualElevationFigures`'
                // coordinates. Plotly's default puts a legend outside on the
                // right and shrinks the plot area to fit it, so the width taken
                // depends on the longest entry — and this pair's two legends have
                // different longest entries ("VE (FIT Air Speed)" against
                // "Residuals (FIT Air Speed)"). The plots ended up with different
                // domains and their gridlines no longer lined up, which is worse
                // than the clipped labels it replaced: a stacked pair that does
                // not share an x position is actively misleading.
                legend: { x: 0.02, y: 0.98, bgcolor: 'rgba(255,255,255,0.8)' },
                hovermode: 'closest',
                // NO `height` HERE, and none in any other figure: the CSS
                // sizes the graph div and Plotly autosizes into it. See the
                // "one sizing convention" note at the top of this file.
                margin: { l: 60, r: 20, t: 40, b: 5 },
            },
            config: getDefaultPlotConfig(),
        },
        residuals: {
            data: [
                {
                    x: input.context.xPointsMain,
                    y: fitResiduals,
                    type: 'scatter',
                    mode: 'lines',
                    name: 'Residuals (FIT Air Speed)',
                    line: { color: '#4363d8', width: 2 },
                },
                {
                    x: input.context.xPointsMain,
                    y: constantResiduals,
                    type: 'scatter',
                    mode: 'lines',
                    name: 'Residuals (Constant Wind)',
                    line: { color: '#a9a9a9', width: 2 },
                },
                {
                    x: input.context.xPointsMain,
                    y: new Array(input.context.xPointsMain.length).fill(0),
                    type: 'scatter',
                    mode: 'lines',
                    name: 'Zero',
                    line: { color: '#95a5a6', width: 1, dash: 'dash' },
                },
            ],
            layout: {
                title: 'Residuals Comparison (Virtual - Actual)',
                xaxis: {
                    title: input.context.xAxisTitle,
                    range: [input.context.xMin, input.context.xMax],
                },
                yaxis: { title: 'Residual (m)' },
                showlegend: true,
                // Same placement as the elevation layout above, so neither plot
                // gives up horizontal space and the two share a domain.
                legend: { x: 0.02, y: 0.98, bgcolor: 'rgba(255,255,255,0.8)' },
                hovermode: 'closest',
                // Must match buildVirtualElevationFigures' residuals sizing.
                margin: { l: 60, r: 20, t: 30, b: 60 },
            },
            config: getDefaultPlotConfig(),
        },
    };
}

export function buildWindSpeedFigure(input: WindSpeedPlotInput): PlotDefinition {
    const groundSpeedKmh = input.velocity.map(value => value * 3.6);
    const groundSlices = createContextSlices(groundSpeedKmh, input.context);
    const fitWindSlices = createContextSlices(input.fitWindSpeedKmh, input.context);
    const constantWindSlices = input.constantWindApparentKmh
        ? createContextSlices(input.constantWindApparentKmh, input.context)
        : null;

    const traces: PlotTrace[] = [];
    if (input.context.contextBefore > 0) {
        traces.push({
            x: input.context.xPointsBefore,
            y: groundSlices.before,
            type: 'scatter',
            mode: 'lines',
            name: 'Ground Speed (trimmed)',
            line: { color: '#000000', width: 2 },
            opacity: 0.2,
            showlegend: false,
        });

        if (fitWindSlices.main.some(value => value !== null)) {
            traces.push({
                x: input.context.xPointsBefore,
                y: fitWindSlices.before,
                type: 'scatter',
                mode: 'lines',
                name: 'Apparent (FIT Air) (trimmed)',
                line: { color: '#4363d8', width: 2 },
                opacity: 0.2,
                showlegend: false,
            });
        }

        if (constantWindSlices) {
            traces.push({
                x: input.context.xPointsBefore,
                y: constantWindSlices.before,
                type: 'scatter',
                mode: 'lines',
                name: 'Apparent (Constant Wind) (trimmed)',
                line: { color: '#a9a9a9', width: 2 },
                opacity: 0.2,
                showlegend: false,
            });
        }
    }

    traces.push({
        x: input.context.xPointsMain,
        y: groundSlices.main,
        type: 'scatter',
        mode: 'lines',
        name: 'Ground Speed',
        line: { color: '#000000', width: 2 },
    });

    if (fitWindSlices.main.some(value => value !== null)) {
        traces.push({
            x: input.context.xPointsMain,
            y: fitWindSlices.main,
            type: 'scatter',
            mode: 'lines',
            name: 'Apparent (FIT Air)',
            line: { color: '#4363d8', width: 2 },
        });
    }

    if (constantWindSlices) {
        traces.push({
            x: input.context.xPointsMain,
            y: constantWindSlices.main,
            type: 'scatter',
            mode: 'lines',
            name: 'Apparent (Constant Wind)',
            line: { color: '#a9a9a9', width: 2 },
        });
    }

    if (input.context.contextAfter > 0) {
        traces.push({
            x: input.context.xPointsAfter,
            y: groundSlices.after,
            type: 'scatter',
            mode: 'lines',
            name: 'Ground Speed (trimmed)',
            line: { color: '#000000', width: 2 },
            opacity: 0.2,
            showlegend: false,
        });

        if (fitWindSlices.main.some(value => value !== null)) {
            traces.push({
                x: input.context.xPointsAfter,
                y: fitWindSlices.after,
                type: 'scatter',
                mode: 'lines',
                name: 'Apparent (FIT Air) (trimmed)',
                line: { color: '#4363d8', width: 2 },
                opacity: 0.2,
                showlegend: false,
            });
        }

        if (constantWindSlices) {
            traces.push({
                x: input.context.xPointsAfter,
                y: constantWindSlices.after,
                type: 'scatter',
                mode: 'lines',
                name: 'Apparent (Constant Wind) (trimmed)',
                line: { color: '#a9a9a9', width: 2 },
                opacity: 0.2,
                showlegend: false,
            });
        }
    }

    return {
        data: traces,
        layout: {
            title: { text: 'Wind Speed Analysis', font: { size: 14 } },
            xaxis: {
                title: input.context.xAxisTitle,
                showgrid: true,
                gridcolor: '#e0e0e0',
                range: [input.context.xMin, input.context.xMax],
            },
            yaxis: {
                title: 'Speed (km/h)',
                showgrid: true,
                gridcolor: '#e0e0e0',
            },
            legend: { x: 0.02, y: 0.98, bgcolor: 'rgba(255,255,255,0.8)' },
            shapes: buildTrimBoundaryShapes(input.context),
            margin: { l: 60, r: 20, t: 40, b: 60 },
            plot_bgcolor: '#fafafa',
            paper_bgcolor: 'white',
        },
        config: { responsive: true },
    };
}

export function buildSpeedPowerFigure(input: SpeedPowerPlotInput): PlotDefinition {
    const speedKmh = input.velocity.map(value => value * 3.6);
    const speedSlices = createContextSlices(speedKmh, input.context);
    const powerSlices = createContextSlices(input.power, input.context);

    const traces: PlotTrace[] = [];
    if (input.context.contextBefore > 0) {
        traces.push(
            {
                x: input.context.xPointsBefore,
                y: speedSlices.before,
                type: 'scatter',
                mode: 'lines',
                name: 'Speed (trimmed)',
                line: { color: '#000000', width: 2 },
                opacity: 0.2,
                showlegend: false,
                yaxis: 'y',
            },
            {
                x: input.context.xPointsBefore,
                y: powerSlices.before,
                type: 'scatter',
                mode: 'lines',
                name: 'Power (trimmed)',
                line: { color: '#4363d8', width: 2 },
                opacity: 0.2,
                showlegend: false,
                yaxis: 'y2',
            },
        );
    }

    traces.push(
        {
            x: input.context.xPointsMain,
            y: speedSlices.main,
            type: 'scatter',
            mode: 'lines',
            name: 'Speed',
            line: { color: '#000000', width: 2 },
            yaxis: 'y',
        },
        {
            x: input.context.xPointsMain,
            y: powerSlices.main,
            type: 'scatter',
            mode: 'lines',
            name: 'Power',
            line: { color: '#4363d8', width: 2 },
            yaxis: 'y2',
        },
    );

    if (input.context.contextAfter > 0) {
        traces.push(
            {
                x: input.context.xPointsAfter,
                y: speedSlices.after,
                type: 'scatter',
                mode: 'lines',
                name: 'Speed (trimmed)',
                line: { color: '#000000', width: 2 },
                opacity: 0.2,
                showlegend: false,
                yaxis: 'y',
            },
            {
                x: input.context.xPointsAfter,
                y: powerSlices.after,
                type: 'scatter',
                mode: 'lines',
                name: 'Power (trimmed)',
                line: { color: '#4363d8', width: 2 },
                opacity: 0.2,
                showlegend: false,
                yaxis: 'y2',
            },
        );
    }

    return {
        data: traces,
        layout: {
            title: { text: 'Speed & Power', font: { size: 14 } },
            xaxis: {
                title: input.context.xAxisTitle,
                showgrid: true,
                gridcolor: '#e0e0e0',
                range: [input.context.xMin, input.context.xMax],
            },
            yaxis: {
                title: 'Speed (km/h)',
                titlefont: { color: '#000000' },
                tickfont: { color: '#000000' },
                showgrid: true,
                gridcolor: '#e0e0e0',
            },
            yaxis2: {
                title: 'Power (W)',
                titlefont: { color: '#4363d8' },
                tickfont: { color: '#4363d8' },
                overlaying: 'y',
                side: 'right',
                showgrid: false,
            },
            legend: { x: 0.02, y: 0.98, bgcolor: 'rgba(255,255,255,0.8)' },
            shapes: buildTrimBoundaryShapes(input.context),
            margin: { l: 60, r: 60, t: 40, b: 60 },
            plot_bgcolor: '#fafafa',
            paper_bgcolor: 'white',
        },
        config: { responsive: true },
    };
}

/**
 * The endpoint of each plotted curve at the trim end, in km.
 *
 * This is deliberately derived from the SAME integration the figure draws
 * rather than from a VE result: the `#vdAirValue` / `#vdGroundValue` /
 * `#vdDiffValue` spans sit directly above that curve, and a header sourced from
 * anywhere else drifts away from it the moment a trim slider moves.
 */
export function computeVirtualDistanceTotals(input: VirtualDistancePlotInput): VirtualDistanceTotals {
    return computeVirtualDistanceWindowTotals({
        timestamps: input.timestamps,
        velocity: input.velocity,
        windSpeed: input.windSpeed,
        trimStart: input.context.trimStart,
        trimEnd: input.context.trimEnd,
    });
}

export function buildVirtualDistanceFigure(input: VirtualDistancePlotInput): PlotDefinition {
    const { air: vdAir, ground: vdGround } = integrateVirtualDistance(
        input.timestamps,
        input.velocity,
        input.windSpeed,
        input.context.trimStart,
    );

    const airSlices = createContextSlices(vdAir.map(value => value / 1000), input.context);
    const groundSlices = createContextSlices(vdGround.map(value => value / 1000), input.context);

    const traces: PlotTrace[] = [];
    if (input.context.contextBefore > 0) {
        traces.push(
            {
                x: input.context.xPointsBefore,
                y: airSlices.before,
                type: 'scatter',
                mode: 'lines',
                name: 'VD Air (trimmed)',
                line: { color: '#4363d8', width: 2 },
                opacity: 0.2,
                showlegend: false,
            },
            {
                x: input.context.xPointsBefore,
                y: groundSlices.before,
                type: 'scatter',
                mode: 'lines',
                name: 'VD Ground (trimmed)',
                line: { color: '#000000', width: 2 },
                opacity: 0.2,
                showlegend: false,
            },
        );
    }

    traces.push(
        {
            x: input.context.xPointsMain,
            y: airSlices.main,
            type: 'scatter',
            mode: 'lines',
            name: 'VD from Air Speed',
            line: { color: '#4363d8', width: 2 },
        },
        {
            x: input.context.xPointsMain,
            y: groundSlices.main,
            type: 'scatter',
            mode: 'lines',
            name: 'VD from Ground Speed',
            line: { color: '#000000', width: 2 },
        },
    );

    if (input.context.contextAfter > 0) {
        traces.push(
            {
                x: input.context.xPointsAfter,
                y: airSlices.after,
                type: 'scatter',
                mode: 'lines',
                name: 'VD Air (trimmed)',
                line: { color: '#4363d8', width: 2 },
                opacity: 0.2,
                showlegend: false,
            },
            {
                x: input.context.xPointsAfter,
                y: groundSlices.after,
                type: 'scatter',
                mode: 'lines',
                name: 'VD Ground (trimmed)',
                line: { color: '#000000', width: 2 },
                opacity: 0.2,
                showlegend: false,
            },
        );
    }

    return {
        data: traces,
        layout: {
            title: { text: 'Virtual Distance: Air Speed vs Ground Speed', font: { size: 14 } },
            xaxis: {
                title: input.context.xAxisTitle,
                showgrid: true,
                gridcolor: '#e0e0e0',
                range: [input.context.xMin, input.context.xMax],
            },
            yaxis: {
                title: 'Cumulative Distance (km)',
                showgrid: true,
                gridcolor: '#e0e0e0',
            },
            legend: { x: 0.02, y: 0.98, bgcolor: 'rgba(255,255,255,0.8)' },
            shapes: buildTrimBoundaryShapes(input.context),
            margin: { l: 60, r: 60, t: 40, b: 60 },
            plot_bgcolor: '#fafafa',
            paper_bgcolor: 'white',
        },
        config: { responsive: true },
    };
}

function findOptimalAnnotationPosition(elevationData: number[], timeData: number[]): {
    x: number;
    y: number;
    xanchor: 'left' | 'right';
    yanchor: 'top' | 'bottom';
} {
    if (elevationData.length === 0) {
        return { x: 0.98, y: 0.98, xanchor: 'right', yanchor: 'top' };
    }

    const minElevation = Math.min(...elevationData);
    const maxElevation = Math.max(...elevationData);
    const elevationRange = maxElevation - minElevation;
    const minTime = Math.min(...timeData);
    const maxTime = Math.max(...timeData);
    const timeRange = maxTime - minTime;

    const corners = [
        {
            x: 0.98,
            y: 0.98,
            xanchor: 'right' as const,
            yanchor: 'top' as const,
            timeMin: minTime + 0.7 * timeRange,
            timeMax: maxTime,
            elevationMin: minElevation + 0.7 * elevationRange,
            elevationMax: maxElevation,
        },
        {
            x: 0.98,
            y: 0.02,
            xanchor: 'right' as const,
            yanchor: 'bottom' as const,
            timeMin: minTime + 0.7 * timeRange,
            timeMax: maxTime,
            elevationMin: minElevation,
            elevationMax: minElevation + 0.3 * elevationRange,
        },
        {
            x: 0.02,
            y: 0.02,
            xanchor: 'left' as const,
            yanchor: 'bottom' as const,
            timeMin: minTime,
            timeMax: minTime + 0.3 * timeRange,
            elevationMin: minElevation,
            elevationMax: minElevation + 0.3 * elevationRange,
        },
    ];

    const scoredCorners = corners.map(corner => ({
        ...corner,
        score: elevationData.reduce((count, elevation, index) => {
            const time = timeData[index];
            return time >= corner.timeMin && time <= corner.timeMax && elevation >= corner.elevationMin && elevation <= corner.elevationMax
                ? count + 1
                : count;
        }, 0),
    }));

    return scoredCorners.reduce((best, current) => current.score < best.score ? current : best);
}
