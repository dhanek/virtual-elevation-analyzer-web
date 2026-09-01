/**
 * ONE SIZING CONVENTION, ACROSS EVERY PLOT IN EVERY MODE.
 *
 * The convention: the graph div gets its height from CSS, and NO figure sets
 * `layout.height`. It is the only convention compatible with the two things
 * that re-measure a plot after it is drawn — `config.responsive` (re-autosizes
 * on window resize) and `Plots.resize` (called by the tab layer when a hidden
 * pane becomes visible).
 *
 * Standard used to be the exception, and the exception is what broke: its
 * figures pinned `height: 350`/`200` into containers with no CSS height, so
 * `Plots.resize` — whose guard is `layout.width && layout.height` — deleted the
 * height and re-autosized into a box that was itself sized by the plot.
 * Measured in Chrome: 350 px -> 26 px, and 26 px again on every later resize.
 *
 * These cases exist because the failure is INVISIBLE at the unit level: a
 * figure with a pinned height looks perfectly reasonable on its own, and only
 * the interaction with the container and the resize call makes it wrong. A
 * pinned height is a defect no matter how sensible the number is.
 */
import { describe, expect, it } from 'vitest'
import {
    buildSpeedPowerFigure,
    buildVirtualDistanceFigure,
    buildVirtualElevationComparisonFigures,
    buildVirtualElevationFigures,
    buildWindSpeedFigure,
} from './StandardPlotBuilders'
import { createPlotContext } from './PlotContext'
import { buildClosureContourFigure } from './ConvergencePlotBuilders'

const LENGTH = 20
const context = createPlotContext(LENGTH, 2, 17)
const series = (scale: number) => Array.from({ length: LENGTH }, (_, i) => i * scale)

/** Every figure the Standard panel can draw, by the id it is drawn into. */
const figures: Array<[string, { layout: Record<string, unknown> }]> = [
    ['vePlot', buildVirtualElevationFigures({
        context,
        virtualElevation: series(1.1),
        actualElevation: series(1),
        cdaLabel: '0.250',
        crrLabel: '0.0040',
    }).elevation],
    ['veResidualsPlot', buildVirtualElevationFigures({
        context,
        virtualElevation: series(1.1),
        actualElevation: series(1),
        cdaLabel: '0.250',
        crrLabel: '0.0040',
    }).residuals],
    ['vePlot (compare)', buildVirtualElevationComparisonFigures({
        context,
        virtualElevationFit: series(1.1),
        virtualElevationConstant: series(0.9),
        actualElevation: series(1),
    }).elevation],
    ['veResidualsPlot (compare)', buildVirtualElevationComparisonFigures({
        context,
        virtualElevationFit: series(1.1),
        virtualElevationConstant: series(0.9),
        actualElevation: series(1),
    }).residuals],
    ['windSpeedPlot', buildWindSpeedFigure({
        context,
        velocity: series(10),
        fitWindSpeedKmh: series(1),
    })],
    ['speedPowerPlot', buildSpeedPowerFigure({
        context,
        velocity: series(10),
        power: series(20),
    })],
    ['vdPlot', buildVirtualDistanceFigure({
        context,
        timestamps: series(1),
        velocity: series(10),
        windSpeed: series(0.5),
    })],
    ['convergencePlot', buildClosureContourFigure({
        surface: {
            z: [[1, 2], [2, 1]],
            ridgeCda: [0.2, 0.3],
            ridgeCrr: [0.004, 0.005],
            best: { cda: 0.3, crr: 0.005, error: 0.1 },
            clipped: false,
            underdetermined: null,
        },
        cdaValues: [0.2, 0.3],
        crrValues: [0.004, 0.005],
        marker: { cda: 0.25, crr: 0.0045 },
        segmentCount: 1,
        targetLabel: 'DEM',
        gridSteps: 41,
    })],
]

describe('no Standard figure carries its own height', () => {
    it.each(figures)('%s leaves the height to the container CSS', (_id, figure) => {
        expect(figure.layout.height).toBeUndefined()
    })

    it.each(figures)('%s leaves the width to the container too', (_id, figure) => {
        // A width would be worse than a height, not better: it would satisfy
        // `Plots.resize`'s `width && height` guard only when BOTH are set, and
        // pin the plot against the panel on every screen size.
        expect(figure.layout.width).toBeUndefined()
    })
})
