/**
 * The Convergence tab's figure: pooled closure error over the CdA x Crr grid,
 * with the ridge, the surface optimum (when one exists) and the current
 * slider position.
 *
 * Follows the house builder shape — pure `(input) => {data, layout, config}`,
 * no DOM, no Plotly reference — and the one sizing convention: NO
 * `layout.height` or `layout.width`, the container CSS owns the box
 * (`oneSizingConvention.test.ts` enforces it here too).
 *
 * NO `PlotContext` on purpose. That type describes a time/distance x-axis
 * with trim boundaries; this figure's axes are parameters, not samples, so
 * the x-axis toggle and trim shapes do not apply.
 *
 * NO legend on purpose. The colorbar already occupies the right edge; the
 * two marker traces are identified by hover text instead. This keeps the
 * figure outside the below-axis-legend convention entirely — a test pins
 * `layout.legend` undefined so "just add a legend" fails loudly rather than
 * quietly colliding with the axis title.
 */
import type { ClosureSurfaceResult } from '../analysis/ClosureSurface';
import { getDefaultPlotConfig, type PlotDefinition, type PlotTrace } from './StandardPlotBuilders';

export interface ConvergencePlotInput {
    surface: ClosureSurfaceResult;
    /** The grid axes `ve_gain_grid` was evaluated over. */
    cdaValues: number[];
    crrValues: number[];
    /** Where the CdA/Crr sliders currently sit. */
    marker: { cda: number; crr: number };
    segmentCount: number;
    /** Shown in the title so the resolution on screen is never unexplained. */
    gridSteps: number;
    /**
     * Honest name for the elevation-difference source the closure targets came
     * from ('DEM', 'barometer', 'manual Δh', or the no-DEM fallback wording) —
     * shown in the title so the map never hides what it is measured against.
     */
    targetLabel: string;
}

export function buildClosureContourFigure(input: ConvergencePlotInput): PlotDefinition {
    const { surface, cdaValues, crrValues, marker, segmentCount, gridSteps, targetLabel } = input;

    const data: PlotTrace[] = [
        {
            type: 'contour',
            x: cdaValues,
            y: crrValues,
            z: surface.z,
            contours: { coloring: 'heatmap' },
            colorscale: 'Viridis',
            colorbar: { title: { text: 'Closure error (m)', side: 'right' } },
            hovertemplate:
                'CdA %{x:.3f} m²<br>Crr %{y:.4f}<br>closure error %{z:.2f} m<extra></extra>',
        },
        {
            type: 'scatter',
            mode: 'lines',
            name: 'Ridge',
            x: surface.ridgeCda,
            y: surface.ridgeCrr,
            line: { color: 'rgba(255, 255, 255, 0.85)', width: 2, dash: 'dot' },
            hovertemplate:
                'Ridge: best Crr for CdA %{x:.3f} is %{y:.4f}<extra></extra>',
        },
    ];

    if (surface.best) {
        data.push({
            type: 'scatter',
            mode: 'markers',
            name: 'Best fit',
            x: [surface.best.cda],
            y: [surface.best.crr],
            marker: { symbol: 'diamond', size: 11, color: '#d62728', line: { color: 'white', width: 1 } },
            hovertemplate:
                `Best fit: CdA %{x:.3f} m², Crr %{y:.4f}` +
                `<br>closure error ${surface.best.error.toFixed(2)} m<extra></extra>`,
        });
    }

    data.push({
        type: 'scatter',
        mode: 'markers',
        name: 'Current',
        x: [marker.cda],
        y: [marker.crr],
        marker: { symbol: 'circle-open', size: 12, color: '#111111', line: { width: 2 } },
        hovertemplate: 'Current sliders: CdA %{x:.3f} m², Crr %{y:.4f}<extra></extra>',
    });

    const annotations: Array<Record<string, unknown>> = [];
    if (surface.underdetermined) {
        annotations.push({
            text: wrapAnnotation(surface.underdetermined),
            xref: 'paper',
            yref: 'paper',
            x: 0.5,
            y: 0.5,
            showarrow: false,
            align: 'center',
            font: { size: 12 },
            bgcolor: 'rgba(255, 255, 255, 0.88)',
            bordercolor: '#d62728',
            borderpad: 6,
        });
    } else if (surface.clipped) {
        annotations.push({
            text: wrapAnnotation(
                'The minimum sits on the grid edge — the true minimum may lie ' +
                    'outside the CdA/Crr bounds, so this fit can look sharper than it is.',
            ),
            xref: 'paper',
            yref: 'paper',
            x: 0.5,
            y: 1,
            yanchor: 'bottom',
            showarrow: false,
            align: 'center',
            font: { size: 11 },
            bgcolor: 'rgba(255, 244, 229, 0.92)',
            bordercolor: '#b45309',
            borderpad: 4,
        });
    }

    const segmentNoun = segmentCount === 1 ? 'segment' : 'segments';
    return {
        data,
        layout: {
            title: {
                text: `Closure error vs ${targetLabel} — ${segmentCount} ${segmentNoun}, ${gridSteps}×${gridSteps} grid`,
                font: { size: 13 },
            },
            xaxis: { title: { text: 'CdA (m²)' } },
            yaxis: { title: { text: 'Crr' } },
            showlegend: false,
            margin: { l: 70, r: 20, t: 40, b: 55 },
            annotations,
        },
        config: getDefaultPlotConfig(),
    };
}

/** Soft-wrap annotation text with <br> so it stays inside the plot area. */
function wrapAnnotation(text: string, maxLineLength = 46): string {
    const words = text.split(' ');
    const lines: string[] = [];
    let line = '';
    for (const word of words) {
        if (line.length > 0 && line.length + 1 + word.length > maxLineLength) {
            lines.push(line);
            line = word;
        } else {
            line = line.length > 0 ? `${line} ${word}` : word;
        }
    }
    if (line.length > 0) {
        lines.push(line);
    }
    return lines.join('<br>');
}
