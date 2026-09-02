import { readFile } from 'node:fs/promises'
import { performance } from 'node:perf_hooks'

import init from '../pkg/virtual_elevation_analyzer.js'
import { DEFAULT_PARAMETERS, type AnalysisParameters } from '../src/components/AnalysisParameters'
import { getNormalizedActivityArrays } from '../src/analysis/ActivityArrayCache'
import { createVeCalculator } from '../src/analysis/VeCalculatorFactory'
import { resolveWindSeries } from '../src/analysis/WindSourceResolver'
import { buildSegmentSupplementarySeries } from '../src/analysis/SegmentSupplementarySeries'
import { extractSegmentData } from '../src/analysis/SegmentExtractor'
import type { ActivityData } from '../src/state/AppState'
import type { OutAndBackSection } from '../src/utils/GpsLapDetection'
// The dataset lives in one module so this compute pre-screen and the render
// profiler measure the same activity and the two sets of numbers can be added
// together. See `syntheticActivity.ts`.
import {
    createSyntheticActivity,
    createSegmentRanges,
    createOutAndBackSections,
    percentile,
    formatMs,
} from './syntheticActivity'

/**
 * A profiling run always FIXES CdA and Crr — it measures the recompute path,
 * not the optimizer — but `AnalysisParameters` types both as `number | null`
 * because `null` means "optimize this one". `calculate_virtual_elevation`
 * takes numbers, and production only ever reaches it with the resolved values
 * (`renderStandardVe.ts:148`, `updateModeVEPlots.ts:260`). Naming the
 * precondition here keeps the wasm boundary honest instead of widening it.
 */
type FixedParameters = AnalysisParameters & { cda: number; crr: number }

const SAMPLE_COUNT = 7_200
const WARMUP_ITERATIONS = 5
const MEASURED_ITERATIONS = 20
const GPS_LAP_COUNT = 6
const OUT_AND_BACK_SECTION_COUNT = 3

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
    const params: FixedParameters = {
        ...DEFAULT_PARAMETERS,
        cda: 0.23,
        crr: 0.004,
        wind_speed: 3,
        wind_direction: 270,
    }

    const standardTrim = {
        trimStart: 300,
        trimEnd: SAMPLE_COUNT - 300,
    }

    const gpsLapRanges = createSegmentRanges(SAMPLE_COUNT, GPS_LAP_COUNT)
    const outAndBackSections = createOutAndBackSections(SAMPLE_COUNT, OUT_AND_BACK_SECTION_COUNT)

    const scenarios: ScenarioMeasurement[] = [
        await measureScenario('standard-fit', () => {
            runStandardFitRecompute(activity, params, standardTrim.trimStart, standardTrim.trimEnd)
        }),
        await measureScenario('standard-compare', () => {
            runStandardCompareRecompute(activity, params, standardTrim.trimStart, standardTrim.trimEnd)
        }),
        await measureScenario(`gps-lap-${GPS_LAP_COUNT}`, () => {
            runGpsLapRecompute(activity, params, gpsLapRanges)
        }),
        await measureScenario(`out-and-back-${OUT_AND_BACK_SECTION_COUNT}`, () => {
            runOutAndBackRecompute(activity, params, outAndBackSections)
        }),
    ]

    process.stdout.write('\nSlider recompute profiling (synthetic, cached-array path)\n')
    process.stdout.write(`Samples: ${SAMPLE_COUNT} @ 1 Hz, warmup=${WARMUP_ITERATIONS}, measured=${MEASURED_ITERATIONS}\n\n`)
    process.stdout.write('Scenario                median   p95    min    max\n')
    process.stdout.write('--------------------------------------------------\n')
    for (const scenario of scenarios) {
        process.stdout.write(
            `${scenario.name.padEnd(22)} ${formatMs(scenario.medianMs).padStart(7)} ${formatMs(scenario.p95Ms).padStart(6)} ${formatMs(scenario.minMs).padStart(6)} ${formatMs(scenario.maxMs).padStart(6)}\n`,
        )
    }

    const slowestMedian = Math.max(...scenarios.map(scenario => scenario.medianMs))
    const slowestP95 = Math.max(...scenarios.map(scenario => scenario.p95Ms))

    process.stdout.write('\nDecision:\n')
    if (slowestMedian < 50 && slowestP95 < 100) {
        process.stdout.write(
            '- No Web Worker added. The recompute core stays comfortably below a level that justifies worker complexity on this machine, so remaining slider latency is more likely dominated by DOM / Plotly work.\n',
        )
    } else {
        process.stdout.write(
            '- Recompute is heavy enough that a browser-level profile should be taken before deciding whether to offload VE calculation to a worker.\n',
        )
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

function runStandardFitRecompute(
    activity: ActivityData,
    params: FixedParameters,
    trimStart: number,
    trimEnd: number,
): void {
    const normalized = getNormalizedActivityArrays(activity)
    const windResolution = resolveWindSeries({
        fitData: activity,
        windSource: 'fit',
        params,
        airSpeedCalibrationPercent: 0,
    })

    const calculator = createVeCalculator({
        timestamps: normalized.timestamps,
        power: normalized.power,
        velocity: normalized.velocity,
        positionLat: normalized.positionLat,
        positionLong: normalized.positionLong,
        altitude: normalized.altitude,
        distance: normalized.distance,
        windSpeed: windResolution.windSpeed,
        params,
        cda: params.cda,
        crr: params.crr,
    })

    const result = calculator.calculate_virtual_elevation(params.cda, params.crr, trimStart, trimEnd)
    Array.from(result.virtual_elevation)
    ;(result as { free?: () => void }).free?.()
    ;(calculator as { free?: () => void }).free?.()
}

function runStandardCompareRecompute(
    activity: ActivityData,
    params: FixedParameters,
    trimStart: number,
    trimEnd: number,
): void {
    const normalized = getNormalizedActivityArrays(activity)
    const fitWindResolution = resolveWindSeries({
        fitData: activity,
        windSource: 'fit',
        params,
        airSpeedCalibrationPercent: 0,
    })
    const constantWind = new Array(normalized.timestamps.length).fill(Number.NaN)

    const constantCalculator = createVeCalculator({
        timestamps: normalized.timestamps,
        power: normalized.power,
        velocity: normalized.velocity,
        positionLat: normalized.positionLat,
        positionLong: normalized.positionLong,
        altitude: normalized.altitude,
        distance: normalized.distance,
        windSpeed: constantWind,
        params,
        cda: params.cda,
        crr: params.crr,
    })
    const fitCalculator = createVeCalculator({
        timestamps: normalized.timestamps,
        power: normalized.power,
        velocity: normalized.velocity,
        positionLat: normalized.positionLat,
        positionLong: normalized.positionLong,
        altitude: normalized.altitude,
        distance: normalized.distance,
        windSpeed: fitWindResolution.windSpeed,
        params,
        cda: params.cda,
        crr: params.crr,
    })

    const constantResult = constantCalculator.calculate_virtual_elevation(params.cda, params.crr, trimStart, trimEnd)
    const fitResult = fitCalculator.calculate_virtual_elevation(params.cda, params.crr, trimStart, trimEnd)
    Array.from(constantResult.virtual_elevation)
    Array.from(fitResult.virtual_elevation)
    ;(constantResult as { free?: () => void }).free?.()
    ;(fitResult as { free?: () => void }).free?.()
    ;(constantCalculator as { free?: () => void }).free?.()
    ;(fitCalculator as { free?: () => void }).free?.()
}

function runGpsLapRecompute(
    activity: ActivityData,
    params: FixedParameters,
    lapRanges: Array<{ startIdx: number; endIdx: number }>,
): void {
    const normalized = getNormalizedActivityArrays(activity)
    const windResolution = resolveWindSeries({
        fitData: activity,
        windSource: 'fit',
        params,
        airSpeedCalibrationPercent: 0,
    })

    for (const range of lapRanges) {
        const segment = extractSegmentData({
            startIdx: range.startIdx,
            endIdx: range.endIdx,
            allTimestamps: normalized.timestamps,
            allPower: normalized.power,
            allVelocity: normalized.velocity,
            allPositionLat: normalized.positionLat,
            allPositionLong: normalized.positionLong,
            allAltitude: normalized.altitude,
            allDistance: normalized.distance,
            allWindSpeed: windResolution.windSpeed,
        })

        buildSegmentSupplementarySeries({
            timestamps: segment.timestamps,
            power: segment.power,
            velocity: segment.velocity,
            positionLat: segment.positionLat,
            positionLong: segment.positionLong,
            distance: segment.distance,
            windSpeed: segment.windSpeed,
            params,
            selectedWindSource: windResolution.selectedWindSource,
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
        const result = calculator.calculate_virtual_elevation(params.cda, params.crr, 0, segment.timestamps.length - 1)
        Array.from(result.virtual_elevation)
        ;(result as { free?: () => void }).free?.()
        ;(calculator as { free?: () => void }).free?.()
    }
}

function runOutAndBackRecompute(
    activity: ActivityData,
    params: FixedParameters,
    sections: OutAndBackSection[],
): void {
    const normalized = getNormalizedActivityArrays(activity)
    const windResolution = resolveWindSeries({
        fitData: activity,
        windSource: 'fit',
        params,
        airSpeedCalibrationPercent: 0,
    })

    for (const section of sections) {
        const outbound = extractSegmentData({
            startIdx: section.outboundStartIdx,
            endIdx: section.outboundEndIdx,
            allTimestamps: normalized.timestamps,
            allPower: normalized.power,
            allVelocity: normalized.velocity,
            allPositionLat: normalized.positionLat,
            allPositionLong: normalized.positionLong,
            allAltitude: normalized.altitude,
            allDistance: normalized.distance,
            allWindSpeed: windResolution.windSpeed,
        })
        const inbound = extractSegmentData({
            startIdx: section.inboundStartIdx,
            endIdx: section.inboundEndIdx,
            allTimestamps: normalized.timestamps,
            allPower: normalized.power,
            allVelocity: normalized.velocity,
            allPositionLat: normalized.positionLat,
            allPositionLong: normalized.positionLong,
            allAltitude: normalized.altitude,
            allDistance: normalized.distance,
            allWindSpeed: windResolution.windSpeed,
        })

        for (const segment of [outbound, inbound]) {
            buildSegmentSupplementarySeries({
                timestamps: segment.timestamps,
                power: segment.power,
                velocity: segment.velocity,
                positionLat: segment.positionLat,
                positionLong: segment.positionLong,
                distance: segment.distance,
                windSpeed: segment.windSpeed,
                params,
                selectedWindSource: windResolution.selectedWindSource,
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
            const result = calculator.calculate_virtual_elevation(params.cda, params.crr, 0, segment.timestamps.length - 1)
            Array.from(result.virtual_elevation)
            ;(result as { free?: () => void }).free?.()
            ;(calculator as { free?: () => void }).free?.()
        }
    }
}

void main().catch(error => {
    process.stderr.write(`${error instanceof Error ? error.stack ?? error.message : String(error)}\n`)
    process.exitCode = 1
})
