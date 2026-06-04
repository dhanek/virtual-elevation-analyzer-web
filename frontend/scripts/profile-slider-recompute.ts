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
    const params: AnalysisParameters = {
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
    params: AnalysisParameters,
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
    params: AnalysisParameters,
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
    params: AnalysisParameters,
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
    params: AnalysisParameters,
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

function createSyntheticActivity(points: number): ActivityData {
    const timestamps = new Array<number>(points)
    const power = new Array<number>(points)
    const velocity = new Array<number>(points)
    const position_lat = new Array<number>(points)
    const position_long = new Array<number>(points)
    const altitude = new Array<number>(points)
    const distance = new Array<number>(points)
    const air_speed = new Array<number>(points)
    const wind_speed = new Array<number>(points)
    const wind_yaw = new Array<number>(points)
    const air_density_data = new Array<number>(points)
    const road_speed = new Array<number>(points)
    const temperature = new Array<number>(points)
    const battery_soc = new Array<number>(points).fill(100)
    const heart_rate = new Array<number>(points)
    const cadence = new Array<number>(points)

    const baseLat = 47.3769
    const baseLon = 8.5417
    const radius = 0.01
    let cumulativeDistance = 0

    for (let i = 0; i < points; i++) {
        const t = i
        const phase = i / 240
        const theta = i / 180
        const speed = 10.5 + Math.sin(phase) * 2.1 + Math.cos(i / 55) * 0.4
        const nextStepDistance = i === 0 ? 0 : speed

        timestamps[i] = t
        power[i] = 235 + Math.sin(i / 45) * 32 + Math.cos(i / 90) * 18
        velocity[i] = speed
        cumulativeDistance += nextStepDistance
        distance[i] = cumulativeDistance
        altitude[i] = 120 + cumulativeDistance * 0.002 + Math.sin(i / 160) * 6
        position_lat[i] = baseLat + Math.sin(theta) * radius
        position_long[i] = baseLon + Math.cos(theta) * radius * 1.4
        air_speed[i] = speed + 1.3 + Math.sin(i / 37) * 0.6
        wind_speed[i] = 2.5 + Math.cos(i / 70) * 0.5
        wind_yaw[i] = Math.sin(i / 80) * 22
        air_density_data[i] = 1.225
        road_speed[i] = speed
        temperature[i] = 18 + Math.sin(i / 300) * 2
        heart_rate[i] = 145 + Math.sin(i / 50) * 8
        cadence[i] = 88 + Math.cos(i / 40) * 6
    }

    return {
        timestamps,
        position_lat,
        position_long,
        altitude,
        velocity,
        power,
        air_speed,
        distance,
        wind_speed,
        wind_yaw,
        air_density_data,
        road_speed,
        temperature,
        battery_soc,
        heart_rate,
        cadence,
        record_count: points,
    }
}

function createSegmentRanges(totalPoints: number, segmentCount: number): Array<{ startIdx: number; endIdx: number }> {
    const usableStart = 300
    const usableEnd = totalPoints - 300
    const segmentLength = Math.floor((usableEnd - usableStart) / segmentCount)

    return Array.from({ length: segmentCount }, (_, index) => {
        const startIdx = usableStart + index * segmentLength
        const endIdx = index === segmentCount - 1
            ? usableEnd - 1
            : startIdx + segmentLength - 1
        return { startIdx, endIdx }
    })
}

function createOutAndBackSections(totalPoints: number, sectionCount: number): OutAndBackSection[] {
    const sections: OutAndBackSection[] = []
    const usableStart = 300
    const usableEnd = totalPoints - 300
    const sectionSpan = Math.floor((usableEnd - usableStart) / sectionCount)

    for (let index = 0; index < sectionCount; index++) {
        const sectionStart = usableStart + index * sectionSpan
        const sectionEnd = index === sectionCount - 1 ? usableEnd - 1 : sectionStart + sectionSpan - 1
        const midpoint = sectionStart + Math.floor((sectionEnd - sectionStart) / 2)

        sections.push({
            sectionNumber: index + 1,
            outboundStartIdx: sectionStart,
            outboundEndIdx: midpoint,
            outboundStartDirection: 0,
            outboundEndDirection: 0,
            outboundDuration: midpoint - sectionStart,
            outboundDistance: 0,
            inboundStartIdx: midpoint + 1,
            inboundEndIdx: sectionEnd,
            inboundStartDirection: 180,
            inboundEndDirection: 180,
            inboundDuration: sectionEnd - (midpoint + 1),
            inboundDistance: 0,
            totalDuration: sectionEnd - sectionStart,
            totalDistance: 0,
        })
    }

    return sections
}

function percentile(sortedValues: number[], ratio: number): number {
    if (sortedValues.length === 0) {
        return Number.NaN
    }

    const index = Math.min(sortedValues.length - 1, Math.max(0, Math.ceil(sortedValues.length * ratio) - 1))
    return sortedValues[index]
}

function formatMs(value: number): string {
    return `${value.toFixed(1)}ms`
}

void main().catch(error => {
    process.stderr.write(`${error instanceof Error ? error.stack ?? error.message : String(error)}\n`)
    process.exitCode = 1
})
