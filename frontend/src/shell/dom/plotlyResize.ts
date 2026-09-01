import { log } from '../../utils/log'

/**
 * Plotly's graph-div marker class. Plotly stamps it on every element it has
 * plotted into, so it is the honest test for "this div is a live graph" —
 * `Plots.resize` throws on a div that was never plotted.
 */
const PLOTLY_GRAPH_SELECTOR = '.js-plotly-plot'

/**
 * Every way this app takes a container off screen: the shared `.hidden` utility
 * and the `[hidden]` attribute (D-06's single visibility mechanism — nothing
 * writes `style.display` outside MapVisualization's internals), plus the tab
 * pane, whose own rule is `display: none` until it carries the active modifier.
 *
 * An ancestor matching any of these means the graph measures zero.
 */
const HIDDEN_SELECTOR =
    '.hidden, [hidden], .ve-tab-content:not(.ve-tab-content--active)'

/**
 * Re-measure every Plotly graph inside a container that has just become
 * visible.
 *
 * WHY THIS EXISTS, measured in Chrome on 2026-08-31 against the real markup and
 * stylesheet. The three render paths draw ALL of a panel's plots up front,
 * while every tab pane but VE is still `display: none`. Plotly's autosize reads
 * `gd.offsetWidth`, gets 0, and falls back to its default `layout.width` of
 * 700 px. Two things then fail to rescue it:
 *
 *   - `config: { responsive: true }` only listens for a window `resize` event.
 *     Un-hiding a container fires nothing, so the listener never runs.
 *   - `Plotly.react` does NOT re-run autosize on a graph that already carries a
 *     width, so the tab render callbacks re-plot at 700 px too.
 *
 * Measured on the Standard wind tab: container 808 px, svg 700 px after
 * activation and react; 808 px after `Plots.resize`. The VE tab was always
 * exempt: its pane is the active one when the first draw happens.
 *
 * WHAT MAKES THIS CALL SAFE, and it was not safe the first time it was written.
 * `Plots.resize` DELETES `gd.layout.width` and `gd.layout.height` and
 * re-autosizes, guarded only by `layout.width && layout.height`
 * (plotly-cartesian.js:48489) — so a figure that pins a height but no width has
 * that height thrown away. Standard's figures did exactly that, into containers
 * with no CSS height, and this call collapsed them from 350 px to 26 px.
 *
 * The precondition is therefore a property of the whole app, not of this
 * function: every graph div is a `.ve-plot-container__plot` with a height from
 * CSS, and no figure anywhere sets `layout.height`. `oneSizingConvention.test.ts`
 * is what keeps that true. Re-introduce a `layout.height` and this call becomes
 * destructive again.
 *
 * `renderOutAndBackPlots` already knew half of this — "Unhide BEFORE plotting:
 * Plotly measures the container at draw time, and a `display: none` div
 * measures zero" — and unhides its compare view first. That works for
 * `newPlot`, which re-measures; it does NOT work for `react`, which is why the
 * draw-method migration calls this afterwards.
 *
 * CALL THIS AFTER DRAWING, not before: `Plots.resize` is async, so a `react`
 * issued behind it would race the relayout it schedules.
 *
 * Every failure is swallowed to a debug line. A graph mid-teardown rejects, and
 * a resize is a cosmetic correction — it must never be the thing that stops a
 * tab from opening.
 */
export function resizePlotlyGraphsIn(root: HTMLElement): void {
    const Plotly = (window as unknown as {
        Plotly?: { Plots?: { resize?: (gd: Element) => unknown } }
    }).Plotly
    const Plots = Plotly?.Plots
    const resize = Plots?.resize
    if (!resize) return

    root.querySelectorAll(PLOTLY_GRAPH_SELECTOR).forEach(graph => {
        // A HIDDEN GRAPH IS EXACTLY THE CASE THIS FUNCTION EXISTS TO UNDO, so
        // it must not be handed one: `Plots.resize` deletes `layout.width` and
        // re-autosizes against `gd.offsetWidth`, which is 0 inside a
        // `display: none` subtree, pinning the graph at that measurement until
        // something redraws it.
        //
        // The guard belongs here rather than at the call sites, which
        // disagreed about it: `renderOutAndBackPlots` scopes its call to the
        // compare view for precisely this reason, while `activateTab` passes a
        // whole pane — and the out-and-back VE pane CONTAINS the compare view,
        // which is `.hidden` whenever the selection is not in compare mode. A
        // Power/VE tab round trip therefore zero-width-pinned the two compare
        // graphs until the next full render repaired them.
        if (graph.closest(HIDDEN_SELECTOR)) return
        try {
            void Promise.resolve(resize.call(Plots, graph)).catch((error: unknown) => {
                log.debug('Plotly resize failed for a graph', error)
            })
        } catch (error) {
            log.debug('Plotly resize threw for a graph', error)
        }
    })
}
