import type { SegmentSupplementarySeries } from '../analysis/SegmentSupplementarySeries';
import {
    BELOW_AXIS_LEGEND_MARGIN_B,
    belowAxisLegend,
    getDefaultPlotConfig,
    type PlotDefinition,
    type PlotTrace,
} from './StandardPlotBuilders';

export interface MultiSegmentSeries {
    label: string;
    color: string;
    metrics: SegmentSupplementarySeries;
    dash?: 'solid' | 'dash' | 'dot';
}

export interface MultiSegmentFigureInput {
    title: string;
    series: MultiSegmentSeries[];
}

export function buildMultiSegmentWindFigure(input: MultiSegmentFigureInput): PlotDefinition {
    const traces = input.series.flatMap(series => createLineTrace({
        x: series.metrics.distancesKm,
        y: series.metrics.apparentWindSpeedMps.map(value => Number.isFinite(value) ? value * 3.6 : null),
        name: series.label,
        color: series.color,
        dash: series.dash,
    }));

    return createFigure({
        title: input.title,
        traces,
        yAxisTitle: 'Apparent Speed (km/h)',
    });
}

export function buildMultiSegmentPowerFigure(input: MultiSegmentFigureInput): PlotDefinition {
    const traces = input.series.flatMap(series => createLineTrace({
        x: series.metrics.distancesKm,
        y: series.metrics.powerWatts.map(value => Number.isFinite(value) ? value : null),
        name: series.label,
        color: series.color,
        dash: series.dash,
    }));

    return createFigure({
        title: input.title,
        traces,
        yAxisTitle: 'Power (W)',
    });
}

export function buildMultiSegmentVirtualDistanceFigure(input: MultiSegmentFigureInput): PlotDefinition {
    const traces = input.series.flatMap(series => {
        const deltaKm = series.metrics.virtualDistanceAirKm.map((airKm, index) => {
            const groundKm = series.metrics.virtualDistanceGroundKm[index] ?? 0;
            return Number.isFinite(airKm) && Number.isFinite(groundKm) ? airKm - groundKm : null;
        });

        return createLineTrace({
            x: series.metrics.distancesKm,
            y: deltaKm,
            name: series.label,
            color: series.color,
            dash: series.dash,
        });
    });

    const maxDistance = Math.max(
        0,
        ...input.series.map(series => series.metrics.distancesKm[series.metrics.distancesKm.length - 1] ?? 0),
    );

    traces.push({
        x: [0, maxDistance],
        y: [0, 0],
        type: 'scatter',
        mode: 'lines',
        name: 'Zero Line',
        line: { color: '#7f8c8d', width: 1, dash: 'dash' },
        showlegend: false,
    });

    return createFigure({
        title: input.title,
        traces,
        yAxisTitle: 'Air - Ground Distance (km)',
    });
}

function createFigure(input: {
    title: string;
    traces: PlotTrace[];
    yAxisTitle: string;
}): PlotDefinition {
    return {
        data: input.traces,
        layout: {
            title: { text: input.title, font: { size: 14 } },
            xaxis: {
                title: 'Distance (km)',
                showgrid: true,
                gridcolor: '#e0e0e0',
            },
            yaxis: {
                title: input.yAxisTitle,
                showgrid: true,
                gridcolor: '#e0e0e0',
            },
            legend: belowAxisLegend(),
            margin: { l: 60, r: 20, t: 40, b: BELOW_AXIS_LEGEND_MARGIN_B },
            hovermode: 'closest',
            plot_bgcolor: '#fafafa',
            paper_bgcolor: 'white',
        },
        config: getDefaultPlotConfig(),
    };
}

function createLineTrace(input: {
    x: number[];
    y: Array<number | null>;
    name: string;
    color: string;
    dash?: 'solid' | 'dash' | 'dot';
}): PlotTrace[] {
    if (input.x.length === 0 || input.y.length === 0) {
        return [];
    }

    return [{
        x: input.x,
        y: input.y,
        type: 'scatter',
        mode: 'lines',
        name: input.name,
        line: {
            color: input.color,
            width: 2,
            dash: input.dash ?? 'solid',
        },
        connectgaps: false,
    }];
}
