/**
 * Out-and-back VE update and recalculation.
 *
 * Verbatim lift from main.ts -- update logic for out-and-back mode.
 */
import type { AppState } from '../../state/AppState';
import type { ParameterStorage } from '../../utils/ParameterStorage';
import type { ResultsStorage } from '../../utils/ResultsStorage';
import type { ShellServices } from '../analysis/types';
import type { OutAndBackVEProfile } from './types';

import { getNormalizedActivityArrays } from '../../analysis/ActivityArrayCache';
import { resolveWindSeries } from '../../analysis/WindSourceResolver';
import { createVeCalculator } from '../../analysis/VeCalculatorFactory';
import { buildSegmentSupplementarySeries } from '../../analysis/SegmentSupplementarySeries';
import { extractSegmentData } from '../../analysis/SegmentExtractor';
import { getSelectedWindSource } from '../dom/windSource';
import {
    calculateOutAndBackMeanElevation,
    calculateOutAndBackStats,
    renderOutAndBackPlots,
    renderOutAndBackWindPlot,
    renderOutAndBackPowerPlot,
    renderOutAndBackVdPlot,
} from './outAndBackPlots';
import { showOutAndBackVEAnalysis } from './renderOutAndBack';
import { log } from '../../utils/log';

/**
 * Update Out and Back VE plots with new CdA/Crr values
 */
export async function updateOutAndBackVEPlots(
    appState: AppState,
    waitForPlotly: () => Promise<any>,
    cda: number,
    crr: number,
) {
    if (!appState.currentFitData || !appState.currentOutAndBackSections || appState.currentOutAndBackSections.length === 0 || !appState.currentParameters) {
        log.error('Missing data for Out and Back VE update');
        return;
    }

    const Plotly = await waitForPlotly();

    // Recalculate VE for all sections
    const profiles: OutAndBackVEProfile[] = [];

    const normalizedArrays = getNormalizedActivityArrays(appState.currentFitData);
    const allTimestamps = normalizedArrays.timestamps;
    const allPower = normalizedArrays.power;
    const allVelocity = normalizedArrays.velocity;
    const allPositionLat = normalizedArrays.positionLat;
    const allPositionLong = normalizedArrays.positionLong;
    const allAltitude = normalizedArrays.altitude;
    const allDistance = normalizedArrays.distance;

    // Handle wind/air speed via typed locals - check wind source selection
    const outAndBackUpdateWindResolution = resolveWindSeries({
        fitData: appState.currentFitData,
        windSource: getSelectedWindSource(),
        params: appState.currentParameters,
        airSpeedCalibrationPercent: appState.airSpeedCalibrationPercent,
    });
    const allWindSpeed = outAndBackUpdateWindResolution.windSpeed;

    if (outAndBackUpdateWindResolution.selectedWindSource === 'constant') {
        log.debug('Out and Back VE update: Using constant wind settings');
    } else if (outAndBackUpdateWindResolution.dataSource === 'air_speed') {
        log.debug(`Out and Back VE update: Using FIT air speed data (calibration: ${appState.airSpeedCalibrationPercent}%)`);
    } else if (outAndBackUpdateWindResolution.dataSource === 'wind_speed') {
        log.debug(`Out and Back VE update: Using FIT wind speed data (calibration: ${appState.airSpeedCalibrationPercent}%)`);
    } else {
        log.debug('Out and Back VE update: No wind data available');
    }

    for (const section of appState.currentOutAndBackSections) {
        const profile: OutAndBackVEProfile = {
            sectionNumber: section.sectionNumber,
            outboundDistances: [],
            outboundVE: [],
            outboundActualElevation: [],
            outboundSeries: null,
            inboundDistances: [],
            inboundVE: [],
            inboundActualElevation: [],
            inboundSeries: null,
            outboundDuration: section.outboundDuration,
            inboundDuration: section.inboundDuration,
            totalDistance: section.totalDistance
        };

        // Process outbound
        try {
            const outboundData = extractSegmentData({
                startIdx: section.outboundStartIdx,
                endIdx: section.outboundEndIdx,
                allTimestamps,
                allPower,
                allVelocity,
                allPositionLat,
                allPositionLong,
                allAltitude,
                allDistance,
                allWindSpeed,
            });

            if (outboundData.timestamps.length >= 10) {
                const calculator = createVeCalculator({
                    timestamps: outboundData.timestamps,
                    power: outboundData.power,
                    velocity: outboundData.velocity,
                    positionLat: outboundData.positionLat,
                    positionLong: outboundData.positionLong,
                    altitude: outboundData.altitude,
                    distance: outboundData.distance,
                    windSpeed: outboundData.windSpeed,
                    params: appState.currentParameters,
                    cda,
                    crr,
                });

                const result = calculator.calculate_virtual_elevation(cda, crr, 0, outboundData.timestamps.length - 1);
                const veArray = Array.from(result.virtual_elevation as Float64Array);

                profile.outboundSeries = buildSegmentSupplementarySeries({
                    timestamps: outboundData.timestamps,
                    power: outboundData.power,
                    velocity: outboundData.velocity,
                    positionLat: outboundData.positionLat,
                    positionLong: outboundData.positionLong,
                    distance: outboundData.distance,
                    windSpeed: outboundData.windSpeed,
                    params: appState.currentParameters,
                    selectedWindSource: outAndBackUpdateWindResolution.selectedWindSource,
                });
                profile.outboundDistances = profile.outboundSeries.distancesKm;
                profile.outboundVE = veArray;
                profile.outboundActualElevation = appState.currentParameters.velodrome
                    ? new Array(outboundData.altitude.length).fill(0)
                    : [...outboundData.altitude];
            }
        } catch (err) {
            log.error(`Failed to calculate outbound VE for section ${section.sectionNumber}:`, err);
        }

        // Process inbound
        try {
            const inboundData = extractSegmentData({
                startIdx: section.inboundStartIdx,
                endIdx: section.inboundEndIdx,
                allTimestamps,
                allPower,
                allVelocity,
                allPositionLat,
                allPositionLong,
                allAltitude,
                allDistance,
                allWindSpeed,
            });

            if (inboundData.timestamps.length >= 10) {
                const calculator = createVeCalculator({
                    timestamps: inboundData.timestamps,
                    power: inboundData.power,
                    velocity: inboundData.velocity,
                    positionLat: inboundData.positionLat,
                    positionLong: inboundData.positionLong,
                    altitude: inboundData.altitude,
                    distance: inboundData.distance,
                    windSpeed: inboundData.windSpeed,
                    params: appState.currentParameters,
                    cda,
                    crr,
                });

                const result = calculator.calculate_virtual_elevation(cda, crr, 0, inboundData.timestamps.length - 1);
                const veArray = Array.from(result.virtual_elevation as Float64Array);

                profile.inboundSeries = buildSegmentSupplementarySeries({
                    timestamps: inboundData.timestamps,
                    power: inboundData.power,
                    velocity: inboundData.velocity,
                    positionLat: inboundData.positionLat,
                    positionLong: inboundData.positionLong,
                    distance: inboundData.distance,
                    windSpeed: inboundData.windSpeed,
                    params: appState.currentParameters,
                    selectedWindSource: outAndBackUpdateWindResolution.selectedWindSource,
                });
                profile.inboundDistances = profile.inboundSeries.distancesKm;
                profile.inboundVE = veArray;
                profile.inboundActualElevation = appState.currentParameters.velodrome
                    ? new Array(inboundData.altitude.length).fill(0)
                    : [...inboundData.altitude];
            }
        } catch (err) {
            log.error(`Failed to calculate inbound VE for section ${section.sectionNumber}:`, err);
        }

        if (profile.outboundVE.length > 0 || profile.inboundVE.length > 0) {
            profiles.push(profile);
        }
    }

    if (profiles.length === 0) {
        log.error('No valid sections to display');
        return;
    }

    // Recalculate mean elevation
    const meanElevation = calculateOutAndBackMeanElevation(profiles);

    // Update statistics display
    const stats = calculateOutAndBackStats(profiles, meanElevation);
    const metricsDiv = document.getElementById('oabVeMetrics');
    if (metricsDiv) {
        metricsDiv.textContent = `RMSE: ${stats.rmse.toFixed(2)} m | VE: ${stats.avgVeGain.toFixed(2)} m | Actual: ${stats.avgActualGain.toFixed(2)} m | Diff: ${stats.avgDiff.toFixed(2)} m`;
    }

    // Update header values
    const veGainValueSpan = document.getElementById('oabVeGainValue');
    const actualGainValueSpan = document.getElementById('oabActualGainValue');
    if (veGainValueSpan) {
        veGainValueSpan.textContent = `${stats.avgVeGain.toFixed(2)}m`;
    }
    if (actualGainValueSpan) {
        actualGainValueSpan.textContent = `${stats.avgActualGain.toFixed(2)}m`;
    }

    // Re-render plots
    renderOutAndBackPlots(Plotly, profiles, meanElevation);

    const windTab = document.getElementById('wind-tab');
    if (windTab?.classList.contains('active')) {
        renderOutAndBackWindPlot(profiles);
    }
    const powerTab = document.getElementById('power-tab');
    if (powerTab?.classList.contains('active')) {
        renderOutAndBackPowerPlot(profiles);
    }
    const vdTab = document.getElementById('vd-tab');
    if (vdTab?.classList.contains('active')) {
        renderOutAndBackVdPlot(profiles);
    }

    log.debug(`Out and Back VE plots updated with ${profiles.length} sections, CdA=${cda.toFixed(3)}, Crr=${crr.toFixed(4)}`);
}

/**
 * Recalculate Out and Back VE with updated parameters
 */
export async function recalculateOutAndBackVE(
    services: ShellServices,
    parameterStorage: ParameterStorage,
    resultsStorage: ResultsStorage,
    waitForPlotly: () => Promise<any>,
) {
    const { appState } = services;
    if (!appState.currentFitData || !appState.currentParameters || !appState.currentOutAndBackSections || appState.currentOutAndBackSections.length === 0) {
        log.error('Cannot recalculate Out and Back VE: missing data, parameters, or sections');
        return;
    }

    const cda = parseFloat((document.getElementById('cdaValue') as HTMLInputElement)?.value || '0.3');
    const crr = parseFloat((document.getElementById('crrValue') as HTMLInputElement)?.value || '0.008');
    const updatedParams = { ...appState.currentParameters, cda, crr };

    services.showLoading('Recalculating VE with new parameters...');

    try {
        await showOutAndBackVEAnalysis(
            services,
            parameterStorage,
            resultsStorage,
            appState.currentOutAndBackSections,
            appState.currentFitData,
            updatedParams,
            appState.currentParameters.air_speed_offset ?? 2,
            waitForPlotly,
            true,
        );
    } catch (err) {
        log.error('Out and Back recalculation failed:', err);
        services.hideLoading();
    }
}
