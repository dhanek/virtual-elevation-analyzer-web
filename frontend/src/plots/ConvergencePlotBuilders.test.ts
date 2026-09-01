import { describe, expect, it } from 'vitest'
import type { ClosureSurfaceResult } from '../analysis/ClosureSurface'
import { buildClosureContourFigure, type ConvergencePlotInput } from './ConvergencePlotBuilders'

const CDA = [0.2, 0.3, 0.4]
const CRR = [0.003, 0.004, 0.005, 0.006]

const determinedSurface = (): ClosureSurfaceResult => ({
    z: CRR.map((_, j) => CDA.map((_, i) => Math.abs(i - 1) + Math.abs(j - 2))),
    ridgeCda: [...CDA],
    ridgeCrr: [0.005, 0.005, 0.004],
    best: { cda: 0.3, crr: 0.005, error: 0.12 },
    clipped: false,
    underdetermined: null,
})

const input = (surface: ClosureSurfaceResult): ConvergencePlotInput => ({
    surface,
    cdaValues: CDA,
    crrValues: CRR,
    marker: { cda: 0.25, crr: 0.0045 },
    segmentCount: 3,
    gridSteps: 41,
    targetLabel: 'DEM',
})

describe('buildClosureContourFigure', () => {
    it('draws contour, ridge, best fit and current marker in that order', () => {
        const figure = buildClosureContourFigure(input(determinedSurface()))
        expect(figure.data.map(trace => [trace.type, trace.mode ?? null])).toEqual([
            ['contour', null],
            ['scatter', 'lines'],
            ['scatter', 'markers'],
            ['scatter', 'markers'],
        ])
        expect(figure.data[2].name).toBe('Best fit')
        expect(figure.data[3].name).toBe('Current')
        // Reversed Viridis: the low-error valley reads bright against a dark
        // field, which is what makes the minimum findable at a glance.
        expect(figure.data[0].reversescale).toBe(true)
    })

    it('hands Plotly the pooled z in its [crr][cda] orientation untouched', () => {
        const surface = determinedSurface()
        const figure = buildClosureContourFigure(input(surface))
        expect(figure.data[0].z).toBe(surface.z)
        expect(figure.data[0].x).toBe(CDA)
        expect(figure.data[0].y).toBe(CRR)
    })

    it('the ridge trace spans every CdA column', () => {
        const figure = buildClosureContourFigure(input(determinedSurface()))
        expect(figure.data[1].x).toHaveLength(CDA.length)
        expect(figure.data[1].y).toHaveLength(CDA.length)
    })

    it('titles the axes as CdA and Crr and names the grid resolution', () => {
        const figure = buildClosureContourFigure(input(determinedSurface()))
        expect(figure.layout.xaxis).toMatchObject({ title: { text: 'CdA (m²)' } })
        expect(figure.layout.yaxis).toMatchObject({ title: { text: 'Crr' } })
        expect((figure.layout.title as { text: string }).text).toContain('41×41')
        expect((figure.layout.title as { text: string }).text).toContain('3 segments')
    })

    /**
     * The colorbar is the figure's key; a legend would collide with it and
     * with the below-axis-legend convention. Pinning `layout.legend`
     * undefined makes a future "just add a legend" fail here, loudly.
     */
    it('declares no legend', () => {
        const figure = buildClosureContourFigure(input(determinedSurface()))
        expect(figure.layout.legend).toBeUndefined()
        expect(figure.layout.showlegend).toBe(false)
    })

    it('drops the best-fit trace and explains itself when underdetermined', () => {
        const surface: ClosureSurfaceResult = {
            ...determinedSurface(),
            best: null,
            underdetermined:
                'The ridge is flat — closure error alone cannot separate CdA from Crr for this selection.',
        }
        const figure = buildClosureContourFigure(input(surface))
        expect(figure.data.map(trace => trace.name ?? trace.type)).toEqual([
            'contour',
            'Ridge',
            'Current',
        ])
        const annotations = figure.layout.annotations as Array<{ text: string }>
        expect(annotations).toHaveLength(1)
        expect(annotations[0].text).toContain('ridge is flat')
    })

    it('warns when the minimum is clipped by the grid edge', () => {
        const surface: ClosureSurfaceResult = { ...determinedSurface(), clipped: true }
        const figure = buildClosureContourFigure(input(surface))
        const annotations = figure.layout.annotations as Array<{ text: string }>
        expect(annotations).toHaveLength(1)
        expect(annotations[0].text).toContain('grid edge')
        // The optimum is still drawn — clipped qualifies it, it does not erase it.
        expect(figure.data.some(trace => trace.name === 'Best fit')).toBe(true)
    })

    it('uses the shared default config', () => {
        const figure = buildClosureContourFigure(input(determinedSurface()))
        expect(figure.config).toMatchObject({ responsive: true, displaylogo: false })
    })
})
