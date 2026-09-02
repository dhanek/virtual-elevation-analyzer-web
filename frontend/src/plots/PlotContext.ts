/** What the x-axis of a standard plot is measuring. */
export type PlotXAxis = 'time' | 'distance';

export const X_AXIS_TITLES: Record<PlotXAxis, string> = {
    time: 'Time (seconds)',
    distance: 'Distance (km)',
};

/**
 * The x-axis every standard plot draws against, plus the trim window expressed
 * in that axis's own units.
 *
 * `trimStart` / `trimEnd` are SAMPLE INDICES and always have been — they index
 * the series, and `createContextSlices` slices with them. `xTrimStart` /
 * `xTrimEnd` are the SAME two boundaries expressed as x COORDINATES, which is
 * what the dashed trim lines need. Under a time axis the two are numerically
 * equal, because the time axis is the index (see `createPlotContext`); under a
 * distance axis they are not, and conflating them is what would put the trim
 * lines at kilometre 30 000 of a 40 km ride.
 *
 * `xPoints{Before,Main,After}` were `timePoints*` until the axis became
 * switchable. The rename is the point: nothing downstream should be able to
 * assume what the numbers mean, because a distance context fills the same three
 * arrays with kilometres.
 */
export interface PlotContext {
    trimStart: number;
    trimEnd: number;
    contextBefore: number;
    contextAfter: number;
    extendedStart: number;
    extendedEnd: number;
    xPointsBefore: number[];
    xPointsMain: number[];
    xPointsAfter: number[];
    /** The trim boundaries in x coordinates, for the dashed boundary lines. */
    xTrimStart: number;
    xTrimEnd: number;
    xMin: number;
    xMax: number;
    /** The axis title the builders render, so no builder hardcodes one. */
    xAxisTitle: string;
    axis: PlotXAxis;
}

export interface ContextSlices<T> {
    before: T[];
    main: T[];
    after: T[];
}

export function createPlotContext(length: number, trimStart: number, trimEnd: number, sideContext: number = 5): PlotContext {
    const contextBefore = Math.min(trimStart, sideContext);
    const contextAfter = Math.min(length - 1 - trimEnd, sideContext);
    const extendedStart = trimStart - contextBefore;
    const extendedEnd = trimEnd + 1 + contextAfter;

    return {
        trimStart,
        trimEnd,
        contextBefore,
        contextAfter,
        extendedStart,
        extendedEnd,
        // THE TIME AXIS IS THE SAMPLE INDEX. It reads as seconds because FIT
        // records at 1 Hz, which is why `xTrimStart`/`xTrimEnd` below are simply
        // the indices — the identity that stops holding under a distance axis.
        xPointsBefore: contextBefore > 0 ? Array.from({ length: contextBefore + 1 }, (_, i) => i + extendedStart) : [],
        xPointsMain: Array.from({ length: trimEnd - trimStart + 1 }, (_, i) => i + trimStart),
        xPointsAfter: contextAfter > 0 ? Array.from({ length: contextAfter + 1 }, (_, i) => i + trimEnd) : [],
        xTrimStart: trimStart,
        xTrimEnd: trimEnd,
        xMin: extendedStart,
        xMax: extendedEnd - 1,
        xAxisTitle: X_AXIS_TITLES.time,
        axis: 'time',
    };
}

/**
 * The same context, drawn against CUMULATIVE DISTANCE instead of time.
 *
 * `cumulativeKm` must be one value per sample of the SAME series the time
 * context describes, already accumulated across the whole selection —
 * `cumulativeDistanceKm` in `standardSegments.ts` is what builds it. Cumulative
 * rather than the raw FIT odometer channel, and per the maintainer's ruling
 * (2026-08-31), zeroed at the first plotted sample: Standard stitches several
 * laps into one series, so the recorded odometer jumps backwards at every lap
 * boundary and would give a non-monotonic axis. Accumulating deltas and carrying
 * the running total across the boundaries is the only reading under which the
 * before/main/after regions line up, which is the property the whole
 * three-region layout depends on.
 *
 * The index bookkeeping is IDENTICAL to the time context — same trim window,
 * same side context, same slices. Only the x values differ, which is what makes
 * the switch a context swap rather than four plot rewrites.
 */
export function createDistancePlotContext(
    cumulativeKm: ArrayLike<number>,
    trimStart: number,
    trimEnd: number,
    sideContext: number = 5,
): PlotContext {
    const base = createPlotContext(cumulativeKm.length, trimStart, trimEnd, sideContext);

    // A sample index the series does not carry cannot be plotted at a distance.
    // Clamping rather than emitting NaN keeps the axis monotonic; the arrays are
    // built from `base`, so an out-of-range index can only come from a caller
    // that handed over a shorter distance series than the one it trimmed.
    const at = (index: number): number => {
        const clamped = Math.min(Math.max(index, 0), cumulativeKm.length - 1);
        const value = cumulativeKm[clamped];
        return Number.isFinite(value) ? value : 0;
    };

    const xPointsBefore = base.xPointsBefore.map(at);
    const xPointsMain = base.xPointsMain.map(at);
    const xPointsAfter = base.xPointsAfter.map(at);

    return {
        ...base,
        xPointsBefore,
        xPointsMain,
        xPointsAfter,
        xTrimStart: at(trimStart),
        xTrimEnd: at(trimEnd),
        xMin: at(base.extendedStart),
        xMax: at(base.extendedEnd - 1),
        xAxisTitle: X_AXIS_TITLES.distance,
        axis: 'distance',
    };
}

export function createContextSlices<T>(values: ArrayLike<T>, context: PlotContext): ContextSlices<T> {
    const series = Array.from(values);

    return {
        before: context.contextBefore > 0 ? series.slice(context.extendedStart, context.trimStart + 1) : [],
        main: series.slice(context.trimStart, context.trimEnd + 1),
        after: context.contextAfter > 0 ? series.slice(context.trimEnd, context.extendedEnd) : [],
    };
}

export function buildTrimBoundaryShapes(context: PlotContext): Array<Record<string, unknown>> {
    return [
        {
            type: 'line',
            x0: context.xTrimStart,
            x1: context.xTrimStart,
            y0: 0,
            y1: 1,
            yref: 'paper',
            line: {
                color: 'rgba(100, 100, 100, 0.3)',
                width: 1.5,
                dash: 'dash',
            },
        },
        {
            type: 'line',
            x0: context.xTrimEnd,
            x1: context.xTrimEnd,
            y0: 0,
            y1: 1,
            yref: 'paper',
            line: {
                color: 'rgba(100, 100, 100, 0.3)',
                width: 1.5,
                dash: 'dash',
            },
        },
    ];
}
