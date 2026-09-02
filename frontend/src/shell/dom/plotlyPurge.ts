import { log } from '../../utils/log'

/**
 * Plotly's graph-div marker class. Plotly stamps it on every element it has
 * plotted into, so it is the honest test for "this div is a live graph".
 */
const PLOTLY_GRAPH_SELECTOR = '.js-plotly-plot'

/**
 * Release every Plotly graph inside a container that is being taken off screen.
 *
 * `Plotly.purge` had zero callers anywhere in `src` (audit NEW-2). A mode change
 * hides the VE panel without replacing its markup — `tearDownVeAnalysisPanel`
 * says so in as many words, and it is right that the markup can stay — but
 * hiding a graph div does not release what Plotly hung off it: the figure's
 * data, its layout, its `responsive` window listener and its drag handlers all
 * stay reachable from the module until the NEXT analyze overwrites the
 * container's `innerHTML`.
 *
 * This does not accumulate: one panel is live at a time, so the leak is bounded
 * at one panel's worth of graphs and it is memory and a stray resize listener,
 * not correctness. It is worth doing anyway because the release point is
 * knowable and `purge` is the one call that knows how.
 *
 * `purge` empties the div it is given, so the containers survive as empty boxes
 * inside the hidden panel — which is exactly the state the next render expects
 * to overwrite.
 *
 * Every failure is swallowed to a debug line: a teardown must not be the thing
 * that throws, and there is nothing a caller could do about a graph that will
 * not purge.
 */
export function purgePlotlyGraphsIn(root: HTMLElement): void {
    const Plotly = (window as unknown as {
        Plotly?: { purge?: (gd: Element) => unknown }
    }).Plotly
    const purge = Plotly?.purge
    if (!purge) return

    root.querySelectorAll(PLOTLY_GRAPH_SELECTOR).forEach(graph => {
        try {
            purge.call(Plotly, graph)
        } catch (error) {
            log.debug('Plotly purge failed for a graph', error)
        }
    })
}
