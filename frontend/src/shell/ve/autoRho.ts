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
import { refreshWindHeightReadout, syncWindHeightFromWeather } from './windHeightControls';
import { AUTO_RHO_FAILURE_MESSAGE, resolveWeatherFailure } from './weatherFallback';

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

    // `services.hideLoading()` is a global, non-refcounted toggle that also
    // re-enables the Analyze button. Auto-rho runs from detached timers
    // (fileLoadOrchestration, section3Orchestration, analyzeOrchestrator), so
    // overlapping with another in-flight operation is normal — calling
    // hideLoading() when we never called showLoading() would dismiss *their*
    // overlay and re-enable the button mid-run. Track ownership instead: only
    // the call that showed the overlay may hide it, and only once.
    let loadingShown = false;
    const hideLoadingIfOwned = (): void => {
        if (!loadingShown) return;
        loadingShown = false;
        services.hideLoading();
    };

    // WEATH-03 rung 3 guard: everything after the in-progress flag is set runs
    // inside this try/finally, so no failure path can leave
    // `isCalculatingAutoRho` stuck at true (which would permanently disable
    // auto-rho for the session) — including a throw from inside a catch
    // handler (`hideLoading` / `showNotification` both touch the DOM). The flag
    // is cleared in exactly one place, the `finally` below, so a future early
    // return cannot reintroduce the leak. Callers discard the return value, so
    // returning null simply leaves the manual/prior rho in place and analysis
    // continues.
    try {
        log.debug('\n╔═══════════════════════════════════════════════════════════════╗');
        log.debug('║  🌦️  AUTO RHO CALCULATION STARTED                            ║');
        log.debug('╚═══════════════════════════════════════════════════════════════╝\n');

        if (!appState.currentFitData || !parametersComponent) {
            log.warn('❌ Cannot calculate auto rho: missing FIT data or parameters component');
            log.debug('  - appState.currentFitData:', !!appState.currentFitData);
            log.debug('  - parametersComponent:', !!parametersComponent);
            return null;
        }

        const params = parametersComponent.getParameters();

        // Check if auto-calculate is enabled
        if (!params.auto_calculate_rho) {
            log.debug('⏭️  Auto-calculate disabled, skipping\n');
            return null;
        }

        log.debug('✅ Auto-calculate enabled, proceeding...\n');

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

        // Show loading state — from here on we own the overlay.
        services.showLoading('Fetching weather data...');
        loadingShown = true;

        try {
            // Calculate GPS metadata from trim region
            // Use filtered lap data (only selected laps), not the full FIT data
            if (!appState.filteredLapData) {
                log.warn('❌ No filtered lap data available - cannot calculate auto rho');
                log.debug('  This usually means laps have not been selected yet.\n');
                hideLoadingIfOwned();
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

            // Check if query has actually changed. The key records the query
            // whose result is currently loaded into `params`, so it is only
            // assigned once the fetch has succeeded (see below) — a failed
            // fetch must not mark its region as already loaded, or the user
            // has to move the slider away and back to get a retry.
            if (appState.lastWeatherQueryKey === queryKey) {
                log.debug('⏭️  Query unchanged from last calculation, using cached rho');
                log.debug('  Query key:', queryKey);
                hideLoadingIfOwned();
                return params.rho; // Return current rho value
            }

            log.debug('🔄 Query changed, fetching new weather data');
            log.debug('  Previous:', appState.lastWeatherQueryKey || 'none');
            log.debug('  Current:', queryKey);
            log.debug('');

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

            // Seed the wind height factor, but only from a fill that actually
            // produced a wind. The gate is on the wind field having been
            // written above, NOT on the fetch having succeeded: when the API
            // returns no wind speed the two assignments above leave the wind
            // untouched, and stamping wind_entry: 'weather' on that path would
            // claim a provenance for a number the API never wrote (T-08-11).
            //
            // The "unknown" case is decided inside the sync hook, which returns
            // {} for it — one decision site, testable with no bind() call. It
            // matters at *this* call site because auto-rho genuinely re-fires on
            // load, from fileLoad/fileLoadOrchestration.ts:389 and
            // ve/bindStandardSliders.ts:632; neither is suppressed by
            // isLoadingParameters, which only short-circuits
            // handleParametersChange (analysis/analyzeOrchestrator.ts:171). So
            // on any saved file with auto_calculate_rho: true this merge runs
            // immediately after normalizeLoadedParameters has produced
            // wind_entry: 'unknown'. Were that treated as a first fill, the
            // sequence would re-seed k to 0.5 and silently re-fit an analysis
            // the user has already read (D-07 / R-04, T-08-16).
            //
            // As with the Crr merge above, the parameters are re-read rather
            // than reused: the user may have moved the k slider during the
            // async weather fetch.
            if (updateParams.wind_speed !== undefined) {
                Object.assign(
                    updateParams,
                    syncWindHeightFromWeather(parametersComponent.getParameters())
                );
            }

            parametersComponent.setParameters(updateParams);
            refreshCrrTempReadout(parametersComponent.getParameters());
            refreshWindHeightReadout(parametersComponent.getParameters());

            // The result is now loaded, so this query may be skipped next time.
            appState.lastWeatherQueryKey = queryKey;

            // Show success notification
            const sourceText = weatherEntry.source === 'cache' ? 'cached data' : 'weather API';
            showNotification(`Air density calculated: ${rho.toFixed(3)} kg/m³ (from ${sourceText})`, 'success');

            log.debug('╔═══════════════════════════════════════════════════════════════╗');
            log.debug('║  ✅ AUTO RHO CALCULATION COMPLETED SUCCESSFULLY              ║');
            log.debug('║  Final ρ: ' + rho.toFixed(3) + ' kg/m³                                     ║');
            log.debug('╚═══════════════════════════════════════════════════════════════╝\n');

            hideLoadingIfOwned();
            return rho;

        } catch (error) {
            hideLoadingIfOwned();

            // WEATH-03 rungs 3/4: degrade to the manual/prior rho.
            // Diagnostics stay internal (log only); the user-facing text comes
            // from the pure resolver so error internals cannot leak (T-06-07).
            if (error instanceof WeatherAPIError) {
                log.error('Weather API error:', error.message, error.code);
            } else {
                log.error('Failed to calculate auto rho:', error);
            }

            // The rho still sitting in `params` was fetched for a *different*
            // trim region, so it no longer describes the current one. Keep the
            // number (it remains the best available estimate, and the user can
            // override it), but drop the provenance that claims it is live
            // weather data for this region. Without this, the weather panel
            // (AnalysisParameters.updateWeatherInfoDisplay) keeps rendering the
            // previous region's temperature/location/timestamp as current, and
            // `rho_source` keeps reporting 'weather_api'/'weather_cache' for a
            // value the weather service never returned for this region.
            invalidateStaleWeatherProvenance(parametersComponent);

            const resolution = resolveWeatherFailure(error);
            showNotification(resolution.userMessage, resolution.severity);

            // Returning null keeps the existing (now un-attributed) rho —
            // analysis continues.
            return null;
        }

    } catch (error) {
        // Only hides if we actually showed it: a throw anywhere above the
        // showLoading() call now reaches this handler (the try opens earlier
        // than it used to), and blindly toggling would dismiss a concurrent
        // operation's overlay and re-enable the Analyze button mid-run.
        hideLoadingIfOwned();
        log.error('Unexpected error in calculateAutoRho:', error);

        // Anything reaching here is a bug in the auto-rho path, not a weather
        // outage: every weather call lives in the inner try above, so a
        // WeatherAPIError cannot reach this handler. Report unconditionally as
        // an error (matching the pre-06-05 behaviour) rather than routing
        // through resolveWeatherFailure, which would silently de-escalate a
        // future WeatherAPIError raised outside the inner try to a warning.
        showNotification(AUTO_RHO_FAILURE_MESSAGE, 'error');

        return null;
    } finally {
        appState.isCalculatingAutoRho = false;
    }
}

/**
 * Drop the weather provenance attached to the current rho.
 *
 * Called when a re-fetch fails after an earlier fetch succeeded: the stored
 * `rho`, `weather_metadata` and wind vector all belong to the previously
 * queried trim region. Marking the source `manual` and clearing the metadata
 * hides the weather panel and stops the stale reading from being presented as
 * live data for the current region.
 *
 * `wind_speed` / `wind_direction` are deliberately left alone: they are
 * user-editable inputs with no provenance label of their own, so clearing them
 * would silently switch the analysis to a zero-wind assumption and could
 * discard a value the user typed by hand. They are treated exactly like `rho`
 * itself — kept as the prior best estimate, no longer advertised as live.
 *
 * `wind_entry` and `wind_height_factor` are left alone for that same reason and
 * one more: the retained wind is still the same *kind* of number — a 10 m model
 * wind — so the height factor must keep applying to it (D-06). A failed
 * re-fetch changes what the wind describes, not how it was measured.
 *
 * This is why D-06 rejects folding the wind-height signal into `rho_source`:
 * that field IS cleared here, so a merged signal would be cleared with it, and
 * a failed re-fetch would silently turn a still-10 m wind into an untransferred
 * one — changing the physics on an error path. Hence this function writes only
 * `rho_source` and `weather_metadata`, and gains no code for the wind fields.
 */
function invalidateStaleWeatherProvenance(
    parametersComponent: AnalysisParametersComponent
): void {
    if (parametersComponent.getParameters().rho_source === 'manual') return;

    parametersComponent.setParameters({
        rho_source: 'manual',
        weather_metadata: undefined,
    });
}
