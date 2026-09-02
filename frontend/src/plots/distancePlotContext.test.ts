/**
 * The distance x-axis context (bundle D).
 *
 * The switch is a CONTEXT SWAP: all four Standard figures take their x from
 * `context.xPoints{Before,Main,After}`, their range from `xMin`/`xMax` and
 * their trim lines from `xTrimStart`/`xTrimEnd`, so if this builder is right
 * every plot is right and no figure builder needs to know which axis it draws.
 * That is what these cases hold.
 */
import { describe, expect, it } from 'vitest'
import {
    buildTrimBoundaryShapes,
    createContextSlices,
    createDistancePlotContext,
    createPlotContext,
    X_AXIS_TITLES,
} from './PlotContext'

/** 20 samples, 100 m apart: 0.0, 0.1, ... 1.9 km. */
const km = Array.from({ length: 20 }, (_, i) => i * 0.1)

describe('createDistancePlotContext', () => {
    it('keeps the index bookkeeping identical to the time context', () => {
        // The whole design rests on this: same trim window, same side context,
        // same slices. Only the x VALUES differ, which is why one switch moves
        // four plots without touching a single figure builder.
        const time = createPlotContext(km.length, 8, 14)
        const distance = createDistancePlotContext(km, 8, 14)

        expect(distance.trimStart).toBe(time.trimStart)
        expect(distance.trimEnd).toBe(time.trimEnd)
        expect(distance.contextBefore).toBe(time.contextBefore)
        expect(distance.contextAfter).toBe(time.contextAfter)
        expect(distance.extendedStart).toBe(time.extendedStart)
        expect(distance.extendedEnd).toBe(time.extendedEnd)
        expect(distance.xPointsMain).toHaveLength(time.xPointsMain.length)
        expect(distance.xPointsBefore).toHaveLength(time.xPointsBefore.length)
        expect(distance.xPointsAfter).toHaveLength(time.xPointsAfter.length)
    })

    it('plots each sample at its own cumulative distance', () => {
        const context = createDistancePlotContext(km, 8, 14)

        // Indices 8..14 -> 0.8..1.4 km.
        expect(context.xPointsMain.map(v => +v.toFixed(2))).toEqual([
            0.8, 0.9, 1.0, 1.1, 1.2, 1.3, 1.4,
        ])
    })

    it('lines the three regions up end to end, with no gap and no overlap', () => {
        // The property the whole before/main/after layout depends on, and the
        // one a per-slice distance would break: each region must start where the
        // previous one ends, because the context slices SHARE their boundary
        // sample.
        const context = createDistancePlotContext(km, 8, 14)

        expect(context.xPointsBefore[context.xPointsBefore.length - 1]).toBe(
            context.xPointsMain[0],
        )
        expect(context.xPointsAfter[0]).toBe(
            context.xPointsMain[context.xPointsMain.length - 1],
        )
    })

    it('puts the trim lines at kilometres, not at sample indices', () => {
        // The distinction `xTrimStart`/`xTrimEnd` exist for. Under a time axis
        // the two are numerically equal; here index 8 is 0.8 km, and drawing the
        // dashed line at 8 would put it past the right edge of a 1.9 km ride.
        const context = createDistancePlotContext(km, 8, 14)

        expect(context.xTrimStart).toBeCloseTo(0.8)
        expect(context.xTrimEnd).toBeCloseTo(1.4)

        const [start, end] = buildTrimBoundaryShapes(context)
        expect(start.x0).toBeCloseTo(0.8)
        expect(end.x0).toBeCloseTo(1.4)
        expect(context.xMax).toBeLessThan(2)
    })

    it('still puts the time context trim lines at sample indices', () => {
        const [start, end] = buildTrimBoundaryShapes(createPlotContext(20, 8, 14))
        expect(start.x0).toBe(8)
        expect(end.x0).toBe(14)
    })

    it('ranges over the extended window, so the side context is visible', () => {
        const context = createDistancePlotContext(km, 8, 14)

        expect(context.xMin).toBeCloseTo(0.3)
        expect(context.xMax).toBeCloseTo(1.9)
    })

    it('carries its own axis title, so no builder hardcodes one', () => {
        expect(createDistancePlotContext(km, 8, 14).xAxisTitle).toBe(X_AXIS_TITLES.distance)
        expect(createPlotContext(20, 8, 14).xAxisTitle).toBe(X_AXIS_TITLES.time)
        expect(createDistancePlotContext(km, 8, 14).axis).toBe('distance')
        expect(createPlotContext(20, 8, 14).axis).toBe('time')
    })

    it('slices the data series by INDEX, not by distance', () => {
        // `createContextSlices` is shared by both contexts and must keep using
        // the index fields. A distance context that changed what it slices would
        // silently misalign every y series against its x.
        const values = Array.from({ length: 20 }, (_, i) => i * 2)
        const slices = createContextSlices(values, createDistancePlotContext(km, 8, 14))

        expect(slices.main).toEqual([16, 18, 20, 22, 24, 26, 28])
    })

    it('substitutes zero for a non-finite distance rather than emitting NaN', () => {
        // A NaN x drops the sample from the trace silently. Zero is wrong too,
        // but visibly so, and it keeps the array lengths matching the y series.
        const holed = [0, 0.1, Number.NaN, 0.3, 0.4, 0.5, 0.6, 0.7]
        const context = createDistancePlotContext(holed, 1, 6)

        expect(context.xPointsMain.every(Number.isFinite)).toBe(true)
        expect(context.xPointsMain[1]).toBe(0)
    })

    it('clamps an index the distance series does not reach', () => {
        // Only reachable from a caller that trimmed a longer series than the one
        // it handed over. Clamping keeps the axis monotonic; the alternative is
        // an undefined x.
        const context = createDistancePlotContext([0, 0.1, 0.2], 0, 2)
        expect(context.xPointsMain.every(Number.isFinite)).toBe(true)
    })
})
