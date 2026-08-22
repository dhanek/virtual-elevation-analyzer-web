import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { ActivityDataLike } from '../../state/AppState';
import type { AnalysisParameters } from '../../components/AnalysisParameters';

/**
 * Typed loader for the SYNTHETIC out-and-back fixture.
 *
 * READ THIS BEFORE CITING ANYTHING THIS FIXTURE PROVES. The file is derived
 * from `golden-ride.json` by reversing and re-concatenating three of its laps.
 * It is **WEAKER evidence than a real out-and-back ride**: it exists because no
 * out-and-back FIT ride is available — none to the maintainer, none in the repo
 * — and a code path with no data to run on had never been exercised end to end.
 * A result obtained through this loader may NEVER be described as
 * browser-verified or as real-ride verified. It cannot stand in for a DevTools
 * measurement, a human impression, or a real-ride before/after. The same
 * statement is carried inside the data as `_provenance.evidenceStrength`, with
 * an explicit `_provenance.whatThisDoesNotDischarge` list beside it, and both
 * are asserted by `src/analysis/outAndBackFixture.test.ts` so that quietly
 * stripping the caveat fails a test.
 *
 * Structure mirrors `loadGoldenRide.ts` deliberately, including the choice of
 * `readFileSync` + `JSON.parse` over a JSON import assertion: an import
 * assertion couples the loader to a bundler/runtime setting, and this file has
 * to work identically under vitest (`environment: 'node'`) and under
 * `vite-node`.
 *
 * `isOutAndBackRidePresent()` exists so a consumer can skip coherently on a
 * checkout where the fixture is absent, WITHOUT that skip being able to hide in
 * CI — mirror `veGolden.wasm.test.ts`'s CI-presence assertion outside the
 * `describe.skipIf` if you use it that way (D-10).
 *
 * NOTE ON `sections`: `OutAndBackRideSection` is a deliberate 5-field SUBSET of
 * production's `OutAndBackSection` (`src/utils/GpsLapDetection.ts:85`). Ten
 * fields of the production interface are absent — `outboundStartDirection`,
 * `outboundEndDirection`, `outboundDuration`, `outboundDistance`, the four
 * inbound equivalents, `totalDuration` and `totalDistance`. Only
 * `sectionNumber` and the four `*Idx` fields are read on the update path
 * (`modes/analysis/outAndBackMode.ts` `prepareSelection` / `getUpdateSegments`),
 * and `loadGoldenRide.ts`'s `GoldenRideSection` is already the same subset, so a
 * consumer assigning these into `appState.outAndBackSections` needs a cast.
 * That is a documented subset, not a type bug. The absent fields are NOT
 * invented: fabricated direction, duration and distance values that nothing
 * reads would be indistinguishable from measured ones.
 */

/**
 * Resolved with `dirname(fileURLToPath(import.meta.url))` + `join`, NOT with
 * `fileURLToPath(new URL('./out-and-back-ride.json', import.meta.url))` — which
 * is what `loadGoldenRide.ts` uses and what this file originally copied.
 *
 * `new URL('./relative', import.meta.url)` is Vite's STATIC ASSET pattern, and
 * Vite rewrites it whenever it transforms a module in **web** mode. Vitest picks
 * the transform mode from the environment: `ssr` for `environment: 'node'`, and
 * `web` for `jsdom` / `happy-dom`. So the original expression resolved correctly
 * under `outAndBackFixture.test.ts` (node) and silently became
 * `http://localhost:3000/src/…/out-and-back-ride.json` under any jsdom consumer,
 * where `fileURLToPath` then threw `ERR_INVALID_URL_SCHEME: The URL must be of
 * scheme file`. Plan 07-08's jsdom chain test is the first jsdom consumer, and it
 * could not import this module at all until this line changed.
 *
 * A BARE `import.meta.url` is not part of that pattern and survives both
 * transform modes as a `file://` URL — verified in both environments, not
 * assumed. Keep it bare; re-introducing the `new URL(...)` form would break the
 * jsdom side again with no test in `environment: 'node'` able to see it.
 */
export const OUT_AND_BACK_RIDE_PATH = join(
    dirname(fileURLToPath(import.meta.url)),
    'out-and-back-ride.json',
);

export interface OutAndBackRideProvenance {
    synthetic: true;
    derivedFrom: string;
    generator: string;
    deterministic: true;
    regenerateWith: string;
    /**
     * The caveat, in the data rather than in a comment, so it travels with
     * every claim built on the fixture (threat T-07-07-03).
     */
    evidenceStrength: string;
    whatThisDoesNotDischarge: string[];
    derivation: string[];
    sourceLaps: Array<{ lapNumber: number; sourceStartIdx: number; sourceEndIdx: number; length: number }>;
    sectionShape: string;
    inheritedAnonymisation: string;
    rounding: {
        coordinatesDecimals: number;
        altitudeDecimals: number;
        velocityDecimals: number;
        powerDecimals: number;
        otherDecimals: number;
        rhoDecimals: number;
    };
}

export interface OutAndBackRideLap {
    start_time: number;
    end_time: number;
}

export interface OutAndBackRideIndexRange {
    startIdx: number;
    endIdx: number;
}

/** @see the `sections` note in this module's header for the ten absent fields. */
export interface OutAndBackRideSection {
    sectionNumber: number;
    outboundStartIdx: number;
    outboundEndIdx: number;
    inboundStartIdx: number;
    inboundEndIdx: number;
}

/** The on-disk shape, exactly as `build-out-and-back-fixture.ts` emits it. */
export interface OutAndBackRideJson {
    _provenance: OutAndBackRideProvenance;
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
    laps: OutAndBackRideLap[];
    indexRanges: OutAndBackRideIndexRange[];
    sections: OutAndBackRideSection[];
    params: AnalysisParameters;
}

export interface OutAndBackRide {
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
    laps: OutAndBackRideLap[];
    indexRanges: OutAndBackRideIndexRange[];
    sections: OutAndBackRideSection[];
    provenance: OutAndBackRideProvenance;
}

export function isOutAndBackRidePresent(): boolean {
    return existsSync(OUT_AND_BACK_RIDE_PATH);
}

export function loadOutAndBackRide(): OutAndBackRide {
    if (!isOutAndBackRidePresent()) {
        throw new Error(
            `Out-and-back fixture not found at ${OUT_AND_BACK_RIDE_PATH}. ` +
            'Regenerate it with `cd frontend && npx vite-node scripts/build-out-and-back-fixture.ts` ' +
            '— the derivation is deterministic, so the regenerated file is byte-identical to the committed one.',
        );
    }

    const json = JSON.parse(readFileSync(OUT_AND_BACK_RIDE_PATH, 'utf8')) as OutAndBackRideJson;

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
        provenance: json._provenance,
    };
}
