export interface PlotContext {
    trimStart: number;
    trimEnd: number;
    contextBefore: number;
    contextAfter: number;
    extendedStart: number;
    extendedEnd: number;
    timePointsBefore: number[];
    timePointsMain: number[];
    timePointsAfter: number[];
    xMin: number;
    xMax: number;
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
        timePointsBefore: contextBefore > 0 ? Array.from({ length: contextBefore + 1 }, (_, i) => i + extendedStart) : [],
        timePointsMain: Array.from({ length: trimEnd - trimStart + 1 }, (_, i) => i + trimStart),
        timePointsAfter: contextAfter > 0 ? Array.from({ length: contextAfter + 1 }, (_, i) => i + trimEnd) : [],
        xMin: extendedStart,
        xMax: extendedEnd - 1,
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
            x0: context.trimStart,
            x1: context.trimStart,
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
            x0: context.trimEnd,
            x1: context.trimEnd,
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
