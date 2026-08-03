/**
 * D-21 / N-6 GUARD — the calibration multiplier must never re-enter
 * `buildVirtualDistanceFigure`.
 *
 * Background. Before plan 07-02, three different wind semantics reached the
 * three Standard plot branches: the Wind branch got offset + calibration
 * (`bindStandardSliders.ts:414-424`), the VD branch got an UN-offset series and
 * `buildVirtualDistanceFigure` applied calibration internally
 * (`StandardPlotBuilders.ts:626-630`), and the initial render got offset with no
 * calibration (`renderStandardVe.ts:111-117`). D-05 collapses all three onto one
 * `resolveWindSeries` call, which applies offset AND calibration once, over the
 * full series. The instant that lands, the builder's internal multiplier becomes
 * a SECOND application. 07-RESEARCH.md calls this the single most likely silent
 * numeric regression in the phase.
 *
 * The disposition (D-21) is removal, not `airSpeedCalibrationPercent: 0`:
 * removing the field makes a re-application a compile error rather than a
 * convention someone has to remember.
 *
 * These tests are the runtime half of that guard. The compile half is the
 * `@ts-expect-error` case at the bottom, which FAILS TO COMPILE — and therefore
 * fails `npm run check` — the moment the field is reintroduced.
 */
import { describe, expect, it } from 'vitest';
import { createPlotContext } from './PlotContext';
import { buildVirtualDistanceFigure, type VirtualDistancePlotInput } from './StandardPlotBuilders';

/** 1 Hz, ten samples, so dt is exactly 1 s at every step. */
const TIMESTAMPS = Array.from({ length: 10 }, (_, i) => i);
const VELOCITY = new Array(10).fill(8);
const WIND_SPEED = new Array(10).fill(10);

function vdAirMainTrace(windSpeed: number[]): number[] {
    const figure = buildVirtualDistanceFigure({
        context: createPlotContext(TIMESTAMPS.length, 0, TIMESTAMPS.length - 1),
        timestamps: TIMESTAMPS,
        velocity: VELOCITY,
        windSpeed,
    });
    // Trace 0 is 'VD from Air Speed' over the main (untrimmed) window.
    return figure.data[0].y as number[];
}

describe('buildVirtualDistanceFigure applies NO calibration of its own (D-21)', () => {
    it('integrates the given series in time and divides by 1000, with no multiplier', () => {
        const vdAir = vdAirMainTrace(WIND_SPEED);

        // Plain time integration: index i has accumulated i seconds at 10 m/s.
        const expected = TIMESTAMPS.map(i => (i * 10) / 1000);
        expect(vdAir).toHaveLength(expected.length);
        vdAir.forEach((value, i) => {
            expect(value).toBeCloseTo(expected[i], 12);
        });
    });

    it('scales linearly with the series it is handed — the ONLY way calibration can reach it', () => {
        const plain = vdAirMainTrace(WIND_SPEED);
        // A 5 % calibration is applied UPSTREAM, by resolveWindSeries, and shows
        // up here as exactly 5 % more virtual air distance. If the builder also
        // multiplied internally this would be 1.05^2 = 1.1025x instead.
        const preCalibrated = vdAirMainTrace(WIND_SPEED.map(speed => speed * 1.05));

        preCalibrated.forEach((value, i) => {
            expect(value).toBeCloseTo(plain[i] * 1.05, 12);
        });

        const last = preCalibrated[preCalibrated.length - 1];
        expect(last).toBeCloseTo((9 * 10 * 1.05) / 1000, 12);
        // The double-application value, named explicitly so the mutation row is
        // reproducible: re-introducing `1 + pct/100` inside the builder makes the
        // assertion above fail with this number.
        expect(last).not.toBeCloseTo((9 * 10 * 1.05 * 1.05) / 1000, 12);
    });

    it('treats a non-finite sample as zero rather than propagating NaN', () => {
        const withDropout = [...WIND_SPEED];
        withDropout[5] = Number.NaN;

        const vdAir = vdAirMainTrace(withDropout);
        expect(vdAir.every(value => Number.isFinite(value))).toBe(true);
        // One second of the ten-metre-per-second series is lost.
        expect(vdAir[vdAir.length - 1]).toBeCloseTo((9 * 10 - 10) / 1000, 12);
    });
});

describe('VirtualDistancePlotInput has no calibration field (compile-level, D-21)', () => {
    it('rejects airSpeedCalibrationPercent at the type boundary', () => {
        const input: VirtualDistancePlotInput = {
            context: createPlotContext(TIMESTAMPS.length, 0, TIMESTAMPS.length - 1),
            timestamps: TIMESTAMPS,
            velocity: VELOCITY,
            windSpeed: WIND_SPEED,
        };

        const withCalibration = {
            ...input,
            // @ts-expect-error D-21: this field must not exist. If someone
            // re-adds `airSpeedCalibrationPercent` to VirtualDistancePlotInput,
            // the directive above becomes unused and `tsc` fails the build —
            // which is the whole point of removing the field rather than
            // passing 0.
            airSpeedCalibrationPercent: 5,
        } satisfies VirtualDistancePlotInput;

        expect(Object.keys(input)).not.toContain('airSpeedCalibrationPercent');
        expect(buildVirtualDistanceFigure(withCalibration).data.length).toBeGreaterThan(0);
    });
});
