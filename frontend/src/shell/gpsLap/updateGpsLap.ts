/**
 * GPS-lap VE update and recalculation.
 *
 * Verbatim lift from main.ts -- update logic for GPS-lap mode.
 */
import type { AppState } from '../../state/AppState';
import type { ParameterStorage } from '../../utils/ParameterStorage';
import type { ResultsStorage } from '../../utils/ResultsStorage';
import type { ShellServices } from '../analysis/types';
import type { LapVEProfile } from './types';
import { getNormalizedActivityArrays } from '../../analysis/ActivityArrayCache';
import { resolveWindSeries } from '../../analysis/WindSourceResolver';
import { createVeCalculator } from '../../analysis/VeCalculatorFactory';
import { buildSegmentSupplementarySeries } from '../../analysis/SegmentSupplementarySeries';
import { renderGpsLapVEPlots, renderGpsLapWindPlot, renderGpsLapPowerPlot, renderGpsLapVdPlot, calculateMeanElevationProfile, calculateGpsLapStats } from './gpsLapPlots';
import { showGpsLapVEAnalysis, getGpsLapNumberForRange } from './renderGpsLap';
import { setupTabSwitching } from '../dom/tabs';
import { log } from '../../utils/log';

/**
 * Update VE plots for GPS lap mode - calculates VE for each lap and shows stacked plot
 */
export async function updateGpsLapVEPlots(
    appState: AppState,
    _parameterStorage: ParameterStorage,
    waitForPlotly: () => Promise<any>,
    cda: number,
    crr: number,
    windSource: string,
) {
    if (!appState.currentFitData || !appState.currentGpsLapIndexRanges || !appState.currentParameters) {
        log.error('Missing data for GPS lap VE update');
        return;
    }

    await waitForPlotly();

    const normalizedArrays = getNormalizedActivityArrays(appState.currentFitData);
    const allTimestamps = normalizedArrays.timestamps;
    const allPower = normalizedArrays.power;
    const allVelocity = normalizedArrays.velocity;
    const allPositionLat = normalizedArrays.positionLat;
    const allPositionLong = normalizedArrays.positionLong;
    const allAltitude = normalizedArrays.altitude;
    const allDistance = normalizedArrays.distance;

    const gpsLapUpdateWindResolution = resolveWindSeries({
        fitData: appState.currentFitData,
        windSource,
        params: appState.currentParameters,
        airSpeedCalibrationPercent: appState.airSpeedCalibrationPercent,
    });
    const allWindSpeed = gpsLapUpdateWindResolution.windSpeed;

    const lapVEProfiles: LapVEProfile[] = [];

    // Calculate VE for each selected GPS lap
    for (let lapIdx = 0; lapIdx < appState.currentGpsLapIndexRanges.length; lapIdx++) {
        const range = appState.currentGpsLapIndexRanges[lapIdx];
        const lapNumber = getGpsLapNumberForRange(appState, range, lapIdx + 1);

        // Extract data for this lap
        const lapTimestamps: number[] = [];
        const lapPower: number[] = [];
        const lapVelocity: number[] = [];
        const lapPositionLat: number[] = [];
        const lapPositionLong: number[] = [];
        const lapAltitude: number[] = [];
        const lapDistance: number[] = [];
        const lapWindSpeed: number[] = [];

        for (let i = range.startIdx; i <= range.endIdx && i < allTimestamps.length; i++) {
            lapTimestamps.push(allTimestamps[i]);
            lapPower.push(allPower[i]);
            lapVelocity.push(allVelocity[i]);
            lapPositionLat.push(allPositionLat[i]);
            lapPositionLong.push(allPositionLong[i]);
            lapAltitude.push(allAltitude[i]);
            lapDistance.push(allDistance[i]);
            lapWindSpeed.push(allWindSpeed[i]);
        }

        if (lapTimestamps.length < 10) {
            log.warn(`Lap ${lapNumber} has too few data points (${lapTimestamps.length}), skipping`);
            continue;
        }

        const supplementarySeries = buildSegmentSupplementarySeries({
            timestamps: lapTimestamps,
            power: lapPower,
            velocity: lapVelocity,
            positionLat: lapPositionLat,
            positionLong: lapPositionLong,
            distance: lapDistance,
            windSpeed: lapWindSpeed,
            params: appState.currentParameters,
            selectedWindSource: gpsLapUpdateWindResolution.selectedWindSource,
        });
        const relativeDistances = supplementarySeries.distancesKm;

        // Calculate duration
        const duration = lapTimestamps[lapTimestamps.length - 1] - lapTimestamps[0];
        const totalDistance = relativeDistances[relativeDistances.length - 1] ?? 0;

        try {
            const calculator = createVeCalculator({
                timestamps: lapTimestamps,
                power: lapPower,
                velocity: lapVelocity,
                positionLat: lapPositionLat,
                positionLong: lapPositionLong,
                altitude: lapAltitude,
                distance: lapDistance,
                windSpeed: lapWindSpeed,
                params: appState.currentParameters,
                cda,
                crr,
            });

            // Calculate VE for full lap
            const result = calculator.calculate_virtual_elevation(cda, crr, 0, lapTimestamps.length - 1);

            // Extract VE values
            const veArray = Array.from(result.virtual_elevation as Float64Array);

            // Get actual elevation (use zeros for velodrome mode)
            const actualElevation = appState.currentParameters.velodrome
                ? new Array(lapAltitude.length).fill(0)
                : lapAltitude;

            lapVEProfiles.push({
                lapNumber,
                distances: relativeDistances,
                virtualElevation: veArray,
                actualElevation: actualElevation,
                supplementarySeries,
                duration,
                totalDistance
            });

        } catch (err) {
            log.error(`Failed to calculate VE for lap ${lapNumber}:`, err);
        }
    }

    if (lapVEProfiles.length === 0) {
        log.error('No valid laps to display');
        return;
    }

    // Calculate mean actual elevation profile
    const meanElevation = calculateMeanElevationProfile(lapVEProfiles);

    // Calculate and update statistics
    const stats = calculateGpsLapStats(lapVEProfiles, meanElevation);

    // Create a combined VE result for store functionality
    // Concatenate all lap VE profiles into a single array
    const combinedVE: number[] = [];
    for (const lap of lapVEProfiles) {
        combinedVE.push(...lap.virtualElevation);
    }

    // Store combined result globally for save functionality
    appState.currentVEResult = {
        r2: stats.meanR2,
        rmse: stats.meanRMSE,
        ve_elevation_diff: stats.avgVeGain,
        actual_elevation_diff: stats.avgActualGain,
        virtual_elevation: new Float64Array(combinedVE),
        virtual_distance_air: 0,
        virtual_distance_ground: 0,
        vd_difference_percent: 0
    };
    appState.currentWindSource = (windSource === 'compare'
        ? 'compare'
        : gpsLapUpdateWindResolution.selectedWindSource) as 'constant' | 'fit' | 'compare' | 'none';

    // Store filtered data globally for save functionality (combine all lap data)
    const combinedPower: number[] = [];
    const combinedVelocity: number[] = [];
    const combinedTimestamps: number[] = [];
    const combinedTemperature: number[] = [];

    for (const range of appState.currentGpsLapIndexRanges!) {
        for (let i = range.startIdx; i <= range.endIdx && i < allTimestamps.length; i++) {
            combinedPower.push(allPower[i]);
            combinedVelocity.push(allVelocity[i]);
            combinedTimestamps.push(allTimestamps[i]);
            // Temperature may not exist
            if (appState.currentFitData.temperature) {
                combinedTemperature.push(appState.currentFitData.temperature[i] || 0);
            }
        }
    }
    appState.currentFilteredData = {
        power: combinedPower,
        velocity: combinedVelocity,
        timestamps: combinedTimestamps,
        temperature: combinedTemperature
    };

    // Store analyzed laps (GPS lap numbers)
    appState.currentAnalyzedLaps = lapVEProfiles.map(lap => lap.lapNumber);

    renderGpsLapVEPlots(lapVEProfiles, meanElevation);
    setupTabSwitching({
        wind: () => renderGpsLapWindPlot(lapVEProfiles),
        power: () => renderGpsLapPowerPlot(lapVEProfiles),
        vd: () => renderGpsLapVdPlot(lapVEProfiles),
    });

    const windTab = document.getElementById('wind-tab');
    if (windTab?.classList.contains('active')) {
        renderGpsLapWindPlot(lapVEProfiles);
    }
    const powerTab = document.getElementById('power-tab');
    if (powerTab?.classList.contains('active')) {
        renderGpsLapPowerPlot(lapVEProfiles);
    }
    const vdTab = document.getElementById('vd-tab');
    if (vdTab?.classList.contains('active')) {
        renderGpsLapVdPlot(lapVEProfiles);
    }

    log.debug(`GPS Lap VE plots updated with ${lapVEProfiles.length} laps, CdA=${cda.toFixed(3)}, Crr=${crr.toFixed(4)}`);
}

/**
 * Recalculate GPS lap VE with updated CdA/Crr values
 */
export async function recalculateGpsLapVE(
    appState: AppState,
    services: ShellServices,
    parameterStorage: ParameterStorage,
    resultsStorage: ResultsStorage,
    waitForPlotly: () => Promise<any>,
) {
    if (!appState.currentFitData || !appState.currentParameters) {
        log.error('Cannot recalculate: missing data or parameters');
        return;
    }

    const cdaValueEl = document.getElementById('cdaValue') as HTMLInputElement;
    const crrValueEl = document.getElementById('crrValue') as HTMLInputElement;

    if (!cdaValueEl || !crrValueEl) return;

    const newCda = parseFloat(cdaValueEl.value);
    const newCrr = parseFloat(crrValueEl.value);

    // Get the selected GPS lap index ranges
    const selectedGpsLaps = appState.gpsDetectedLaps.filter(lap =>
        appState.gpsSelectedLaps.includes(lap.lapNumber)
    );
    const selectedLapIndexRanges = selectedGpsLaps.map(lap => ({
        startIdx: lap.startIdx,
        endIdx: lap.endIdx
    }));

    if (selectedLapIndexRanges.length === 0) {
        log.error('No GPS laps selected for recalculation');
        return;
    }

    // Update parameters with new values
    const updatedParams = { ...appState.currentParameters, cda: newCda, crr: newCrr };

    // Recalculate
    services.showLoading('Recalculating VE with new parameters...');

    try {
        await showGpsLapVEAnalysis(
            services,
            parameterStorage,
            resultsStorage,
            waitForPlotly,
            selectedLapIndexRanges,
            appState.currentFitData,
            updatedParams,
            appState.currentParameters.air_speed_offset ?? 2,
            true,
        );
    } catch (err) {
        log.error('Recalculation failed:', err);
        services.hideLoading();
    }
}
