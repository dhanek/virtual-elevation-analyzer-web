/**
 * Build the D-12 candidate golden fixture from a real .fit ride.
 *
 *   npx vite-node scripts/build-golden-fixture.ts -- <path-to.fit> [options]
 *
 * See USAGE at the foot of this file for the flags. Two rules worth stating up
 * front, both learned from defects:
 *
 * 1. **Window placement.** `--window-laps=8-14` is the form to prefer: both
 *    edges land on lap boundaries and the sample count is derived, so no lap is
 *    clipped. `--window-start-lap` aligns only the start, and a fixed `--window`
 *    then ends wherever it lands — which silently cut the final lap in half.
 *    `--window-start` takes a record INDEX, which on a ride with recording gaps
 *    is neither a lap number nor a time in seconds (on this project's test ride
 *    lap 8 starts at index 1531 but at t = 1603 s).
 *
 * 2. **Transform parameters have no flags, on purpose.** The rotation angle,
 *    destination origin and altitude offset are drawn per run from a CSPRNG and
 *    withheld from the fixture, because a transform parameter published beside
 *    the data it transformed inverts in one line. Choosing them would buy
 *    nothing. They go to `golden-ride-anonymisation-key.json`, never committed.
 *
 * NOTHING is written into frontend/src/analysis/__fixtures__/ by this script.
 * All three artifacts land in a scratch directory whose paths are printed.
 * Promotion into the tracked fixture directory happens only after the blocking
 * D-12 maintainer checkpoint (07-01 Task 4). This separation is threat T-07-03:
 * an un-reviewed intermediate must not be able to reach the repo by accident.
 *
 * The seven anonymisation steps are implemented in `anonymise()` below and each
 * one records its concrete parameter into the `_anonymisation` object.
 */

import { randomInt } from 'node:crypto'
import { readFile, mkdir, mkdtemp, chmod, open, rm, stat } from 'node:fs/promises'
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

/**
 * What the PUBLIC fixture records about its own transform.
 *
 * The governing rule, learned the hard way: **a transform parameter that is
 * published alongside the data it transformed provides no privacy at all.**
 * The earlier version of this record published the rotation angle and the
 * altitude offset. Both invert in one line:
 *
 *   true_shape     = R(-rotationDegrees) · (published_coords - destinationOrigin)
 *   true_elevation = published_altitude - altitudeOffsetMetres
 *
 * — which handed back the exact two properties those steps existed to remove
 * (compass orientation, absolute elevation band). Randomising a published
 * constant fixes nothing; it is published either way.
 *
 * So the invertible parameters are no longer in the fixture. They are written
 * to a separate key file next to the review page, which is never committed.
 * This costs public byte-reproducibility, and that cost is near-zero: the
 * source .fit is private and will never be published, so nobody except the
 * maintainer could ever have reproduced this file, and the maintainer has both
 * the ride and the key.
 *
 * What actually protects the venue is the **centroid subtraction** — the
 * original centroid is never emitted anywhere in the fixture, so absolute
 * position is unrecoverable. Rotation and re-origining are defence in depth on
 * top of that, and only while their parameters stay unpublished.
 */
export interface AnonymisationRecord {
    note: string
    steps: string[]
    relativeTimestamps: { subtractedFirstTimestamp: true }
    coordinateTransform: {
        /** THE control. The original centroid is never emitted. */
        centroidSubtracted: true
        rotationApplied: true
        /**
         * Withheld on purpose: publishing it re-exposes the ride's true compass
         * orientation, which is precisely what the rotation removes.
         */
        rotationDegreesPublished: false
        /**
         * Safe to publish: an arbitrary constant chosen at random, not derived
         * from the ride. It locates nothing — it exists so a reader can see at
         * a glance that these coordinates are not real.
         */
        destinationOriginLat: number
        destinationOriginLong: number
    }
    sampleWindow: {
        startIdx: number
        endIdx: number
        length: number
        sourceRecordCount: number
        /**
         * How the window was arrived at. Without this an auto-chosen cut and a
         * deliberate re-cut are indistinguishable in the artifact, and the
         * scorer's choice can move if the input ride ever changes.
         *
         * 'explicit-lap-range' is the strongest claim: BOTH edges sit on lap
         * boundaries, so every emitted range is a whole lap with no clipped
         * tail. 'explicit-lap' aligns only the start — a fixed window length
         * then ends wherever it lands, which is what produced a clipped final
         * lap before this distinction existed.
         */
        selection: 'explicit-lap-range' | 'explicit-lap' | 'explicit-index' | 'auto'
        /** Present only for 'explicit-lap-range'. 1-based, inclusive. */
        sourceLaps?: { first: number; last: number }
    }
    rounding: { coordinatesDecimals: number; altitudeDecimals: number; velocityDecimals: number; powerDecimals: number; otherDecimals: number }
    /** @see rotationDegreesPublished — same reasoning, same decision. */
    altitudeOffsetPublished: false
    droppedArrays: string[]
    /** Where the maintainer-only inversion key was written, and its status. */
    reproducibility: string
}

/**
 * The maintainer-only inversion key. Written next to the review page, NEVER
 * committed — it contains the source centroid, which is the one value that
 * would undo the anonymisation completely.
 */
export interface AnonymisationKey {
    WARNING: string
    reproduceWith: string
    rotationDegrees: number
    destinationOriginLat: number
    destinationOriginLong: number
    altitudeOffsetMetres: number
    sourceCentroidLat: number
    sourceCentroidLong: number
    sourceFirstTimestamp: number
    sourceDistanceBase: number
    sampleWindow: { startIdx: number; endIdx: number }
}

const DEFAULT_WINDOW = 1600
const MIN_WINDOW = 1200
const MAX_WINDOW = 2000

/**
 * Cryptographically-random transform parameters, drawn fresh per run.
 *
 * The previous defaults (137°, 45, −30) were, correctly, called out as "very
 * normal numbers" — defaults dressed as anonymisation. Randomising them is
 * necessary but NOT sufficient on its own: a random angle that gets printed in
 * the fixture is exactly as invertible as a fixed one. Randomisation only earns
 * its keep because these values are now withheld from the published artifact.
 *
 * `randomInt` is CSPRNG-backed (node:crypto), not `Math.random`.
 */
function randomRotationDegrees(): number {
    // Full circle, hundredth-degree resolution — no reason to prefer round numbers.
    return randomInt(0, 36_000) / 100
}

function randomDestinationOrigin(): { lat: number; long: number } {
    // Mid-latitude band so the bearing maths stays in a normal regime (no polar
    // cos(lat) degeneracy), longitude unrestricted. Hundred-thousandth degree.
    return {
        lat: randomInt(-5_500_000, 5_500_000) / 100_000,
        long: randomInt(-18_000_000, 18_000_000) / 100_000,
    }
}

function randomAltitudeOffsetMetres(): number {
    // Large, random, and unpublished, so the absolute elevation band carries no
    // location signal. Decimetre resolution matches ALTITUDE_DECIMALS.
    return randomInt(-20_000, 20_000) / 10
}

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
    windowLength: number
    windowStart: number | null
    /**
     * 1-based SOURCE lap number to start the window at. Exists because
     * `--window-start` takes a record index while humans reason about rides in
     * laps and seconds, and on a ride with recording gaps those three numbers
     * all differ. On this project's own test ride source lap 8 starts at record
     * index 1531 but at t = 1603 s, and passing 1603 as an index silently cut
     * 72 records into lap 8 instead of at its boundary.
     */
    windowStartLap: number | null
    /**
     * Inclusive 1-based SOURCE lap range. Unlike `windowStartLap`, this aligns
     * BOTH edges: the sample count is derived from the laps rather than imposed,
     * so no lap is clipped. `windowStartLap` alone only aligned the start — the
     * fixed `--window` length then ended wherever it landed, silently cutting
     * the final lap in half.
     */
    windowLaps: { first: number; last: number } | null
    /**
     * NULL means "make me a fresh private directory" (WR-03), which is the
     * default. It is not a path here because the default has to be created with
     * `mkdtemp` — see `resolveOutDir`, and note that `parseArgs` is synchronous.
     */
    outDir: string | null
}

/**
 * Where the run writes, and why the default is not a fixed path.
 *
 * The old default was `join(tmpdir(), 'golden-fixture-candidate')` — FIXED and
 * GUESSABLE, under the SHARED system temp directory — created with
 * `mkdir(dir, { recursive: true, mode: 0o700 })`. `mode` applies only to
 * directories the call CREATES, and with `recursive: true` an existing
 * `/tmp/golden-fixture-candidate` is a silent success whose mode is left
 * untouched. Any local account could pre-create that path `0777` and read
 * `golden-ride-anonymisation-key.json`, which carries `sourceCentroidLat` /
 * `sourceCentroidLong` — the maintainer's home or training venue, and enough to
 * undo the anonymisation of `golden-ride.json` completely.
 *
 * `mkdtemp` is the fix for the default: it creates a directory with a random
 * suffix at mode 0700, and it fails rather than reusing anything. Nobody can
 * pre-create a path they cannot predict.
 *
 * An EXPLICIT `--out-dir` is the user's own choice and may legitimately already
 * exist, so it is only rejected when it is group- or world-writable — the
 * property that makes pre-planting possible in the first place.
 *
 * Exported for the same reason `anonymise` and `buildReviewHtml` are: so the
 * behaviour can be exercised without a .fit file.
 */
export async function resolveOutDir(requested: string | null): Promise<string> {
    if (requested === null) {
        return mkdtemp(join(tmpdir(), 'golden-fixture-'))
    }

    const existing = await stat(requested).catch(() => null)
    if (existing) {
        if (!existing.isDirectory()) {
            throw new Error(`--out-dir=${requested} exists and is not a directory.`)
        }
        // 0o022 = group-write | other-write.
        if ((existing.mode & 0o022) !== 0) {
            throw new Error(
                `--out-dir=${requested} is group- or world-writable (mode ` +
                `${(existing.mode & 0o777).toString(8)}). The anonymisation key written ` +
                'there would be exposed to every account that can write the directory. ' +
                'Tighten it with `chmod 700`, or omit --out-dir to get a fresh private one.',
            )
        }
        return requested
    }

    await mkdir(requested, { recursive: true, mode: 0o700 })
    return requested
}

/**
 * Create-exclusive write: refuses to write THROUGH an existing entry, and in
 * particular through a SYMLINK (WR-03).
 *
 * `writeFile` follows symlinks. A pre-planted
 * `golden-ride-anonymisation-key.json -> /home/attacker/loot` meant the centroid
 * was written straight into an attacker-owned file, and the `chmod` that
 * followed followed the link too — so it succeeded and left no trace. `'wx'` is
 * `O_CREAT | O_EXCL`, which fails with EEXIST on a symlink rather than
 * traversing it, so the file mode below is load-bearing again: this process is
 * always the one that created the file.
 *
 * The `rm` keeps re-runs into the same `--out-dir` working. It unlinks the ENTRY
 * (a symlink is removed, never its target), so the `open` that follows still
 * creates the file itself. An entry re-planted in the gap between the two loses
 * the race loudly, with EEXIST, instead of silently.
 */
export async function writeExclusive(
    path: string,
    contents: string,
    mode: number,
): Promise<void> {
    await rm(path, { force: true })
    const handle = await open(path, 'wx', mode)
    try {
        await handle.writeFile(contents, 'utf8')
    } finally {
        await handle.close()
    }
    // `mode` on `open` is masked by the process umask, so an unusual umask could
    // still widen or narrow it. State the intent unconditionally.
    await chmod(path, mode)
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

    const { fixture, key } = anonymise(source, rawLaps, options)

    // 0700 / 0600, because the default out-dir is under the SHARED system temp
    // directory and the key file below "undoes the anonymisation of
    // golden-ride.json completely" (its own WARNING string). At the default
    // umask that secret was world-readable to every local account, and it is
    // left on disk indefinitely — the script only prints a reminder.
    //
    // The directory is now UNPREDICTABLE by default and every write is
    // CREATE-EXCLUSIVE, because neither half of that mitigation actually held on
    // its own: `mkdir`'s `mode` does not tighten a directory that already exists,
    // and `writeFile` follows symlinks. See `resolveOutDir` and `writeExclusive`.
    const outDir = await resolveOutDir(options.outDir)
    const jsonPath = join(outDir, 'golden-ride.json')
    const htmlPath = join(outDir, 'golden-ride-review.html')
    const keyPath = join(outDir, 'golden-ride-anonymisation-key.json')

    await writeExclusive(jsonPath, `${JSON.stringify(fixture, null, 2)}\n`, 0o600)
    await writeExclusive(htmlPath, buildReviewHtml(fixture), 0o600)
    await writeExclusive(keyPath, `${JSON.stringify(key, null, 2)}\n`, 0o600)

    process.stdout.write('\nD-12 candidate fixture written to a SCRATCH path (not the repo):\n')
    process.stdout.write(`  candidate JSON : ${jsonPath}\n`)
    process.stdout.write(`  review page    : ${htmlPath}\n`)
    process.stdout.write(`  inversion key  : ${keyPath}   <-- NEVER COMMIT\n\n`)
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
 * The seven anonymisation steps, in order.
 *
 * Returns BOTH the public fixture and the maintainer-only inversion key. The
 * split is the point: every parameter that would undo a step lives in the key,
 * never in the fixture. See `AnonymisationRecord` for why.
 */
export function anonymise(
    source: SourceArrays,
    rawLaps: Array<{ start_time: number; end_time: number }>,
    options: Options,
): { fixture: GoldenRideFixture; key: AnonymisationKey } {
    const sourceCount = source.timestamps.length
    if (sourceCount === 0) {
        throw new Error('The parsed ride has no records.')
    }

    // Drawn fresh, from a CSPRNG, per run — and then withheld from the fixture.
    const rotationDeg = randomRotationDegrees()
    const origin = randomDestinationOrigin()

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

    // Step 2: translate AND rotate.
    //
    // The centroid subtraction is THE control — `centroidLat`/`centroidLong` are
    // computed here, used here, and never emitted into the fixture, so absolute
    // position is destroyed rather than merely displaced. The rotation is
    // defence in depth against compass orientation, and it only works because
    // `rotationDeg` also stays out of the fixture: a published angle inverts in
    // one line and hands the orientation straight back.
    const centroidLat = mean(positionLatRaw)
    const centroidLong = mean(positionLongRaw)
    const theta = (rotationDeg * Math.PI) / 180
    const cosT = Math.cos(theta)
    const sinT = Math.sin(theta)

    const position_lat: number[] = []
    const position_long: number[] = []
    for (let i = 0; i < count; i++) {
        const dLat = positionLatRaw[i] - centroidLat
        const dLong = positionLongRaw[i] - centroidLong
        // Step 4 (coordinates): round to 5 dp ≈ 1 m, killing LSB fingerprints.
        position_lat.push(round(origin.lat + dLat * cosT - dLong * sinT, COORD_DECIMALS))
        position_long.push(round(origin.long + dLat * sinT + dLong * cosT, COORD_DECIMALS))
    }

    // Step 5: constant altitude offset, random and unpublished.
    //
    // Previously this was `100 - mean(altitude)` and the offset was printed in
    // the header, so `published - offset` recovered the true elevation band
    // exactly — the same self-defeating mistake as publishing the rotation. A
    // ~40 m ASL band is a real geographic filter. The profile *shape* is never
    // distorted non-linearly; that is the real-world character D-12 wants.
    const altitudeOffset = randomAltitudeOffsetMetres() - round(mean(altitudeRaw), ALTITUDE_DECIMALS)
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

    const reproduceWith = options.windowLaps !== null
        ? `--window-laps=${options.windowLaps.first}-${options.windowLaps.last}`
        : `--window=${count} --window-start=${window.startIdx}`

    // Step 7: record steps 1-6 — WITHOUT the values that would undo them.
    const _anonymisation: AnonymisationRecord = {
        note:
            'Derived from one real ride, then deliberately transformed. The transform is ' +
            'deliberate, not a bug. Note what is NOT here: the source centroid, the rotation ' +
            'angle and the altitude offset are all withheld, because a transform parameter ' +
            'published next to the data it transformed provides no privacy — it inverts in ' +
            'one line. Residual risk is stated in ' +
            '.planning/phases/07-mode-pipeline-unification/07-GOLDEN-BASELINE.md: route ' +
            'topology and terrain relief survive every transform here, which is why a ' +
            'blocking maintainer checkpoint (D-12) gates this file, not an automated rule.',
        steps: [
            '1. timestamps made relative (t - t[0]); ride date and time of day removed',
            '2. coordinates centroid-subtracted (THE control: the centroid is never emitted), ' +
                'then rotated by a random unpublished angle and re-origined',
            '3. trimmed to a sub-window fragment retaining lap boundaries and dropouts',
            '4. coordinates rounded to 5 dp; other series rounded to sensor precision',
            '5. altitude offset by a random unpublished constant (profile shape preserved exactly)',
            '6. humidity and pressure dropped; folded into rhoArray instead',
            '7. this record written so the transform reads as deliberate',
        ],
        relativeTimestamps: { subtractedFirstTimestamp: true },
        coordinateTransform: {
            centroidSubtracted: true,
            rotationApplied: true,
            rotationDegreesPublished: false,
            destinationOriginLat: origin.lat,
            destinationOriginLong: origin.long,
        },
        sampleWindow: {
            startIdx: window.startIdx,
            endIdx: window.endIdx,
            length: count,
            sourceRecordCount: sourceCount,
            selection:
                options.windowLaps !== null
                    ? 'explicit-lap-range'
                    : options.windowStartLap !== null
                        ? 'explicit-lap'
                        : options.windowStart !== null
                            ? 'explicit-index'
                            : 'auto',
            ...(options.windowLaps !== null
                ? { sourceLaps: { first: options.windowLaps.first, last: options.windowLaps.last } }
                : {}),
        },
        rounding: {
            coordinatesDecimals: COORD_DECIMALS,
            altitudeDecimals: ALTITUDE_DECIMALS,
            velocityDecimals: VELOCITY_DECIMALS,
            powerDecimals: POWER_DECIMALS,
            otherDecimals: OTHER_DECIMALS,
        },
        altitudeOffsetPublished: false,
        droppedArrays: ['humidity', 'pressure', 'wind_speed', 'air_density_data', 'road_speed'],
        reproducibility:
            `Not byte-reproducible from this file alone, by design: the rotation angle and ` +
            `altitude offset are random per run and withheld. They are written to ` +
            `golden-ride-anonymisation-key.json beside the review page, which is never ` +
            `committed. The window is reproducible: \`${reproduceWith}\`. This costs nothing ` +
            `in practice — the source ride is private, so only the maintainer could ever ` +
            `regenerate this file, and the maintainer holds the key.`,
    }

    const key: AnonymisationKey = {
        WARNING:
            'NEVER COMMIT THIS FILE. It contains the source centroid, which undoes the ' +
            'anonymisation of golden-ride.json completely. Keep it only if you want to be ' +
            'able to regenerate the fixture; otherwise delete it with the review page.',
        reproduceWith,
        rotationDegrees: rotationDeg,
        destinationOriginLat: origin.lat,
        destinationOriginLong: origin.long,
        altitudeOffsetMetres: altitudeOffset,
        sourceCentroidLat: centroidLat,
        sourceCentroidLong: centroidLong,
        sourceFirstTimestamp: t0,
        sourceDistanceBase: distanceBase,
        sampleWindow: { startIdx: window.startIdx, endIdx: window.endIdx },
    }

    return {
        fixture: {
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
        },
        key,
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

    // Lap RANGE: both edges on lap boundaries, length derived not imposed.
    if (options.windowLaps !== null) {
        const { first, last } = options.windowLaps
        const firstLap = rawLaps[first - 1]
        const lastLap = rawLaps[last - 1]
        if (!firstLap || !lastLap) {
            throw new Error(
                `--window-laps=${first}-${last} is out of range: the ride has ${rawLaps.length} ` +
                'laps (1-based, inclusive).',
            )
        }
        const startIdx = nearestIndex(source.timestamps, firstLap.start_time)
        const endIdx = nearestIndex(source.timestamps, lastLap.end_time)
        if (endIdx <= startIdx) {
            throw new Error(
                `--window-laps=${first}-${last} resolves to an empty window ` +
                `(records ${startIdx}…${endIdx}).`,
            )
        }
        const derivedLength = endIdx - startIdx + 1
        if (derivedLength < MIN_WINDOW || derivedLength > MAX_WINDOW) {
            // Advisory, not fatal: the lap range is the maintainer's explicit
            // instruction and must not be silently overridden by a size rule.
            process.stderr.write(
                `NOTE: laps ${first}-${last} derive a ${derivedLength}-sample window, outside the ` +
                `${MIN_WINDOW}-${MAX_WINDOW} guidance. Honouring the lap range as given.\n`,
            )
        }
        return { startIdx, endIdx }
    }

    // Lap-relative selection resolves to an index here, so the emitted header
    // and `reproduceWith` always carry the concrete index regardless of how the
    // caller expressed the request.
    if (options.windowStartLap !== null) {
        const lap = rawLaps[options.windowStartLap - 1]
        if (!lap) {
            throw new Error(
                `--window-start-lap=${options.windowStartLap} is out of range: the ride has ` +
                `${rawLaps.length} laps (1-based).`,
            )
        }
        const lapStartIdx = nearestIndex(source.timestamps, lap.start_time)
        const startIdx = Math.max(0, Math.min(lapStartIdx, sourceCount - length))
        if (startIdx !== lapStartIdx) {
            process.stderr.write(
                `WARNING: lap ${options.windowStartLap} starts at record ${lapStartIdx}, but a ` +
                `${length}-sample window from there would overrun the ride; clamped to ${startIdx}. ` +
                'The window is no longer lap-aligned.\n',
            )
        }
        return { startIdx, endIdx: startIdx + length - 1 }
    }

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
        ['Rotation', 'applied, random, angle withheld from the fixture'],
        ['Altitude offset', 'applied, random, value withheld from the fixture'],
        ['Source window', `${fixture._anonymisation.sampleWindow.startIdx}…${fixture._anonymisation.sampleWindow.endIdx} of ${fixture._anonymisation.sampleWindow.sourceRecordCount} (${fixture._anonymisation.sampleWindow.selection})`],
        [
            'Source laps',
            fixture._anonymisation.sampleWindow.sourceLaps
                ? `${fixture._anonymisation.sampleWindow.sourceLaps.first}-${fixture._anonymisation.sampleWindow.sourceLaps.last} inclusive, both edges on lap boundaries`
                : 'not lap-range selected',
        ],
        ['Reproducibility', fixture._anonymisation.reproducibility],
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

<h2>What is actually protecting the venue</h2>
<p>The <strong>centroid subtraction</strong>, and only that. The original centroid is
never written into the fixture, so absolute position is unrecoverable.</p>
<p>The rotation and the altitude offset are defence in depth, and they only count
because their parameters are <em>withheld</em>: a transform parameter printed next to
the data it transformed inverts in one line and gives back exactly what it removed.
Both are drawn per run from a CSPRNG and written to
<code>golden-ride-anonymisation-key.json</code>, which is never committed.</p>
<p><strong>The honest limit:</strong> withholding the rotation angle stops orientation
being volunteered to a reader; it does not stop someone who already suspects a venue
from fitting the single unknown angle by shape-matching. Route shape survives every
transform. That residual is the whole reason this page exists and the reason this
decision is yours.</p>
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

/**
 * An integer flag, REJECTED rather than coerced when it is not one.
 *
 * `Number('abc')` is NaN, and NaN propagates silently through the window
 * placement: `chooseWindow` computes `Math.max(0, Math.min(NaN, ...))` = NaN and
 * `slice(NaN, NaN + 1)` returns the WHOLE array, so `--window-start=abc`
 * skipped the fragmenting step of the anonymisation and emitted the full ride
 * with no warning. `--window` was validated against MIN_WINDOW/MAX_WINDOW;
 * these two were not.
 */
function parseIndexFlag(raw: string | null, name: string, min: number): number | null {
    if (raw === null) return null
    const value = Number(raw)
    if (!Number.isInteger(value) || value < min) {
        throw new Error(`--${name} must be an integer >= ${min} (got "${raw}").`)
    }
    return value
}

function parseArgs(argv: string[]): Options {
    const args = argv[0] === '--' ? argv.slice(1) : argv
    const positional = args.filter(a => !a.startsWith('--'))
    const flag = (name: string): string | null => {
        const hit = args.find(a => a.startsWith(`--${name}=`))
        return hit ? hit.slice(name.length + 3) : null
    }

    if (positional.length === 0) {
        throw new Error(USAGE)
    }

    const windowRaw = flag('window')
    const windowStartRaw = flag('window-start')
    const windowStartLapRaw = flag('window-start-lap')
    const windowLapsRaw = flag('window-laps')

    const starts = [
        windowStartRaw !== null && '--window-start',
        windowStartLapRaw !== null && '--window-start-lap',
        windowLapsRaw !== null && '--window-laps',
    ].filter(Boolean) as string[]

    if (starts.length > 1) {
        throw new Error(
            `${starts.join(', ')} are mutually exclusive — they are three different ways to ` +
            'say where the window goes (a record index, a lap number, a lap range), and on a ' +
            'ride with recording gaps they are not interchangeable. Pass exactly one.',
        )
    }

    // A lap RANGE derives its own length. Accepting --window alongside it would
    // silently re-clip the very tail the lap range exists to keep whole, which
    // is the defect this flag was added to fix — so refuse rather than pick.
    if (windowLapsRaw !== null && windowRaw !== null) {
        throw new Error(
            '--window-laps and --window are mutually exclusive: a lap range derives its sample ' +
            'count from the lap boundaries, so imposing a fixed length would clip the final ' +
            'lap. Drop --window.',
        )
    }

    let windowLaps: { first: number; last: number } | null = null
    if (windowLapsRaw !== null) {
        const match = /^(\d+)-(\d+)$/.exec(windowLapsRaw.trim())
        if (!match) {
            throw new Error(`--window-laps must look like "8-14" (got "${windowLapsRaw}").`)
        }
        const first = Number(match[1])
        const last = Number(match[2])
        if (first < 1 || last < first) {
            throw new Error(`--window-laps=${windowLapsRaw} is not a valid 1-based inclusive range.`)
        }
        windowLaps = { first, last }
    }

    const windowLength = Number(windowRaw ?? DEFAULT_WINDOW)
    if (windowLaps === null && (!Number.isFinite(windowLength) || windowLength < MIN_WINDOW || windowLength > MAX_WINDOW)) {
        throw new Error(`--window must be between ${MIN_WINDOW} and ${MAX_WINDOW} (got ${windowLength}).`)
    }

    return {
        fitPath: resolvePath(positional[0]),
        windowLength,
        // `windowLengthExplicit` used to be computed here and read nowhere. The
        // mutual-exclusion check it was presumably for is implemented directly
        // against `windowLapsRaw`/`windowRaw` above.
        windowStart: parseIndexFlag(windowStartRaw, 'window-start', 0),
        windowStartLap: parseIndexFlag(windowStartLapRaw, 'window-start-lap', 1),
        windowLaps,
        // NULL, not a fixed path under `tmpdir()` (WR-03). `resolveOutDir` turns
        // this into a fresh `mkdtemp` directory nobody can have pre-created.
        outDir: flag('out-dir') ?? null,
    }
}

const USAGE =
    'Usage: npx vite-node scripts/build-golden-fixture.ts -- <path-to.fit>\n' +
    '\n' +
    'Window placement (pass at most one):\n' +
    '  --window-laps=<a>-<b>   RECOMMENDED. Inclusive 1-based SOURCE lap range. Both edges\n' +
    '                          land on lap boundaries and the sample count is derived, so\n' +
    '                          no lap is clipped. Cannot be combined with --window.\n' +
    '  --window-start-lap=<n>  start at 1-based SOURCE lap n; a fixed --window length then\n' +
    '                          ends wherever it lands, which CLIPS the final lap.\n' +
    '  --window-start=<n>      start at record INDEX n (not seconds, not a lap number).\n' +
    '  (omit all three)        auto-score a window for lap-boundary + dropout coverage.\n' +
    '\n' +
    '  --window=<n>            window length, 1200-2000 (default 1600). Not with --window-laps.\n' +
    '  --out-dir=<path>        scratch output dir. Omit it and a fresh private (0700)\n' +
    '                          directory is created under the system temp dir; a path\n' +
    '                          given here is REJECTED if it is group- or world-writable,\n' +
    '                          because the anonymisation key is written into it.\n' +
    '\n' +
    'The coordinate rotation, destination origin and altitude offset are drawn per run\n' +
    'from a CSPRNG and deliberately have no flags: they are withheld from the fixture, so\n' +
    'choosing them buys nothing. They are written to golden-ride-anonymisation-key.json.'

/**
 * Self-execute only when invoked with a ride path. `anonymise` and
 * `buildReviewHtml` are pure and exported so the transform can be exercised
 * without a .fit file, which is why this guard exists at all.
 *
 * The discriminator is the presence of a positional argument, NOT the contents
 * of `process.argv[1]`. Under the documented invocation
 * (`npx vite-node scripts/build-golden-fixture.ts -- <ride.fit>`) vite-node
 * puts its OWN binary in `argv[1]` and hands the script only the user args:
 *
 *     argv = [ node, .../node_modules/.bin/vite-node, <ride.fit> ]
 *
 * so a guard that looked for this file's name in `argv[1]` never fired and the
 * script exited 0 having silently done nothing.
 */
const positionalArgs = process.argv.slice(2).filter(arg => arg !== '--' && !arg.startsWith('--'))

if (positionalArgs.length > 0) {
    void main().catch(error => {
        process.stderr.write(`${error instanceof Error ? (error.stack ?? error.message) : String(error)}\n`)
        process.exitCode = 1
    })
} else if (process.argv[1]?.includes('vite-node') || process.argv[1]?.includes('build-golden-fixture')) {
    // Launched directly but given nothing to do. Never exit 0 in silence — that
    // is precisely the failure the guard above is written against.
    process.stderr.write(`build-golden-fixture: no ride path given.\n${USAGE}\n`)
    process.exitCode = 1
}
