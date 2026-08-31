/** @vitest-environment jsdom */
/**
 * THE out-and-back comparison figure (D-20 ruling, plan 07-04 Task 4).
 *
 * The maintainer ruled OPTION-B at the Task 3 checkpoint: a second stacked
 * subplot, the constant-wind view BELOW the FIT view, each plot keeping exactly
 * today's encoding — colour is section, solid is outbound, dashed is inbound.
 * The ruling is recorded in `07-GOLDEN-BASELINE.md` §"Task 3 ruling"; this file
 * is what stops the implementation drifting off it.
 *
 * TWO THINGS THIS FILE REFUSES TO SUPPLY FOR ITSELF.
 *
 * 1. THE PLOT DIVS. The whole risk of a stacked-subplot ruling is a figure that
 *    is built beautifully and then rendered into a container that does not
 *    exist — a test that creates `#oabVeComparePlot` in `setup()` cannot see it
 *    missing from the template, and would be vacuous by construction (the
 *    operating rule this phase learned the hard way: *anything a test supplies
 *    in setup(), it cannot see missing*). So the DOM here is built by the REAL
 *    `buildOutAndBackVeAnalysisTemplate`, and the Plotly fake THROWS when asked
 *    to draw into an id that is not in the document. Delete the compare
 *    containers from the template and this file fails.
 *
 * 2. THE ANCHOR. The continuity case drives real profiles through the real
 *    builder and reads the plotted y values back. It is the D-10 mutation site
 *    for this task: anchoring the comparison inbound leg to the FIT outbound's
 *    last value splices half of one wind model onto half of another and draws a
 *    curve belonging to neither — which looks perfectly reasonable on screen,
 *    and is exactly the failure no visual check would catch.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { AnalysisParameters } from '../../components/AnalysisParameters';
import {
    buildOutAndBackComparisonFigures,
    calculateOutAndBackMeanElevation,
    calculateOutAndBackStats,
    everySectionHasCompareSeries,
    renderOutAndBackPlots,
} from './outAndBackPlots';
import { buildOutAndBackVeAnalysisTemplate } from './renderOutAndBack';
import type { OutAndBackVEProfile } from './types';

const SECTION_COUNT = 3;
const SAMPLES = 30;

/** The palette out-and-back has always used, restated so a silent repaint fails. */
const SECTION_COLORS = ['#4363d8', '#e6194b', '#3cb44b', '#f58231', '#911eb4', '#46f0f0', '#f032e6'];

/**
 * One synthetic section. All four legs are DIFFERENT functions of the sample
 * index, so a figure that drew the same series twice, or anchored a leg to the
 * wrong model, is visible in the y values and not only in the styling.
 */
function makeSection(index: number, withCompare: boolean): OutAndBackVEProfile {
    const distances = Array.from({ length: SAMPLES }, (_, i) => (i / (SAMPLES - 1)) * 2);
    const actual = Array.from({ length: SAMPLES }, (_, i) => 100 + Math.sin(i / 5) * 4);
    return {
        outboundRange: { startIdx: 0, endIdx: 2 },
        inboundRange: { startIdx: 0, endIdx: 2 },
        sectionNumber: index + 1,
        outboundDistances: distances,
        outboundVE: Array.from({ length: SAMPLES }, (_, i) => i * (0.5 + index)),
        outboundVECompare: withCompare
            ? Array.from({ length: SAMPLES }, (_, i) => -i * (0.25 + index))
            : null,
        outboundActualElevation: actual,
        outboundSeries: null,
        inboundDistances: distances.slice(),
        inboundVE: Array.from({ length: SAMPLES }, (_, i) => 40 - i * (0.3 + index)),
        inboundVECompare: withCompare
            ? Array.from({ length: SAMPLES }, (_, i) => 7 + i * (0.4 + index))
            : null,
        inboundActualElevation: actual.slice().reverse(),
        inboundSeries: null,
        outboundDuration: 120,
        inboundDuration: 130,
        totalDistance: 4,
    };
}

function makeSections(withCompare: boolean): OutAndBackVEProfile[] {
    return Array.from({ length: SECTION_COUNT }, (_, i) => makeSection(i, withCompare));
}

const sections = makeSections(true);
const meanElevation = calculateOutAndBackMeanElevation(sections);
const figures = buildOutAndBackComparisonFigures(sections, meanElevation);

/** Section traces only — the mean-elevation reference is not a section. */
function sectionTraces(data: any[]): any[] {
    return data.filter((trace) => String(trace.name).startsWith('Section '));
}

function legTrace(data: any[], sectionNumber: number, leg: 'A→B' | 'B→A'): any {
    const trace = data.find((candidate) => candidate.name === `Section ${sectionNumber} (${leg})`);
    expect(trace, `missing ${leg} trace for section ${sectionNumber}`).toBeDefined();
    return trace;
}

describe('buildOutAndBackComparisonFigures — option-b trace arithmetic', () => {
    it('puts 2N section traces in EACH of the four figures', () => {
        // The ruling's arithmetic: 2N per figure, not 4N in one. An overlay is
        // option-a, which was declined.
        expect(sectionTraces(figures.ve.data)).toHaveLength(2 * SECTION_COUNT);
        expect(sectionTraces(figures.compareVe!.data)).toHaveLength(2 * SECTION_COUNT);
        expect(sectionTraces(figures.residuals.data)).toHaveLength(2 * SECTION_COUNT);
        expect(sectionTraces(figures.compareResiduals!.data)).toHaveLength(2 * SECTION_COUNT);
    });

    it('gives each VE figure exactly one mean-elevation reference, and each residual figure none', () => {
        expect(figures.ve.data).toHaveLength(1 + 2 * SECTION_COUNT);
        expect(figures.compareVe!.data).toHaveLength(1 + 2 * SECTION_COUNT);
        expect(figures.ve.data[0].name).toBe('Mean Actual Elevation');
        expect(figures.compareVe!.data[0].name).toBe('Mean Actual Elevation');
        expect(figures.residuals.data).toHaveLength(2 * SECTION_COUNT);
        expect(figures.compareResiduals!.data).toHaveLength(2 * SECTION_COUNT);
    });

    it('titles the two views so neither is guessed at', () => {
        expect(figures.ve.layout.title).toContain('FIT');
        expect(figures.compareVe!.layout.title).toContain('Constant');
        expect(figures.compareResiduals!.layout.title).toContain('Constant');
    });
});

describe('buildOutAndBackComparisonFigures — both plots keep today’s encoding', () => {
    it('keeps colour meaning SECTION in both views, at the same palette entry', () => {
        for (let i = 0; i < SECTION_COUNT; i++) {
            const expected = SECTION_COLORS[i % SECTION_COLORS.length];
            for (const leg of ['A→B', 'B→A'] as const) {
                expect(legTrace(figures.ve.data, i + 1, leg).line.color).toBe(expected);
                expect(legTrace(figures.compareVe!.data, i + 1, leg).line.color).toBe(expected);
            }
        }
    });

    it('keeps dash meaning LEG in both views — solid outbound, dashed inbound', () => {
        // The channel assertion, stated explicitly. Task 2's mutation row showed
        // 13 of 14 structural cases passing while the figure became unreadable;
        // only the case that asserted the styling channel caught it. If a future
        // change spends dash on the wind model instead, this fails.
        for (const data of [figures.ve.data, figures.compareVe!.data, figures.residuals.data, figures.compareResiduals!.data]) {
            for (let i = 0; i < SECTION_COUNT; i++) {
                expect(legTrace(data, i + 1, 'A→B').line.dash).toBeUndefined();
                expect(legTrace(data, i + 1, 'B→A').line.dash).toBe('dash');
            }
        }
    });

    it('mirrors the inbound x-axis in the comparison view exactly as in the primary', () => {
        for (let i = 0; i < SECTION_COUNT; i++) {
            const fitInbound = legTrace(figures.ve.data, i + 1, 'B→A');
            const compareInbound = legTrace(figures.compareVe!.data, i + 1, 'B→A');
            // Mirrored means descending source distances become ascending plot
            // distances starting at 0 — and the two models plot on the same x.
            expect(compareInbound.x).toEqual(fitInbound.x);
            expect(compareInbound.x[0]).toBeCloseTo(sections[i].inboundDistances[SAMPLES - 1], 12);
            expect(compareInbound.x[SAMPLES - 1]).toBeCloseTo(0, 12);
        }
    });

    it('does not collapse the two views onto one another', () => {
        // Same anchoring rule, different physics: identical curves would mean one
        // wind series reached both calculators.
        for (let i = 0; i < SECTION_COUNT; i++) {
            const fit = legTrace(figures.ve.data, i + 1, 'A→B');
            const constant = legTrace(figures.compareVe!.data, i + 1, 'A→B');
            expect(fit.y[SAMPLES - 1]).not.toBeCloseTo(constant.y[SAMPLES - 1], 6);
        }
    });
});

describe('buildOutAndBackComparisonFigures — each model’s inbound leg is anchored to its OWN outbound', () => {
    it('starts every comparison inbound leg on the comparison outbound’s last value — the D-10 mutation site', () => {
        for (let i = 0; i < SECTION_COUNT; i++) {
            const compareOutbound = legTrace(figures.compareVe!.data, i + 1, 'A→B');
            const compareInbound = legTrace(figures.compareVe!.data, i + 1, 'B→A');
            const fitOutbound = legTrace(figures.ve.data, i + 1, 'A→B');

            const compareOutboundLast = compareOutbound.y[compareOutbound.y.length - 1];
            const fitOutboundLast = fitOutbound.y[fitOutbound.y.length - 1];

            expect(
                compareInbound.y[0],
                `section ${i + 1}: the constant inbound leg must continue the CONSTANT outbound leg`,
            ).toBeCloseTo(compareOutboundLast, 10);

            // And the two anchors must be genuinely distinguishable, or the case
            // above would pass under the mutation it exists to catch.
            expect(
                fitOutboundLast,
                `section ${i + 1}: fixture is not discriminating — the two outbound legs end at the same value`,
            ).not.toBeCloseTo(compareOutboundLast, 6);
            expect(
                compareInbound.y[0],
                `section ${i + 1}: the constant inbound leg is anchored to the FIT outbound — a hybrid of two wind models`,
            ).not.toBeCloseTo(fitOutboundLast, 6);
        }
    });

    it('leaves the FIT view anchored exactly as it was before compare existed', () => {
        const single = buildOutAndBackComparisonFigures(sections, meanElevation);
        for (let i = 0; i < SECTION_COUNT; i++) {
            const outbound = legTrace(single.ve.data, i + 1, 'A→B');
            const inbound = legTrace(single.ve.data, i + 1, 'B→A');
            expect(outbound.y[0]).toBeCloseTo(meanElevation.elevation[0], 10);
            expect(inbound.y[0]).toBeCloseTo(outbound.y[outbound.y.length - 1], 10);
        }
    });
});

describe('everySectionHasCompareSeries', () => {
    it('is true only when every computed leg was computed twice', () => {
        expect(everySectionHasCompareSeries(sections)).toBe(true);
        expect(everySectionHasCompareSeries(makeSections(false))).toBe(false);
        expect(everySectionHasCompareSeries([])).toBe(false);
    });

    it('is false for a HALF comparison', () => {
        const partial = makeSections(true);
        partial[1].inboundVECompare = null;
        expect(everySectionHasCompareSeries(partial)).toBe(false);
    });

    it('does not demand a comparison for a leg the primitive skipped', () => {
        const skipped = makeSections(true);
        skipped[2].inboundVE = [];
        skipped[2].inboundVECompare = null;
        expect(everySectionHasCompareSeries(skipped)).toBe(true);
    });
});

describe('calculateOutAndBackStats — the compare block, side by side (ruling 2)', () => {
    const withCompare = calculateOutAndBackStats(sections, meanElevation);
    const plain = makeSections(false);
    const withoutCompare = calculateOutAndBackStats(
        plain,
        calculateOutAndBackMeanElevation(plain),
    );

    it('returns a compare block only when every section carries one', () => {
        expect(withCompare.compare).toBeDefined();
        expect(withoutCompare.compare).toBeUndefined();
    });

    it('leaves the FIT fields numerically unchanged by compare being present', () => {
        expect(withCompare.rmse).toBeCloseTo(withoutCompare.rmse, 12);
        expect(withCompare.avgVeGain).toBeCloseTo(withoutCompare.avgVeGain, 12);
        expect(withCompare.avgActualGain).toBeCloseTo(withoutCompare.avgActualGain, 12);
        expect(withCompare.avgDiff).toBeCloseTo(withoutCompare.avgDiff, 12);
    });

    it('scores the constant legs to genuinely different numbers, and does not average', () => {
        expect(withCompare.compare!.rmse).not.toBeCloseTo(withCompare.rmse, 6);
        expect(withCompare.compare!.avgVeGain).not.toBeCloseTo(withCompare.avgVeGain, 6);
        const blended = (withCompare.rmse + withCompare.compare!.rmse) / 2;
        expect(withCompare.rmse).not.toBeCloseTo(blended, 6);
    });
});

/**
 * The rendering half. Nothing below creates a plot container: the document is
 * the REAL template's output, and the fake refuses to draw into an id that is
 * not there.
 */
describe('renderOutAndBackPlots — the second subplot has somewhere to go', () => {
    function paintTemplate() {
        document.body.innerHTML = buildOutAndBackVeAnalysisTemplate({
            params: {
                cda: 0.3,
                cda_min: 0.15,
                cda_max: 0.5,
                crr: 0.008,
                crr_min: 0.002,
                crr_max: 0.02,
                air_speed_offset: 2,
                wind_height_factor: 0.5,
            } as unknown as AnalysisParameters,
            hasWindSpeed: true,
            hasConstantWind: true,
            showWindTab: true,
            showVirtualDistanceTab: true,
            selectedWindSource: 'compare',
            currentAirSpeedCalibrationValue: '0.0',
            initialStats: { rmse: 1, avgVeGain: 2, avgActualGain: 0 },
            sectionCount: SECTION_COUNT,
            defaultAirSpeedOffset: 0,
            elevationToggleMarkup: '',
        });
    }

    /**
     * A Plotly that draws only where the DOM says it can. This is the shape that
     * has actually caught things in this phase: a fake that throws on a missing
     * target turns "the builder produced a figure" into "the figure reached a
     * container that exists in the shipped template".
     *
     * BOTH draw methods, sharing one record (bundle D). This fake used to supply
     * `newPlot` alone, which quietly made these cases a second pin on the draw
     * METHOD -- they broke on the switch to `react` while having nothing to say
     * about it. What they are about is WHERE a figure lands, so they now record
     * either call and leave the method to `outAndBackPlotDrawMethod.test.ts`.
     */
    function fakePlotly() {
        const drawn = new Map<string, any[]>();
        const draw = (method: string) =>
            vi.fn((target: string, data: any[]) => {
                if (typeof target !== 'string') {
                    throw new Error(`Plotly target must be an element id, got ${typeof target}`);
                }
                if (document.getElementById(target) === null) {
                    throw new Error(`Plotly.${method}('${target}'): no such element in the document`);
                }
                drawn.set(target, data);
            });
        return {
            drawn,
            newPlot: draw('newPlot'),
            react: draw('react'),
            // `renderOutAndBackPlots` re-measures the compare view after
            // unhiding it, because `react` -- unlike `newPlot` -- reuses the
            // width the graph already carries.
            Plots: { resize: vi.fn(() => Promise.resolve()) },
        };
    }

    beforeEach(() => {
        paintTemplate();
    });

    it('draws all four figures into ids the shipped template actually contains', () => {
        const Plotly = fakePlotly();
        renderOutAndBackPlots(Plotly, sections, meanElevation);

        expect([...Plotly.drawn.keys()].sort()).toEqual([
            'oabVeComparePlot',
            'oabVeCompareResidualsPlot',
            'oabVePlot',
            'oabVeResidualsPlot',
        ]);
        expect(sectionTraces(Plotly.drawn.get('oabVeComparePlot')!)).toHaveLength(2 * SECTION_COUNT);
        expect(sectionTraces(Plotly.drawn.get('oabVeCompareResidualsPlot')!)).toHaveLength(2 * SECTION_COUNT);
    });

    it('reveals the constant-wind view, which the template ships hidden', () => {
        // Hidden by default is what keeps two empty white boxes off the VE tab
        // when compare is off; unhiding BEFORE the draw is what stops Plotly
        // measuring a display:none container at zero width.
        expect(document.getElementById('oabCompareView')!.classList.contains('hidden')).toBe(true);
        renderOutAndBackPlots(fakePlotly(), sections, meanElevation);
        expect(document.getElementById('oabCompareView')!.classList.contains('hidden')).toBe(false);
    });

    it('draws only the original pair when no section carries a comparison, and re-hides the view', () => {
        const Plotly = fakePlotly();
        renderOutAndBackPlots(Plotly, sections, meanElevation);
        renderOutAndBackPlots(Plotly, makeSections(false), meanElevation);

        expect(Plotly.react.mock.calls.slice(4).map((call) => call[0])).toEqual([
            'oabVePlot',
            'oabVeResidualsPlot',
        ]);
        expect(document.getElementById('oabCompareView')!.classList.contains('hidden')).toBe(true);
        // And the untouched path keeps the bare title it has always had.
        expect(Plotly.drawn.get('oabVePlot')![0].name).toBe('Mean Actual Elevation');
    });

    it('falls back to the single-source pair on a HALF comparison', () => {
        const partial = makeSections(true);
        partial[0].outboundVECompare = null;
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
        const Plotly = fakePlotly();

        renderOutAndBackPlots(Plotly, partial, meanElevation);

        expect([...Plotly.drawn.keys()]).toEqual(['oabVePlot', 'oabVeResidualsPlot']);
        expect(document.getElementById('oabCompareView')!.classList.contains('hidden')).toBe(true);
        warn.mockRestore();
    });
});
