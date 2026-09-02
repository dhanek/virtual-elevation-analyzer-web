/**
 * @vitest-environment jsdom
 *
 * A PANE'S PLOTS ARE RE-MEASURED WHEN THE PANE BECOMES VISIBLE (bundle D).
 *
 * The three render paths draw every tab's plots up front, while every pane but
 * VE is still `display: none`. Plotly's autosize reads `gd.offsetWidth`, gets 0
 * and falls back to its default `layout.width` of 700 px; nothing then rescues
 * it, because `config.responsive` hooks only the window `resize` event and
 * `Plotly.react` does not re-run autosize on a graph that already has a width.
 * Measured in Chrome against the real markup and stylesheet: an 808 px
 * container held a 700 px svg after activation and react, and 808 px only after
 * `Plots.resize`.
 *
 * WHAT THIS TEST CAN AND CANNOT SEE. jsdom has no layout, so it cannot see a
 * width change -- there is no honest headless number for one. What it pins is
 * the CALL: that activating a pane reaches `Plotly.Plots.resize` for the graphs
 * in THAT pane and no others, after the render callback rather than before. That
 * is the thing which silently regresses when someone adds a fifth tab.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { activateTab, setTabRenderMap } from './tabs'

const order: string[] = []
const resized: string[] = []

function setPlotly(withResize: boolean): void {
    ;(window as unknown as { Plotly: unknown }).Plotly = {
        Plots: withResize
            ? {
                  resize: vi.fn((gd: Element) => {
                      resized.push((gd as HTMLElement).id)
                      order.push(`resize:${(gd as HTMLElement).id}`)
                      return Promise.resolve()
                  }),
              }
            : {},
    }
}

describe('activating a tab re-measures the plots that pane just revealed', () => {
    beforeEach(() => {
        order.length = 0
        resized.length = 0
        setTabRenderMap({})
        // The real shape: the graph div is NESTED inside the bordered
        // `.ve-plot-container` box, so the box itself is never a graph div and
        // must not be resized. `js-plotly-plot` is the class Plotly stamps on a
        // div it has plotted into; the unstamped one in the VD pane stands for a
        // div that was never plotted -- `Plots.resize` rejects on those.
        document.body.innerHTML = `
            <button class="ve-tab-button ve-tab-button--active" data-tab="ve"></button>
            <button class="ve-tab-button" data-tab="wind"></button>
            <button class="ve-tab-button" data-tab="vd"></button>
            <button class="ve-tab-button" data-tab="convergence"></button>
            <div class="ve-tab-content ve-tab-content--active" id="ve-tab">
                <div class="ve-plot-container"><div id="vePlot" class="ve-plot-container__plot js-plotly-plot"></div></div>
                <div class="ve-plot-container"><div id="veResidualsPlot" class="ve-plot-container__plot js-plotly-plot"></div></div>
                <!--
                    The out-and-back shape: the compare graphs live INSIDE the
                    VE pane, in a wrapper that carries .hidden whenever the
                    selection is not a comparison.
                -->
                <div id="oabCompareView" class="hidden">
                    <div class="ve-plot-container"><div id="oabVeComparePlot" class="ve-plot-container__plot js-plotly-plot"></div></div>
                </div>
            </div>
            <div class="ve-tab-content" id="wind-tab">
                <div class="ve-plot-container"><div id="windSpeedPlot" class="ve-plot-container__plot js-plotly-plot"></div></div>
                <div id="airSpeedOffsetControls"></div>
            </div>
            <div class="ve-tab-content" id="vd-tab">
                <div class="ve-plot-container"><div id="vdPlot" class="ve-plot-container__plot"></div></div>
            </div>
            <div class="ve-tab-content" id="convergence-tab">
                <div class="ve-plot-container"><div id="convergencePlot" class="ve-plot-container__plot js-plotly-plot"></div></div>
            </div>
        `
        setPlotly(true)
    })

    it('resizes the graphs in the activated pane only', () => {
        activateTab('wind')
        expect(resized).toEqual(['windSpeedPlot'])
    })

    it('resizes the convergence contour and nothing else when its tab activates', () => {
        // The fifth tab this file's header warned about. `activateTab` calls
        // `Plots.resize` on every activation, which is why the contour figure
        // must never pin a height (`oneSizingConvention.test.ts`).
        activateTab('convergence')
        expect(resized).toEqual(['convergencePlot'])
    })

    it('resizes after the render callback, so the async relayout is not raced', () => {
        setTabRenderMap({ wind: () => order.push('render:wind') })
        activateTab('wind')
        expect(order).toEqual(['render:wind', 'resize:windSpeedPlot'])
    })

    it('skips containers Plotly has never plotted into', () => {
        // #vdPlot carries no `js-plotly-plot`, and `Plots.resize` throws on a
        // div that is not a graph -- so it must not be handed one.
        activateTab('vd')
        expect(resized).toEqual([])
    })

    it('resizes every graph in a pane that holds more than one', () => {
        activateTab('wind')
        activateTab('ve')
        expect(resized).toEqual(['windSpeedPlot', 'vePlot', 'veResidualsPlot'])
    })

    it('skips graphs inside a hidden container within the pane', () => {
        // `Plots.resize` deletes layout.width and re-autosizes against
        // `offsetWidth`, which is 0 in a `display: none` subtree -- so handing
        // it a hidden graph PINS the zero width this function exists to undo,
        // and it survives until something redraws that graph. The out-and-back
        // compare view is the case: it sits inside the VE pane, so a
        // Power -> VE tab switch in non-compare mode reached it.
        activateTab('ve')
        expect(resized).toEqual(['vePlot', 'veResidualsPlot'])
    })

    it('resizes a container in the pane once it is unhidden', () => {
        document.getElementById('oabCompareView')!.classList.remove('hidden')

        activateTab('ve')
        expect(resized).toEqual(['vePlot', 'veResidualsPlot', 'oabVeComparePlot'])
    })

    it('does nothing when Plotly is absent or too old to expose Plots.resize', () => {
        delete (window as unknown as { Plotly?: unknown }).Plotly
        expect(() => activateTab('wind')).not.toThrow()

        setPlotly(false)
        expect(() => activateTab('wind')).not.toThrow()
        expect(resized).toEqual([])
    })

    it('survives a resize that rejects, which a torn-down graph does', () => {
        ;(window as unknown as { Plotly: unknown }).Plotly = {
            Plots: { resize: () => Promise.reject(new Error('no layout')) },
        }
        expect(() => activateTab('wind')).not.toThrow()
    })

    it('survives a resize that throws synchronously', () => {
        ;(window as unknown as { Plotly: unknown }).Plotly = {
            Plots: {
                resize: () => {
                    throw new Error('not a graph')
                },
            },
        }
        expect(() => activateTab('wind')).not.toThrow()
    })
})
