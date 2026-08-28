/**
 * The synthetic activity and segment geometry shared by the profiling scripts.
 *
 * Extracted verbatim from `profile-slider-recompute.ts` so that script and
 * `profile-gps-lap-render.ts` measure THE SAME DATASET. Two profilers that each
 * carried their own generator could not be compared to each other: a difference
 * in a reported number would not distinguish "the render layer costs more than
 * the compute layer" from "the two scripts built different activities". The
 * compute pre-screen's numbers only bound the render numbers if the input is
 * literally the same object graph.
 *
 * Nothing here is production code and nothing here is a golden literal.
 */
import type { ActivityData } from '../src/state/AppState'
import type { OutAndBackSection } from '../src/utils/GpsLapDetection'

export function createSyntheticActivity(points: number): ActivityData {
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

export function createSegmentRanges(totalPoints: number, segmentCount: number): Array<{ startIdx: number; endIdx: number }> {
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

export function createOutAndBackSections(totalPoints: number, sectionCount: number): OutAndBackSection[] {
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

export function percentile(sortedValues: number[], ratio: number): number {
    if (sortedValues.length === 0) {
        return Number.NaN
    }

    const index = Math.min(sortedValues.length - 1, Math.max(0, Math.ceil(sortedValues.length * ratio) - 1))
    return sortedValues[index]
}

export function formatMs(value: number): string {
    return `${value.toFixed(1)}ms`
}
