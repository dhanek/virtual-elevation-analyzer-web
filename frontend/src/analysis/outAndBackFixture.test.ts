import { readFileSync } from 'node:fs';
import { describe, expect, test } from 'vitest';
import {
    OUT_AND_BACK_RIDE_PATH,
    isOutAndBackRidePresent,
    loadOutAndBackRide,
    type OutAndBackRideJson,
} from './__fixtures__/loadOutAndBackRide';

/**
 * ─────────────────────────────────────────────────────────────────────────────
 * INTEGRITY GUARDS FOR THE SYNTHETIC OUT-AND-BACK FIXTURE.
 *
 * These do not test any production behaviour. They test that the ARTIFACT is
 * what it claims to be, which is the one thing a downstream test using it
 * cannot check for itself.
 *
 * WHY THAT MATTERS HERE SPECIFICALLY. `golden-ride.json` already carries a
 * `sections` array, and it is a trap: each of its sections is a lap split in
 * half. It has the out-and-back SHAPE — four indices, two legs — with none of
 * the out-and-back GEOMETRY. Nothing retraces anything. A fixture that looked
 * like that while claiming to be out-and-back would make every out-and-back
 * test built on it vacuous without any of them failing. Block A exists to make
 * that specific lie impossible.
 *
 * WHAT THIS FIXTURE IS WORTH, because it is easy to forget once a green tick
 * appears next to it. It is SYNTHETIC and it is **weaker evidence than a real
 * out-and-back ride**. Nothing that runs against it may be described as
 * browser-verified or real-ride verified. Block B asserts that the fixture
 * keeps saying so in its own data, so that a future edit which quietly deletes
 * the caveat fails a test instead of passing silently — the caveat is part of
 * the artifact's contract, not a comment on it (threat T-07-07-03).
 *
 * These guards were watched FAILING under three named mutations of the
 * generator and the loader (OAB-1 reversal dropped, OAB-2 disclaimer dropped,
 * OAB-3 loader zero-filling wind_yaw), reverted, and re-run. See
 * 07-07-SUMMARY.md for the verbatim failure text of each.
 * ─────────────────────────────────────────────────────────────────────────────
 */

const fixturePresent = isOutAndBackRidePresent();

/**
 * D-10 anti-vacuity guard, deliberately OUTSIDE the `describe.skipIf` below,
 * mirroring `veGolden.wasm.test.ts`. A fixture file that silently skips its own
 * integrity guards in CI is not a guard. Locally this is a no-op so a developer
 * mid-regeneration is not blocked.
 */
test('out-and-back fixture is present in CI', () => {
    if (process.env.CI) {
        expect(fixturePresent).toBe(true);
    }
});

/**
 * Pinned on purpose. The fixture's size is a function of which source laps the
 * generator picks, so changing that choice has to be a deliberate, visible act
 * rather than a quiet drift in what every downstream out-and-back test is
 * running against. 1482 = 2 x (242 + 250 + 249), golden-ride laps 1, 3 and 5.
 */
const EXPECTED_RECORD_COUNT = 1482;
const EXPECTED_SECTION_NUMBERS = [1, 2, 3];
const EXPECTED_SECTION_LEG_LENGTHS = [242, 250, 249];

/** Every array the fixture claims to carry at full length. */
const FIXTURE_ARRAYS = [
    'timestamps',
    'power',
    'velocity',
    'position_lat',
    'position_long',
    'altitude',
    'distance',
    'air_speed',
    'wind_yaw',
    'temperature',
    'rhoArray',
] as const;

/** The rotation the inbound leg's apparent yaw is supposed to carry. */
const INBOUND_YAW_ROTATION_DEGREES = 180;

/**
 * The four things the fixture must keep saying it does NOT discharge. Each is
 * matched against the emitted `whatThisDoesNotDischarge` array, so deleting or
 * hollowing out any one of them fails here.
 */
const REQUIRED_DISCLAIMERS: Array<{ label: string; pattern: RegExp }> = [
    { label: 'the browser display of the four-plot compare view', pattern: /four-plot[\s\S]*browser|browser[\s\S]*four-plot/i },
    { label: 'the D-16 DevTools rows G-05, G-06, G-11, G-12', pattern: /G-05[\s\S]*G-06[\s\S]*G-11[\s\S]*G-12/ },
    { label: 'the D-09 entry (t) out-and-back impression', pattern: /D-09 entry \(t\)/ },
    { label: 'the D-09 (a)/(c)/(d) real-ride before/after numbers', pattern: /D-09 entries \(a\), \(c\) and \(d\)/ },
];

function readFixture(): OutAndBackRideJson {
    return JSON.parse(readFileSync(OUT_AND_BACK_RIDE_PATH, 'utf8')) as OutAndBackRideJson;
}

/**
 * Compare two long sequences and fail with ONE readable line rather than a
 * 250-element diff: how many samples differ, and the first offset that does.
 * The count matters — it distinguishes "the reversal is gone" (nearly every
 * sample differs) from "one sample drifted".
 */
function expectSequencesEqual(actual: number[], expected: number[], label: string): void {
    expect(`${label}: length ${actual.length}`).toBe(`${label}: length ${expected.length}`);

    const mismatches: number[] = [];
    for (let i = 0; i < expected.length; i++) {
        if (actual[i] !== expected[i]) {
            mismatches.push(i);
        }
    }

    const summary = mismatches.length === 0
        ? `${label}: all ${expected.length} samples match`
        : `${label}: ${mismatches.length}/${expected.length} samples differ, first at leg offset `
            + `${mismatches[0]} (${actual[mismatches[0]]} vs ${expected[mismatches[0]]})`;

    expect(summary).toBe(`${label}: all ${expected.length} samples match`);
}

describe.skipIf(!fixturePresent)('synthetic out-and-back fixture', () => {
    describe('Block A — the geometry really is out-and-back', () => {
        test('the fixture is one contiguous index space of the pinned size', () => {
            const json = readFixture();

            expect(json.record_count).toBe(EXPECTED_RECORD_COUNT);
            for (const name of FIXTURE_ARRAYS) {
                expect(`${name}: ${json[name].length}`).toBe(`${name}: ${json.record_count}`);
            }
        });

        test('timestamps are the contiguous integers 0..record_count-1', () => {
            const json = readFixture();

            const firstBreak = json.timestamps.findIndex((value, i) => value !== i);
            expect(`first non-contiguous timestamp at index ${firstBreak}`).toBe(
                'first non-contiguous timestamp at index -1',
            );
        });

        test('the sections tile the whole array with no gap and no overlap', () => {
            const { sections } = loadOutAndBackRide();
            const json = readFixture();

            expect(sections.map(section => section.sectionNumber)).toEqual(EXPECTED_SECTION_NUMBERS);

            let cursor = 0;
            for (const section of sections) {
                expect(`section ${section.sectionNumber} starts at ${section.outboundStartIdx}`).toBe(
                    `section ${section.sectionNumber} starts at ${cursor}`,
                );
                expect(`section ${section.sectionNumber} inbound starts at ${section.inboundStartIdx}`).toBe(
                    `section ${section.sectionNumber} inbound starts at ${section.outboundEndIdx + 1}`,
                );
                cursor = section.inboundEndIdx + 1;
            }
            expect(`sections cover ${cursor} samples`).toBe(`sections cover ${json.record_count} samples`);
        });

        test('distance never goes backwards across the whole fixture', () => {
            const json = readFixture();

            const firstDescent = json.distance.findIndex((value, i) => i > 0 && value < json.distance[i - 1]);
            expect(`first backwards distance step at index ${firstDescent}`).toBe(
                'first backwards distance step at index -1',
            );
        });

        describe.each(EXPECTED_SECTION_NUMBERS)('section %i', sectionNumber => {
            const section = () => {
                const found = loadOutAndBackRide().sections.find(s => s.sectionNumber === sectionNumber);
                if (!found) {
                    throw new Error(`fixture has no section ${sectionNumber}`);
                }
                return found;
            };

            /** Outbound samples in order, and inbound samples in REVERSE order. */
            const legs = (name: (typeof FIXTURE_ARRAYS)[number]) => {
                const json = readFixture();
                const s = section();
                return {
                    outbound: json[name].slice(s.outboundStartIdx, s.outboundEndIdx + 1),
                    inboundReversed: json[name].slice(s.inboundStartIdx, s.inboundEndIdx + 1).reverse(),
                };
            };

            test('the two legs are the same length, and the pinned length', () => {
                const s = section();
                const outboundLength = s.outboundEndIdx - s.outboundStartIdx + 1;
                const inboundLength = s.inboundEndIdx - s.inboundStartIdx + 1;
                const expected = EXPECTED_SECTION_LEG_LENGTHS[sectionNumber - 1];

                expect(`outbound ${outboundLength} / inbound ${inboundLength}`).toBe(
                    `outbound ${expected} / inbound ${expected}`,
                );
            });

            test('the inbound leg retraces the outbound latitude sequence', () => {
                const { outbound, inboundReversed } = legs('position_lat');
                expectSequencesEqual(inboundReversed, outbound, `section ${sectionNumber} position_lat`);
            });

            test('the inbound leg retraces the outbound longitude sequence', () => {
                const { outbound, inboundReversed } = legs('position_long');
                expectSequencesEqual(inboundReversed, outbound, `section ${sectionNumber} position_long`);
            });

            test('the inbound leg retraces the outbound altitude profile', () => {
                const { outbound, inboundReversed } = legs('altitude');
                expectSequencesEqual(inboundReversed, outbound, `section ${sectionNumber} altitude`);
            });

            /**
             * KNOWN LIMIT, stated so this guard is not read as stronger than it
             * is: `golden-ride.json`'s `wind_yaw` is identically 0 at all 1436
             * samples, so the inbound leg here is a constant 180. The guard does
             * catch the rotation being dropped — that would make inbound yaw
             * equal outbound yaw — but on this source it cannot tell a
             * per-sample rotation from a constant, because there is no
             * per-sample variation to preserve.
             */
            test('the inbound leg\'s wind yaw is the reversed outbound yaw rotated 180 degrees', () => {
                const { outbound, inboundReversed } = legs('wind_yaw');
                const expected = outbound.map(value => (((value + INBOUND_YAW_ROTATION_DEGREES) % 360) + 360) % 360);

                expectSequencesEqual(inboundReversed, expected, `section ${sectionNumber} wind_yaw`);
            });

            test('distance increases across the leg turn rather than jumping backwards', () => {
                const json = readFixture();
                const s = section();
                const atTurn = json.distance[s.inboundStartIdx] - json.distance[s.outboundEndIdx];

                expect(`section ${sectionNumber} turn step positive: ${atTurn > 0}`).toBe(
                    `section ${sectionNumber} turn step positive: true`,
                );
            });
        });
    });

    describe('Block B — the fixture keeps declaring its own evidentiary limits', () => {
        test('it declares itself synthetic and deterministic, and names its regeneration command', () => {
            const { provenance } = loadOutAndBackRide();

            expect(provenance.synthetic).toBe(true);
            expect(provenance.deterministic).toBe(true);
            expect(provenance.derivedFrom).toBe('golden-ride.json');
            expect(provenance.regenerateWith).toContain('build-out-and-back-fixture.ts');
        });

        test('evidenceStrength states in plain words that this is weaker than a real ride', () => {
            const { provenance } = loadOutAndBackRide();

            expect(typeof provenance.evidenceStrength).toBe('string');
            expect(provenance.evidenceStrength.length).toBeGreaterThan(80);
            expect(provenance.evidenceStrength).toMatch(/weaker/i);
            expect(provenance.evidenceStrength).toMatch(/real/i);
            expect(provenance.evidenceStrength).toMatch(/browser-verified/i);
        });

        test.each(REQUIRED_DISCLAIMERS)('whatThisDoesNotDischarge names $label', ({ label, pattern }) => {
            const { provenance } = loadOutAndBackRide();
            const entries = provenance.whatThisDoesNotDischarge ?? [];

            const matched = entries.some(entry => pattern.test(entry));
            expect(`whatThisDoesNotDischarge (${entries.length} entries) names ${label}: ${matched}`).toBe(
                `whatThisDoesNotDischarge (${entries.length} entries) names ${label}: true`,
            );
        });

        test('the derivation records the reversal and the rebuilt distance by name', () => {
            const { provenance } = loadOutAndBackRide();
            const derivation = provenance.derivation.join('\n');

            expect(derivation).toMatch(/REVERSE order/);
            expect(derivation).toMatch(/rotated by 180 degrees modulo 360/);
            expect(derivation).toMatch(/distance REBUILT, never copied/);
        });
    });

    describe('Block C — the loader hands back what the file carries', () => {
        test('the sensor channels come through unmodified', () => {
            const json = readFixture();
            const ride = loadOutAndBackRide();
            const fitData = ride.fitData as unknown as Record<string, number[]>;

            for (const name of ['timestamps', 'position_lat', 'position_long', 'altitude', 'velocity', 'power', 'air_speed', 'distance', 'wind_yaw', 'temperature']) {
                expectSequencesEqual(fitData[name], json[name as (typeof FIXTURE_ARRAYS)[number]], `fitData.${name}`);
            }
            expectSequencesEqual(ride.rhoArray, json.rhoArray, 'rhoArray');
        });

        /**
         * The six channels `loadGoldenRide` zero-fills rather than storing.
         * `heart_rate` / `cadence` / `battery_soc` must never be committed
         * (threat T-07-02), so they can only ever be zeros here.
         */
        test('the never-stored channels are zero-filled to full length', () => {
            const ride = loadOutAndBackRide();
            const fitData = ride.fitData as unknown as Record<string, number[]>;

            for (const name of ['wind_speed', 'air_density_data', 'road_speed', 'battery_soc', 'heart_rate', 'cadence']) {
                const values = fitData[name];
                expect(`${name}: ${values.length} samples, ${values.filter(v => v !== 0).length} non-zero`).toBe(
                    `${name}: ${EXPECTED_RECORD_COUNT} samples, 0 non-zero`,
                );
            }
        });
    });
});
