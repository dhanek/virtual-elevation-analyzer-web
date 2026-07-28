import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import type { TrimRegionMetadata } from './GeoCalculations'
import { WeatherAPI, WeatherAPIError } from './WeatherAPI'
import {
    WEATHER_FAILURE_GENERIC_MESSAGE,
    WEATHER_FAILURE_PREFIX,
    resolveWeatherFailure,
} from '../shell/ve/weatherFallback'

/**
 * TEST-01 — coverage for WEATH-03 rung 2: an all-null Forecast response must
 * degrade silently to the Archive API rather than surfacing a failure. The
 * outage cases additionally check the code each rung throws still lands on the
 * intended user-facing text via `resolveWeatherFailure`.
 *
 * All network access is mocked; no test here touches the real Open-Meteo.
 */

/** Pinned "now" so days-since-activity is deterministic. */
const NOW = new Date('2026-07-26T12:00:00Z')

/** 9 whole days before NOW → inside the 82-day Forecast window. */
const RECENT_ACTIVITY = new Date('2026-07-16T14:07:00Z')

/** 115 whole days before NOW → outside the Forecast window, Archive only. */
const OLD_ACTIVITY = new Date('2026-04-01T14:07:00Z')

/** roundToNearest15Min(RECENT_ACTIVITY) → 14:00 slot, 14:00 nearest hour. */
const RECENT_SLOT = '2026-07-16T14:00'
const OLD_SLOT = '2026-04-01T14:00'

const FORECAST_HOST = 'api.open-meteo.com/v1/forecast'
const ARCHIVE_HOST = 'archive-api.open-meteo.com/v1/archive'

function makeMetadata(middleDate: Date = RECENT_ACTIVITY): TrimRegionMetadata {
    return {
        avgLat: 47.123456,
        avgLon: 8.654321,
        middleTimestamp: Math.floor(middleDate.getTime() / 1000),
        middleDate,
        dataPointCount: 120,
        trimStart: 0,
        trimEnd: 119,
    }
}

/** Forecast payload where both minutely_15 and hourly are entirely null. */
function forecastAllNullBody(slot: string = RECENT_SLOT): Record<string, unknown> {
    const [date, time] = slot.split('T')
    return {
        minutely_15: {
            time: [`${date}T13:45`, `${date}T${time}`, `${date}T14:15`],
            temperature_2m: [null, null, null],
            dew_point_2m: [null, null, null],
            wind_speed_10m: [null, null, null],
            wind_direction_10m: [null, null, null],
        },
        hourly: {
            time: [`${date}T13:00`, `${date}T${time}`],
            temperature_2m: [null, null],
            dew_point_2m: [null, null],
            surface_pressure: [null, null],
            wind_speed_10m: [null, null],
            wind_direction_10m: [null, null],
        },
    }
}

/** Forecast payload with usable minutely_15 values (rung 1, no fallback). */
function forecastWithDataBody(slot: string = RECENT_SLOT): Record<string, unknown> {
    const [date, time] = slot.split('T')
    return {
        minutely_15: {
            time: [`${date}T13:45`, `${date}T${time}`, `${date}T14:15`],
            temperature_2m: [20.0, 21.5, 22.0],
            dew_point_2m: [11.0, 12.5, 13.0],
            wind_speed_10m: [2.0, 3.4, 4.0],
            wind_direction_10m: [180, 225, 200],
        },
        hourly: {
            time: [`${date}T13:00`, `${date}T${time}`],
            temperature_2m: [19.0, 21.0],
            dew_point_2m: [10.0, 12.0],
            surface_pressure: [1009.0, 1011.2],
            wind_speed_10m: [2.0, 3.0],
            wind_direction_10m: [170, 190],
        },
    }
}

/** Archive payload with usable hourly values. */
function archiveBody(slot: string = RECENT_SLOT): Record<string, unknown> {
    const [date, time] = slot.split('T')
    return {
        hourly: {
            time: [`${date}T13:00`, `${date}T${time}`, `${date}T15:00`],
            temperature_2m: [17.0, 18.4, 19.0],
            dew_point_2m: [9.0, 9.6, 10.0],
            surface_pressure: [1006.0, 1007.8, 1008.0],
            wind_speed_10m: [1.0, 2.6, 3.0],
            wind_direction_10m: [90, 135, 160],
        },
    }
}

/** Archive payload whose values are all null (end of the ladder). */
function archiveAllNullBody(slot: string = RECENT_SLOT): Record<string, unknown> {
    const [date, time] = slot.split('T')
    return {
        hourly: {
            time: [`${date}T13:00`, `${date}T${time}`],
            temperature_2m: [null, null],
            dew_point_2m: [null, null],
            surface_pressure: [null, null],
            wind_speed_10m: [null, null],
            wind_direction_10m: [null, null],
        },
    }
}

function jsonResponse(
    body: Record<string, unknown>,
    init: { ok?: boolean; status?: number; statusText?: string } = {},
): Response {
    return {
        ok: init.ok ?? true,
        status: init.status ?? 200,
        statusText: init.statusText ?? 'OK',
        json: async () => body,
    } as unknown as Response
}

function errorResponse(status: number, statusText: string): Response {
    return jsonResponse({}, { ok: false, status, statusText })
}

/**
 * Stub the global `fetch` with a queue. Each entry is either a Response to
 * resolve with or an Error to reject with; an unqueued extra call fails the
 * test rather than silently hitting the network.
 */
function mockFetchSequence(...queued: Array<Response | Error>): ReturnType<typeof vi.fn> {
    let callIndex = 0
    const fetchMock = vi.fn(async (_url: string) => {
        const next = queued[callIndex++]
        if (next === undefined) {
            throw new Error(`fetch called ${callIndex} times but only ${queued.length} responses were queued`)
        }
        if (next instanceof Error) {
            throw next
        }
        return next
    })
    vi.stubGlobal('fetch', fetchMock)
    return fetchMock
}

function urlOfCall(fetchMock: ReturnType<typeof vi.fn>, index: number): string {
    return String(fetchMock.mock.calls[index][0])
}

/** Run an async call that must reject and hand back what it threw. */
async function captureError(run: () => Promise<unknown>): Promise<unknown> {
    try {
        await run()
    } catch (error) {
        return error
    }
    throw new Error('expected the call to reject, but it resolved')
}

beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(NOW)
})

afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllGlobals()
})

describe('WeatherAPI fixtures', () => {
    test('the fetch queue serves responses in order and rejects overruns', async () => {
        const fetchMock = mockFetchSequence(jsonResponse(forecastAllNullBody()), errorResponse(503, 'Service Unavailable'))
        expect((await fetch('first')).ok).toBe(true)
        expect((await fetch('second')).status).toBe(503)
        await expect(fetch('third')).rejects.toThrow(/only 2 responses were queued/)
        expect(fetchMock).toHaveBeenCalledTimes(3)
    })

    test('metadata fixture pins the activity inside the Forecast window', () => {
        const metadata = makeMetadata()
        const daysAgo = Math.floor((NOW.getTime() - metadata.middleDate.getTime()) / 86_400_000)
        expect(daysAgo).toBe(9)
        const oldDaysAgo = Math.floor((NOW.getTime() - OLD_ACTIVITY.getTime()) / 86_400_000)
        expect(oldDaysAgo).toBeGreaterThan(82)
    })
})

describe('fetchWeatherData — rung 1: Forecast returns data', () => {
    test('uses the Forecast response and never calls the Archive API', async () => {
        const fetchMock = mockFetchSequence(jsonResponse(forecastWithDataBody()))

        const result = await new WeatherAPI().fetchWeatherData(makeMetadata())

        expect(fetchMock).toHaveBeenCalledTimes(1)
        expect(urlOfCall(fetchMock, 0)).toContain(FORECAST_HOST)
        expect(urlOfCall(fetchMock, 0)).not.toContain(ARCHIVE_HOST)
        // temp/dew/wind come from minutely_15 at the 14:00 slot,
        // surface_pressure from hourly at the nearest hour.
        expect(result).toEqual({
            temperature: 21.5,
            dewPoint: 12.5,
            pressure: 1011.2,
            windSpeed: 3.4,
            windDirection: 225,
            queriedAt: NOW.getTime(),
        })
    })
})

describe('fetchWeatherData — rung 2: Forecast all-null → Archive', () => {
    test('falls back to the Archive API and returns its data', async () => {
        const fetchMock = mockFetchSequence(
            jsonResponse(forecastAllNullBody()),
            jsonResponse(archiveBody()),
        )

        const result = await new WeatherAPI().fetchWeatherData(makeMetadata())

        // Rung 2 must be silent: the caller gets data, not an error.
        expect(fetchMock).toHaveBeenCalledTimes(2)
        expect(urlOfCall(fetchMock, 0)).toContain(FORECAST_HOST)
        expect(urlOfCall(fetchMock, 1)).toContain(ARCHIVE_HOST)
        // Values are the Archive ones, not the (all-null) Forecast ones.
        expect(result).toEqual({
            temperature: 18.4,
            dewPoint: 9.6,
            pressure: 1007.8,
            windSpeed: 2.6,
            windDirection: 135,
            queriedAt: NOW.getTime(),
        })
    })

    test('queries the same day/location on both rungs, hourly-only on Archive', async () => {
        const fetchMock = mockFetchSequence(
            jsonResponse(forecastAllNullBody()),
            jsonResponse(archiveBody()),
        )

        await new WeatherAPI().fetchWeatherData(makeMetadata())

        const forecastUrl = urlOfCall(fetchMock, 0)
        const archiveUrl = urlOfCall(fetchMock, 1)
        expect(forecastUrl).toContain('minutely_15=')
        expect(archiveUrl).not.toContain('minutely_15=')
        for (const url of [forecastUrl, archiveUrl]) {
            expect(url).toContain('latitude=47.123456')
            expect(url).toContain('longitude=8.654321')
            expect(url).toContain('start_date=2026-07-16')
            expect(url).toContain('end_date=2026-07-16')
            expect(url).toContain('wind_speed_unit=ms')
        }
    })
})

describe('fetchWeatherData — Archive-only path for old activities', () => {
    test('skips the Forecast API beyond the 82-day window', async () => {
        const fetchMock = mockFetchSequence(jsonResponse(archiveBody(OLD_SLOT)))

        const result = await new WeatherAPI().fetchWeatherData(makeMetadata(OLD_ACTIVITY))

        expect(fetchMock).toHaveBeenCalledTimes(1)
        expect(urlOfCall(fetchMock, 0)).toContain(ARCHIVE_HOST)
        expect(urlOfCall(fetchMock, 0)).toContain('start_date=2026-04-01')
        expect(result.temperature).toBe(18.4)
        expect(result.pressure).toBe(1007.8)
    })
})

describe('fetchWeatherData — rung 3: outages surface as coded WeatherAPIErrors', () => {
    test('maps a non-ok response to API_ERROR and does not retry on Archive', async () => {
        const fetchMock = mockFetchSequence(errorResponse(503, 'Service Unavailable'))

        const error = await captureError(() => new WeatherAPI().fetchWeatherData(makeMetadata()))

        expect(error).toBeInstanceOf(WeatherAPIError)
        expect((error as WeatherAPIError).code).toBe('API_ERROR')
        expect(fetchMock).toHaveBeenCalledTimes(1)
        // Ladder linkage: this is what the user actually sees.
        expect(resolveWeatherFailure(error).userMessage).toBe(
            `${WEATHER_FAILURE_PREFIX}: Weather service unavailable. Using manual rho value.`,
        )
        expect(resolveWeatherFailure(error).severity).toBe('warning')
    })

    test('maps a network rejection to FETCH_ERROR without leaking the cause', async () => {
        mockFetchSequence(new TypeError('Failed to fetch: SECRET_HOST_DETAIL'))

        const error = await captureError(() => new WeatherAPI().fetchWeatherData(makeMetadata()))

        expect(error).toBeInstanceOf(WeatherAPIError)
        expect((error as WeatherAPIError).code).toBe('FETCH_ERROR')
        const { userMessage, severity } = resolveWeatherFailure(error)
        expect(userMessage).toBe(
            `${WEATHER_FAILURE_PREFIX}: Network error. Check your internet connection.`,
        )
        expect(userMessage).not.toContain('SECRET_HOST_DETAIL')
        expect(severity).toBe('warning')
    })

    test('surfaces the Archive failure when both rungs fail', async () => {
        const fetchMock = mockFetchSequence(
            jsonResponse(forecastAllNullBody()),
            errorResponse(500, 'Internal Server Error'),
        )

        const error = await captureError(() => new WeatherAPI().fetchWeatherData(makeMetadata()))

        expect(fetchMock).toHaveBeenCalledTimes(2)
        expect((error as WeatherAPIError).code).toBe('API_ERROR')
        expect(resolveWeatherFailure(error).userMessage).toBe(
            `${WEATHER_FAILURE_PREFIX}: Weather service unavailable. Using manual rho value.`,
        )
    })

    test('an all-null Archive response degrades through the generic message', async () => {
        // End of the ladder: Forecast null → Archive null. The thrown code has
        // no dedicated user text, so the generic fallback must cover it.
        const fetchMock = mockFetchSequence(
            jsonResponse(forecastAllNullBody()),
            jsonResponse(archiveAllNullBody()),
        )

        const error = await captureError(() => new WeatherAPI().fetchWeatherData(makeMetadata()))

        expect(fetchMock).toHaveBeenCalledTimes(2)
        expect(error).toBeInstanceOf(WeatherAPIError)
        expect((error as WeatherAPIError).code).toBe('INCOMPLETE_DATA')
        expect(resolveWeatherFailure(error)).toEqual({
            userMessage: WEATHER_FAILURE_GENERIC_MESSAGE,
            severity: 'warning',
        })
    })
})
