import { AppState } from '../../state/AppState';
import { AnalysisParametersComponent, AnalysisParameters } from '../../components/AnalysisParameters';
import { log } from '../../utils/log';
import { calculateTrimRegionMetadata, formatCoordinates, roundToNearest15Min } from '../../utils/GeoCalculations';
import { WeatherCache, type WeatherCacheEntry } from '../../utils/WeatherCache';
import { WeatherAPI, WeatherAPIError } from '../../utils/WeatherAPI';
import { AirDensityCalculator } from '../../../pkg/virtual_elevation_analyzer.js';
import { showNotification } from '../dom/notifications';
import { ShellServices } from '../analysis/types';
import { refreshCrrTempReadout, syncCrrTempAmbientFromWeather } from './crrTempControls';

/**
 * Calculate air density automatically using weather data.
 * Extracted from main.ts.
 *
 * @param appState - Application state
 * @param parametersComponent - UI component for parameters
 * @param services - Shell services (loading, etc.)
 */
export async function calculateAutoRho(
    appState: AppState,
    parametersComponent: AnalysisParametersComponent | null,
    services: ShellServices
): Promise<number | null> {
    // Prevent infinite loops
    if (appState.isCalculatingAutoRho) {
        log.debug('⏭️  Auto-rho calculation already in progress, skipping\n');
        return null;
    }

    appState.isCalculatingAutoRho = true;

    log.debug('\n╔═══════════════════════════════════════════════════════════════╗');
    log.debug('║  🌦️  AUTO RHO CALCULATION STARTED                            ║');
    log.debug('╚═══════════════════════════════════════════════════════════════╝\n');

    if (!appState.currentFitData || !parametersComponent) {
        log.warn('❌ Cannot calculate auto rho: missing FIT data or parameters component');
        log.debug('  - appState.currentFitData:', !!appState.currentFitData);
        log.debug('  - parametersComponent:', !!parametersComponent);
        appState.isCalculatingAutoRho = false;
        return null;
    }

    const params = parametersComponent.getParameters();

    // Check if auto-calculate is enabled
    if (!params.auto_calculate_rho) {
        log.debug('⏭️  Auto-calculate disabled, skipping\n');
        appState.isCalculatingAutoRho = false;
        return null;
    }

    log.debug('✅ Auto-calculate enabled, proceeding...\n');

    try {
        // IMPORTANT: For auto-rho calculation, always use map trim sliders
        // Map trim sliders are relative to filtered lap data, which is what we need
        // Section 3 trim sliders are relative to full FIT data
        let trimStartSlider = document.getElementById('mapTrimStartSlider') as HTMLInputElement;
        let trimEndSlider = document.getElementById('mapTrimEndSlider') as HTMLInputElement;

        // Fallback to section 3 sliders only if map sliders don't exist
        if (!trimStartSlider || !trimEndSlider) {
            trimStartSlider = document.getElementById('trimStartSlider') as HTMLInputElement;
            trimEndSlider = document.getElementById('trimEndSlider') as HTMLInputElement;
            log.debug('🔍 Map trim sliders not found, using section 3 sliders...');
        } else {
            log.debug('🔍 Using map trim sliders (relative to filtered lap data)...');
        }

        log.debug('  - trimStartSlider exists:', !!trimStartSlider);
        log.debug('  - trimEndSlider exists:', !!trimEndSlider);

        if (!trimStartSlider || !trimEndSlider) {
            log.warn('❌ No trim sliders found - cannot calculate auto rho');
            log.debug('  This usually means the UI is not ready yet.');
            log.debug('  Will retry when sliders are available.\n');
            appState.isCalculatingAutoRho = false;
            return null;
        }

        const trimStart = parseInt(trimStartSlider.value);
        const trimEnd = parseInt(trimEndSlider.value);

        log.debug('📊 Trim region values:', {
            start: trimStart,
            end: trimEnd,
            dataPointsInRange: trimEnd - trimStart + 1
        });
        log.debug('');

        // Show loading state
        services.showLoading('Fetching weather data...');

        try {
            // Calculate GPS metadata from trim region
            // Use filtered lap data (only selected laps), not the full FIT data
            if (!appState.filteredLapData) {
                log.warn('❌ No filtered lap data available - cannot calculate auto rho');
                log.debug('  This usually means laps have not been selected yet.\n');
                services.hideLoading();
                appState.isCalculatingAutoRho = false;
                return null;
            }

            log.debug('🗺️  Calculating GPS metadata from trim region...');
            log.debug('  Using filtered lap data with', appState.filteredLapData.timestamps.length, 'data points');

            const metadata = calculateTrimRegionMetadata(
                appState.filteredLapData,
                trimStart,
                trimEnd
            );

            log.debug('═══════════════════════════════════════════════════════');
            log.debug('📍 TRIM REGION METADATA');
            log.debug('═══════════════════════════════════════════════════════');
            log.debug('  Location:', formatCoordinates(metadata.avgLat, metadata.avgLon));
            log.debug('  Coordinates:', `${metadata.avgLat}, ${metadata.avgLon}`);
            log.debug('  Date/Time:', metadata.middleDate.toISOString());
            log.debug('  Valid GPS Points:', metadata.dataPointCount);
            log.debug('  Trim Range:', `${trimStart} to ${trimEnd}`);
            log.debug('═══════════════════════════════════════════════════════\n');

            // Generate query key (rounded to nearest 15-min slot to match API granularity)
            const slot = roundToNearest15Min(metadata.middleDate);
            const queryKey = `${metadata.avgLat.toFixed(6)}_${metadata.avgLon.toFixed(6)}_${slot.date}_${String(slot.slotHour).padStart(2, '0')}:${String(slot.slotMinute).padStart(2, '0')}`;

            // Check if query has actually changed
            if (appState.lastWeatherQueryKey === queryKey) {
                log.debug('⏭️  Query unchanged from last calculation, using cached rho');
                log.debug('  Query key:', queryKey);
                services.hideLoading();
                appState.isCalculatingAutoRho = false;
                return params.rho; // Return current rho value
            }

            log.debug('🔄 Query changed, fetching new weather data');
            log.debug('  Previous:', appState.lastWeatherQueryKey || 'none');
            log.debug('  Current:', queryKey);
            log.debug('');

            // Update last query key
            appState.lastWeatherQueryKey = queryKey;

            // Initialize weather services
            const weatherCache = new WeatherCache();
            const weatherAPI = new WeatherAPI();

            // Get weather data (from cache or API)
            log.debug('🔄 Fetching weather data (checking cache first)...\n');
            let weatherEntry: WeatherCacheEntry = await weatherCache.getWeatherData(metadata, weatherAPI);

            // Check if cached entry has wind data - if not, re-fetch from API
            if (weatherEntry.source === 'cache' &&
                (weatherEntry.data.windSpeed === undefined || weatherEntry.data.windDirection === undefined)) {
                log.debug('⚠️  Cached entry missing wind data, re-fetching from API...');
                // Fetch directly from API to get complete data
                const freshData = await weatherAPI.fetchWeatherData(metadata);
                weatherEntry = {
                    key: weatherEntry.key,
                    data: freshData,
                    cachedAt: Date.now(),
                    source: 'api'
                };
                // Update cache with complete data
                await weatherCache.updateCachedEntry(metadata, freshData);
            }

            // Calculate air density using WASM
            log.debug('═══════════════════════════════════════════════════════');
            log.debug('🧮 CALCULATING AIR DENSITY');
            log.debug('═══════════════════════════════════════════════════════');
            log.debug('  Input:');
            log.debug('    - Temperature:', weatherEntry.data.temperature, '°C');
            log.debug('    - Pressure:', weatherEntry.data.pressure, 'hPa');
            log.debug('    - Dew Point:', weatherEntry.data.dewPoint, '°C');

            const rhoRaw = AirDensityCalculator.calculate_air_density(
                weatherEntry.data.temperature,
                weatherEntry.data.pressure,
                weatherEntry.data.dewPoint
            );

            // Round to 4 decimal places for practical use
            const rho = parseFloat(rhoRaw.toFixed(4));

            log.debug('  Output:');
            log.debug('    - Air Density (ρ):', rho, 'kg/m³');
            log.debug('    - Wind Speed:', weatherEntry.data.windSpeed, 'm/s');
            log.debug('    - Wind Direction:', weatherEntry.data.windDirection, '°');
            log.debug('    - Source:', weatherEntry.source === 'cache' ? '💾 Cache' : '⬇️ API');
            log.debug('═══════════════════════════════════════════════════════\n');

            // Update parameters with calculated rho, wind data, and weather metadata
            const updateParams: Partial<AnalysisParameters> = {
                rho,
                rho_source: weatherEntry.source === 'cache' ? 'weather_cache' : 'weather_api',
                weather_metadata: {
                    temperature: weatherEntry.data.temperature,
                    dewPoint: weatherEntry.data.dewPoint,
                    pressure: weatherEntry.data.pressure,
                    windSpeed: weatherEntry.data.windSpeed ?? 0,
                    windDirection: weatherEntry.data.windDirection ?? 0,
                    location: { lat: metadata.avgLat, lon: metadata.avgLon },
                    timestamp: metadata.middleDate.toISOString(),
                    source: weatherEntry.source
                }
            };

            // Only set wind parameters if they are valid numbers
            if (weatherEntry.data.windSpeed !== undefined && weatherEntry.data.windSpeed !== null) {
                updateParams.wind_speed = weatherEntry.data.windSpeed;  // Always store in m/s
            }
            if (weatherEntry.data.windDirection !== undefined && weatherEntry.data.windDirection !== null) {
                updateParams.wind_direction = weatherEntry.data.windDirection;
            }

            // Keep the Crr temperature correction in sync with the fresh
            // ambient temperature (no-op when the correction is disabled).
            // Re-read the parameters: the toggle may have changed during the
            // async weather fetch.
            Object.assign(
                updateParams,
                syncCrrTempAmbientFromWeather(
                    parametersComponent.getParameters(),
                    weatherEntry.data.temperature
                )
            );

            parametersComponent.setParameters(updateParams);
            refreshCrrTempReadout(parametersComponent.getParameters());

            // Show success notification
            const sourceText = weatherEntry.source === 'cache' ? 'cached data' : 'weather API';
            showNotification(`Air density calculated: ${rho.toFixed(3)} kg/m³ (from ${sourceText})`, 'success');

            log.debug('╔═══════════════════════════════════════════════════════════════╗');
            log.debug('║  ✅ AUTO RHO CALCULATION COMPLETED SUCCESSFULLY              ║');
            log.debug('║  Final ρ: ' + rho.toFixed(3) + ' kg/m³                                     ║');
            log.debug('╚═══════════════════════════════════════════════════════════════╝\n');

            services.hideLoading();
            appState.isCalculatingAutoRho = false;
            return rho;

        } catch (error) {
            services.hideLoading();

            if (error instanceof WeatherAPIError) {
                log.error('Weather API error:', error.message, error.code);

                // Show user-friendly error message
                let userMessage = 'Could not fetch weather data: ';
                if (error.code === 'DATA_TOO_OLD') {
                    userMessage += 'Activity is too old (>92 days). Using manual rho value.';
                } else if (error.code === 'API_ERROR') {
                    userMessage += 'Weather service unavailable. Using manual rho value.';
                } else if (error.code === 'FETCH_ERROR') {
                    userMessage += 'Network error. Check your internet connection.';
                } else {
                    userMessage += error.message;
                }

                showNotification(userMessage, 'warning');
            } else {
                log.error('Failed to calculate auto rho:', error);
                const errorMsg = error instanceof Error ? error.message : 'Unknown error';
                showNotification(`Auto-rho calculation failed: ${errorMsg}`, 'error');
            }

            appState.isCalculatingAutoRho = false;
            return null;
        }

    } catch (error) {
        services.hideLoading();
        log.error('Unexpected error in calculateAutoRho:', error);
        showNotification('Failed to calculate air density. Using manual value.', 'error');
        appState.isCalculatingAutoRho = false;
        return null;
    }
}
