/**
 * The anchor-and-residual arithmetic every comparison figure needs, in ONE
 * place (07-04 Task 1).
 *
 * Three builders hand-rolled the same two lines before this file existed:
 * `buildVirtualElevationComparisonFigures` (Standard), `renderGpsLapVEPlots`
 * (GPS-lap) and `renderOutAndBackPlots` (out-and-back). Compare reaching all
 * three modes would have made that four copies, which is the duplication class
 * this phase exists to remove — the same shape as the three divergent wind
 * algorithms D-05 collapsed.
 *
 * Deliberately DATA-ONLY: no figure objects, no plotting library, no browser
 * types. These are two array functions, so they are node-testable and can be
 * called from any of the three figure builders without dragging a layout
 * convention along with them.
 */

/**
 * Shift `series` so that its first element equals `anchorValue`, preserving
 * every difference between consecutive samples.
 *
 * This is what a VE trace needs before it can be drawn against a real elevation
 * profile: `build_virtual_elevation` restarts its integration from zero, so the
 * curve carries a shape but no datum. The datum is supplied here.
 *
 * NaN is propagated rather than defended against. A NaN first sample poisons the
 * whole shifted series, which is the honest outcome — there is no defensible
 * place to put a curve whose starting value is unknown, and silently anchoring
 * it to zero would draw a plausible-looking line at the wrong height.
 */
export function anchorSeriesTo(series: number[], anchorValue: number): number[] {
    if (series.length === 0) {
        return [];
    }
    const offset = anchorValue - series[0];
    return series.map(value => value + offset);
}

/**
 * Sample-by-sample `series - reference`.
 *
 * Length follows `series`, not the shorter of the two: where the reference runs
 * out the result is NaN, which leaves a visible gap in the figure. Truncating
 * instead would silently shorten a plotted trace, and a residual curve that
 * quietly stops early is exactly the kind of thing nobody notices.
 */
export function residualsAgainst(series: number[], reference: number[]): number[] {
    return series.map((value, index) => value - reference[index]);
}
