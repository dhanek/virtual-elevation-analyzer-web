/**
 * Weather API client for Open-Meteo
 * Fetches temperature, dew point, and pressure data for air density calculations
 */

import { TrimRegionMetadata } from './GeoCalculations';

export interface WeatherQuery {
    latitude: number;     // Rounded to 6 decimals
    longitude: number;    // Rounded to 6 decimals
    date: string;         // YYYY-MM-DD format
    hour: number;         // 0-23 (UTC)
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

        // Select API based on age
        const useForecastAPI = daysDiff <= this.forecastMaxDays;
        const apiType = useForecastAPI ? 'Forecast' : 'Archive';
        const baseUrl = useForecastAPI ? this.forecastBaseUrl : this.archiveBaseUrl;

        // Build API URL with precise parameters
        const url = this.buildApiUrl(baseUrl, query);

        console.log('═══════════════════════════════════════════════════════');
        console.log(`🌐 OPEN-METEO ${apiType.toUpperCase()} API REQUEST`);
        console.log('═══════════════════════════════════════════════════════');
        console.log('🔀 API Type:', apiType, `(${daysDiff} days ago)`);
        console.log('📍 Location:', {
            latitude: query.latitude,
            longitude: query.longitude
        });
        console.log('📅 Date/Time:', {
            date: query.date,
            hour: query.hour,
            utc: `${query.date}T${String(query.hour).padStart(2, '0')}:00 UTC`
        });
        console.log('⏱️  Days Past:', daysDiff);
        console.log('🔗 Full URL:', url);
        console.log('═══════════════════════════════════════════════════════');

        try {
            console.log('🔄 Executing fetch request...');
            const response = await fetch(url);

            console.log('📡 API Response Status:', response.status, response.statusText);

            if (!response.ok) {
                throw new WeatherAPIError(
                    `Weather API error: ${response.status} ${response.statusText}`,
                    'API_ERROR',
                    { status: response.status, statusText: response.statusText }
                );
            }

            const data = await response.json();

            console.log('📦 Raw API Response:', {
                hourlyTimes: data.hourly?.time?.length || 0,
                firstTime: data.hourly?.time?.[0],
                lastTime: data.hourly?.time?.[data.hourly?.time?.length - 1]
            });

            // Validate response structure
            if (!data.hourly || !data.hourly.time) {
                throw new WeatherAPIError(
                    'Invalid API response: missing hourly data',
                    'INVALID_RESPONSE',
                    { data }
                );
            }

            // Extract weather data for specific hour
            const weatherData = this.extractHourlyData(data, query);

            console.log('═══════════════════════════════════════════════════════');
            console.log('✅ WEATHER DATA RECEIVED');
            console.log('═══════════════════════════════════════════════════════');
            console.log('🌡️  Temperature:', weatherData.temperature, '°C');
            console.log('💧 Dew Point:', weatherData.dewPoint, '°C');
            console.log('🔽 Pressure:', weatherData.pressure, 'hPa');
            console.log('💨 Wind Speed:', weatherData.windSpeed, 'm/s');
            console.log('🧭 Wind Direction:', weatherData.windDirection, '°');
            console.log('⏰ Queried At:', new Date(weatherData.queriedAt).toISOString());
            console.log('═══════════════════════════════════════════════════════');

            return weatherData;

        } catch (error) {
            console.error('❌ Fetch failed with error:', error);
            console.error('Error type:', error.constructor.name);
            console.error('Error message:', error instanceof Error ? error.message : String(error));

            if (error instanceof WeatherAPIError) {
                throw error;
            }

            // Network or other errors
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
        const date = metadata.middleDate;

        return {
            latitude: metadata.avgLat,
            longitude: metadata.avgLon,
            date: date.toISOString().split('T')[0], // YYYY-MM-DD
            hour: date.getUTCHours()
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
    private buildApiUrl(baseUrl: string, query: WeatherQuery): string {
        // Both Forecast and Archive APIs support start_date/end_date
        // This fetches only 24 hourly data points for the specific day
        const params = new URLSearchParams({
            latitude: query.latitude.toString(),
            longitude: query.longitude.toString(),
            start_date: query.date,
            end_date: query.date,
            hourly: 'temperature_2m,dew_point_2m,surface_pressure,wind_speed_10m,wind_direction_10m',
            timezone: 'UTC',
            wind_speed_unit: 'ms'  // Request wind speed in m/s (default is km/h)
        });
        return `${baseUrl}?${params}`;
    }

    /**
     * Extract weather data for specific hour from API response
     */
    private extractHourlyData(data: any, query: WeatherQuery): WeatherResponse {
        // Build target timestamp string (ISO format, hour precision)
        const targetTimestamp = `${query.date}T${String(query.hour).padStart(2, '0')}:00`;

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

        // Extract values
        const temperature = data.hourly.temperature_2m?.[hourIndex];
        const dewPoint = data.hourly.dew_point_2m?.[hourIndex];
        const pressure = data.hourly.surface_pressure?.[hourIndex];
        const windSpeed = data.hourly.wind_speed_10m?.[hourIndex];
        const windDirection = data.hourly.wind_direction_10m?.[hourIndex];

        console.log('🔍 Extracted weather values at index', hourIndex, ':', {
            temperature,
            dewPoint,
            pressure,
            windSpeed,
            windDirection,
            timestamp: data.hourly.time?.[hourIndex]
        });

        // Validate all required fields are present
        if (
            temperature === undefined ||
            temperature === null ||
            dewPoint === undefined ||
            dewPoint === null ||
            pressure === undefined ||
            pressure === null ||
            windSpeed === undefined ||
            windSpeed === null ||
            windDirection === undefined ||
            windDirection === null
        ) {
            console.error('❌ Missing weather fields:', {
                hasTemp: temperature !== undefined && temperature !== null,
                hasDewPoint: dewPoint !== undefined && dewPoint !== null,
                hasPressure: pressure !== undefined && pressure !== null,
                hasWindSpeed: windSpeed !== undefined && windSpeed !== null,
                hasWindDirection: windDirection !== undefined && windDirection !== null
            });
            throw new WeatherAPIError(
                'Incomplete weather data in API response',
                'INCOMPLETE_DATA',
                { temperature, dewPoint, pressure, windSpeed, windDirection, hourIndex }
            );
        }

        // Validate values are reasonable
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
