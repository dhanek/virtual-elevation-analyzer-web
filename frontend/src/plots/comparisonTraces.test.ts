/**
 * The shared comparison maths, and the BEFORE PICTURE for the refactor that
 * extracted it.
 *
 * Plan 07-04 Task 1 moves the anchor-and-residual arithmetic out of
 * `buildVirtualElevationComparisonFigures` (and, at Task 2/4, out of the two GPS
 * figure builders) into `anchorSeriesTo` / `residualsAgainst`. The Standard
 * comparison figure is an existing user-visible plot and is NOT on the D-09
 * change list, so the refactor has to be output-identical.
 *
 * The first block below is therefore written and confirmed GREEN BEFORE the
 * helpers exist: it pins every y value of all six traces against integer
 * literals. A refactor with no before-picture is not verifiable (07-04 Task 1
 * acceptance criteria).
 *
 * The inputs are chosen so that every anchored value and every residual is an
 * exact integer — the assertions are then literals rather than a second copy of
 * the formula, which is the trap `parameterChangeHandler.test.ts` fell into.
 */
import { describe, expect, it } from 'vitest';
import { anchorSeriesTo, residualsAgainst } from './comparisonTraces';
import { buildVirtualElevationComparisonFigures } from './StandardPlotBuilders';
import { createPlotContext } from './PlotContext';

const LENGTH = 20;
const TRIM_START = 2;
const TRIM_END = 17;
const context = createPlotContext(LENGTH, TRIM_START, TRIM_END);

/** i * step, so the main window (indices 2..17) is an arithmetic run. */
function ramp(step: number): number[] {
    return Array.from({ length: LENGTH }, (_, i) => i * step);
}

/** 2, 3, ... 17 — the actual-elevation main window, and the anchor value is 2. */
const EXPECTED_ACTUAL_MAIN = [2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17];
/** fit main = 20..170 step 10, anchored to 2: offset -18. */
const EXPECTED_FIT = [2, 12, 22, 32, 42, 52, 62, 72, 82, 92, 102, 112, 122, 132, 142, 152];
/** constant main = 10..85 step 5, anchored to 2: offset -8. */
const EXPECTED_CONSTANT = [2, 7, 12, 17, 22, 27, 32, 37, 42, 47, 52, 57, 62, 67, 72, 77];
/** EXPECTED_FIT - EXPECTED_ACTUAL_MAIN. */
const EXPECTED_FIT_RESIDUALS = [0, 9, 18, 27, 36, 45, 54, 63, 72, 81, 90, 99, 108, 117, 126, 135];
/** EXPECTED_CONSTANT - EXPECTED_ACTUAL_MAIN. */
const EXPECTED_CONSTANT_RESIDUALS = [0, 4, 8, 12, 16, 20, 24, 28, 32, 36, 40, 44, 48, 52, 56, 60];

const figures = buildVirtualElevationComparisonFigures({
    context,
    virtualElevationFit: ramp(10),
    virtualElevationConstant: ramp(5),
    actualElevation: ramp(1),
});

function traceNamed(data: Array<Record<string, unknown>>, name: string): Record<string, unknown> {
    const trace = data.find(candidate => candidate.name === name);
    expect(trace, `trace "${name}" is missing`).toBeDefined();
    return trace as Record<string, unknown>;
}

describe('buildVirtualElevationComparisonFigures — frozen trace data (before picture)', () => {
    it('emits exactly three elevation traces, in order', () => {
        expect(figures.elevation.data.map(trace => trace.name)).toEqual([
            'VE (FIT Air Speed)',
            'Actual Elevation',
            'VE (Constant Wind)',
        ]);
    });

    it('emits exactly three residual traces, in order', () => {
        expect(figures.residuals.data.map(trace => trace.name)).toEqual([
            'Residuals (FIT Air Speed)',
            'Residuals (Constant Wind)',
            'Zero',
        ]);
    });

    it('anchors the FIT series on the first main-window actual sample', () => {
        expect(traceNamed(figures.elevation.data, 'VE (FIT Air Speed)').y).toEqual(EXPECTED_FIT);
    });

    it('anchors the constant series on the SAME sample, independently', () => {
        expect(traceNamed(figures.elevation.data, 'VE (Constant Wind)').y).toEqual(EXPECTED_CONSTANT);
    });

    it('draws the actual elevation main window unshifted', () => {
        expect(traceNamed(figures.elevation.data, 'Actual Elevation').y).toEqual(EXPECTED_ACTUAL_MAIN);
    });

    it('takes both residual series against the actual main window', () => {
        expect(traceNamed(figures.residuals.data, 'Residuals (FIT Air Speed)').y).toEqual(
            EXPECTED_FIT_RESIDUALS,
        );
        expect(traceNamed(figures.residuals.data, 'Residuals (Constant Wind)').y).toEqual(
            EXPECTED_CONSTANT_RESIDUALS,
        );
    });

    it('keeps every trace on the main time axis, and the zero line flat', () => {
        for (const trace of [...figures.elevation.data, ...figures.residuals.data]) {
            expect(trace.x).toEqual(context.xPointsMain);
        }
        expect(traceNamed(figures.residuals.data, 'Zero').y).toEqual(
            new Array(context.xPointsMain.length).fill(0),
        );
    });

    it('keeps the line styling of all six traces', () => {
        expect(traceNamed(figures.elevation.data, 'VE (FIT Air Speed)').line)
            .toEqual({ color: '#4363d8', width: 2 });
        expect(traceNamed(figures.elevation.data, 'Actual Elevation').line)
            .toEqual({ color: '#000000', width: 2 });
        expect(traceNamed(figures.elevation.data, 'VE (Constant Wind)').line)
            .toEqual({ color: '#a9a9a9', width: 2 });
        expect(traceNamed(figures.residuals.data, 'Residuals (FIT Air Speed)').line)
            .toEqual({ color: '#4363d8', width: 2 });
        expect(traceNamed(figures.residuals.data, 'Residuals (Constant Wind)').line)
            .toEqual({ color: '#a9a9a9', width: 2 });
        expect(traceNamed(figures.residuals.data, 'Zero').line)
            .toEqual({ color: '#95a5a6', width: 1, dash: 'dash' });
    });
});

describe('anchorSeriesTo', () => {
    it('shifts the whole series so its first element equals the anchor', () => {
        expect(anchorSeriesTo([20, 30, 40], 2)).toEqual([2, 12, 22]);
    });

    it('is the identity when the series already starts at the anchor', () => {
        expect(anchorSeriesTo([5, 6, 7], 5)).toEqual([5, 6, 7]);
    });

    it('preserves every difference between consecutive samples', () => {
        const shifted = anchorSeriesTo([1, 4, 9, 16], -100);
        expect(shifted[1] - shifted[0]).toBe(3);
        expect(shifted[2] - shifted[1]).toBe(5);
        expect(shifted[3] - shifted[2]).toBe(7);
    });

    it('returns an empty array for an empty series rather than throwing', () => {
        expect(anchorSeriesTo([], 3)).toEqual([]);
    });

    it('propagates NaN rather than inventing a number', () => {
        // A NaN FIRST sample poisons the offset, which is the honest outcome:
        // there is no defensible place to put a series with no starting value.
        expect(anchorSeriesTo([Number.NaN, 1, 2], 0).every(Number.isNaN)).toBe(true);
        // A NaN elsewhere stays local to its own sample.
        const local = anchorSeriesTo([10, Number.NaN, 30], 0);
        expect(local[0]).toBe(0);
        expect(Number.isNaN(local[1])).toBe(true);
        expect(local[2]).toBe(20);
    });

    it('propagates a NaN anchor to every sample', () => {
        expect(anchorSeriesTo([1, 2, 3], Number.NaN).every(Number.isNaN)).toBe(true);
    });
});

describe('residualsAgainst', () => {
    it('subtracts the reference sample-by-sample', () => {
        expect(residualsAgainst([2, 12, 22], [2, 3, 4])).toEqual([0, 9, 18]);
    });

    it('returns an empty array for an empty series', () => {
        expect(residualsAgainst([], [1, 2, 3])).toEqual([]);
    });

    it('yields NaN where the reference runs out, rather than truncating', () => {
        // Truncating would silently shorten a plotted trace; NaN leaves a visible
        // gap in the figure instead.
        const residuals = residualsAgainst([1, 2, 3], [1]);
        expect(residuals).toHaveLength(3);
        expect(residuals[0]).toBe(0);
        expect(Number.isNaN(residuals[1])).toBe(true);
        expect(Number.isNaN(residuals[2])).toBe(true);
    });

    it('propagates NaN from either side', () => {
        const residuals = residualsAgainst([Number.NaN, 5], [1, Number.NaN]);
        expect(residuals.every(Number.isNaN)).toBe(true);
    });
});
