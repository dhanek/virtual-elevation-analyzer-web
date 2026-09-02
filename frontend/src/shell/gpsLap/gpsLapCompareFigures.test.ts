/** @vitest-environment jsdom */
/**
 * THE GPS-lap comparison figure (D-07/D-20, plan 07-04 Task 2).
 *
 * The design ruling this guards: colour is already spent on lap identity in the
 * stacked overlay, so the second visual channel for the wind model has to be
 * DASH. Without it, the two legs of a comparison render as two lines of the same
 * colour on top of each other — a figure that looks like a rendering glitch and
 * carries none of the information it was asked for.
 *
 * The dash-pairing case below is the D-10 mutation site for this task: removing
 * `dash: 'dash'` from the constant trace must fail it.
 *
 * Everything here is REAL — `buildStackedComparisonFigures`, `stackedLapColor`
 * and `calculateGpsLapStats` are imported from production and driven with
 * synthetic laps. Nothing about the figure is supplied by the fixture: the
 * fixture supplies only lap data, which is the operating rule this phase learned
 * the hard way (*anything a test supplies in setup(), it cannot see missing*).
 */
import { describe, expect, it } from 'vitest';
import {
    buildStackedComparisonFigures,
    calculateGpsLapStats,
    calculateMeanElevationProfile,
    stackedLapColor,
} from './gpsLapPlots';
import type { LapVEProfile } from './types';

const LAP_COUNT = 3;
const SAMPLES = 40;

/**
 * One synthetic lap. The two legs are deliberately DIFFERENT functions of the
 * sample index, so a figure that drew the same series twice would be caught by
 * the y values and not only by the styling.
 */
function makeLap(index: number, withCompare: boolean): LapVEProfile {
    const distances = Array.from({ length: SAMPLES }, (_, i) => (i / (SAMPLES - 1)) * 2);
    const actualElevation = Array.from({ length: SAMPLES }, (_, i) => 100 + Math.sin(i / 6) * 3);
    return {
        range: { startIdx: 0, endIdx: 2 },
        lapNumber: index + 1,
        distances,
        virtualElevation: Array.from({ length: SAMPLES }, (_, i) => i * (0.5 + index)),
        virtualElevationCompare: withCompare
            ? Array.from({ length: SAMPLES }, (_, i) => -i * (0.25 + index))
            : null,
        actualElevation,
        referenceElevation: null,
        supplementarySeries: {} as LapVEProfile['supplementarySeries'],
        duration: 300,
        totalDistance: 2,
    };
}

function makeLaps(withCompare: boolean): LapVEProfile[] {
    return Array.from({ length: LAP_COUNT }, (_, i) => makeLap(i, withCompare));
}

const laps = makeLaps(true);
const meanElevation = calculateMeanElevationProfile(laps);
const figures = buildStackedComparisonFigures(laps, meanElevation);

/** The two traces belonging to one lap, in the order the builder emits them. */
function lapPair(data: any[], lapNumber: number): { fit: any; constant: any } {
    const fit = data.find((trace) => trace.name === `Lap ${lapNumber} (FIT)`);
    const constant = data.find((trace) => trace.name === `Lap ${lapNumber} (Constant)`);
    expect(fit, `missing FIT trace for lap ${lapNumber}`).toBeDefined();
    expect(constant, `missing Constant trace for lap ${lapNumber}`).toBeDefined();
    return { fit, constant };
}

describe('buildStackedComparisonFigures — trace counts', () => {
    it('emits 1 + 2N traces on the VE plot', () => {
        expect(figures.ve.data).toHaveLength(1 + 2 * LAP_COUNT);
    });

    it('keeps the mean elevation reference as the first trace', () => {
        expect(figures.ve.data[0].name).toBe('Mean Elevation');
        expect(figures.ve.data[0].line).toEqual({
            color: 'black',
            dash: 'dash',
            width: 2,
        });
    });

    it('emits 2N traces on the residual plot, with the zero line as a layout shape', () => {
        expect(figures.residuals.data).toHaveLength(2 * LAP_COUNT);
        expect(figures.residuals.layout.shapes).toHaveLength(1);
    });
});

describe('buildStackedComparisonFigures — colour is lap, dash is wind model', () => {
    it('gives both legs of a lap the SAME hue, and that hue is the lap palette entry', () => {
        for (let i = 0; i < LAP_COUNT; i++) {
            const { fit, constant } = lapPair(figures.ve.data, i + 1);
            expect(fit.line.color).toBe(stackedLapColor(i));
            expect(constant.line.color).toBe(fit.line.color);
        }
    });

    it('dashes EXACTLY ONE of each pair — the D-10 mutation site', () => {
        // Both undashed is two indistinguishable overlapping lines; both dashed
        // is the same problem the other way round. Exactly one is the property
        // that makes the figure readable, so it is asserted as a count.
        for (let i = 0; i < LAP_COUNT; i++) {
            const { fit, constant } = lapPair(figures.ve.data, i + 1);
            const dashed = [fit, constant].filter(
                (trace) => trace.line.dash === 'dash',
            );
            expect(
                dashed,
                `lap ${i + 1}: exactly one of the FIT/Constant pair must be dashed`,
            ).toHaveLength(1);
            // And it is the CONSTANT leg that is dashed: the FIT series is the
            // one this mode draws when compare is off, so it must keep looking
            // the way it did.
            expect(dashed[0]).toBe(constant);
            expect(fit.line.width).toBe(3);
        }
    });

    it('mirrors the pairing on the residual plot', () => {
        for (let i = 0; i < LAP_COUNT; i++) {
            const { fit, constant } = lapPair(figures.residuals.data, i + 1);
            expect(constant.line.color).toBe(fit.line.color);
            expect(fit.line.dash).toBeUndefined();
            expect(constant.line.dash).toBe('dash');
        }
    });

    it('names every trace distinctly, and every name carries its lap number', () => {
        const names = figures.ve.data.slice(1).map((trace: any) => trace.name);
        expect(new Set(names).size).toBe(names.length);
        for (let i = 0; i < LAP_COUNT; i++) {
            const forLap = names.filter((name: string) =>
                name.includes(`Lap ${i + 1}`),
            );
            expect(forLap).toHaveLength(2);
        }
    });
});

describe('buildStackedComparisonFigures — both legs are anchored the same way', () => {
    it('starts both legs of every lap on the mean profile’s first value', () => {
        const anchor = meanElevation.elevation[0];
        for (let i = 0; i < LAP_COUNT; i++) {
            const { fit, constant } = lapPair(figures.ve.data, i + 1);
            expect(fit.y[0]).toBeCloseTo(anchor, 10);
            expect(constant.y[0]).toBeCloseTo(anchor, 10);
        }
    });

    it('does not collapse the two legs onto one another', () => {
        // Same anchor, different physics: identical curves would mean the same
        // wind series had reached both calculators.
        for (let i = 0; i < LAP_COUNT; i++) {
            const { fit, constant } = lapPair(figures.ve.data, i + 1);
            expect(fit.y[SAMPLES - 1]).not.toBeCloseTo(constant.y[SAMPLES - 1], 6);
        }
    });

    it('takes residuals against the mean profile, so both start near zero together', () => {
        for (let i = 0; i < LAP_COUNT; i++) {
            const { fit, constant } = lapPair(figures.residuals.data, i + 1);
            expect(fit.y).toHaveLength(SAMPLES);
            expect(constant.y).toHaveLength(SAMPLES);
            expect(fit.y[0]).toBeCloseTo(constant.y[0], 10);
        }
    });
});

describe('calculateGpsLapStats — the compare block, side by side (ruling 2)', () => {
    const withCompare = calculateGpsLapStats(laps, meanElevation);
    const withoutCompare = calculateGpsLapStats(
        makeLaps(false),
        calculateMeanElevationProfile(makeLaps(false)),
    );

    it('returns a compare block only when every lap carries a compare series', () => {
        expect(withCompare.compare).toBeDefined();
        expect(withoutCompare.compare).toBeUndefined();
    });

    it('leaves the primary fields numerically unchanged by compare being present', () => {
        // This is the load-bearing one: switching the radio must not move the
        // FIT numbers the user was already reading.
        expect(withCompare.meanR2).toBeCloseTo(withoutCompare.meanR2, 12);
        expect(withCompare.meanRMSE).toBeCloseTo(withoutCompare.meanRMSE, 12);
        expect(withCompare.avgVeGain).toBeCloseTo(withoutCompare.avgVeGain, 12);
        expect(withCompare.avgActualGain).toBeCloseTo(withoutCompare.avgActualGain, 12);
        expect(withCompare.closingError).toBeCloseTo(withoutCompare.closingError, 12);
    });

    it('scores the constant leg to genuinely different numbers', () => {
        // A compare block that merely copied the primary would satisfy every
        // structural assertion above and tell the user nothing.
        expect(withCompare.compare!.meanRMSE).not.toBeCloseTo(
            withCompare.meanRMSE,
            6,
        );
        expect(withCompare.compare!.closingError).not.toBeCloseTo(
            withCompare.closingError,
            6,
        );
        expect(withCompare.compare!.lapClosingErrors).toHaveLength(LAP_COUNT);
    });

    it('does not average the two legs into one number', () => {
        // Ruling 2, stated as an assertion: the primary must not drift toward
        // the constant leg.
        const blended = (withCompare.meanRMSE + withCompare.compare!.meanRMSE) / 2;
        expect(withCompare.meanRMSE).not.toBeCloseTo(blended, 6);
        expect(withCompare.meanRMSE).toBeCloseTo(withoutCompare.meanRMSE, 12);
    });
});
