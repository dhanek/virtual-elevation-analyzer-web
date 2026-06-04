/**
 * Weather API client for Open-Meteo
 * Fetches temperature, dew point, and pressure data for air density calculations
 */

import { TrimRegionMetadata, roundToNearest15Min } from './GeoCalculations';
import { log } from './log';

export interface WeatherQuery {
    latitude: number;      // Rounded to 6 decimals
    longitude: number;     // Rounded to 6 decimals
    date: string;          // YYYY-MM-DD format
    slotHour: number;      // 0-23 (UTC), hour of nearest 15-min slot
    slotMinute: number;    // 0, 15, 30, or 45 (nearest 15-min slot)
    nearestHour: number;   // 0-23 (UTC), independently rounded to nearest hour
}

export interface WeatherResponse {
    temperature: number;  // °C
    dewPoint: number;     // °C
    pressure: number;     // hPa (hectopascals)
    windSpeed: number;    // m/s at 10m height
    windDirection: number; // degrees (0-360, meteorological convention)
    queriedAt: number;    // Timestamp when data was fetched
}

export class WeatherAPIError extends Error {
    constructor(
        message: string,
        public code?: string,
        public details?: any
    ) {
        super(message);
        this.name = 'WeatherAPIError';
    }
}

export class WeatherAPI {
    private readonly forecastBaseUrl = 'https://api.open-meteo.com/v1/forecast';
    private readonly archiveBaseUrl = 'https://archive-api.open-meteo.com/v1/archive';
    // Forecast API supports start_date/end_date for up to ~82 days in the past
    // Archive API for anything older (supports data from 1940)
    private readonly forecastMaxDays = 82;

    /**
     * Fetch weather data for a specific location and time
     * Automatically selects Forecast API (recent days) or Archive API (older data)
     *
     * @param metadata - Trim region metadata containing GPS coordinates and timestamp
     * @returns Weather data (temperature, dew point, pressure)
     * @throws WeatherAPIError if fetch fails or data is unavailable
     */
    async fetchWeatherData(metadata: TrimRegionMetadata): Promise<WeatherResponse> {
        const query = this.buildQuery(metadata);
        const daysDiff = this.calculateDaysDifference(metadata.middleDate);

        // Try Forecast API first (supports minutely_15), fall back to Archive API
        // Forecast API accepts dates up to ~82 days back but may return all-null data
        // for dates older than ~69 days. Archive API is the reliable fallback.
        const useForecastAPI = daysDiff <= this.forecastMaxDays;

        if (useForecastAPI) {
            const result = await this.fetchFromAPI('Forecast', this.forecastBaseUrl, query, daysDiff, '15min', true);
            if (result) return result;

            // Forecast API returned all-null data — fall back to Archive
            log.debug('⚠️ Forecast API returned null data, falling back to Archive API');
        }

        // Archive API always has data — non-null assertion is safe here
        return (await this.fetchFromAPI('Archive', this.archiveBaseUrl, query, daysDiff, 'hourly'))!;
    }

    /**
     * Fetch and extract weather data from a specific API endpoint
     */
    private async fetchFromAPI(
        apiType: string,
        baseUrl: string,
        query: WeatherQuery,
        daysDiff: number,
        resolution: '15min' | 'hourly',
        allowNullFallback: boolean = false
    ): Promise<WeatherResponse | null> {
        const url = this.buildApiUrl(baseUrl, query, resolution);

        const timeStr = resolution === '15min'
            ? `${query.date}T${String(query.slotHour).padStart(2, '0')}:${String(query.slotMinute).padStart(2, '0')} UTC`
            : `${query.date}T${String(query.nearestHour).padStart(2, '0')}:00 UTC`;

        log.debug('═══════════════════════════════════════════════════════');
        log.debug(`🌐 OPEN-METEO ${apiType.toUpperCase()} API REQUEST (${resolution})`);
        log.debug('═══════════════════════════════════════════════════════');
        log.debug('🔀 API Type:', apiType, `(${daysDiff} days ago)`);
        log.debug('📍 Location:', {
            latitude: query.latitude,
            longitude: query.longitude
        });
        log.debug('📅 Date/Time:', {
            date: query.date,
            slot: `${String(query.slotHour).padStart(2, '0')}:${String(query.slotMinute).padStart(2, '0')}`,
            nearestHour: query.nearestHour,
            utc: timeStr
        });
        log.debug('⏱️  Days Past:', daysDiff);
        log.debug('🔗 Full URL:', url);
        log.debug('═══════════════════════════════════════════════════════');

        try {
            log.debug('🔄 Executing fetch request...');
            const response = await fetch(url);

            log.debug('📡 API Response Status:', response.status, response.statusText);

            if (!response.ok) {
                throw new WeatherAPIError(
                    `Weather API error: ${response.status} ${response.statusText}`,
                    'API_ERROR',
                    { status: response.status, statusText: response.statusText }
                );
            }

            const data = await response.json();

            // Extract weather data based on resolution
            let weatherData: WeatherResponse;
            if (resolution === '15min') {
                const has15minData = data.minutely_15?.temperature_2m?.some((v: number | null) => v !== null);
                if (has15minData) {
                    weatherData = this.extractMinutely15Data(data, query);
                } else {
                    // Check if hourly fallback within this response has data
                    const hasHourlyData = data.hourly?.temperature_2m?.some((v: number | null) => v !== null);
                    if (hasHourlyData) {
                        log.debug('⚠️ minutely_15 data is all null, using hourly from same response');
                        weatherData = this.extractHourlyData(data, query);
                    } else if (allowNullFallback) {
                        // Both minutely_15 and hourly are null — signal caller to try Archive API
                        log.debug('⚠️ Both minutely_15 and hourly data are null in Forecast response');
                        return null;
                    } else {
                        throw new WeatherAPIError(
                            'Weather data is all null in API response',
                            'NULL_DATA'
                        );
                    }
                }
            } else {
                weatherData = this.extractHourlyData(data, query);
            }

            log.debug('═══════════════════════════════════════════════════════');
            log.debug('✅ WEATHER DATA RECEIVED');
            log.debug('═══════════════════════════════════════════════════════');
            log.debug('🌡️  Temperature:', weatherData.temperature, '°C');
            log.debug('💧 Dew Point:', weatherData.dewPoint, '°C');
            log.debug('🔽 Pressure:', weatherData.pressure, 'hPa');
            log.debug('💨 Wind Speed:', weatherData.windSpeed, 'm/s');
            log.debug('🧭 Wind Direction:', weatherData.windDirection, '°');
            log.debug('⏰ Queried At:', new Date(weatherData.queriedAt).toISOString());
            log.debug('═══════════════════════════════════════════════════════');

            return weatherData;

        } catch (error) {
            if (error instanceof WeatherAPIError) {
                throw error;
            }

            throw new WeatherAPIError(
                `Failed to fetch weather data: ${error instanceof Error ? error.message : 'Unknown error'}`,
                'FETCH_ERROR',
                { originalError: error }
            );
        }
    }

    /**
     * Build weather query from trim region metadata
     */
    private buildQuery(metadata: TrimRegionMetadata): WeatherQuery {
        const slot = roundToNearest15Min(metadata.middleDate);

        return {
            latitude: metadata.avgLat,
            longitude: metadata.avgLon,
            date: slot.date,
            slotHour: slot.slotHour,
            slotMinute: slot.slotMinute,
            nearestHour: slot.nearestHour
        };
    }

    /**
     * Calculate days difference between activity and now
     */
    private calculateDaysDifference(activityDate: Date): number {
        const now = new Date();
        const diffMs = now.getTime() - activityDate.getTime();
        const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));

        return Math.max(0, diffDays); // Ensure non-negative
    }

    /**
     * Build complete API URL with query parameters
     * Both APIs use start_date/end_date for efficient single-day queries
     */
    private buildApiUrl(baseUrl: string, query: WeatherQuery, resolution: '15min' | 'hourly'): string {
        const params = new URLSearchParams({
            latitude: query.latitude.toString(),
            longitude: query.longitude.toString(),
            start_date: query.date,
            end_date: query.date,
            timezone: 'UTC',
            wind_speed_unit: 'ms'  // Request wind speed in m/s (default is km/h)
        });

        if (resolution === '15min') {
            // Use minutely_15 for temp, dew point, wind; hourly for surface_pressure
            // Always request full hourly set as fallback (minutely_15 returns nulls for older dates ~70+ days)
            params.set('minutely_15', 'temperature_2m,dew_point_2m,wind_speed_10m,wind_direction_10m');
            params.set('hourly', 'temperature_2m,dew_point_2m,surface_pressure,wind_speed_10m,wind_direction_10m');
        } else {
            params.set('hourly', 'temperature_2m,dew_point_2m,surface_pressure,wind_speed_10m,wind_direction_10m');
        }

        return `${baseUrl}?${params}`;
    }

    /**
     * Extract weather data from minutely_15 response (Forecast API)
     * Gets temp, dew point, wind from minutely_15; pressure from hourly
     */
    private extractMinutely15Data(data: any, query: WeatherQuery): WeatherResponse {
        const targetTimestamp = `${query.date}T${String(query.slotHour).padStart(2, '0')}:${String(query.slotMinute).padStart(2, '0')}`;

        // Validate minutely_15 data exists
        if (!data.minutely_15?.time) {
            throw new WeatherAPIError(
                'Invalid API response: missing minutely_15 data',
                'INVALID_RESPONSE',
                { data }
            );
        }

        // Find matching 15-min slot
        const slotIndex = data.minutely_15.time.findIndex((time: string) =>
            time.startsWith(targetTimestamp)
        );

        if (slotIndex === -1) {
            throw new WeatherAPIError(
                `No 15-min weather data available for ${targetTimestamp}`,
                'DATA_NOT_FOUND',
                { targetTimestamp, availableTimes: data.minutely_15.time }
            );
        }

        const temperature = data.minutely_15.temperature_2m?.[slotIndex];
        const dewPoint = data.minutely_15.dew_point_2m?.[slotIndex];
        const windSpeed = data.minutely_15.wind_speed_10m?.[slotIndex];
        const windDirection = data.minutely_15.wind_direction_10m?.[slotIndex];

        // Get surface_pressure from hourly data (nearest hour)
        const hourTimestamp = `${query.date}T${String(query.nearestHour).padStart(2, '0')}:00`;
        if (!data.hourly?.time) {
            throw new WeatherAPIError(
                'Invalid API response: missing hourly data for surface_pressure',
                'INVALID_RESPONSE',
                { data }
            );
        }
        const hourIndex = data.hourly.time.findIndex((time: string) =>
            time.startsWith(hourTimestamp)
        );
        const pressure = hourIndex !== -1 ? data.hourly.surface_pressure?.[hourIndex] : undefined;

        log.debug('🔍 Extracted 15-min weather values at index', slotIndex, ':', {
            temperature,
            dewPoint,
            pressure: `${pressure} (hourly index ${hourIndex})`,
            windSpeed,
            windDirection,
            timestamp: data.minutely_15.time?.[slotIndex]
        });

        // Validate all required fields
        if (
            temperature == null || dewPoint == null || pressure == null ||
            windSpeed == null || windDirection == null
        ) {
            throw new WeatherAPIError(
                'Incomplete weather data in API response',
                'INCOMPLETE_DATA',
                { temperature, dewPoint, pressure, windSpeed, windDirection, slotIndex, hourIndex }
            );
        }

        this.validateWeatherValues(temperature, dewPoint, pressure, windSpeed, windDirection);

        return {
            temperature,
            dewPoint,
            pressure,
            windSpeed,
            windDirection,
            queriedAt: Date.now()
        };
    }

    /**
     * Extract weather data for specific hour from API response (Archive API fallback)
     */
    private extractHourlyData(data: any, query: WeatherQuery): WeatherResponse {
        const targetTimestamp = `${query.date}T${String(query.nearestHour).padStart(2, '0')}:00`;

        if (!data.hourly?.time) {
            throw new WeatherAPIError(
                'Invalid API response: missing hourly data',
                'INVALID_RESPONSE',
                { data }
            );
        }

        // Find matching hour in response
        const hourIndex = data.hourly.time.findIndex((time: string) =>
            time.startsWith(targetTimestamp)
        );

        if (hourIndex === -1) {
            throw new WeatherAPIError(
                `No weather data available for ${targetTimestamp}`,
                'DATA_NOT_FOUND',
                { targetTimestamp, availableTimes: data.hourly.time }
            );
        }

        const temperature = data.hourly.temperature_2m?.[hourIndex];
        const dewPoint = data.hourly.dew_point_2m?.[hourIndex];
        const pressure = data.hourly.surface_pressure?.[hourIndex];
        const windSpeed = data.hourly.wind_speed_10m?.[hourIndex];
        const windDirection = data.hourly.wind_direction_10m?.[hourIndex];

        log.debug('🔍 Extracted hourly weather values at index', hourIndex, ':', {
            temperature,
            dewPoint,
            pressure,
            windSpeed,
            windDirection,
            timestamp: data.hourly.time?.[hourIndex]
        });

        if (
            temperature == null || dewPoint == null || pressure == null ||
            windSpeed == null || windDirection == null
        ) {
            throw new WeatherAPIError(
                'Incomplete weather data in API response',
                'INCOMPLETE_DATA',
                { temperature, dewPoint, pressure, windSpeed, windDirection, hourIndex }
            );
        }

        this.validateWeatherValues(temperature, dewPoint, pressure, windSpeed, windDirection);

        return {
            temperature,
            dewPoint,
            pressure,
            windSpeed,
            windDirection,
            queriedAt: Date.now()
        };
    }

    /**
     * Validate weather values are within reasonable ranges
     */
    private validateWeatherValues(
        temperature: number,
        dewPoint: number,
        pressure: number,
        windSpeed: number,
        windDirection: number
    ): void {
        if (!isFinite(temperature) || temperature < -100 || temperature > 60) {
            throw new WeatherAPIError(
                `Invalid temperature: ${temperature}°C (expected -100 to 60°C)`,
                'INVALID_DATA'
            );
        }

        if (!isFinite(dewPoint) || dewPoint < -100 || dewPoint > 60) {
            throw new WeatherAPIError(
                `Invalid dew point: ${dewPoint}°C (expected -100 to 60°C)`,
                'INVALID_DATA'
            );
        }

        if (!isFinite(pressure) || pressure < 500 || pressure > 1100) {
            throw new WeatherAPIError(
                `Invalid pressure: ${pressure} hPa (expected 500-1100 hPa)`,
                'INVALID_DATA'
            );
        }

        if (!isFinite(windSpeed) || windSpeed < 0 || windSpeed > 100) {
            throw new WeatherAPIError(
                `Invalid wind speed: ${windSpeed} m/s (expected 0-100 m/s)`,
                'INVALID_DATA'
            );
        }

        if (!isFinite(windDirection) || windDirection < 0 || windDirection > 360) {
            throw new WeatherAPIError(
                `Invalid wind direction: ${windDirection}° (expected 0-360°)`,
                'INVALID_DATA'
            );
        }

        if (dewPoint > temperature) {
            throw new WeatherAPIError(
                `Invalid data: dew point (${dewPoint}°C) exceeds temperature (${temperature}°C)`,
                'INVALID_DATA'
            );
        }
    }

    /**
     * Test API connectivity
     * Useful for diagnostics
     */
    async testConnection(): Promise<boolean> {
        try {
            // Test with a simple forecast request (current location, minimal data)
            const testUrl = `${this.forecastBaseUrl}?latitude=0&longitude=0&hourly=temperature_2m&forecast_days=1`;
            const response = await fetch(testUrl);
            return response.ok;
        } catch {
            return false;
        }
    }
}
