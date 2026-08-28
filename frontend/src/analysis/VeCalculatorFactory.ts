import type { AnalysisParameters } from '../components/AnalysisParameters';
import { resolveAppliedWindSpeed } from './WindHeightTransfer';
import {
    create_ve_calculator,
    create_ve_calculator_with_rho_array,
    type VirtualElevationCalculator,
} from '@wasm/virtual_elevation_analyzer.js';

export interface VeCalculatorSeriesInput {
    timestamps: ArrayLike<number>;
    power: ArrayLike<number>;
    velocity: ArrayLike<number>;
    positionLat: ArrayLike<number>;
    positionLong: ArrayLike<number>;
    altitude: ArrayLike<number>;
    distance: ArrayLike<number>;
    windSpeed: ArrayLike<number>;
    rhoArray?: ArrayLike<number> | null;
}

export interface VeCalculatorInput extends VeCalculatorSeriesInput {
    params: AnalysisParameters;
    cda: number | null | undefined;
    crr: number | null | undefined;
}

const float64ArrayCache = new WeakMap<object, Float64Array>();

export function createVeCalculator(input: VeCalculatorInput): VirtualElevationCalculator {
    const timestamps = toFloat64ArrayCached(input.timestamps);
    const power = toFloat64ArrayCached(input.power);
    const velocity = toFloat64ArrayCached(input.velocity);
    const positionLat = toFloat64ArrayCached(input.positionLat);
    const positionLong = toFloat64ArrayCached(input.positionLong);
    const altitude = toFloat64ArrayCached(input.altitude);
    const distance = toFloat64ArrayCached(input.distance);
    const windSpeed = toFloat64ArrayCached(input.windSpeed);

    // D-04: single application point for the 10 m -> rider height transfer.
    // create_ve_calculator and create_ve_calculator_with_rho_array are reached
    // from this file alone (`grep -rn "create_ve_calculator" frontend/src
    // --include="*.ts"` returns hits only here and in its test), so one hoisted
    // local corrects all seven production createVeCalculator consumers across
    // 11 call sites - and therefore all three analysis modes - with no WASM
    // signature change. Rejected alternative: applying k in the Rust at
    // virtual_elevation.rs:328, arguably the more honest home for physics, but
    // it costs a new VirtualElevationParams field, signature changes across
    // three WASM constructor wrappers, Rust tests and a wasm rebuild for an
    // identical outcome.
    // D-03: params.wind_speed keeps meaning "wind as reported, untransferred" -
    // k is applied here, downstream, and is never folded into stored state.
    const effectiveWindSpeed = resolveAppliedWindSpeed(input.params, input.params.wind_speed);

    if (input.rhoArray) {
        return create_ve_calculator_with_rho_array(
            timestamps,
            power,
            velocity,
            positionLat,
            positionLong,
            altitude,
            distance,
            windSpeed,
            toFloat64ArrayCached(input.rhoArray),
            input.params.system_mass,
            input.params.rho,
            input.params.eta,
            input.cda,
            input.crr,
            input.params.cda_min,
            input.params.cda_max,
            input.params.crr_min,
            input.params.crr_max,
            effectiveWindSpeed,
            input.params.wind_direction,
            input.params.velodrome,
        );
    }

    return create_ve_calculator(
        timestamps,
        power,
        velocity,
        positionLat,
        positionLong,
        altitude,
        distance,
        windSpeed,
        input.params.system_mass,
        input.params.rho,
        input.params.eta,
        input.cda,
        input.crr,
        input.params.cda_min,
        input.params.cda_max,
        input.params.crr_min,
        input.params.crr_max,
        effectiveWindSpeed,
        input.params.wind_direction,
        input.params.velodrome,
    );
}

export function toFloat64ArrayCached(values: ArrayLike<number>): Float64Array {
    if (values instanceof Float64Array) {
        return values;
    }

    const cacheKey = values as object;
    const cached = float64ArrayCache.get(cacheKey);
    if (cached) {
        return cached;
    }

    const normalized = Array.isArray(values)
        ? new Float64Array(values)
        : new Float64Array(Array.from(values) as number[]);

    float64ArrayCache.set(cacheKey, normalized);
    return normalized;
}
