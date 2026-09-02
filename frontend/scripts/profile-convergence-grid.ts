import { readFile } from 'node:fs/promises'
import { performance } from 'node:perf_hooks'

import init from '../pkg/virtual_elevation_analyzer.js'
import { DEFAULT_PARAMETERS, type AnalysisParameters } from '../src/components/AnalysisParameters'
import { getNormalizedActivityArrays } from '../src/analysis/ActivityArrayCache'
import { createVeCalculator } from '../src/analysis/VeCalculatorFactory'
import { resolveWindSeries } from '../src/analysis/WindSourceResolver'
import { extractSegmentData } from '../src/analysis/SegmentExtractor'
import type { VirtualElevationCalculator } from '../pkg/virtual_elevation_analyzer.js'
// Same dataset as the slider-recompute pre-screen so the grid numbers can be
// compared against (and added to) those. See `syntheticActivity.ts`.
import {
    createSyntheticActivity,
    createSegmentRanges,
    percentile,
    formatMs,
} from './syntheticActivity'

/**
 * Sizes the Convergence tab's closure-error grid: `ve_gain_grid` across
 * resolutions and segment counts, plus the per-call cost of `ve_gain` that the
 * auto-converge bisection pays (~40 calls per segment per solve).
 *
 * The grid is computed once per surface-cache miss (tab opened, or physics
 * inputs changed while it is open), never per slider frame — so the budget is
 * "one-off hitch the user notices", not "drag latency". ~300 ms is the line
 * the plan drew for the worst realistic case (6 segments).
 */

const SAMPLE_COUNT = 7_200
const WARMUP_ITERATIONS = 2
const MEASURED_ITERATIONS = 10
const GPS_LAP_COUNT = 6
const RESOLUTIONS = [41, 100]
const BISECTION_CALLS = 40

// Grid bounds mirror the AnalysisParameters defaults the tab will use.
const CDA_MIN = 0.15
const CDA_MAX = 0.5
const CRR_MIN = 0.0015
const CRR_MAX = 0.03

interface ScenarioMeasurement {
    name: string
    medianMs: number
    p95Ms: number
    minMs: number
    maxMs: number
}

async function main(): Promise<void> {
    const wasm = await readFile(new URL('../pkg/virtual_elevation_analyzer_bg.wasm', import.meta.url))
    await init({ module_or_path: wasm })

    const activity = createSyntheticActivity(SAMPLE_COUNT)
    const params: AnalysisParameters = {
        ...DEFAULT_PARAMETERS,
        cda: 0.23,
        crr: 0.004,
        wind_speed: 3,
        wind_direction: 270,
    }

    const normalized = getNormalizedActivityArrays(activity)
    const windResolution = resolveWindSeries({
        fitData: activity,
        windSource: 'fit',
        params,
        airSpeedCalibrationPercent: 0,
    })

    const buildCalculator = (startIdx: number, endIdx: number): { calculator: VirtualElevationCalculator; sampleCount: number } => {
        const segment = extractSegmentData({
            startIdx,
            endIdx,
            allTimestamps: normalized.timestamps,
            allPower: normalized.power,
            allVelocity: normalized.velocity,
            allPositionLat: normalized.positionLat,
            allPositionLong: normalized.positionLong,
            allAltitude: normalized.altitude,
            allDistance: normalized.distance,
            allWindSpeed: windResolution.windSpeed,
        })
        const calculator = createVeCalculator({
            timestamps: segment.timestamps,
            power: segment.power,
            velocity: segment.velocity,
            positionLat: segment.positionLat,
            positionLong: segment.positionLong,
            altitude: segment.altitude,
            distance: segment.distance,
            windSpeed: segment.windSpeed,
            params,
            cda: params.cda,
            crr: params.crr,
        })
        return { calculator, sampleCount: segment.timestamps.length }
    }

    // Calculators are built once per analysis pass by the app; the grid only
    // ever runs against existing ones, so construction stays outside the timer.
    const standard = [buildCalculator(300, SAMPLE_COUNT - 300)]
    const gpsLaps = createSegmentRanges(SAMPLE_COUNT, GPS_LAP_COUNT).map(range =>
        buildCalculator(range.startIdx, range.endIdx),
    )

    const scenarios: ScenarioMeasurement[] = []
    for (const steps of RESOLUTIONS) {
        scenarios.push(await measureScenario(`standard-1seg ${steps}x${steps}`, () => {
            runGrid(standard, steps)
        }))
        scenarios.push(await measureScenario(`gps-lap-${GPS_LAP_COUNT}seg ${steps}x${steps}`, () => {
            runGrid(gpsLaps, steps)
        }))
    }
    scenarios.push(await measureScenario(`bisection ${BISECTION_CALLS}x ve_gain, ${GPS_LAP_COUNT}seg`, () => {
        runBisectionCost(gpsLaps)
    }))

    const standardSamples = standard[0].sampleCount
    const lapSamples = gpsLaps.map(entry => entry.sampleCount)
    process.stdout.write('\nConvergence grid profiling (synthetic, per-segment ve_gain_grid)\n')
    process.stdout.write(`Samples: ${SAMPLE_COUNT} @ 1 Hz; standard window ${standardSamples}; `)
    process.stdout.write(`${GPS_LAP_COUNT} laps of ~${Math.round(lapSamples.reduce((a, b) => a + b, 0) / lapSamples.length)}\n`)
    process.stdout.write(`warmup=${WARMUP_ITERATIONS}, measured=${MEASURED_ITERATIONS}\n\n`)
    process.stdout.write('Scenario                        median   p95    min    max\n')
    process.stdout.write('----------------------------------------------------------\n')
    for (const scenario of scenarios) {
        process.stdout.write(
            `${scenario.name.padEnd(30)} ${formatMs(scenario.medianMs).padStart(7)} ${formatMs(scenario.p95Ms).padStart(6)} ${formatMs(scenario.minMs).padStart(6)} ${formatMs(scenario.maxMs).padStart(6)}\n`,
        )
    }

    process.stdout.write('\nDecision guide:\n')
    process.stdout.write('- The default resolution is the largest whose worst realistic scenario stays under ~300 ms.\n')
    process.stdout.write('- If nothing does, the next lever is the algebraic sin(atan(x)) = x/sqrt(1+x^2) in GainKernel::gain,\n')
    process.stdout.write('  behind a Rust test proving agreement with ve_elevation_diff — not a worker (deferred per PROJECT_STATUS.md).\n')
}

function runGrid(segments: Array<{ calculator: VirtualElevationCalculator; sampleCount: number }>, steps: number): void {
    for (const { calculator, sampleCount } of segments) {
        const grid = calculator.ve_gain_grid(
            CDA_MIN, CDA_MAX, steps,
            CRR_MIN, CRR_MAX, steps,
            0, sampleCount - 1,
        )
        if (grid.length !== steps * steps) {
            throw new Error(`grid came back ${grid.length} cells, expected ${steps * steps}`)
        }
    }
}

function runBisectionCost(segments: Array<{ calculator: VirtualElevationCalculator; sampleCount: number }>): void {
    for (const { calculator, sampleCount } of segments) {
        for (let i = 0; i < BISECTION_CALLS; i++) {
            calculator.ve_gain(0.2 + i * 0.005, 0.004, 0, sampleCount - 1)
        }
    }
}

async function measureScenario(name: string, run: () => void): Promise<ScenarioMeasurement> {
    for (let i = 0; i < WARMUP_ITERATIONS; i++) {
        run()
    }

    const timings: number[] = []
    for (let i = 0; i < MEASURED_ITERATIONS; i++) {
        const start = performance.now()
        run()
        timings.push(performance.now() - start)
    }

    const sorted = [...timings].sort((a, b) => a - b)
    return {
        name,
        medianMs: percentile(sorted, 0.5),
        p95Ms: percentile(sorted, 0.95),
        minMs: sorted[0],
        maxMs: sorted[sorted.length - 1],
    }
}

void main().catch(error => {
    process.stderr.write(`${error instanceof Error ? error.stack ?? error.message : String(error)}\n`)
    process.exitCode = 1
})
