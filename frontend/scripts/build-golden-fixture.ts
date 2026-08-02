/**
 * Build the D-12 candidate golden fixture from a real .fit ride.
 *
 *   npx vite-node scripts/build-golden-fixture.ts -- <path-to.fit> [options]
 *
 * Options (all optional; every one is recorded in the emitted `_anonymisation`
 * header so a re-cut is reproducible from the artifact alone):
 *   --rotation-deg=<n>   rotation applied to the coordinate cloud (default 137)
 *   --origin-lat=<n>     arbitrary destination centroid latitude  (default 45)
 *   --origin-long=<n>    arbitrary destination centroid longitude (default -30)
 *   --window=<n>         target sample-window length              (default 1600)
 *   --window-start=<n>   force the window start index (default: auto-chosen to
 *                        maximise lap-boundary and dropout coverage)
 *   --out-dir=<path>     scratch output directory (default: os.tmpdir())
 *
 * NOTHING is written into frontend/src/analysis/__fixtures__/ by this script.
 * Both artifacts land in a scratch directory whose paths are printed on exit.
 * Promotion into the tracked fixture directory happens only after the blocking
 * D-12 maintainer checkpoint (07-01 Task 4). This separation is threat T-07-03:
 * an un-reviewed intermediate must not be able to reach the repo by accident.
 *
 * The seven anonymisation steps are implemented in `anonymise()` below and each
 * one records its concrete parameter into the `_anonymisation` object.
 */

import { readFile, writeFile, mkdir } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve as resolvePath } from 'node:path'

import init, {
    parse_fit_file,
    AirDensityCalculator,
} from '../pkg/virtual_elevation_analyzer.js'
import { DEFAULT_PARAMETERS, type AnalysisParameters } from '../src/components/AnalysisParameters'

/**
 * The emitted field set. This is an explicit ALLOW-LIST, never a passthrough of
 * the parsed record (threat T-07-02). Everything the pipeline does not consume
 * is structurally unable to reach the fixture, because nothing copies it here.
 *
 * Deliberately absent, and absent by construction rather than by filtering:
 * device serial, manufacturer / product ids, file id, user profile, session
 * name, heart_rate, cadence, battery_soc.
 */
export interface GoldenRideFixture {
    _anonymisation: AnonymisationRecord
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
    indexRanges: Array<{ startIdx: number; endIdx: number }>
    sections: Array<{
        sectionNumber: number
        outboundStartIdx: number
        outboundEndIdx: number
        inboundStartIdx: number
        inboundEndIdx: number
    }>
    params: AnalysisParameters
}

export interface AnonymisationRecord {
    note: string
    steps: string[]
    relativeTimestamps: { subtractedFirstTimestamp: true }
    coordinateTransform: {
        centroidSubtracted: true
        rotationDegrees: number
        destinationOriginLat: number
        destinationOriginLong: number
    }
    sampleWindow: { startIdx: number; endIdx: number; length: number; sourceRecordCount: number }
    rounding: { coordinatesDecimals: number; altitudeDecimals: number; velocityDecimals: number; powerDecimals: number; otherDecimals: number }
    altitudeOffsetMetres: number
    droppedArrays: string[]
}

const DEFAULT_ROTATION_DEG = 137
const DEFAULT_ORIGIN_LAT = 45
const DEFAULT_ORIGIN_LONG = -30
const DEFAULT_WINDOW = 1600
const MIN_WINDOW = 1200
const MAX_WINDOW = 2000

const COORD_DECIMALS = 5
const ALTITUDE_DECIMALS = 1
const VELOCITY_DECIMALS = 3
const POWER_DECIMALS = 0
const OTHER_DECIMALS = 3

/** Fixed for the fixture so every golden literal is reproducible from the file alone. */
const FIXTURE_PARAMS: AnalysisParameters = {
    ...DEFAULT_PARAMETERS,
    system_mass: 80,
    rho: 1.2,
    eta: 0.97,
    cda: null,
    crr: null,
    wind_speed: 3.5,
    wind_direction: 220,
    air_speed_offset: 2,
    velodrome: false,
    auto_calculate_rho: false,
    crr_temp_correction: false,
    ambient_temp_c: null,
}

/**
 * Named ONLY here and in the review page — deliberately never written into the
 * emitted JSON. The plan's acceptance check is a mechanical grep of the fixture
 * for each of these identifiers requiring zero hits, and a self-declaring
 * "fields I excluded" list inside the fixture would defeat that check while
 * proving nothing. The permanent record of the exclusion belongs in
 * `.planning/phases/07-mode-pipeline-unification/07-GOLDEN-BASELINE.md`.
 */
const EXCLUDED_IDENTITY_FIELDS = [
    'device serial',
    'manufacturer id',
    'product id',
    'file id',
    'user profile',
    'session name',
    'heart rate',
    'cadence',
    'battery state of charge',
]

export interface Options {
    fitPath: string
    rotationDeg: number
    originLat: number
    originLong: number
    windowLength: number
    windowStart: number | null
    outDir: string
}

async function main(): Promise<void> {
    const options = parseArgs(process.argv.slice(2))

    const wasm = await readFile(new URL('../pkg/virtual_elevation_analyzer_bg.wasm', import.meta.url))
    await init({ module_or_path: wasm })

    const fitBytes = await readFile(options.fitPath)
    const parsed = parse_fit_file(new Uint8Array(fitBytes))
    const fitData = parsed.fit_data
    const rawLaps = Array.from(parsed.laps).map(lap => ({
        start_time: lap.start_time,
        end_time: lap.end_time,
    }))

    const source = {
        timestamps: Array.from(fitData.timestamps),
        power: Array.from(fitData.power),
        velocity: Array.from(fitData.velocity),
        position_lat: Array.from(fitData.position_lat),
        position_long: Array.from(fitData.position_long),
        altitude: Array.from(fitData.altitude),
        distance: Array.from(fitData.distance),
        air_speed: Array.from(fitData.air_speed),
        wind_yaw: Array.from(fitData.wind_yaw),
        temperature: Array.from(fitData.temperature),
    }

    const fixture = anonymise(source, rawLaps, options)

    await mkdir(options.outDir, { recursive: true })
    const jsonPath = join(options.outDir, 'golden-ride.json')
    const htmlPath = join(options.outDir, 'golden-ride-review.html')

    await writeFile(jsonPath, `${JSON.stringify(fixture, null, 2)}\n`, 'utf8')
    await writeFile(htmlPath, buildReviewHtml(fixture), 'utf8')

    process.stdout.write('\nD-12 candidate fixture written to a SCRATCH path (not the repo):\n')
    process.stdout.write(`  candidate JSON : ${jsonPath}\n`)
    process.stdout.write(`  review page    : ${htmlPath}\n\n`)
    process.stdout.write('Summary:\n')
    process.stdout.write(`  samples       : ${fixture.record_count}\n`)
    process.stdout.write(`  duration      : ${fixture.timestamps[fixture.record_count - 1].toFixed(0)} s\n`)
    process.stdout.write(`  laps          : ${fixture.laps.length}\n`)
    process.stdout.write(`  indexRanges   : ${fixture.indexRanges.length}\n`)
    process.stdout.write(`  sections      : ${fixture.sections.length}\n`)
    process.stdout.write(`  dropouts      : ${countDropouts(fixture)}\n`)
    process.stdout.write(`  rho min/max   : ${Math.min(...fixture.rhoArray).toFixed(6)} / ${Math.max(...fixture.rhoArray).toFixed(6)}\n\n`)
    process.stdout.write('Open the review page in a browser before approving. Nothing has been\n')
    process.stdout.write('written into frontend/src/analysis/__fixtures__/.\n')
}

export interface SourceArrays {
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
}

/**
 * The seven anonymisation steps, in order. Each one writes its concrete
 * parameter into the returned `_anonymisation` record — the transform must be
 * legible as deliberate, not mistakable for a bug.
 */
export function anonymise(
    source: SourceArrays,
    rawLaps: Array<{ start_time: number; end_time: number }>,
    options: Options,
): GoldenRideFixture {
    const sourceCount = source.timestamps.length
    if (sourceCount === 0) {
        throw new Error('The parsed ride has no records.')
    }

    // Step 3 (applied first so every later step operates on the window only):
    // trim to a fragment. A fragment is not a recognisable loop; a full ride is.
    const window = chooseWindow(source, rawLaps, options)
    const slice = <T,>(values: T[]): T[] => values.slice(window.startIdx, window.endIdx + 1)

    const timestampsRaw = slice(source.timestamps)
    const positionLatRaw = slice(source.position_lat)
    const positionLongRaw = slice(source.position_long)
    const altitudeRaw = slice(source.altitude)
    const count = timestampsRaw.length

    // Step 1: timestamps → relative. Removes ride date and time of day entirely.
    const t0 = timestampsRaw[0]
    const timestamps = timestampsRaw.map(t => round(t - t0, OTHER_DECIMALS))

    // Step 2: translate AND rotate. Translation alone leaves compass
    // orientation and route shape intact, and route shape is the real
    // re-identification vector for a repeated training venue.
    const centroidLat = mean(positionLatRaw)
    const centroidLong = mean(positionLongRaw)
    const theta = (options.rotationDeg * Math.PI) / 180
    const cosT = Math.cos(theta)
    const sinT = Math.sin(theta)

    const position_lat: number[] = []
    const position_long: number[] = []
    for (let i = 0; i < count; i++) {
        const dLat = positionLatRaw[i] - centroidLat
        const dLong = positionLongRaw[i] - centroidLong
        // Step 4 (coordinates): round to 5 dp ≈ 1 m, killing LSB fingerprints.
        position_lat.push(round(options.originLat + dLat * cosT - dLong * sinT, COORD_DECIMALS))
        position_long.push(round(options.originLong + dLat * sinT + dLong * cosT, COORD_DECIMALS))
    }

    // Step 5: constant altitude offset. The absolute elevation band carries a
    // location signal; the *shape* is exactly the real-world character D-12
    // wants, so it is never distorted non-linearly.
    const altitudeOffset = round(100 - mean(altitudeRaw), ALTITUDE_DECIMALS)
    const altitude = altitudeRaw.map(a => round(a + altitudeOffset, ALTITUDE_DECIMALS))

    // Step 4 (everything else): round to the sensor's own precision.
    const power = slice(source.power).map(v => round(v, POWER_DECIMALS))
    const velocity = slice(source.velocity).map(v => round(v, VELOCITY_DECIMALS))
    const air_speed = slice(source.air_speed).map(v => round(v, OTHER_DECIMALS))
    const wind_yaw = slice(source.wind_yaw).map(v => round(v, OTHER_DECIMALS))
    const temperature = slice(source.temperature).map(v => round(v, OTHER_DECIMALS))

    // Distance is re-based to the window start so it starts at 0 — an absolute
    // odometer reading is a weak device fingerprint and the pipeline only ever
    // uses distance differences.
    const distanceRaw = slice(source.distance)
    const distanceBase = distanceRaw[0]
    const distance = distanceRaw.map(d => round(d - distanceBase, OTHER_DECIMALS))

    // Step 6: humidity and pressure are not emitted at all; they are folded
    // into rhoArray below, where they are weather rather than identity.
    const rhoArray = buildRhoArray(temperature, count)

    const laps = rawLaps
        .map(lap => ({
            start_time: round(lap.start_time - t0, OTHER_DECIMALS),
            end_time: round(lap.end_time - t0, OTHER_DECIMALS),
        }))
        .filter(lap => lap.end_time > timestamps[0] && lap.start_time < timestamps[count - 1])

    const indexRanges = buildIndexRanges(timestamps, laps)
    const sections = buildSections(indexRanges)

    // Step 7: record steps 1-6 in a header field.
    const _anonymisation: AnonymisationRecord = {
        note:
            'Derived from one real ride, then deliberately transformed. Every number below ' +
            'is a transform parameter, not a bug. Residual risk is stated in ' +
            '.planning/phases/07-mode-pipeline-unification/07-GOLDEN-BASELINE.md: route ' +
            'topology and terrain relief survive every transform here, which is why a ' +
            'blocking maintainer checkpoint (D-12) gates this file, not an automated rule.',
        steps: [
            '1. timestamps made relative (t - t[0]); ride date and time of day removed',
            '2. coordinates centroid-subtracted, rotated, re-origined at an arbitrary point',
            '3. trimmed to a sub-window fragment retaining lap boundaries and dropouts',
            '4. coordinates rounded to 5 dp; other series rounded to sensor precision',
            '5. altitude offset by a constant (profile shape preserved exactly)',
            '6. humidity and pressure dropped; folded into rhoArray instead',
            '7. this record written so the transform reads as deliberate',
        ],
        relativeTimestamps: { subtractedFirstTimestamp: true },
        coordinateTransform: {
            centroidSubtracted: true,
            rotationDegrees: options.rotationDeg,
            destinationOriginLat: options.originLat,
            destinationOriginLong: options.originLong,
        },
        sampleWindow: {
            startIdx: window.startIdx,
            endIdx: window.endIdx,
            length: count,
            sourceRecordCount: sourceCount,
        },
        rounding: {
            coordinatesDecimals: COORD_DECIMALS,
            altitudeDecimals: ALTITUDE_DECIMALS,
            velocityDecimals: VELOCITY_DECIMALS,
            powerDecimals: POWER_DECIMALS,
            otherDecimals: OTHER_DECIMALS,
        },
        altitudeOffsetMetres: altitudeOffset,
        droppedArrays: ['humidity', 'pressure', 'wind_speed', 'air_density_data', 'road_speed'],
    }

    return {
        _anonymisation,
        record_count: count,
        timestamps,
        power,
        velocity,
        position_lat,
        position_long,
        altitude,
        distance,
        air_speed,
        wind_yaw,
        temperature,
        rhoArray,
        laps,
        indexRanges,
        sections,
        params: FIXTURE_PARAMS,
    }
}

/**
 * rhoArray must NOT be constant — the rho-present / rho-absent golden axis has
 * nothing to detect if it is. Built from the ride's own temperature plus a
 * smooth deterministic pressure ramp, through the app's own air-density
 * function rather than a hand-rolled formula.
 */
function buildRhoArray(temperature: number[], count: number): number[] {
    const rho: number[] = []
    const hasTemperature = temperature.length === count && temperature.some(t => Number.isFinite(t) && t !== 0)

    for (let i = 0; i < count; i++) {
        const ramp = i / Math.max(1, count - 1)
        const pressureHpa = 1013 - ramp * 6
        const tempC = hasTemperature && Number.isFinite(temperature[i]) ? temperature[i] : 15 + ramp * 4
        const humidity = 55
        let value: number
        try {
            value = AirDensityCalculator.calculate_air_density_from_humidity(tempC, pressureHpa, humidity)
        } catch {
            value = 1.225 - ramp * 0.01
        }
        rho.push(round(value, 9))
    }

    if (Math.max(...rho) - Math.min(...rho) <= 1e-6) {
        // Fallback guarantee: a constant rho array would make the rho axis vacuous.
        for (let i = 0; i < count; i++) {
            rho[i] = round(1.2 + (i / Math.max(1, count - 1)) * 0.05, 9)
        }
    }

    return rho
}

/**
 * Choose the sub-window. Scores every candidate start by how many lap
 * boundaries and sensor dropouts it contains, so the fragment still exercises
 * multi-lap Standard and the dropout handling that motivated a real ride.
 */
function chooseWindow(
    source: SourceArrays,
    rawLaps: Array<{ start_time: number; end_time: number }>,
    options: Options,
): { startIdx: number; endIdx: number } {
    const sourceCount = source.timestamps.length
    const length = Math.min(options.windowLength, sourceCount)

    if (options.windowStart !== null) {
        const startIdx = Math.max(0, Math.min(options.windowStart, sourceCount - length))
        return { startIdx, endIdx: startIdx + length - 1 }
    }

    const boundaryIndices = rawLaps
        .map(lap => nearestIndex(source.timestamps, lap.start_time))
        .filter(idx => idx >= 0)
    const dropoutIndices: number[] = []
    for (let i = 0; i < sourceCount; i++) {
        if (isDropout(source, i)) {
            dropoutIndices.push(i)
        }
    }

    let best = { startIdx: 0, score: -1 }
    const step = Math.max(1, Math.floor(length / 20))
    for (let startIdx = 0; startIdx + length <= sourceCount; startIdx += step) {
        const endIdx = startIdx + length - 1
        const boundaries = boundaryIndices.filter(i => i > startIdx && i < endIdx).length
        const dropouts = dropoutIndices.filter(i => i >= startIdx && i <= endIdx).length
        // Lap boundaries dominate: 3+ of them is a hard requirement, dropouts a bonus.
        const score = Math.min(boundaries, 8) * 100 + Math.min(dropouts, 50)
        if (score > best.score) {
            best = { startIdx, score }
        }
    }

    return { startIdx: best.startIdx, endIdx: best.startIdx + length - 1 }
}

function isDropout(source: SourceArrays, i: number): boolean {
    return (
        !Number.isFinite(source.position_lat[i]) ||
        !Number.isFinite(source.position_long[i]) ||
        !Number.isFinite(source.power[i]) ||
        !Number.isFinite(source.velocity[i]) ||
        !Number.isFinite(source.air_speed[i]) ||
        source.air_speed[i] === 0
    )
}

function countDropouts(fixture: GoldenRideFixture): number {
    let n = 0
    for (let i = 0; i < fixture.record_count; i++) {
        if (
            !Number.isFinite(fixture.position_lat[i]) ||
            !Number.isFinite(fixture.power[i]) ||
            !Number.isFinite(fixture.air_speed[i]) ||
            fixture.air_speed[i] === 0
        ) {
            n++
        }
    }
    return n
}

/** GPS-lap mode drives explicit index ranges, so the fixture carries them as data. */
function buildIndexRanges(
    timestamps: number[],
    laps: Array<{ start_time: number; end_time: number }>,
): Array<{ startIdx: number; endIdx: number }> {
    const ranges: Array<{ startIdx: number; endIdx: number }> = []
    for (const lap of laps) {
        const startIdx = nearestIndex(timestamps, lap.start_time)
        const endIdx = nearestIndex(timestamps, lap.end_time)
        if (startIdx >= 0 && endIdx > startIdx + 10) {
            ranges.push({ startIdx, endIdx })
        }
    }

    if (ranges.length >= 3) {
        return ranges
    }

    // The window did not contain enough usable lap boundaries. Fall back to an
    // even split so the fixture still exercises multi-lap GPS mode, and say so
    // loudly rather than emitting a two-lap fixture that silently under-tests.
    process.stderr.write(
        `WARNING: only ${ranges.length} usable lap ranges in the window; falling back to an even 4-way split. ` +
        'Consider --window-start to target a lap-dense part of the ride.\n',
    )
    const count = timestamps.length
    const span = Math.floor(count / 4)
    return Array.from({ length: 4 }, (_, i) => ({
        startIdx: i * span,
        endIdx: i === 3 ? count - 1 : (i + 1) * span - 1,
    }))
}

/** Out-and-back drives outbound/inbound halves of each section. */
function buildSections(
    indexRanges: Array<{ startIdx: number; endIdx: number }>,
): GoldenRideFixture['sections'] {
    return indexRanges.map((range, i) => {
        const midpoint = range.startIdx + Math.floor((range.endIdx - range.startIdx) / 2)
        return {
            sectionNumber: i + 1,
            outboundStartIdx: range.startIdx,
            outboundEndIdx: midpoint,
            inboundStartIdx: midpoint + 1,
            inboundEndIdx: range.endIdx,
        }
    })
}

function nearestIndex(timestamps: number[], target: number): number {
    let bestIdx = -1
    let bestDelta = Number.POSITIVE_INFINITY
    for (let i = 0; i < timestamps.length; i++) {
        const delta = Math.abs(timestamps[i] - target)
        if (delta < bestDelta) {
            bestDelta = delta
            bestIdx = i
        }
    }
    return bestIdx
}

function mean(values: number[]): number {
    const finite = values.filter(v => Number.isFinite(v))
    if (finite.length === 0) {
        return 0
    }
    return finite.reduce((sum, v) => sum + v, 0) / finite.length
}

function round(value: number, decimals: number): number {
    if (!Number.isFinite(value)) {
        return value
    }
    const factor = 10 ** decimals
    return Math.round(value * factor) / factor
}

/**
 * Self-contained review page — no external assets, no network requests. This is
 * the artifact the maintainer judges at the D-12 checkpoint, and it is a review
 * aid only: it is deleted on approval and never committed (threat T-07-03).
 */
export function buildReviewHtml(fixture: GoldenRideFixture): string {
    const routePath = buildSvgPath(fixture.position_long, fixture.position_lat, 760, 420, true)
    const altPath = buildSvgPath(
        fixture.distance.map(d => d / 1000),
        fixture.altitude,
        760,
        220,
        false,
    )

    const latExtent = extent(fixture.position_lat)
    const longExtent = extent(fixture.position_long)
    const altExtent = extent(fixture.altitude)
    const metresPerDegLat = 111_320
    const midLat = (latExtent.min + latExtent.max) / 2
    const bboxNorthSouthM = (latExtent.max - latExtent.min) * metresPerDegLat
    const bboxEastWestM =
        (longExtent.max - longExtent.min) * metresPerDegLat * Math.cos((midLat * Math.PI) / 180)

    const rows: Array<[string, string]> = [
        ['Samples', String(fixture.record_count)],
        ['Duration (s)', fixture.timestamps[fixture.record_count - 1].toFixed(0)],
        ['Bounding box N–S (m)', bboxNorthSouthM.toFixed(0)],
        ['Bounding box E–W (m)', bboxEastWestM.toFixed(0)],
        ['Altitude range (m)', `${altExtent.min.toFixed(1)} … ${altExtent.max.toFixed(1)} (${(altExtent.max - altExtent.min).toFixed(1)} m relief)`],
        ['Laps', String(fixture.laps.length)],
        ['Index ranges (GPS-lap)', String(fixture.indexRanges.length)],
        ['Sections (out-and-back)', String(fixture.sections.length)],
        ['Dropout samples', String(countDropouts(fixture))],
        ['Rotation applied (°)', String(fixture._anonymisation.coordinateTransform.rotationDegrees)],
        ['Altitude offset (m)', String(fixture._anonymisation.altitudeOffsetMetres)],
        ['Source window', `${fixture._anonymisation.sampleWindow.startIdx}…${fixture._anonymisation.sampleWindow.endIdx} of ${fixture._anonymisation.sampleWindow.sourceRecordCount}`],
    ]

    const tableRows = rows
        .map(([k, v]) => `<tr><th scope="row">${escapeHtml(k)}</th><td>${escapeHtml(v)}</td></tr>`)
        .join('\n            ')

    const fieldList = Object.keys(fixture)
        .map(k => `<li><code>${escapeHtml(k)}</code></li>`)
        .join('\n            ')

    return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>D-12 golden fixture review</title>
<style>
    body { font: 15px/1.5 system-ui, sans-serif; margin: 2rem auto; max-width: 860px; color: #1a1a1a; }
    h1 { font-size: 1.4rem; }
    h2 { font-size: 1.1rem; margin-top: 2rem; }
    svg { border: 1px solid #ccc; background: #fafafa; display: block; }
    table { border-collapse: collapse; margin-top: 0.5rem; }
    th, td { border: 1px solid #ddd; padding: 0.3rem 0.7rem; text-align: left; }
    th[scope="row"] { background: #f4f4f4; font-weight: 600; }
    .warn { background: #fff6e5; border-left: 4px solid #e0a030; padding: 0.8rem 1rem; }
    code { background: #f0f0f0; padding: 0 0.25rem; }
    ul { columns: 3; }
</style>
</head>
<body>
<h1>D-12 golden fixture review</h1>

<div class="warn">
    <p><strong>The question is not &ldquo;is it anonymised&rdquo;.</strong> It is:
    <em>if you saw only this shape, would you recognise your own training venue?</em></p>
    <p>Route topology survives rotation and translation. Terrain relief survives a
    constant altitude offset. This repository is public static GitHub Pages, and a
    committed fixture is permanent in git history &mdash; a later deletion does not
    remove it.</p>
</div>

<h2>Anonymised route (rotated, translated, rounded, fragment)</h2>
<svg width="760" height="420" viewBox="0 0 760 420" role="img" aria-label="Anonymised route">
    <path d="${routePath}" fill="none" stroke="#2255aa" stroke-width="1.4"/>
</svg>

<h2>Altitude profile (constant offset applied; shape unchanged)</h2>
<svg width="760" height="220" viewBox="0 0 760 220" role="img" aria-label="Altitude profile">
    <path d="${altPath}" fill="none" stroke="#8a4b10" stroke-width="1.4"/>
</svg>

<h2>Summary</h2>
<table>
    <tbody>
            ${tableRows}
    </tbody>
</table>

<h2>Emitted top-level fields (the complete list &mdash; nothing else is written)</h2>
<ul>
            ${fieldList}
</ul>

<h2>Excluded identity fields</h2>
<p>Never emitted, and absent by construction rather than by filtering:
${EXCLUDED_IDENTITY_FIELDS.map(escapeHtml).join(', ')}.</p>

<h2>Recorded transform steps</h2>
<ol>${fixture._anonymisation.steps.map(s => `<li>${escapeHtml(s)}</li>`).join('')}</ol>
</body>
</html>
`
}

function buildSvgPath(
    xs: number[],
    ys: number[],
    width: number,
    height: number,
    preserveAspect: boolean,
): string {
    const pad = 12
    const xExtent = extent(xs)
    const yExtent = extent(ys)
    let xSpan = xExtent.max - xExtent.min || 1
    let ySpan = yExtent.max - yExtent.min || 1

    if (preserveAspect) {
        const span = Math.max(xSpan, ySpan)
        xSpan = span
        ySpan = span
    }

    const parts: string[] = []
    let started = false
    for (let i = 0; i < xs.length; i++) {
        if (!Number.isFinite(xs[i]) || !Number.isFinite(ys[i])) {
            started = false
            continue
        }
        const px = pad + ((xs[i] - xExtent.min) / xSpan) * (width - 2 * pad)
        const py = height - pad - ((ys[i] - yExtent.min) / ySpan) * (height - 2 * pad)
        parts.push(`${started ? 'L' : 'M'}${px.toFixed(2)} ${py.toFixed(2)}`)
        started = true
    }
    return parts.join(' ')
}

function extent(values: number[]): { min: number; max: number } {
    let min = Number.POSITIVE_INFINITY
    let max = Number.NEGATIVE_INFINITY
    for (const v of values) {
        if (!Number.isFinite(v)) {
            continue
        }
        if (v < min) min = v
        if (v > max) max = v
    }
    if (!Number.isFinite(min)) {
        return { min: 0, max: 1 }
    }
    return { min, max }
}

function escapeHtml(value: string): string {
    return value
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
}

function parseArgs(argv: string[]): Options {
    const args = argv[0] === '--' ? argv.slice(1) : argv
    const positional = args.filter(a => !a.startsWith('--'))
    const flag = (name: string): string | null => {
        const hit = args.find(a => a.startsWith(`--${name}=`))
        return hit ? hit.slice(name.length + 3) : null
    }

    if (positional.length === 0) {
        throw new Error(
            'Usage: npx vite-node scripts/build-golden-fixture.ts -- <path-to.fit> ' +
            '[--rotation-deg=n] [--origin-lat=n] [--origin-long=n] [--window=n] ' +
            '[--window-start=n] [--out-dir=path]',
        )
    }

    const windowLength = Number(flag('window') ?? DEFAULT_WINDOW)
    if (!Number.isFinite(windowLength) || windowLength < MIN_WINDOW || windowLength > MAX_WINDOW) {
        throw new Error(`--window must be between ${MIN_WINDOW} and ${MAX_WINDOW} (got ${windowLength}).`)
    }

    const windowStartRaw = flag('window-start')

    return {
        fitPath: resolvePath(positional[0]),
        rotationDeg: Number(flag('rotation-deg') ?? DEFAULT_ROTATION_DEG),
        originLat: Number(flag('origin-lat') ?? DEFAULT_ORIGIN_LAT),
        originLong: Number(flag('origin-long') ?? DEFAULT_ORIGIN_LONG),
        windowLength,
        windowStart: windowStartRaw === null ? null : Number(windowStartRaw),
        outDir: flag('out-dir') ?? join(tmpdir(), 'golden-fixture-candidate'),
    }
}

/**
 * Only run when this file is the entry point. `anonymise` and `buildReviewHtml`
 * are pure and exported so the transform can be exercised without a .fit file
 * (and, in a later plan, asserted on directly).
 */
const isEntryPoint = process.argv[1]?.includes('build-golden-fixture') ?? false

if (isEntryPoint) {
    void main().catch(error => {
        process.stderr.write(`${error instanceof Error ? (error.stack ?? error.message) : String(error)}\n`)
        process.exitCode = 1
    })
}
