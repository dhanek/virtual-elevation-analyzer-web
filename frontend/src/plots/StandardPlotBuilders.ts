import { buildTrimBoundaryShapes, createContextSlices, type PlotContext } from './PlotContext';

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
}

export interface VirtualElevationPlotInput {
    context: PlotContext;
    virtualElevation: number[];
    actualElevation: number[];
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

export function buildVirtualElevationFigures(input: VirtualElevationPlotInput): VirtualElevationFigures {
    const virtualSlices = createContextSlices(input.virtualElevation, input.context);
    const actualSlices = createContextSlices(input.actualElevation, input.context);

    const veOffset = actualSlices.main[0] - virtualSlices.main[0];
    const offsetMain = virtualSlices.main.map(value => value + veOffset);
    const offsetBefore = virtualSlices.before.map(value => value + veOffset);
    const offsetAfter = virtualSlices.after.map(value => value + veOffset);

    const elevationData: PlotTrace[] = [];
    if (input.context.contextBefore > 0) {
        elevationData.push(
            {
                x: input.context.timePointsBefore,
                y: offsetBefore,
                type: 'scatter',
                mode: 'lines',
                name: 'VE (trimmed)',
                line: { color: '#4363d8', width: 2 },
                opacity: 0.2,
                showlegend: false,
            },
            {
                x: input.context.timePointsBefore,
                y: actualSlices.before,
                type: 'scatter',
                mode: 'lines',
                name: 'Actual (trimmed)',
                line: { color: '#000000', width: 2 },
                opacity: 0.2,
                showlegend: false,
            },
        );
    }

    elevationData.push(
        {
            x: input.context.timePointsMain,
            y: offsetMain,
            type: 'scatter',
            mode: 'lines',
            name: 'Virtual Elevation',
            line: { color: '#4363d8', width: 2 },
        },
        {
            x: input.context.timePointsMain,
            y: actualSlices.main,
            type: 'scatter',
            mode: 'lines',
            name: 'Actual Elevation',
            line: { color: '#000000', width: 2 },
        },
    );

    if (input.context.contextAfter > 0) {
        elevationData.push(
            {
                x: input.context.timePointsAfter,
                y: offsetAfter,
                type: 'scatter',
                mode: 'lines',
                name: 'VE (trimmed)',
                line: { color: '#4363d8', width: 2 },
                opacity: 0.2,
                showlegend: false,
            },
            {
                x: input.context.timePointsAfter,
                y: actualSlices.after,
                type: 'scatter',
                mode: 'lines',
                name: 'Actual (trimmed)',
                line: { color: '#000000', width: 2 },
                opacity: 0.2,
                showlegend: false,
            },
        );
    }

    const annotationPosition = findOptimalAnnotationPosition(
        [...offsetMain, ...actualSlices.main],
        [...input.context.timePointsMain, ...input.context.timePointsMain],
    );

    const residualsMain = offsetMain.map((value, index) => value - actualSlices.main[index]);
    const residualsBefore = offsetBefore.map((value, index) => value - actualSlices.before[index]);
    const residualsAfter = offsetAfter.map((value, index) => value - actualSlices.after[index]);

    const residualsData: PlotTrace[] = [];
    if (input.context.contextBefore > 0) {
        residualsData.push({
            x: input.context.timePointsBefore,
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
        x: input.context.timePointsMain,
        y: residualsMain,
        type: 'scatter',
        mode: 'lines',
        name: 'VE - Actual',
        line: { color: '#4363d8', width: 2 },
    });

    if (input.context.contextAfter > 0) {
        residualsData.push({
            x: input.context.timePointsAfter,
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
        ...input.context.timePointsBefore,
        ...input.context.timePointsMain,
        ...input.context.timePointsAfter,
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
                height: 350,
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
                    title: 'Time (seconds)',
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
                height: 200,
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

    const fitOffset = actualSlices.main[0] - fitSlices.main[0];
    const constantOffset = actualSlices.main[0] - constantSlices.main[0];
    const offsetFit = fitSlices.main.map(value => value + fitOffset);
    const offsetConstant = constantSlices.main.map(value => value + constantOffset);
    const fitResiduals = offsetFit.map((value, index) => value - actualSlices.main[index]);
    const constantResiduals = offsetConstant.map((value, index) => value - actualSlices.main[index]);

    return {
        elevation: {
            data: [
                {
                    x: input.context.timePointsMain,
                    y: offsetFit,
                    type: 'scatter',
                    mode: 'lines',
                    name: 'VE (FIT Air Speed)',
                    line: { color: '#4363d8', width: 2 },
                },
                {
                    x: input.context.timePointsMain,
                    y: actualSlices.main,
                    type: 'scatter',
                    mode: 'lines',
                    name: 'Actual Elevation',
                    line: { color: '#000000', width: 2 },
                },
                {
                    x: input.context.timePointsMain,
                    y: offsetConstant,
                    type: 'scatter',
                    mode: 'lines',
                    name: 'VE (Constant Wind)',
                    line: { color: '#a9a9a9', width: 2 },
                },
            ],
            layout: {
                title: 'Virtual Elevation Comparison',
                xaxis: { title: 'Time Point' },
                yaxis: { title: 'Elevation (m)' },
                showlegend: true,
                hovermode: 'closest',
                // Must match buildVirtualElevationFigures. `.ve-plot-container`
                // is flex:1 inside a display:block tab pane with no height, so a
                // responsive figure with no layout.height collapses to unreadable.
                margin: { l: 60, r: 20, t: 40, b: 5 },
                height: 350,
            },
            config: getDefaultPlotConfig(),
        },
        residuals: {
            data: [
                {
                    x: input.context.timePointsMain,
                    y: fitResiduals,
                    type: 'scatter',
                    mode: 'lines',
                    name: 'Residuals (FIT Air Speed)',
                    line: { color: '#4363d8', width: 2 },
                },
                {
                    x: input.context.timePointsMain,
                    y: constantResiduals,
                    type: 'scatter',
                    mode: 'lines',
                    name: 'Residuals (Constant Wind)',
                    line: { color: '#a9a9a9', width: 2 },
                },
                {
                    x: input.context.timePointsMain,
                    y: new Array(input.context.timePointsMain.length).fill(0),
                    type: 'scatter',
                    mode: 'lines',
                    name: 'Zero',
                    line: { color: '#95a5a6', width: 1, dash: 'dash' },
                },
            ],
            layout: {
                title: 'Residuals Comparison (Virtual - Actual)',
                xaxis: { title: 'Time Point' },
                yaxis: { title: 'Residual (m)' },
                showlegend: true,
                hovermode: 'closest',
                // Must match buildVirtualElevationFigures' residuals sizing.
                margin: { l: 60, r: 20, t: 30, b: 60 },
                height: 200,
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
            x: input.context.timePointsBefore,
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
                x: input.context.timePointsBefore,
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
                x: input.context.timePointsBefore,
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
        x: input.context.timePointsMain,
        y: groundSlices.main,
        type: 'scatter',
        mode: 'lines',
        name: 'Ground Speed',
        line: { color: '#000000', width: 2 },
    });

    if (fitWindSlices.main.some(value => value !== null)) {
        traces.push({
            x: input.context.timePointsMain,
            y: fitWindSlices.main,
            type: 'scatter',
            mode: 'lines',
            name: 'Apparent (FIT Air)',
            line: { color: '#4363d8', width: 2 },
        });
    }

    if (constantWindSlices) {
        traces.push({
            x: input.context.timePointsMain,
            y: constantWindSlices.main,
            type: 'scatter',
            mode: 'lines',
            name: 'Apparent (Constant Wind)',
            line: { color: '#a9a9a9', width: 2 },
        });
    }

    if (input.context.contextAfter > 0) {
        traces.push({
            x: input.context.timePointsAfter,
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
                x: input.context.timePointsAfter,
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
                x: input.context.timePointsAfter,
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
                title: 'Time (seconds)',
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
                x: input.context.timePointsBefore,
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
                x: input.context.timePointsBefore,
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
            x: input.context.timePointsMain,
            y: speedSlices.main,
            type: 'scatter',
            mode: 'lines',
            name: 'Speed',
            line: { color: '#000000', width: 2 },
            yaxis: 'y',
        },
        {
            x: input.context.timePointsMain,
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
                x: input.context.timePointsAfter,
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
                x: input.context.timePointsAfter,
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
                title: 'Time (seconds)',
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

/** Cumulative air / ground virtual distance in metres, indexed like the input. */
export interface VirtualDistanceIntegration {
    air: number[];
    ground: number[];
}

/** The two virtual distances over the trim window, plus their relative gap. */
export interface VirtualDistanceTotals {
    airKm: number;
    groundKm: number;
    /** ((air - ground) / ground) * 100, matching the Rust reference definition. */
    differencePercent: number;
}

/**
 * D-21: integrate the series exactly as given. No calibration multiplier lives
 * here any more; see VirtualDistancePlotInput.
 *
 * Shared by the figure and by `computeVirtualDistanceTotals` so the numbers in
 * the VD header can never disagree with the curve they sit above.
 */
function integrateVirtualDistance(input: VirtualDistancePlotInput): VirtualDistanceIntegration {
    const air: number[] = new Array(input.timestamps.length).fill(0);
    const ground: number[] = new Array(input.timestamps.length).fill(0);

    for (let i = input.context.trimStart + 1; i < input.timestamps.length; i++) {
        const dt = input.timestamps[i] - input.timestamps[i - 1];

        const apparentSpeed = !isNaN(input.windSpeed[i]) ? input.windSpeed[i] : 0;
        air[i] = air[i - 1] + (apparentSpeed > 0 ? apparentSpeed : 0) * dt;

        const groundSpeed = !isNaN(input.velocity[i]) && input.velocity[i] > 0 ? input.velocity[i] : 0;
        ground[i] = ground[i - 1] + groundSpeed * dt;
    }

    return { air, ground };
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
    const { air, ground } = integrateVirtualDistance(input);
    const endIndex = Math.min(input.context.trimEnd, air.length - 1);

    if (endIndex < 0) {
        return { airKm: 0, groundKm: 0, differencePercent: 0 };
    }

    const airMeters = air[endIndex];
    const groundMeters = ground[endIndex];

    return {
        airKm: airMeters / 1000,
        groundKm: groundMeters / 1000,
        differencePercent: groundMeters > 0 ? ((airMeters - groundMeters) / groundMeters) * 100 : 0,
    };
}

export function buildVirtualDistanceFigure(input: VirtualDistancePlotInput): PlotDefinition {
    const { air: vdAir, ground: vdGround } = integrateVirtualDistance(input);

    const airSlices = createContextSlices(vdAir.map(value => value / 1000), input.context);
    const groundSlices = createContextSlices(vdGround.map(value => value / 1000), input.context);

    const traces: PlotTrace[] = [];
    if (input.context.contextBefore > 0) {
        traces.push(
            {
                x: input.context.timePointsBefore,
                y: airSlices.before,
                type: 'scatter',
                mode: 'lines',
                name: 'VD Air (trimmed)',
                line: { color: '#4363d8', width: 2 },
                opacity: 0.2,
                showlegend: false,
            },
            {
                x: input.context.timePointsBefore,
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
            x: input.context.timePointsMain,
            y: airSlices.main,
            type: 'scatter',
            mode: 'lines',
            name: 'VD from Air Speed',
            line: { color: '#4363d8', width: 2 },
        },
        {
            x: input.context.timePointsMain,
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
                x: input.context.timePointsAfter,
                y: airSlices.after,
                type: 'scatter',
                mode: 'lines',
                name: 'VD Air (trimmed)',
                line: { color: '#4363d8', width: 2 },
                opacity: 0.2,
                showlegend: false,
            },
            {
                x: input.context.timePointsAfter,
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
                title: 'Time (seconds)',
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
