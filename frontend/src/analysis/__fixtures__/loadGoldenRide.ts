import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import type { ActivityDataLike } from '../../state/AppState';
import type { AnalysisParameters } from '../../components/AnalysisParameters';

/**
 * Typed loader for the D-12 anonymised golden fixture.
 *
 * Read via `readFileSync` + `JSON.parse` rather than a JSON import assertion:
 * an import assertion couples the loader to a bundler/runtime setting, and this
 * file has to work identically under vitest (`environment: 'node'`) and under
 * `vite-node`. The fixture is produced by
 * `frontend/scripts/build-golden-fixture.ts` and only reaches this directory
 * after the blocking D-12 maintainer checkpoint (07-01 Task 4).
 *
 * `isGoldenRidePresent()` exists so the golden test can skip coherently on a
 * machine where the fixture has not been created yet, WITHOUT that skip being
 * able to hide in CI — the CI-presence assertion in `veGolden.wasm.test.ts`
 * runs outside the `describe.skipIf` for exactly that reason (D-10).
 */

export const GOLDEN_RIDE_PATH = fileURLToPath(new URL('./golden-ride.json', import.meta.url));

export interface GoldenRideAnonymisation {
    note: string;
    steps: string[];
    coordinateTransform: {
        centroidSubtracted: boolean;
        rotationDegrees: number;
        destinationOriginLat: number;
        destinationOriginLong: number;
    };
    sampleWindow: {
        startIdx: number;
        endIdx: number;
        length: number;
        sourceRecordCount: number;
        selection: 'explicit' | 'auto';
    };
    /** Flag string that reproduces this fixture from the source ride. */
    reproduceWith: string;
    altitudeOffsetMetres: number;
    droppedArrays: string[];
}

export interface GoldenRideLap {
    start_time: number;
    end_time: number;
}

export interface GoldenRideIndexRange {
    startIdx: number;
    endIdx: number;
}

export interface GoldenRideSection {
    sectionNumber: number;
    outboundStartIdx: number;
    outboundEndIdx: number;
    inboundStartIdx: number;
    inboundEndIdx: number;
}

/** The on-disk shape, exactly as `build-golden-fixture.ts` emits it. */
export interface GoldenRideJson {
    _anonymisation: GoldenRideAnonymisation;
    record_count: number;
    timestamps: number[];
    power: number[];
    velocity: number[];
    position_lat: number[];
    position_long: number[];
    altitude: number[];
    distance: number[];
    air_speed: number[];
    wind_yaw: number[];
    temperature: number[];
    rhoArray: number[];
    laps: GoldenRideLap[];
    indexRanges: GoldenRideIndexRange[];
    sections: GoldenRideSection[];
    params: AnalysisParameters;
}

export interface GoldenRide {
    /**
     * Satisfies `ActivityDataLike` well enough for `getNormalizedActivityArrays`.
     * The arrays the fixture does not carry (`wind_speed`, `air_density_data`,
     * `road_speed`, `battery_soc`, `heart_rate`, `cadence`) are zero-filled here
     * rather than stored: the pipeline reads them, but none of them influences a
     * VE number, and `heart_rate` / `cadence` / `battery_soc` must never be
     * committed (threat T-07-02).
     */
    fitData: ActivityDataLike;
    params: AnalysisParameters;
    rhoArray: number[];
    laps: GoldenRideLap[];
    indexRanges: GoldenRideIndexRange[];
    sections: GoldenRideSection[];
    anonymisation: GoldenRideAnonymisation;
}

export function isGoldenRidePresent(): boolean {
    return existsSync(GOLDEN_RIDE_PATH);
}

export function loadGoldenRide(): GoldenRide {
    if (!isGoldenRidePresent()) {
        throw new Error(
            `Golden ride fixture not found at ${GOLDEN_RIDE_PATH}. ` +
            'Build a candidate with `npx vite-node scripts/build-golden-fixture.ts -- <ride.fit>` ' +
            'and promote it only after the D-12 maintainer checkpoint.',
        );
    }

    const json = JSON.parse(readFileSync(GOLDEN_RIDE_PATH, 'utf8')) as GoldenRideJson;

    const zeros = (): number[] => new Array<number>(json.record_count).fill(0);

    const fitData = {
        timestamps: json.timestamps,
        position_lat: json.position_lat,
        position_long: json.position_long,
        altitude: json.altitude,
        velocity: json.velocity,
        power: json.power,
        air_speed: json.air_speed,
        distance: json.distance,
        wind_speed: zeros(),
        wind_yaw: json.wind_yaw,
        air_density_data: zeros(),
        road_speed: zeros(),
        temperature: json.temperature,
        battery_soc: zeros(),
        heart_rate: zeros(),
        cadence: zeros(),
        record_count: json.record_count,
    } as ActivityDataLike;

    return {
        fitData,
        params: json.params,
        rhoArray: json.rhoArray,
        laps: json.laps,
        indexRanges: json.indexRanges,
        sections: json.sections,
        anonymisation: json._anonymisation,
    };
}
