/**
 * Build the synthetic out-and-back fixture from the committed golden ride.
 *
 *   cd frontend && npx vite-node scripts/build-out-and-back-fixture.ts
 *
 * No arguments. Input:  src/analysis/__fixtures__/golden-ride.json
 *                Output: src/analysis/__fixtures__/out-and-back-ride.json
 *
 * WHY THIS EXISTS. There is no out-and-back FIT ride — none available to the
 * maintainer, none in the repo. That single absence is why the out-and-back
 * branch of the unified update pipeline has never been exercised end-to-end by
 * a test with real-shaped data. `golden-ride.json` does carry a `sections`
 * array, but those sections are each a lap split in half: a LAP ride wearing an
 * out-and-back label, with no retracing geometry anywhere in it. This script
 * builds the geometry that is actually missing.
 *
 * WHAT IT IS WORTH, STATED HERE BECAUSE IT IS EASY TO FORGET DOWNSTREAM.
 * A synthetic fixture is **WEAKER evidence than a real out-and-back ride.** It
 * does not retire "never seen in a browser". It cannot produce a DevTools stall
 * measurement, a human smoothness impression, or a real-ride before/after. The
 * same statement is emitted INTO the fixture as `_provenance.evidenceStrength`
 * and `_provenance.whatThisDoesNotDischarge`, and asserted by
 * `src/analysis/outAndBackFixture.test.ts`, so a future edit that quietly strips
 * the caveat fails a test rather than passing silently.
 *
 * TWO RULES THIS SCRIPT IS WRITTEN AGAINST, both differing from
 * `build-golden-fixture.ts` on purpose:
 *
 * 1. **Determinism is a hard requirement.** No random draw of any kind, no
 *    wall-clock read, no timestamp of the run — and the names of those APIs are
 *    kept out of this file entirely, so that a mechanical grep for them can
 *    require zero hits rather than zero hits "outside comments".
 *    Running this twice must produce a
 *    byte-identical file. That is a stronger control than the scratch-directory
 *    separation `build-golden-fixture.ts` needs — its transform is randomised,
 *    so its output can never be re-derived and has to be reviewed by hand;
 *    this one writes straight into the fixture directory because any reviewer
 *    can regenerate it and diff.
 *
 * 2. **The input is already anonymised, and nothing new is introduced.** Every
 *    emitted value is a verbatim copy, a reversal, or an arithmetic transform
 *    of a value already present in the maintainer-approved `golden-ride.json`
 *    (D-12, 2026-08-03). No new source data enters the repository. The emitted
 *    field set is an explicit ALLOW-LIST (`COPIED_ARRAYS` below), so
 *    `heart_rate`, `cadence`, `battery_soc`, device serial, manufacturer ids
 *    and file id are absent by construction rather than by filtering.
 */

import { readFileSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

import type { AnalysisParameters } from '../src/components/AnalysisParameters'

const GOLDEN_RIDE_PATH = fileURLToPath(
    new URL('../src/analysis/__fixtures__/golden-ride.json', import.meta.url),
)
const OUT_AND_BACK_RIDE_PATH = fileURLToPath(
    new URL('../src/analysis/__fixtures__/out-and-back-ride.json', import.meta.url),
)

const REGENERATE_COMMAND = 'cd frontend && npx vite-node scripts/build-out-and-back-fixture.ts'

/**
 * 1-based lap numbers into `golden-ride.json`'s seven `indexRanges`. Laps 1, 3
 * and 5 are source index ranges [0,241], [367,616] and [770,1018] — 242, 250
 * and 249 samples. Chosen for THREE DIFFERENT lengths, so nothing downstream
 * can accidentally pass by assuming equal sections, and for carrying real
 * sensor noise rather than a smooth synthetic signal.
 */
const SOURCE_LAP_NUMBERS = [1, 3, 5]

/**
 * The rider turns around, so apparent wind yaw flips with them. Applied modulo
 * 360 on top of the reversal.
 */
const INBOUND_YAW_ROTATION_DEGREES = 180

/**
 * The nine arrays copied from the source lap. `distance` and `timestamps` are
 * NOT here: both are rebuilt (see `deriveDistanceSteps`). This list is the
 * allow-list — anything not named here is structurally unable to reach the
 * fixture.
 */
const COPIED_ARRAYS = [
    'power',
    'velocity',
    'air_speed',
    'temperature',
    'altitude',
    'position_lat',
    'position_long',
    'wind_yaw',
    'rhoArray',
] as const

type CopiedArrayName = (typeof COPIED_ARRAYS)[number]

/**
 * The decimals the SOURCE used, so the derived file cannot carry more precision
 * than its already-anonymised input (threat T-07-07-02). Five of these are read
 * back out of `golden-ride.json`'s own `_anonymisation.rounding` record rather
 * than restated here.
 *
 * `rhoArray` is the exception: `build-golden-fixture.ts:573` rounds rho at 9 dp
 * but its `rounding` record carries no field for it, so the value is named
 * here and cross-checked by `assertNoPrecisionUplift` against the actual file.
 */
const RHO_DECIMALS = 9

interface SourceRounding {
    coordinatesDecimals: number
    altitudeDecimals: number
    velocityDecimals: number
    powerDecimals: number
    otherDecimals: number
}

interface SourceIndexRange {
    startIdx: number
    endIdx: number
}

/** The subset of `golden-ride.json` this script reads. */
interface GoldenRideSource {
    _anonymisation: { rounding: SourceRounding }
    record_count: number
    distance: number[]
    indexRanges: SourceIndexRange[]
    params: AnalysisParameters
    power: number[]
    velocity: number[]
    air_speed: number[]
    temperature: number[]
    altitude: number[]
    position_lat: number[]
    position_long: number[]
    wind_yaw: number[]
    rhoArray: number[]
}

/**
 * A deliberate 5-field SUBSET of production's `OutAndBackSection`
 * (`src/utils/GpsLapDetection.ts:85`) — see `_provenance.sectionShape` in the
 * emitted file for the ten absent fields and why none of them is invented.
 */
export interface OutAndBackFixtureSection {
    sectionNumber: number
    outboundStartIdx: number
    outboundEndIdx: number
    inboundStartIdx: number
    inboundEndIdx: number
}

/**
 * The load-bearing header. This is not decoration: `whatThisDoesNotDischarge`
 * and `evidenceStrength` are the artifact's contract, and Block B of
 * `outAndBackFixture.test.ts` fails if either goes missing.
 */
export interface OutAndBackProvenance {
    synthetic: true
    derivedFrom: string
    generator: string
    deterministic: true
    regenerateWith: string
    /** Contains the words "weaker" and "real", on purpose. */
    evidenceStrength: string
    whatThisDoesNotDischarge: string[]
    derivation: string[]
    sourceLaps: Array<{ lapNumber: number; sourceStartIdx: number; sourceEndIdx: number; length: number }>
    sectionShape: string
    inheritedAnonymisation: string
    rounding: SourceRounding & { rhoDecimals: number }
}

export interface OutAndBackFixture {
    _provenance: OutAndBackProvenance
    record_count: number
    timestamps: number[]
    power: number[]
    velocity: number[]
    position_lat: number[]
    position_long: number[]
    altitude: number[]
    distance: number[]
    air_speed: number[]
    wind_yaw: number[]
    temperature: number[]
    rhoArray: number[]
    laps: Array<{ start_time: number; end_time: number }>
    indexRanges: SourceIndexRange[]
    sections: OutAndBackFixtureSection[]
    params: AnalysisParameters
}

function round(value: number, decimals: number): number {
    if (!Number.isFinite(value)) {
        return value
    }
    const factor = 10 ** decimals
    return Math.round(value * factor) / factor
}

function decimalsFor(name: CopiedArrayName | 'distance', rounding: SourceRounding): number {
    switch (name) {
        case 'position_lat':
        case 'position_long':
            return rounding.coordinatesDecimals
        case 'altitude':
            return rounding.altitudeDecimals
        case 'velocity':
            return rounding.velocityDecimals
        case 'power':
            return rounding.powerDecimals
        case 'rhoArray':
            return RHO_DECIMALS
        default:
            return rounding.otherDecimals
    }
}

/**
 * The distance rebuild, in one place because it is the only genuinely derived
 * geometry in the file and the one thing a copy would get wrong.
 *
 * A COPIED distance array jumps backwards at every leg turn — the inbound leg
 * retraces the road, so its source distances descend — and that breaks every
 * distance-based plot. So distance is rebuilt from STEPS:
 *
 *   - inside a leg: the source lap's per-sample forward delta, replayed in
 *     reverse order across the inbound leg;
 *   - at a leg TURN: the two samples sit at the SAME place, so the spatial step
 *     is zero and `distance` would go flat exactly where the turn has to be
 *     visible. The lap's last forward delta is used instead, standing for the
 *     rider carrying through the turnaround;
 *   - at a SECTION join: the next lap's first forward delta, for the same
 *     reason.
 *
 * Result: monotonically non-decreasing across the whole fixture, and strictly
 * increasing at every turn and every join.
 */
function deriveDistanceSteps(lapDistance: number[]): { outbound: number[]; inbound: number[] } {
    const length = lapDistance.length
    const forward = lapDistance.map((value, i) => (i === 0 ? 0 : value - lapDistance[i - 1]))

    // forward[0] is already 0: outbound sample 0 carries the join step, which
    // the caller supplies instead.
    const outbound = forward

    // Inbound sample j sits at source index (length - 1 - j), so the step INTO
    // it covers forward[length - j]. j = 0 is the turn.
    const inbound = Array.from({ length }, (_, j) => (j === 0 ? forward[length - 1] : forward[length - j]))

    return { outbound, inbound }
}

export function buildOutAndBackFixture(source: GoldenRideSource): OutAndBackFixture {
    const rounding = source._anonymisation.rounding
    const copied: Record<CopiedArrayName, number[]> = {
        power: [],
        velocity: [],
        air_speed: [],
        temperature: [],
        altitude: [],
        position_lat: [],
        position_long: [],
        wind_yaw: [],
        rhoArray: [],
    }
    const distance: number[] = []
    const sections: OutAndBackFixtureSection[] = []
    const sourceLaps: OutAndBackProvenance['sourceLaps'] = []

    let cumulative = 0

    SOURCE_LAP_NUMBERS.forEach((lapNumber, sectionIndex) => {
        const range = source.indexRanges[lapNumber - 1]
        if (!range) {
            throw new Error(
                `golden-ride.json has no indexRanges[${lapNumber - 1}] for source lap ${lapNumber}; ` +
                `it carries ${source.indexRanges.length} ranges.`,
            )
        }

        const length = range.endIdx - range.startIdx + 1
        const sliceLap = (values: number[]): number[] => values.slice(range.startIdx, range.endIdx + 1)
        const steps = deriveDistanceSteps(sliceLap(source.distance))

        // Source index for sample `k` of each leg: forward on the way out,
        // reversed on the way back. This ONE pair of expressions is what makes
        // the fixture out-and-back rather than a lap ride relabelled.
        const outboundSourceIdx = (k: number): number => range.startIdx + k
        const inboundSourceIdx = (k: number): number => range.startIdx + (length - 1 - k)

        // Sample 0 of section 0 is the fixture origin; every later section joins
        // with the new lap's first real delta so distance never goes flat at a
        // join either.
        const joinStep = sectionIndex === 0 ? 0 : steps.outbound[1]

        const outboundStartIdx = distance.length
        for (let k = 0; k < length; k++) {
            for (const name of COPIED_ARRAYS) {
                copied[name].push(round(source[name][outboundSourceIdx(k)], decimalsFor(name, rounding)))
            }
            cumulative += k === 0 ? joinStep : steps.outbound[k]
            distance.push(round(cumulative, rounding.otherDecimals))
        }
        const outboundEndIdx = distance.length - 1

        const inboundStartIdx = distance.length
        for (let k = 0; k < length; k++) {
            for (const name of COPIED_ARRAYS) {
                const value = source[name][inboundSourceIdx(k)]
                const transformed = name === 'wind_yaw'
                    ? (((value + INBOUND_YAW_ROTATION_DEGREES) % 360) + 360) % 360
                    : value
                copied[name].push(round(transformed, decimalsFor(name, rounding)))
            }
            cumulative += steps.inbound[k]
            distance.push(round(cumulative, rounding.otherDecimals))
        }
        const inboundEndIdx = distance.length - 1

        sections.push({
            sectionNumber: sectionIndex + 1,
            outboundStartIdx,
            outboundEndIdx,
            inboundStartIdx,
            inboundEndIdx,
        })
        sourceLaps.push({
            lapNumber,
            sourceStartIdx: range.startIdx,
            sourceEndIdx: range.endIdx,
            length,
        })
    })

    const recordCount = distance.length
    const timestamps = Array.from({ length: recordCount }, (_, i) => i)

    return {
        _provenance: buildProvenance(sourceLaps, rounding),
        record_count: recordCount,
        timestamps,
        power: copied.power,
        velocity: copied.velocity,
        position_lat: copied.position_lat,
        position_long: copied.position_long,
        altitude: copied.altitude,
        distance,
        air_speed: copied.air_speed,
        wind_yaw: copied.wind_yaw,
        temperature: copied.temperature,
        rhoArray: copied.rhoArray,
        // One lap / index range per SECTION, spanning its full 2L samples, so
        // the same file can be loaded in Standard and GPS-lap without a second
        // artifact. `timestamps` are the indices, so the two agree by
        // construction.
        laps: sections.map(section => ({
            start_time: section.outboundStartIdx,
            end_time: section.inboundEndIdx,
        })),
        indexRanges: sections.map(section => ({
            startIdx: section.outboundStartIdx,
            endIdx: section.inboundEndIdx,
        })),
        sections,
        params: source.params,
    }
}

function buildProvenance(
    sourceLaps: OutAndBackProvenance['sourceLaps'],
    rounding: SourceRounding,
): OutAndBackProvenance {
    const lapSummary = sourceLaps
        .map(lap => `lap ${lap.lapNumber} (source indices ${lap.sourceStartIdx}-${lap.sourceEndIdx}, ${lap.length} samples)`)
        .join(', ')

    return {
        synthetic: true,
        derivedFrom: 'golden-ride.json',
        generator: 'frontend/scripts/build-out-and-back-fixture.ts',
        deterministic: true,
        regenerateWith: REGENERATE_COMMAND,
        evidenceStrength:
            'This fixture is SYNTHETIC, and it is WEAKER evidence than a real out-and-back ride. ' +
            'It is built by reversing and re-concatenating laps of one real ride that was never ' +
            'itself an out-and-back, so what it can show is that the out-and-back code path ' +
            'accepts and processes genuinely retracing data — nothing more. A claim discharged by ' +
            'this fixture may NEVER be described as browser-verified or as real-ride verified, and ' +
            'it cannot stand in for a DevTools measurement, a human impression, or a real-ride ' +
            'before/after comparison. Cite it as what it is: a synthetic input.',
        whatThisDoesNotDischarge: [
            'The browser display of the four-plot out-and-back comparison view built in plan 07-04 Task 4. It has never been shown in a browser, and no data fixture can change that.',
            'The D-16 recompute-gate DevTools rows G-05, G-06, G-11 and G-12 (out-and-back Max Stall), which need a Chrome DevTools measurement on a real ride.',
            'The D-09 entry (t) out-and-back smoothness impression, which needs a human looking at a browser.',
            'The real-ride before/after numbers owed for D-09 entries (a), (c) and (d) — per-record air density, a non-contiguous multi-lap selection at non-zero offset, and a fetched DEM profile.',
            'N-1 (out-and-back Store Result / Export CSV agreeing with what is on screen) beyond the limit an automated test reaches: the on-screen half of that agreement is a browser observation.',
        ],
        derivation: [
            `1. Source: frontend/src/analysis/__fixtures__/golden-ride.json, ${lapSummary}. Three different lengths on purpose, so nothing downstream passes by assuming equal sections, and real sensor noise rather than a smooth synthetic signal.`,
            '2. Each source lap of length L becomes one out-and-back SECTION of 2L samples: an OUTBOUND leg of L samples followed by an INBOUND leg of L samples. The three sections are concatenated back to back into one contiguous index space.',
            '3. OUTBOUND leg: power, velocity, air_speed, temperature, altitude, position_lat, position_long, wind_yaw and rhoArray copied VERBATIM from the source lap, in source order.',
            '4. INBOUND leg: the same nine arrays from the same source lap, in REVERSE order. The rider retraces the road, so position and terrain retrace exactly — this reversal is what makes the fixture out-and-back rather than a lap ride relabelled, which is what golden-ride.json\'s own `sections` array is.',
            `5. INBOUND wind_yaw additionally rotated by ${INBOUND_YAW_ROTATION_DEGREES} degrees modulo 360, because the rider now faces the opposite way and apparent yaw flips with them. KNOWN WEAKNESS: golden-ride.json's wind_yaw is identically 0 at all 1436 samples, so on this source the rotation produces a constant 180 on every inbound leg. The transform is real; on this input it carries no per-sample variation, and a guard on it cannot tell a per-sample rotation from a constant.`,
            '6. distance REBUILT, never copied — a copied distance array descends across every leg turn and breaks every distance-based plot. Steps are the source lap\'s per-sample forward deltas, replayed in reverse across the inbound leg. Sample 0 of the fixture is 0. At a leg TURN the two samples sit at the same place, so a spatial step of 0 would leave distance flat exactly where the turn must be visible; the lap\'s last forward delta is used instead. At a SECTION join the next lap\'s first forward delta is used, for the same reason. distance is therefore monotonically non-decreasing across the whole fixture and strictly increasing at every turn and join.',
            '7. timestamps: the contiguous integers 0..record_count-1, matching golden-ride.json\'s relative-second convention.',
            '8. params copied verbatim from golden-ride.json\'s params.',
            `9. Rounding at the SOURCE's own decimals (coordinates ${rounding.coordinatesDecimals}, altitude ${rounding.altitudeDecimals}, velocity ${rounding.velocityDecimals}, power ${rounding.powerDecimals}, other ${rounding.otherDecimals}, rhoArray ${RHO_DECIMALS}), so the derived file cannot carry more precision than its already-anonymised input. Only the rebuilt distance and the rotated inbound wind_yaw are actually changed by this step; every other emitted value is bit-identical to its source value, which the generator asserts before writing.`,
        ],
        sourceLaps,
        sectionShape:
            '`sections` carries a deliberate 5-field SUBSET of production\'s OutAndBackSection ' +
            '(frontend/src/utils/GpsLapDetection.ts:85): sectionNumber plus the four *Idx fields. ' +
            'TEN fields of the production interface are absent — outboundStartDirection, ' +
            'outboundEndDirection, outboundDuration, outboundDistance, inboundStartDirection, ' +
            'inboundEndDirection, inboundDuration, inboundDistance, totalDuration and ' +
            'totalDistance. Only sectionNumber and the four *Idx fields are read on the update ' +
            'path (modes/analysis/outAndBackMode.ts prepareSelection and getUpdateSegments), and ' +
            'loadGoldenRide.ts\'s existing GoldenRideSection is already the same subset — so a ' +
            'consumer assigning these into appState.outAndBackSections needs a cast. The absent ' +
            'fields are deliberately NOT invented: fabricated direction, duration and distance ' +
            'values that nothing reads would be indistinguishable from measured ones.',
        inheritedAnonymisation:
            'Every emitted value is a verbatim copy, a reversal, or an arithmetic transform of a ' +
            'value already present in golden-ride.json — a file the maintainer approved under the ' +
            'blocking D-12 checkpoint on 2026-08-03, after a 7-step anonymisation whose source ' +
            'centroid, rotation angle and altitude offset were never emitted. No new source data ' +
            'enters the repository, so this file creates no new D-12 exposure: it inherits the ' +
            'source\'s already-accepted residual risk and adds nothing to it. Reversing each lap ' +
            'and re-concatenating three of them does change the emitted route topology, so the ' +
            'derived file is if anything less recognisable than its source — but that is a SIDE ' +
            'EFFECT of the derivation, not a privacy control, and it must not be presented as ' +
            'one. The emitted field set is the explicit allow-list in the generator, so the ' +
            'identity-bearing channels a head unit records are absent by construction — nothing ' +
            'in the derivation copies them. They are named in the generator and in ' +
            '07-GOLDEN-BASELINE.md and deliberately NOT named here, because a self-declaring ' +
            '"fields I excluded" list inside the artifact would defeat the mechanical grep of ' +
            'this file for each of them while proving nothing.',
        rounding: { ...rounding, rhoDecimals: RHO_DECIMALS },
    }
}

/**
 * Threat T-07-07-02, enforced at generation time rather than only at review
 * time: if any VERBATIM copy would change under the rounding this script
 * claims the source used, then the claim is wrong and the file must not be
 * written. Catches both a precision uplift and a drifted decimals map.
 */
function assertNoPrecisionUplift(source: GoldenRideSource): void {
    const rounding = source._anonymisation.rounding
    for (const name of COPIED_ARRAYS) {
        const decimals = decimalsFor(name, rounding)
        const values = source[name]
        for (let i = 0; i < values.length; i++) {
            if (round(values[i], decimals) !== values[i]) {
                throw new Error(
                    `Precision claim is wrong: golden-ride.json ${name}[${i}] = ${values[i]} does not ` +
                    `survive rounding at ${decimals} dp. Fix decimalsFor(), do not widen the rounding.`,
                )
            }
        }
    }
}

/** Everything the fixture claims about its own shape, checked before writing. */
function assertFixtureIntegrity(fixture: OutAndBackFixture): void {
    const arrays: Array<[string, number[]]> = [
        ['timestamps', fixture.timestamps],
        ['distance', fixture.distance],
        ...COPIED_ARRAYS.map(name => [name, fixture[name]] as [string, number[]]),
    ]
    for (const [name, values] of arrays) {
        if (values.length !== fixture.record_count) {
            throw new Error(`${name} has ${values.length} samples, record_count is ${fixture.record_count}.`)
        }
    }

    for (let i = 1; i < fixture.distance.length; i++) {
        if (fixture.distance[i] < fixture.distance[i - 1]) {
            throw new Error(
                `distance goes backwards at index ${i}: ${fixture.distance[i - 1]} -> ${fixture.distance[i]}.`,
            )
        }
    }

    fixture.sections.forEach((section, i) => {
        if (section.inboundStartIdx !== section.outboundEndIdx + 1) {
            throw new Error(`section ${section.sectionNumber}: inbound does not start one past outbound.`)
        }
        const outboundLength = section.outboundEndIdx - section.outboundStartIdx + 1
        const inboundLength = section.inboundEndIdx - section.inboundStartIdx + 1
        if (outboundLength !== inboundLength) {
            throw new Error(
                `section ${section.sectionNumber}: legs are ${outboundLength} and ${inboundLength} samples.`,
            )
        }
        const expectedStart = i === 0 ? 0 : fixture.sections[i - 1].inboundEndIdx + 1
        if (section.outboundStartIdx !== expectedStart) {
            throw new Error(`section ${section.sectionNumber}: starts at ${section.outboundStartIdx}, expected ${expectedStart}.`)
        }
    })

    const last = fixture.sections[fixture.sections.length - 1]
    if (!last || last.inboundEndIdx !== fixture.record_count - 1) {
        throw new Error('sections do not tile the whole fixture.')
    }
}

function main(): void {
    const source = JSON.parse(readFileSync(GOLDEN_RIDE_PATH, 'utf8')) as GoldenRideSource

    assertNoPrecisionUplift(source)
    const fixture = buildOutAndBackFixture(source)
    assertFixtureIntegrity(fixture)

    writeFileSync(OUT_AND_BACK_RIDE_PATH, `${JSON.stringify(fixture, null, 2)}\n`, 'utf8')

    const sectionSummary = fixture.sections
        .map(section => `#${section.sectionNumber} ${section.outboundStartIdx}-${section.inboundEndIdx}`)
        .join('  ')
    process.stdout.write(
        `Wrote ${OUT_AND_BACK_RIDE_PATH}\n` +
        `  record_count ${fixture.record_count}, ${fixture.sections.length} sections: ${sectionSummary}\n` +
        `  total distance ${fixture.distance[fixture.record_count - 1]} m\n` +
        '  SYNTHETIC — weaker evidence than a real out-and-back ride. See _provenance.\n',
    )
}

/**
 * Self-execute only under the documented invocation. This script takes no
 * arguments, so `build-golden-fixture.ts`'s positional-argument discriminator
 * is unavailable and the runner name is used instead: under
 * `npx vite-node scripts/build-out-and-back-fixture.ts`, argv[1] is vite-node's
 * own binary. Under vitest argv[1] is `vitest`, which does not match, so
 * importing this module from a test cannot overwrite the committed fixture.
 */
const runner = process.argv[1] ?? ''
if (runner.includes('vite-node') || runner.includes('build-out-and-back-fixture')) {
    try {
        main()
    } catch (error) {
        process.stderr.write(`${error instanceof Error ? (error.stack ?? error.message) : String(error)}\n`)
        process.exitCode = 1
    }
}
