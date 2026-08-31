/**
 * ONE BELOW-AXIS LEGEND CONVENTION, ACROSS EVERY OVERLAY PLOT IN EVERY MODE.
 *
 * The convention: a legend placed BELOW the x-axis is positioned with
 * `belowAxisLegend()` against `yref: 'container'`, and the figure's bottom
 * margin is `BELOW_AXIS_LEGEND_MARGIN_B`. Never a negative paper fraction.
 *
 * The three overlay figures — out-and-back VE, GPS-lap stacked VE, and the
 * shared multi-segment wind/power/VD builder — each hardcoded their own
 * `y: -0.15` / `y: -0.2`. Under `yref: 'paper'` that unit is a fraction of the
 * PLOT AREA, while the x-axis title below it is placed at a fixed PIXEL offset.
 * The two only agreed while every canvas carried a fixed `layout.height`; once
 * the heights moved into CSS `clamp()`s the plot area began shrinking with the
 * viewport and the same fraction bought fewer pixels, until the legend sat on
 * top of `Distance (km)`. Observed in the out-and-back VE plot, 2026-08-31.
 *
 * These cases exist because the failure is INVISIBLE at the unit level and at
 * most window sizes: each figure looks correct on its own and at a tall
 * viewport, and only the interaction between a fractional legend offset, a
 * pixel axis title and a clamped container height makes it wrong. A negative
 * paper `y` is a defect here no matter how sensible the number looks, because
 * no single fraction can clear the title at the clamp minimum without pushing
 * the legend off the figure at the clamp maximum.
 */
import { describe, expect, it } from 'vitest'
import {
    BELOW_AXIS_LEGEND_MARGIN_B,
    belowAxisLegend,
} from './StandardPlotBuilders'
import {
    buildMultiSegmentPowerFigure,
    buildMultiSegmentVirtualDistanceFigure,
    buildMultiSegmentWindFigure,
} from './MultiSegmentPlotBuilders'
import type { SegmentSupplementarySeries } from '../analysis/SegmentSupplementarySeries'

const LENGTH = 12
const series = (scale: number) => Array.from({ length: LENGTH }, (_, i) => i * scale)

const metrics: SegmentSupplementarySeries = {
    distancesKm: series(0.1),
    powerWatts: series(20),
    apparentWindSpeedMps: series(1),
    virtualDistanceAirKm: series(0.11),
    virtualDistanceGroundKm: series(0.1),
}

const overlaySeries = [
    { label: 'Lap 1', color: '#1f77b4', metrics },
    { label: 'Lap 2', color: '#d62728', metrics },
]

/** Every figure in the app whose legend sits below the x-axis. */
const figures: Array<[string, { layout: Record<string, unknown> }]> = [
    ['multi-segment wind', buildMultiSegmentWindFigure({ title: 'Wind', series: overlaySeries })],
    ['multi-segment power', buildMultiSegmentPowerFigure({ title: 'Power', series: overlaySeries })],
    ['multi-segment VD', buildMultiSegmentVirtualDistanceFigure({ title: 'VD', series: overlaySeries })],
]

describe('below-axis legends are pinned to the container, not the plot area', () => {
    it.each(figures)('%s positions its legend against the container', (_id, figure) => {
        expect(figure.layout.legend).toEqual(belowAxisLegend())
    })

    it.each(figures)('%s leaves room for the legend AND the axis title', (_id, figure) => {
        // The legend and the margin are one setting in two fields: pinning the
        // legend to the figure's bottom edge only works if the margin there is
        // deep enough to hold it and the axis title above it.
        expect((figure.layout.margin as { b: number }).b).toBe(BELOW_AXIS_LEGEND_MARGIN_B)
    })

    it.each(figures)('%s never reintroduces a negative paper fraction', (_id, figure) => {
        const legend = figure.layout.legend as { y?: number; yref?: string }
        expect(legend.yref).toBe('container')
        expect(legend.y).toBeGreaterThanOrEqual(0)
    })
})

describe('belowAxisLegend itself', () => {
    it('measures from the figure bottom edge, anchored by its own bottom', () => {
        // `yref: 'container'` with any other anchor would put the legend's
        // MIDDLE or TOP on the bottom edge and hang the rest off the figure.
        expect(belowAxisLegend()).toEqual({
            orientation: 'h',
            yref: 'container',
            yanchor: 'bottom',
            y: 0,
            x: 0.5,
            xanchor: 'center',
        })
    })

    it('centres the legend rather than taking Plotly\'s left default', () => {
        // `legend.x` defaults to 0. The old layouts looked centred only because
        // their entries happened to fill the width; setting `yref` made the
        // default visible as a hard-left legend.
        const legend = belowAxisLegend() as { x: number; xanchor: string }
        expect(legend.x).toBe(0.5)
        expect(legend.xanchor).toBe('center')
    })
})
